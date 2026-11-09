//! Finder/desktop entry point. The bundled host owns renderer activation and recovery.
use std::{path::PathBuf, process::Command};
fn main() {
    let executable = std::env::current_exe().expect("Locate Draft");
    let folder = executable.parent().unwrap();
    let runtime = if cfg!(target_os = "macos") {
        folder.join("../Resources/runtime")
    } else {
        folder.join("../lib/draft")
    };
    let runtime = runtime.canonicalize().expect("Locate Draft's bundled host");
    let mut command = Command::new(runtime.join("bun"));
    command.arg(runtime.join("launcher.js"));
    command.args(std::env::args_os().skip(1));
    command.env("DRAFT_RUNTIME_ROOT", &runtime);
    command.env("DRAFT_NATIVE_EXECUTABLE", folder.join("draft-native"));
    // The folder an update replaces: Draft.app on a Mac, the unpacked Draft folder on Linux.
    let app: PathBuf = if cfg!(target_os = "macos") {
        folder.join("../..")
    } else {
        folder.join("..")
    };
    command.env("DRAFT_APP_PATH", app.canonicalize().unwrap());
    command.env("DRAFT_LAUNCHER_EXECUTABLE", &executable);
    command.env("DRAFT_BUNDLE_ID", "com.studiofour.draft.native");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let error = command.exec();
        eprintln!("Draft could not start: {error}");
        std::process::exit(1);
    }
    #[cfg(not(unix))]
    std::process::exit(command.status().map_or(1, |s| s.code().unwrap_or(1)));
}
