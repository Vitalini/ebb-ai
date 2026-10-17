import Foundation

/// Text for the menu bar label and the menu header (KTD6).
public enum Format {
    /// The menu bar text, in KTD6 priority order. The Mac shows the start clock
    /// time of a later window instead of hours left.
    public static func label(state: ConnectionState, summary: Summary?, timeZone: TimeZone = .current) -> String {
        if state.lacksToken { return "?" }
        guard case .connected = state, let summary else { return "off" }
        if summary.active > 99 { return "99+" }
        if summary.active > 0 { return String(summary.active) }
        guard let window = summary.cleanWindow else { return "" }
        if window.now { return "now" }
        return clock(window.start, timeZone: timeZone)
    }

    /// "Clean 14:00-17:00 · FR", "Clean now until 17:00 · FR",
    /// "Cleanest 14:00 · FR" (fallback) or "Forecast unavailable".
    public static func header(_ summary: Summary, timeZone: TimeZone = .current) -> String {
        guard let window = summary.cleanWindow else { return "Forecast unavailable" }
        let region = summary.region.map { " · \($0)" } ?? ""
        let start = clock(window.start, timeZone: timeZone)
        let end = clock(window.end, timeZone: timeZone)
        if window.fallback { return "Cleanest \(start)\(region)" }
        if window.now { return "Clean now until \(end)\(region)" }
        return "Clean \(start)-\(end)\(region)"
    }

    /// "14:00" in 24-hour time.
    public static func clock(_ date: Date, timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }

    /// A task row's time: the planned run, else the deadline.
    public static func rowTime(_ task: TaskItem, now: Date, timeZone: TimeZone = .current) -> String {
        guard let date = task.scheduledFor ?? task.deadline else { return "" }
        let prefix = task.scheduledFor != nil ? "runs" : "by"
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        if calendar.isDate(date, inSameDayAs: now) { return "\(prefix) \(clock(date, timeZone: timeZone))" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "MMM d HH:mm"
        return "\(prefix) \(f.string(from: date))"
    }
}

/// Quick-add deadline presets (plan Assumptions: 6 h, 24 h default, 3 days).
public enum DeadlinePreset: String, CaseIterable, Identifiable, Sendable {
    case sixHours = "6 h"
    case day = "24 h"
    case threeDays = "3 days"

    public var id: String { rawValue }

    public func deadline(from now: Date) -> Date {
        switch self {
        case .sixHours: return now.addingTimeInterval(6 * 3600)
        case .day: return now.addingTimeInterval(24 * 3600)
        case .threeDays: return now.addingTimeInterval(72 * 3600)
        }
    }
}
