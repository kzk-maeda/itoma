// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ItomaCore",
    products: [.library(name: "ItomaCore", targets: ["ItomaCore"])],
    targets: [
        .target(name: "ItomaCore"),
        .testTarget(name: "ItomaCoreTests", dependencies: ["ItomaCore"]),
    ]
)
