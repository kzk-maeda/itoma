// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ItomaStorage",
    products: [.library(name: "ItomaStorage", targets: ["ItomaStorage"])],
    dependencies: [.package(path: "../itoma-core")],
    targets: [
        .systemLibrary(name: "CSQLite", pkgConfig: "sqlite3", providers: [.apt(["libsqlite3-dev"]), .brew(["sqlite3"])]),
        .target(name: "ItomaStorage", dependencies: ["CSQLite", .product(name: "ItomaCore", package: "itoma-core")]),
        .testTarget(name: "ItomaStorageTests", dependencies: ["ItomaStorage", "CSQLite", .product(name: "ItomaCore", package: "itoma-core")]),
    ]
)
