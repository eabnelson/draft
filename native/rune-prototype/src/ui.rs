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
fn input_key(s: &mut State, di: usize, vi: usize, key: &KeyEvent, tx: &mut Tx) -> bool {
    s.active = vi;
    if s.docs[di].versions[vi].edit.preedit.is_some() {
        return false;
    }
    if key.is_command('b') {
        s.format("**", tx);
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
fn button(key: &str, label: &str, dark: bool, f: impl Fn(&mut State, &mut Tx) + 'static) -> El {
    let t = tok::theme(dark);
    row()
        .key(key)
        .role("button")
        .label(label)
        .focusable(true)
        .center_y()
        .px(13.0)
        .h(32.0)
        .radius(8.0)
        .fill(t.card)
        .hover(t.control_off)
        .border(1.0, t.card_border)
        .child(text(label).font(TextStyle::new(12.0, 500.0)).color(t.text))
        .on_press_tx(f)
}
fn column(s: &State, di: usize, vi: usize) -> El {
    let t = tok::theme(s.dark);
    let doc = &s.docs[di];
    let v = &doc.versions[vi];
    let mut content = col().w_full().gap(22.0).padding(30.0).child(
        text_input(&v.edit, BODY)
            .key(format!("editor-{}", v.id))
            .role("textbox")
            .label(format!("Version {} Markdown editor", v.number))
            .w_full()
            .min_h(560.0)
            .color(t.text)
            .spans(if s.source { vec![] } else { v.spans.clone() })
            .on_edit(move |s: &mut State| &mut s.docs[di].versions[vi].edit)
            .on_input_change(move |s: &mut State, tx| s.edited(di, vi, tx))
            .on_input_key(move |s, key, tx| input_key(s, di, vi, key, tx))
            .on_input_paste(move |s: &mut State, data, tx| {
                if let Some(image) = data.image() {
                    s.paste_image(di, vi, image.png().to_vec(), tx);
                    true
                } else {
                    false
                }
            }),
    );
    for src in &v.media {
        if let Some(image) = s.images.get(&s.image_path(doc.id(), src)) {
            let ratio = image
                .size()
                .map_or(1.5, |[w, h]| w as f32 / h.max(1) as f32);
            content = content.child(
                el().key(format!("image-{src}"))
                    .role("img")
                    .label("Pasted image attachment")
                    .w_full()
                    .h((360.0 / ratio).clamp(60.0, 260.0))
                    .radius(10.0)
                    .pixels(image.pixels()),
            );
        }
    }
    let header = row()
        .w_full()
        .h(58.0)
        .px(28.0)
        .center_y()
        .gap(12.0)
        .child(
            text(format!("VERSION {:02}", v.number))
                .font(TextStyle::new(11.0, 600.0))
                .color(t.text_secondary),
        )
        .child(el().grow(1.0))
        .child(
            text(format!("{} words", v.edit.text.split_whitespace().count()))
                .key(format!("count-{vi}"))
                .font(TextStyle::new(11.0, 400.0))
                .color(t.text_secondary),
        );
    col()
        .key(format!("version-{}", v.id))
        .grow(1.0)
        .min_w(0.0)
        .h_full()
        .min_h(0.0)
        .fill(t.card)
        .child(header)
        .child(el().h(1.0).w_full().fill(t.card_border))
        .child(
            col()
                .key(format!("scroll-{}", v.id))
                .grow(1.0)
                .min_h(0.0)
                .w_full()
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(content),
        )
}
fn view(s: &State, cx: &mut Cx<State>) -> El {
    let t = tok::theme(s.dark);
    let di = s.selected;
    let doc = &s.docs[di];
    let mut list = col().w_full().gap(6.0);
    for (i, d) in s.docs.iter().enumerate() {
        let title = d.raw["title"].as_str().unwrap_or("Untitled draft");
        list = list.child(
            col()
                .key(format!("draft-{i}"))
                .role("button")
                .label(title)
                .focusable(true)
                .px(14.0)
                .py(14.0)
                .gap(7.0)
                .radius(10.0)
                .fill(if i == di {
                    t.control_off
                } else {
                    Color::TRANSPARENT
                })
                .hover(t.control_off)
                .child(text(title).font(TextStyle::new(13.0, 500.0)).color(t.text))
                .child(
                    text(format!("{} versions", d.versions.len()))
                        .font(TextStyle::new(11.0, 400.0))
                        .color(t.text_secondary),
                )
                .on_press(move |s: &mut State| {
                    s.selected = i;
                    s.focus(0);
                }),
        );
    }
    let sidebar = col()
        .w(232.0)
        .h_full()
        .padding(18.0)
        .gap(26.0)
        .fill(t.bg)
        .child(
            row().h(42.0).center_y().child(
                text("Draft")
                    .font(TextStyle::new(25.0, 600.0))
                    .color(t.text),
            ),
        )
        .child(button("new-draft", "+ New draft", s.dark, |s, _| {
            s.reload(true)
        }))
        .child(
            text("YOUR DRAFTS")
                .font(TextStyle::new(10.0, 600.0))
                .color(t.text_secondary),
        )
        .child(list)
        .child(el().grow(1.0))
        .child(
            text("A little room to think.")
                .font(TextStyle::new(12.0, 400.0).italic())
                .color(t.text_secondary),
        )
        .child(
            text("Native editor experiment\nDisposable writing library")
                .font(TextStyle::new(10.0, 400.0))
                .color(t.text_secondary),
        );
    let titlebar = row()
        .w_full()
        .h(60.0)
        .px(26.0)
        .gap(12.0)
        .center_y()
        .child(
            text(doc.raw["title"].as_str().unwrap_or("Untitled draft"))
                .font(TextStyle::new(16.0, 500.0))
                .color(t.text),
        )
        .child(el().grow(1.0))
        .child(button(
            "theme",
            if s.dark { "Light" } else { "Dark" },
            s.dark,
            |s, _| s.dark = !s.dark,
        ));
    let toolbar = row()
        .w_full()
        .h(52.0)
        .px(24.0)
        .gap(8.0)
        .center_y()
        .child(button("bold", "Bold", s.dark, |s, tx| s.format("**", tx)))
        .child(button("italic", "Italic", s.dark, |s, tx| {
            s.format("*", tx)
        }))
        .child(button("code", "Code", s.dark, |s, tx| s.format("`", tx)))
        .child(button("undo", "Undo", s.dark, |s, tx| {
            let vi = s.active_version();
            s.docs[s.selected].versions[vi].edit.undo();
            s.focus(vi);
            s.edited(s.selected, vi, tx);
        }))
        .child(button("redo", "Redo", s.dark, |s, tx| {
            let vi = s.active_version();
            s.docs[s.selected].versions[vi].edit.redo();
            s.focus(vi);
            s.edited(s.selected, vi, tx);
        }))
        .child(el().grow(1.0))
        .child(button(
            "source",
            if s.source { "Styled" } else { "Source" },
            s.dark,
            |s, _| s.source = !s.source,
        ))
        .child(button("reload", "Reload files", s.dark, |s, _| {
            s.reload(false)
        }));
    let mut columns = row().w_full().grow(1.0).min_h(0.0);
    for vi in 0..doc.versions.len().min(2) {
        if vi > 0 {
            columns = columns.child(el().w(1.0).h_full().fill(t.card_border));
        }
        columns = columns.child(column(s, di, vi));
    }
    let status = row()
        .w_full()
        .h(34.0)
        .px(26.0)
        .center_y()
        .gap(12.0)
        .child(
            text(&s.notice)
                .key("save-status")
                .role("status")
                .font(TextStyle::new(11.0, 400.0))
                .color(t.text_secondary),
        )
        .child(el().grow(1.0))
        .child(
            text("Markdown · Separate undo for each version")
                .font(TextStyle::new(10.0, 400.0))
                .color(t.text_secondary),
        );
    let inset = if cx.titlebar_inset() > 0.0 { 30.0 } else { 0.0 };
    col()
        .key("draft-root")
        .w_full()
        .h_full()
        .fill(t.bg)
        .child(el().w_full().h(inset).window_drag())
        .child(
            row()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .child(sidebar)
                .child(el().w(1.0).h_full().fill(t.card_border))
                .child(
                    col()
                        .grow(1.0)
                        .min_w(0.0)
                        .h_full()
                        .child(titlebar)
                        .child(toolbar)
                        .child(columns)
                        .child(status),
                ),
        )
}
pub(super) fn spec() -> AppSpec<State> {
    AppSpec {
        min_size: Some((1060.0, 650.0)),
        setup: Some(setup),
        poll: Some(poll),
        scenes: &[
            ("dark", |s| s.dark = true),
            ("long", |s| {
                for d in &mut s.docs {
                    for v in &mut d.versions {
                        v.edit=TextEdit::new("A paragraph with café, 日本語, and 👩🏽‍💻. Keep the cursor and the thought together.\n\n".repeat(250));
                        v.spans = styled(&v.edit.text);
                    }
                }
            }),
        ],
        ..AppSpec::new("Draft · Rune prototype", (1280.0, 820.0), State::load, view)
    }
}
