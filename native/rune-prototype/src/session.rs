//! Preferences and navigation survive restarts without writing on the UI thread.
use super::*;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Saved {
    schema_version: u32,
    appearance: String,
    ai: bool,
    source: bool,
    sidebar: bool,
    expanded: bool,
    section: usize,
    zoom: f32,
    viewing: HashMap<String, String>,
    selections: HashMap<String, [usize; 2]>,
    scrolls: HashMap<String, [f32; 2]>,
}
impl Default for Saved {
    fn default() -> Self {
        Self {
            schema_version: 1,
            appearance: "system".into(),
            ai: false,
            source: false,
            sidebar: true,
            expanded: false,
            section: 0,
            zoom: 1.0,
            viewing: HashMap::new(),
            selections: HashMap::new(),
            scrolls: HashMap::new(),
        }
    }
}
type Offset = Rc<Cell<[f32; 2]>>;
#[derive(Default)]
pub struct Persistence {
    offsets: RefCell<HashMap<String, Offset>>,
    observed: Option<Saved>,
    due: Option<Instant>,
    page: String,
    navigation: u64,
    pub error: Option<String>,
}
pub fn load(s: &mut State) {
    let Ok(Some(saved)) = s.host.get::<Option<Saved>>("/session") else {
        return;
    };
    if saved.schema_version != 1 {
        return;
    }
    s.follow_theme = saved.appearance == "system";
    s.dark = saved.appearance == "dark";
    s.source = saved.source;
    s.writing.enabled = saved.ai;
    s.sidebar = saved.sidebar;
    s.expanded = saved.expanded;
    s.settings.section = saved.section.min(settings::SECTIONS.len() - 1);
    if saved.zoom.is_finite() && (0.5..=3.0).contains(&saved.zoom) {
        s.keyboard.zoom = saved.zoom;
    }
    s.keyboard.viewing = saved.viewing;
    for d in &mut s.docs {
        for v in &mut d.versions {
            if let Some(&selection) = saved.selections.get(&v.id) {
                history::select(&mut v.edit, selection);
            }
        }
    }
    for (key, offset) in saved.scrolls {
        if offset.iter().all(|v| v.is_finite() && *v >= 0.0) {
            s.session
                .offsets
                .borrow_mut()
                .insert(key, Rc::new(Cell::new(offset)));
        }
    }
    let active = s.active_version();
    s.focus(active);
}
pub fn snapshot(s: &State) -> Saved {
    Saved {
        schema_version: 1,
        ai: s.writing.enabled,
        appearance: if s.follow_theme {
            "system"
        } else if s.dark {
            "dark"
        } else {
            "light"
        }
        .into(),
        source: s.source,
        sidebar: s.sidebar,
        expanded: s.expanded,
        section: s.settings.section,
        zoom: s.keyboard.zoom,
        viewing: s.keyboard.viewing.clone(),
        selections: s
            .docs
            .iter()
            .flat_map(|d| {
                d.versions
                    .iter()
                    .map(|v| (v.id.clone(), [v.edit.anchor, v.edit.focus]))
            })
            .collect(),
        scrolls: s
            .session
            .offsets
            .borrow()
            .iter()
            .map(|(key, value)| (key.clone(), value.get()))
            .collect(),
    }
}
pub fn watch(s: &State, key: &str, surface: El) -> El {
    let offset = s
        .session
        .offsets
        .borrow_mut()
        .entry(key.into())
        .or_default()
        .clone();
    surface
        .key(key)
        .on_scroll_offset(move |at| offset.set(at.offset))
}
pub fn poll(s: &mut State, tx: &mut Tx) {
    let page = if s.preferences {
        format!("settings-{}", s.settings.section)
    } else {
        s.docs[s.selected].id().to_owned()
    };
    if page != s.session.page {
        s.session.page = page;
        for (key, value) in s.session.offsets.borrow().iter() {
            let [x, y] = value.get();
            tx.scroll_to_instant(key.clone(), x, y);
        }
        if !s.preferences && s.keyboard.navigation != s.session.navigation {
            tx.scroll_into_view(format!(
                "version-{}",
                s.docs[s.selected].versions[s.active_version()].id
            ));
        }
    }
    s.session.navigation = s.keyboard.navigation;
    let current = snapshot(s);
    if s.session.observed.as_ref() != Some(&current) {
        s.session.observed = Some(current);
        s.session.due = Some(Instant::now() + DEBOUNCE);
    }
    if let Some(due) = s.session.due {
        if due <= Instant::now() {
            if let Some(jobs) = &s.jobs {
                let _ = jobs.send(Job::Session(snapshot(s)));
            }
            s.session.due = None;
        } else {
            tx.wake_after(due.saturating_duration_since(Instant::now()));
        }
    }
}

pub fn received(s: &mut State, result: Result<Value, String>) {
    match result {
        Ok(_) => s.session.error = None,
        Err(error) => {
            s.notice = format!("Could not save preferences: {error}");
            s.session.error = Some(s.notice.clone());
            s.session.due = Some(Instant::now() + Duration::from_secs(5));
        }
    }
}
