//! Blink only while a text field is active; wake at the next half-second edge.
use super::*;

#[derive(PartialEq)]
struct Position {
    key: String,
    anchor: usize,
    focus: usize,
    length: usize,
    generation: u64,
    composing: bool,
}
pub struct Blink {
    position: Option<Position>,
    since: f64,
    visible: bool,
}
impl Default for Blink {
    fn default() -> Self {
        Self {
            position: None,
            since: 0.0,
            visible: true,
        }
    }
}
impl Blink {
    pub fn restart(&mut self) {
        self.position = None;
        self.visible = true;
    }
    pub fn color(&self, text: Color) -> Color {
        text.alpha(if self.visible { 1.0 } else { 0.0 })
    }
}
pub fn poll(s: &mut State, now: f64, tx: &mut Tx) -> bool {
    let field = if !s.keyboard.focused {
        None
    } else if let Some(menu) = &s.item_menu {
        menu.rename_edit().map(|edit| ("item-name", edit))
    } else if s.preferences {
        (s.settings.section == 3 && s.settings.status.state == "choose-folder")
            .then_some(("sync-folder", &s.settings.folder))
    } else if s.context.is_none() {
        s.docs[s.selected]
            .versions
            .iter()
            .find(|v| v.edit.focused)
            .map(|v| (v.id.as_str(), &v.edit))
    } else {
        None
    };
    let position = field.filter(|(_, e)| e.focused).map(|(key, e)| Position {
        key: key.into(),
        anchor: e.anchor,
        focus: e.focus,
        length: e.text.len(),
        generation: s.generation,
        composing: e.preedit.is_some(),
    });
    let blink = position
        .as_ref()
        .is_some_and(|p| p.anchor == p.focus && !p.composing);
    let caret = &mut s.caret;
    if caret.position != position {
        caret.since = now;
        caret.position = position;
    }
    let phase = (now - caret.since).max(0.0) % 1.0;
    let visible = caret.position.is_some() && (!blink || phase < 0.5);
    if blink {
        tx.wake_after(Duration::from_secs_f64(0.5 - phase % 0.5));
    }
    let changed = caret.visible != visible;
    caret.visible = visible;
    changed
}
