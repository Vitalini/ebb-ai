import Foundation
import Testing
@testable import TidegapKit

@Suite struct FormatTests {
    let utc = TimeZone(identifier: "UTC")!
    let connected = ConnectionState.connected(port: 47931, ownsServer: false)

    func window(_ start: String, _ end: String, now: Bool = false, fallback: Bool = false) -> CleanWindow {
        CleanWindow(start: date(start), end: date(end), band: "clean", g: 100, now: now, fallback: fallback)
    }

    @Test func labelFollowsKTD6Order() {
        let later = window("2026-10-17T14:00:00Z", "2026-10-17T17:00:00Z")
        #expect(Format.label(state: .revoked, summary: summary(active: 3), timeZone: utc) == "?")
        #expect(Format.label(state: .needsUpdate(version: "0.18.0"), summary: nil, timeZone: utc) == "?")
        #expect(Format.label(state: .offline("x"), summary: summary(active: 3), timeZone: utc) == "off")
        #expect(Format.label(state: connected, summary: summary(active: 3, window: later), timeZone: utc) == "3")
        #expect(Format.label(state: connected, summary: summary(active: 120), timeZone: utc) == "99+")
        let nowWindow = window("2026-10-17T09:00:00Z", "2026-10-17T17:00:00Z", now: true)
        #expect(Format.label(state: connected, summary: summary(window: nowWindow), timeZone: utc) == "now")
        #expect(Format.label(state: connected, summary: summary(window: later), timeZone: utc) == "14:00")
        #expect(Format.label(state: connected, summary: summary(), timeZone: utc) == "")
    }

    @Test func labelUsesLocalClock() {
        let paris = TimeZone(identifier: "Europe/Paris")!
        let later = window("2026-10-17T14:00:00Z", "2026-10-17T17:00:00Z")
        #expect(Format.label(state: connected, summary: summary(window: later), timeZone: paris) == "16:00")
    }

    @Test func headerStrings() {
        #expect(Format.header(summary(window: window("2026-10-17T14:00:00Z", "2026-10-17T17:00:00Z")), timeZone: utc)
            == "Clean 14:00-17:00 · FR")
        #expect(Format.header(summary(window: window("2026-10-17T09:00:00Z", "2026-10-17T17:00:00Z", now: true)), timeZone: utc)
            == "Clean now until 17:00 · FR")
        #expect(Format.header(summary(window: window("2026-10-17T14:00:00Z", "2026-10-17T15:00:00Z", fallback: true)), timeZone: utc)
            == "Cleanest 14:00 · FR")
        #expect(Format.header(summary(), timeZone: utc) == "Forecast unavailable")
    }

    @Test func presetDeadlines() {
        let now = date("2026-10-17T10:00:00Z")
        #expect(DeadlinePreset.sixHours.deadline(from: now) == date("2026-10-17T16:00:00Z"))
        #expect(DeadlinePreset.day.deadline(from: now) == date("2026-10-18T10:00:00Z"))
        #expect(DeadlinePreset.threeDays.deadline(from: now) == date("2026-10-20T10:00:00Z"))
    }

    @Test func rowTime() {
        let now = date("2026-10-17T10:00:00Z")
        var task = TaskItem(taskId: "a", title: "t", displayTitle: nil, status: .scheduled,
                            deadline: date("2026-10-19T08:00:00Z"), scheduledFor: date("2026-10-17T14:00:00Z"), completedAt: nil)
        #expect(Format.rowTime(task, now: now, timeZone: utc) == "runs 14:00")
        task.scheduledFor = nil
        #expect(Format.rowTime(task, now: now, timeZone: utc) == "by Oct 19 08:00")
    }
}
