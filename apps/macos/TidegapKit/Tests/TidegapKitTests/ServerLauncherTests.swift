import Foundation
import Testing
@testable import TidegapKit

@Suite struct ServerLauncherTests {
    func launcher(
        runner: FakeRunner,
        home: URL = tempDir(),
        shell: (String?, String?) = ("/login/bin:/usr/bin", nil),
        executables: Set<String> = [],
        live: LivePids = LivePids()
    ) -> ServerLauncher {
        ServerLauncher(
            runner: runner,
            discovery: Discovery(tidegapHome: home, isAlive: { live.contains($0) }),
            loginShell: { (path: shell.0, tidegap: shell.1) },
            isExecutable: { executables.contains($0) },
            baseEnvironment: ["PATH": "/usr/bin:/bin", "HOME": "/Users/test"],
            startTimeout: 1,
            pollInterval: 0.01
        )
    }

    @Test func overrideWins() async {
        let l = launcher(runner: FakeRunner(), shell: ("/login/bin", "/login/bin/tidegap"),
                         executables: ["/login/bin/node", "/login/bin/tidegap"])
        l.commandOverride = ["node", "/repo/packages/cli/dist/index.js"]
        #expect(await l.resolveCommand() == ["/login/bin/node", "/repo/packages/cli/dist/index.js"])
    }

    @Test func loginShellLookupIsNext() async {
        let l = launcher(runner: FakeRunner(), shell: ("/login/bin", "/login/bin/tidegap"),
                         executables: ["/login/bin/tidegap", "/opt/homebrew/bin/tidegap"])
        #expect(await l.resolveCommand() == ["/login/bin/tidegap"])
    }

    @Test func knownPathsAreLast() async {
        let l = launcher(runner: FakeRunner(), shell: (nil, nil), executables: ["/Users/test/.volta/bin/tidegap"])
        #expect(await l.resolveCommand() == ["/Users/test/.volta/bin/tidegap"])
    }

    @Test func nothingFoundIsNotFound() async {
        let l = launcher(runner: FakeRunner(), shell: (nil, nil))
        #expect(await l.resolveCommand() == nil)
        await #expect(throws: LaunchError.tidegapNotFound) { try await l.run(["--version"]) }
    }

    @Test func childGetsLoginPathAndArgvWithoutShell() async throws {
        let home = tempDir()
        let runner = FakeRunner(home: home)
        let l = launcher(runner: runner, home: home, executables: ["/opt/homebrew/bin/tidegap"], live: runner.live)
        l.port = 47931
        let server = try await l.start()
        #expect(server.port == 47931)
        #expect(runner.spawns == [["/opt/homebrew/bin/tidegap", "ui", "--no-open", "--port", "47931"]])
        let path = runner.environments.last?["PATH"] ?? ""
        #expect(path.hasPrefix("/opt/homebrew/bin:/login/bin:/usr/bin"))
        #expect(!runner.spawns[0].contains { $0.contains("-c") })
    }

    @Test func terminatesOnlyItsOwnChild() async throws {
        // AE5: an external server named by ui.json is never touched.
        let home = tempDir()
        let runner = FakeRunner(home: home)
        let external = FakeProcess(pid: 4242)
        runner.live.add(external.pid)
        writeDiscovery(home: home, pid: external.pid, port: 47821)
        let l = launcher(runner: runner, home: home, executables: ["/opt/homebrew/bin/tidegap"], live: runner.live)
        l.stop()
        #expect(external.terminated == 0)
        _ = try await l.start()
        l.stop()
        #expect(runner.children.count == 1)
        #expect(runner.children[0].terminated == 1)
        #expect(external.terminated == 0)
    }

    @Test func startTimesOutWhenNoDiscoveryAppears() async {
        let runner = FakeRunner(home: nil)
        let l = launcher(runner: runner, executables: ["/opt/homebrew/bin/tidegap"], live: runner.live)
        await #expect(throws: LaunchError.startTimedOut) { try await l.start() }
        #expect(runner.children.first?.terminated == 1)
    }

    @Test func splitsSettingsCommandLine() {
        #expect(CommandLineSplitter.split(#"node "/my repo/dist/index.js""#) == ["node", "/my repo/dist/index.js"])
        #expect(CommandLineSplitter.split("  a  'b c'  d\\ e ") == ["a", "b c", "d e"])
        #expect(CommandLineSplitter.split("") == [])
    }
}
