//! Sidebar and tab menus target stable document/version IDs, not the active editor.
use super::*;

pub(super) struct Context {
    pub draft: String,
    pub version: Option<String>,
    pub at: [f32; 2],
    mode: Mode,
}
enum Mode {
    Actions,
    Rename(Box<TextEdit>),
    Delete,
}

pub(super) fn stage(d: &Document) -> &'static str {
    match d.raw["manualStage"].as_str() {
        Some("idea") => "Idea",
        Some("drafting") => "Drafting",
        Some("ready") => "Ready",
        Some("live") => "Live",
        _ if d.raw["publications"]
            .as_array()
            .is_some_and(|ps| !ps.is_empty()) =>
        {
            "Live"
        }
        _ if d.versions.len() == 1
            && design::prose(&d.versions[0].edit.text)
                .split_whitespace()
                .count()
                < 50 =>
        {
            "Idea"
        }
        _ => "Drafting",
    }
}

pub(super) fn open(s: &mut State, di: usize, vi: Option<usize>, at: [f32; 2]) {
    s.preferences = false;
    s.context = None;
    s.item_menu = Some(Context {
        draft: s.docs[di].id().into(),
        version: vi.map(|vi| s.docs[di].versions[vi].id.clone()),
        at,
        mode: Mode::Actions,
    });
}

pub(super) fn retarget(s: &mut State, picked: Option<rune::Picked>, at: [f32; 2]) {
    let Some(picked) = picked else { return };
    for key in picked.path().split('/').rev() {
        if let Some(id) = key
            .strip_prefix("sidebar-version-")
            .or_else(|| key.strip_prefix("tab-"))
        {
            if let Some((di, vi)) = s.docs.iter().enumerate().find_map(|(di, d)| {
                d.versions
                    .iter()
                    .position(|v| v.id == id)
                    .map(|vi| (di, vi))
            }) {
                open(s, di, Some(vi), at);
                return;
            }
        } else if let Some(id) = key.strip_prefix("draft-group-") {
            if let Some(di) = s.docs.iter().position(|d| d.id() == id) {
                open(s, di, None, at);
                return;
            }
        } else if let Some(id) = key.strip_prefix("editor-")
            && let Some(vi) = s.docs[s.selected].versions.iter().position(|v| v.id == id)
        {
            s.focus(vi);
            s.context = Some(at);
            return;
        }
    }
}

pub(super) fn activate(s: &mut State, di: usize, vi: usize, tx: &mut Tx) {
    s.keyboard.navigation += 1;
    if !s.docs[di].open_versions().contains(&vi) {
        let id = s.docs[di].id().to_owned();
        let version = s.docs[di].versions[vi].id.clone();
        request_for(s, &id, json!({"kind":"open-version","version":version}));
    } else {
        s.selected = di;
        s.focus(vi);
        tx.scroll_into_view(format!("version-{}", s.docs[di].versions[vi].id));
    }
}

fn request(s: &mut State, action: Value, _: &mut Tx) {
    let Some(context) = s.item_menu.take() else {
        return;
    };
    request_for(s, &context.draft, action);
}
pub(super) fn request_for(s: &mut State, id: &str, action: Value) {
    let Some(d) = s.docs.iter_mut().find(|d| d.id() == id) else {
        return;
    };
    if d.pending_action {
        return;
    }
    if let Some(jobs) = &s.jobs {
        if jobs
            .send(Job::PrepareAction(id.into(), action.clone()))
            .is_ok()
        {
            d.pending_action = true;
            d.pending_removal = matches!(
                action["kind"].as_str(),
                Some("archive" | "delete" | "delete-version")
            );
            s.generation += 1;
            s.notice = "Updating draft…".into();
        } else {
            s.notice = "Draft change could not start; keep this window open".into();
        }
    }
}

pub(super) fn prepared(s: &mut State, id: &str, action: Value) {
    let Some(d) = s.docs.iter_mut().find(|d| d.id() == id) else {
        return;
    };
    // Earlier image jobs have now replied and inserted their references. Only
    // now capture the snapshot for the action on the same serial worker.
    if let Some(jobs) = &s.jobs
        && jobs
            .send(Job::Action(id.into(), d.revision, d.snapshot(), action))
            .is_err()
    {
        d.pending_action = false;
        d.pending_removal = false;
        s.notice = "Draft change could not start; keep this window open".into();
    }
}
fn action_item(s: &State, key: &str, label: &str, p: design::Palette, action: Value) -> El {
    let context = s.item_menu.as_ref().unwrap();
    let pending = s
        .docs
        .iter()
        .find(|d| d.id() == context.draft)
        .is_none_or(|d| d.pending_action);
    ui::menu_item(key, label, p, move |s, tx| request(s, action.clone(), tx)).disabled(pending)
}
fn heading(label: &str, p: design::Palette) -> El {
    text(label)
        .font(TextStyle::new(11.0, 500.0))
        .color(p.muted)
        .px(10.0)
        .py(6.0)
}
fn begin_rename(s: &mut State) {
    let Some(context) = &mut s.item_menu else {
        return;
    };
    let Some(d) = s.docs.iter().find(|d| d.id() == context.draft) else {
        return;
    };
    let name = if let Some(id) = &context.version {
        let Some(vi) = d.versions.iter().position(|v| &v.id == id) else {
            return;
        };
        d.raw["versions"][vi]["name"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| design::title(&d.versions[vi].edit.text))
    } else {
        d.raw["title"].as_str().unwrap_or("").into()
    };
    let mut edit = TextEdit::new(name);
    edit.focused = true;
    edit.anchor = 0;
    edit.focus = edit.text.len();
    context.mode = Mode::Rename(Box::new(edit));
}
fn rename(s: &mut State, tx: &mut Tx) {
    let Some(context) = &s.item_menu else { return };
    let Mode::Rename(edit) = &context.mode else {
        return;
    };
    request(
        s,
        json!({"kind":"rename","version":context.version,"value":edit.text}),
        tx,
    );
}

pub(super) fn menu(s: &State, surface: El, p: design::Palette) -> El {
    let context = s.item_menu.as_ref().unwrap();
    let Some(d) = s.docs.iter().find(|d| d.id() == context.draft) else {
        return surface;
    };
    let version = context.version.as_ref();
    let mut content = col().w_full();
    match &context.mode {
        Mode::Rename(edit) => {
            content = content
                .child(heading(
                    if version.is_some() {
                        "Rename version"
                    } else {
                        "Rename draft"
                    },
                    p,
                ))
                .child(
                    text_input(edit, TextStyle::new(13.0, 400.0))
                        .key("item-name")
                        .label("Name")
                        .single_line()
                        .w_full()
                        .min_h(34.0)
                        .padding(8.0)
                        .radius(9.0)
                        .fill(p.glass)
                        .color(p.text)
                        .on_edit(|s: &mut State| {
                            let Mode::Rename(edit) = &mut s.item_menu.as_mut().unwrap().mode else {
                                unreachable!()
                            };
                            edit
                        })
                        .on_input_key(|s: &mut State, key, tx| {
                            if key.key == Key::Escape {
                                s.item_menu = None;
                                return true;
                            }
                            if key.key == Key::Enter {
                                if let Some(Context {
                                    mode: Mode::Rename(edit),
                                    ..
                                }) = &s.item_menu
                                    && edit.preedit.is_some()
                                {
                                    return false;
                                }
                                rename(s, tx);
                                return true;
                            }
                            false
                        }),
                )
                .child(ui::menu_item("item-name-save", "Save name", p, rename))
                .child(ui::menu_item("item-cancel", "Cancel", p, |s, _| {
                    s.item_menu = None
                }));
        }
        Mode::Delete => {
            content = content
                .child(heading(if version.is_some() { "Delete this version?" } else { "Delete this draft?" }, p))
                .child(text("Its writing moves to Draft’s Recovery folder.")
                    .w_full().px(10.0).py(6.0).font(TextStyle::new(12.0, 400.0)).color(p.muted))
                .child(action_item(s, "item-delete-confirm", "Delete", p, json!({
                    "kind":if version.is_some() { "delete-version" } else { "delete" }, "version":version
                })))
                .child(ui::menu_item("item-cancel", "Cancel", p, |s, _| s.item_menu = None));
        }
        Mode::Actions => {
            let title = version
                .and_then(|id| d.versions.iter().find(|v| &v.id == id))
                .map(|v| format!("Version {}", v.number))
                .unwrap_or_else(|| d.raw["title"].as_str().unwrap_or("Untitled draft").into());
            content = content.child(heading(&title, p));
            if version.is_none() {
                let id = context.draft.clone();
                content = content.child(ui::menu_item("draft-open", "Open", p, move |s, tx| {
                    if let Some(di) = s.docs.iter().position(|d| d.id() == id) {
                        s.selected = di;
                        s.expanded = true;
                        let vi = s.docs[di].open_versions()[0];
                        s.focus(vi);
                        tx.scroll_into_view(format!("version-{}", s.docs[di].versions[vi].id));
                    }
                    s.item_menu = None;
                }));
            }
            content = content
                .child(
                    ui::menu_item("item-rename", "Rename", p, |s, _| begin_rename(s))
                        .disabled(d.pending_action),
                )
                .child(action_item(
                    s,
                    "item-new-version",
                    "New version",
                    p,
                    json!({"kind":"new-version","version":version.cloned().unwrap_or_else(|| {
                        let vi = if s.docs[s.selected].id() == d.id() { s.active_version() } else { d.open_versions()[0] };
                        d.versions[vi].id.clone()
                    })}),
                ));
            if let Some(id) = version {
                let open = d.open_versions();
                let is_open = open.iter().any(|&vi| &d.versions[vi].id == id);
                content = content.child(
                    action_item(
                        s,
                        "version-close",
                        "Close tab",
                        p,
                        json!({"kind":"close-version","version":id}),
                    )
                    .disabled(!is_open || open.len() < 2),
                );
            } else {
                content = content.child(action_item(
                    s,
                    "draft-pin",
                    if d.raw["pinned"] == true {
                        "Unpin"
                    } else {
                        "Pin"
                    },
                    p,
                    json!({"kind":"pin"}),
                ));
                if d.versions.len() > 1 {
                    content = content.child(heading("Versions", p));
                    for (vi, v) in d.versions.iter().enumerate() {
                        content = content.child(action_item(
                            s,
                            &format!("open-version-{}", v.id),
                            &d.version_title(vi),
                            p,
                            json!({"kind":"open-version","version":v.id}),
                        ));
                    }
                }
                content = content
                    .child(el().w_full().h(1.0).fill(p.line))
                    .child(heading("Status", p));
                for (stage, label) in [
                    ("idea", "Idea"),
                    ("drafting", "Drafting"),
                    ("ready", "Ready"),
                    ("live", "Live"),
                ] {
                    content = content.child(action_item(
                        s,
                        &format!("stage-{stage}"),
                        label,
                        p,
                        json!({"kind":"stage","value":stage}),
                    ));
                }
                content = content
                    .child(el().w_full().h(1.0).fill(p.line))
                    .child(ui::menu_item("draft-export", "Export…", p, |s, tx| {
                        let id = s.item_menu.take().unwrap().draft;
                        tx.open_folder(
                            rune::FileDialogOptions {
                                title: "Export draft".into(),
                                ..Default::default()
                            },
                            move |s: &mut State, result, _| match result {
                                Ok(Some(path)) => {
                                    request_for(s, &id, json!({"kind":"export","destination":path}))
                                }
                                Ok(None) => {}
                                Err(e) => s.notice = format!("Could not export: {e}"),
                            },
                        );
                    }))
                    .child(action_item(
                        s,
                        "draft-archive",
                        "Archive",
                        p,
                        json!({"kind":"archive"}),
                    ));
            }
            let protected = version.is_some_and(|id| {
                d.versions.len() < 2
                    || d.raw["publications"]
                        .as_array()
                        .is_some_and(|ps| ps.iter().any(|p| p["versionId"].as_str() == Some(id)))
            });
            content = content.child(el().w_full().h(1.0).fill(p.line)).child(
                ui::menu_item(
                    "item-delete",
                    if version.is_some() {
                        "Delete version…"
                    } else {
                        "Delete draft…"
                    },
                    p,
                    |s, _| {
                        if let Some(context) = &mut s.item_menu {
                            context.mode = Mode::Delete;
                        }
                    },
                )
                .disabled(protected || d.pending_action),
            );
        }
    }
    surface.child(
        col()
            .w_full()
            .min_h(0.0)
            .shrink()
            .scroll(ScrollSpec {
                stick_bottom: false,
            })
            .child(content),
    )
}

pub(super) fn finish(
    s: &mut State,
    id: &str,
    revision: u64,
    result: Result<ActionResult, String>,
    tx: &mut Tx,
) {
    let Some(di) = s.docs.iter().position(|d| d.id() == id) else {
        return;
    };
    s.docs[di].pending_action = false;
    s.docs[di].pending_removal = false;
    let mut result = match result {
        Ok(result) => result,
        Err(e) => {
            if s.keyboard
                .action
                .as_ref()
                .is_some_and(|(draft, _)| draft == id)
            {
                s.keyboard.action = None;
            }
            s.notice = format!("Could not change draft: {e}");
            return;
        }
    };
    if let Some((draft, navigation)) = &s.keyboard.action
        && draft == id
    {
        if *navigation != s.keyboard.navigation
            || s.docs[s.selected].id() != id
            || s.docs[s.selected]
                .versions
                .iter()
                .any(|v| v.edit.focused && v.edit.preedit.is_some())
        {
            result.focus = None;
        }
        s.keyboard.action = None;
    }
    let selected = s.docs[s.selected].id().to_owned();
    let active = s.docs[s.selected].versions[s.active_version()].id.clone();
    let mut doc = s.docs.remove(di);
    s.archived = result.library.archived;
    if let Some(raw) = result.library.drafts.iter().find(|d| d["id"] == id) {
        let mut old: HashMap<_, _> = doc
            .versions
            .into_iter()
            .map(|v| (v.id.clone(), v))
            .collect();
        doc.versions = raw["versions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                let id = v["id"].as_str().unwrap().to_owned();
                // Menu replies carry metadata/structure. Keep newer typing, selection,
                // composition and undo in every version that still exists.
                old.remove(&id).unwrap_or_else(|| {
                    let text = v["text"].as_str().unwrap();
                    Version {
                        id,
                        number: v["number"].as_u64().unwrap(),
                        edit: TextEdit::new(text),
                        spans: styled(text),
                        hidden: design::concealed(text),
                        media: media_paths(text),
                    }
                })
            })
            .collect();
        doc.raw = raw.clone();
        doc.revision += 1;
        doc.saved = revision + 1;
        doc.queued = None;
        s.docs.insert(di, doc);
    }
    if s.docs.is_empty() {
        s.install(result.library);
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
    let selected_id = if result.focus.is_some() {
        id
    } else {
        &selected
    };
    s.selected = s
        .docs
        .iter()
        .position(|d| d.id() == selected_id)
        .unwrap_or(0);
    let open = s.docs[s.selected].open_versions();
    let wanted = result.focus.as_deref().unwrap_or(&active);
    let vi = open
        .iter()
        .copied()
        .find(|&vi| s.docs[s.selected].versions[vi].id == wanted)
        .unwrap_or(open[0]);
    s.active = vi;
    if result.focus.is_some()
        || s.docs[s.selected].id() != selected
        || s.docs[s.selected].versions[vi].id != active
    {
        s.expanded = true;
        s.focus(vi);
        tx.scroll_into_view(format!("version-{}", s.docs[s.selected].versions[vi].id));
    }
    s.refresh_images();
    s.generation += 1;
    s.notice = result.message;
}
