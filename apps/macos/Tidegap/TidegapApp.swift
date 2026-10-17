import AppKit
import SwiftUI
import TidegapKit

@main
struct TidegapApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environment(delegate.model)
        } label: {
            MenuBarLabel(model: delegate.model)
        }
        .menuBarExtraStyle(.window)

        Window("Tidegap", id: MainWindow.id) {
            WebPageWindow()
                .environment(delegate.model)
        }
        .defaultSize(width: 1100, height: 760)

        Settings {
            SettingsView()
                .environment(delegate.model)
        }
    }
}

enum MainWindow {
    static let id = "main"
}

/// The mark template image plus the KTD6 text. It is always alive, so it
/// also opens the main window on request (menu, notification click, or the
/// `--show-window` launch argument).
struct MenuBarLabel: View {
    let model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        HStack(spacing: 3) {
            Image("MenuBarIcon")
            if !model.label.isEmpty { Text(model.label) }
        }
        .onAppear {
            if CommandLine.arguments.contains("--show-window") { open() }
        }
        .onChange(of: model.windowRequests) { open() }
    }

    private func open() {
        openWindow(id: MainWindow.id)
        NSApp.activate(ignoringOtherApps: true)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    @MainActor let model = AppModel()

    @MainActor func applicationDidFinishLaunching(_ notification: Notification) {
        model.notifications.onOpen = { [model] in model.showWindow() }
        model.start()
    }

    /// Quit stops only the server this app started (AE5).
    @MainActor func applicationWillTerminate(_ notification: Notification) {
        model.shutdown()
    }
}
