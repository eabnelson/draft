import AppKit
final class MenuActions: NSObject {
    @objc func show() { emit("show") }
    @objc func newDraft() { emit("new") }
    @objc func settings() { emit("settings") }
    @objc func quit() { emit("quit") }
    func emit(_ action: String) { print(action); fflush(stdout) }
}
func menuBarIcon() -> NSImage {
    let image = NSImage(size: NSSize(width: 22, height: 18))
    let folder = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
    for name in ["tray-template.png", "tray-template@2x.png"] {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)),
              let representation = NSBitmapImageRep(data: data) else {
            fatalError("Draft’s menu bar artwork could not be loaded.")
        }
        representation.size = image.size
        image.addRepresentation(representation)
    }
    image.isTemplate = true
    return image
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let actions = MenuActions()
let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
item.button?.image = menuBarIcon()
item.button?.toolTip = "Draft"
item.button?.setAccessibilityLabel("Draft")
let menu = NSMenu()
for (title, selector) in [("Show Draft", #selector(MenuActions.show)), ("New Draft", #selector(MenuActions.newDraft)), ("Settings…", #selector(MenuActions.settings)), ("Quit Draft", #selector(MenuActions.quit))] {
    let entry = NSMenuItem(title: title, action: selector, keyEquivalent: "")
    entry.target = actions; menu.addItem(entry)
}
item.menu = menu
DispatchQueue.global().async { while readLine() != nil {} ; DispatchQueue.main.async { app.terminate(nil) } }
app.run()
