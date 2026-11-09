//! Turn what's on the clipboard into the Markdown stored by Draft: Markdown text stays as written,
//! and formatted text from documents and web pages becomes the Markdown a writer would type.
use super::*;
use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag};
use rune::{Block, Mark};

/// The Markdown to insert for a paste, or `None` to paste its plain text as is. Plain text wins
/// when it's already Markdown (copied from a `.md` file, a code editor or Draft itself) or when
/// the HTML beside it carries no formatting, so syntax is never escaped into backslashes.
pub fn from_clipboard(text: &str, html: Option<&str>) -> Option<String> {
    let html = html?;
    if !text.trim().is_empty() && is_markdown(text) {
        return None;
    }
    let (markdown, formatted) = convert(html);
    (formatted || text.trim().is_empty()).then_some(markdown)
}

/// Whether plain text uses Markdown syntax that formatted text's plain form never contains.
/// Lists alone don't count: many apps write list items as `1. ` or `- ` in plain text.
fn is_markdown(text: &str) -> bool {
    Parser::new(text)
        .into_offset_iter()
        .any(|(event, range)| match event {
            Event::Start(Tag::Heading { .. }) => text[range].starts_with('#'),
            Event::Start(
                Tag::Strong
                | Tag::Emphasis
                | Tag::BlockQuote(_)
                | Tag::Link { .. }
                | Tag::Image { .. }
                | Tag::CodeBlock(CodeBlockKind::Fenced(_)),
            )
            | Event::Code(_) => true,
            Event::Text(_) => range.start > 0 && text.as_bytes()[range.start - 1] == b'\\',
            _ => false,
        })
}

/// HTML headings, which the rich text model has no block for, ride through it as a private-use
/// character at the start of their line.
const HEADING: u32 = 0xE000;
fn mark_headings(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let bytes = rest.as_bytes();
        let close = bytes.get(1) == Some(&b'/');
        let at = 1 + close as usize;
        let level = bytes.get(at + 1).map_or(0, |b| b.wrapping_sub(b'0'));
        let heading = matches!(bytes.get(at), Some(b'h' | b'H'))
            && (1..=6).contains(&level)
            && matches!(
                bytes.get(at + 2),
                Some(b'>' | b' ' | b'\t' | b'\n' | b'\r' | b'/')
            );
        match (heading, rest.find('>')) {
            (true, Some(end)) => {
                if close {
                    out.push_str("</p>");
                } else {
                    out.push_str("<p>");
                    out.extend(char::from_u32(HEADING + level as u32));
                }
                rest = &rest[end + 1..];
            }
            _ => {
                out.push('<');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}
fn heading_level(line: &str) -> Option<usize> {
    let c = line.chars().next()? as u32;
    (HEADING + 1..=HEADING + 6)
        .contains(&c)
        .then(|| (c - HEADING) as usize)
}

fn markers(mark: &Mark, content: &str) -> Option<(String, String)> {
    Some(match mark {
        Mark::Bold => ("**".into(), "**".into()),
        Mark::Italic => ("_".into(), "_".into()),
        Mark::Underline => ("<u>".into(), "</u>".into()),
        Mark::Strike => ("~~".into(), "~~".into()),
        Mark::Code => {
            let ticks =
                "`".repeat(content.split(|c| c != '`').map(str::len).max().unwrap_or(0) + 1);
            if content.trim().is_empty() {
                (ticks.clone(), ticks)
            } else {
                (format!("{ticks} "), format!(" {ticks}"))
            }
        }
        Mark::Link(url)
            if ["https://", "http://", "mailto:"]
                .iter()
                .any(|prefix| url.starts_with(prefix)) =>
        {
            (
                "[".into(),
                format!("](<{}>)", url.replace(['<', '>', '\n', '\r'], "")),
            )
        }
        _ => return None,
    })
}

/// Whether `c`, at byte `i` of a line's text, would read as Markdown syntax and needs a
/// backslash. Only characters that would actually change the formatting are escaped.
fn needs_escape(line: &str, i: usize, c: char) -> bool {
    let before = line[..i].chars().next_back();
    let after = line[i + c.len_utf8()..].chars().next();
    let word = |c: Option<char>| c.is_some_and(char::is_alphanumeric);
    match c {
        '\\' | '*' | '`' | '[' | ']' => true,
        // `<b>` or `<https://…>` would read as HTML or a link; `a < b` is just text.
        '<' => after.is_some_and(|c| c.is_ascii_alphabetic() || "/!?".contains(c)),
        // snake_case and similar stay readable; only an underscore that could open or close
        // emphasis is escaped.
        '_' => !(word(before) && word(after)),
        _ if i == 0 => match c {
            '#' => {
                line.trim_start_matches('#').starts_with([' ', '\t'])
                    || line.trim_end_matches('#').is_empty()
            }
            '>' => true,
            '-' | '+' => {
                matches!(after, None | Some(' ' | '\t')) || line.trim_end().chars().all(|x| x == c)
            }
            // A line of `===` or `---` would turn the line above it into a heading.
            '=' => line.trim_end().chars().all(|x| x == c),
            _ => false,
        },
        // `12. ` at the start of a line would start a numbered list.
        '.' | ')' => {
            line[..i].bytes().all(|b| b.is_ascii_digit())
                && matches!(after, None | Some(' ' | '\t'))
        }
        _ => false,
    }
}

/// Nesting one list level deeper, the same four spaces Tab adds.
const LEVEL: &str = "    ";

/// Formatted HTML as Markdown.
#[cfg(test)]
fn markdown(html: &str) -> String {
    convert(html).0
}
/// Formatted HTML as Markdown, and whether it had any formatting to keep.
fn convert(html: &str) -> (String, bool) {
    let edit = TextEdit::from_html(&mark_headings(html));
    let blocks = edit.blocks();
    let soft = edit.soft_breaks();
    let mut formatted = false;
    let mut result = String::new();
    let mut start = 0;
    // The next number at each list level; a line that isn't a deeper list item ends the count.
    let mut numbers: Vec<usize> = Vec::new();
    let mut prefix_width = 0;
    let mut fence = String::new();
    let lines: Vec<&str> = edit.text.split('\n').collect();
    for (line, content) in lines.iter().enumerate() {
        let block = blocks.get(line).copied().unwrap_or_default();
        let continued = line > 0 && soft.binary_search(&(line as u32)).is_ok();
        if line > 0 {
            result.push('\n');
        }
        if block == Block::Code {
            formatted = true;
            if fence.is_empty() {
                fence = "`".repeat(
                    lines[line..]
                        .iter()
                        .flat_map(|l| l.split(|c| c != '`'))
                        .map(str::len)
                        .max()
                        .unwrap_or(0)
                        .max(2)
                        + 1,
                );
                result.push_str(&fence);
                result.push('\n');
            }
            result.push_str(content);
            start += content.len() + 1;
            if blocks.get(line + 1) != Some(&Block::Code) {
                result.push('\n');
                result.push_str(&std::mem::take(&mut fence));
            }
            continue;
        }
        let heading = heading_level(content);
        let skip = heading.map_or(0, |_| content.chars().next().unwrap().len_utf8());
        let text = &content[skip..];
        let level = match block {
            Block::Bullet(level) | Block::Numbered(level) => Some(level as usize),
            _ => None,
        };
        if !continued {
            numbers.truncate(level.map_or(0, |l| l + 1));
            if let Some(l) = level {
                numbers.resize(l + 1, 1);
                if !matches!(block, Block::Numbered(_)) {
                    numbers[l] = 1;
                }
            }
        }
        let prefix = if continued {
            " ".repeat(prefix_width)
        } else if let Some(level) = heading {
            formatted = true;
            format!("{} ", "#".repeat(level))
        } else {
            match block {
                Block::Bullet(l) => format!("{}- ", LEVEL.repeat(l as usize)),
                Block::Numbered(l) => {
                    let n = numbers[l as usize];
                    numbers[l as usize] += 1;
                    format!("{}{n}. ", LEVEL.repeat(l as usize))
                }
                Block::Quote => "> ".into(),
                _ => String::new(),
            }
        };
        if !prefix.trim().is_empty() {
            formatted = true;
        }
        if !continued {
            prefix_width = match block {
                Block::Quote => 0,
                _ => prefix.len(),
            };
        }
        if continued && block == Block::Quote {
            result.push_str("> ");
        } else {
            result.push_str(&prefix);
        }
        let mut opened: Vec<(usize, (String, String))> = Vec::new();
        for (byte, c) in text.char_indices() {
            let at = start + skip + byte;
            let mut active: Vec<_> = edit
                .marks()
                .iter()
                .enumerate()
                .filter(|(_, m)| m.start <= at && at < m.end)
                // A heading is already bold; `# **Title**` would only add noise.
                .filter(|(_, m)| heading.is_none() || m.mark != Mark::Bold)
                .filter_map(|(i, m)| markers(&m.mark, &edit.text[m.start..m.end]).map(|p| (i, p)))
                .collect();
            active.sort_by_key(|(i, _)| {
                let m = &edit.marks()[*i];
                (m.start, std::cmp::Reverse(m.end), *i)
            });
            let common = opened
                .iter()
                .zip(&active)
                .take_while(|(a, b)| a.0 == b.0)
                .count();
            for (_, (_, close)) in opened.drain(common..).rev() {
                result.push_str(&close);
            }
            for mark in active.into_iter().skip(common) {
                formatted = true;
                result.push_str(&mark.1.0);
                opened.push(mark);
            }
            let code = opened.iter().any(|(_, p)| p.0.starts_with('`'));
            if !code && needs_escape(text, byte, c) {
                result.push('\\');
            }
            result.push(c);
        }
        for (_, (_, close)) in opened.into_iter().rev() {
            result.push_str(&close);
        }
        start += content.len() + 1;
    }
    (result, formatted)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rich_paste_is_durable_markdown() {
        let source = markdown(
            "<p><b>Bold</b> <i>café</i> <a href=\"https://example.com\">link</a></p><ul><li>One</li><li>Two</li></ul>",
        );
        assert!(source.contains("**Bold**"));
        assert!(source.contains("_café_"));
        assert!(source.contains("[link](<https://example.com>)"));
        assert!(source.contains("- One"));
        assert!(!markdown("<a href=\"javascript:alert(1)\">unsafe</a>").contains("javascript:"));
    }
    #[test]
    fn google_docs_keeps_headings_numbers_and_ordinary_punctuation() {
        let html = r#"<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h1 dir="ltr"><span style="font-weight:400">Savor as a business</span></h1><p dir="ltr"><span style="font-weight:700">Finance</span><span> $5/mo (1 month free) - email_sign_in, 3.5 stars.</span></p><ol><li aria-level="1"><p><span>Grow</span></p></li><li aria-level="1"><p><span>Retain</span></p></li><ol><li aria-level="2"><p><span>Cook together</span></p></li><li aria-level="2"><p><span>Again</span></p></li></ol><li aria-level="1"><p><span>Market</span></p></li></ol><ul><li><p><span>Ads</span></p></li></ul></b>"#;
        assert_eq!(
            markdown(html),
            "# Savor as a business\n\
             **Finance** $5/mo (1 month free) - email_sign_in, 3.5 stars.\n\
             1. Grow\n\
             2. Retain\n    1. Cook together\n    2. Again\n\
             3. Market\n\
             - Ads"
        );
    }
    #[test]
    fn only_text_that_would_become_formatting_is_escaped() {
        assert_eq!(
            markdown(
                "<p># not a heading</p><p>- not a list</p><p>1. not a list</p><p>2*3 [x] _a_</p>"
            ),
            "\\# not a heading\n\\- not a list\n1\\. not a list\n2\\*3 \\[x\\] \\_a\\_"
        );
        assert_eq!(
            markdown("<pre>let x = 1;\nlet y = 2;</pre>"),
            "```\nlet x = 1;\nlet y = 2;\n```"
        );
    }
    #[test]
    fn markdown_text_pastes_as_written() {
        let text = "**Marketing**  \n- instagram @savor.cooking\n- youtube \\- keep updated";
        // A code editor or Draft itself puts its own HTML beside the text.
        let html = "<div><span>**Marketing**</span></div><div><span>- instagram</span></div>";
        assert_eq!(from_clipboard(text, Some(html)), None);
        assert_eq!(from_clipboard("# Plan", Some("<p># Plan</p>")), None);
        // HTML without formatting adds nothing to its plain text.
        assert_eq!(
            from_clipboard("Hello (world).", Some("<p>Hello (world).</p>")),
            None
        );
        // A document's formatting still comes through.
        assert_eq!(
            from_clipboard("Bold text", Some("<p><b>Bold</b> text</p>")).as_deref(),
            Some("**Bold** text")
        );
        assert_eq!(from_clipboard("x", None), None);
    }
}
