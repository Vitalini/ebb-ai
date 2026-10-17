import Foundation
import Testing
@testable import TidegapKit

@Suite struct APIClientTests {
    func client(status: Int?) -> (APIClient, FakeServer) {
        let server = FakeServer()
        server.set(port: 47931, status: status)
        return (APIClient(port: 47931, token: "tgc_x", transport: server.transport), server)
    }

    @Test func okDecodesAndSendsBearer() async {
        let (api, server) = client(status: 200)
        let result = await api.summary(since: "2026-10-17T09:00:00.000Z")
        #expect(result.value?.region == "FR")
        #expect(server.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer tgc_x")
        #expect(server.requests.first?.url?.query == "since=2026-10-17T09:00:00.000Z")
    }

    @Test func statusesMapToOutcomes() async {
        #expect(await client(status: nil).0.summary(since: nil) == .offline)
        #expect(await client(status: 401).0.summary(since: nil) == .unpaired)
        #expect(await client(status: 500).0.summary(since: nil) == .error("internal error"))
    }

    @Test func refusedRealConnectionIsOffline() async {
        // Port 1 on loopback: nothing listens, the real URLSession is refused.
        let result = await APIClient(port: 1, token: "tgc_x").summary(since: nil)
        #expect(result == .offline)
    }

    @Test func quickAddBodyHasOnlyPromptAndDeadline() throws {
        // Covers R3.
        let body = APIClient.quickAddBody(prompt: "Summarize logs", deadline: date("2026-10-18T10:00:00Z"))
        let object = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        #expect(Set(object?.keys ?? [:].keys) == ["prompt", "deadline"])
        #expect(object?["deadline"] as? String == "2026-10-18T10:00:00.000Z")
    }

    @Test func quickAddPostsJSON() async {
        let (api, server) = client(status: 500)
        _ = await api.quickAdd(prompt: "x", deadline: date("2026-10-18T10:00:00Z"))
        let req = server.requests.first
        #expect(req?.httpMethod == "POST")
        #expect(req?.url?.path == "/api/tasks")
        #expect(req?.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }
}
