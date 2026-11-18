import AppKit
import SafariServices

final class FocusApp: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private let extensionIdentifier = "app.focusfeed.local.extension"

    func applicationDidFinishLaunching(_ notification: Notification) {
        let title = NSTextField(labelWithString: "Focus Feed")
        title.font = .systemFont(ofSize: 30, weight: .bold)
        let description = NSTextField(wrappingLabelWithString:
            "Enable Focus Feed in Safari, then allow it on X and YouTube. Use the voting controls on either Home feed to teach it what to show.")
        description.font = .systemFont(ofSize: 14)
        let settings = NSButton(title: "Open Safari Extensions", target: self, action: #selector(openSettings))
        settings.bezelStyle = .rounded
        let stack = NSStackView(views: [title, description, settings])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 15
        stack.translatesAutoresizingMaskIntoConstraints = false
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 430, height: 195),
                              styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Focus Feed"
        guard let content = window.contentView else { return }
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            description.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    @objc private func openSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier) { error in
            if error != nil {
                DispatchQueue.main.async {
                    let alert = NSAlert()
                    alert.messageText = "Open Safari → Settings → Extensions"
                    alert.informativeText = "For this local build, Safari may also require Develop → Allow Unsigned Extensions."
                    alert.runModal()
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = FocusApp()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
