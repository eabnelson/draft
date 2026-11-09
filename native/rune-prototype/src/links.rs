use super::*;
#[derive(Clone)]
struct Link {
    range: std::ops::Range<usize>,
    label: String,
    url: String,
}
fn at(edit: &TextEdit) -> Option<Link> {
    Parser::new(&edit.text)
        .into_offset_iter()
        .find_map(|(event, range)| match event {
            Event::Start(Tag::Link { dest_url, .. })
                if range.start <= edit.focus && edit.focus <= range.end =>
            {
                let source = &edit.text[range.clone()];
                let label = label(source);
                Some(Link {
                    range,
                    label: label.into(),
                    url: dest_url.into_string(),
                })
            }
            _ => None,
        })
}
pub(super) fn label(source: &str) -> &str {
    if source.starts_with('[') {
        let mut depth = 0;
        let mut escaped = false;
        for (at, c) in source.char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if c == '\\' {
                escaped = true;
                continue;
            }
            if c == '[' {
                depth += 1;
            } else if c == ']' {
                depth -= 1;
                if depth == 0 {
                    return &source[1..at];
                }
            }
        }
    }
    source
        .strip_prefix('<')
        .and_then(|s| s.strip_suffix('>'))
        .unwrap_or(source)
}
pub struct Editing {
    pub url: TextEdit,
    version: String,
    range: std::ops::Range<usize>,
    before: String,
    label: String,
}
pub fn open(s: &mut State) {
    let vi = s.active_version();
    let v = &s.docs[s.selected].versions[vi];
    let edit = &v.edit;
    let link = at(edit);
    let range = link
        .as_ref()
        .map(|l| l.range.clone())
        .unwrap_or(edit.anchor.min(edit.focus)..edit.anchor.max(edit.focus));
    let label = link
        .as_ref()
        .map(|l| l.label.clone())
        .unwrap_or_else(|| edit.text[range.clone()].into());
    let mut url = TextEdit::new(link.map_or("https://".into(), |l| l.url));
    url.focused = true;
    url.anchor = 0;
    url.focus = url.text.len();
    s.link = Some(Editing {
        url,
        version: v.id.clone(),
        before: edit.text[range.clone()].into(),
        range,
        label,
    });
}
fn apply(s: &mut State, unlink: bool, tx: &mut Tx) {
    let Some(dialog) = s.link.take() else { return };
    let url = dialog.url.text.trim();
    if !unlink
        && (!["https://", "http://", "mailto:"].iter().any(|p| {
            url.strip_prefix(p)
                .is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'))
        }) || url.contains(['\n', '\r', '<', '>']))
    {
        s.notice = "Choose a web address or email link.".into();
        s.link = Some(dialog);
        return;
    }
    let Some(vi) = s.docs[s.selected]
        .versions
        .iter()
        .position(|v| v.id == dialog.version)
    else {
        return;
    };
    let edit = &mut s.docs[s.selected].versions[vi].edit;
    if edit.text.get(dialog.range.clone()) != Some(dialog.before.as_str()) {
        s.notice = "The linked text changed. Select it again.".into();
        return;
    }
    edit.anchor = dialog.range.start;
    edit.focus = dialog.range.end;
    edit.break_history_group();
    edit.insert(&if unlink {
        dialog.label
    } else {
        format!(
            "[{}](<{url}>)",
            if dialog.label.is_empty() {
                url
            } else {
                &dialog.label
            }
        )
    });
    edit.break_history_group();
    s.edited(s.selected, vi, tx);
    s.context = None;
}
/// The link editor that takes the text menu's place after choosing the link button.
pub fn dialog(s: &State, p: design::Palette) -> El {
    let dialog = s.link.as_ref().unwrap();
    col()
        .key("editor-menu")
        .w(238.0)
        .padding(6.0)
        .radius(16.0)
        .continuous_corners()
        .gap(8.0)
        .child(settings::copy("Link address", p))
        .child(
            text_input(&dialog.url, TextStyle::new(13.0, 400.0))
                .key("link-address")
                .role("textbox")
                .label("Link address")
                .single_line()
                .w_full()
                .h(36.0)
                .padding(8.0)
                .radius(8.0)
                .fill(p.glass)
                .color(p.text)
                .on_edit(|s: &mut State| &mut s.link.as_mut().unwrap().url),
        )
        .child(ui::entry("link-save", "Save link").build(p, |s, tx| apply(s, false, tx)))
        .child(ui::entry("link-remove", "Remove link").build(p, |s, tx| apply(s, true, tx)))
}
/// With the caret on a link: open it, or copy its address.
pub fn items(s: &State, p: design::Palette) -> Vec<El> {
    let Some(link) = at(&s.docs[s.selected].versions[s.active_version()].edit) else {
        return Vec::new();
    };
    let url = link.url.clone();
    vec![
        ui::entry("link-open", "Open Link").build(p, move |s, _| {
            services::request(s, "/links/open", Some(json!({"url":url})));
            s.context = None;
        }),
        ui::entry("link-copy", "Copy Link Address").build(p, move |s, tx| {
            tx.copy(link.url.clone());
            s.context = None;
        }),
    ]
}
