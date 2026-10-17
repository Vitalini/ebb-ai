import Foundation

// Codable shapes of the `tidegap ui` client API (docs/spec/ui-client-api.md).

/// Task status. A status this build does not know decodes to `.other`.
public enum TaskStatus: Equatable, Hashable, Sendable, Codable {
    case queued, scheduled, running, submitted, completed, failed, cancelled
    case other(String)

    public init(rawValue: String) {
        switch rawValue {
        case "queued": self = .queued
        case "scheduled": self = .scheduled
        case "running": self = .running
        case "submitted": self = .submitted
        case "completed": self = .completed
        case "failed": self = .failed
        case "cancelled": self = .cancelled
        default: self = .other(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .queued: return "queued"
        case .scheduled: return "scheduled"
        case .running: return "running"
        case .submitted: return "submitted"
        case .completed: return "completed"
        case .failed: return "failed"
        case .cancelled: return "cancelled"
        case .other(let s): return s
        }
    }

    public init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rawValue)
    }

    /// The statuses `GET /api/summary` counts as active.
    public static let active: [TaskStatus] = [.queued, .scheduled, .running, .submitted]
}

public struct Counts: Codable, Equatable, Sendable {
    public var queued: Int
    public var scheduled: Int
    public var running: Int
    public var submitted: Int
}

public struct NextRun: Codable, Equatable, Sendable {
    public var taskId: String
    public var title: String?
    public var scheduledFor: Date?
}

public struct CleanWindow: Codable, Equatable, Sendable {
    public var start: Date
    public var end: Date
    public var band: String
    public var g: Double?
    public var now: Bool
    public var fallback: Bool

    public init(start: Date, end: Date, band: String, g: Double?, now: Bool, fallback: Bool) {
        self.start = start
        self.end = end
        self.band = band
        self.g = g
        self.now = now
        self.fallback = fallback
    }
}

public struct FinishedTask: Codable, Equatable, Sendable {
    public var taskId: String
    public var title: String?
    public var status: TaskStatus
    public var completedAt: Date

    public init(taskId: String, title: String?, status: TaskStatus, completedAt: Date) {
        self.taskId = taskId
        self.title = title
        self.status = status
        self.completedAt = completedAt
    }
}

/// `GET /api/summary[?since=<iso>]`.
public struct Summary: Codable, Equatable, Sendable {
    public var generatedAt: Date
    public var region: String?
    public var counts: Counts
    public var active: Int
    public var unread: Int
    public var nextRun: NextRun?
    public var cleanWindow: CleanWindow?
    public var forecastOk: Bool
    public var finished: [FinishedTask]?
    /// Server clock; send it back as `since`. Kept as the server's string.
    public var cursor: String
}

/// One row of `GET /api/tasks`.
public struct TaskItem: Codable, Equatable, Identifiable, Sendable {
    public var taskId: String
    public var title: String?
    public var displayTitle: String?
    public var status: TaskStatus
    public var deadline: Date?
    public var scheduledFor: Date?
    public var completedAt: Date?

    public var id: String { taskId }
    public var label: String { displayTitle ?? title ?? taskId }
}

public struct TaskList: Codable, Equatable, Sendable {
    public var tasks: [TaskItem]
}

/// `POST /api/tasks` body. Clients send only these two keys (plan Assumptions).
public struct QuickAddRequest: Codable, Equatable, Sendable {
    public var prompt: String
    public var deadline: Date
}

/// `~/.tidegap/ui.json`.
public struct DiscoveryRecord: Codable, Equatable, Sendable {
    public var version: Int
    public var pid: Int32
    public var port: Int
    public var url: String?
    public var startedAt: String?
    public var cliVersion: String?
}

/// `tidegap clients add --json`.
public struct MintedClient: Codable, Equatable, Sendable {
    public var clientId: String
    public var token: String
}

public enum Wire {
    /// ISO-8601 with or without fractional seconds, as Node's `toISOString` writes.
    public static func parseDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    public static func formatDate(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }

    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            guard let date = parseDate(s) else {
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "not an ISO-8601 instant: \(s)")
            }
            return date
        }
        return d
    }

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(formatDate(date))
        }
        e.outputFormatting = [.sortedKeys]
        return e
    }
}
