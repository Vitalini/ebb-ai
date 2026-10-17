import Foundation
import SafariServices

/// The native side of the Safari Web Extension. The extension talks only to
/// `tidegap ui` over HTTP and sends no native messages, so every request is
/// completed empty.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [], completionHandler: nil)
    }
}
