// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ItomaCore",
    platforms: [.iOS("15.1"), .macOS(.v13)],
    products: [.library(name: "ItomaCore", targets: ["ItomaCore"]),
               .executable(name: "reflection-prototype-fixtures", targets: ["ReflectionPrototypeFixtures"])],
    targets: [
        .target(name: "ItomaCore"),
        .executableTarget(name: "ReflectionPrototypeFixtures", dependencies: ["ItomaCore"], path: "Tools/ReflectionPrototypeFixtures"),
        .testTarget(name: "ItomaCoreTests", dependencies: ["ItomaCore"]),
    ]
)
