import Darwin
import Foundation

/// A `tidegap ui` server named by a discovery file whose pid is alive.
public struct DiscoveredServer: Equatable, Sendable {
    public let pid: Int32
    public let port: Int

    public init(pid: Int32, port: Int) {
        self.pid = pid
        self.port = port
    }
}

/// Reads `<tidegap home>/ui.json` (native clients KTD4). A file left by a
/// crash names a dead pid, so the pid is checked before the port is trusted.
public struct Discovery: Sendable {
    public let tidegapHome: URL
    public let isAlive: @Sendable (Int32) -> Bool

    public init(tidegapHome: URL, isAlive: @escaping @Sendable (Int32) -> Bool = Discovery.pidAlive) {
        self.tidegapHome = tidegapHome
        self.isAlive = isAlive
    }

    public var fileURL: URL { tidegapHome.appendingPathComponent("ui.json") }

    /// The record, or nil when the file is missing, corrupt or another version.
    public func read() -> DiscoveryRecord? {
        guard let data = try? Data(contentsOf: fileURL),
              let record = try? Wire.decoder().decode(DiscoveryRecord.self, from: data),
              record.version == 1, record.pid > 0, (1...65535).contains(record.port)
        else { return nil }
        return record
    }

    /// The live server, or nil.
    public func find() -> DiscoveredServer? {
        guard let record = read(), isAlive(record.pid) else { return nil }
        return DiscoveredServer(pid: record.pid, port: record.port)
    }

    /// `kill(pid, 0)`: 0 or EPERM means the process exists.
    public static let pidAlive: @Sendable (Int32) -> Bool = { pid in
        guard pid > 0 else { return false }
        return kill(pid, 0) == 0 || errno == EPERM
    }
}
