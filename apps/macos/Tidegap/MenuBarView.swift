import SwiftUI
import TidegapKit

/// The menu bar window: clean window header, up to 10 active tasks, quick
/// add, and the app commands (R10).
struct MenuBarView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            Divider()
            if model.state.isConnected {
                taskList
                Divider()
                QuickAddView()
                Divider()
            }
            commands
        }
        .padding(12)
        .frame(width: 340)
    }

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(headline).font(.headline)
            if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
        }
        switch model.state {
        case .revoked:
            Button("Reconnect") { model.reconnect() }
        case .offline, .failed, .tidegapNotFound, .needsUpdate:
            Button("Retry") { model.retry() }
        default:
            EmptyView()
        }
    }

    private var headline: String {
        switch model.state {
        case .connecting: return "Connecting to tidegap ui…"
        case .connected: return model.summary.map { Format.header($0) } ?? "Connected"
        case .offline: return "tidegap ui is not reachable"
        case .revoked: return "Access revoked"
        case .needsUpdate: return "Update tidegap to 0.19 or later"
        case .tidegapNotFound: return "tidegap not found"
        case .failed(let message): return message
        }
    }

    private var detail: String? {
        switch model.state {
        case .connected:
            guard let s = model.summary else { return nil }
            var parts = ["\(s.active) active"]
            if s.counts.running > 0 { parts.append("\(s.counts.running) running") }
            if s.unread > 0 { parts.append("\(s.unread) unread") }
            return parts.joined(separator: " · ")
        case .revoked: return "The token was revoked or removed. Reconnect creates a new one."
        case .needsUpdate(let version): return "Found \(version). Or point Settings at a newer build."
        case .tidegapNotFound: return "Set the tidegap command in Settings."
        case .offline(let message): return message
        default: return nil
        }
    }

    @ViewBuilder private var taskList: some View {
        if model.tasks.isEmpty {
            Text("No active tasks").foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(model.tasks.prefix(10)) { task in
                    HStack(alignment: .firstTextBaseline) {
                        Text(task.label).lineLimit(1).truncationMode(.tail)
                        Spacer(minLength: 8)
                        Text(task.status.rawValue).font(.caption).foregroundStyle(.secondary)
                        Text(Format.rowTime(task, now: Date())).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder private var commands: some View {
        HStack {
            Button("Open Tidegap window") { model.showWindow() }
            SettingsLink { Text("Settings…") }
                .simultaneousGesture(TapGesture().onEnded { NSApp.activate(ignoringOtherApps: true) })
            Spacer()
            Button("Quit Tidegap") { NSApplication.shared.terminate(nil) }
                .keyboardShortcut("q")
        }
    }
}
