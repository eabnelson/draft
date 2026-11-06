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
    interactions();
    tab_shortcuts();
    popover_placement();
    sidebar_context();
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
            include_bytes!("../../../src-tauri/icons/icon.png").to_vec(),
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
        rt.frame(0.0);
        click(&mut rt, "settings");
        assert!(rt.state.preferences);
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
fn click(rt: &mut rune::Runtime<State>, name: &str) {
    let (x, y) = rt.find(name).unwrap();
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
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

    let png = include_bytes!("../../../src-tauri/icons/icon.png").to_vec();
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
