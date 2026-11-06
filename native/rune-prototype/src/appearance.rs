//! Small, illustrated workspaces for the three appearance choices.
use super::*;

fn color(hex: &str) -> Color {
    rune::color::hex(hex).unwrap()
}
fn line(width: f32, ink: Color) -> El {
    el().size(width, 2.0).radius(1.0).fill(ink)
}
fn scene(width: f32, dark: bool) -> El {
    let p = design::Palette::new(dark);
    let sky = color(if dark { "#202837" } else { "#f0e9dc" });
    let glow = color(if dark { "#c2d4eb" } else { "#d6ae69" });
    let window = (width - 28.0).clamp(104.0, 224.0);
    let left = (width - window) * 0.5;
    let sidebar = window * 0.26;
    let mut art = el()
        .size(width, 164.0)
        .fill(sky)
        .gradient(sky, color(if dark { "#111722" } else { "#fcf9f1" }))
        .radial_gradient(
            [if dark { 0.82 } else { 0.18 }, 0.1],
            [120.0, 90.0],
            [(0.0, glow.alpha(0.18)), (1.0, Color::TRANSPARENT)],
        );
    let orb = el()
        .size(24.0, 24.0)
        .radius(12.0)
        .fill(glow)
        .shadow(0.0, 18.0, glow.alpha(0.24))
        .absolute(
            if dark {
                width * 0.82 - 12.0
            } else {
                width * 0.18 - 12.0
            },
            12.0,
        );
    art = art.child(if dark {
        orb.clip_rounded(12.0).child(
            el().size(22.0, 22.0)
                .radius(11.0)
                .fill(sky)
                .absolute(8.0, -4.0),
        )
    } else {
        orb
    });
    if dark {
        for (x, y, size) in [
            (0.15, 16.0, 1.5),
            (0.36, 26.0, 2.0),
            (0.62, 12.0, 1.5),
            (0.92, 48.0, 1.5),
        ] {
            art = art.child(
                el().size(size, size)
                    .radius(size / 2.0)
                    .fill(glow.alpha(0.65))
                    .absolute(width * x, y),
            );
        }
    }
    let miniature = el()
        .size(window, 110.0)
        .absolute(left, 42.0)
        .radius(8.0)
        .continuous_corners()
        .fill(p.background)
        .border_gradient(
            0.6,
            Color::WHITE.alpha(if dark { 0.18 } else { 0.9 }),
            Color::BLACK.alpha(0.12),
        )
        .shadow(6.0, 16.0, Color::BLACK.alpha(if dark { 0.3 } else { 0.14 }))
        .child(
            el().size(sidebar, 110.0)
                .absolute(0.0, 0.0)
                .fill(p.glass)
                .corners([8.0, 0.0, 0.0, 8.0]),
        )
        .child(el().size(1.0, 110.0).absolute(sidebar, 0.0).fill(p.line))
        .child(
            design::glass_surface(
                el().size(sidebar - 10.0, 24.0)
                    .radius(5.0)
                    .absolute(5.0, 25.0),
                dark,
            )
            .child(line((sidebar - 22.0).max(8.0), p.text.alpha(0.5)).absolute(5.0, 7.0))
            .child(line((sidebar - 29.0).max(6.0), p.muted.alpha(0.3)).absolute(5.0, 14.0)),
        )
        .child(line(sidebar - 18.0, p.muted.alpha(0.24)).absolute(9.0, 59.0))
        .child(line(sidebar - 23.0, p.muted.alpha(0.24)).absolute(9.0, 66.0))
        .child(
            design::glass_pill(&[85.0, 28.0], dark)
                .scale(0.4)
                .origin(0.0, 0.0)
                .absolute(sidebar + 6.0, 5.0),
        )
        .child(
            col()
                .absolute(sidebar + 14.0, 25.0)
                .gap(6.0)
                .child(text("Aa").font(TextStyle::new(24.0, 550.0)).color(p.text))
                .child(line(window - sidebar - 32.0, p.text.alpha(0.28)))
                .child(line(window - sidebar - 42.0, p.text.alpha(0.22)))
                .child(line(
                    (window - sidebar - 62.0).max(18.0),
                    p.text.alpha(0.22),
                )),
        );
    art.child(miniature).a11y_hidden()
}
fn preview(width: f32, mode: usize) -> El {
    let art = if mode == 0 {
        // Two clipped halves of one window, with the split on its center line.
        row()
            .size(width, 164.0)
            .child(
                el().size(width / 2.0, 164.0)
                    .clip_rounded(0.0)
                    .child(scene(width, false).absolute(0.0, 0.0)),
            )
            .child(
                el().size(width / 2.0, 164.0)
                    .clip_rounded(0.0)
                    .child(scene(width, true).absolute(-width / 2.0, 0.0)),
            )
            .child(
                el().size(1.0, 164.0)
                    .absolute(width / 2.0, 0.0)
                    .fill(Color::WHITE.alpha(0.2)),
            )
    } else {
        scene(width, mode == 2)
    };
    art.radius(12.0).clip_rounded(12.0).a11y_hidden()
}
fn choice(s: &State, width: f32, mode: usize, dark: bool, p: design::Palette) -> El {
    let (key, title, detail, selected) = match mode {
        1 => (
            "theme-light",
            "Light",
            "A bright place to begin.",
            !s.follow_theme && !s.dark,
        ),
        2 => (
            "theme-dark",
            "Dark",
            "A softer light for your thoughts.",
            !s.follow_theme && s.dark,
        ),
        _ => (
            "theme-system",
            "System",
            "In step with your device.",
            s.follow_theme,
        ),
    };
    let indicator = el()
        .size(17.0, 17.0)
        .radius(8.5)
        .border(1.0, if selected { p.text } else { p.muted.alpha(0.4) })
        .fill(if selected { p.text } else { Color::TRANSPARENT })
        .center();
    let indicator = if selected {
        indicator.child(
            text("✓")
                .font(TextStyle::new(10.5, 650.0))
                .color(p.background),
        )
    } else {
        indicator
    };
    let mut card = col()
        .key(key)
        .w(width)
        .min_w(0.0)
        .padding(10.0)
        .gap(12.0)
        .radius(21.0)
        .continuous_corners()
        .role("radio")
        .label(title)
        .focusable(true)
        .focus_selected(selected)
        .hover(p.glass)
        .child(preview((width - 20.0).max(1.0), mode))
        .child(
            col()
                .w_full()
                .px(5.0)
                .pb(5.0)
                .gap(5.0)
                .child(
                    row()
                        .w_full()
                        .center_y()
                        .child(
                            text(title)
                                .grow(1.0)
                                .font(TextStyle::new(14.0, 550.0))
                                .color(p.text),
                        )
                        .child(indicator),
                )
                .child(
                    text(detail)
                        .w_full()
                        .wrap()
                        .font(TextStyle {
                            line_height: 17.0,
                            ..TextStyle::new(12.0, 400.0)
                        })
                        .color(p.muted),
                ),
        )
        .on_press(move |s: &mut State| {
            s.follow_theme = mode == 0;
            if mode != 0 {
                s.dark = mode == 2;
            }
        });
    if selected {
        card = design::glass_surface(card, dark);
    } else {
        card = card.border(0.75, p.text.alpha(0.08));
    }
    card
}
pub fn choices(
    s: &State,
    cx: &Cx<State>,
    fallback_width: f32,
    dark: bool,
    p: design::Palette,
) -> El {
    let width = cx
        .layout_with("appearance-choices", |rect| rect[2])
        .unwrap_or(fallback_width)
        .max(1.0);
    let gap = 14.0;
    let columns = (((width + gap) / (190.0 + gap)).floor() as usize).clamp(1, 3);
    let card_width = (width - gap * (columns - 1) as f32) / columns as f32;
    let mut choices = col()
        .key("appearance-choices")
        .w_full()
        .gap(gap)
        .role("radiogroup")
        .label("Appearance")
        .focus_group();
    for modes in [1, 2, 0].chunks(columns) {
        let width = if modes.len() == 1 { width } else { card_width };
        choices = choices.child(
            row()
                .w_full()
                .gap(gap)
                .items_stretch()
                .children(modes.iter().map(|&mode| choice(s, width, mode, dark, p))),
        );
    }
    choices
}
