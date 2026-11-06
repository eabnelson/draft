//! Draft's existing commands, shared by keyboard, native menus, and quick capture.
use super::*;
use std::collections::VecDeque;

const ZOOM: [f32; 13] = [
    0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
];
#[derive(Clone, Copy)]
enum Kind {
    Draft,
    Version,
    Close,
}
struct Command {
    draft: String,
    kind: Kind,
    navigation: u64,
}
pub struct Controls {
    pub app: Option<rune::AppHandle<State>>,
    pub focused: bool,
    quitting: bool,
    pub zoom: f32,
    pub shortcut_error: Option<String>,
    pub viewing: HashMap<String, String>,
    pub navigation: u64,
    pub action: Option<(String, u64)>,
    new_pending: Option<u64>,
    commands: VecDeque<Command>,
}
impl Default for Controls {
    fn default() -> Self {
        let zoom = std::env::var_os("DRAFT_RUNE_DATA_ROOT")
            .and_then(|root| std::fs::read_to_string(PathBuf::from(root).join("window-zoom")).ok())
            .and_then(|value| value.trim().parse::<f32>().ok())
            .filter(|value| ZOOM.contains(value))
            .unwrap_or(1.0);
        Self {
            app: None,
            focused: false,
            quitting: false,
            zoom,
            shortcut_error: None,
            viewing: HashMap::new(),
            navigation: 0,
            action: None,
            new_pending: None,
            commands: VecDeque::new(),
        }
    }
}
impl Controls {
    pub fn idle(&self) -> bool {
        self.new_pending.is_none() && self.commands.is_empty()
    }
}
fn composing(s: &State) -> bool {
    s.docs
        .iter()
        .flat_map(|d| &d.versions)
        .any(|v| v.edit.focused && v.edit.preedit.is_some())
}
fn clear_menus(s: &mut State) {
    s.context = None;
    s.item_menu = None;
    s.attachment = None;
    s.link = None;
}
fn enqueue(s: &mut State, kind: Kind) {
    if composing(s) {
        return;
    }
    clear_menus(s);
    s.keyboard.commands.push_back(Command {
        draft: s.docs[s.selected].id().into(),
        kind,
        navigation: s.keyboard.navigation,
    });
}
fn viewed(s: &State, di: usize) -> usize {
    let d = &s.docs[di];
    let open = d.open_versions();
    s.keyboard
        .viewing
        .get(d.id())
        .and_then(|id| open.iter().copied().find(|&vi| &d.versions[vi].id == id))
        .unwrap_or(*open.last().unwrap())
}
pub fn open_draft(s: &mut State, di: usize, tx: &mut Tx) {
    s.keyboard.navigation += 1;
    clear_menus(s);
    s.preferences = false;
    s.selected = di;
    let vi = viewed(s, di);
    s.focus(vi);
    tx.scroll_into_view(format!("draft-{di}"));
    tx.scroll_into_view(format!("version-{}", s.docs[di].versions[vi].id));
    if let Some(jobs) = &s.jobs {
        let _ = jobs.send(Job::Active(s.docs[di].id().into()));
    }
}
pub fn drain(s: &mut State, tx: &mut Tx) {
    if s.keyboard.new_pending.is_some() || s.docs.iter().any(|d| d.pending_action) {
        return;
    }
    while let Some(command) = s.keyboard.commands.pop_front() {
        let Some(di) = s.docs.iter().position(|d| d.id() == command.draft) else {
            continue;
        };
        match command.kind {
            Kind::Draft => {
                if let Some(jobs) = s.jobs.clone() {
                    s.preferences = false;
                    s.save();
                    s.keyboard.new_pending =
                        jobs.send(Job::New).is_ok().then_some(command.navigation);
                }
            }
            Kind::Version => {
                let vi = if di == s.selected {
                    s.active_version()
                } else {
                    viewed(s, di)
                };
                let version = s.docs[di].versions[vi].id.clone();
                s.keyboard.action = Some((command.draft.clone(), command.navigation));
                items::request_for(
                    s,
                    &command.draft,
                    json!({"kind":"new-version","version":version}),
                );
            }
            Kind::Close => {
                let open = s.docs[di].open_versions();
                if open.len() < 2 {
                    continue;
                }
                let vi = if di == s.selected {
                    s.active_version()
                } else {
                    viewed(s, di)
                };
                let version = s.docs[di].versions[vi].id.clone();
                let at = open.iter().position(|&v| v == vi).unwrap();
                let neighbor = open.get(at + 1).copied().unwrap_or_else(|| open[at - 1]);
                if di == s.selected {
                    s.focus(neighbor);
                    tx.scroll_into_view(format!("version-{}", s.docs[di].versions[neighbor].id));
                } else {
                    s.keyboard.viewing.insert(
                        command.draft.clone(),
                        s.docs[di].versions[neighbor].id.clone(),
                    );
                }
                items::request_for(
                    s,
                    &command.draft,
                    json!({"kind":"close-version","version":version}),
                );
            }
        }
        if s.keyboard.new_pending.is_some() || s.docs.iter().any(|d| d.pending_action) {
            break;
        }
    }
}
pub fn new_draft(s: &mut State, tx: &mut Tx) {
    enqueue(s, Kind::Draft);
    drain(s, tx);
}
fn new_version(s: &mut State, tx: &mut Tx) {
    if !s.preferences {
        enqueue(s, Kind::Version);
        drain(s, tx);
    }
}
fn close_tab(s: &mut State, tx: &mut Tx) {
    if s.preferences {
        s.preferences = false;
        return;
    }
    enqueue(s, Kind::Close);
    drain(s, tx);
}
pub fn accept_new(s: &mut State, result: Result<Library, String>, tx: &mut Tx) {
    let navigation = s.keyboard.new_pending.take();
    let selected_id = s.docs[s.selected].id().to_owned();
    let library = match result {
        Ok(value) => value,
        Err(error) => {
            s.notice = format!("Could not create draft: {error}");
            return;
        }
    };
    s.archived = library.archived;
    if !s.docs.iter().any(|d| d.id() == library.active)
        && let Some(raw) = library
            .drafts
            .into_iter()
            .find(|raw| raw["id"] == library.active)
    {
        let versions = raw["versions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                let value = v["text"].as_str().unwrap();
                Version {
                    id: v["id"].as_str().unwrap().into(),
                    number: v["number"].as_u64().unwrap(),
                    edit: TextEdit::new(value),
                    spans: styled(value),
                    hidden: design::concealed(value),
                    media: media_paths(value),
                }
            })
            .collect();
        s.docs.push(Document {
            raw,
            versions,
            revision: 0,
            seen: library.seq,
            saved: 0,
            queued: None,
            pending_action: false,
            pending_removal: false,
        });
    }
    s.docs.sort_by(|a, b| {
        b.raw["pinned"]
            .as_bool()
            .cmp(&a.raw["pinned"].as_bool())
            .then_with(|| {
                b.raw["updatedAt"]
                    .as_str()
                    .cmp(&a.raw["updatedAt"].as_str())
            })
    });
    let wanted = if !composing(s) && navigation.is_none_or(|n| n == s.keyboard.navigation) {
        &library.active
    } else {
        &selected_id
    };
    if let Some(di) = s.docs.iter().position(|d| d.id() == wanted) {
        let navigation = s.keyboard.navigation;
        open_draft(s, di, tx);
        s.keyboard.navigation = navigation;
    }
    s.notice = "Ready to write".into();
}
fn zoom(s: &mut State, direction: i8) {
    let current = s.keyboard.zoom;
    s.keyboard.zoom = match direction {
        1 => ZOOM
            .iter()
            .copied()
            .find(|&v| v > current + 0.001)
            .unwrap_or(current),
        -1 => ZOOM
            .iter()
            .rev()
            .copied()
            .find(|&v| v < current - 0.001)
            .unwrap_or(current),
        _ => 1.0,
    };
    if let Some(jobs) = &s.jobs {
        let _ = jobs.send(Job::Zoom(s.keyboard.zoom));
        let _ = jobs.send(Job::Session(session::snapshot(s)));
    }
}
fn settings(s: &mut State, _: &mut Tx) {
    clear_menus(s);
    s.preferences = true;
}
pub fn key(s: &mut State, key: &KeyEvent, tx: &mut Tx) -> bool {
    if composing(s) {
        return false;
    }
    if key.key == Key::Tab && key.mods.ctrl && !key.mods.logo && !key.mods.alt {
        clear_menus(s);
        if s.preferences {
            s.settings.cycle(key.mods.shift);
        } else {
            let open = s.docs[s.selected].open_versions();
            s.keyboard.navigation += 1;
            let at = open
                .iter()
                .position(|&vi| vi == s.active_version())
                .unwrap_or(0);
            let vi = open[(at + if key.mods.shift { open.len() - 1 } else { 1 }) % open.len()];
            s.focus(vi);
            tx.scroll_into_view(format!("version-{}", s.docs[s.selected].versions[vi].id));
        }
        return true;
    }
    if !key.mods.alt {
        if key.is_command('+') || key.is_command('=') {
            zoom(s, 1);
            return true;
        }
        if key.is_command('-') && !key.mods.shift {
            zoom(s, -1);
            return true;
        }
        if key.is_command('0') && !key.mods.shift {
            zoom(s, 0);
            return true;
        }
        if key.is_command('w') && key.mods.shift {
            tx.close_window();
            return true;
        }
        if !key.mods.shift {
            if key.is_command('t') {
                new_version(s, tx);
                return true;
            }
            if key.is_command('w') {
                close_tab(s, tx);
                return true;
            }
            if key.is_command('n') {
                new_draft(s, tx);
                return true;
            }
            if key.is_command('s') {
                s.save();
                return true;
            }
            if key.is_command('b') {
                s.sidebar = !s.sidebar;
                return true;
            }
            if key.is_command(',') {
                settings(s, tx);
                return true;
            }
            for n in 1..=9 {
                if key.is_command(char::from(b'0' + n)) {
                    let index = if n == 9 {
                        s.docs.len() - 1
                    } else {
                        (n - 1) as usize
                    };
                    if index < s.docs.len() {
                        open_draft(s, index, tx);
                    }
                    return true;
                }
            }
        }
    }
    if key.key == Key::Escape && (s.preferences || s.context.is_some() || s.item_menu.is_some()) {
        s.preferences = false;
        clear_menus(s);
        return true;
    }
    false
}
fn quick_draft(s: &mut State, tx: &mut Tx) {
    let Some(app) = s.keyboard.app.clone() else {
        return;
    };
    if s.keyboard.focused && app.is_visible() {
        app.hide();
        s.keyboard.focused = false;
    } else {
        new_draft(s, tx);
        if let Some(token) = tx.activation_token() {
            app.activate(token);
        } else {
            app.open();
        }
    }
}
pub fn app() -> App<State> {
    let mut app = App::new(ui::spec())
        .keep_running()
        .on_focus(|s, focused, _| s.keyboard.focused = focused)
        .global_shortcut("alt+.", quick_draft);
    for (id, title, menu, chord, action) in [
        (
            "new-draft",
            "New Draft",
            "File",
            "cmd+n",
            new_draft as fn(&mut State, &mut Tx),
        ),
        ("new-version", "New Version", "File", "cmd+t", new_version),
        ("close-tab", "Close Tab", "File", "cmd+w", close_tab),
        (
            "close-window",
            "Close Window",
            "File",
            "cmd+shift+w",
            |_, tx| tx.close_window(),
        ),
        ("settings", "Settings…", "", "cmd+,", settings),
        ("save", "Save", "File", "cmd+s", |s, _| s.save()),
        ("sidebar", "Toggle Sidebar", "View", "cmd+b", |s, _| {
            s.sidebar = !s.sidebar
        }),
        ("zoom-in", "Zoom In", "View", "cmd+shift+=", |s, _| {
            zoom(s, 1)
        }),
        ("zoom-out", "Zoom Out", "View", "cmd+-", |s, _| zoom(s, -1)),
        ("zoom-reset", "Actual Size", "View", "cmd+0", |s, _| {
            zoom(s, 0)
        }),
    ] {
        let mut item = rune::MenuItem::new(title, action)
            .id(id)
            .key_equivalent(chord.parse().unwrap())
            .keys_first();
        if !menu.is_empty() {
            item = item.menu(menu);
        }
        app = app.menu_item(item);
    }
    let handle = app.handle();
    app = app.init(move || {
        let mut state = State::load();
        state.keyboard.app = Some(handle);
        state
    });
    if std::env::args().any(|a| a == "--hidden") {
        app = app.windowless();
    }
    app.args(std::env::args().skip(1).filter(|a| a != "--hidden"))
}

pub fn quit(s: &mut State, tx: &mut Tx) {
    if s.keyboard.quitting {
        return;
    }
    s.keyboard.quitting = true;
    match s.flush(tx) {
        Ok(()) => tx.quit(),
        Err(error) => {
            s.keyboard.quitting = false;
            s.notice = format!("Could not save before quitting: {error}");
        }
    }
}
