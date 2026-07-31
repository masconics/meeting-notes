// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "fluidasr",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.15.5")
    ],
    targets: [
        .executableTarget(
            name: "fluidasr",
            dependencies: ["FluidAudio"]
        )
    ]
)
