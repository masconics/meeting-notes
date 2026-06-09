import Foundation
import AVFoundation
import CoreGraphics
import CoreAudio
import FluidAudio

/// Write a diagnostic line to stderr (the Rust side pipes this into the app log).
func sysLog(_ s: String) {
    FileHandle.standardError.write(("[fluidasr] " + s + "\n").data(using: .utf8)!)
}

/// Captures system output audio with a Core Audio process tap (macOS 14.4+) and
/// exposes it as 16kHz mono float chunks. This is audio-only — it does NOT use
/// ScreenCaptureKit, so it needs no Screen Recording permission and captures no
/// screen content.
@available(macOS 14.4, *)
final class SystemAudioCapturer: @unchecked Sendable {
    private let converter = AudioConverter() // defaults to 16kHz mono
    private let ioQueue = DispatchQueue(label: "fluidasr.system-audio")
    let samples: AsyncStream<[Float]>
    private let continuation: AsyncStream<[Float]>.Continuation

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var format = AudioStreamBasicDescription()
    private var bufferCount = 0
    private var sampleCount = 0
    private var blockPeak: Float = 0

    init() {
        var cont: AsyncStream<[Float]>.Continuation!
        self.samples = AsyncStream(bufferingPolicy: .unbounded) { cont = $0 }
        self.continuation = cont
    }

    private func fail(_ what: String, _ status: OSStatus) -> NSError {
        NSError(domain: "fluidasr.coreaudio", code: Int(status),
                userInfo: [NSLocalizedDescriptionKey: "\(what) failed (OSStatus \(status))"])
    }

    /// UID of the current default output device — used as the aggregate's clock master.
    private func defaultOutputDeviceUID() -> String? {
        var devID = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &devID) == noErr,
              devID != kAudioObjectUnknown else { return nil }
        var uidRef: Unmanaged<CFString>?
        var uidSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        addr.mSelector = kAudioDevicePropertyDeviceUID
        let st = withUnsafeMutablePointer(to: &uidRef) {
            AudioObjectGetPropertyData(devID, &addr, 0, nil, &uidSize, $0)
        }
        guard st == noErr, let uid = uidRef else { return nil }
        return uid.takeRetainedValue() as String
    }

    func start() throws {
        // 1. Tap the global system output mix (exclude nothing — we play no audio,
        //    so there's no feedback to avoid).
        let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        tapDesc.isPrivate = true
        var status = AudioHardwareCreateProcessTap(tapDesc, &tapID)
        guard status == noErr, tapID != kAudioObjectUnknown else { throw fail("AudioHardwareCreateProcessTap", status) }
        let tapUID = tapDesc.uuid.uuidString
        sysLog("sys: created process tap \(tapUID)")

        // 2. Private aggregate device. It needs a real device as clock master, or the
        //    IO proc never fires — use the default output device. Playback continues
        //    normally; the tap just observes the mix.
        guard let outUID = defaultOutputDeviceUID() else {
            throw fail("no default output device", -1)
        }
        sysLog("sys: aggregate master output device \(outUID)")
        let aggUID = UUID().uuidString
        let desc: [String: Any] = [
            kAudioAggregateDeviceNameKey: "fluidasr-system-tap",
            kAudioAggregateDeviceUIDKey: aggUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceMainSubDeviceKey: outUID,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [
                [kAudioSubDeviceUIDKey: outUID]
            ],
            kAudioAggregateDeviceTapListKey: [
                [kAudioSubTapUIDKey: tapUID, kAudioSubTapDriftCompensationKey: true]
            ],
        ]
        status = AudioHardwareCreateAggregateDevice(desc as CFDictionary, &aggregateID)
        guard status == noErr, aggregateID != kAudioObjectUnknown else { throw fail("AudioHardwareCreateAggregateDevice", status) }

        // 3. Input stream format of the aggregate (Float32, device rate, N channels).
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamFormat,
            mScope: kAudioObjectPropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        status = AudioObjectGetPropertyData(aggregateID, &addr, 0, nil, &size, &format)
        guard status == noErr, format.mSampleRate > 0 else { throw fail("get stream format", status) }
        sysLog("sys: tap format \(Int(format.mSampleRate))Hz, \(format.mChannelsPerFrame)ch, flags \(format.mFormatFlags)")

        // 4. IO block: pull system audio, downmix to mono, resample to 16k.
        let block: AudioDeviceIOBlock = { [weak self] _, inInputData, _, _, _ in
            self?.handle(inInputData)
        }
        status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, ioQueue, block)
        guard status == noErr, procID != nil else { throw fail("AudioDeviceCreateIOProcIDWithBlock", status) }
        status = AudioDeviceStart(aggregateID, procID)
        guard status == noErr else { throw fail("AudioDeviceStart", status) }
        sysLog("sys: process-tap capture started")
    }

    func stop() {
        if let p = procID {
            AudioDeviceStop(aggregateID, p)
            AudioDeviceDestroyIOProcID(aggregateID, p)
            procID = nil
        }
        if aggregateID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggregateID); aggregateID = kAudioObjectUnknown }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID); tapID = kAudioObjectUnknown }
        continuation.finish()
        sysLog("sys: stopped after \(bufferCount) buffers, \(sampleCount) samples")
    }

    private func handle(_ inInputData: UnsafePointer<AudioBufferList>) {
        let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
        let channels = max(1, Int(format.mChannelsPerFrame))
        let nonInterleaved = (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        var mono: [Float] = []

        if nonInterleaved {
            guard abl.count > 0, abl[0].mDataByteSize > 0 else { return }
            let frames = Int(abl[0].mDataByteSize) / MemoryLayout<Float>.size
            mono = [Float](repeating: 0, count: frames)
            var used = 0
            for ch in 0..<abl.count {
                guard let data = abl[ch].mData else { continue }
                let p = data.assumingMemoryBound(to: Float.self)
                for i in 0..<frames { mono[i] += p[i] }
                used += 1
            }
            if used > 1 { let n = Float(used); for i in 0..<frames { mono[i] /= n } }
        } else {
            guard abl.count > 0, let data = abl[0].mData, abl[0].mDataByteSize > 0 else { return }
            let total = Int(abl[0].mDataByteSize) / MemoryLayout<Float>.size
            let frames = total / channels
            let p = data.assumingMemoryBound(to: Float.self)
            mono = [Float](repeating: 0, count: frames)
            for f in 0..<frames {
                var s: Float = 0
                for c in 0..<channels { s += p[f * channels + c] }
                mono[f] = s / Float(channels)
            }
        }

        guard !mono.isEmpty else { return }
        do {
            let out = try converter.resample(mono, from: format.mSampleRate)
            guard !out.isEmpty else { return }
            bufferCount += 1
            sampleCount += out.count
            // Track peak amplitude so we can tell "capturing audio" from "capturing
            // silence/zeros" — the key diagnostic when nothing is detected.
            var peak: Float = 0
            for s in out { let a = abs(s); if a > peak { peak = a } }
            if peak > blockPeak { blockPeak = peak }
            if bufferCount == 1 { sysLog("sys: first audio block (\(out.count) samples @16k), peak \(peak)") }
            else if bufferCount % 200 == 0 {
                sysLog("sys: \(bufferCount) blocks, \(sampleCount) samples, peak(window) \(blockPeak)")
                blockPeak = 0
            }
            continuation.yield(out)
        } catch {
            sysLog("sys: resample failed: \(error.localizedDescription)")
        }
    }
}

@main
struct FluidAsr {
    static func emit(_ s: String) {
        FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
    }

    static func main() async {
        setvbuf(stdout, nil, _IONBF, 0)
        let args = CommandLine.arguments

        // Screen Recording permission probes (attributed to this binary, which is the
        // one that runs ScreenCaptureKit). Fast early exits — no model loading.
        if args.contains("--screen-check") {
            emit(CGPreflightScreenCaptureAccess() ? "GRANTED" : "DENIED")
            return
        }
        if args.contains("--screen-request") {
            // Prompts when undetermined; returns the resulting grant state.
            emit(CGRequestScreenCaptureAccess() ? "GRANTED" : "DENIED")
            return
        }

        let useV2 = args.contains("--v2")
        let useSenseVoice = args.contains("--sensevoice")
        let noVad = args.contains("--no-vad")
        let stream = args.contains("--stream")

        // Streaming live-caption mode: continuous audio in over stdin, incremental
        // confirmed/volatile transcripts out. Separate from the batch file path below.
        if stream {
            // --source mic|system|both (default mic). "system"/"both" capture system
            // output audio via ScreenCaptureKit inside this process.
            let source: String = {
                if let i = args.firstIndex(of: "--source"), i + 1 < args.count {
                    return args[i + 1]
                }
                return "mic"
            }()
            await runStream(useV2: useV2, source: source)
            return
        }

        // Silero VAD gates/trims each segment before ASR: drops segments with no
        // real speech (kills the coarse RMS gate's false-positives on noise, which
        // otherwise produce hallucinated text) and trims to speech bounds. Loaded
        // once; if it fails to load we transcribe the raw audio unchanged.
        let vad: VadManager? = noVad ? nil : (try? await VadManager(config: .default))

        do {
            if useSenseVoice {
                let models = try await SenseVoiceModels.downloadAndLoad(precision: .int8)
                emit("READY")
                while let line = readLine(strippingNewline: true) {
                    let trimmed = line.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                    if trimmed.isEmpty { continue }
                    let parts = trimmed.split(separator: "\t", maxSplits: 1, omittingEmptySubsequences: false)
                    let (langCode, path): (String?, String) = parts.count == 2
                        ? (String(parts[0]), String(parts[1]))
                        : (nil, trimmed)
                    if path.isEmpty { continue }
                    let language: Int32 = langCode.flatMap { Self.senseVoiceLang($0) } ?? 0
                    do {
                        guard let audio = await Self.prepareAudio(vad: vad, path: path) else {
                            emit("OK\t")
                            continue
                        }
                        let sv = SenseVoiceManager(models: models, language: language)
                        let text = try await sv.transcribe(audio: audio)
                            .replacingOccurrences(of: "\t", with: " ")
                            .replacingOccurrences(of: "\n", with: " ")
                            .trimmingCharacters(in: CharacterSet.whitespaces)
                        emit("OK\t\(text)")
                    } catch {
                        emit("ERR\t\(error.localizedDescription)")
                    }
                }
            } else {
                let models = try await (useV2
                    ? AsrModels.downloadAndLoad(version: .v2)
                    : AsrModels.downloadAndLoad(version: .v3))
                let asr = AsrManager(config: .default)
                try await asr.loadModels(models)
                emit("READY")
                while let line = readLine(strippingNewline: true) {
                    let trimmed = line.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                    if trimmed.isEmpty { continue }
                    let parts = trimmed.split(separator: "\t", maxSplits: 1, omittingEmptySubsequences: false)
                    let (langCode, path): (String?, String) = parts.count == 2
                        ? (String(parts[0]), String(parts[1]))
                        : (nil, trimmed)
                    if path.isEmpty { continue }
                    let language = langCode.flatMap { Language(rawValue: $0) }
                    do {
                        guard let audio = await Self.prepareAudio(vad: vad, path: path) else {
                            emit("OK\t")
                            continue
                        }
                        var decoderState = try TdtDecoderState()
                        let result = try await asr.transcribe(
                            audio, decoderState: &decoderState, language: language)
                        let text = result.text
                            .replacingOccurrences(of: "\t", with: " ")
                            .replacingOccurrences(of: "\n", with: " ")
                            .trimmingCharacters(in: CharacterSet.whitespaces)
                        emit("OK\t\(text)")
                    } catch {
                        emit("ERR\t\(error.localizedDescription)")
                    }
                }
            }
        } catch {
            emit("FATAL\t\(error.localizedDescription)")
            exit(1)
        }
    }

    /// Load the WAV at `path` (16kHz mono) and, when VAD is available, return only
    /// the speech regions concatenated. Returns:
    ///   - `nil`    → no usable speech detected; caller should emit an empty result.
    ///   - samples  → audio to transcribe (trimmed to speech, or the full clip when
    ///                VAD is unavailable or trimming left too little to transcribe).
    static func prepareAudio(vad: VadManager?, path: String) async -> [Float]? {
        let url = URL(fileURLWithPath: path)
        guard let full = try? loadSamples16k(url), !full.isEmpty else { return nil }
        guard let vad = vad else { return full }
        // ASR rejects clips shorter than ~0.3s; keep the full clip rather than throw.
        let minSamples = Int(Double(VadManager.sampleRate) * 0.3)
        do {
            let regions = try await vad.segmentSpeechAudio(full)
            let speech = regions.flatMap { $0 }
            if speech.isEmpty { return nil }
            return speech.count < minSamples ? full : speech
        } catch {
            return full
        }
    }

    /// Read a WAV file into 16kHz mono float samples. The Rust capture side now
    /// sends audio at the device's native rate (no resampling there), so the
    /// downsample to 16kHz happens here via FluidAudio's `AudioConverter`, which
    /// uses `AVAudioConverter` (properly anti-aliased) instead of naive linear
    /// interpolation.
    static func loadSamples16k(_ url: URL) throws -> [Float] {
        return try AudioConverter().resampleAudioFile(url)
    }

    // MARK: - Streaming mode

    private struct StreamUpdate: Encodable {
        let source: String
        let confirmed: String
        let vol: String
        enum CodingKeys: String, CodingKey {
            case source
            case confirmed
            case vol = "volatile"
        }
    }

    /// Emit one JSON line describing a source's transcript state. JSON lines start
    /// with '{', which the Rust side uses to distinguish them from control lines
    /// (READY / DONE / FATAL).
    private static func emitState(source: String, confirmed: String, vol: String) {
        let update = StreamUpdate(source: source, confirmed: confirmed, vol: vol)
        guard let data = try? JSONEncoder().encode(update),
              let json = String(data: data, encoding: .utf8) else { return }
        emit(json)
    }

    /// Wrap 16kHz mono float samples in an AVAudioPCMBuffer for `streamAudio`.
    private static func makeBuffer16k(_ samples: [Float]) -> AVAudioPCMBuffer? {
        guard !samples.isEmpty,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData else { return nil }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { p in
            if let base = p.baseAddress { channel[0].update(from: base, count: samples.count) }
        }
        return buffer
    }

    /// Spawn the per-source update relay: forwards confirmed/volatile to stdout.
    private static func relayUpdates(_ manager: SlidingWindowAsrManager, source: String) -> Task<Void, Never> {
        Task {
            let updates = await manager.transcriptionUpdates
            for await _ in updates {
                let confirmed = await manager.confirmedTranscript
                let vol = await manager.volatileTranscript
                emitState(source: source, confirmed: confirmed, vol: vol)
            }
        }
    }

    /// Read exactly `n` bytes from stdin, or return what was read before EOF (nil if
    /// nothing). Blocks until bytes are available.
    private static func readExact(_ n: Int) -> Data? {
        let handle = FileHandle.standardInput
        var buf = Data()
        buf.reserveCapacity(n)
        while buf.count < n {
            let chunk = handle.readData(ofLength: n - buf.count)
            if chunk.isEmpty { return buf.isEmpty ? nil : buf } // EOF
            buf.append(chunk)
        }
        return buf
    }

    /// Read one length-prefixed frame: 4-byte little-endian length, then payload.
    /// Returns nil on EOF, empty Data for a zero-length (keep-alive) frame.
    private static func readFrame() -> Data? {
        guard let lenData = readExact(4), lenData.count == 4 else { return nil }
        let len = UInt32(littleEndian: lenData.withUnsafeBytes { $0.load(as: UInt32.self) })
        if len == 0 { return Data() }
        return readExact(Int(len))
    }

    /// Streaming engine. Supports mic (audio pushed over stdin) and/or system audio
    /// (captured here via ScreenCaptureKit), each transcribed by its own stream and
    /// tagged in the JSON output.
    ///
    /// stdin protocol (length-prefixed frames, LE u32):
    ///   frame 0 : UTF8 "<sampleRate>\t<lang>" config (mic sample rate)
    ///   frame n : raw Float32 LE mono mic samples at <sampleRate>
    ///   EOF     : finish and emit the final transcripts
    static func runStream(useV2: Bool, source: String) async {
        let micActive = source != "system"
        let systemActive = source != "mic"
        do {
            // Load models once; share across both source streams.
            let models = try await (useV2
                ? AsrModels.downloadAndLoad(version: .v2)
                : AsrModels.downloadAndLoad(version: .v3))

            func makeStream(_ src: AudioSource) async throws -> SlidingWindowAsrManager {
                let m = SlidingWindowAsrManager(config: .default)
                try await m.loadModels(models)
                try await m.startStreaming(source: src)
                return m
            }

            let micMgr = micActive ? try await makeStream(.microphone) : nil
            let sysMgr = systemActive ? try await makeStream(.system) : nil

            // The config frame is always sent first (carries the mic sample rate).
            guard let cfgData = readFrame(),
                  let cfg = String(data: cfgData, encoding: .utf8) else {
                emit("FATAL\tmissing stream config frame")
                exit(1)
            }
            let rate = Double(cfg.split(separator: "\t").first ?? "16000") ?? 16000
            let micFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)

            // READY before starting system capture, so a Screen Recording permission
            // prompt can't stall the handshake.
            emit("READY")

            var updateTasks: [Task<Void, Never>] = []
            if let m = micMgr { updateTasks.append(relayUpdates(m, source: "mic")) }
            if let m = sysMgr { updateTasks.append(relayUpdates(m, source: "system")) }

            // System audio capture (Core Audio process tap) feeds the system stream.
            // A single consumer keeps buffers in order. `stopSystem` tears it down.
            var stopSystem: (() -> Void)?
            if let m = sysMgr {
                if #available(macOS 14.4, *) {
                    let cap = SystemAudioCapturer()
                    do {
                        try cap.start()
                        let feed = Task {
                            for await samples in cap.samples {
                                if let buf = makeBuffer16k(samples) { await m.streamAudio(buf) }
                            }
                        }
                        stopSystem = { cap.stop(); feed.cancel() }
                    } catch {
                        sysLog("sys: start failed: \(error.localizedDescription)")
                        emit("ERR\tsystem\t\(error.localizedDescription)")
                    }
                } else {
                    emit("ERR\tsystem\tsystem audio capture requires macOS 14.4+")
                }
            }

            // Pump mic audio frames from stdin until it closes. When mic is inactive
            // we still read (and ignore) so EOF reliably signals stop.
            while let frame = readFrame() {
                guard micActive, let m = micMgr, let format = micFormat, !frame.isEmpty else { continue }
                let count = frame.count / MemoryLayout<Float>.size
                guard count > 0,
                      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
                      let channel = buffer.floatChannelData else { continue }
                buffer.frameLength = AVAudioFrameCount(count)
                frame.withUnsafeBytes { raw in
                    if let base = raw.bindMemory(to: Float.self).baseAddress {
                        channel[0].update(from: base, count: count)
                    }
                }
                await m.streamAudio(buffer)
            }

            // EOF: stop system capture, flush each stream, emit finals.
            stopSystem?()
            if let m = micMgr {
                let finalText = try await m.finish()
                emitState(source: "mic", confirmed: finalText, vol: "")
            }
            if let m = sysMgr {
                let finalText = try await m.finish()
                emitState(source: "system", confirmed: finalText, vol: "")
            }
            updateTasks.forEach { $0.cancel() }
            emit("DONE")
        } catch {
            emit("FATAL\t\(error.localizedDescription)")
            exit(1)
        }
    }

    private static func senseVoiceLang(_ code: String) -> Int32? {
        switch code {
        case "zh": return 3
        case "en": return 4
        case "yue": return 7
        case "ja": return 11
        case "ko": return 12
        default: return nil
        }
    }
}
