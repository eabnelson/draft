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
