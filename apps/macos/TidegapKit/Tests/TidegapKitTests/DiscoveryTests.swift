import Foundation
import Testing
@testable import TidegapKit

@Suite struct DiscoveryTests {
    @Test func liveOwnPidGivesServer() {
        let home = tempDir()
        let pid = ProcessInfo.processInfo.processIdentifier
        writeDiscovery(home: home, pid: pid, port: 47931)
        #expect(Discovery(tidegapHome: home).find() == DiscoveredServer(pid: pid, port: 47931))
    }

    @Test func deadPidGivesNone() {
        let home = tempDir()
        writeDiscovery(home: home, pid: 999_999, port: 47931)
        #expect(Discovery(tidegapHome: home).find() == nil)
    }

    @Test func missingOrCorruptFileGivesNone() throws {
        let home = tempDir()
        #expect(Discovery(tidegapHome: home).find() == nil)
        try Data("{not json".utf8).write(to: home.appendingPathComponent("ui.json"))
        #expect(Discovery(tidegapHome: home).find() == nil)
        try Data(#"{"version":2,"pid":1,"port":47931}"#.utf8).write(to: home.appendingPathComponent("ui.json"))
        #expect(Discovery(tidegapHome: home).read() == nil)
    }
}
