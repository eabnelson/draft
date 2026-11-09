//! Paragraph styles from the text menu: Markdown line prefixes on every selected line.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Style {
    Text,
    Heading(u8),
    Bullet,
    Numbered,
    Quote,
}
impl Style {
    fn prefix(self, n: usize) -> String {
        match self {
            Style::Text => String::new(),
            Style::Heading(level) => format!("{} ", "#".repeat(level as usize)),
            Style::Bullet => "- ".into(),
            Style::Numbered => format!("{n}. "),
            Style::Quote => "> ".into(),
        }
    }
}

/// The style a line already has, and the length of its prefix after any indentation.
fn parse(line: &str) -> (Style, usize) {
    let hashes = line.bytes().take_while(|b| *b == b'#').count();
    if (1..=6).contains(&hashes) && line[hashes..].starts_with(' ') {
        return (Style::Heading(hashes as u8), hashes + 1);
    }
    if line.starts_with("> ") {
        return (Style::Quote, 2);
    }
    if line.starts_with('>') {
        return (Style::Quote, 1);
    }
    if ["- ", "* ", "+ "].iter().any(|p| line.starts_with(p)) {
        return (Style::Bullet, 2);
    }
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    if (1..10).contains(&digits)
        && (line[digits..].starts_with(". ") || line[digits..].starts_with(") "))
    {
        return (Style::Numbered, digits + 2);
    }
    (Style::Text, 0)
}
fn split_indent(line: &str) -> (&str, &str) {
    let n = line.len() - line.trim_start_matches([' ', '\t']).len();
    line.split_at(n)
}
fn lines(edit: &TextEdit) -> (usize, usize) {
    let (from, to) = edit.range();
    let start = edit.text[..from].rfind('\n').map_or(0, |i| i + 1);
    // A selection that ends at the start of a line leaves that line alone.
    let to = if to > from && edit.text[..to].ends_with('\n') {
        to - 1
    } else {
        to
    };
    let end = edit.text[to..]
        .find('\n')
        .map_or(edit.text.len(), |i| to + i);
    (start, end.max(start))
}

/// The caret line's style, shown as the chosen paragraph style in the menu.
pub fn current(edit: &TextEdit) -> Style {
    let (start, _) = lines(edit);
    let line = edit.text[start..].split('\n').next().unwrap_or("");
    parse(split_indent(line).1).0
}

/// Give every selected line `style`. When they all have it already, return them to text.
pub fn apply(edit: &mut TextEdit, style: Style) {
    if edit.preedit.is_some() {
        return;
    }
    let (from, to) = edit.range();
    let (start, end) = lines(edit);
    let source: Vec<&str> = edit.text[start..end].split('\n').collect();
    let single = source.len() == 1;
    let styled = |line: &str| single || !line.trim().is_empty();
    let style = if style != Style::Text
        && source
            .iter()
            .filter(|line| styled(line))
            .all(|line| parse(split_indent(line).1).0 == style)
    {
        Style::Text
    } else {
        style
    };
    let mut n = 0;
    let mut caret = None;
    let mut out = String::new();
    for (i, line) in source.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let (indent, rest) = split_indent(line);
        let (_, old) = parse(rest);
        if !styled(line) {
            out.push_str(line);
            continue;
        }
        n += 1;
        // Headings start at the margin; lists and quotes keep their nesting.
        let indent = if matches!(style, Style::Heading(_)) {
            ""
        } else {
            indent
        };
        let prefix = style.prefix(n);
        if single && from == to {
            let into = (from - start).saturating_sub(line.len() - rest.len() + old);
            caret = Some(start + indent.len() + prefix.len() + into);
        }
        out.push_str(indent);
        out.push_str(&prefix);
        out.push_str(&rest[old..]);
    }
    if edit.text[start..end] == out {
        return;
    }
    edit.break_history_group();
    edit.undo_group(|e| {
        e.anchor = start;
        e.focus = end;
        e.insert(&out);
        match caret {
            Some(at) => {
                e.anchor = at;
                e.focus = at;
            }
            None if to > from => {
                e.anchor = start;
                e.focus = start + out.len();
            }
            None => {}
        }
    });
    edit.break_history_group();
}

/// Indentation one Tab adds: four spaces nest a list item under any bullet or number marker.
const INDENT: &str = "    ";

/// Tab in the editor, as a Markdown editor does it: list items and multi-line selections
/// indent; elsewhere Tab inserts spaces at the caret. Shift+Tab outdents. Tab never leaves the
/// editor for the sidebar.
pub fn tab(edit: &mut TextEdit, outdent: bool) {
    if edit.preedit.is_some() {
        return;
    }
    let (from, to) = edit.range();
    let (start, end) = lines(edit);
    let source: Vec<&str> = edit.text[start..end].split('\n').collect();
    let list = source.iter().any(|line| {
        matches!(
            parse(split_indent(line).1).0,
            Style::Bullet | Style::Numbered
        )
    });
    if !outdent && !list && source.len() == 1 {
        edit.break_history_group();
        edit.insert(INDENT);
        edit.break_history_group();
        return;
    }
    // Per line: where it starts in the original text, and the whitespace added or removed.
    let mut changes = Vec::new();
    let mut out = String::new();
    let mut at = start;
    for (i, line) in source.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let change = if outdent {
            let removed = if line.starts_with('\t') {
                1
            } else {
                line.bytes()
                    .take(INDENT.len())
                    .take_while(|b| *b == b' ')
                    .count()
            };
            out.push_str(&line[removed..]);
            -(removed as isize)
        } else if line.trim().is_empty() {
            out.push_str(line);
            0
        } else {
            out.push_str(INDENT);
            out.push_str(line);
            INDENT.len() as isize
        };
        changes.push((at, change));
        at += line.len() + 1;
    }
    if edit.text[start..end] == out {
        return;
    }
    // A selection that starts at a line's beginning keeps covering whole lines.
    let map = |pos: usize| -> usize {
        let mut shift = 0isize;
        for &(line, change) in &changes {
            if pos < line || (pos == line && pos == from && from < to && change > 0) {
                break;
            }
            shift += if change < 0 {
                -(((pos - line) as isize).min(-change))
            } else {
                change
            };
        }
        (pos as isize + shift) as usize
    };
    let (anchor, focus) = (map(edit.anchor), map(edit.focus));
    edit.break_history_group();
    edit.undo_group(|e| {
        e.anchor = start;
        e.focus = end;
        e.insert(&out);
        e.anchor = anchor;
        e.focus = focus;
    });
    edit.break_history_group();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(text: &str, anchor: usize, focus: usize, style: Style) -> TextEdit {
        let mut e = TextEdit::new(text);
        e.anchor = anchor;
        e.focus = focus;
        apply(&mut e, style);
        e
    }
    #[test]
    fn headings_replace_other_prefixes_and_toggle_off() {
        let e = run("- Hello", 4, 4, Style::Heading(2));
        assert_eq!(e.text, "## Hello");
        assert_eq!(e.focus, 5, "the caret stays in the same word");
        let e = run("## Hello", 3, 3, Style::Heading(2));
        assert_eq!(e.text, "Hello");
        let e = run("## Hello", 3, 3, Style::Heading(1));
        assert_eq!(e.text, "# Hello");
    }
    #[test]
    fn lists_number_selected_lines_and_skip_blanks() {
        let text = "One\n\nTwo\nThree\nAfter";
        let e = run(text, 0, "One\n\nTwo\nThree".len(), Style::Numbered);
        assert_eq!(e.text, "1. One\n\n2. Two\n3. Three\nAfter");
        let e = run(&e.text, 0, e.text.len() - "After".len(), Style::Numbered);
        assert_eq!(
            e.text, "One\n\nTwo\nThree\nAfter",
            "a trailing line break excludes the next line"
        );
        let e = run("  * nested", 0, 0, Style::Quote);
        assert_eq!(e.text, "  > nested");
    }
    #[test]
    fn an_empty_line_starts_a_list_and_text_clears_it() {
        let e = run("", 0, 0, Style::Bullet);
        assert_eq!((e.text.as_str(), e.focus), ("- ", 2));
        let e = run("> quoted", 8, 8, Style::Text);
        assert_eq!((e.text.as_str(), e.focus), ("quoted", 6));
        assert_eq!(current(&run("3) item", 0, 0, Style::Text)), Style::Text);
        assert_eq!(current(&TextEdit::new("12. item")), Style::Numbered);
    }
    #[test]
    fn tab_nests_list_items_and_shift_tab_returns_them() {
        let mut e = TextEdit::new("- one\n- two");
        e.anchor = 9;
        e.focus = 9;
        tab(&mut e, false);
        assert_eq!(e.text, "- one\n    - two");
        assert_eq!(e.focus, 13, "the caret moves with its text");
        tab(&mut e, true);
        assert_eq!((e.text.as_str(), e.focus), ("- one\n- two", 9));
        e.undo();
        assert_eq!(e.text, "- one\n    - two", "each Tab is one undo step");
    }
    #[test]
    fn tab_in_prose_inserts_spaces_and_selected_lines_indent() {
        let mut e = TextEdit::new("Hello");
        e.anchor = 0;
        e.focus = 0;
        tab(&mut e, false);
        assert_eq!((e.text.as_str(), e.focus), ("    Hello", 4));
        let mut e = TextEdit::new("a\n\nb");
        e.anchor = 0;
        e.focus = e.text.len();
        tab(&mut e, false);
        assert_eq!(e.text, "    a\n\n    b", "blank lines stay empty");
        assert_eq!(e.range(), (0, e.text.len()));
        tab(&mut e, true);
        assert_eq!(e.text, "a\n\nb");
        let mut e = TextEdit::new("  x");
        e.anchor = 3;
        e.focus = 3;
        tab(&mut e, true);
        assert_eq!((e.text.as_str(), e.focus), ("x", 1));
    }
}
