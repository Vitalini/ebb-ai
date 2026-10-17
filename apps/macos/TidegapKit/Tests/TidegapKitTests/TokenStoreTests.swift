import Foundation
import Testing
@testable import TidegapKit

@Suite struct TokenStoreTests {
    let dir = tempDir().appendingPathComponent("Tidegap")

    func mode(_ url: URL) throws -> Int {
        (try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue ?? -1
    }

    @Test func writeIsPrivate() throws {
        let store = TokenStore(directory: dir)
        try store.write("tgc_abc\n")
        #expect(try mode(store.tokenURL) == 0o600)
        #expect(try mode(dir) == 0o700)
        #expect(store.read() == "tgc_abc")
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".tmp") }
        #expect(leftovers.isEmpty)
    }

    @Test func emptyOrMissingReadsNil() throws {
        let store = TokenStore(directory: dir)
        #expect(store.read() == nil)
        try store.write("  \n")
        #expect(store.read() == nil)
        store.delete()
        #expect(!FileManager.default.fileExists(atPath: store.tokenURL.path))
    }

    @Test func revokeMarkerRoundTrip() {
        let store = TokenStore(directory: dir)
        #expect(!store.isRevoked)
        store.markRevoked()
        #expect(TokenStore(directory: dir).isRevoked)
        store.clearRevoked()
        #expect(!store.isRevoked)
    }

    @Test(arguments: [
        ("0.19.0", true), ("v0.19.0-rc.1", true), ("0.19", true), ("1.0.0", true), ("0.20.1", true),
        ("0.18.9", false), ("0.18.0", false), ("abc", false), ("", false),
    ])
    func versionGate(version: String, supported: Bool) {
        #expect(TokenMinter.isSupported(version: version) == supported)
    }
}
