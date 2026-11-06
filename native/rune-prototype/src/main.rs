//! Disposable native frontend. Draft's Markdown store stays authoritative.
use pulldown_cmark::{Event, Parser, Tag};
use rune::tok::{self, TextStyle};
use rune::{
    App, AppSpec, Color, Cx, El, Image, ImageCache, Key, KeyEvent, ScrollSpec, Span, TextEdit, Tx,
    Waker, col, el, row, text, text_input,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant},
};

const DEBOUNCE: Duration = Duration::from_millis(600);
const BODY: TextStyle = TextStyle {
    line_height: 32.3,
    ..TextStyle::new(17.0, 400.0)
};

#[derive(Clone)]
struct Host {
    url: String,
    token: String,
    agent: ureq::Agent,
}
impl Host {
    fn from_env() -> Self {
        Self {
            url: std::env::var("DRAFT_RUNE_HOST").expect("Start with bun run rune:dev"),
            token: std::env::var("DRAFT_RUNE_TOKEN").expect("Prototype host token"),
            agent: ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(10)))
                .build()
                .into(),
        }
    }
    fn library(&self) -> Result<Library, String> {
        self.get("/library")
    }
    fn get<R: for<'a> Deserialize<'a>>(&self, path: &str) -> Result<R, String> {
        self.agent
            .get(format!("{}{path}", self.url))
            .header("Authorization", format!("Bearer {}", self.token))
            .call()
            .map_err(|e| e.to_string())?
            .body_mut()
            .read_json()
            .map_err(|e| e.to_string())
    }
    fn post<T: Serialize, R: for<'a> Deserialize<'a>>(
        &self,
        path: &str,
        value: &T,
    ) -> Result<R, String> {
        self.agent
            .post(format!("{}{path}", self.url))
            .header("Authorization", format!("Bearer {}", self.token))
            .send_json(value)
            .map_err(|e| e.to_string())?
            .body_mut()
            .read_json()
            .map_err(|e| e.to_string())
    }
    fn save(&self, draft: &Value) -> Result<(), String> {
        self.post::<_, Value>("/save", &json!({"draft": draft}))
            .map(|_| ())
    }
    fn media(&self, id: &str, bytes: &[u8]) -> Result<String, String> {
        let result: Value = self
            .agent
            .post(format!("{}/media/{id}", self.url))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "image/png")
            .send(bytes)
            .map_err(|e| e.to_string())?
            .body_mut()
            .read_json()
            .map_err(|e| e.to_string())?;
        result["src"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "Image response missing its path".into())
    }
}

#[derive(Deserialize)]
struct Library {
    active: String,
    drafts: Vec<Value>,
    archived: usize,
}
#[derive(Deserialize)]
struct ActionResult {
    library: Library,
    focus: Option<String>,
    message: String,
}
struct Version {
    id: String,
    number: u64,
    edit: TextEdit,
    spans: Vec<Span>,
    hidden: Vec<Span>,
    media: Vec<String>,
}
struct Document {
    raw: Value,
    versions: Vec<Version>,
    revision: u64,
    saved: u64,
    queued: Option<u64>,
    pending_action: bool,
    pending_removal: bool,
}
impl Document {
    fn id(&self) -> &str {
        self.raw["id"].as_str().unwrap()
    }
    fn snapshot(&self) -> Value {
        let mut raw = self.raw.clone();
        for (record, version) in raw["versions"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .zip(&self.versions)
        {
            record["text"] = json!(version.edit.text);
        }
        raw
    }
    fn open_versions(&self) -> Vec<usize> {
        let hidden = self.raw["hiddenVersions"].as_array();
        let mut open: Vec<_> = self
            .versions
            .iter()
            .enumerate()
            .filter_map(|(i, v)| {
                (!hidden.is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(&v.id))))
                    .then_some(i)
            })
            .collect();
        if open.is_empty() {
            open.push(self.versions.len() - 1);
        }
        open
    }
    fn version_title(&self, vi: usize) -> String {
        self.raw["versions"][vi]["name"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| design::title(&self.versions[vi].edit.text))
    }
}
enum Job {
    Save(String, u64, Value),
    Reload(u64),
    New,
    Active(String),
    Zoom(f32),
    Restore(u64),
    PrepareAction(String, Value),
    Action(String, u64, Value, Value),
    Image {
        draft: String,
        version: String,
        selection: (usize, usize),
        before: String,
        bytes: Vec<u8>,
    },
    Barrier(mpsc::Sender<()>),
}
enum Reply {
    New(Result<Library, String>),
    Active(Result<Value, String>),
    Zoom(Result<(), String>),
    Sync(settings::Update),
    Saved(String, u64, Result<(), String>),
    Library(u64, Result<Library, String>),
    PrepareAction(String, Value),
    Action(String, u64, Result<ActionResult, String>),
    Image {
        draft: String,
        version: String,
        selection: (usize, usize),
        before: String,
        result: Result<String, String>,
    },
}
struct State {
    keyboard: keyboard::Controls,
    host: Host,
    docs: Vec<Document>,
    selected: usize,
    active: usize,
    dark: bool,
    source: bool,
    follow_theme: bool,
    sidebar: bool,
    expanded: bool,
    archived: usize,
    preferences: bool,
    settings: settings::Preferences,
    context: Option<[f32; 2]>,
    item_menu: Option<items::Context>,
    generation: u64,
    due: Option<Instant>,
    notice: String,
    jobs: Option<mpsc::Sender<Job>>,
    replies: Option<mpsc::Receiver<Reply>>,
    cache: Option<ImageCache>,
    images: HashMap<PathBuf, Image>,
}
fn styled(source: &str) -> Vec<Span> {
    // Decorations never mutate stored Markdown or the editor's history.
    let mut spans = Vec::new();
    for (event, range) in Parser::new(source).into_offset_iter() {
        let span = Span::new(range.start, range.end);
        match event {
            Event::Start(Tag::Heading { level, .. }) => spans.push(span.bold().size(match level {
                pulldown_cmark::HeadingLevel::H1 => 25.5,
                pulldown_cmark::HeadingLevel::H2 => 22.1,
                _ => 19.55,
            })),
            Event::Start(Tag::Strong) => spans.push(span.bold()),
            Event::Start(Tag::Emphasis) => spans.push(span.italic()),
            Event::Code(_) | Event::Start(Tag::CodeBlock(_)) => spans.push(span.mono()),
            Event::Start(Tag::Link { .. }) => spans.push(span.underline(tok::accent(0, false))),
            _ => {}
        }
    }
    spans
}
fn media_paths(source: &str) -> Vec<String> {
    Parser::new(source)
        .filter_map(|event| match event {
            Event::Start(Tag::Image { dest_url, .. }) => {
                let name = dest_url.strip_prefix("media/")?;
                (name.len() < 80
                    && !name.is_empty()
                    && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.'))
                .then(|| dest_url.to_string())
            }
            _ => None,
        })
        .collect()
}
impl State {
    fn load() -> Self {
        let host = Host::from_env();
        let library = host.library().expect("Load disposable Draft library");
        let mut s = Self {
            keyboard: keyboard::Controls::default(),
            host,
            docs: vec![],
            selected: 0,
            active: 0,
            dark: true,
            source: false,
            follow_theme: false,
            sidebar: true,
            expanded: false,
            archived: 0,
            preferences: false,
            settings: settings::Preferences::default(),
            context: None,
            item_menu: None,
            generation: 0,
            due: None,
            notice: "All changes saved".into(),
            jobs: None,
            replies: None,
            cache: None,
            images: HashMap::new(),
        };
        s.install(library);
        s
    }
    fn install(&mut self, library: Library) {
        self.archived = library.archived;
        // Equal save echoes retain each buffer's selection, composition and undo history.
        let selected_id = self
            .docs
            .get(self.selected)
            .map(|d| d.id().to_owned())
            .unwrap_or(library.active);
        let mut old: HashMap<String, Document> = std::mem::take(&mut self.docs)
            .into_iter()
            .map(|d| (d.id().to_owned(), d))
            .collect();
        for raw in library.drafts {
            let previous = old.remove(raw["id"].as_str().unwrap());
            let revision = previous.as_ref().map_or(0, |d| d.revision);
            let mut versions: HashMap<String, Version> = previous
                .map(|d| d.versions.into_iter().map(|v| (v.id.clone(), v)).collect())
                .unwrap_or_default();
            let buffers = raw["versions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| {
                    let id = v["id"].as_str().unwrap().to_owned();
                    let value = v["text"].as_str().unwrap();
                    if let Some(previous) = versions.remove(&id).filter(|v| v.edit.text == value) {
                        return previous;
                    }
                    Version {
                        id,
                        number: v["number"].as_u64().unwrap(),
                        edit: TextEdit::new(value),
                        spans: styled(value),
                        hidden: design::concealed(value),
                        media: media_paths(value),
                    }
                })
                .collect();
            self.docs.push(Document {
                raw,
                versions: buffers,
                revision,
                saved: revision,
                queued: None,
                pending_action: false,
                pending_removal: false,
            });
        }
        self.docs.sort_by(|a, b| {
            b.raw["pinned"]
                .as_bool()
                .cmp(&a.raw["pinned"].as_bool())
                .then_with(|| {
                    b.raw["updatedAt"]
                        .as_str()
                        .cmp(&a.raw["updatedAt"].as_str())
                })
        });
        self.selected = self
            .docs
            .iter()
            .position(|d| d.id() == selected_id)
            .unwrap_or(0);
        self.active = 0;
        self.refresh_images();
    }
    fn image_path(&self, draft: &str, source: &str) -> PathBuf {
        PathBuf::from(std::env::var_os("DRAFT_RUNE_DATA_ROOT").unwrap())
            .join("Drafts")
            .join(format!("{draft}.draft"))
            .join(source)
    }
    fn refresh_images(&mut self) {
        let paths: Vec<_> = self
            .docs
            .iter()
            .flat_map(|d| {
                d.versions
                    .iter()
                    .flat_map(|v| v.media.iter().map(|src| self.image_path(d.id(), src)))
            })
            .collect();
        if let Some(cache) = &self.cache {
            for path in paths {
                self.images
                    .entry(path.clone())
                    .or_insert_with(|| cache.file(path, 400.0, 2.0));
            }
        }
    }
    fn edited(&mut self, doc: usize, version: usize, tx: &mut Tx) {
        let id = self.docs[doc].id().to_owned();
        let viewed = self.docs[doc].versions[version].id.clone();
        if doc == self.selected && self.keyboard.viewing.get(&id).is_some_and(|v| v != &viewed) {
            self.keyboard.navigation += 1;
        }
        self.keyboard.viewing.insert(id, viewed);
        self.active = version;
        self.generation += 1;
        let d = &mut self.docs[doc];
        d.revision += 1;
        d.versions[version].spans = styled(&d.versions[version].edit.text);
        d.versions[version].hidden = design::concealed(&d.versions[version].edit.text);
        d.versions[version].media = media_paths(&d.versions[version].edit.text);
        self.due = Some(Instant::now() + DEBOUNCE);
        self.notice = "Saving…".into();
        tx.wake_after(DEBOUNCE);
        self.refresh_images();
    }
    fn active_version(&self) -> usize {
        self.docs[self.selected]
            .versions
            .iter()
            .position(|v| v.edit.focused)
            .or_else(|| {
                self.keyboard
                    .viewing
                    .get(self.docs[self.selected].id())
                    .and_then(|id| {
                        self.docs[self.selected]
                            .versions
                            .iter()
                            .position(|v| &v.id == id)
                    })
            })
            .filter(|vi| self.docs[self.selected].open_versions().contains(vi))
            .unwrap_or_else(|| {
                self.docs[self.selected]
                    .open_versions()
                    .into_iter()
                    .find(|&vi| vi == self.active)
                    .unwrap_or(self.docs[self.selected].open_versions()[0])
            })
    }
    fn focus(&mut self, version: usize) {
        self.keyboard.viewing.insert(
            self.docs[self.selected].id().into(),
            self.docs[self.selected].versions[version].id.clone(),
        );
        for doc in &mut self.docs {
            for v in &mut doc.versions {
                v.edit.focused = false;
            }
        }
        self.active = version;
        self.docs[self.selected].versions[version].edit.focused = true;
    }
    fn format(&mut self, marker: &str, tx: &mut Tx) {
        self.format_pair(marker, marker, tx);
    }
    fn format_pair(&mut self, opening: &str, closing: &str, tx: &mut Tx) {
        let version = self.active_version();
        let edit = &mut self.docs[self.selected].versions[version].edit;
        if edit.preedit.is_some() {
            return;
        }
        let (from, to) = edit.range();
        let selected = edit.selected().to_owned();
        let n = opening.len();
        let m = closing.len();
        edit.undo_group(|e| {
            if selected.starts_with(opening)
                && selected.ends_with(closing)
                && selected.len() >= n + m
            {
                e.insert(&selected[n..selected.len() - m]);
                e.anchor = from;
                e.focus = to - n - m;
            } else if from >= n
                && e.text[..from].ends_with(opening)
                && e.text[to..].starts_with(closing)
            {
                e.anchor = from - n;
                e.focus = to + m;
                e.insert(&selected);
                e.anchor = from - n;
                e.focus = to - n;
            } else {
                e.insert(&format!("{opening}{selected}{closing}"));
                e.anchor = from + n;
                e.focus = to + n;
            }
        });
        self.focus(version);
        self.edited(self.selected, version, tx);
    }
    fn save(&mut self) {
        for d in &mut self.docs {
            if d.revision != d.saved
                && d.queued.is_none()
                && !d.pending_action
                && let Some(jobs) = &self.jobs
            {
                if jobs
                    .send(Job::Save(d.id().into(), d.revision, d.snapshot()))
                    .is_ok()
                {
                    d.queued = Some(d.revision);
                } else {
                    self.notice = "Save worker stopped; keep this window open".into();
                }
            }
        }
    }
    fn reload(&mut self, new: bool) {
        if self.docs.iter().any(|d| d.pending_action) {
            self.notice = "Finishing the draft change…".into();
            return;
        }
        // Place snapshots after older saves and before the reload on one worker queue.
        if let Some(jobs) = &self.jobs {
            for d in &self.docs {
                let _ = jobs.send(Job::Save(d.id().into(), d.revision, d.snapshot()));
            }
            let _ = jobs.send(if new {
                Job::New
            } else {
                Job::Reload(self.generation)
            });
        }
    }
    fn paste_image(&mut self, doc: usize, version: usize, bytes: Vec<u8>, tx: &mut Tx) {
        let d = &self.docs[doc];
        let edit = &d.versions[version].edit;
        if let Some(jobs) = &self.jobs {
            let _ = jobs.send(Job::Image {
                draft: d.id().into(),
                version: d.versions[version].id.clone(),
                selection: edit.range(),
                before: edit.text.clone(),
                bytes,
            });
        }
        self.notice = "Pasting image…".into();
        tx.wake_after(Duration::from_millis(100));
    }
    fn barrier(&self) -> Result<(), String> {
        let (done, wait) = mpsc::channel();
        self.jobs
            .as_ref()
            .ok_or("Save worker unavailable")?
            .send(Job::Barrier(done))
            .map_err(|e| e.to_string())?;
        wait.recv_timeout(Duration::from_secs(15))
            .map_err(|e| e.to_string())
    }
    fn flush(&mut self, tx: &mut Tx) -> Result<(), String> {
        self.barrier()?;
        ui::poll(self, 0.0, tx); // Finish pending media insertions before the final save.
        while !self.keyboard.idle() || self.docs.iter().any(|d| d.pending_action) {
            self.barrier()?;
            ui::poll(self, 0.0, tx);
        }
        for d in &self.docs {
            self.jobs
                .as_ref()
                .unwrap()
                .send(Job::Save(d.id().into(), d.revision, d.snapshot()))
                .map_err(|e| e.to_string())?;
        }
        self.barrier()?;
        ui::poll(self, 0.0, tx);
        if self.docs.iter().any(|d| d.revision != d.saved) {
            return Err(self.notice.clone());
        }
        Ok(())
    }
}

mod design;
mod glass;
mod items;
mod keyboard;
mod settings;
mod shortcut_help;
mod ui;
mod verify;

fn main() {
    if std::env::args().any(|a| a == "--verify") {
        verify::run();
        return;
    }
    rune::set_app_id("com.studiofour.draft.rune-prototype");
    keyboard::app()
        .compositor(glass::Glass::default())
        .chrome(rune::Chrome {
            full_size_content: true,
            traffic_lights: Some((16.0, 13.0)),
            drag_regions: true,
        })
        .window_options(rune::WindowOptions {
            transparent: true,
            ..Default::default()
        })
        .font_smoothing(rune::FontSmoothing::Off)
        .standard_menus()
        .tab_visits_controls(true)
        .on_close(|s, tx| {
            // Only closing flushes synchronously; ordinary typing never waits for the host.
            if let Err(e) = s.flush(tx) {
                for d in &s.docs {
                    let recovery = PathBuf::from(std::env::var_os("DRAFT_RUNE_DATA_ROOT").unwrap())
                        .join(format!("{}-unsaved.json", d.id()));
                    let _ = std::fs::write(&recovery, d.snapshot().to_string());
                    eprintln!("Save failed: {e}; recovery: {}", recovery.display());
                }
            }
        })
        .run();
}
