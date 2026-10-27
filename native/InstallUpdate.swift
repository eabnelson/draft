// A separate process completes the native swap after Draft has saved and exited.
// It owns no document migration: writing remains in the existing document store.
import Foundation
import CryptoKit
import Darwin

enum InstallError: Error { case invalid(String) }
func require(_ condition: Bool, _ message: String) throws { if !condition { throw InstallError.invalid(message) } }
func json(_ url: URL) throws -> [String: Any] { try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] ?? [:] }
func write(_ value: [String: Any], _ url: URL) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: url, options: .atomic)
    chmod(url.path, 0o600)
}
func command(_ executable: String, _ arguments: [String]) throws -> String {
    let task = Process(), output = Pipe(), errors = Pipe()
    task.executableURL = URL(fileURLWithPath: executable); task.arguments = arguments
    task.standardOutput = output; task.standardError = errors
    try task.run()
    let text = output.fileHandleForReading.readDataToEndOfFile()
    let error = errors.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    try require(task.terminationStatus == 0, String(data: error, encoding: .utf8) ?? "The desktop update could not be checked.")
    return String(data: text, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}
func appInfo(_ app: URL, _ key: String) throws -> String { try command("/usr/libexec/PlistBuddy", ["-c", "Print :" + key, app.appendingPathComponent("Contents/Info.plist").path]) }
func launch(_ app: URL, _ root: URL) throws -> Process {
    let executable = try appInfo(app, "CFBundleExecutable")
    try require(!executable.contains("/") && !executable.isEmpty, "The app executable is invalid.")
    let task = Process(); task.executableURL = app.appendingPathComponent("Contents/MacOS/" + executable)
    var environment = ProcessInfo.processInfo.environment
    environment["DRAFT_DATA_ROOT"] = root.path
    environment.removeValue(forKey: "DRAFT_RUNTIME_ROOT"); environment.removeValue(forKey: "DRAFT_TEMPLATE_ROOT")
    task.environment = environment; task.standardInput = FileHandle.nullDevice
    task.standardOutput = FileHandle.nullDevice; task.standardError = FileHandle.nullDevice
    try task.run(); return task
}
func stop(_ child: Process?, _ root: URL) {
    guard let child else { return }
    if let runtime = try? json(root.appendingPathComponent("runtime-info.json")),
       let host = runtime["hostPid"] as? Int32, host == child.processIdentifier,
       let pid = runtime["runtimePid"] as? Int32, pid > 1 { kill(-pid, SIGTERM) }
    if child.isRunning { child.terminate(); child.waitUntilExit() }
}

let fm = FileManager.default
var plan: [String: Any] = [:], root: URL?, app: URL?, backup: URL?, child: Process?, statusURL: URL?
var movedOriginal = false, installedNew = false
var savedOriginal: URL?
var originalParent: Int32?
do {
    try require(CommandLine.arguments.count == 2, "Choose a prepared update.")
    let planURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
    plan = try json(planURL)
    guard let rootPath = plan["dataRoot"] as? String, let appPath = plan["appPath"] as? String,
          let id = plan["updateId"] as? String, let parent = plan["parentPid"] as? Int32,
          let bundleId = plan["bundleId"] as? String, let targetHost = plan["targetHost"] as? String,
          let action = plan["action"] as? String else { throw InstallError.invalid("The update plan is incomplete.") }
    try require(UUID(uuidString: id) != nil && parent > 1 && parent != getpid(), "The update identity is invalid.")
    let dataRoot = URL(fileURLWithPath: rootPath).standardizedFileURL, application = URL(fileURLWithPath: appPath).standardizedFileURL
    try require(planURL.path == dataRoot.appendingPathComponent("NativeUpdates/" + id + "/install-plan.json").path, "The update plan is outside Draft’s update folder.")
    var ownApp = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    for _ in 0..<4 { ownApp.deleteLastPathComponent() }
    try require(ownApp.path == application.path && application.pathExtension == "app", "The update belongs to another application.")
    try require(try appInfo(application, "CFBundleIdentifier") == bundleId, "The application identity has changed.")
    let keyURL = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("source-template/update-public-key.pem")
    let keyPEM = try String(contentsOf: keyURL, encoding: .utf8)
    let keyText = keyPEM.components(separatedBy: .newlines).filter { !$0.hasPrefix("-----") }.joined()
    guard let keyData = Data(base64Encoded: keyText), keyData.count == 44 else { throw InstallError.invalid("The update key is invalid.") }
    let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: keyData.suffix(32))
    root = dataRoot; app = application
    originalParent = parent
    let status = dataRoot.appendingPathComponent("NativeUpdates/" + id + "/status.json"); statusURL = status
    let previousApp = application.deletingLastPathComponent().appendingPathComponent(".Draft-previous-" + id + ".app"); backup = previousApp
    try write(["phase":"installing", "helperPid":getpid(), "backup":previousApp.path], status)
    for _ in 0..<150 { if kill(parent, 0) != 0 { break }; usleep(100_000) }
    try require(kill(parent, 0) != 0, "Draft is still saving. The update was left unapplied.")
    let staging = application.deletingLastPathComponent().appendingPathComponent(".Draft-update-" + id)
    try fm.createDirectory(at: staging, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: staging) }
    let replacement: URL
    if action == "install" {
        guard let archive = plan["archive"] as? String, let envelope = plan["envelope"] as? [String: Any],
              let payload = envelope["payload"] as? String, let signature = envelope["signature"] as? String,
              let signatureBytes = Data(base64Encoded: signature) else { throw InstallError.invalid("The update signature is missing.") }
        let payloadBytes = Data(payload.utf8)
        try require(publicKey.isValidSignature(signatureBytes, for: payloadBytes), "The update signature is invalid.")
        guard let manifest = try JSONSerialization.jsonObject(with: payloadBytes) as? [String: Any],
              let desktop = manifest["desktop"] as? [String: Any], let expectedHash = desktop["sha256"] as? String,
              let expectedSize = desktop["size"] as? Int else { throw InstallError.invalid("The signed update is incomplete.") }
        try require(manifest["nativeHostVersion"] as? String == targetHost && desktop["bundleId"] as? String == bundleId, "The update does not match this app.")
        let bytes = try Data(contentsOf: URL(fileURLWithPath: archive), options: .mappedIfSafe)
        let digest = SHA256.hash(data: bytes).map { String(format:"%02x", $0) }.joined()
        try require(bytes.count == expectedSize && digest == expectedHash, "The update download has changed.")
        _ = try command("/usr/bin/ditto", ["-x", "-k", archive, staging.path])
        let applications = try fm.contentsOfDirectory(at: staging, includingPropertiesForKeys: nil).filter { $0.pathExtension == "app" }
        try require(applications.count == 1, "The desktop update is incomplete.")
        replacement = applications[0]
    } else if action == "rollback" {
        guard let saved = plan["backup"] as? String else { throw InstallError.invalid("The previous app is missing.") }
        let savedURL = URL(fileURLWithPath: saved).standardizedFileURL
        try require(savedURL.path.hasPrefix(application.deletingLastPathComponent().path + "/.Draft-previous-") || savedURL.path.hasPrefix(dataRoot.appendingPathComponent("Backups").path + "/"), "The previous app is outside the recovery folders.")
        replacement = staging.appendingPathComponent("Draft.app"); try fm.copyItem(at: savedURL, to: replacement)
    } else { throw InstallError.invalid("Unknown update action.") }
    try require(try appInfo(replacement, "CFBundleIdentifier") == bundleId && appInfo(replacement, "CFBundleShortVersionString") == targetHost, "The desktop version does not match this update.")
    _ = try command("/usr/bin/codesign", ["--verify", "--deep", "--strict", replacement.path])
    let previousIndex = dataRoot.appendingPathComponent("NativeUpdates/previous.json")
    let oldBackup = (try? json(previousIndex))?["path"] as? String
    try write(["phase":"installing", "helperPid":getpid(), "backup":previousApp.path, "recovery":replacement.path], status)
    // Both folders are on the same volume. Exchange them atomically so even an
    // interruption cannot leave the public application path without an app.
    try require(renamex_np(application.path, replacement.path, UInt32(RENAME_SWAP)) == 0, "The app could not be replaced. Your current app is unchanged.")
    movedOriginal = true; installedNew = true; savedOriginal = replacement
    try fm.moveItem(at: replacement, to: previousApp); savedOriginal = previousApp
    child = try launch(application, dataRoot)
    var confirmed = false
    for _ in 0..<300 {
        if let state = try? json(dataRoot.appendingPathComponent("state.json")), state["pendingActivation"] == nil,
           state["activeVersion"] as? String == plan["target"] as? String,
           let updates = state["updates"] as? [[String: Any]],
           updates.contains(where: { $0["id"] as? String == id && $0["state"] as? String == "applied" }) { confirmed = true; break }
        if child?.isRunning == false { break }; usleep(100_000)
    }
    try require(confirmed, "The new app could not finish starting.")
    try write(["path":previousApp.path, "version":plan["previousHost"] ?? ""], previousIndex)
    try write(["phase":"complete", "backup":previousApp.path], status)
    if let oldBackup, oldBackup != previousApp.path, oldBackup.hasPrefix(application.deletingLastPathComponent().path + "/.Draft-previous-") { try? fm.removeItem(atPath: oldBackup) }
} catch {
    if let parent = originalParent, kill(parent, 0) == 0 {
        if let statusURL { try? write(["phase":"blocked", "message":"Draft is still saving. Try the update again."],statusURL) }
        exit(1)
    }
    if let root, let app {
        stop(child, root)
        if installedNew { try? fm.removeItem(at: app) }
        if movedOriginal, let savedOriginal { try? fm.moveItem(at: savedOriginal, to: app) }
        if var state = try? json(root.appendingPathComponent("state.json")) {
            state["activeVersion"] = plan["previous"]; state["officialVersion"] = plan["previousOfficial"]
            state.removeValue(forKey:"pendingActivation"); state.removeValue(forKey:"nativeInstallPlan")
            if var updates = state["updates"] as? [[String: Any]], let index = updates.firstIndex(where: { $0["id"] as? String == plan["updateId"] as? String }) {
                updates[index]["state"] = "failed"; updates[index]["stage"] = "Your previous app is back"
                updates[index]["error"] = "The update couldn’t start. Draft restored your previous app. Your writing is safe."; state["updates"] = updates
            }
            try? write(state, root.appendingPathComponent("state.json"))
        }
        if let statusURL { try? write(["phase":"restored", "message":"Your previous app is back.", "detail":String(describing:error)], statusURL) }
        _ = try? launch(app, root)
    } else { fputs("Draft could not read the prepared update.\n", stderr); exit(1) }
}
