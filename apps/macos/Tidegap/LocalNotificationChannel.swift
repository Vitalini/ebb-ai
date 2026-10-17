import Foundation
import OSLog
import TidegapKit
import UserNotifications

/// macOS notifications for Kit events (R11, KTD8). Text goes only into
/// plain-text fields, truncated by `NotificationText`.
final class LocalNotificationChannel: NSObject, NotificationChannel, UNUserNotificationCenterDelegate {
    private static let cleanPrefix = "clean-"
    private let center = UNUserNotificationCenter.current()
    private let log = Logger(subsystem: "com.tidegap.mac", category: "notifications")
    /// Called when the user clicks a notification.
    var onOpen: (() -> Void)?

    override init() {
        super.init()
        center.delegate = self
    }

    /// Asked once, on the first connect.
    func requestAuthorization() {
        center.requestAuthorization(options: [.alert, .sound]) { [log] granted, error in
            if let error {
                log.error("notification authorization failed: \(error.localizedDescription, privacy: .public)")
            } else if !granted {
                log.notice("notifications not allowed; the menu bar keeps working")
            }
        }
    }

    func deliver(_ event: ClientEvent) {
        switch event {
        case .taskFinished(let task):
            add(id: "task-\(task.taskId)", event: event, trigger: nil)
        case .cleanWindow(let window):
            // One pending request: a new window replaces the old one.
            removePendingCleanWindows()
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: window.start)
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            add(id: Self.cleanPrefix + Wire.formatDate(window.start), event: event, trigger: trigger)
        case .cleanWindowCleared:
            removePendingCleanWindows()
        }
    }

    private func add(id: String, event: ClientEvent, trigger: UNNotificationTrigger?) {
        guard let text = NotificationText.content(for: event) else { return }
        let content = UNMutableNotificationContent()
        content.title = text.title
        content.body = text.body
        content.sound = .default
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger)) { [log] error in
            if let error { log.error("notification failed: \(error.localizedDescription, privacy: .public)") }
        }
    }

    private func removePendingCleanWindows() {
        center.getPendingNotificationRequests { [center] requests in
            let ids = requests.map(\.identifier).filter { $0.hasPrefix(Self.cleanPrefix) }
            center.removePendingNotificationRequests(withIdentifiers: ids)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        DispatchQueue.main.async { self.onOpen?() }
        completionHandler()
    }
}
