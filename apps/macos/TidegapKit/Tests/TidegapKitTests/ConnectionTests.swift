import Foundation
import Testing
@testable import TidegapKit

@MainActor
@Suite struct ConnectionTests {
    let home = tempDir()
    let support = tempDir()
    let runner: FakeRunner
    let server = FakeServer()

    init() {
        runner = FakeRunner(home: home)
        runner.outputs["--version"] = CommandOutput(status: 0, stdout: "0.19.0\n")
        runner.outputs["clients add --name Tidegap for Mac --kind macos --json"] =
            CommandOutput(status: 0, stdout: #"{"client_id":"c1","token":"tgc_minted"}"# + "\n")
    }

    func controller() -> ConnectionController {
        let live = runner.live
        let discovery = Discovery(tidegapHome: home, isAlive: { live.contains($0) })
        let launcher = ServerLauncher(
            runner: runner, discovery: discovery,
            loginShell: { (path: "/usr/bin", tidegap: "/opt/homebrew/bin/tidegap") },
            isExecutable: { $0 == "/opt/homebrew/bin/tidegap" },
            startTimeout: 1, pollInterval: 0.01
        )
        let transport = server.transport
        return ConnectionController(
            store: TokenStore(directory: support), discovery: discovery, launcher: launcher,
            makeClient: { APIClient(port: $0, token: $1, transport: transport) }
        )
    }

    @Test func attachesToLiveServerWithoutSpawning() async {
        // AE5, first half.
        runner.live.add(4242)
        writeDiscovery(home: home, pid: 4242, port: 47999)
        server.set(port: 47999, status: 200)
        let c = controller()
        await c.connect()
        #expect(c.state == .connected(port: 47999, ownsServer: false))
        #expect(runner.spawns.isEmpty)
        #expect(runner.mintCalls == 1)
        #expect(TokenStore(directory: support).read() == "tgc_minted")
    }

    @Test func spawnsWhenNoDiscoveryAndStopsOnlyThatChild() async {
        // AE5, second half.
        server.set(port: 47931, status: 200)
        let c = controller()
        await c.connect()
        #expect(c.state == .connected(port: 47931, ownsServer: true))
        #expect(runner.spawns.count == 1)
        c.shutdown()
        #expect(runner.children[0].terminated == 1)
    }

    @Test func unauthorizedDropsTokenWithoutMinting() async throws {
        try TokenStore(directory: support).write("tgc_old")
        runner.live.add(4242)
        writeDiscovery(home: home, pid: 4242, port: 47999)
        server.set(port: 47999, status: 401)
        let c = controller()
        await c.connect()
        #expect(c.state == .revoked)
        #expect(runner.mintCalls == 0)
        #expect(TokenStore(directory: support).read() == nil)

        // The revoke sticks across a relaunch: a new controller mints nothing.
        let relaunched = controller()
        await relaunched.connect()
        #expect(relaunched.state == .revoked)
        #expect(runner.mintCalls == 0)

        server.set(port: 47999, status: 200)
        await relaunched.reconnect()
        #expect(relaunched.state == .connected(port: 47999, ownsServer: false))
        #expect(runner.mintCalls == 1)
    }

    @Test func oldCLIGivesUpdateStateAndNoMint() async {
        runner.outputs["--version"] = CommandOutput(status: 0, stdout: "0.18.0\n")
        let c = controller()
        await c.connect()
        #expect(c.state == .needsUpdate(version: "0.18.0"))
        #expect(runner.mintCalls == 0)
        #expect(c.state.lacksToken)
    }

    @Test func repoBuildWithOldVersionButClientsCommandMints() async {
        // Before the 0.19 release the repo build still reports 0.18.0.
        runner.outputs["--version"] = CommandOutput(status: 0, stdout: "0.18.0\n")
        runner.outputs["clients list --json"] = CommandOutput(status: 0, stdout: #"{"clients":[]}"#)
        server.set(port: 47931, status: 200)
        let c = controller()
        await c.connect()
        #expect(runner.mintCalls == 1)
        #expect(c.state == .connected(port: 47931, ownsServer: true))
    }

    @Test func externalServerStopsThenOwnChildAfterTwoFailedPolls() async {
        runner.live.add(4242)
        writeDiscovery(home: home, pid: 4242, port: 47999)
        server.set(port: 47999, status: 200)
        server.set(port: 47931, status: 200)
        let c = controller()
        await c.connect()
        #expect(c.state == .connected(port: 47999, ownsServer: false))

        // The external server quits: its pid dies and its ui.json goes away.
        server.set(port: 47999, status: nil)
        runner.live.remove(4242)
        try? FileManager.default.removeItem(at: home.appendingPathComponent("ui.json"))

        await c.refresh()
        #expect(runner.spawns.isEmpty)
        #expect(c.state == .offline("tidegap ui is not reachable"))
        await c.refresh()
        #expect(runner.spawns.count == 1)
        #expect(c.state == .connected(port: 47931, ownsServer: true))
        await c.refresh()
        #expect(runner.spawns.count == 1)
    }

    @Test func liveDiscoveryThatRefusesFallsBackToSpawn() async throws {
        try TokenStore(directory: support).write("tgc_old")
        runner.live.add(4242)
        writeDiscovery(home: home, pid: 4242, port: 47999)
        server.set(port: 47931, status: 200)
        let c = controller()
        await c.connect()
        #expect(c.state == .connected(port: 47931, ownsServer: true))
        #expect(runner.spawns.count == 1)
    }
}
