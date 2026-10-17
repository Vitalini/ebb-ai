import Foundation

/// How a request ended, the same four outcomes as the extension (U9).
public enum APIResult<Value> {
    case ok(Value)
    /// Connection refused or dropped: no server on the port.
    case offline
    /// 401: the token is unknown or revoked.
    case unpaired
    case error(String)

    public var value: Value? {
        if case .ok(let v) = self { return v }
        return nil
    }

    public func map<U>(_ transform: (Value) -> U) -> APIResult<U> {
        switch self {
        case .ok(let v): return .ok(transform(v))
        case .offline: return .offline
        case .unpaired: return .unpaired
        case .error(let m): return .error(m)
        }
    }
}

extension APIResult: Equatable where Value: Equatable {}

/// The HTTP exchange; tests replace it.
public typealias HTTPTransport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

/// Client of the `tidegap ui` API with a bearer client token (docs/spec/ui-client-api.md).
public struct APIClient: Sendable {
    public let baseURL: URL
    public let token: String
    private let transport: HTTPTransport

    public init(port: Int, token: String, transport: HTTPTransport? = nil) {
        self.baseURL = URL(string: "http://127.0.0.1:\(port)/")!
        self.token = token
        self.transport = transport ?? { request in try await URLSession.shared.data(for: request) }
    }

    public func summary(since: String?) async -> APIResult<Summary> {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/summary"), resolvingAgainstBaseURL: false)!
        if let since { components.queryItems = [URLQueryItem(name: "since", value: since)] }
        return await send(request(components.url!), as: Summary.self)
    }

    /// Up to `limit` active tasks for the menu.
    public func activeTasks(limit: Int = 10) async -> APIResult<[TaskItem]> {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/tasks"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "status", value: TaskStatus.active.map(\.rawValue).joined(separator: ",")),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        return await send(request(components.url!), as: TaskList.self).map(\.tasks)
    }

    /// `POST /api/tasks` with only `prompt` and `deadline`.
    public func quickAdd(prompt: String, deadline: Date) async -> APIResult<TaskItem> {
        var req = request(baseURL.appendingPathComponent("api/tasks"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = Self.quickAddBody(prompt: prompt, deadline: deadline)
        return await send(req, as: TaskItem.self)
    }

    public static func quickAddBody(prompt: String, deadline: Date) -> Data {
        (try? Wire.encoder().encode(QuickAddRequest(prompt: prompt, deadline: deadline))) ?? Data()
    }

    func request(_ url: URL) -> URLRequest {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        return req
    }

    private func send<T: Decodable>(_ req: URLRequest, as type: T.Type) async -> APIResult<T> {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport(req)
        } catch let error as URLError where Self.offlineCodes.contains(error.code) {
            return .offline
        } catch {
            return .error(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { return .error("not an HTTP response") }
        if http.statusCode == 401 { return .unpaired }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
            return .error(message ?? "HTTP \(http.statusCode)")
        }
        do {
            return .ok(try Wire.decoder().decode(T.self, from: data))
        } catch {
            return .error("unexpected answer from tidegap ui")
        }
    }

    private struct ErrorBody: Decodable { let error: String }

    static let offlineCodes: Set<URLError.Code> = [
        .cannotConnectToHost, .networkConnectionLost, .timedOut, .cannotFindHost, .notConnectedToInternet,
    ]
}
