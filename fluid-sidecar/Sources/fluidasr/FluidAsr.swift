// Persistent FluidAudio ASR sidecar.
//
// Loads Parakeet TDT v3 (Core ML, runs on the Apple Neural Engine) once, then
// serves transcription requests over stdin/stdout so the model stays resident
// across the app's VAD segments. Protocol (line-based, UTF-8):
//   <- "READY"                  once models are loaded
//   -> "<absolute wav path>"    one request per line
//   <- "OK\t<transcript>"       success (tabs/newlines in text are spaced out)
//   <- "ERR\t<message>"         per-request failure
// A fatal startup error prints "FATAL\t<message>" and exits non-zero.

import Foundation
import FluidAudio

@main
struct FluidAsr {
    static func emit(_ s: String) {
        FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
    }

    static func main() async {
        setvbuf(stdout, nil, _IONBF, 0) // unbuffered: Rust reads responses immediately
        let useV2 = CommandLine.arguments.contains("--v2")
        do {
            let models = try await (useV2
                ? AsrModels.downloadAndLoad(version: .v2)
                : AsrModels.downloadAndLoad(version: .v3))
            let asr = AsrManager(config: .default)
            try await asr.loadModels(models)
            emit("READY")

            while let line = readLine(strippingNewline: true) {
                let path = line.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
                if path.isEmpty { continue }
                do {
                    // Fresh decoder state per segment — each VAD segment is independent.
                    var decoderState = try TdtDecoderState()
                    let result = try await asr.transcribe(
                        URL(fileURLWithPath: path), decoderState: &decoderState)
                    let text = result.text
                        .replacingOccurrences(of: "\t", with: " ")
                        .replacingOccurrences(of: "\n", with: " ")
                        .trimmingCharacters(in: CharacterSet.whitespaces)
                    emit("OK\t\(text)")
                } catch {
                    emit("ERR\t\(error.localizedDescription)")
                }
            }
        } catch {
            emit("FATAL\t\(error.localizedDescription)")
            exit(1)
        }
    }
}
