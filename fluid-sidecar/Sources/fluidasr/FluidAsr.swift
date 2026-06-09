import Foundation
import AVFoundation
import FluidAudio

@main
struct FluidAsr {
    static func emit(_ s: String) {
        FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
    }

    static func main() async {
        setvbuf(stdout, nil, _IONBF, 0)
        let args = CommandLine.arguments
        let useV2 = args.contains("--v2")
        let useSenseVoice = args.contains("--sensevoice")
        let noVad = args.contains("--no-vad")
        let stream = args.contains("--stream")

        // Streaming live-caption mode: continuous audio in over stdin, incremental
        // confirmed/volatile transcripts out. Separate from the batch file path below.
        if stream {
            await runStream(useV2: useV2)
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
        let confirmed: String
        let vol: String
        enum CodingKeys: String, CodingKey {
            case confirmed
            case vol = "volatile"
        }
    }

    /// Emit one JSON line describing the current transcript state. JSON lines start
    /// with '{', which the Rust side uses to distinguish them from control lines
    /// (READY / DONE / FATAL).
    private static func emitState(confirmed: String, vol: String) {
        let update = StreamUpdate(confirmed: confirmed, vol: vol)
        guard let data = try? JSONEncoder().encode(update),
              let json = String(data: data, encoding: .utf8) else { return }
        emit(json)
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

    /// Streaming engine. Protocol on stdin (all frames length-prefixed, LE u32):
    ///   frame 0 : UTF8 "<sampleRate>\t<lang>" config
    ///   frame n : raw Float32 LE mono samples at <sampleRate>
    ///   EOF     : finish and emit the final confirmed transcript
    static func runStream(useV2: Bool) async {
        do {
            let models = try await (useV2
                ? AsrModels.downloadAndLoad(version: .v2)
                : AsrModels.downloadAndLoad(version: .v3))
            let manager = SlidingWindowAsrManager(config: .default)
            try await manager.loadModels(models)

            // First frame carries the source sample rate (the manager resamples to
            // 16kHz internally via AVAudioConverter).
            guard let cfgData = readFrame(),
                  let cfg = String(data: cfgData, encoding: .utf8) else {
                emit("FATAL\tmissing stream config frame")
                exit(1)
            }
            let rate = Double(cfg.split(separator: "\t").first ?? "16000") ?? 16000
            guard let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false) else {
                emit("FATAL\tbad sample rate \(rate)")
                exit(1)
            }

            try await manager.startStreaming(source: .microphone)
            emit("READY")

            // Forward incremental transcripts as they are produced.
            let updateTask = Task {
                let updates = await manager.transcriptionUpdates
                for await _ in updates {
                    let confirmed = await manager.confirmedTranscript
                    let vol = await manager.volatileTranscript
                    emitState(confirmed: confirmed, vol: vol)
                }
            }

            // Pump audio frames until stdin closes.
            while let frame = readFrame() {
                if frame.isEmpty { continue }
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
                await manager.streamAudio(buffer)
            }

            // EOF: flush remaining audio and emit the final transcript.
            let finalText = try await manager.finish()
            updateTask.cancel()
            emitState(confirmed: finalText, vol: "")
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
