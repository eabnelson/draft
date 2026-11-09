//! Visual rules come from src/writing.css and src/glass.ts, not Rune's demo theme.
use super::*;
use rune::{Path, Shape};

#[derive(Clone, Copy)]
pub struct Palette {
    pub background: Color,
    pub text: Color,
    pub muted: Color,
    pub selected: Color,
    pub glass: Color,
    pub line: Color,
    pub menu: Color,
    /// Destructive menu actions, such as Delete.
    pub danger: Color,
}
fn rgb(r: u8, g: u8, b: u8) -> Color {
    Color {
        r: rune::color::srgb_decode(r as f32 / 255.0),
        g: rune::color::srgb_decode(g as f32 / 255.0),
        b: rune::color::srgb_decode(b as f32 / 255.0),
        a: 1.0,
    }
}
impl Palette {
    pub fn new(dark: bool) -> Self {
        if dark {
            Self {
                background: rgb(26, 26, 26),
                text: rgb(216, 216, 216),
                muted: rgb(145, 145, 145),
                selected: Color::WHITE.alpha(0.1),
                glass: Color::WHITE.alpha(0.05),
                line: Color::WHITE.alpha(0.045),
                menu: rgb(31, 31, 31),
                danger: rgb(240, 128, 128),
            }
        } else {
            Self {
                background: rgb(251, 251, 251),
                text: rgb(48, 48, 48),
                muted: rgb(115, 115, 115),
                selected: Color::BLACK.alpha(0.07),
                glass: Color::BLACK.alpha(0.035),
                line: Color::BLACK.alpha(0.045),
                menu: Color::WHITE,
                danger: rgb(196, 52, 52),
            }
        }
    }
    pub fn stage(self, dark: bool, stage: &str) -> Color {
        match (dark, stage) {
            (true, "Drafting") => rgb(157, 187, 234),
            (false, "Drafting") => rgb(59, 95, 153),
            (true, "Ready") => rgb(149, 204, 171),
            (false, "Ready") => rgb(62, 119, 83),
            (true, "Live") => rgb(194, 169, 225),
            (false, "Live") => rgb(127, 88, 163),
            (true, _) => rgb(168, 168, 168),
            _ => rgb(119, 119, 119),
        }
    }
}

struct GlassColors {
    tint: Color,
    top: Color,
    bottom: Color,
    sheen: Color,
    rim: Color,
    edge: Color,
}
impl GlassColors {
    fn new(dark: bool) -> Self {
        if dark {
            Self {
                tint: rgb(174, 194, 219).alpha(0.055),
                top: Color::WHITE.alpha(0.055),
                bottom: Color::WHITE.alpha(0.012),
                sheen: Color::WHITE.alpha(0.065),
                rim: Color::WHITE.alpha(0.28),
                edge: Color::WHITE.alpha(0.045),
            }
        } else {
            Self {
                tint: rgb(203, 213, 226).alpha(0.5),
                top: Color::WHITE.alpha(0.32),
                bottom: Color::WHITE.alpha(0.06),
                sheen: Color::WHITE.alpha(0.5),
                rim: Color::WHITE.alpha(0.95),
                edge: Color::BLACK.alpha(0.10),
            }
        }
    }
}

pub fn glass_surface(surface: El, dark: bool) -> El {
    let c = GlassColors::new(dark);
    surface
        .fill(c.tint)
        .gradient(c.top, c.bottom)
        .radial_gradient(
            [0.08, 0.0],
            [220.0, 140.0],
            [(0.0, c.sheen), (1.0, Color::TRANSPARENT)],
        )
        .border_gradient(0.75, c.rim, c.edge)
        .shadow(
            3.0,
            10.0,
            Color::BLACK.alpha(if dark { 0.18 } else { 0.09 }),
        )
}

pub fn sidebar_surface(surface: El, dark: bool, selected: bool) -> El {
    let surface = surface.w_full().radius(16.0).continuous_corners();
    if selected {
        glass_surface(surface, dark)
    } else {
        surface
    }
}

pub fn tab_surface(widths: &[f32], dark: bool) -> El {
    let width = widths.iter().sum::<f32>() + 5.25 * widths.len().saturating_sub(1) as f32;
    el().size(width, 28.0)
        .absolute(0.0, 0.0)
        .child(glass::frost(widths, dark))
        .child(glass_pill(widths, dark).absolute(0.0, 0.0))
}

pub fn prose(source: &str) -> String {
    let mut out = String::new();
    for event in Parser::new(source) {
        match event {
            Event::Text(t) | Event::Code(t) => out.push_str(&t),
            Event::SoftBreak | Event::HardBreak => out.push('\n'),
            Event::End(pulldown_cmark::TagEnd::Paragraph | pulldown_cmark::TagEnd::Heading(_)) => {
                out.push('\n')
            }
            _ => {}
        }
    }
    out
}
pub fn title(source: &str) -> String {
    prose(source)
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("Untitled")
        .trim()
        .chars()
        .take(200)
        .collect()
}
pub fn reading(source: &str) -> String {
    let seconds = prose(source).split_whitespace().count() as f32 / 238.0 * 60.0;
    if seconds < 59.5 {
        format!("{}s", seconds.round().max(1.0) as usize)
    } else {
        format!("{}m", (seconds / 60.0).round() as usize)
    }
}
pub fn characters(source: &str) -> usize {
    prose(source)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .count()
}

pub fn underlined(source: &str, color: Color) -> Vec<Span> {
    let mut out = Vec::new();
    let mut start = None;
    for (event, range) in Parser::new(source).into_offset_iter() {
        if let Event::InlineHtml(tag) = event {
            match tag.as_ref() {
                "<u>" => start = Some(range.end),
                "</u>" => {
                    if let Some(from) = start.take() {
                        out.push(Span::new(from, range.start).underline(color));
                    }
                }
                _ => {}
            }
        }
    }
    out
}
pub fn concealed(source: &str) -> Vec<Span> {
    let mut out = Vec::new();
    let mut hide = |from: usize, to: usize| {
        if from < to {
            out.push(Span::new(from, to).size(0.0).color(Color::TRANSPARENT));
        }
    };
    for (event, r) in Parser::new(source).into_offset_iter() {
        let raw = &source[r.clone()];
        match event {
            Event::Start(Tag::Heading { .. }) => {
                let n = raw
                    .bytes()
                    .take_while(|b| *b == b'#' || *b == b' ' || *b == b'\t')
                    .count();
                hide(r.start, r.start + n);
            }
            Event::Start(Tag::Strong) => {
                hide(r.start, r.start + 2);
                hide(r.end - 2, r.end);
            }
            Event::Start(Tag::Emphasis) => {
                hide(r.start, r.start + 1);
                hide(r.end - 1, r.end);
            }
            Event::Code(_) => {
                let n = raw.bytes().take_while(|b| *b == b'`').count();
                hide(r.start, r.start + n);
                hide(r.end - n, r.end);
            }
            Event::Start(Tag::Link { .. }) => {
                if let Some(close) = raw.find("](") {
                    hide(r.start, r.start + 1);
                    hide(r.start + close, r.end);
                }
            }
            Event::InlineHtml(t) if t.as_ref() == "<u>" || t.as_ref() == "</u>" => {
                hide(r.start, r.end)
            }
            // `\-` reads as `-`: the backslash only keeps the character from being formatting.
            Event::Text(t)
                if r.start > 0
                    && source.as_bytes()[r.start - 1] == b'\\'
                    && t.starts_with(|c: char| c.is_ascii_punctuation())
                    && raw.starts_with(|c: char| c.is_ascii_punctuation()) =>
            {
                hide(r.start - 1, r.start)
            }
            Event::HardBreak if raw.starts_with('\\') => hide(r.start, r.start + 1),
            _ => {}
        }
    }
    out
}

/// One continuous outline, including the scooped 5.25pt necks of Draft's tabs.
fn pill_paths(widths: &[f32]) -> (f32, Path, Path) {
    let (r, h, g, k) = (7.0, 28.0, 5.25, 0.5522848);
    let width = widths.iter().sum::<f32>() + g * (widths.len() - 1) as f32;
    let mut p = Path::new().move_to([r, 0.0]);
    let mut x = 0.0;
    let mut joins = Vec::new();
    for w in widths.iter().take(widths.len() - 1) {
        let a = x + w;
        let b = a + g;
        let q = g / 2.0;
        joins.push((a, b));
        p = p
            .line_to([a - r, 0.0])
            .cubic_to([a - r + r * k, 0.0], [a, r - r * k], [a, r])
            .cubic_to([a, r + q * k], [a + q - q * k, r + q], [a + q, r + q])
            .cubic_to([b - q + q * k, r + q], [b, r + q * k], [b, r])
            .cubic_to([b, r - r * k], [b + r - r * k, 0.0], [b + r, 0.0]);
        x = b;
    }
    p = p.line_to([width - r, 0.0]).cubic_to(
        [width - r + r * k, 0.0],
        [width, r - r * k],
        [width, r],
    );
    let top = p.clone().move_to([0.0, h - r]).line_to([0.0, r]).cubic_to(
        [0.0, r - r * k],
        [r - r * k, 0.0],
        [r, 0.0],
    );
    p = p.line_to([width, h - r]).cubic_to(
        [width, h - r + r * k],
        [width - r + r * k, h],
        [width - r, h],
    );
    for (a, b) in joins.into_iter().rev() {
        let q = g / 2.0;
        p = p
            .line_to([b + r, h])
            .cubic_to([b + r - r * k, h], [b, h - r + r * k], [b, h - r])
            .cubic_to(
                [b, h - r - q * k],
                [b - q + q * k, h - r - q],
                [b - q, h - r - q],
            )
            .cubic_to([a + q - q * k, h - r - q], [a, h - r - q * k], [a, h - r])
            .cubic_to([a, h - r + r * k], [a - r + r * k, h], [a - r, h]);
    }
    p = p
        .line_to([r, h])
        .cubic_to([r - r * k, h], [0.0, h - r + r * k], [0.0, h - r])
        .line_to([0.0, r])
        .cubic_to([0.0, r - r * k], [r - r * k, 0.0], [r, 0.0])
        .close();
    (width, p, top)
}

pub fn glass_pill(widths: &[f32], dark: bool) -> El {
    let (width, outline, top) = pill_paths(widths);
    let c = GlassColors::new(dark);
    let layer = |color| {
        el().size(width, 28.0)
            .shape(Shape::new().fill_path(&outline, color))
            .absolute(0.0, 0.0)
    };
    let faded_layer = |color, [left, top, right, bottom]: [f32; 4]| {
        el().size(width, 28.0)
            .absolute(0.0, 0.0)
            .clip_fade(left, top, right, bottom)
            .child(layer(color))
    };
    // Fade filled copies of the same contour: the sheen never fills the scoops
    // with a rectangle or leaves seams where a neck meets a lobe.
    el().size(width, 28.0)
        .child(
            layer(Color::BLACK.alpha(if dark { 0.18 } else { 0.09 }))
                .absolute(0.0, 2.0)
                .blur(2.0),
        )
        .child(layer(c.tint))
        .child(layer(c.bottom))
        .child(faded_layer(c.top, [0.0, 0.0, 0.0, 28.0]))
        .child(faded_layer(c.sheen, [0.0, 0.0, width, 28.0]))
        .child(
            el().size(width, 28.0).absolute(0.0, 0.0).shape(
                Shape::new()
                    .stroke_path(&outline, 0.65, rune::LineCap::Butt, c.edge)
                    .stroke_path(&top, 0.65, rune::LineCap::Butt, c.rim),
            ),
        )
}

pub fn fonts() -> &'static [&'static [u8]] {
    #[cfg(target_os = "macos")]
    {
        static FONTS: std::sync::OnceLock<Vec<&'static [u8]>> = std::sync::OnceLock::new();
        FONTS
            .get_or_init(|| {
                [
                    "/System/Library/Fonts/SFNS.ttf",
                    "/System/Library/Fonts/SFNSItalic.ttf",
                ]
                .iter()
                .filter_map(|path| {
                    std::fs::read(path)
                        .ok()
                        .map(|bytes| &*Box::leak(bytes.into_boxed_slice()))
                })
                .collect()
            })
            .as_slice()
    }
    #[cfg(not(target_os = "macos"))]
    {
        &[]
    }
}

// Lucide paths from the existing app. License: ../third-party/LUCIDE-LICENSE.
pub static CHEVRON_LEFT: rune::Icon = rune::Icon {
    name: "chevron-left",
    view: 24.0,
    body: r#"<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6"/>"#,
};
pub static SETTINGS: rune::Icon = rune::Icon {
    name: "settings",
    view: 24.0,
    body: r#"<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle fill="none" stroke="currentColor" stroke-width="2" cx="12" cy="12" r="3"/>"#,
};
pub static CLOUD: rune::Icon = rune::Icon {
    name: "cloud",
    view: 24.0,
    body: r#"<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>"#,
};
pub static LINK: rune::Icon = rune::Icon {
    name: "link",
    view: 24.0,
    body: r#"<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>"#,
};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn escapes_read_as_the_characters_they_protect() {
        let source = "a \\- b \\$5 c\\\\d `e \\-`\nline\\\nnext";
        let hidden: Vec<_> = concealed(source)
            .iter()
            .map(|span| {
                (
                    span.start as usize,
                    &source[span.start as usize..span.end as usize],
                )
            })
            .collect();
        let at = |s: &str| source.find(s).unwrap();
        assert_eq!(
            hidden,
            [
                (at("\\-"), "\\"),
                (at("\\$"), "\\"),
                (at("\\\\"), "\\"),
                (at("`"), "`"),
                (source.rfind('`').unwrap(), "`"),
                (at("\\\n"), "\\"),
            ],
            "escapes and the hard break's backslash hide; a backslash in code stays"
        );
    }
}
