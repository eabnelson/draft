//! Local dictionaries, checked away from the UI; stale results never decorate new text.
use super::*;
#[derive(Clone, Deserialize)]
pub struct Word {
    pub from: usize,
    pub to: usize,
    pub word: String,
}
enum Task {
    Check(String, String),
    Suggest(String),
}
pub enum Update {
    Checked(String, String, Vec<Word>),
    Suggestions(String, Vec<String>),
}
#[derive(Default)]
pub struct Spelling {
    jobs: Option<mpsc::Sender<Task>>,
    checked: HashMap<String, String>,
    pub words: HashMap<String, Vec<Word>>,
    pub suggestions: HashMap<String, Vec<String>>,
    due: Option<Instant>,
}
pub fn setup(s: &mut State, replies: mpsc::Sender<Reply>, waker: Waker) {
    let (jobs, receive) = mpsc::channel();
    s.spelling.jobs = Some(jobs);
    let host = s.host.clone();
    std::thread::spawn(move || {
        while let Ok(task) = receive.recv() {
            let update = match task {
                Task::Check(id, text) => {
                    let value: Value = host
                        .post("/spelling", &json!({"text":text}))
                        .unwrap_or_default();
                    let words = serde_json::from_value(value["words"].clone()).unwrap_or_default();
                    Update::Checked(id, text, words)
                }
                Task::Suggest(word) => {
                    let value: Value = host
                        .post("/spelling", &json!({"word":word}))
                        .unwrap_or_default();
                    Update::Suggestions(
                        word,
                        serde_json::from_value(value["suggestions"].clone()).unwrap_or_default(),
                    )
                }
            };
            if replies.send(Reply::Spelling(update)).is_err() {
                break;
            }
            waker();
        }
    });
}
fn byte(text: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (i, c) in text.char_indices() {
        if units >= utf16 {
            return i;
        }
        units += c.len_utf16();
    }
    text.len()
}
pub fn receive(s: &mut State, update: Update) {
    match update {
        Update::Checked(id, text, mut words) => {
            if s.docs
                .iter()
                .flat_map(|d| &d.versions)
                .any(|v| v.id == id && v.edit.text == text)
            {
                for word in &mut words {
                    word.from = byte(&text, word.from);
                    word.to = byte(&text, word.to);
                }
                s.spelling.words.insert(id, words);
            }
        }
        Update::Suggestions(word, suggestions) => {
            s.spelling.suggestions.insert(word, suggestions);
        }
    }
}
pub fn poll(s: &mut State, tx: &mut Tx) {
    if s.preferences {
        return;
    }
    let vi = s.active_version();
    let v = &s.docs[s.selected].versions[vi];
    if v.edit.preedit.is_some() || v.edit.text.len() > 200000 {
        return;
    }
    let id = v.id.clone();
    let source = v.edit.text.clone();
    if s.spelling.checked.get(&id) != Some(&source) {
        s.spelling.checked.insert(id.clone(), source.clone());
        s.spelling.due = Some(Instant::now() + Duration::from_secs(1));
        s.spelling.words.remove(&id);
    }
    if let Some(due) = s.spelling.due {
        if due <= Instant::now() {
            if let Some(jobs) = &s.spelling.jobs {
                let _ = jobs.send(Task::Check(id, source));
            }
            s.spelling.due = None;
        } else {
            tx.wake_after(due.saturating_duration_since(Instant::now()));
        }
    }
}
pub fn selected(s: &State) -> Option<Word> {
    let v = &s.docs[s.selected].versions[s.active_version()];
    let at = v.edit.focus;
    s.spelling
        .words
        .get(&v.id)?
        .iter()
        .find(|w| w.from <= at && at <= w.to)
        .cloned()
}
pub fn suggest(s: &State) {
    if let Some(word) = selected(s)
        && let Some(jobs) = &s.spelling.jobs
    {
        let _ = jobs.send(Task::Suggest(word.word));
    }
}
/// Corrections for the misspelled word under the caret, first in the text menu as on a Mac.
pub fn items(s: &State, p: design::Palette) -> Vec<El> {
    let Some(word) = selected(s) else {
        return Vec::new();
    };
    let Some(suggestions) = s.spelling.suggestions.get(&word.word) else {
        return Vec::new();
    };
    if suggestions.is_empty() {
        return vec![
            ui::entry("spelling-none", "No Guesses Found")
                .enabled(false)
                .build(p, |_, _| {}),
        ];
    }
    suggestions
        .iter()
        .take(5)
        .enumerate()
        .map(|(i, suggestion)| {
            let word = word.clone();
            let suggestion = suggestion.clone();
            ui::entry(&format!("spelling-{i}"), &suggestion).build(p, move |s, tx| {
                let di = s.selected;
                let vi = s.active_version();
                let edit = &mut s.docs[di].versions[vi].edit;
                if edit.text.get(word.from..word.to) == Some(word.word.as_str()) {
                    edit.anchor = word.from;
                    edit.focus = word.to;
                    edit.break_history_group();
                    edit.insert(&suggestion);
                    edit.break_history_group();
                    s.edited(di, vi, tx);
                }
                s.context = None;
            })
        })
        .collect()
}
pub fn spans(s: &State, vi: usize) -> Vec<Span> {
    let v = &s.docs[s.selected].versions[vi];
    s.spelling
        .words
        .get(&v.id)
        .into_iter()
        .flatten()
        .filter(|w| {
            !v.hidden
                .iter()
                .any(|h| h.start as usize <= w.from && w.to <= h.end as usize)
        })
        .map(|w| Span::new(w.from, w.to).underline(rune::color::hex("#c94a53").unwrap().alpha(0.7)))
        .collect()
}
