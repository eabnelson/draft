//! Persist Markdown undo groups as compact, validated UTF-8 replacements.
use super::*;

#[derive(Serialize, Deserialize)]
struct Change {
    at: usize,
    removed: String,
    inserted: String,
    before: [usize; 2],
    after: [usize; 2],
}
#[derive(Serialize, Deserialize)]
struct History {
    format: String,
    checksum: String,
    selection: [usize; 2],
    undo: Vec<Change>,
    redo: Vec<Change>,
}
fn change(before: &TextEdit, after: &TextEdit) -> Change {
    let (a, b) = (&before.text, &after.text);
    let mut start = a.bytes().zip(b.bytes()).take_while(|(a, b)| a == b).count();
    while !a.is_char_boundary(start) || !b.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = a[start..]
        .bytes()
        .rev()
        .zip(b[start..].bytes().rev())
        .take_while(|(a, b)| a == b)
        .count();
    while !a.is_char_boundary(a.len() - end) || !b.is_char_boundary(b.len() - end) {
        end -= 1;
    }
    Change {
        at: start,
        removed: a[start..a.len() - end].into(),
        inserted: b[start..b.len() - end].into(),
        before: [before.anchor, before.focus],
        after: [after.anchor, after.focus],
    }
}
fn stack(edit: &TextEdit, undo: bool) -> Vec<Change> {
    let mut cursor = edit.clone();
    cursor.preedit = None;
    let mut steps = Vec::new();
    for _ in 0..128 {
        let before = cursor.clone();
        if undo {
            cursor.undo();
        } else {
            cursor.redo();
        }
        if before.text == cursor.text {
            break;
        }
        steps.push(if undo {
            change(&cursor, &before)
        } else {
            change(&before, &cursor)
        });
    }
    steps
}
pub fn capture(edit: &TextEdit) -> Value {
    serde_json::to_value(History {
        format: "draft-rune-undo-v1".into(),
        checksum: blake3::hash(edit.text.as_bytes()).to_hex().to_string(),
        selection: [edit.anchor, edit.focus],
        undo: stack(edit, true),
        redo: stack(edit, false),
    })
    .unwrap()
}
fn replace(text: &mut String, at: usize, expected: &str, replacement: &str) -> Option<()> {
    let end = at.checked_add(expected.len())?;
    if text.get(at..end)? != expected {
        return None;
    }
    text.replace_range(at..end, replacement);
    Some(())
}
pub fn select(edit: &mut TextEdit, selection: [usize; 2]) {
    let fit = |mut index: usize| {
        index = index.min(edit.text.len());
        while !edit.text.is_char_boundary(index) {
            index -= 1;
        }
        index
    };
    edit.anchor = fit(selection[0]);
    edit.focus = fit(selection[1]);
}
fn restore(text: &str, value: &Value) -> Option<TextEdit> {
    let saved: History = serde_json::from_value(value.clone()).ok()?;
    if saved.format != "draft-rune-undo-v1"
        || saved.checksum != blake3::hash(text.as_bytes()).to_hex().as_str()
        || saved.undo.len() > 128
        || saved.redo.len() > 128
    {
        return None;
    }
    let mut oldest = text.to_owned();
    for step in &saved.undo {
        replace(&mut oldest, step.at, &step.inserted, &step.removed)?;
    }
    let mut edit = TextEdit::new(oldest);
    let replay = |edit: &mut TextEdit, step: &Change| -> Option<()> {
        let end = step.at.checked_add(step.removed.len())?;
        if edit.text.get(step.at..end)? != step.removed {
            return None;
        }
        select(edit, step.before);
        edit.break_history_group();
        edit.undo_group(|edit| {
            edit.anchor = step.at;
            edit.focus = end;
            edit.insert(&step.inserted);
            select(edit, step.after);
        });
        Some(())
    };
    for step in saved.undo.iter().rev() {
        replay(&mut edit, step)?;
    }
    if edit.text != text {
        return None;
    }
    for step in &saved.redo {
        replay(&mut edit, step)?;
    }
    for _ in &saved.redo {
        edit.undo();
    }
    if edit.text != text {
        return None;
    }
    select(&mut edit, saved.selection);
    Some(edit)
}
pub fn load(text: &str, value: Option<&Value>) -> TextEdit {
    value
        .and_then(|v| restore(text, v))
        .unwrap_or_else(|| TextEdit::new(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_survives_restart_with_unicode_redo_and_selection() {
        let mut edit = TextEdit::new("A café 👩🏽‍💻");
        edit.anchor = edit.text.len();
        edit.focus = edit.anchor;
        edit.insert(" 日本語");
        edit.break_history_group();
        let first = edit.text.clone();
        edit.insert(" again");
        edit.undo();
        let mut restored = load(&edit.text, Some(&capture(&edit)));
        assert_eq!(restored.text, first);
        restored.redo();
        assert_eq!(restored.text, format!("{first} again"));
        restored.undo();
        restored.undo();
        assert_eq!(restored.text, "A café 👩🏽‍💻");
        restored.redo();
        assert_eq!(restored.text, first);
    }
    #[test]
    fn stale_or_malformed_history_cannot_replace_writing() {
        let mut edit = TextEdit::new("before");
        edit.insert("changed");
        let saved = capture(&edit);
        let mut fresh = load("external change", Some(&saved));
        fresh.undo();
        assert_eq!(fresh.text, "external change");
        let mut bad = saved;
        bad["undo"][0]["at"] = json!(usize::MAX);
        let mut fresh = load(&edit.text, Some(&bad));
        fresh.undo();
        assert_eq!(fresh.text, edit.text);
    }
}
