import Foundation
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
                        let sv = SenseVoiceManager(models: models, language: language)
                        let text = try await sv.transcribe(audioURL: URL(fileURLWithPath: path))
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
                        var decoderState = try TdtDecoderState()
                        let result = try await asr.transcribe(
                            URL(fileURLWithPath: path), decoderState: &decoderState, language: language)
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
