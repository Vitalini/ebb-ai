import Foundation

public struct SSEEvent: Equatable, Sendable {
    public var event: String
    public var data: String

    public init(event: String, data: String) {
        self.event = event
        self.data = data
    }

    /// The ids of a `tasks` event.
    public var taskIds: [String]? {
        guard event == "tasks" else { return nil }
        struct Body: Decodable { let ids: [String] }
        return (try? JSONDecoder().decode(Body.self, from: Data(data.utf8)))?.ids
    }
}

/// Incremental server-sent-events parser. Chunks may split lines anywhere;
/// comment lines (`: keep-alive`) are ignored.
public struct SSEParser: Sendable {
    private var buffer = ""
    private var event = ""
    private var data: [String] = []

    public init() {}

    public mutating func feed(_ chunk: String) -> [SSEEvent] {
        buffer += chunk
        var out: [SSEEvent] = []
        while let newline = buffer.firstIndex(where: { $0 == "\n" || $0 == "\r\n" || $0 == "\r" }) {
            let line = String(buffer[..<newline])
            buffer.removeSubrange(...newline)
            if line.isEmpty {
                if !data.isEmpty || !event.isEmpty {
                    out.append(SSEEvent(event: event.isEmpty ? "message" : event, data: data.joined(separator: "\n")))
                }
                event = ""
                data = []
            } else if line.hasPrefix(":") {
                continue
            } else {
                let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
                let field = String(parts[0])
                var value = parts.count > 1 ? String(parts[1]) : ""
                if value.hasPrefix(" ") { value.removeFirst() }
                if field == "event" { event = value } else if field == "data" { data.append(value) }
            }
        }
        return out
    }
}

/// What the stream tells the app.
public enum StreamSignal: Equatable, Sendable {
    /// Connected; `reconnected` is true after a drop (refetch then).
    case hello(reconnected: Bool)
    case tasks([String])
    case unauthorized
}

/// `GET /api/events` over `URLSession.bytes`, with backoff on drops. The
/// app also polls every 60 s, so a dead stream only delays updates.
public final class EventStream: @unchecked Sendable {
    private let url: URL
    private let token: String
    private let onSignal: @Sendable (StreamSignal) async -> Void
    private var task: Task<Void, Never>?

    public init(port: Int, token: String, onSignal: @escaping @Sendable (StreamSignal) async -> Void) {
        self.url = URL(string: "http://127.0.0.1:\(port)/api/events")!
        self.token = token
        self.onSignal = onSignal
    }

    public func start() {
        guard task == nil else { return }
        task = Task { [url, token, onSignal] in
            var attempt = 0
            var connectedBefore = false
            while !Task.isCancelled {
                var req = URLRequest(url: url, timeoutInterval: 3600)
                req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: req)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    if status == 401 {
                        await onSignal(.unauthorized)
                        return
                    }
                    if status == 200 {
                        var parser = SSEParser()
                        var line = Data()
                        for try await byte in bytes {
                            line.append(byte)
                            guard byte == 0x0A else { continue }
                            for event in parser.feed(String(decoding: line, as: UTF8.self)) {
                                if event.event == "hello" {
                                    attempt = 0
                                    await onSignal(.hello(reconnected: connectedBefore))
                                    connectedBefore = true
                                } else if let ids = event.taskIds {
                                    await onSignal(.tasks(ids))
                                }
                            }
                            line.removeAll(keepingCapacity: true)
                        }
                    }
                } catch {
                    // dropped or refused; back off and retry
                }
                attempt += 1
                let delay = min(30.0, pow(2.0, Double(min(attempt, 5))))
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
    }

    public func stop() {
        task?.cancel()
        task = nil
    }
}
