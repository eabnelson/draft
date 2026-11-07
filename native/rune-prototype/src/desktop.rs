use super::*;
#[derive(Default)]
pub struct Integration {
    tray: Option<rune::Tray>,
    pub issue: Option<String>,
}
pub fn preferences(s: &mut State, value: Value) {
    s.services.desktop = value.clone();
    if !cfg!(target_os = "linux") {
        return;
    }
    if value["menuBarIcon"].as_bool() != Some(true) {
        s.desktop.tray = None;
        return;
    }
    if s.desktop.tray.is_some() {
        return;
    }
    let Some(handle) = s.keyboard.app.clone() else {
        return;
    };
    let image = image::load_from_memory(include_bytes!("../../icons/icon.png"))
        .unwrap()
        .thumbnail(24, 24)
        .into_rgba8();
    let spec = rune::TraySpec::new(
        "com.studiofour.draft.native",
        "Draft",
        rune::TrayIcon::rgba(image.width(), image.height(), image.into_raw()),
    )
    .tooltip("Draft")
    .menu(vec![
        rune::TrayItem::action("show", "Show Draft"),
        rune::TrayItem::action("new", "New Draft"),
        rune::TrayItem::action("settings", "Settings"),
        rune::TrayItem::Separator,
        rune::TrayItem::action("quit", "Quit Draft"),
    ]);
    match rune::Tray::new(spec, move |event| {
        handle.update(move |s, tx| {
            let Some(app) = s.keyboard.app.clone() else {
                return;
            };
            match event {
                rune::TrayEvent::Menu(action) => match action.as_str() {
                    "new" => {
                        keyboard::new_draft(s, tx);
                        app.open();
                    }
                    "settings" => {
                        s.preferences = true;
                        app.open();
                    }
                    "quit" => keyboard::quit(s, tx),
                    _ => app.open(),
                },
                rune::TrayEvent::Activate { token } => {
                    if let Some(token) = token {
                        app.activate(&token);
                    } else {
                        app.open();
                    }
                }
                _ => {}
            }
        });
    }) {
        Ok(tray) => {
            s.desktop.tray = Some(tray);
            s.desktop.issue = None;
        }
        Err(error) => s.desktop.issue = Some(error.to_string()),
    }
}
