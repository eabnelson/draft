// Checks cross the real Rune runtime and Draft's scratch document store.
use super::*;
pub fn run() {
    let mut s = State::load();
    let id = s.docs[0].id().to_owned();
    s.docs[0].versions[0]
        .edit
        .insert("\n\nA round trip: café 日本語 👩🏽‍💻 e\u{301}.\n");
    s.docs[0].raw["prototypeMetadata"] = json!({"preserveUnknownFields":true});
    let expected = s.docs[0].versions[0].edit.text.clone();
    s.host.save(&s.docs[0].snapshot()).unwrap();
    let lib = s.host.library().unwrap();
    let saved = lib.drafts.iter().find(|d| d["id"] == id).unwrap();
    assert_eq!(saved["versions"][0]["text"], expected);
    assert_eq!(saved["prototypeMetadata"]["preserveUnknownFields"], true);
    let updated_at = saved["updatedAt"].clone();
    s.host.save(&s.docs[0].snapshot()).unwrap();
    let again = s.host.library().unwrap();
    assert_eq!(
        again.drafts.iter().find(|d| d["id"] == id).unwrap()["updatedAt"],
        updated_at,
        "an unchanged save must not restore an older timestamp"
    );
    s.install(lib);
    let d = s.docs.iter_mut().find(|d| d.id() == id).unwrap();
    d.versions[0].edit.undo();
    assert_ne!(
        d.versions[0].edit.text, expected,
        "equal reload must retain undo"
    );
    println!(
        "PASS Markdown/Unicode round trip, unknown metadata, and undo retained across equal reload"
    );
    settings_sidebar_toggle();
    interactions();
    tab_shortcuts();
    tab_layout_stability();
    caret_blink();
    popover_placement();
    updates_page();
    sidebar_context();
    shortcut_parity();
    durability();
    inline_media();
    live_sync();
    link_editing();
}

fn settings_sidebar_toggle() {
    let rect = |rt: &rune::Runtime<State>, key: &str| {
        rt.elements()
            .into_iter()
            .find(|element| element.key.as_deref() == Some(key))
            .unwrap_or_else(|| panic!("Missing {key}"))
            .rect
    };
    for (width, height, zoom, dark, section) in [
        (1280.0, 820.0, 1.0, false, 0),
        (780.0, 560.0, 1.0, true, 4),
        (780.0, 560.0, 1.25, false, 0),
        (1280.0, 820.0, 1.25, true, 4),
    ] {
        let mut rt = keyboard::app().headless_runtime((width, height), rune::Env::new(dark, 1.0));
        rt.update(|s, _| {
            s.sidebar = true;
            s.preferences = false;
            s.keyboard.zoom = zoom;
            s.settings.section = section;
        });
        rt.frame(0.0);
        let selected = rt.state.selected;
        let version = rt.state.active_version();
        click(&mut rt, "settings");
        assert!(rt.find("settings-sidebar").is_some());
        let scroll = format!("settings-scroll-{section}");
        let shown_width = rect(&rt, &scroll)[2];
        command(&mut rt, 'b', false);
        assert!(
            !rt.state.sidebar,
            "the sidebar command must toggle its state"
        );
        assert!(rt.state.preferences, "toggling must stay in Settings");
        assert_eq!(rt.state.settings.section, section);
        assert!(
            rt.find("settings-sidebar").is_none(),
            "Toggle Sidebar must remove the Settings navigation sidebar"
        );
        assert!(
            rect(&rt, &scroll)[2] > shown_width + 150.0,
            "Settings uses the freed width"
        );
        assert_eq!(rect(&rt, "settings-header")[0], 0.0);
        assert!(
            rect(&rt, "settings-header-tabs")[0] >= 80.0,
            "the header clears window controls"
        );
        let back = rect(&rt, "settings-back");
        assert!(
            back[1] >= 0.0 && back[1] + back[3] <= height + 1.0,
            "Back stays inside the window"
        );
        let grid = rect(
            &rt,
            if section == 0 {
                "appearance-choices"
            } else {
                "shortcut-grid"
            },
        );
        assert!(
            grid[0] >= 0.0 && grid[0] + grid[2] <= width + 1.0,
            "settings cards fit the expanded page"
        );
        command(&mut rt, 'b', false);
        assert!(
            rt.find("settings-sidebar").is_some(),
            "the command also reopens Settings navigation"
        );
        assert!((rect(&rt, &scroll)[2] - shown_width).abs() < 1.0);
        command(&mut rt, 'b', false);
        click(&mut rt, "settings-back");
        assert!(!rt.state.preferences);
        assert!(
            !rt.state.sidebar,
            "Back preserves the hidden sidebar choice"
        );
        assert_eq!(
            (rt.state.selected, rt.state.active_version()),
            (selected, version)
        );
        command(&mut rt, ',', false);
        assert!(rt.state.preferences);
        assert!(
            rt.find("settings-sidebar").is_none(),
            "Settings also opens with its sidebar hidden"
        );
        command(&mut rt, 'b', false);
        click(&mut rt, "settings-back");
        assert!(
            rt.find("sidebar").is_some(),
            "the toggle continues to work in the writing view"
        );
    }
    println!(
        "PASS Settings sidebar hide/reopen, reclaimed width, reachable Back, header clearance, and writing return at narrow/wide sizes and two zoom levels"
    );
}

fn link_editing() {
    let mut rt = keyboard::app().headless_runtime((780.0, 560.0), rune::Env::new(false, 1.0));
    rt.frame(0.0);
    rt.update(|s, _| {
        s.preferences = false;
        s.source = false;
        s.focus(0);
        let edit = &mut s.docs[s.selected].versions[0].edit;
        *edit = TextEdit::new("A linked phrase.");
        edit.anchor = 2;
        edit.focus = 8;
        edit.focused = true;
        s.context = Some([400.0, 200.0]);
    });
    rt.frame(0.05);
    click(&mut rt, "link-edit");
    let panel = rt
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some("editor-menu"))
        .unwrap();
    assert_eq!(panel.rect[2], 238.0);
    rt.update(|s, _| s.link.as_mut().unwrap().url = TextEdit::new("https://example.com"));
    rt.frame(0.05);
    click(&mut rt, "link-save");
    assert_eq!(
        rt.state.docs[rt.state.selected].versions[0].edit.text,
        "A [linked](<https://example.com>) phrase."
    );
    rt.update(|s, _| s.docs[s.selected].versions[0].edit.undo());
    assert_eq!(
        rt.state.docs[rt.state.selected].versions[0].edit.text,
        "A linked phrase."
    );
    assert_eq!(links::label("[a [nested] label][ref]"), "a [nested] label");
    println!(
        "PASS anchored link editor, reference/nested labels, Markdown save, and one-step undo"
    );
}

fn live_sync() {
    let mut rt = keyboard::app().headless_runtime((1200.0, 820.0), rune::Env::new(false, 1.0));
    rt.frame(0.0);
    let di = rt.state.selected;
    let id = rt.state.docs[di].id().to_owned();
    rt.update(|s, tx| {
        s.docs[di].versions[0].edit.insert("Unsaved local writing");
        s.edited(di, 0, tx);
    });
    let local = rt.state.docs[di].versions[0].edit.text.clone();
    let revision = rt.state.docs[di].revision;
    let mut remote = rt.state.docs[di].snapshot();
    remote["versions"][0]["text"] = json!("Remote writing");
    sync::received(
        &mut rt.state,
        json!({"seq":1000,"changes":[{"id":id,"seq":1000,"draft":remote}]}),
    );
    sync::poll(&mut rt.state);
    assert_eq!(rt.state.docs[di].versions[0].edit.text, local);
    sync::saved(
        &mut rt.state,
        &id,
        revision - 1,
        Ok(json!({"seq":1000,"draft":remote})),
    );
    assert_eq!(
        rt.state.docs[di].versions[0].edit.text, local,
        "an older merged reply keeps newer typing"
    );
    remote["versions"][0]["text"] = json!(format!("Remote writing\n{local}"));
    sync::saved(
        &mut rt.state,
        &id,
        revision,
        Ok(json!({"seq":1000,"draft":remote})),
    );
    sync::poll(&mut rt.state);
    let d = rt.state.docs.iter().find(|d| d.id() == id).unwrap();
    assert!(d.versions[0].edit.text.contains(&local));
    assert!(d.versions[0].edit.text.contains("Remote writing"));
    assert_eq!(d.saved, d.revision);
    println!(
        "PASS live sync defers dirty buffers, ignores older merged acknowledgements, and accepts the latest merged writing"
    );
}

fn inline_media() {
    let mut rt = keyboard::app().headless_runtime((1200.0, 820.0), rune::Env::new(false, 1.0));
    rt.frame(0.0);
    let di = rt.state.selected;
    let id = rt.state.docs[di].id().to_owned();
    let src = rt
        .state
        .host
        .media(&id, include_bytes!("../../icons/icon.png"))
        .unwrap();
    let marker = format!("![Example]({src})");
    rt.update(|s, tx| {
        s.source = false;
        s.preferences = false;
        s.focus(0);
        s.docs[di].versions[0].edit =
            TextEdit::new(format!("Before image.\n\n{marker}\n\nAfter image."));
        s.edited(di, 0, tx);
    });
    let path = rt.state.image_path(&id, &src);
    rt.state.images.get(&path).unwrap().wait().unwrap();
    for _ in 0..10 {
        rt.frame(0.05);
    }
    let vid = rt.state.docs[di].versions[0].id.clone();
    let image_key = format!("image-{vid}-15");
    let image = rt
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some(image_key.as_str()))
        .expect("inline image is laid out");
    let editor = rt
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some(format!("editor-{vid}").as_str()))
        .unwrap();
    assert!(
        image.rect[1] > editor.rect[1] + 25.0,
        "the image follows the first paragraph"
    );
    assert!(
        image.rect[1] + image.rect[3] < editor.rect[1] + editor.rect[3],
        "writing continues after the image"
    );
    rt.update(|s, _| attachments::open(s, di, 0, &src, "", &marker));
    rt.frame(0.05);
    assert!(rt.find("crop-save").is_some());
    rt.update(|s, tx| {
        let mut crop = s.attachment.take().unwrap();
        crop.shape = 2;
        let bytes = attachments::render(&crop, &s.image_path(&id, &src)).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!([decoded.width(), decoded.height()], [1080, 1350]);
        let next = s.host.media(&id, &bytes).unwrap();
        attachments::received(s, crop, Ok(next), tx);
    });
    assert!(
        rt.state.docs[di].versions[0]
            .edit
            .text
            .contains("![Example]("),
        "cropping preserves authored image alt text"
    );
    assert!(
        rt.state.docs[di].versions[0]
            .edit
            .text
            .contains("draft-crop:instagram-carousel")
    );
    rt.update(|s, _| s.docs[di].versions[0].edit.undo());
    assert!(rt.state.docs[di].versions[0].edit.text.contains(&marker));
    println!(
        "PASS inline media geometry, native crop controls, exact social output size, remembered original, and atomic undo"
    );
}

fn durability() {
    let mut rt = keyboard::app().headless_runtime((1200.0, 820.0), rune::Env::new(false, 1.0));
    rt.frame(0.0);
    let id = rt.state.docs[rt.state.selected].id().to_owned();
    let before = rt.state.docs[rt.state.selected].versions[0]
        .edit
        .text
        .clone();
    rt.update(|s, tx| {
        s.focus(0);
        let edit = &mut s.docs[s.selected].versions[0].edit;
        edit.anchor = edit.text.len();
        edit.focus = edit.anchor;
        edit.break_history_group();
        edit.insert("\nDurable 日本語 👩🏽‍💻");
        s.edited(s.selected, 0, tx);
        s.dark = false;
        s.follow_theme = false;
        s.source = true;
        s.expanded = true;
        s.settings.section = 4;
        s.flush(tx).unwrap();
    });
    let after = rt.state.docs[rt.state.selected].versions[0]
        .edit
        .text
        .clone();
    let mut reopened = State::load();
    assert!(!reopened.dark && !reopened.follow_theme && reopened.source && reopened.expanded);
    assert_eq!(reopened.settings.section, 4);
    let d = reopened.docs.iter_mut().find(|d| d.id() == id).unwrap();
    assert_eq!(d.versions[0].edit.text, after);
    d.versions[0].edit.undo();
    assert_eq!(d.versions[0].edit.text, before);
    d.versions[0].edit.redo();
    assert_eq!(d.versions[0].edit.text, after);
    println!(
        "PASS native undo/redo, Unicode writing, preferences, and navigation survive a fresh process state"
    );
}

fn caret_blink() {
    let mut rt = keyboard::app().headless_runtime((1200.0, 820.0), rune::Env::new(false, 1.0));
    rt.window_focus(true);
    rt.update(|s, _| s.focus(0));
    rt.frame(0.0);
    let text = design::Palette::new(false).text;
    assert_eq!(rt.state.caret.color(text), text, "caret matches light text");
    rt.frame(0.51);
    assert_eq!(rt.state.caret.color(text).a, 0.0, "idle caret blinks off");
    rt.frame(0.5);
    assert_eq!(rt.state.caret.color(text), text, "idle caret blinks on");
    rt.frame(0.5);
    key(&mut rt, Key::Text("x".into()));
    assert_eq!(
        rt.state.caret.color(text),
        text,
        "typing restarts the visible phase"
    );
    rt.frame(0.51);
    key(&mut rt, Key::Left);
    assert_eq!(
        rt.state.caret.color(text),
        text,
        "moving the caret restarts blinking"
    );
    rt.update(|s, _| {
        let vi = s.active_version();
        s.docs[s.selected].versions[vi].edit.preedit = Some(("あ".into(), None));
    });
    rt.frame(0.51);
    rt.frame(0.51);
    assert_eq!(
        rt.state.caret.color(text),
        text,
        "composition keeps the caret visible"
    );
    rt.window_focus(false);
    rt.frame(0.016);
    assert_eq!(
        rt.state.caret.color(text).a,
        0.0,
        "unfocused windows hide the caret"
    );
    println!(
        "PASS text-colored caret, idle blinking, typing/navigation reset, composition, and window focus"
    );
}

fn tab_layout_stability() {
    for width in [1280.0, 1200.0, 780.0] {
        for sidebar in [true, false] {
            for zoom in [1.0, 1.25] {
                let mut rt = App::new(ui::spec())
                    .headless_runtime((width, 820.0), rune::Env::new(false, 1.0));
                rt.update(|s, _| {
                    s.sidebar = sidebar;
                    s.keyboard.zoom = zoom;
                    s.focus(0);
                });
                for _ in 0..20 {
                    rt.frame(0.05);
                }
                let keys = rt.state.docs[rt.state.selected]
                    .open_versions()
                    .into_iter()
                    .map(|vi| format!("tab-{}", rt.state.docs[rt.state.selected].versions[vi].id))
                    .collect::<Vec<_>>();
                let rectangles = |rt: &rune::Runtime<State>| {
                    keys.iter()
                        .map(|key| {
                            rt.elements()
                                .into_iter()
                                .find(|e| e.key.as_deref() == Some(key))
                                .unwrap()
                                .rect
                        })
                        .collect::<Vec<_>>()
                };
                let before = rectangles(&rt);
                rt.key(KeyEvent {
                    key: Key::Tab,
                    mods: rune::Mods {
                        ctrl: true,
                        cmd: !cfg!(target_os = "macos"),
                        ..Default::default()
                    },
                });
                for frame in 0..20 {
                    rt.frame(0.05);
                    for (index, (before, after)) in before.iter().zip(rectangles(&rt)).enumerate() {
                        assert!(
                            before.iter().zip(after).all(|(a, b)| (a - b).abs() < 0.01),
                            "switching between fully visible tabs must not move them: width={width}, sidebar={sidebar}, zoom={zoom}, tab={index}, frame={frame}, before={before:?}, after={after:?}"
                        );
                    }
                }
                click(&mut rt, &keys[0]);
                for _ in 0..20 {
                    rt.frame(0.05);
                }
                assert_eq!(
                    rectangles(&rt),
                    before,
                    "clicking back must keep the tab strip fixed"
                );
            }
        }
    }
    println!(
        "PASS visible tab positions remain fixed while switching at three window widths, with/without the sidebar, and at two zoom levels"
    );
}

fn shortcut_parity() {
    let mut rt = keyboard::app().headless_runtime((1280.0, 820.0), rune::Env::new(false, 1.0));
    rt.frame(0.0);
    let count = rt.state.docs[rt.state.selected].versions.len();
    let copied = rt.state.docs[rt.state.selected].versions[rt.state.active_version()]
        .edit
        .text
        .clone();
    key(&mut rt, Key::Command('t'));
    assert!(
        rt.state.docs[rt.state.selected].pending_action,
        "Cmd/Ctrl+T must create a version tab"
    );
    until(&mut rt, |s| s.docs[s.selected].versions.len() == count + 1);
    assert_eq!(
        rt.state.docs[rt.state.selected].versions[rt.state.active_version()]
            .edit
            .text,
        copied
    );
    // Fast repeated presses must not disappear while a preceding host action is pending.
    for _ in 0..3 {
        command(&mut rt, 't', false);
    }
    until(&mut rt, |s| {
        s.docs[s.selected].versions.len() == count + 4
            && s.keyboard.idle()
            && !s.docs[s.selected].pending_action
    });
    assert_eq!(rt.state.active_version(), count + 3);
    let selected_tab = format!(
        "tab-{}",
        rt.state.docs[rt.state.selected].versions[rt.state.active_version()].id
    );
    let [x, _, w, _] = rt
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some(&selected_tab))
        .unwrap()
        .rect;
    assert!(
        x >= 261.0 && x + w <= 1280.01,
        "an offscreen new tab still scrolls fully into view: {x}, {w}"
    );
    let di = rt.state.selected;
    let open = rt.state.docs[di].open_versions();
    let closing = rt.state.docs[di].versions[open[1]].id.clone();
    let neighbor = rt.state.docs[di].versions[open[2]].id.clone();
    rt.update(|s, _| s.focus(open[1]));
    command(&mut rt, 'w', false);
    until(&mut rt, |s| !s.docs[s.selected].pending_action);
    assert_eq!(
        rt.state.docs[di].versions[rt.state.active_version()].id,
        neighbor,
        "closing a middle tab selects the next tab"
    );
    assert!(
        rt.state.docs[di].raw["hiddenVersions"]
            .as_array()
            .unwrap()
            .contains(&json!(closing))
    );
    let saved_texts = rt.state.docs[di]
        .versions
        .iter()
        .map(|v| v.edit.text.clone())
        .collect::<Vec<_>>();
    for _ in 0..count + 6 {
        command(&mut rt, 'w', false);
    }
    until(&mut rt, |s| {
        s.keyboard.idle() && !s.docs[s.selected].pending_action
    });
    assert_eq!(
        rt.state.docs[di].open_versions().len(),
        1,
        "the final tab stays open"
    );
    assert_eq!(
        rt.state.docs[di]
            .versions
            .iter()
            .map(|v| v.edit.text.clone())
            .collect::<Vec<_>>(),
        saved_texts,
        "closing tabs never deletes their writing"
    );
    assert!(rt.find("draft-content").is_some());
    // A pending creation may finish after the user chose another draft.
    command(&mut rt, 't', false);
    command(&mut rt, '9', false);
    let chosen = rt.state.docs[rt.state.selected].id().to_owned();
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    assert_eq!(
        rt.state.docs[rt.state.selected].id(),
        chosen,
        "tab creation must not steal later navigation"
    );
    rt.update(|s, tx| s.flush(tx).unwrap());

    // Populate enough actual stored drafts to check every numbered position and the last-item rule.
    for n in 0..10 {
        let library: Library = rt.state.host.post("/new", &json!({})).unwrap();
        let mut raw = library
            .drafts
            .into_iter()
            .find(|d| d["id"] == library.active)
            .unwrap();
        raw["versions"][0]["text"] = json!(format!("Keyboard item {n}"));
        rt.state.host.save(&raw).unwrap();
    }
    let library = rt.state.host.library().unwrap();
    rt.update(|s, _| s.install(library));
    rt.frame(0.016);
    let listed = rt
        .state
        .docs
        .iter()
        .map(|d| d.id().to_owned())
        .collect::<Vec<_>>();
    command(&mut rt, 'b', false);
    assert!(!rt.state.sidebar);
    for n in 1..=9 {
        command(&mut rt, char::from(b'0' + n), false);
        let at = if n == 9 {
            listed.len() - 1
        } else {
            (n - 1) as usize
        };
        assert_eq!(rt.state.docs[rt.state.selected].id(), listed[at]);
        assert!(
            rt.state.docs[rt.state.selected].versions[rt.state.active_version()]
                .edit
                .focused
        );
    }
    command(&mut rt, '1', false);
    let count = rt.state.docs[rt.state.selected].versions.len();
    command(&mut rt, 't', false);
    until(&mut rt, |s| s.docs[s.selected].versions.len() == count + 1);
    let remembered = rt.state.docs[rt.state.selected].versions[rt.state.active_version()]
        .id
        .clone();
    command(&mut rt, '2', false);
    command(&mut rt, '1', false);
    assert_eq!(
        rt.state.docs[rt.state.selected].versions[rt.state.active_version()].id,
        remembered,
        "draft switching retains the active version"
    );
    command(&mut rt, ',', false);
    let count = rt.state.docs[rt.state.selected].versions.len();
    command(&mut rt, 't', false);
    assert_eq!(
        rt.state.docs[rt.state.selected].versions.len(),
        count,
        "New Version is inactive in Settings"
    );
    command(&mut rt, 'w', false);
    assert!(!rt.state.preferences);
    command(&mut rt, ',', false);
    command(&mut rt, '3', false);
    assert!(!rt.state.preferences, "numbered navigation leaves Settings");
    command(&mut rt, 'b', false);
    let selected = rt.state.selected;
    rt.accessibility_action(
        &format!("draft-{selected}"),
        rune::accesskit::Action::Focus,
        None,
    );
    rt.frame(0.016);
    command(&mut rt, '=', false);
    assert_eq!(rt.state.keyboard.zoom, 1.1, "zoom works with sidebar focus");
    command(&mut rt, '+', true);
    assert_eq!(rt.state.keyboard.zoom, 1.25);
    secondary(&mut rt, &format!("draft-{selected}"));
    let [x, y, w, h] = rt
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some("editor-menu"))
        .unwrap()
        .rect;
    assert!(
        x >= 7.0 && y >= 7.0 && x + w <= 1280.0 && y + h <= 820.0,
        "zoomed context menu stays in the window"
    );
    key(&mut rt, Key::Escape);
    command(&mut rt, '-', false);
    assert_eq!(rt.state.keyboard.zoom, 1.1);
    rt.update(|s, _| s.barrier().unwrap());
    assert_eq!(State::load().keyboard.zoom, 1.1, "zoom survives relaunch");
    command(&mut rt, '0', false);
    assert_eq!(rt.state.keyboard.zoom, 1.0);
    rt.update(|s, tx| s.flush(tx).unwrap());

    let previous_id = rt.state.docs[rt.state.selected].id().to_owned();
    let previous_count = rt.state.docs.len();
    command(&mut rt, 'n', false);
    rt.update(|s, tx| {
        let di = s.docs.iter().position(|d| d.id() == previous_id).unwrap();
        s.docs[di].versions[0].edit.insert(" typed while opening");
        s.edited(di, 0, tx);
    });
    until(&mut rt, |s| s.keyboard.idle());
    let blank = rt.state.docs[rt.state.selected].id().to_owned();
    assert_ne!(blank, previous_id);
    assert_eq!(rt.state.docs.len(), previous_count + 1);
    assert_eq!(rt.state.docs[rt.state.selected].versions.len(), 1);
    assert!(
        rt.state.docs[rt.state.selected].versions[0]
            .edit
            .text
            .is_empty()
    );
    assert!(
        rt.state
            .docs
            .iter()
            .find(|d| d.id() == previous_id)
            .unwrap()
            .versions[0]
            .edit
            .text
            .ends_with(" typed while opening")
    );
    for _ in 0..3 {
        command(&mut rt, 'n', false);
    }
    until(&mut rt, |s| s.keyboard.idle());
    assert_eq!(
        rt.state.docs.len(),
        previous_count + 1,
        "New Draft reuses the latest empty draft"
    );
    assert_eq!(rt.state.docs[rt.state.selected].id(), blank);

    key(&mut rt, Key::Text("underline café 👩🏽‍💻".into()));
    rt.update(|s, _| {
        let e = &mut s.docs[s.selected].versions[0].edit;
        e.anchor = "underline ".len();
        e.focus = "underline café".len();
    });
    command(&mut rt, 'u', false);
    assert_eq!(
        rt.state.docs[rt.state.selected].versions[0].edit.text,
        "underline <u>café</u> 👩🏽‍💻"
    );
    command(&mut rt, 'z', false);
    assert_eq!(
        rt.state.docs[rt.state.selected].versions[0].edit.text,
        "underline café 👩🏽‍💻"
    );
    command(&mut rt, 'z', true);
    assert!(
        rt.state.docs[rt.state.selected].versions[0]
            .edit
            .text
            .contains("<u>café</u>")
    );
    command(&mut rt, 'z', false);
    command(&mut rt, 'y', false);
    assert!(
        rt.state.docs[rt.state.selected].versions[0]
            .edit
            .text
            .contains("<u>café</u>")
    );
    command(&mut rt, 'u', false);
    assert_eq!(
        rt.state.docs[rt.state.selected].versions[0].edit.text, "underline café 👩🏽‍💻",
        "underline toggles without leaving HTML wrappers"
    );
    rt.ime(rune::Ime::Preedit("にほん".into(), Some((0, 9))));
    rt.frame(0.016);
    let count = rt.state.docs[rt.state.selected].versions.len();
    command(&mut rt, 't', false);
    assert_eq!(
        rt.state.docs[rt.state.selected].versions.len(),
        count,
        "IME composition owns its keys"
    );
    rt.ime(rune::Ime::Commit("日本".into()));
    rt.frame(0.016);
    command(&mut rt, 's', false);
    until(&mut rt, |s| s.docs.iter().all(|d| d.revision == d.saved));
    rt.update(|s, tx| s.flush(tx).unwrap());
    println!(
        "PASS shortcut parity: new/copy/close tabs, queued presses, numbered drafts and remembered tabs, Settings, persisted zoom, new/empty draft reuse, underline/undo/redo, save, and IME"
    );
}

fn command(rt: &mut rune::Runtime<State>, key: char, shift: bool) {
    rt.key(KeyEvent {
        key: Key::Command(key),
        mods: rune::Mods {
            cmd: true,
            logo: cfg!(target_os = "macos"),
            ctrl: !cfg!(target_os = "macos"),
            shift,
            ..Default::default()
        },
    });
    rt.frame(0.016);
}

fn sidebar_context() {
    let mut rt = App::new(ui::spec()).headless_runtime((1280.0, 820.0), rune::Env::new(false, 1.0));
    rt.frame(0.0);
    let selected = rt.state.selected;
    let selected_id = rt.state.docs[selected].id().to_owned();
    let target = (selected + 1) % rt.state.docs.len();
    let target_id = rt.state.docs[target].id().to_owned();
    let target_text = rt.state.docs[target].snapshot()["versions"].clone();
    let updated = rt.state.docs[target].raw["updatedAt"].clone();
    rt.update(|s, _| s.context = Some([700.0, 300.0]));
    rt.frame(0.016);
    let (x, y) = rt.find(&format!("draft-{target}")).unwrap();
    rt.secondary_down(x, y);
    rt.secondary_up(x, y);
    rt.frame(0.016);
    assert!(
        rt.find("draft-open").is_some() && rt.find("item-rename").is_some(),
        "right-clicking a sidebar draft opens its draft menu"
    );
    assert_eq!(
        rt.state.selected, selected,
        "right-click keeps the current draft"
    );
    menu_click(&mut rt, "draft-pin");
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    assert!(
        rt.state
            .docs
            .iter()
            .find(|d| d.id() == target_id)
            .unwrap()
            .raw["pinned"]
            == true
    );
    assert_eq!(rt.state.docs[rt.state.selected].id(), selected_id);
    let di = rt
        .state
        .docs
        .iter()
        .position(|d| d.id() == target_id)
        .unwrap();
    secondary(&mut rt, &format!("draft-{di}"));
    menu_click(&mut rt, "item-rename");
    key(&mut rt, Key::Text("Renamed from the sidebar".into()));
    key(&mut rt, Key::Enter);
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    let d = rt.state.docs.iter().find(|d| d.id() == target_id).unwrap();
    assert_eq!(d.raw["title"], "Renamed from the sidebar");
    assert_eq!(
        d.snapshot()["versions"],
        target_text,
        "renaming never changes writing"
    );
    assert_eq!(
        d.raw["updatedAt"], updated,
        "metadata keeps the last-edited time"
    );
    let di = rt
        .state
        .docs
        .iter()
        .position(|d| d.id() == target_id)
        .unwrap();
    secondary(&mut rt, &format!("draft-{di}"));
    menu_click(&mut rt, "stage-ready");
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    assert_eq!(
        items::stage(rt.state.docs.iter().find(|d| d.id() == target_id).unwrap()),
        "Ready"
    );
    let disk = rt
        .state
        .host
        .library()
        .unwrap()
        .drafts
        .into_iter()
        .find(|d| d["id"] == target_id)
        .unwrap();
    assert_eq!(disk["title"], "Renamed from the sidebar");
    assert_eq!(disk["manualStage"], "ready");
    assert_eq!(disk["pinned"], true);

    let di = rt
        .state
        .docs
        .iter()
        .position(|d| d.id() == target_id)
        .unwrap();
    secondary(&mut rt, &format!("draft-{di}"));
    menu_click(&mut rt, "draft-open");
    secondary(&mut rt, &format!("draft-{di}"));
    menu_click(&mut rt, "item-new-version");
    rt.update(|s, tx| {
        let di = s.selected;
        s.docs[di].versions[0]
            .edit
            .insert(" + typed while creating a version");
        s.edited(di, 0, tx);
    });
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    let di = rt.state.selected;
    assert_eq!(rt.state.docs[di].versions.len(), 3);
    assert!(
        rt.state.docs[di].versions[0]
            .edit
            .text
            .contains("typed while creating a version")
    );
    assert!(
        rt.state.docs[di].versions[2]
            .edit
            .text
            .starts_with(target_text[0]["text"].as_str().unwrap()),
        "a new version copies the source writing while its live buffer keeps newer typing"
    );
    let version = rt.state.docs[di].versions[2].id.clone();
    assert!(
        rt.elements()
            .iter()
            .any(|e| e.key.as_deref() == Some(&format!("editor-{version}"))),
        "new versions get real editor columns"
    );
    secondary(&mut rt, &format!("sidebar-version-{version}"));
    assert!(
        rt.find("version-close").is_some(),
        "version menu: target {:?}, entries {:?}",
        rt.state.item_menu.as_ref().map(|c| (&c.draft, &c.version)),
        rt.elements()
            .iter()
            .filter(|e| e.role == "button")
            .map(|e| (&e.key, e.rect))
            .collect::<Vec<_>>()
    );
    assert!(
        rt.find("draft-pin").is_none(),
        "a version gets its version menu"
    );
    menu_click(&mut rt, "item-rename");
    key(&mut rt, Key::Text("A named version".into()));
    key(&mut rt, Key::Enter);
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    assert_eq!(rt.state.docs[di].version_title(2), "A named version");
    secondary(&mut rt, &format!("sidebar-version-{version}"));
    menu_click(&mut rt, "version-close");
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    assert_eq!(rt.state.docs[di].open_versions().len(), 2);
    click(&mut rt, &format!("sidebar-version-{version}"));
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    assert_eq!(rt.state.docs[di].open_versions().len(), 3);
    secondary(&mut rt, &format!("sidebar-version-{version}"));
    menu_click(&mut rt, "item-delete");
    assert_eq!(
        rt.state.docs[di].versions.len(),
        3,
        "delete requires confirmation"
    );
    menu_click(&mut rt, "item-cancel");
    secondary(&mut rt, &format!("sidebar-version-{version}"));
    menu_click(&mut rt, "item-delete");
    menu_click(&mut rt, "item-delete-confirm");
    until(&mut rt, |s| s.docs.iter().all(|d| !d.pending_action));
    assert_eq!(rt.state.docs[di].versions.len(), 2);

    secondary(&mut rt, &format!("draft-{di}"));
    menu_click(&mut rt, "draft-export");
    assert!(rt.file_dialog().is_some());
    let exports = PathBuf::from(std::env::var_os("DRAFT_RUNE_DATA_ROOT").unwrap()).join("Exports");
    std::fs::create_dir_all(&exports).unwrap();
    rt.resolve_file_dialog(Some(exports.clone())).unwrap();
    rt.frame(0.016);
    until(&mut rt, |s| s.notice.starts_with("Exported to "));
    let exported = std::fs::read_dir(exports)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert!(
        exported.join("draft.json").is_file()
            && exported.join("v1.md").is_file()
            && exported.join("v2.txt").is_file()
    );
    secondary(&mut rt, &format!("draft-{di}"));
    menu_click(&mut rt, "draft-archive");
    until(&mut rt, |s| s.docs.iter().all(|d| d.id() != target_id));
    assert_eq!(rt.state.archived, 1);
    click(&mut rt, "settings");
    click(&mut rt, "settings-section-2");
    menu_click(&mut rt, "restore");
    until(&mut rt, |s| s.docs.iter().any(|d| d.id() == target_id));
    assert_eq!(rt.state.archived, 0);
    let di = rt
        .state
        .docs
        .iter()
        .position(|d| d.id() == target_id)
        .unwrap();
    secondary(&mut rt, &format!("draft-{di}"));
    menu_click(&mut rt, "item-delete");
    menu_click(&mut rt, "item-delete-confirm");
    until(&mut rt, |s| s.docs.iter().all(|d| d.id() != target_id));
    rt.update(|s, tx| s.flush(tx).unwrap());
    assert!(
        rt.state
            .host
            .library()
            .unwrap()
            .drafts
            .iter()
            .all(|d| d["id"] != target_id),
        "a pending save must not resurrect a removed draft"
    );
    let recovery = PathBuf::from(std::env::var_os("DRAFT_RUNE_DATA_ROOT").unwrap())
        .join("Drafts/Recovery/Deleted");
    assert!(std::fs::read_dir(recovery).unwrap().any(|e| {
        e.unwrap()
            .file_name()
            .to_string_lossy()
            .contains(&target_id)
    }));
    let mut narrow =
        App::new(ui::spec()).headless_runtime((780.0, 560.0), rune::Env::new(false, 1.0));
    narrow.frame(0.0);
    secondary(&mut narrow, "draft-0");
    let menu = narrow
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some("editor-menu"))
        .unwrap()
        .rect;
    assert!(
        menu[1] >= 8.0 && menu[1] + menu[3] <= 552.0,
        "a long draft menu fits the small window: {menu:?}"
    );
    menu_click(&mut narrow, "draft-export");
    assert!(
        narrow.file_dialog().is_some(),
        "scrolling exposes actions below the fold"
    );
    narrow.resolve_file_dialog(None).unwrap();
    narrow.frame(0.016);
    let last_id = rt.state.docs[rt.state.selected].id().to_owned();
    let number = rt.state.docs[rt.state.selected].versions[0].number;
    rt.update(|s, tx| {
        s.paste_image(
            s.selected,
            0,
            include_bytes!("../../icons/icon.png").to_vec(),
            tx,
        );
        items::request_for(s, &last_id, json!({"kind":"archive"}));
        assert!(s.docs[s.selected].pending_removal);
        s.flush(tx).unwrap();
    });
    let archived = PathBuf::from(std::env::var_os("DRAFT_RUNE_DATA_ROOT").unwrap())
        .join("Drafts/Archive")
        .join(format!("{last_id}.draft"));
    let writing = std::fs::read_to_string(archived.join(format!("versions/v{number}.md"))).unwrap();
    assert!(
        writing.contains("![Pasted image]("),
        "archive includes an image paste that was still pending"
    );
    assert!(
        media_paths(&writing)
            .iter()
            .all(|src| archived.join(src).is_file())
    );
    assert!(
        !rt.state.docs.is_empty(),
        "archiving the last draft opens a fresh draft"
    );
    let d = &rt.state.docs[rt.state.selected];
    let protected: Result<ActionResult, _> = rt.state.host.post(
        "/action",
        &json!({
            "draft":d.snapshot(),"action":{"kind":"delete-version","version":d.versions[0].id}
        }),
    );
    assert!(protected.is_err(), "the host protects the final version");
    let fresh_id = d.id().to_owned();
    rt.update(|s, tx| {
        items::request_for(s, &fresh_id, json!({"kind":"new-version"}));
        s.flush(tx).unwrap();
    });
    assert_eq!(rt.state.docs[rt.state.selected].versions.len(), 2);
    assert_eq!(
        rt.state
            .host
            .library()
            .unwrap()
            .drafts
            .iter()
            .find(|d| d["id"] == fresh_id)
            .unwrap()["versions"]
            .as_array()
            .unwrap()
            .len(),
        2,
        "closing while an action is pending must not overwrite its new version"
    );
    println!(
        "PASS targeted sidebar/version menus, rename, pin, status, version create/close/reopen/delete, export, archive/restore, Recovery, and typing during replies"
    );
}

fn secondary(rt: &mut rune::Runtime<State>, key: &str) {
    for _ in 0..12 {
        rt.frame(0.05);
    }
    let (x, y) = rt.find(key).unwrap_or_else(|| panic!("Missing {key}"));
    rt.secondary_down(x, y);
    rt.secondary_up(x, y);
    rt.frame(0.016);
}
fn menu_click(rt: &mut rune::Runtime<State>, key: &str) {
    rt.update(|_, tx| tx.scroll_into_view(key));
    for _ in 0..12 {
        rt.frame(0.05);
    }
    click(rt, key);
}

fn popover_placement() {
    let rect = |rt: &rune::Runtime<State>, key: &str| {
        let [x, y, w, h] = rt
            .elements()
            .into_iter()
            .find(|e| e.key.as_deref() == Some(key))
            .unwrap_or_else(|| panic!("Missing {key}"))
            .rect;
        [x, y, x + w, y + h]
    };
    for (width, height) in [(1280.0, 820.0), (780.0, 560.0)] {
        let mut rt =
            App::new(ui::spec()).headless_runtime((width, height), rune::Env::new(false, 1.0));
        rt.update(|s, _| {
            s.sidebar = true;
            s.preferences = false;
        });
        rt.frame(0.0);
        let gear = rect(&rt, "settings");
        let first = rt.state.docs[rt.state.selected].open_versions()[0];
        let version = rt.state.docs[rt.state.selected].versions[first].id.clone();
        let writing_header = rect(&rt, &format!("tab-{version}"));
        click(&mut rt, "settings");
        assert!(rt.state.preferences);
        let back = rect(&rt, "settings-back");
        assert_eq!(
            [back[0], back[1], back[3]],
            [gear[0], gear[1], gear[3]],
            "Back replaces the gear at the bottom of the sidebar"
        );
        let header = rect(&rt, "settings-header");
        assert_eq!(
            [header[0], header[1], header[3]],
            [writing_header[0], writing_header[1], writing_header[3]],
            "Settings uses the writing tab's header position and height"
        );
        assert!(rt.find("settings-page").is_some());
        assert!(rt.find("editor-menu").is_none(), "Settings is a page");
        click(&mut rt, "settings-section-3");
        assert_eq!(rt.state.settings.section, 3);
        assert!(rt.find("sync-sign-in").is_some());
        key(&mut rt, Key::Escape);
        assert!(!rt.state.preferences);
        rt.update(|s, _| s.context = Some([width - 2.0, height - 2.0]));
        rt.frame(0.016);
        let popup = rect(&rt, "editor-menu");
        assert!(
            popup[0] >= 8.0
                && popup[1] >= 8.0
                && popup[2] <= width - 8.0
                && popup[3] <= height - 8.0,
            "A context menu near the bottom-right edge stays fully visible: {popup:?}"
        );
        assert!(height - popup[3] <= 10.0, "stay close to the click");
        rt.update(|s, _| {
            s.context = None;
            s.sidebar = false;
            s.preferences = true;
        });
        rt.frame(0.016);
        assert!(
            rt.find("settings-page").is_some(),
            "Settings works with the drafts sidebar hidden"
        );
        click(&mut rt, "settings-back");
        assert!(!rt.state.preferences);
        rt.update(|s, _| {
            s.sidebar = true;
            // Control incoming status here without a real remote account or network failure.
            s.replies = None;
            s.settings.issue = None;
        });
        for state in [
            "off",
            "waiting",
            "syncing",
            "synced",
            "signing-in",
            "choose-folder",
            "choose-workspace",
        ] {
            rt.update(|s, _| {
                s.settings.status = serde_json::from_value(json!({"state":state})).unwrap()
            });
            rt.frame(0.016);
            assert!(
                rt.find("sync-error").is_none(),
                "{state} keeps the cloud hidden"
            );
        }
        for state in ["error", "needs-credentials"] {
            rt.update(|s, _| {
                s.settings.status = serde_json::from_value(
                    json!({"state":state,"message":"Reconnect to resume sync"}),
                )
                .unwrap()
            });
            rt.frame(0.016);
            click(&mut rt, "sync-error");
            assert!(rt.state.preferences);
            assert_eq!(
                rt.state.settings.section, 3,
                "The error button goes directly to Sync"
            );
            click(&mut rt, "settings-back");
        }
        rt.update(|s, _| {
            s.settings.status = serde_json::from_value(json!({"state":"synced"})).unwrap()
        });
        rt.frame(0.016);
        assert!(
            rt.find("sync-error").is_none(),
            "The cloud disappears after recovery"
        );
    }
    println!(
        "PASS Settings page, direct Sync routing, error-only cloud/recovery, context-menu edge flipping, and hidden sidebar at two window sizes"
    );
}

fn tab_shortcuts() {
    let mut rt = App::new(ui::spec())
        .tab_visits_controls(true)
        .headless_runtime((1280.0, 820.0), rune::Env::new(false, 1.0));
    rt.frame(0.0);
    let di = rt.state.selected;
    rt.update(|s, _| {
        s.focus(0);
        for v in &mut s.docs[di].versions {
            v.edit.anchor = 2;
            v.edit.focus = 3;
        }
    });
    rt.frame(0.016);
    let before = rt.state.docs[di].snapshot();
    let selections = rt.state.docs[di]
        .versions
        .iter()
        .map(|v| (v.edit.anchor, v.edit.focus))
        .collect::<Vec<_>>();
    rt.accessibility_action(&format!("draft-{di}"), rune::accesskit::Action::Focus, None);
    rt.frame(0.016);
    assert!(
        rt.state.docs[di].versions.iter().all(|v| !v.edit.focused),
        "start with the highlighted sidebar draft holding focus"
    );
    let cycle = |rt: &mut rune::Runtime<State>, shift| {
        rt.key(KeyEvent {
            key: Key::Tab,
            mods: rune::Mods {
                ctrl: true,
                cmd: !cfg!(target_os = "macos"),
                shift,
                ..Default::default()
            },
        });
        rt.frame(0.016);
    };
    cycle(&mut rt, false);
    assert_eq!(
        rt.state.active_version(),
        1,
        "Control+Tab from a highlighted sidebar draft must select its next open version"
    );
    assert!(rt.state.docs[di].versions[1].edit.focused);
    cycle(&mut rt, true);
    assert_eq!(
        rt.state.active_version(),
        0,
        "Control+Shift+Tab switches back while an editor holds focus"
    );
    cycle(&mut rt, true);
    assert_eq!(
        rt.state.active_version(),
        1,
        "backward cycling wraps around"
    );
    cycle(&mut rt, false);
    assert_eq!(rt.state.active_version(), 0, "forward cycling wraps around");
    assert_eq!(
        rt.state.selected, di,
        "cycling versions keeps the highlighted draft"
    );
    assert_eq!(
        rt.state.docs[di].snapshot(),
        before,
        "cycling never inserts a tab or changes writing"
    );
    assert_eq!(
        rt.state.docs[di]
            .versions
            .iter()
            .map(|v| (v.edit.anchor, v.edit.focus))
            .collect::<Vec<_>>(),
        selections,
        "each version retains its selection"
    );
    println!(
        "PASS Control+Tab and Control+Shift+Tab from sidebar and editor, wrapping, and selection preservation"
    );
}

fn key(rt: &mut rune::Runtime<State>, key: Key) {
    rt.key(KeyEvent {
        key,
        mods: Default::default(),
    });
    rt.frame(0.016);
}
/// Updates says which Draft is running, offers a found release, and a ready one shows in the footer.
fn updates_page() {
    let mut rt = keyboard::app().headless_runtime((1280.0, 820.0), rune::Env::new(true, 1.0));
    let shown = |rt: &rune::Runtime<State>| {
        rt.elements()
            .iter()
            .filter_map(|e| e.text.clone().or_else(|| e.label.clone()))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let applied = json!({"id":"old","kind":"official","title":"A new version of Draft","state":"applied","stage":"Updated","version":"0.3.0-alpha.76","when":"Nov 7 at 5:21 PM"});
    let features = |updates: Value| {
        json!({"appVersion":"0.3.0-alpha.76","canUndo":true,"previousAppVersion":"0.3.0-alpha.75",
            "latestOfficial":{"tag":"v0.3.0-alpha.78","notes":["Draft is now available for Linux."]},
            "updateCheck":{"at":"2026-11-09T03:37:56Z","when":"just now"},"updates":updates})
    };
    rt.update(|s, _| {
        // Drop the host's own answers, including any already on their way, so the page
        // shows exactly this state.
        s.replies = None;
        let later = Instant::now() + Duration::from_secs(3600);
        s.services.next_refresh = Some(later);
        s.services.next_background = Some(later);
        s.services.busy = false;
        s.sidebar = true;
        s.preferences = true;
        s.settings.section = 7;
        s.services.features = features(json!([applied]));
    });
    rt.frame(0.016);
    rt.frame(0.016);
    let page = shown(&rt);
    for expected in [
        "Draft 0.3.0-alpha.76",
        "Draft 0.3.0-alpha.78 is available.",
        "Draft is now available for Linux.",
        "Update to Draft 0.3.0-alpha.78",
        "Go back to Draft 0.3.0-alpha.75",
        "Draft 0.3.0-alpha.76 · Updated · Nov 7 at 5:21 PM",
    ] {
        assert!(
            page.contains(expected),
            "Updates shows {expected:?}:\n{page}"
        );
    }
    assert!(!page.contains("A new version of Draft"), "{page}");
    assert!(rt.find("install-update").is_some());
    let label = |rt: &rune::Runtime<State>| {
        rt.elements()
            .iter()
            .find(|e| e.key.as_deref() == Some("update") && !e.exiting)
            .and_then(|e| e.label.clone())
    };
    // A found release shows beside Settings, like the sync cloud, and opens Updates.
    rt.update(|s, _| s.preferences = false);
    rt.frame(0.016);
    rt.frame(0.016);
    assert_eq!(
        label(&rt).as_deref(),
        Some("Draft 0.3.0-alpha.78 is available. Open Updates")
    );
    click(&mut rt, "update");
    assert!(rt.state.preferences);
    assert_eq!(
        rt.state.settings.section, 7,
        "the update button opens Updates"
    );
    // Up to date: no button.
    rt.update(|s, _| {
        s.services.features = json!({"appVersion":"0.3.0-alpha.78","updates":[applied]});
        s.preferences = false;
    });
    rt.frame(0.016);
    rt.frame(0.016);
    assert!(
        label(&rt).is_none(),
        "an up-to-date Draft shows no update button"
    );
    let ready = json!({"id":"new","kind":"official","title":"Draft 0.3.0-alpha.78","state":"ready","stage":"Update ready","version":"0.3.0-alpha.78","summary":"Draft is now available for Linux.","when":"just now"});
    rt.update(|s, _| s.services.features = features(json!([ready, applied])));
    rt.frame(0.016);
    rt.frame(0.016);
    assert_eq!(
        label(&rt).as_deref(),
        Some("Draft 0.3.0-alpha.78 is ready. Open Updates to restart")
    );
    click(&mut rt, "update");
    assert_eq!(rt.state.settings.section, 7);
    let page = shown(&rt);
    assert!(
        page.contains("Draft 0.3.0-alpha.78 is ready. Restart Draft to finish updating."),
        "{page}"
    );
    assert!(rt.find("apply-new").is_some());
    assert!(rt.find("install-update").is_none(), "one update at a time");
    println!(
        "PASS Updates names the running and available versions; an available or ready update shows beside Settings"
    );
}
fn click(rt: &mut rune::Runtime<State>, name: &str) {
    let (x, y) = rt.find(name).unwrap_or_else(|| panic!("Missing {name}"));
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(0.016);
    // Newly mounted scroll containers resolve their hit regions on the following frame.
    rt.frame(0.016);
}
fn until(rt: &mut rune::Runtime<State>, condition: impl Fn(&State) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition(&rt.state) {
        assert!(
            Instant::now() < deadline,
            "Timed out waiting for the host: {}",
            rt.state.notice
        );
        std::thread::sleep(Duration::from_millis(10));
        rt.frame(0.016);
    }
}
fn interactions() {
    let mut rt = App::new(ui::spec()).headless_runtime((1280.0, 820.0), rune::Env::new(false, 1.0));
    rt.frame(0.0);
    let di = rt.state.selected;
    let original = rt.state.docs[di]
        .versions
        .iter()
        .map(|v| v.edit.text.clone())
        .collect::<Vec<_>>();
    rt.update(|s, _| s.focus(0));
    rt.frame(0.0);
    key(&mut rt, Key::Text("Native first version.".into()));
    key(&mut rt, Key::Enter);
    assert!(
        rt.state.docs[di].versions[0]
            .edit
            .text
            .ends_with("Native first version.\n"),
        "Return must insert a newline, never submit"
    );
    let first = rt.state.docs[di].versions[0].edit.text.clone();
    rt.update(|s, _| s.focus(1));
    rt.frame(0.0);
    key(&mut rt, Key::Text("Second version.".into()));
    key(&mut rt, Key::Command('z'));
    assert_eq!(rt.state.docs[di].versions[1].edit.text, original[1]);
    assert_eq!(rt.state.docs[di].versions[0].edit.text, first);
    println!("PASS keyboard editing, plain Return, and independent version undo");

    let before = rt.state.docs[di].versions[1].edit.text.clone();
    rt.ime(rune::Ime::Preedit("にほん".into(), Some((0, 9))));
    rt.frame(0.016);
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text, before,
        "preedit must not be saved as committed writing"
    );
    key(&mut rt, Key::Enter);
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text, before,
        "Return during composition must not insert a newline"
    );
    rt.ime(rune::Ime::Commit("日本語".into()));
    rt.frame(0.016);
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text,
        format!("{before}日本語")
    );
    println!("PASS IME preedit/commit and composition-safe Return");

    rt.update(|s, _| {
        let e = &mut s.docs[di].versions[1].edit;
        e.replace_text("café 日本語 👩🏽‍💻");
        e.anchor = "café ".len();
        e.focus = "café 日本語".len();
    });
    rt.frame(0.016);
    rt.update(|s, _| s.context = Some([300.0, 200.0]));
    rt.frame(0.016);
    click(&mut rt, "bold");
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text, "café **日本語** 👩🏽‍💻",
        "toolbar must target the last focused version"
    );
    key(&mut rt, Key::Command('z'));
    assert_eq!(rt.state.docs[di].versions[1].edit.text, "café 日本語 👩🏽‍💻");
    rt.update(|s, _| {
        let e = &mut s.docs[di].versions[1].edit;
        e.replace_text("👩🏽‍💻");
        e.anchor = e.text.len();
        e.focus = e.text.len();
    });
    rt.frame(0.016);
    key(&mut rt, Key::Backspace);
    assert!(
        rt.state.docs[di].versions[1].edit.text.is_empty(),
        "Backspace must remove the entire grapheme"
    );
    println!("PASS context-menu formatting, atomic undo, and joined-emoji Backspace");

    rt.update(|s, _| {
        let e = &mut s.docs[di].versions[1].edit;
        e.replace_text("Title\nfirst\nsecond");
        e.anchor = 2;
        e.focus = 2;
        s.context = Some([300.0, 200.0]);
    });
    rt.frame(0.016);
    let disabled = |rt: &rune::Runtime<State>, key: &str| {
        rt.elements()
            .into_iter()
            .find(|e| e.key.as_deref() == Some(key))
            .unwrap_or_else(|| panic!("Missing {key}"))
            .focusable
            .then_some(())
            .is_none()
    };
    assert!(
        disabled(&rt, "cut") && disabled(&rt, "copy"),
        "nothing selected to cut or copy"
    );
    assert!(!disabled(&rt, "paste") && !disabled(&rt, "select-all"));
    click(&mut rt, "heading-1");
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text,
        "# Title\nfirst\nsecond"
    );
    assert_eq!(
        rt.state.docs[di].versions[1].edit.focus, 4,
        "the caret stays in the word"
    );
    assert!(
        rt.state.context.is_none(),
        "choosing a style closes the menu"
    );
    rt.update(|s, _| {
        let e = &mut s.docs[di].versions[1].edit;
        e.anchor = "# Title\n".len();
        e.focus = e.text.len();
        s.context = Some([300.0, 200.0]);
    });
    rt.frame(0.016);
    click(&mut rt, "list-numbered");
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text,
        "# Title\n1. first\n2. second"
    );
    key(&mut rt, Key::Command('z'));
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text, "# Title\nfirst\nsecond",
        "a paragraph style is one undo step"
    );
    rt.update(|s, _| s.context = Some([300.0, 200.0]));
    rt.frame(0.016);
    click(&mut rt, "select-all");
    let e = &rt.state.docs[di].versions[1].edit;
    assert_eq!(e.range(), (0, e.text.len()));
    rt.update(|s, _| s.context = Some([300.0, 200.0]));
    rt.frame(0.016);
    assert!(!disabled(&rt, "cut"));
    click(&mut rt, "cut");
    assert!(
        rt.state.docs[di].versions[1].edit.text.is_empty(),
        "Cut removes the selection"
    );
    key(&mut rt, Key::Command('z'));
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text,
        "# Title\nfirst\nsecond"
    );
    println!("PASS text menu clipboard state, select all, cut, headings, numbered lists, and undo");

    rt.update(|s, _| {
        s.focus(1);
        let e = &mut s.docs[di].versions[1].edit;
        e.replace_text("- one\n- two");
        e.anchor = e.text.len();
        e.focus = e.text.len();
    });
    rt.frame(0.016);
    key(&mut rt, Key::Tab);
    assert_eq!(rt.state.docs[di].versions[1].edit.text, "- one\n    - two");
    let focused = rt
        .elements()
        .into_iter()
        .find(|e| e.focused)
        .and_then(|e| e.key)
        .unwrap_or_default();
    assert!(
        focused.starts_with("editor-"),
        "Tab keeps typing in the editor instead of moving to the sidebar: {focused}"
    );
    rt.key(KeyEvent {
        key: Key::Tab,
        mods: rune::Mods {
            shift: true,
            ..Default::default()
        },
    });
    rt.frame(0.016);
    assert_eq!(rt.state.docs[di].versions[1].edit.text, "- one\n- two");
    key(&mut rt, Key::Text("!".into()));
    assert!(rt.state.docs[di].versions[1].edit.text.ends_with("two!"));
    println!("PASS Tab and Shift+Tab nest list items and keep focus in the editor");

    key(&mut rt, Key::Text("Before save".into()));
    rt.update(|s, _| s.save());
    rt.frame(0.016);
    key(&mut rt, Key::Text(" + typed while saving".into()));
    let latest = rt.state.docs[di].versions[1].edit.text.clone();
    until(&mut rt, |s| s.docs[di].queued.is_none());
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text, latest,
        "an older acknowledgement must not replace new typing"
    );
    rt.update(|s, tx| {
        s.due = Some(Instant::now());
        tx.wake_after(Duration::ZERO);
    });
    rt.frame(0.016);
    until(&mut rt, |s| s.docs.iter().all(|d| d.saved == d.revision));
    let lib = rt.state.host.library().unwrap();
    let id = rt.state.docs[di].id();
    assert_eq!(
        lib.drafts.iter().find(|d| d["id"] == id).unwrap()["versions"][1]["text"],
        latest
    );
    println!("PASS older save acknowledgement retains newer typing; newest text reaches disk");

    let png = include_bytes!("../../icons/icon.png").to_vec();
    let image = rune::ClipboardImage::from_png(png).unwrap();
    rt.paste_content(rune::ClipboardContent::new("").with_image(image));
    rt.frame(0.016);
    until(&mut rt, |s| {
        s.docs[di].versions[1]
            .edit
            .text
            .contains("![Pasted image](media/")
    });
    let with_image = rt.state.docs[di].versions[1].edit.text.clone();
    let src = media_paths(&with_image).pop().unwrap();
    let path = rt.state.image_path(rt.state.docs[di].id(), &src);
    assert!(path.is_file());
    rt.state.images.get(&path).unwrap().wait().unwrap();
    key(&mut rt, Key::Command('z'));
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text, latest,
        "one undo removes the image paste"
    );
    println!("PASS image paste through the real host, native decode, and one-step undo");

    // A .md file copied from a code editor carries the editor's HTML beside its Markdown text.
    let markdown = "**Marketing**  \n- youtube \\- keep updated\n- $5/mo";
    rt.paste_content(
        rune::ClipboardContent::new(markdown)
            .with_html("<div><span>**Marketing**</span><br><span>- youtube</span></div>"),
    );
    rt.frame(0.016);
    assert!(
        rt.state.docs[di].versions[1].edit.text.contains(markdown),
        "Markdown text pastes as written, with no escaped syntax"
    );
    key(&mut rt, Key::Command('z'));
    assert_eq!(rt.state.docs[di].versions[1].edit.text, latest);
    rt.paste_content(
        rune::ClipboardContent::new("Plan\nGoals\nOne\nTwo").with_html(
            "<b style=\"font-weight:normal\" id=\"docs-internal-guid-1\"><h2>Plan</h2><p><span style=\"font-weight:700\">Goals</span></p><ol><li>One</li><li>Two</li></ol></b>",
        ),
    );
    rt.frame(0.016);
    assert!(
        rt.state.docs[di].versions[1]
            .edit
            .text
            .contains("## Plan\n**Goals**\n1. One\n2. Two"),
        "a document's headings, bold and numbering come through"
    );
    key(&mut rt, Key::Command('z'));
    assert_eq!(
        rt.state.docs[di].versions[1].edit.text, latest,
        "one undo removes a formatted paste"
    );
    println!("PASS Markdown text pastes as written; document formatting becomes Markdown");

    let tree = rt.accessibility_json().to_string();
    assert!(
        tree.contains("Version 1 Markdown editor") && tree.contains("Version 2 Markdown editor")
    );
    println!("PASS both native text editors expose accessible names");

    rt.update(|s, tx| {
        s.flush(tx).unwrap();
    });
    rt.frame(0.016);
    println!("PASS serialized final flush after pending writes");
}
