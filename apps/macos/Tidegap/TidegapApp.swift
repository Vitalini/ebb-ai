import SwiftUI
import TidegapKit

@main
struct TidegapApp: App {
    var body: some Scene {
        MenuBarExtra("Tidegap", image: "MenuBarIcon") {
            Text("Tidegap")
        }
        .menuBarExtraStyle(.window)
    }
}
