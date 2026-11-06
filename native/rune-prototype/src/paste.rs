//! Convert native rich clipboard data into the Markdown stored by Draft.
use super::*;
use rune::{Block, Mark};

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
pub fn markdown(html: &str) -> String {
    let edit = TextEdit::from_html(html);
    let mut result = String::new();
    let mut start = 0;
    for (line, content) in edit.text.split('\n').enumerate() {
        if line > 0 {
            result.push('\n');
        }
        match edit.blocks().get(line).copied().unwrap_or_default() {
            Block::Bullet(level) => result.push_str(&format!("{}- ", "  ".repeat(level as usize))),
            Block::Numbered(level) => {
                result.push_str(&format!("{}1. ", "  ".repeat(level as usize)))
            }
            Block::Quote => result.push_str("> "),
            Block::Code => {
                result.push_str("    ");
                result.push_str(content);
                start += content.len() + 1;
                continue;
            }
            _ => {}
        }
        let mut opened: Vec<(usize, (String, String))> = Vec::new();
        for (byte, c) in content.char_indices() {
            let at = start + byte;
            let mut active: Vec<_> = edit
                .marks()
                .iter()
                .enumerate()
                .filter(|(_, m)| m.start <= at && at < m.end)
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
                result.push_str(&mark.1.0);
                opened.push(mark);
            }
            let code = opened.iter().any(|(_, p)| p.0.starts_with('`'));
            if !code && "\\*_[]`<>#+-.!|{}()".contains(c) {
                result.push('\\');
            }
            result.push(c);
        }
        for (_, (_, close)) in opened.into_iter().rev() {
            result.push_str(&close);
        }
        start += content.len() + 1;
    }
    result
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
}
