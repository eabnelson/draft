//! Settings uses the same saved documents and sync engine as the editor host.
use super::*;

const SECTIONS: [&str; 5] = ["Appearance", "Editor", "Files", "Sync", "Shortcuts"];

#[derive(Clone, Default, Deserialize)]
pub struct SyncStatus {
    pub state: String,
    pub message: Option<String>,
    workspace: Option<String>,
    folder: Option<String>,
}
impl SyncStatus {
    pub fn needs_attention(&self) -> bool {
        matches!(self.state.as_str(), "error" | "needs-credentials")
            || (self.state == "synced" && self.message.is_some())
    }
}
pub struct Preferences {
    pub section: usize,
    pub status: SyncStatus,
    pub issue: Option<String>,
    pub busy: bool,
    workspaces: Vec<Value>,
    folder: TextEdit,
    jobs: Option<mpsc::Sender<Request>>,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            section: 0,
            status: SyncStatus {
                state: "off".into(),
                ..Default::default()
            },
            issue: None,
            busy: false,
            workspaces: vec![],
            folder: TextEdit::new("/workspace/Draft"),
            jobs: None,
        }
    }
}
impl Preferences {
    pub fn cycle(&mut self, reverse: bool) {
        self.section =
            (self.section + if reverse { SECTIONS.len() - 1 } else { 1 }) % SECTIONS.len();
    }
    pub fn needs_attention(&self) -> bool {
        self.status.needs_attention() || self.issue.is_some()
    }
    fn request(&mut self, path: &str, body: Value) {
        if self.busy {
            return;
        }
        if let Some(jobs) = &self.jobs {
            self.busy = jobs
                .send(Request {
                    path: path.into(),
                    body,
                })
                .is_ok();
            self.issue = None;
        }
    }
}
struct Request {
    path: String,
    body: Value,
}
pub struct Update {
    result: Result<SyncStatus, String>,
    workspaces: Vec<Value>,
    completed: bool,
}

pub fn setup(s: &mut State, replies: mpsc::Sender<Reply>, waker: Waker) {
    let (jobs, receive) = mpsc::channel::<Request>();
    s.settings.jobs = Some(jobs);
    let mut host = s.host.clone();
    // Separate from the save queue: an unavailable sync service never delays typing or saving.
    host.agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    std::thread::spawn(move || {
        let mut workspaces = vec![];
        let mut previous = String::new();
        loop {
            let result: Result<Value, String> = host.get("/sync");
            let result = result.and_then(|value| {
                if let Some(error) = value["error"].as_str() {
                    return Err(error.into());
                }
                serde_json::from_value::<SyncStatus>(value).map_err(|e| e.to_string())
            });
            if let Ok(status) = &result {
                if status.state == "choose-workspace" && previous != status.state {
                    match host.get::<Value>("/sync/workspaces") {
                        Ok(Value::Array(list)) => workspaces = list,
                        Ok(value) => {
                            let _ = replies.send(Reply::Sync(Update {
                                result: Err(value["error"]
                                    .as_str()
                                    .unwrap_or("Could not load workspaces")
                                    .into()),
                                workspaces: vec![],
                                completed: false,
                            }));
                        }
                        Err(_) => workspaces.clear(),
                    }
                }
                previous = status.state.clone();
            }
            if replies
                .send(Reply::Sync(Update {
                    result,
                    workspaces: workspaces.clone(),
                    completed: false,
                }))
                .is_err()
            {
                break;
            }
            waker();
            match receive.recv_timeout(Duration::from_millis(1500)) {
                Ok(request) => {
                    let response: Result<Value, String> = host.post(&request.path, &request.body);
                    let result = response.and_then(|value| match value["error"].as_str() {
                        Some(error) => Err(error.to_owned()),
                        None => serde_json::from_value(value).map_err(|e| e.to_string()),
                    });
                    if replies
                        .send(Reply::Sync(Update {
                            result,
                            workspaces: workspaces.clone(),
                            completed: true,
                        }))
                        .is_err()
                    {
                        break;
                    }
                    waker();
                    // Re-fetch both status and workspace choices after every explicit action.
                    previous.clear();
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}
pub fn receive(s: &mut State, update: Update) {
    if update.completed {
        s.settings.busy = false;
    }
    match update.result {
        Ok(status) => {
            if (update.completed || matches!(status.state.as_str(), "off" | "synced"))
                && !status.needs_attention()
            {
                s.settings.issue = None;
            }
            if s.settings.status.folder != status.folder
                && let Some(folder) = &status.folder
            {
                s.settings.folder = TextEdit::new(folder);
            }
            s.settings.status = status;
        }
        Err(error) => s.settings.issue = Some(error),
    }
    s.settings.workspaces = update.workspaces;
}
pub fn open_sync(s: &mut State) {
    s.preferences = true;
    s.settings.section = 3;
    s.context = None;
    s.item_menu = None;
}
fn copy(label: impl Into<String>, p: design::Palette) -> El {
    text(label.into())
        .w_full()
        .font(TextStyle {
            line_height: 23.0,
            ..TextStyle::new(14.0, 400.0)
        })
        .color(p.muted)
}
fn button(
    key: &str,
    label: &str,
    p: design::Palette,
    action: impl Fn(&mut State, &mut Tx) + 'static,
) -> El {
    ui::menu_item(key, label, p, action).w_full().h(38.0)
}
fn sync(s: &State, p: design::Palette) -> El {
    let status = &s.settings.status;
    let message = match status.state.as_str() {
        "off" => "Sync is off. Your drafts are saved on this computer.",
        "signing-in" => "Finish signing in in your browser.",
        "choose-workspace" => "Choose the workspace for these drafts.",
        "choose-folder" => "Choose a folder in Zo for these drafts.",
        "waiting" => "Waiting to sync your latest changes.",
        "syncing" => "Syncing your drafts…",
        "synced" => "Your drafts are up to date.",
        "needs-credentials" => "Sign in again to resume syncing.",
        _ => "Sync needs your attention.",
    };
    let mut body = col().w_full().gap(12.0).child(copy(message, p));
    if let Some(message) = s.settings.issue.as_ref().or(status.message.as_ref()) {
        body = body.child(copy(message, p));
    }
    if let Some(workspace) = &status.workspace {
        body = body.child(copy(format!("Workspace: {workspace}"), p));
    }
    if let Some(folder) = &status.folder {
        body = body.child(copy(format!("Folder: {folder}"), p));
    }
    match status.state.as_str() {
        "off" | "needs-credentials" => {
            body = body.child(button("sync-sign-in", "Sign in to Zo", p, |s, _| {
                s.settings.request("/sync/sign-in", json!({}))
            }));
        }
        "choose-workspace" => {
            for workspace in &s.settings.workspaces {
                let id = workspace["workspace_id"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
                let label = workspace["name"].as_str().unwrap_or("Workspace");
                body = body.child(button(&format!("workspace-{id}"), label, p, move |s, _| {
                    s.settings.request("/sync/workspace", json!({"id":id}))
                }));
            }
            if s.settings.workspaces.is_empty() {
                body = body.child(copy(
                    "No workspaces are available. Sign in again to approve a workspace.",
                    p,
                ));
            }
        }
        "choose-folder" => {
            body = body
                .child(text_input(&s.settings.folder, TextStyle::new(14.0, 400.0))
                    .key("sync-folder").role("textbox").label("Zo folder path").w_full().h(38.0).padding(8.0).radius(8.0).fill(p.glass).color(p.text)
                    .on_edit(|s: &mut State| &mut s.settings.folder))
                .child(copy("Drafts already in this folder will be downloaded. Drafts on this computer will be uploaded.", p))
                .child(button("sync-choose-folder", "Use this folder", p, |s, _| s.settings.request("/sync/folder", json!({"path":s.settings.folder.text}))));
        }
        "signing-in" => {}
        _ => {
            body = body.child(button("sync-retry", "Try syncing again", p, |s, _| {
                s.settings.request("/sync/now", json!({}))
            }))
        }
    }
    if status.state != "off" {
        body = body.child(button("sync-disconnect", "Disconnect", p, |s, _| {
            s.settings.request("/sync/disconnect", json!({}))
        }));
    }
    if s.settings.busy {
        body = body.inert().child(copy("Working…", p));
    }
    body
}
pub fn page(s: &State, dark: bool, side: f32, p: design::Palette) -> El {
    let section = s.settings.section;
    let mut nav = col()
        .w(side.max(210.0))
        .h_full()
        .min_h(0.0)
        .child(el().h(40.0).w_full().window_drag())
        .child(button("settings-back", "‹  Back to drafts", p, |s, _| {
            s.preferences = false
        }));
    for (i, label) in SECTIONS.iter().enumerate() {
        let item = button(&format!("settings-section-{i}"), label, p, move |s, _| {
            s.settings.section = i
        });
        nav = nav.child(if section == i {
            design::glass_surface(item.radius(12.0), dark)
        } else {
            item
        });
    }
    let mut body = col().w_full().max_w(680.0).padding(32.0).gap(14.0);
    match section {
        0 => {
            body = body.child(copy("Choose how Draft looks.", p));
            for (key, label, active, mode) in [
                ("theme-system", "System", s.follow_theme, 0),
                ("theme-light", "Light", !s.follow_theme && !s.dark, 1),
                ("theme-dark", "Dark", !s.follow_theme && s.dark, 2),
            ] {
                let label = format!("{label}{}", if active { "  ✓" } else { "" });
                body = body.child(button(key, &label, p, move |s, _| { s.follow_theme = mode == 0; if mode != 0 { s.dark = mode == 2; } }));
            }
        }
        1 => body = body.child(copy("Markdown formatting stays in your files. Show the formatting marks while you write, or keep them out of the way.", p))
            .child(button("source", if s.source { "Hide Markdown marks" } else { "Show Markdown marks" }, p, |s, _| s.source = !s.source)),
        2 => {
            let folder = std::env::var("DRAFT_RUNE_DATA_ROOT").unwrap_or_default();
            body = body.child(copy("Drafts are saved automatically as Markdown files.", p))
                .child(copy(PathBuf::from(folder).join("Drafts").display().to_string(), p))
                .child(button("reload", "Reload files", p, |s, _| { s.preferences = false; s.reload(false); }));
            if s.archived > 0 {
                body = body.child(button("restore", "Restore last archived draft", p, |s, _| {
                    s.preferences = false;
                    s.reload(false);
                    if !s.docs.iter().any(|d| d.pending_action) && let Some(jobs) = &s.jobs { let _ = jobs.send(Job::Restore(s.generation)); }
                }));
            }
        }
        3 => body = body.child(sync(s, p)),
        _ => {
            let command = if cfg!(target_os = "macos") { "⌘" } else { "Ctrl" };
            for (keys, label, detail) in [
                ("Alt + .", "New draft from anywhere", "Bring Draft forward with a blank draft, or hide it when it is already active."),
                ("N", "New draft", "Reuse the most recent draft while it is empty."),
                ("T", "New version", "Open a copy of the active version in a new tab."),
                ("1–9", "Switch drafts", "1–8 select the sidebar item; 9 selects the last item."),
                ("Control + Tab / Control + Shift + Tab", "Switch tabs", "Move forward or backward through open versions, or Settings sections."),
                ("W", "Close tab", "Keep its writing. The last tab stays open. In Settings, return to drafts."),
                ("Shift + W", "Close window", "Keep Draft running for the quick-draft shortcut."),
                ("B", "Toggle sidebar", "Show or hide your drafts."),
                ("+ / − / 0", "Zoom", "Increase, decrease, or reset the whole interface. The zoom level is saved."),
                ("Z / Shift + Z / Y", "Undo and redo", "Each version keeps its own history."),
                ("I / U", "Italic and underline", "Format the selected text."),
                (",", "Settings", "Open this page."),
                ("S", "Save", "Save now. Draft also saves as you type."),
            ] {
                let keys = if keys.starts_with("Alt") || keys.starts_with("Control") { keys.to_owned() } else { format!("{command} + {keys}") };
                body = body.child(col().w_full().gap(3.0)
                    .child(text(format!("{label}    {keys}")).font(TextStyle::new(14.0, 500.0)).color(p.text))
                    .child(copy(detail, p)));
            }
            if let Some(error) = &s.keyboard.shortcut_error { body = body.child(copy(error, p)); }
        }
    }
    row()
        .key("settings-page")
        .w_full()
        .h_full()
        .min_h(0.0)
        .child(nav.px(8.0).gap(4.0))
        .child(el().w(1.0).h_full().fill(p.line))
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .h_full()
                .min_h(0.0)
                .child(
                    row()
                        .w_full()
                        .h(40.0)
                        .px(12.0)
                        .center_y()
                        .window_drag()
                        .child(
                            text(format!("Settings · {}", SECTIONS[section]))
                                .font(TextStyle::new(13.0, 550.0))
                                .color(p.text),
                        ),
                )
                .child(
                    col()
                        .w_full()
                        .grow(1.0)
                        .min_h(0.0)
                        .scroll(ScrollSpec {
                            stick_bottom: false,
                        })
                        .items_center()
                        .child(body),
                ),
        )
}
