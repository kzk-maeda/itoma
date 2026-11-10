// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ItomaStorage",
    platforms: [.iOS("15.1"), .macOS(.v13)],
    products: [
        .library(name: "ItomaStorage", targets: ["ItomaStorage"]),
        .library(name: "ItomaHistory", targets: ["ItomaHistory"]),
        .executable(name: "reflection-record-fixtures", targets: ["ReflectionRecordFixtures"]),
    ],
    dependencies: [.package(path: "../itoma-core")],
    targets: [
        .systemLibrary(name: "CSQLite", pkgConfig: "sqlite3", providers: [.apt(["libsqlite3-dev"]), .brew(["sqlite3"])]),
        .target(name: "ItomaSQLite", dependencies: ["CSQLite"]),
        .target(name: "ItomaStorage", dependencies: ["ItomaSQLite", .product(name: "ItomaCore", package: "itoma-core")]),
        .target(name: "ItomaHistory", dependencies: ["ItomaSQLite", "ItomaStorage", .product(name: "ItomaCore", package: "itoma-core")]),
        .executableTarget(name: "ReflectionRecordFixtures",
            dependencies: ["ItomaHistory", "ItomaStorage", .product(name: "ItomaCore", package: "itoma-core")],
            path: "Tools/ReflectionRecordFixtures"),
        .testTarget(name: "ItomaSQLiteTests", dependencies: ["ItomaSQLite"]),
        .testTarget(name: "ItomaStorageTests", dependencies: ["ItomaStorage", "CSQLite", .product(name: "ItomaCore", package: "itoma-core")]),
        .testTarget(name: "ItomaHistoryTests", dependencies: ["ItomaHistory", "ItomaStorage", "CSQLite", .product(name: "ItomaCore", package: "itoma-core")]),
    ]
)
