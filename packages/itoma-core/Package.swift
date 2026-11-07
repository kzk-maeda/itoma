// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ItomaCore",
    platforms: [.iOS("15.1"), .macOS(.v13)],
    products: [.library(name: "ItomaCore", targets: ["ItomaCore"])],
    targets: [
        .target(name: "ItomaCore"),
        .testTarget(name: "ItomaCoreTests", dependencies: ["ItomaCore"]),
    ]
)
