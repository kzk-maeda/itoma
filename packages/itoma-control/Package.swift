// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ItomaControl",
    products: [.library(name: "ItomaControl", targets: ["ItomaControl"])],
    dependencies: [.package(path: "../itoma-core"), .package(path: "../itoma-storage")],
    targets: [
        .target(name: "ItomaControl", dependencies: [
            .product(name: "ItomaCore", package: "itoma-core"), .product(name: "ItomaStorage", package: "itoma-storage"),
        ]),
        .testTarget(name: "ItomaControlTests", dependencies: ["ItomaControl", "CSQLiteTest", .product(name: "ItomaCore", package: "itoma-core"), .product(name: "ItomaStorage", package: "itoma-storage")]),
        .systemLibrary(name: "CSQLiteTest", pkgConfig: "sqlite3"),
    ]
)
