// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Issue155ControlRetention",
    dependencies: [
        .package(path: "../../packages/itoma-core"),
        .package(path: "../../packages/itoma-storage"),
        .package(path: "../../packages/itoma-control"),
    ],
    targets: [
        .executableTarget(name: "RetentionBench", dependencies: [
            .product(name: "ItomaCore", package: "itoma-core"),
            .product(name: "ItomaStorage", package: "itoma-storage"),
            .product(name: "ItomaControl", package: "itoma-control"), "CSQLiteBench",
        ]),
        .systemLibrary(name: "CSQLiteBench", pkgConfig: "sqlite3"),
    ]
)
