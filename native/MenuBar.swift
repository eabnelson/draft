import AppKit
final class MenuActions: NSObject {
    @objc func show() { emit("show") }
    @objc func newDraft() { emit("new") }
    @objc func settings() { emit("settings") }
    @objc func quit() { emit("quit") }
    func emit(_ action: String) { print(action); fflush(stdout) }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let actions = MenuActions()
let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
item.button?.image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: "Draft")
let menu = NSMenu()
for (title, selector) in [("Show Draft", #selector(MenuActions.show)), ("New Draft", #selector(MenuActions.newDraft)), ("Settings…", #selector(MenuActions.settings)), ("Quit Draft", #selector(MenuActions.quit))] {
    let entry = NSMenuItem(title: title, action: selector, keyEquivalent: "")
    entry.target = actions; menu.addItem(entry)
}
item.menu = menu
DispatchQueue.global().async { while readLine() != nil {} ; DispatchQueue.main.async { app.terminate(nil) } }
app.run()
