use super::*;

pub(super) fn setup(s: &mut State, waker: Waker) {
    s.cache = Some(ImageCache::new(waker.clone()));
    s.refresh_images();
    let (jobs, receive) = mpsc::channel();
    let (send, replies) = mpsc::channel();
    let host = s.host.clone();
    s.jobs = Some(jobs);
    s.replies = Some(replies);
    settings::setup(s, send.clone(), waker.clone());
    services::setup(s, send.clone(), waker.clone());
    spelling::setup(s, send.clone(), waker.clone());
    writing::setup(s, send.clone(), waker.clone());
    sync::setup(s, send.clone(), waker.clone());
    std::thread::spawn(move || {
        let mut failed_saves = std::collections::HashSet::new();
        while let Ok(job) = receive.recv() {
            let reply = match job {
                Job::Save(id, revision, value, seen, buffers) => {
                    let histories: HashMap<_, _> = buffers
                        .into_iter()
                        .map(|(id, edit)| (id, history::capture(&edit)))
                        .collect();
                    let result = host.post::<_, Value>(
                        "/save",
                        &json!({"draft":value,"histories":histories,"seen":seen}),
                    );
                    if result.is_err() {
                        failed_saves.insert(id.clone());
                    } else {
                        failed_saves.remove(&id);
                    }
                    Reply::Saved(id, revision, result)
                }
                Job::Reload(g) => Reply::Library(g, host.library()),
                Job::New => Reply::New(host.post("/new", &json!({}))),
                Job::Active(id) => Reply::Active(host.post("/active", &json!({"id":id}))),
                Job::Zoom(level) => Reply::Zoom(
                    std::fs::write(
                        PathBuf::from(std::env::var_os("DRAFT_RUNE_DATA_ROOT").unwrap())
                            .join("window-zoom"),
                        level.to_string(),
                    )
                    .map_err(|e| e.to_string()),
                ),
                Job::Session(value) => Reply::Session(host.post("/session", &value)),
                Job::Restore(g) => Reply::Library(g, host.post("/restore", &json!({}))),
                Job::PrepareAction(id, action) => Reply::PrepareAction(id, action),
                Job::Action(id, revision, draft, action) => Reply::Action(
                    id.clone(),
                    revision,
                    if failed_saves.contains(&id) {
                        Err("Save your writing before changing this draft.".into())
                    } else {
                        host.post("/action", &json!({"draft":draft,"action":action}))
                    },
                ),
                Job::Image {
                    draft,
                    version,
                    selection,
                    before,
                    bytes,
                    file,
                } => {
                    let result = file
                        .as_deref()
                        .map(attachments::png)
                        .unwrap_or(Ok(bytes))
                        .and_then(|bytes| host.media(&draft, &bytes));
                    Reply::Image {
                        draft,
                        version,
                        selection,
                        before,
                        result,
                    }
                }
                Job::Crop(edit, path) => {
                    let result = attachments::render(&edit, &path)
                        .and_then(|bytes| host.media(&edit.draft, &bytes));
                    Reply::Cropped(edit, result)
                }
                Job::CopyImage(edit, path) => Reply::CopyImage(attachments::render(&edit, &path)),
                Job::Barrier(done) => {
                    let _ = done.send(());
                    continue;
                }
            };
            if send.send(reply).is_err() {
                break;
            }
            waker();
        }
    });
}
pub(super) fn poll(s: &mut State, now: f64, tx: &mut Tx) -> bool {
    let replies: Vec<_> = s
        .replies
        .as_ref()
        .map(|r| r.try_iter().collect())
        .unwrap_or_default();
    let mut changed = !replies.is_empty();
    let active = s.active_version();
    if active != s.active {
        s.keyboard.navigation += 1;
        s.keyboard.viewing.insert(
            s.docs[s.selected].id().into(),
            s.docs[s.selected].versions[active].id.clone(),
        );
        s.active = active;
        changed = true;
    }
    for reply in replies {
        match reply {
            Reply::Cropped(edit, result) => attachments::received(s, edit, result, tx),
            Reply::CopyImage(result) => match result {
                Ok(bytes) => {
                    if let Some(image) = rune::ClipboardImage::from_png(bytes) {
                        tx.copy_rich(rune::ClipboardContent::new("").with_image(image));
                    }
                }
                Err(error) => s.notice = error,
            },
            Reply::New(result) => keyboard::accept_new(s, result, tx),
            Reply::Active(result) => {
                if let Err(e) = result {
                    s.notice = format!("Could not remember the selected draft: {e}");
                }
            }
            Reply::Zoom(result) => {
                if let Err(e) = result {
                    s.notice = format!("Could not save zoom: {e}");
                }
            }
            Reply::Sync(update) => settings::receive(s, update),
            Reply::Services(update) => services::receive(s, update, tx),
            Reply::Spelling(update) => spelling::receive(s, update),
            Reply::Writing(update) => writing::receive(s, update),
            Reply::Session(result) => session::received(s, result),
            Reply::Changes(value) => sync::received(s, value),
            Reply::Desktop(value) => {
                if let Some(events) = value.as_array() {
                    for event in events {
                        if event["action"] == "quit" {
                            keyboard::quit(s, tx);
                            continue;
                        }
                        if event["action"] == "settings" {
                            s.preferences = true;
                        }
                        if event["capture"].as_bool() == Some(true) {
                            keyboard::new_draft(s, tx);
                        }
                        if let Some(app) = &s.keyboard.app {
                            app.open();
                        }
                    }
                }
            }
            Reply::Saved(id, revision, result) => sync::saved(s, &id, revision, result),
            Reply::Library(g, result) => match result {
                Ok(lib) if g == s.generation => {
                    let added = lib.drafts.len() > s.docs.len();
                    let active = lib.active.clone();
                    s.install(lib);
                    if added {
                        s.selected = s
                            .docs
                            .iter()
                            .position(|d| d.id() == active)
                            .unwrap_or(s.selected);
                        s.focus(0);
                    }
                    s.notice = "Reloaded from Draft’s Markdown files".into();
                }
                Ok(_) => s.notice = "Kept your latest typing; reload again when ready".into(),
                Err(e) => s.notice = format!("Could not reload: {e}"),
            },
            Reply::Action(id, revision, result) => items::finish(s, &id, revision, result, tx),
            Reply::PrepareAction(id, action) => items::prepared(s, &id, action),
            Reply::Image {
                draft,
                version,
                selection,
                before,
                result,
            } => {
                let location = s.docs.iter().position(|d| d.id() == draft).and_then(|di| {
                    s.docs[di]
                        .versions
                        .iter()
                        .position(|v| v.id == version)
                        .map(|vi| (di, vi))
                });
                if let Some((di, vi)) = location {
                    let edit = &mut s.docs[di].versions[vi].edit;
                    match result {
                        Ok(src) => {
                            if edit.text == before {
                                edit.anchor = selection.0;
                                edit.focus = selection.1;
                            }
                            attachments::insertion(edit, &src);
                            s.edited(di, vi, tx);
                        }
                        Err(e) => s.notice = format!("Image paste failed: {e}"),
                    }
                }
            }
        }
    }
    keyboard::drain(s, tx);
    if let Some(app) = &s.keyboard.app {
        for error in app.take_shortcut_errors() {
            s.keyboard.shortcut_error = Some(format!(
                "Quick draft (Alt + .) could not be registered: {error}. Another app may be using it."
            ));
            changed = true;
        }
    }
    if let Some(due) = s.due {
        if due <= Instant::now() {
            s.save();
            s.due = None;
            changed = true;
        } else {
            tx.wake_after(due.saturating_duration_since(Instant::now()));
        }
    }
    if s.due.is_none()
        && s.docs
            .iter()
            .any(|d| d.revision != d.saved && d.queued.is_none())
    {
        s.save();
    }
    sync::poll(s);
    session::poll(s, tx);
    services::poll(s, tx);
    changed |= attachments::poll(s);
    spelling::poll(s, tx);
    writing::poll(s, tx);
    caret::poll(s, now, tx) || changed
}
fn global_key(s: &mut State, key: &KeyEvent, tx: &mut Tx) -> bool {
    keyboard::key(s, key, tx)
}
fn input_key(s: &mut State, di: usize, vi: usize, key: &KeyEvent, tx: &mut Tx) -> bool {
    s.caret.restart();
    if s.docs[di].pending_removal {
        return true;
    }
    s.active = vi;
    if s.docs[di].versions[vi].edit.preedit.is_some() {
        return false;
    }
    if attachments::key(s, di, vi, key, tx) {
        return true;
    }
    if global_key(s, key, tx) {
        return true;
    }
    if key.key == Key::Tab && !key.mods.cmd && !key.mods.ctrl && !key.mods.alt {
        blocks::tab(&mut s.docs[di].versions[vi].edit, key.mods.shift);
        s.edited(di, vi, tx);
        return true;
    }
    if key.is_command('i') {
        s.format("*", tx);
        return true;
    }
    if key.is_command('u') {
        s.format_pair("<u>", "</u>", tx);
        return true;
    }
    if key.is_command('y') {
        s.docs[di].versions[vi].edit.redo();
        s.edited(di, vi, tx);
        return true;
    }
    if key.is_command('s') {
        s.save();
        return true;
    }
    if key.key == Key::Enter && !key.mods.cmd {
        s.docs[di].versions[vi].edit.insert("\n");
        s.edited(di, vi, tx);
        return true;
    }
    false
}
pub(super) fn menu_item(
    key: &str,
    label: &str,
    p: design::Palette,
    f: impl Fn(&mut State, &mut Tx) + 'static,
) -> El {
    row()
        .key(key)
        .role("button")
        .label(label)
        .focusable(true)
        .w_full()
        .h(32.0)
        .min_h(32.0)
        .px(10.0)
        .radius(9.0)
        .continuous_corners()
        .center_y()
        .hover(p.selected)
        .child(
            text(label)
                .min_w(0.0)
                .grow(1.0)
                .truncate()
                .font(TextStyle::new(13.0, 400.0))
                .color(p.text),
        )
        .on_press_tx(f)
}
/// Images, files and formatted text from the clipboard. Plain text is left to the editor.
fn paste_rich(
    s: &mut State,
    di: usize,
    vi: usize,
    data: &rune::ClipboardContent,
    tx: &mut Tx,
) -> bool {
    if s.docs[di].pending_removal {
        return true;
    }
    if let Some(image) = data.image() {
        s.paste_image(di, vi, image.png().to_vec(), tx);
        true
    } else if !data.files().is_empty() {
        attachments::files(s, di, vi, data.files());
        true
    } else if let Some(markdown) = paste::from_clipboard(data.text(), data.html()) {
        let edit = &mut s.docs[di].versions[vi].edit;
        edit.break_history_group();
        edit.insert(&markdown);
        edit.break_history_group();
        s.edited(di, vi, tx);
        true
    } else {
        false
    }
}
/// A shortcut as the platform writes it in menus: ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere.
pub(super) fn keys(shift: bool, key: char) -> String {
    let key = key.to_ascii_uppercase();
    match (cfg!(target_os = "macos"), shift) {
        (true, true) => format!("⇧⌘{key}"),
        (true, false) => format!("⌘{key}"),
        (false, true) => format!("Ctrl+Shift+{key}"),
        (false, false) => format!("Ctrl+{key}"),
    }
}
/// One row of a context menu: a label, an optional shortcut or checkmark on the right, and a
/// dimmed, inert look when it can't be used.
pub(super) struct Entry {
    key: String,
    label: String,
    hint: String,
    enabled: bool,
    checked: bool,
    color: Option<Color>,
}
pub(super) fn entry(key: &str, label: &str) -> Entry {
    Entry {
        key: key.into(),
        label: label.into(),
        hint: String::new(),
        enabled: true,
        checked: false,
        color: None,
    }
}
impl Entry {
    pub(super) fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = hint.into();
        self
    }
    pub(super) fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
    pub(super) fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }
    pub(super) fn color(mut self, color: Color) -> Self {
        self.color = Some(color);
        self
    }
    pub(super) fn build(self, p: design::Palette, f: impl Fn(&mut State, &mut Tx) + 'static) -> El {
        let color = if self.enabled {
            self.color.unwrap_or(p.text)
        } else {
            p.muted.alpha(0.55)
        };
        let trailing = if self.checked {
            "✓".to_owned()
        } else {
            self.hint
        };
        let mut row = row()
            .key(&self.key)
            .role("button")
            .label(&self.label)
            .w_full()
            .h(28.0)
            .min_h(28.0)
            .px(10.0)
            .gap(16.0)
            .radius(7.0)
            .continuous_corners()
            .center_y()
            .child(
                text(&self.label)
                    .min_w(0.0)
                    .grow(1.0)
                    .truncate()
                    .font(TextStyle::new(13.0, 400.0))
                    .color(color),
            );
        if self.checked {
            row = row.checked(true);
        }
        if !trailing.is_empty() {
            row = row.child(
                text(trailing)
                    .font(TextStyle::new(
                        12.5,
                        if self.checked { 600.0 } else { 400.0 },
                    ))
                    .color(if self.enabled && self.checked {
                        color
                    } else {
                        p.muted.alpha(if self.enabled { 1.0 } else { 0.55 })
                    }),
            );
        }
        if self.enabled {
            row.focusable(true).hover(p.selected).on_press_tx(f)
        } else {
            row.disabled(true)
        }
    }
}
/// A thin rule between groups of menu rows.
pub(super) fn separator(p: design::Palette) -> El {
    el().w_full()
        .py(4.0)
        .px(10.0)
        .child(el().w_full().h(1.0).fill(p.text.alpha(0.1)))
}
/// A compact button in a row of formatting or paragraph-style choices.
fn chip(
    key: &str,
    face: El,
    name: &str,
    help: &str,
    active: bool,
    p: design::Palette,
    f: impl Fn(&mut State, &mut Tx) + 'static,
) -> El {
    row()
        .key(key)
        .role("button")
        .label(name)
        .help(help)
        .focusable(true)
        .w(1.0)
        .grow(1.0)
        .h(30.0)
        .radius(7.0)
        .continuous_corners()
        .center()
        .fill(if active {
            p.selected
        } else {
            Color::TRANSPARENT
        })
        .hover(p.selected)
        .checked(active)
        .child(face)
        .on_press_tx(f)
}
fn chips(children: impl IntoIterator<Item = El>) -> El {
    let mut r = row().w_full().gap(2.0);
    for c in children {
        r = r.child(c);
    }
    r
}
fn glyph(label: &str, style: TextStyle, p: design::Palette) -> El {
    text(label).font(style).color(p.text)
}
fn paragraph(s: &mut State, style: blocks::Style, tx: &mut Tx) {
    s.context = None;
    let (di, vi) = (s.selected, s.active_version());
    blocks::apply(&mut s.docs[di].versions[vi].edit, style);
    s.focus(vi);
    s.edited(di, vi, tx);
}
fn text_menu(s: &State, mut menu: El, p: design::Palette) -> El {
    let di = s.selected;
    let vi = s.active_version();
    let edit = &s.docs[di].versions[vi].edit;
    let selection = !edit.selected().is_empty();
    let writable = !s.docs[di].pending_removal;
    let fixes = spelling::items(s, p);
    let link = links::items(s, p);
    let top = !fixes.is_empty() || !link.is_empty();
    for item in fixes.into_iter().chain(link) {
        menu = menu.child(item);
    }
    if top {
        menu = menu.child(separator(p));
    }
    menu = menu
        .child(
            entry("cut", "Cut")
                .hint(keys(false, 'x'))
                .enabled(selection && writable)
                .build(p, |s, tx| {
                    s.context = None;
                    let (di, vi) = (s.selected, s.active_version());
                    let edit = &mut s.docs[di].versions[vi].edit;
                    tx.copy(edit.selected());
                    edit.break_history_group();
                    edit.insert("");
                    edit.break_history_group();
                    s.focus(vi);
                    s.edited(di, vi, tx);
                }),
        )
        .child(
            entry("copy", "Copy")
                .hint(keys(false, 'c'))
                .enabled(selection)
                .build(p, |s, tx| {
                    s.context = None;
                    let vi = s.active_version();
                    tx.copy(s.docs[s.selected].versions[vi].edit.selected());
                    s.focus(vi);
                }),
        )
        .child(
            entry("paste", "Paste")
                .hint(keys(false, 'v'))
                .enabled(writable)
                .build(p, |s, tx| {
                    s.context = None;
                    let (di, vi) = (s.selected, s.active_version());
                    s.focus(vi);
                    tx.read_clipboard(move |s: &mut State, data, tx| {
                        if di >= s.docs.len() || vi >= s.docs[di].versions.len() {
                            return;
                        }
                        if !paste_rich(s, di, vi, data, tx) && !data.text().is_empty() {
                            let edit = &mut s.docs[di].versions[vi].edit;
                            edit.break_history_group();
                            edit.insert(data.text());
                            edit.break_history_group();
                            s.edited(di, vi, tx);
                        }
                    });
                }),
        )
        .child(
            entry("select-all", "Select All")
                .hint(keys(false, 'a'))
                .enabled(!edit.text.is_empty())
                .build(p, |s, _| {
                    s.context = None;
                    let vi = s.active_version();
                    let edit = &mut s.docs[s.selected].versions[vi].edit;
                    edit.anchor = 0;
                    edit.focus = edit.text.len();
                    s.focus(vi);
                }),
        )
        .child(separator(p));
    let underline = glyph("U", TextStyle::new(13.5, 500.0), p);
    let underline_spans = vec![rune::Span::new(0, 1).underline(p.text)];
    menu = menu.child(chips([
        chip(
            "bold",
            glyph("B", TextStyle::new(13.5, 700.0), p),
            "Bold",
            "Bold",
            false,
            p,
            |s, tx| {
                s.context = None;
                s.format("**", tx);
            },
        ),
        chip(
            "italic",
            glyph("I", TextStyle::new(13.5, 400.0).italic(), p),
            "Italic",
            &format!("Italic  {}", keys(false, 'i')),
            false,
            p,
            |s, tx| {
                s.context = None;
                s.format("*", tx);
            },
        ),
        chip(
            "underline",
            underline.decorations(underline_spans),
            "Underline",
            &format!("Underline  {}", keys(false, 'u')),
            false,
            p,
            |s, tx| {
                s.context = None;
                s.format_pair("<u>", "</u>", tx);
            },
        ),
        chip(
            "code",
            glyph("</>", TextStyle::new(12.0, 500.0).mono(), p),
            "Inline code",
            "Inline code",
            false,
            p,
            |s, tx| {
                s.context = None;
                s.format("`", tx);
            },
        ),
        chip(
            "link-edit",
            rune::icon(&design::LINK, 15.0).color(p.text),
            "Link",
            "Add or edit link",
            false,
            p,
            |s, _| links::open(s),
        ),
    ]));
    let current = blocks::current(edit);
    let style = |key: &'static str,
                 face: &str,
                 name: &'static str,
                 value: blocks::Style,
                 font: TextStyle| {
        chip(
            key,
            glyph(face, font, p),
            name,
            name,
            current == value,
            p,
            move |s, tx| paragraph(s, value, tx),
        )
    };
    let label = TextStyle::new(12.5, 500.0);
    menu = menu
        .child(chips([
            style(
                "paragraph-text",
                "Text",
                "Body text",
                blocks::Style::Text,
                label,
            ),
            style(
                "heading-1",
                "H1",
                "Heading 1",
                blocks::Style::Heading(1),
                TextStyle::new(13.0, 700.0),
            ),
            style(
                "heading-2",
                "H2",
                "Heading 2",
                blocks::Style::Heading(2),
                TextStyle::new(12.5, 650.0),
            ),
            style(
                "heading-3",
                "H3",
                "Heading 3",
                blocks::Style::Heading(3),
                TextStyle::new(12.0, 600.0),
            ),
        ]))
        .child(chips([
            style(
                "list-bullet",
                "• List",
                "Bulleted list",
                blocks::Style::Bullet,
                label,
            ),
            style(
                "list-numbered",
                "1. List",
                "Numbered list",
                blocks::Style::Numbered,
                label,
            ),
            style("quote", "“ Quote", "Quote", blocks::Style::Quote, label),
        ]))
        .child(separator(p))
        .child(
            entry("undo", "Undo")
                .hint(keys(false, 'z'))
                .enabled(writable)
                .build(p, |s, tx| {
                    s.context = None;
                    let vi = s.active_version();
                    s.docs[s.selected].versions[vi].edit.undo();
                    s.focus(vi);
                    s.edited(s.selected, vi, tx);
                }),
        )
        .child(
            entry("redo", "Redo")
                .hint(keys(true, 'z'))
                .enabled(writable)
                .build(p, |s, tx| {
                    s.context = None;
                    let vi = s.active_version();
                    s.docs[s.selected].versions[vi].edit.redo();
                    s.focus(vi);
                    s.edited(s.selected, vi, tx);
                }),
        );
    menu
}
fn menu(s: &State, dark: bool, p: design::Palette) -> El {
    let menu = col()
        .key("editor-menu")
        .w(238.0)
        .padding(5.0)
        .radius(14.0)
        .continuous_corners();
    let menu = if s.item_menu.is_some() {
        items::menu(s, menu, p)
    } else if s.link.is_some() {
        links::dialog(s, p)
    } else {
        text_menu(s, menu, p)
    };
    // Nearly opaque, so writing behind the menu never competes with its labels.
    design::glass_surface(menu, dark)
        .fill(p.menu.alpha(if dark { 0.97 } else { 0.98 }))
        .backdrop_blur(22.0)
        .shadow(
            10.0,
            28.0,
            Color::BLACK.alpha(if dark { 0.32 } else { 0.16 }),
        )
}
fn tab(s: &State, vi: usize, width: f32, dark: bool, p: design::Palette) -> El {
    let d = &s.docs[s.selected];
    let v = &d.versions[vi];
    let title = d.version_title(vi);
    let source = if v.edit.selected().is_empty() {
        v.edit.text.as_str()
    } else {
        v.edit.selected()
    };
    let time = design::reading(source);
    let count = format!("{} char", design::characters(source));
    let tw = time.len() as f32 * 5.8 + 20.0;
    let cw = count.len() as f32 * 5.8 + 20.0;
    let inset = if !s.sidebar && vi == 0 { 84.0 } else { 8.0 };
    let title_width = (title.chars().count() as f32 * 6.3 + 26.0)
        .clamp(48.0, 260.0)
        .min((width - inset - 8.0 - tw - cw - 10.5).max(48.0));
    let widths = [title_width, tw, cw];
    row()
        .key(format!("tab-{}", v.id))
        .role("tab")
        .label(format!("Version {} · {title}", v.number))
        .focus_selected(vi == s.active_version())
        .h(40.0)
        .w_full()
        .absolute(0.0, 0.0)
        .window_drag()
        .child(
            row()
                .absolute(inset, 6.0)
                .h(28.0)
                .gap(5.25)
                .child(design::tab_surface(&widths, dark))
                .child(
                    row().w(title_width).h(28.0).px(13.0).center_y().child(
                        text(&title)
                            .font(TextStyle::new(
                                12.5,
                                if vi == s.active_version() {
                                    550.0
                                } else {
                                    450.0
                                },
                            ))
                            .color(p.text)
                            .truncate(),
                    ),
                )
                .child(
                    row()
                        .w(tw)
                        .h(28.0)
                        .px(10.0)
                        .center_y()
                        .child(text(time).font(TextStyle::new(11.5, 400.0)).color(p.muted)),
                )
                .child(
                    row().w(cw).h(28.0).px(10.0).center_y().child(
                        text(count)
                            .key(format!("count-{vi}"))
                            .font(TextStyle::new(11.5, 400.0))
                            .color(p.muted),
                    ),
                ),
        )
        .on_press(move |s: &mut State| {
            s.keyboard.navigation += 1;
            s.focus(vi);
        })
        .on_secondary_press(move |s: &mut State, point, _| {
            items::open(s, s.selected, Some(vi), [point.x, point.y]);
        })
}
fn column(s: &State, vi: usize, width: f32, dark: bool, p: design::Palette, cx: &Cx<State>) -> El {
    let di = s.selected;
    let d = &s.docs[di];
    let v = &d.versions[vi];
    let narrow = width <= 560.0;
    let (px, py) = if narrow { (24.0, 32.0) } else { (56.0, 50.0) };
    let mut spans = v.spans.clone();
    spans.extend(design::underlined(&v.edit.text, p.text));
    spans.extend(spelling::spans(s, vi));
    if !s.source {
        spans.extend(v.hidden.iter().cloned());
    }
    let mut editor = text_input(&v.edit, BODY)
        .key(format!("editor-{}", v.id))
        .role("textbox")
        .label(format!("Version {} Markdown editor", v.number))
        .w_full()
        .min_h(560.0)
        .color(p.text)
        .caret(s.caret.color(p.text), p.text.alpha(0.2))
        .on_edit(move |s: &mut State| &mut s.docs[di].versions[vi].edit)
        .on_selection_change(|s: &mut State, _, _| s.caret.restart())
        .on_input_change(move |s: &mut State, tx| s.edited(di, vi, tx))
        .on_input_key(move |s, key, tx| input_key(s, di, vi, key, tx))
        .on_secondary_press(move |s: &mut State, point, _| {
            s.focus(vi);
            s.preferences = false;
            s.item_menu = None;
            s.link = None;
            s.context = Some([point.x, point.y]);
            spelling::suggest(s);
        })
        .on_input_paste(move |s: &mut State, data, tx| paste_rich(s, di, vi, data, tx))
        .on_drop_files(move |s: &mut State, files, _| attachments::files(s, di, vi, files))
        .accepts_extensions(&["png", "jpg", "jpeg", "webp", "gif"]);
    if d.pending_removal {
        editor = editor.inert();
    }
    let editor = attachments::inline(
        s,
        di,
        vi,
        (width.min(790.0) - px * 2.0).max(1.0),
        editor,
        cx,
        spans,
    );
    let paper = col().w_full().max_w(790.0).px(px).py(py).child(editor);
    col()
        .key(format!("version-{}", v.id))
        .w(width)
        .min_w(width)
        .h_full()
        .min_h(0.0)
        .child(session::watch(
            s,
            &format!("scroll-{}", v.id),
            col()
                .key(format!("scroll-{}", v.id))
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
                        .child(paper)
                        .child(el().h(500.0)),
                ),
        ))
        .child(tab(s, vi, width, dark, p))
}
fn date_label(value: &Value) -> String {
    let iso = value.as_str().unwrap_or("");
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let month = iso
        .get(5..7)
        .and_then(|s| s.parse::<usize>().ok())
        .and_then(|m| months.get(m.saturating_sub(1)));
    match (month, iso.get(8..10).and_then(|s| s.parse::<usize>().ok())) {
        (Some(m), Some(day)) => format!("{m} {day}"),
        _ => String::new(),
    }
}
fn sidebar(s: &State, dark: bool, width: f32, p: design::Palette) -> El {
    let mut list = col().w_full().px(8.0).gap(4.0);
    for (i, d) in s.docs.iter().enumerate() {
        let title = if d.raw["titleSource"] == "sentence" {
            design::title(&d.versions.last().unwrap().edit.text)
        } else {
            d.raw["title"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("Untitled draft")
                .to_owned()
        };
        let latest = d.versions.last().unwrap();
        let prose = design::prose(&latest.edit.text);
        let summary = d.raw["summary"]["text"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| {
                let mut lines = prose.lines().filter(|s| !s.trim().is_empty());
                let first = lines.next().unwrap_or("");
                let rest = lines.collect::<Vec<_>>().join(" ");
                if first.to_lowercase() == title.to_lowercase() {
                    rest
                } else {
                    format!("{first} {rest}")
                }
            });
        let status = items::stage(d);
        let status_color = p.stage(dark, status);
        let selected = i == s.selected;
        let expanded = selected && s.expanded;
        let mut entry = col()
            .key(format!("draft-{i}"))
            .role("button")
            .label(&title)
            .focusable(true)
            .w_full()
            .padding(10.0)
            .gap(4.0)
            .corners(if expanded {
                [16.0, 16.0, 0.0, 0.0]
            } else {
                [16.0; 4]
            })
            .continuous_corners()
            .hover(if selected {
                Color::TRANSPARENT
            } else {
                p.glass
            })
            .child(
                row()
                    .w_full()
                    .gap(8.0)
                    .center_y()
                    .child(
                        text(&title)
                            .grow(1.0)
                            .min_w(0.0)
                            .truncate()
                            .font(TextStyle::new(13.0, 550.0))
                            .color(p.text),
                    )
                    .child(
                        text(date_label(&d.raw["updatedAt"]))
                            .font(TextStyle::new(11.0, 400.0))
                            .color(p.muted),
                    ),
            );
        if !summary.trim().is_empty() {
            entry = entry.child(
                text(summary)
                    .w_full()
                    .max_lines(3)
                    .font(TextStyle {
                        line_height: 16.8,
                        ..TextStyle::new(12.0, 400.0)
                    })
                    .color(p.muted),
            );
        }
        entry = entry
            .child(
                row()
                    .w_full()
                    .center_y()
                    .child(
                        row().h(18.0).center_y().child(
                            text(status)
                                .font(TextStyle::new(10.5, 400.0))
                                .color(status_color),
                        ),
                    )
                    .child(el().grow(1.0))
                    .child(
                        text(format!(
                            "{} {}",
                            d.versions.len(),
                            if d.versions.len() == 1 {
                                "version"
                            } else {
                                "versions"
                            }
                        ))
                        .font(TextStyle::new(11.0, 400.0))
                        .color(p.muted),
                    ),
            )
            .on_press_tx(move |s: &mut State, tx| {
                s.context = None;
                s.preferences = false;
                s.item_menu = None;
                if s.selected == i {
                    s.expanded = !s.expanded;
                } else {
                    s.expanded = true;
                    keyboard::open_draft(s, i, tx);
                }
            })
            .on_secondary_press(move |s: &mut State, point, _| {
                items::open(s, i, None, [point.x, point.y]);
            });
        let mut group = col()
            .key(format!("draft-group-{}", d.id()))
            .w_full()
            .radius(16.0)
            .continuous_corners()
            .child(entry);
        if expanded {
            let mut versions = col()
                .key(format!("draft-versions-{}", d.id()))
                .w_full()
                .padding(6.0)
                .gap(2.0)
                .corners([0.0, 0.0, 16.0, 16.0])
                .continuous_corners()
                .fill(Color::BLACK.alpha(if dark { 0.10 } else { 0.025 }));
            for (vi, v) in d.versions.iter().enumerate() {
                let active = vi == s.active_version();
                versions = versions.child(
                    row()
                        .key(format!("sidebar-version-{}", v.id))
                        .w_full()
                        .px(12.0)
                        .h(28.0)
                        .radius(10.0)
                        .continuous_corners()
                        .fill(if active { p.glass } else { Color::TRANSPARENT })
                        .hover(p.glass)
                        .center_y()
                        .role("button")
                        .label(format!("Version {}", v.number))
                        .focusable(true)
                        .child(
                            text(d.version_title(vi))
                                .truncate()
                                .font(TextStyle::new(12.0, if active { 550.0 } else { 400.0 }))
                                .color(if active { p.text } else { p.muted }),
                        )
                        .on_press_tx(move |s: &mut State, tx| items::activate(s, i, vi, tx))
                        .on_secondary_press(move |s: &mut State, point, _| {
                            items::open(s, i, Some(vi), [point.x, point.y]);
                        }),
                );
            }
            group = group.child(versions);
        }
        list = list.child(design::sidebar_surface(group, dark, selected));
    }
    col()
        .key("sidebar")
        .w(width)
        .h_full()
        .min_h(0.0)
        .child(el().h(40.0).w_full().window_drag())
        .child(session::watch(
            s,
            "sidebar-scroll",
            col()
                .grow(1.0)
                .min_h(0.0)
                .w_full()
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(list),
        ))
        .child(footer(s, dark, p))
}
pub(super) fn footer(s: &State, dark: bool, p: design::Palette) -> El {
    let back = s.preferences;
    let sync_error = s.settings.needs_attention();
    let mut widths = vec![32.0];
    if back {
        widths.push(46.0);
    }
    if sync_error {
        widths.push(32.0);
    }
    let mut toggle = row()
        .key(if back { "settings-back" } else { "settings" })
        .size(if back { 83.25 } else { 32.0 }, 28.0)
        .gap(5.25)
        .center_y()
        .role("button")
        .label(if back { "Back" } else { "Settings" })
        .focusable(true)
        .child(
            row().size(32.0, 28.0).center().child(
                rune::icon(
                    if back {
                        &design::CHEVRON_LEFT
                    } else {
                        &design::SETTINGS
                    },
                    14.0,
                )
                .color(p.text.alpha(0.85)),
            ),
        )
        .on_press(|s: &mut State| {
            s.preferences = !s.preferences;
            s.context = None;
            s.item_menu = None;
            if !s.preferences {
                s.focus(s.active_version());
            }
        });
    if back {
        toggle = toggle.child(
            row()
                .size(46.0, 28.0)
                .center()
                .child(text("Back").font(TextStyle::new(12.5, 550.0)).color(p.text)),
        );
    }
    let mut controls = row()
        .h(28.0)
        .gap(5.25)
        .child(
            design::glass_pill(&widths, dark)
                .key("footer-glass")
                .absolute(0.0, 0.0),
        )
        .child(toggle);
    if sync_error {
        controls = controls.child(
            row()
                .key("sync-error")
                .size(32.0, 28.0)
                .center()
                .role("button")
                .label("Sync needs attention. Open Sync settings")
                .help(
                    s.settings
                        .issue
                        .as_deref()
                        .or(s.settings.status.message.as_deref())
                        .unwrap_or("Open Sync settings"),
                )
                .focusable(true)
                .child(rune::icon(&design::CLOUD, 14.0).color(p.stage(dark, "Drafting")))
                .on_press(settings::open_sync),
        );
    }
    row().w_full().h(52.0).px(12.0).center_y().child(controls)
}
fn view(s: &State, cx: &mut Cx<State>) -> El {
    let dark = if s.follow_theme {
        cx.system_dark()
    } else {
        s.dark
    };
    let p = design::Palette::new(dark);
    let viewport = cx.layout_size("draft-root").unwrap_or([1200.0, 820.0]);
    let [width, height] = viewport.map(|v| v / s.keyboard.zoom);
    let side = if width <= 1100.0 { 235.0 } else { 260.0 };
    let side = if s.sidebar { side } else { 0.0 };
    let open = s.docs[s.selected].open_versions();
    let count = open.len();
    let visible = count.clamp(1, 2);
    // Reserve the sidebar edge and the separators before sizing the columns.
    // Otherwise selecting an already-visible tab reveals a 1–2pt overflow.
    let dividers = if s.sidebar { 1.0 } else { 0.0 } + (visible - 1) as f32;
    let column_width = (width - side - dividers) / visible as f32;
    let mut columns = row()
        .w(column_width * count as f32 + count.saturating_sub(1) as f32)
        .h_full()
        .min_h(0.0);
    for (n, vi) in open.into_iter().enumerate() {
        if n > 0 {
            columns = columns.child(el().w(1.0).h_full().fill(p.line));
        }
        columns = columns.child(column(s, vi, column_width, dark, p, cx));
    }
    let mut content = row().key("draft-content").w_full().h_full().min_h(0.0);
    if s.sidebar {
        content = content
            .child(sidebar(s, dark, side, p))
            .child(el().w(1.0).h_full().fill(p.line));
    }
    content = content.child(session::watch(
        s,
        &format!("columns-{}", s.docs[s.selected].id()),
        col()
            .grow(1.0)
            .min_w(0.0)
            .h_full()
            .scroll_x()
            .child(columns),
    ));
    if s.preferences {
        content = settings::page(s, dark, side, p, cx);
    }
    let mut root = el()
        .key("draft-page")
        // Ancestor handlers run before control traversal; AppSpec::on_key runs after it.
        .w(width)
        .h(height)
        .scale(s.keyboard.zoom)
        .origin(0.0, 0.0)
        .fill(p.background)
        .system_material(rune::SystemMaterial::Popover)
        .child(
            el().w_full()
                .h_full()
                .absolute(0.0, 0.0)
                .fill(p.background.alpha(if dark { 0.78 } else { 0.8 })),
        )
        .child(content);
    if let Some(attachment) = &s.attachment {
        root = root.child(
            el().w_full()
                .h_full()
                .absolute(0.0, 0.0)
                .on_press(|s: &mut State| s.attachment = None),
        );
        root = root.child(
            attachments::panel(s, dark, p)
                .h((height - 64.0).min(740.0))
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .anchored_fit(
                    &attachment.anchor,
                    rune::Side::Right,
                    rune::Align::Start,
                    8.0,
                ),
        );
    }
    if s.notice.starts_with("Could not") || s.notice.contains(" failed:") {
        root = root.child(
            design::glass_surface(
                col()
                    .key("save-issue")
                    .w((width - 32.0).min(480.0))
                    .padding(12.0)
                    .radius(14.0)
                    .gap(8.0)
                    .child(settings::copy(&s.notice, p).wrap())
                    .child(menu_item("save-retry", "Try saving again", p, |s, _| {
                        s.save()
                    })),
                dark,
            )
            .fill(p.menu.alpha(0.96))
            .absolute((width - 496.0).max(16.0), height - 110.0),
        );
    }
    if s.context.is_some() || s.item_menu.is_some() {
        root = root.child(
            el().w_full()
                .h_full()
                .absolute(0.0, 0.0)
                .on_press(|s: &mut State| {
                    s.context = None;
                    s.preferences = false;
                    s.item_menu = None;
                })
                .on_secondary_press(|s: &mut State, point, tx| {
                    s.context = None;
                    s.preferences = false;
                    s.item_menu = None;
                    let at = [point.x, point.y];
                    tx.element_at_in(
                        "draft-content",
                        at[0],
                        at[1],
                        move |s: &mut State, picked, _| {
                            items::retarget(s, picked, at);
                        },
                    );
                }),
        );
        let popup = menu(s, dark, p);
        let popup = {
            let a = s
                .item_menu
                .as_ref()
                .map(|menu| menu.at)
                .or(s.context)
                .unwrap();
            root = root.child(el().key("context-anchor").size(0.0, 0.0).absolute(
                (a[0] / s.keyboard.zoom).clamp(8.0, width - 8.0),
                (a[1] / s.keyboard.zoom).clamp(8.0, height - 8.0),
            ));
            popup.anchored_fit(
                "context-anchor",
                rune::Side::Bottom,
                rune::Align::Start,
                2.0,
            )
        };
        root = root.child(popup);
    }
    el().key("draft-root")
        .w_full()
        .h_full()
        .on_key(global_key)
        .child(root)
}
pub(super) fn spec() -> AppSpec<State> {
    let fonts = design::fonts();
    let sans = if cfg!(target_os = "macos") && !fonts.is_empty() {
        ".SF NS"
    } else {
        "Inter"
    };
    AppSpec {
        min_size: Some((780.0, 560.0)),
        setup: Some(setup),
        poll: Some(poll),
        on_key: Some(global_key),
        fonts,
        families: (sans, "ui-monospace"),
        scenes: &[
            ("light", |s| {
                s.dark = false;
                s.follow_theme = false;
            }),
            ("dark", |s| {
                s.dark = true;
                s.follow_theme = false;
            }),
            ("long", |s| {
                for d in &mut s.docs {
                    for v in &mut d.versions {
                        v.edit=TextEdit::new("A paragraph with café, 日本語, and 👩🏽‍💻. Keep the cursor and the thought together.\n\n".repeat(250));
                        v.spans = styled(&v.edit.text);
                        v.hidden = design::concealed(&v.edit.text);
                        v.media = media_paths(&v.edit.text);
                    }
                }
            }),
        ],
        ..AppSpec::new("Draft", (1200.0, 820.0), State::load, view)
    }
}
