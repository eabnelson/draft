use super::*;

pub(super) fn setup(s: &mut State, waker: Waker) {
    s.cache = Some(ImageCache::new(waker.clone()));
    s.refresh_images();
    let (jobs, receive) = mpsc::channel();
    let (send, replies) = mpsc::channel();
    let host = s.host.clone();
    s.jobs = Some(jobs);
    s.replies = Some(replies);
    std::thread::spawn(move || {
        while let Ok(job) = receive.recv() {
            let reply = match job {
                Job::Save(id, revision, value) => Reply::Saved(id, revision, host.save(&value)),
                Job::Reload(g) => Reply::Library(g, host.library()),
                Job::New(g) => Reply::Library(g, host.post("/new", &json!({}))),
                Job::Image {
                    draft,
                    version,
                    selection,
                    before,
                    bytes,
                } => {
                    let result = host.media(&draft, &bytes);
                    Reply::Image {
                        draft,
                        version,
                        selection,
                        before,
                        result,
                    }
                }
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
pub(super) fn poll(s: &mut State, _: f64, tx: &mut Tx) -> bool {
    let replies: Vec<_> = s
        .replies
        .as_ref()
        .map(|r| r.try_iter().collect())
        .unwrap_or_default();
    let mut changed = !replies.is_empty();
    let active = s.active_version();
    if active != s.active {
        s.active = active;
        changed = true;
    }
    for reply in replies {
        match reply {
            Reply::Saved(id, revision, result) => {
                if let Some(d) = s.docs.iter_mut().find(|d| d.id() == id) {
                    if d.queued == Some(revision) {
                        d.queued = None;
                    }
                    match result {
                        Ok(()) => d.saved = d.saved.max(revision.min(d.revision)),
                        Err(e) => {
                            s.notice = format!("Could not save: {e}");
                            s.due = Some(Instant::now() + Duration::from_secs(5));
                        }
                    }
                }
                if s.docs.iter().all(|d| d.saved == d.revision) {
                    s.notice = "All changes saved".into();
                }
            }
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
                            edit.insert(&format!("![Pasted image]({src})"));
                            s.edited(di, vi, tx);
                        }
                        Err(e) => s.notice = format!("Image paste failed: {e}"),
                    }
                }
            }
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
    changed
}
fn global_key(s: &mut State, key: &KeyEvent, _: &mut Tx) -> bool {
    if key.key == Key::Tab && key.mods.ctrl && !key.mods.logo && !key.mods.alt {
        // Cycle only the versions this prototype renders, before Rune traverses controls.
        let count = s.docs[s.selected].versions.len().min(2);
        if count > 1 {
            let current = s.active_version();
            let step = if key.mods.shift { count - 1 } else { 1 };
            s.focus((current + step) % count);
        }
        return true;
    }
    if key.is_command('b') {
        s.sidebar = !s.sidebar;
        return true;
    }
    if key.is_command('n') {
        s.reload(true);
        return true;
    }
    if key.is_command(',') {
        s.preferences = !s.preferences;
        s.context = None;
        return true;
    }
    if key.key == Key::Escape && (s.preferences || s.context.is_some()) {
        s.preferences = false;
        s.context = None;
        return true;
    }
    false
}
fn input_key(s: &mut State, di: usize, vi: usize, key: &KeyEvent, tx: &mut Tx) -> bool {
    s.active = vi;
    if s.docs[di].versions[vi].edit.preedit.is_some() {
        return false;
    }
    if global_key(s, key, tx) {
        return true;
    }
    if key.is_command('i') {
        s.format("*", tx);
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
fn menu_item(
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
        .px(10.0)
        .radius(9.0)
        .continuous_corners()
        .center_y()
        .hover(p.selected)
        .child(text(label).font(TextStyle::new(13.0, 400.0)).color(p.text))
        .on_press_tx(f)
}
fn menu(s: &State, dark: bool, p: design::Palette) -> El {
    let mut menu = col()
        .key("editor-menu")
        .w(238.0)
        .padding(6.0)
        .radius(16.0)
        .continuous_corners();
    if s.preferences {
        menu = menu
            .child(
                text("Appearance")
                    .font(TextStyle::new(11.0, 500.0))
                    .color(p.muted)
                    .px(10.0)
                    .py(6.0),
            )
            .child(menu_item("theme-system", "System", p, |s, _| {
                s.follow_theme = true;
                s.preferences = false;
            }))
            .child(menu_item("theme-light", "Light", p, |s, _| {
                s.dark = false;
                s.follow_theme = false;
                s.preferences = false;
            }))
            .child(menu_item("theme-dark", "Dark", p, |s, _| {
                s.dark = true;
                s.follow_theme = false;
                s.preferences = false;
            }))
            .child(el().w_full().h(1.0).fill(p.line))
            .child(menu_item("new-draft", "New draft", p, |s, _| {
                s.preferences = false;
                s.reload(true);
            }))
            .child(menu_item(
                "source",
                if s.source {
                    "Hide Markdown"
                } else {
                    "Show Markdown"
                },
                p,
                |s, _| {
                    s.source = !s.source;
                    s.preferences = false;
                },
            ))
            .child(menu_item("reload", "Reload files", p, |s, _| {
                s.preferences = false;
                s.reload(false);
            }));
    } else {
        menu = menu
            .child(menu_item("bold", "Bold", p, |s, tx| {
                s.context = None;
                s.format("**", tx);
            }))
            .child(menu_item("italic", "Italic", p, |s, tx| {
                s.context = None;
                s.format("*", tx);
            }))
            .child(menu_item("code", "Code", p, |s, tx| {
                s.context = None;
                s.format("`", tx);
            }))
            .child(el().w_full().h(1.0).fill(p.line))
            .child(menu_item("undo", "Undo", p, |s, tx| {
                s.context = None;
                let vi = s.active_version();
                s.docs[s.selected].versions[vi].edit.undo();
                s.focus(vi);
                s.edited(s.selected, vi, tx);
            }))
            .child(menu_item("redo", "Redo", p, |s, tx| {
                s.context = None;
                let vi = s.active_version();
                s.docs[s.selected].versions[vi].edit.redo();
                s.focus(vi);
                s.edited(s.selected, vi, tx);
            }));
    }
    design::glass_surface(menu, dark)
        .fill(p.menu.alpha(0.84))
        .backdrop_blur(22.0)
        .shadow(
            8.0,
            24.0,
            Color::BLACK.alpha(if dark { 0.18 } else { 0.10 }),
        )
}
fn tab(s: &State, vi: usize, width: f32, dark: bool, p: design::Palette) -> El {
    let d = &s.docs[s.selected];
    let v = &d.versions[vi];
    let title = d.raw["versions"][vi]["name"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| design::title(&v.edit.text));
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
                .child(
                    design::glass_pill(&widths, dark, vi == s.active_version()).absolute(0.0, 0.0),
                )
                .child(
                    row().w(title_width).h(28.0).px(13.0).center_y().child(
                        text(title)
                            .font(TextStyle::new(12.5, 550.0))
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
        .on_press(move |s: &mut State| s.focus(vi))
}
fn column(s: &State, vi: usize, width: f32, dark: bool, p: design::Palette) -> El {
    let di = s.selected;
    let d = &s.docs[di];
    let v = &d.versions[vi];
    let narrow = width <= 560.0;
    let (px, py) = if narrow { (24.0, 32.0) } else { (56.0, 50.0) };
    let mut spans = v.spans.clone();
    if !s.source {
        spans.extend(v.hidden.iter().cloned());
    }
    let editor = text_input(&v.edit, BODY)
        .key(format!("editor-{}", v.id))
        .role("textbox")
        .label(format!("Version {} Markdown editor", v.number))
        .w_full()
        .min_h(560.0)
        .color(p.text)
        .spans(spans)
        .on_edit(move |s: &mut State| &mut s.docs[di].versions[vi].edit)
        .on_input_change(move |s: &mut State, tx| s.edited(di, vi, tx))
        .on_input_key(move |s, key, tx| input_key(s, di, vi, key, tx))
        .on_secondary_press(move |s: &mut State, point, _| {
            s.focus(vi);
            s.preferences = false;
            s.context = Some([point.x, point.y]);
        })
        .on_input_paste(move |s: &mut State, data, tx| {
            if let Some(image) = data.image() {
                s.paste_image(di, vi, image.png().to_vec(), tx);
                true
            } else {
                false
            }
        });
    let mut paper = col()
        .w_full()
        .max_w(790.0)
        .px(px)
        .py(py)
        .gap(12.0)
        .child(editor);
    for src in &v.media {
        if let Some(image) = s.images.get(&s.image_path(d.id(), src)) {
            let ratio = image
                .size()
                .map_or(1.5, |[w, h]| w as f32 / h.max(1) as f32);
            paper = paper.child(
                el().key(format!("image-{src}"))
                    .role("img")
                    .label("Pasted image attachment")
                    .w_full()
                    .h(((width - px * 2.0) / ratio).clamp(60.0, 500.0))
                    .radius(10.0)
                    .pixels(image.pixels()),
            );
        }
    }
    col()
        .key(format!("version-{}", v.id))
        .grow(1.0)
        .min_w(0.0)
        .h_full()
        .min_h(0.0)
        .child(
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
        )
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
        let title = d.raw["title"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("Untitled draft");
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
        let drafting = d.versions.len() > 1 || prose.split_whitespace().count() >= 50;
        let (chip, chip_text) = p.stage(dark, drafting);
        let selected = i == s.selected;
        let expanded = selected && s.expanded;
        let mut entry = col()
            .key(format!("draft-{i}"))
            .role("button")
            .label(title)
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
                        text(title)
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
                        row()
                            .h(18.0)
                            .px(7.0)
                            .center_y()
                            .radius(9.0)
                            .fill(chip)
                            .child(
                                text(if drafting { "Drafting" } else { "Idea" })
                                    .font(TextStyle::new(10.5, 400.0))
                                    .color(chip_text),
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
            .on_press(move |s: &mut State| {
                s.context = None;
                s.preferences = false;
                if s.selected == i {
                    s.expanded = !s.expanded;
                } else {
                    s.selected = i;
                    s.expanded = true;
                    s.focus(0);
                }
            });
        let mut group = col()
            .key(format!("draft-group-{i}"))
            .w_full()
            .radius(16.0)
            .continuous_corners()
            .child(entry);
        if expanded {
            let mut versions = col()
                .key(format!("draft-versions-{i}"))
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
                            text(design::title(&v.edit.text))
                                .truncate()
                                .font(TextStyle::new(12.0, if active { 550.0 } else { 400.0 }))
                                .color(if active { p.text } else { p.muted }),
                        )
                        .on_press(move |s: &mut State| s.focus(vi)),
                );
            }
            group = group.child(versions);
        }
        if selected {
            group = design::glass_surface(group, dark);
        }
        list = list.child(group);
    }
    let footer = row().w_full().h(52.0).px(12.0).center_y().child(
        row()
            .h(28.0)
            .gap(5.25)
            .child(design::pill(&[32.0, 32.0], p.glass).absolute(0.0, 0.0))
            .child(
                row()
                    .key("settings")
                    .size(32.0, 28.0)
                    .center()
                    .role("button")
                    .label("Settings")
                    .focusable(true)
                    .child(rune::icon(&design::SETTINGS, 14.0).color(p.muted))
                    .on_press(|s: &mut State| {
                        s.preferences = !s.preferences;
                        s.context = None;
                    }),
            )
            .child(
                row()
                    .key("save-status")
                    .size(32.0, 28.0)
                    .center()
                    .role("status")
                    .label(&s.notice)
                    .help(&s.notice)
                    .child(rune::icon(&design::CLOUD, 14.0).color(p.muted)),
            ),
    );
    col()
        .key("sidebar")
        .w(width)
        .h_full()
        .min_h(0.0)
        .child(el().h(40.0).w_full().window_drag())
        .child(
            col()
                .grow(1.0)
                .min_h(0.0)
                .w_full()
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(list),
        )
        .child(footer)
}
fn view(s: &State, cx: &mut Cx<State>) -> El {
    let dark = if s.follow_theme {
        cx.system_dark()
    } else {
        s.dark
    };
    let p = design::Palette::new(dark);
    let [width, height] = cx.layout_size("draft-root").unwrap_or([1200.0, 820.0]);
    let side = if width <= 1100.0 { 235.0 } else { 260.0 };
    let side = if s.sidebar { side } else { 0.0 };
    let count = s.docs[s.selected].versions.len().min(2);
    let column_width = (width - side) / count.max(1) as f32;
    let mut columns = row().w_full().h_full().min_h(0.0);
    for vi in 0..count {
        if vi > 0 {
            columns = columns.child(el().w(1.0).h_full().fill(p.line));
        }
        columns = columns.child(column(s, vi, column_width, dark, p));
    }
    let mut content = row().w_full().h_full().min_h(0.0);
    if s.sidebar {
        content = content
            .child(sidebar(s, dark, side, p))
            .child(el().w(1.0).h_full().fill(p.line));
    }
    content = content.child(col().grow(1.0).min_w(0.0).h_full().child(columns));
    let mut root = el()
        .key("draft-root")
        // Ancestor handlers run before control traversal; AppSpec::on_key runs after it.
        .on_key(global_key)
        .w_full()
        .h_full()
        .fill(p.background)
        .system_material(rune::SystemMaterial::Popover)
        .child(
            el().w_full()
                .h_full()
                .absolute(0.0, 0.0)
                .fill(p.background.alpha(if dark { 0.78 } else { 0.8 })),
        )
        .child(content);
    if s.context.is_some() || s.preferences {
        root = root.child(
            el().w_full()
                .h_full()
                .absolute(0.0, 0.0)
                .on_press(|s: &mut State| {
                    s.context = None;
                    s.preferences = false;
                }),
        );
        let popup = menu(s, dark, p);
        let popup = if s.preferences {
            let anchor = if s.sidebar {
                "settings"
            } else {
                root = root.child(
                    el().key("settings-anchor")
                        .size(0.0, 0.0)
                        .absolute(12.0, height - 12.0),
                );
                "settings-anchor"
            };
            popup.anchored(anchor, rune::Side::Top, rune::Align::Start, 6.0)
        } else {
            let a = s.context.unwrap();
            root = root.child(
                el().key("context-anchor")
                    .size(0.0, 0.0)
                    .absolute(a[0].clamp(8.0, width - 8.0), a[1].clamp(8.0, height - 8.0)),
            );
            popup.anchored(
                "context-anchor",
                rune::Side::Bottom,
                rune::Align::Start,
                2.0,
            )
        };
        root = root.child(popup);
    }
    root
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
        ..AppSpec::new("Draft · Rune prototype", (1200.0, 820.0), State::load, view)
    }
}
