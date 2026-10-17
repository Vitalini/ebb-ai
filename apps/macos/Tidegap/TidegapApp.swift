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
    }
}

/// The mark template image plus the KTD6 text.
struct MenuBarLabel: View {
    let model: AppModel

    var body: some View {
        HStack(spacing: 3) {
            Image("MenuBarIcon")
            if !model.label.isEmpty { Text(model.label) }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    @MainActor let model = AppModel()

    @MainActor func applicationDidFinishLaunching(_ notification: Notification) {
        model.start()
    }

    /// Quit stops only the server this app started (AE5).
    @MainActor func applicationWillTerminate(_ notification: Notification) {
        model.shutdown()
    }
}
