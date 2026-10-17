import Foundation

/// The client token in `~/Library/Application Support/Tidegap/client-token`
/// (mode 0600, atomic write; KTD2). A `client-token.revoked` marker records a
/// 401, so a revoke sticks across launches until the user clicks Reconnect.
public struct TokenStore: Sendable {
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public var tokenURL: URL { directory.appendingPathComponent("client-token") }
    private var revokedURL: URL { directory.appendingPathComponent("client-token.revoked") }

    public func read() -> String? {
        guard let data = try? Data(contentsOf: tokenURL) else { return nil }
        let token = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return token.isEmpty ? nil : token
    }

    public func write(_ token: String) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let tmp = directory.appendingPathComponent("client-token.\(UUID().uuidString).tmp")
        guard fm.createFile(atPath: tmp.path, contents: Data(token.utf8), attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        if rename(tmp.path, tokenURL.path) != 0 {
            try? fm.removeItem(at: tmp)
            throw CocoaError(.fileWriteUnknown)
        }
    }

    public func delete() {
        try? FileManager.default.removeItem(at: tokenURL)
    }

    public var isRevoked: Bool { FileManager.default.fileExists(atPath: revokedURL.path) }

    public func markRevoked() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        FileManager.default.createFile(atPath: revokedURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
    }

    public func clearRevoked() {
        try? FileManager.default.removeItem(at: revokedURL)
    }
}

public enum MintError: Error, Equatable {
    /// The CLI is older than 0.19 and has no `clients` command.
    case needsUpdate(version: String)
    case failed(String)
}

/// Mints a client token through `tidegap clients add` (KTD2, KTD12).
public enum TokenMinter {
    public static let minimumVersion = [0, 19, 0]

    /// "0.19.0" or "v0.19.0-rc.1" at or above 0.19.0.
    public static func isSupported(version: String) -> Bool {
        var v = version.trimmingCharacters(in: .whitespacesAndNewlines)
        if v.hasPrefix("v") { v.removeFirst() }
        let core = v.split(whereSeparator: { $0 == "-" || $0 == "+" }).first.map(String.init) ?? ""
        let parts = core.split(separator: ".").map { Int($0) ?? -1 }
        guard parts.count >= 2, !parts.contains(-1) else { return false }
        for (a, b) in zip(parts + [0, 0, 0], minimumVersion) where a != b {
            return a > b
        }
        return true
    }

    /// Checks `--version` first and mints nothing below 0.19. A repo build
    /// still carries the last released version until the release, so a lower
    /// version passes only when `clients list --json` works (it writes nothing).
    public static func mint(with launcher: ServerLauncher) async throws -> String {
        let versionOut = try await launcher.run(["--version"])
        let version = versionOut.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        if !isSupported(version: version) {
            let probe = try await launcher.run(["clients", "list", "--json"])
            if probe.status != 0 { throw MintError.needsUpdate(version: version) }
        }
        let out = try await launcher.run(["clients", "add", "--name", "Tidegap for Mac", "--kind", "macos", "--json"])
        if out.status != 0 {
            if out.stderr.contains("unknown command") { throw MintError.needsUpdate(version: version) }
            let line = out.stderr.split(separator: "\n").first.map(String.init) ?? "exit \(out.status)"
            throw MintError.failed(line)
        }
        guard let line = out.stdout.split(separator: "\n").last,
              let minted = try? Wire.decoder().decode(MintedClient.self, from: Data(line.utf8)),
              minted.token.hasPrefix("tgc_")
        else { throw MintError.failed("unexpected output from tidegap clients add") }
        return minted.token
    }
}
