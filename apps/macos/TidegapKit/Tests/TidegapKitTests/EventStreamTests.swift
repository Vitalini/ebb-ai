import Testing
@testable import TidegapKit

@Suite struct EventStreamTests {
    @Test func tasksEventGivesIds() {
        var p = SSEParser()
        let events = p.feed("event: tasks\ndata: {\"ids\":[\"a\",\"b\"]}\n\n")
        #expect(events.count == 1)
        #expect(events[0].taskIds == ["a", "b"])
    }

    @Test func keepAlivesAreIgnored() {
        var p = SSEParser()
        #expect(p.feed(": keep-alive\n\n").isEmpty)
        #expect(p.feed("event: hello\ndata: {}\n\n").map(\.event) == ["hello"])
    }

    @Test func splitChunksParse() {
        var p = SSEParser()
        #expect(p.feed("event: ta").isEmpty)
        #expect(p.feed("sks\ndata: {\"ids\":[\"x\"]").isEmpty)
        let events = p.feed("}\n\n")
        #expect(events.first?.taskIds == ["x"])
    }

    @Test func crlfLinesParse() {
        var p = SSEParser()
        let events = p.feed("event: tasks\r\ndata: {\"ids\":[\"c\"]}\r\n\r\n")
        #expect(events.first?.taskIds == ["c"])
    }
}
