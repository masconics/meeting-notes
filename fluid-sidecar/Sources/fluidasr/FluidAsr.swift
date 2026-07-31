import Foundation
import AVFoundation
import CoreGraphics
import CoreAudio
import NaturalLanguage
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
    var onLevel: ((Float) -> Void)?

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
            onLevel?(peak)
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

/// Gates a live capture to speech regions using Silero VAD, so the recognizer
/// mostly sees speech. Without it, silence/noise/music flows into ASR and —
/// because the streaming confirmation gates are zeroed (see `liveConfig`) — any
/// hallucinated text decoded from non-speech audio is promoted into the
/// permanent transcript.
///
/// Tuned for live mic use: thresholds are deliberately permissive, hangover is
/// long, and frames with clear acoustic energy still pass even when VAD is
/// unsure. An earlier 0.5 enter threshold with no energy fallback dropped real
/// speech (especially quieter mics) and produced "levels move, no text".
/// Fail-open: if the VAD errors or is unavailable, audio flows through unchanged.
final class SpeechGate: @unchecked Sendable {
    private var vad: VadManager?
    private var state = VadStreamState.initial()
    private var pending: [Float] = []
    private var preroll: [[Float]] = []
    private var inSpeech = false
    private var silenceRun = 0
    private var disabled = false
    private var passedFrames = 0
    private var droppedFrames = 0

    private let frameSize = VadManager.chunkSize // 4096 samples (256ms @16kHz)
    private let hangoverFrames: Int
    private let prerollFrames: Int
    private let enterThreshold: Float
    private let softEnterThreshold: Float
    private let exitThreshold: Float
    private let energyFloor: Float

    /// - Parameter sensitive: mic capture — user is intentionally speaking, so
    ///   prefer letting borderline frames through. System audio stays stricter
    ///   to keep music/noise from hallucinating into the transcript.
    init(vad: VadManager?, sensitive: Bool = false) {
        self.vad = vad
        self.disabled = vad == nil
        if sensitive {
            hangoverFrames = 8
            prerollFrames = 4
            enterThreshold = 0.28
            softEnterThreshold = 0.12
            exitThreshold = 0.08
            energyFloor = 0.008
        } else {
            hangoverFrames = 6
            prerollFrames = 3
            enterThreshold = 0.35
            softEnterThreshold = 0.18
            exitThreshold = 0.12
            energyFloor = 0.012
        }
    }

    private func peak(of frame: [Float]) -> Float {
        var p: Float = 0
        for s in frame { let a = abs(s); if a > p { p = a } }
        return p
    }

    /// Push 16kHz mono samples; returns the chunks that should reach the
    /// recognizer (empty while in silence). Chunks are 4096 samples, except a
    /// flushed pre-roll keeps its original frame boundaries.
    func push(_ samples: [Float]) async -> [[Float]] {
        guard !disabled, let vad = vad else { return samples.isEmpty ? [] : [samples] }
        pending.append(contentsOf: samples)
        var out: [[Float]] = []
        while pending.count >= frameSize {
            let frame = Array(pending.prefix(frameSize))
            pending.removeFirst(frameSize)
            do {
                let result = try await vad.processStreamingChunk(frame, state: state)
                state = result.state
                let p = result.probability
                let energetic = peak(of: frame) >= energyFloor
                // Firm VAD hit, or energetic audio where VAD is only unsure —
                // never require a high VAD score when the mic clearly has signal.
                let speechNow = p >= enterThreshold || (energetic && p >= softEnterThreshold)

                if speechNow {
                    if !inSpeech {
                        inSpeech = true
                        out.append(contentsOf: preroll)
                        passedFrames += preroll.count
                        preroll.removeAll()
                        sysLog("vad: speech start (p=\(String(format: "%.2f", p)), energy=\(energetic))")
                    }
                    silenceRun = 0
                    out.append(frame)
                    passedFrames += 1
                } else if inSpeech {
                    if p < exitThreshold && !energetic { silenceRun += 1 } else { silenceRun = 0 }
                    if silenceRun > hangoverFrames {
                        inSpeech = false
                        silenceRun = 0
                        preroll = [frame]
                        droppedFrames += 1
                        sysLog("vad: speech end (passed=\(passedFrames), dropped=\(droppedFrames))")
                    } else {
                        out.append(frame)
                        passedFrames += 1
                    }
                } else {
                    droppedFrames += 1
                    preroll.append(frame)
                    if preroll.count > prerollFrames {
                        preroll.removeFirst(preroll.count - prerollFrames)
                    }
                }
            } catch {
                disabled = true
                sysLog("vad: gate disabled after error: \(error.localizedDescription)")
                var rest = frame
                rest.append(contentsOf: pending)
                pending.removeAll()
                out.append(rest)
                break
            }
        }
        return out
    }
}

/// Captures the default input device (mic) with AVAudioEngine and exposes it as
/// 16kHz mono float chunks — the mirror of `SystemAudioCapturer`, so both sources
/// now live in this one process (the Rust side no longer runs cpal or ships audio
/// over stdin).
///
/// Voice processing (Apple AEC) is opt-in per session: when system audio plays
/// through the speakers and bleeds back into the mic, the echo canceller removes
/// it using the system render as reference. That stops the "both" mode from
/// transcribing the same speech twice (once from the tap, once from the mic).
/// The cost is that macOS treats a voice-processed session like a call and ducks
/// all other audio — even at the minimum ducking level there can be a slight dip.
/// So mic-only sessions (no system tap, no double-transcription risk) skip AEC
/// entirely and leave playback completely untouched. If voice processing can't
/// be enabled we fall back to a plain capture so the mic still works.
final class MicAudioCapturer: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let converter = AudioConverter() // defaults to 16kHz mono
    private let enableAEC: Bool
    let samples: AsyncStream<[Float]>
    private let continuation: AsyncStream<[Float]>.Continuation
    private var bufferCount = 0
    private var blockPeak: Float = 0
    var onLevel: ((Float) -> Void)?

    init(enableAEC: Bool) {
        self.enableAEC = enableAEC
        var cont: AsyncStream<[Float]>.Continuation!
        self.samples = AsyncStream(bufferingPolicy: .unbounded) { cont = $0 }
        self.continuation = cont
    }

    func start() throws {
        let input = engine.inputNode

        // Echo cancellation. Must be set before the engine starts; it can change the
        // node's stream format, so read the tap format *after* enabling it. Treated
        // as best-effort — a failure here just means no AEC, not a dead mic.
        var aec = false
        if enableAEC {
            do {
                try input.setVoiceProcessingEnabled(true)
                aec = true
                // Voice processing ducks all other system audio by default, so
                // starting a recording made any playing audio fade and warp. Keep
                // the echo canceller but turn the ducking down to its minimum,
                // with the dynamic "advanced" ducking (the pumping/slowed-down
                // effect) disabled.
                input.voiceProcessingOtherAudioDuckingConfiguration = .init(
                    enableAdvancedDucking: false,
                    duckingLevel: .min
                )
            } catch {
                sysLog("mic: voice processing (AEC) unavailable: \(error.localizedDescription)")
            }
        }

        let tapFormat = input.outputFormat(forBus: 0)
        sysLog("mic: capture \(Int(tapFormat.sampleRate))Hz, \(tapFormat.channelCount)ch, AEC \(aec)")

        input.installTap(onBus: 0, bufferSize: 4096, format: tapFormat) { [weak self] buffer, _ in
            self?.handle(buffer)
        }
        engine.prepare()
        try engine.start()
        sysLog("mic: capture started")
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        continuation.finish()
        sysLog("mic: stopped after \(bufferCount) buffers")
    }

    private func handle(_ buffer: AVAudioPCMBuffer) {
        guard buffer.frameLength > 0 else { return }
        do {
            let out = try converter.resampleBuffer(buffer)
            guard !out.isEmpty else { return }
            bufferCount += 1
            var peak: Float = 0
            for s in out { let a = abs(s); if a > peak { peak = a } }
            onLevel?(peak)
            if peak > blockPeak { blockPeak = peak }
            if bufferCount == 1 { sysLog("mic: first audio block (\(out.count) samples @16k), peak \(peak)") }
            else if bufferCount % 200 == 0 {
                sysLog("mic: \(bufferCount) blocks, peak(window) \(blockPeak)")
                blockPeak = 0
            }
            continuation.yield(out)
        } catch {
            sysLog("mic: resample failed: \(error.localizedDescription)")
        }
    }
}

@main
struct FluidAsr {
    static func emit(_ s: String) {
        // Leading newline: CoreML/E5RT sometimes prints diagnostics to stdout
        // without a trailing newline, which would otherwise glue itself onto our
        // protocol line. The Rust readers skip blank lines.
        FileHandle.standardOutput.write(("\n" + s + "\n").data(using: .utf8)!)
    }

    static func progressPhase(_ phase: DownloadPhase) -> String {
        switch phase {
        case .listing:
            return "listing"
        case .downloading:
            return "downloading"
        case .compiling:
            return "compiling"
        }
    }

    static func emitProgress(_ progress: DownloadProgress) {
        let fraction = min(1.0, max(0.0, progress.fractionCompleted))
        emit("PROGRESS\t\(String(format: "%.4f", fraction))\t\(progressPhase(progress.phase))")
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

        // Embedding mode: read text lines from stdin, output Float vectors as
        // JSON arrays. Uses Apple's built-in NLEmbedding (zero download, on-device).
        if args.contains("--embed") {
            guard let embedding = NLEmbedding.sentenceEmbedding(for: .english) else {
                emit("FATAL\tNLEmbedding not available on this system")
                exit(1)
            }
            sysLog("embed: ready, dimension=\(embedding.dimension)")
            emit("READY")

            while let text = readLine() {
                guard let vec = embedding.vector(for: text), !vec.isEmpty else {
                    emit("[]")
                    continue
                }
                guard let data = try? JSONEncoder().encode(vec),
                      let json = String(data: data, encoding: .utf8) else {
                    emit("[]")
                    continue
                }
                emit(json)
            }
            return
        }

        let useV2 = args.contains("--v2")
        let useSenseVoice = args.contains("--sensevoice")
        let noVad = args.contains("--no-vad")
        let stream = args.contains("--stream")
        let downloadOnly = args.contains("--download-only")

        let progressHandler: ProgressHandler = { progress in
            emitProgress(progress)
        }

        if downloadOnly {
            do {
                _ = try await AsrModels.download(version: useV2 ? .v2 : .v3, encoderPrecision: .int4, progressHandler: progressHandler)
                emit("READY")
            } catch {
                emit("FATAL\t\(error.localizedDescription)")
                exit(1)
            }
            return
        }

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
                let models = try await SenseVoiceModels.downloadAndLoad(precision: .int8, progressHandler: progressHandler)
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
                        emit("INFO\tduration=\(String(format: "%.1f", Double(audio.count) / 16000.0))")
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
                    ? AsrModels.downloadAndLoad(version: .v2, progressHandler: progressHandler)
                    : AsrModels.downloadAndLoad(version: .v3, encoderPrecision: .int4, progressHandler: progressHandler))
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
                        // Duration hint: lets the Rust side scale its request
                        // timeout to the audio length (long imports take minutes).
                        emit("INFO\tduration=\(String(format: "%.1f", Double(audio.count) / 16000.0))")
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
            let progressHandler: ProgressHandler = { progress in
                emitProgress(progress)
            }

            // Load models once; share across both source streams.
            let models = try await (useV2
                ? AsrModels.downloadAndLoad(version: .v2, progressHandler: progressHandler)
                : AsrModels.downloadAndLoad(version: .v3, encoderPrecision: .int4, progressHandler: progressHandler))

            // Silero VAD for the per-source speech gates. Lower threshold than
            // VadConfig.default (0.85) — that value is for batch segmentation and
            // was dropping real mic speech in live mode. Fail-open if load fails.
            let streamVad: VadManager? = try? await VadManager(
                config: VadConfig(defaultThreshold: 0.45)
            )
            if streamVad == nil { sysLog("stream: VAD unavailable, speech gating off") }

            // Window sizing: encoder input is fixed at 15s. Prefer FluidAudio's
            // 2s left-context streaming shape for latency, with a 4s center chunk
            // so the first caption appears after ~5s of gated audio (chunk+right)
            // instead of the library default's ~13s.
            //
            // Confirmation gates are zeroed deliberately: the manager *drops* a
            // window's text when it isn't promoted to confirmed (the next window
            // overwrites volatile), so any non-zero confidence threshold loses
            // words whenever a window decodes below it. Promoting every window
            // keeps the transcript lossless; the UI renders confirmed+volatile
            // the same way regardless. SpeechGate keeps non-speech audio out.
            let liveConfig = SlidingWindowAsrConfig(
                chunkSeconds: 4.0,
                hypothesisChunkSeconds: 1.0,
                leftContextSeconds: 9.0,
                rightContextSeconds: 1.0,
                minContextForConfirmation: 0.0,
                confirmationThreshold: 0.0
            )
            func makeStream(_ src: AudioSource) async throws -> SlidingWindowAsrManager {
                let m = SlidingWindowAsrManager(config: liveConfig)
                try await m.loadModels(models)
                try await m.startStreaming(source: src)
                return m
            }

            let micMgr = micActive ? try await makeStream(.microphone) : nil
            let sysMgr = systemActive ? try await makeStream(.system) : nil

            // The config frame is always sent first. Mic is now captured in-process
            // (AVAudioEngine, below) rather than streamed over stdin, so the frame's
            // sample-rate field is vestigial; we still read it to stay in sync with
            // the Rust handshake and to consume the language field.
            guard readFrame() != nil else {
                emit("FATAL\tmissing stream config frame")
                exit(1)
            }

            // READY before starting capture, so a permission prompt can't stall the
            // handshake.
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
                    cap.onLevel = { peak in
                        emit("{\"source\":\"system\",\"rms\":\(peak)}")
                    }
                    do {
                        try cap.start()
                        let gate = SpeechGate(vad: streamVad, sensitive: false)
                        let feed = Task {
                            for await samples in cap.samples {
                                for chunk in await gate.push(samples) {
                                    if let buf = makeBuffer16k(chunk) { await m.streamAudio(buf) }
                                }
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

            // Mic audio capture feeds the mic stream, mirroring the system tap
            // above. AEC only when the system tap is also live ("both"), where it
            // prevents speaker bleed from being transcribed twice; mic-only skips
            // it so other playing audio is never ducked.
            var stopMic: (() -> Void)?
            if let m = micMgr {
                let cap = MicAudioCapturer(enableAEC: systemActive)
                cap.onLevel = { peak in
                    emit("{\"source\":\"mic\",\"rms\":\(peak)}")
                }
                do {
                    try cap.start()
                    let gate = SpeechGate(vad: streamVad, sensitive: true)
                    let feed = Task {
                        for await samples in cap.samples {
                            for chunk in await gate.push(samples) {
                                if let buf = makeBuffer16k(chunk) { await m.streamAudio(buf) }
                            }
                        }
                    }
                    stopMic = { cap.stop(); feed.cancel() }
                } catch {
                    sysLog("mic: start failed: \(error.localizedDescription)")
                    emit("ERR\tmic\t\(error.localizedDescription)")
                }
            }

            // Block until stdin closes — that's how the Rust side signals "stop". No
            // audio rides on stdin anymore; we just drain frames until EOF.
            while readFrame() != nil { continue }

            // EOF: stop system capture, flush each stream, emit finals.
            // Don't use finish()'s return value: it re-decodes ALL accumulated
            // tokens in one pass, producing text that differs from the incremental
            // per-chunk decode we've been streaming. The frontend appends by
            // prefix-delta against the streamed text, so a divergent final would
            // be appended wholesale (duplicated transcript). Instead emit the
            // streamed confirmed text plus the leftover volatile tail — finish()
            // still runs first so the remaining buffered audio gets flushed into
            // that state.
            func finalState(_ m: SlidingWindowAsrManager) async -> String {
                let confirmed = await m.confirmedTranscript
                let vol = await m.volatileTranscript
                if vol.isEmpty { return confirmed }
                return confirmed.isEmpty ? vol : confirmed + " " + vol
            }
            stopMic?()
            stopSystem?()
            // Flush both streams, then cancel the relays *before* emitting finals so
            // a late relay update can't land after (and get re-appended over) them.
            if let m = micMgr { _ = try await m.finish() }
            if let m = sysMgr { _ = try await m.finish() }
            updateTasks.forEach { $0.cancel() }
            if let m = micMgr {
                emitState(source: "mic", confirmed: await finalState(m), vol: "")
            }
            if let m = sysMgr {
                emitState(source: "system", confirmed: await finalState(m), vol: "")
            }
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
