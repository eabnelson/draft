//! Settings uses the same saved documents and sync engine as the editor host.
use super::*;

const SECTIONS: [&str; 5] = ["Appearance", "Editor", "Files", "Sync", "Shortcuts"];
const DETAILS: [&str; 5] = [
    "Light, dark, or your system appearance.",
    "Markdown marks and the way you write.",
    "Autosaving, local files, and archived drafts.",
    "Your workspace, connection, and sync status.",
    "A key-by-key guide to getting around Draft.",
];

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
    pub(super) folder: TextEdit,
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
                    .caret(s.caret.color(p.text), p.text.alpha(0.2))
                    .on_selection_change(|s: &mut State, _, _| s.caret.restart())
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
fn header(section: usize, dark: bool, p: design::Palette) -> El {
    let title = SECTIONS[section];
    let widths = [title.chars().count() as f32 * 6.3 + 26.0, 66.4];
    row()
        .key("settings-header")
        .role("heading")
        .label(format!("{title} settings"))
        .w_full()
        .h(40.0)
        .absolute(0.0, 0.0)
        .window_drag()
        .child(
            row()
                .absolute(8.0, 6.0)
                .h(28.0)
                .gap(5.25)
                .child(design::tab_surface(&widths, dark))
                .child(
                    row()
                        .w(widths[0])
                        .h(28.0)
                        .px(13.0)
                        .center_y()
                        .child(text(title).font(TextStyle::new(12.5, 550.0)).color(p.text)),
                )
                .child(
                    row().w(widths[1]).h(28.0).px(10.0).center_y().child(
                        text("Settings")
                            .font(TextStyle::new(11.5, 400.0))
                            .color(p.muted),
                    ),
                ),
        )
}
fn page_title(label: &str, p: design::Palette) -> El {
    text(label)
        .w_full()
        .wrap()
        .font(TextStyle {
            line_height: 32.3,
            ..TextStyle::new(25.5, 700.0)
        })
        .color(p.text)
}
pub fn page(s: &State, dark: bool, side: f32, p: design::Palette, cx: &Cx<State>) -> El {
    let section = s.settings.section;
    let mut list = col().w_full().px(8.0).gap(4.0);
    for (i, label) in SECTIONS.iter().enumerate() {
        let selected = section == i;
        let item = col()
            .key(format!("settings-section-{i}"))
            .role("button")
            .label(*label)
            .focusable(true)
            .padding(10.0)
            .gap(4.0)
            .hover(if selected {
                Color::TRANSPARENT
            } else {
                p.glass
            })
            .child(
                text(*label)
                    .w_full()
                    .truncate()
                    .font(TextStyle::new(13.0, 550.0))
                    .color(p.text),
            )
            .child(
                text(DETAILS[i])
                    .w_full()
                    .wrap()
                    .max_lines(2)
                    .font(TextStyle {
                        line_height: 16.8,
                        ..TextStyle::new(12.0, 400.0)
                    })
                    .color(p.muted),
            )
            .on_press(move |s: &mut State| s.settings.section = i);
        list = list.child(design::sidebar_surface(item, dark, selected));
    }
    let nav = col()
        .key("settings-sidebar")
        .w(side.max(210.0))
        .h_full()
        .min_h(0.0)
        .child(el().h(40.0).w_full().window_drag())
        .child(
            col()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(list),
        )
        .child(ui::footer(s, dark, p));
    let mut body = col()
        .w_full()
        .max_w(680.0)
        .padding(32.0)
        .gap(14.0)
        .child(page_title(SECTIONS[section], p));
    match section {
        0 => {
            let page_width = cx.layout_size("draft-root").map_or(1200.0, |size| size[0]) / s.keyboard.zoom;
            let main_width = (page_width - side.max(210.0) - 1.0).max(1.0);
            let padding = if main_width < 600.0 { 24.0 } else { 32.0 };
            body = col().w_full().max_w(960.0).padding(padding).gap(24.0)
                .child(col().w_full().gap(6.0)
                    .child(page_title("Appearance", p))
                    .child(copy("Choose your light, or let Draft follow your device.", p).wrap()))
                .child(appearance::choices(s, cx, (main_width.min(960.0) - padding * 2.0).max(1.0), dark, p));
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
            let page_width = cx.layout_size("draft-root").map_or(1200.0, |size| size[0]) / s.keyboard.zoom;
            let main_width = (page_width - side.max(210.0) - 1.0).max(1.0);
            let padding = if main_width < 600.0 { 24.0 } else { 32.0 };
            body = col().w_full().max_w(1180.0).padding(padding).gap(24.0)
                .child(col().w_full().gap(6.0)
                    .child(page_title("Keyboard shortcuts", p))
                    .child(copy("Press the keys together. “or” separates alternatives.", p).wrap()))
                .child(shortcut_help::grid(cx, (main_width.min(1180.0) - padding * 2.0).max(1.0), dark, p));
            if let Some(error) = &s.keyboard.shortcut_error { body = body.child(copy(error, p)); }
        }
    }
    row()
        .key("settings-page")
        .w_full()
        .h_full()
        .min_h(0.0)
        .child(nav)
        .child(el().w(1.0).h_full().fill(p.line))
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .h_full()
                .min_h(0.0)
                .child(
                    col()
                        .key(format!("settings-scroll-{section}"))
                        .w_full()
                        .h_full()
                        .min_h(0.0)
                        .scroll(ScrollSpec {
                            stick_bottom: false,
                        })
                        .clip_fade(0.0, 22.0, 0.0, 0.0)
                        .child(
                            col()
                                .w_full()
                                .items_center()
                                .child(el().h(40.0))
                                .child(body),
                        ),
                )
                .child(header(section, dark, p)),
        )
}
