//! A responsive shortcut reference, with physical keycaps rather than text notation.
use super::*;

#[derive(Clone, Copy)]
enum Keycap {
    Command,
    Control,
    Option,
    Shift,
    Tab,
    Character(&'static str),
}
use Keycap::*;
struct Shortcut {
    id: &'static str,
    title: &'static str,
    detail: &'static str,
    chords: &'static [&'static [Keycap]],
}
const SHORTCUTS: &[Shortcut] = &[
    Shortcut {
        id: "quick-draft",
        title: "New draft from anywhere",
        detail: "Bring Draft forward with a blank draft, or hide it when it is already active.",
        chords: &[&[Option, Character(".")]],
    },
    Shortcut {
        id: "new-draft",
        title: "New draft",
        detail: "Reuse your most recent draft while it is still empty.",
        chords: &[&[Command, Character("N")]],
    },
    Shortcut {
        id: "new-version",
        title: "New version",
        detail: "Open a copy of the active version in a new tab.",
        chords: &[&[Command, Character("T")]],
    },
    Shortcut {
        id: "switch-drafts",
        title: "Switch drafts",
        detail: "1–8 select a draft in the sidebar. 9 selects the last one.",
        chords: &[&[Command, Character("1")], &[Command, Character("9")]],
    },
    Shortcut {
        id: "switch-tabs",
        title: "Switch tabs",
        detail: "Move forward or backward through versions, or Settings sections.",
        chords: &[&[Control, Tab], &[Control, Shift, Tab]],
    },
    Shortcut {
        id: "close-tab",
        title: "Close tab",
        detail: "Keep its writing. The last tab stays open. In Settings, return to drafts.",
        chords: &[&[Command, Character("W")]],
    },
    Shortcut {
        id: "close-window",
        title: "Close window",
        detail: "Keep Draft running for the quick-draft shortcut.",
        chords: &[&[Command, Shift, Character("W")]],
    },
    Shortcut {
        id: "sidebar",
        title: "Toggle sidebar",
        detail: "Show or hide your drafts.",
        chords: &[&[Command, Character("B")]],
    },
    Shortcut {
        id: "zoom",
        title: "Zoom",
        detail: "Make everything larger or smaller. 0 resets the size.",
        chords: &[
            &[Command, Character("+")],
            &[Command, Character("−")],
            &[Command, Character("0")],
        ],
    },
    Shortcut {
        id: "history",
        title: "Undo and redo",
        detail: "Each version keeps its own history.",
        chords: &[
            &[Command, Character("Z")],
            &[Command, Shift, Character("Z")],
            &[Command, Character("Y")],
        ],
    },
    Shortcut {
        id: "format",
        title: "Italic and underline",
        detail: "Format the selected text.",
        chords: &[&[Command, Character("I")], &[Command, Character("U")]],
    },
    Shortcut {
        id: "settings",
        title: "Settings",
        detail: "Open your preferences.",
        chords: &[&[Command, Character(",")]],
    },
    Shortcut {
        id: "save",
        title: "Save",
        detail: "Save now. Draft also saves as you type.",
        chords: &[&[Command, Character("S")]],
    },
];
impl Keycap {
    fn legend(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Command if cfg!(target_os = "macos") => ("⌘", "command", "Command"),
            Command | Control if !cfg!(target_os = "macos") => ("Ctrl", "", "Control"),
            Control => ("⌃", "control", "Control"),
            Option if cfg!(target_os = "macos") => ("⌥", "option", "Option"),
            Option => ("Alt", "", "Alt"),
            Shift if cfg!(target_os = "macos") => ("⇧", "shift", "Shift"),
            Shift => ("Shift", "", "Shift"),
            Tab if cfg!(target_os = "macos") => ("⇥", "tab", "Tab"),
            Tab => ("Tab", "", "Tab"),
            Character(value) => (value, "", value),
            Command => unreachable!(),
        }
    }
}
fn grey(value: u8) -> Color {
    let value = rune::color::srgb_decode(value as f32 / 255.0);
    Color {
        r: value,
        g: value,
        b: value,
        a: 1.0,
    }
}
fn keycap(key: Keycap, dark: bool, p: design::Palette) -> El {
    let (symbol, word, _) = key.legend();
    let width = if matches!(key, Character(_)) {
        36.0
    } else {
        52.0
    };
    let mut face = el()
        .size(width - 2.0, 35.0)
        .absolute(1.0, 0.5)
        .radius(5.5)
        .gradient(
            grey(if dark { 66 } else { 255 }),
            grey(if dark { 49 } else { 241 }),
        )
        .border_gradient(
            0.65,
            Color::WHITE.alpha(if dark { 0.22 } else { 1.0 }),
            Color::BLACK.alpha(if dark { 0.38 } else { 0.10 }),
        );
    if word.is_empty() {
        face = face.center().child(
            text(symbol)
                .font(TextStyle::new(
                    if symbol.chars().count() == 1 {
                        14.0
                    } else {
                        11.0
                    },
                    500.0,
                ))
                .color(p.text),
        );
    } else {
        face = face
            .child(
                text(symbol)
                    .absolute(width - 23.0, 3.0)
                    .font(TextStyle {
                        line_height: 19.0,
                        ..TextStyle::new(16.0, 400.0)
                    })
                    .color(p.text),
            )
            .child(
                text(word)
                    .absolute(5.0, 23.0)
                    .font(TextStyle {
                        line_height: 9.0,
                        ..TextStyle::new(7.5, 450.0)
                    })
                    .color(p.text.alpha(0.8)),
            );
    }
    el().size(width, 40.0)
        .radius(7.0)
        .fill(grey(if dark { 24 } else { 205 }))
        .border(0.75, Color::BLACK.alpha(if dark { 0.65 } else { 0.18 }))
        .shadow(2.0, 3.0, Color::BLACK.alpha(if dark { 0.24 } else { 0.12 }))
        .child(face)
        .a11y_hidden()
}
fn card(shortcut: &Shortcut, width: f32, dark: bool, p: design::Palette) -> El {
    let mut chords = row().w_full().gap(8.0).flex_wrap().center_y();
    for (i, keys) in shortcut.chords.iter().enumerate() {
        let label = keys
            .iter()
            .map(|key| key.legend().2)
            .collect::<Vec<_>>()
            .join(" + ");
        let chord = row()
            .key(format!("shortcut-{}-chord-{i}", shortcut.id))
            .role("group")
            .label(label)
            .gap(5.0)
            .children(keys.iter().map(|&key| keycap(key, dark, p)));
        let mut option = row().gap(8.0).center_y();
        if i > 0 {
            option = option.child(
                text(if shortcut.id == "switch-drafts" {
                    "–"
                } else {
                    "or"
                })
                .font(TextStyle::new(10.5, 400.0))
                .color(p.muted),
            );
        }
        chords = chords.child(option.child(chord));
    }
    col()
        .key(format!("shortcut-card-{}", shortcut.id))
        .w(width)
        .min_w(0.0)
        .min_h(184.0)
        .padding(18.0)
        .gap(8.0)
        .radius(16.0)
        .continuous_corners()
        .fill(p.menu.alpha(if dark { 0.5 } else { 0.66 }))
        .border_gradient(
            0.75,
            p.text.alpha(if dark { 0.10 } else { 0.08 }),
            p.text.alpha(0.045),
        )
        .child(
            text(shortcut.title)
                .w_full()
                .wrap()
                .font(TextStyle {
                    line_height: 20.0,
                    ..TextStyle::new(14.5, 550.0)
                })
                .color(p.text),
        )
        .child(
            text(shortcut.detail)
                .w_full()
                .wrap()
                .font(TextStyle {
                    line_height: 18.0,
                    ..TextStyle::new(12.5, 400.0)
                })
                .color(p.muted),
        )
        .child(el().grow(1.0).min_h(8.0))
        .child(chords)
}
pub fn grid(cx: &Cx<State>, fallback_width: f32, dark: bool, p: design::Palette) -> El {
    // Measure the container itself so scrollbar gutters and window zoom are included.
    let width = cx
        .layout_with("shortcut-grid", |rect| rect[2])
        .unwrap_or(fallback_width)
        .max(1.0);
    let gap = 16.0;
    let columns = (((width + gap) / (320.0 + gap)).floor() as usize).clamp(1, 3);
    let card_width = (width - gap * (columns - 1) as f32) / columns as f32;
    let mut grid = col().key("shortcut-grid").w_full().gap(gap);
    for (i, shortcuts) in SHORTCUTS.chunks(columns).enumerate() {
        grid = grid.child(
            row()
                .key(format!("shortcut-row-{i}"))
                .w_full()
                .gap(gap)
                .items_stretch()
                .children(
                    shortcuts
                        .iter()
                        .map(|shortcut| card(shortcut, card_width, dark, p)),
                ),
        );
    }
    grid
}
