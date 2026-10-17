// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TidegapKit",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TidegapKit", targets: ["TidegapKit"]),
    ],
    targets: [
        .target(name: "TidegapKit"),
        .testTarget(name: "TidegapKitTests", dependencies: ["TidegapKit"]),
    ],
    swiftLanguageModes: [.v5]
)
