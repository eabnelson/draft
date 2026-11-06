//! Reconcile server changes only when a document is safe to replace. Saves keep
//! their original observed revision until a merged acknowledgement is accepted.
use super::*;

#[derive(Default)]
pub struct Remote {
    pending: HashMap<String, Value>,
}
pub fn setup(s: &State, replies: mpsc::Sender<Reply>, waker: Waker) {
    let host = s.host.clone();
    let mut since = s.docs.iter().map(|d| d.seen).max().unwrap_or(0);
    std::thread::spawn(move || {
        loop {
            if let Ok(value) = host.get::<Value>(&format!("/changes?since={since}")) {
                since = value["seq"].as_u64().unwrap_or(since);
                if value["changes"].as_array().is_some_and(|v| !v.is_empty()) {
                    if replies.send(Reply::Changes(value)).is_err() {
                        break;
                    }
                    waker();
                }
            }
            if let Ok(events) = host.get::<Value>("/desktop/events") {
                if replies.send(Reply::Desktop(events)).is_err() {
                    break;
                }
                waker();
            }
            std::thread::sleep(Duration::from_millis(1500));
        }
    });
}
pub fn received(s: &mut State, value: Value) {
    if let Some(archived) = value["archived"].as_u64() {
        s.archived = archived as usize;
    }
    if let Some(changes) = value["changes"].as_array() {
        for change in changes {
            if let Some(id) = change["id"].as_str() {
                s.remote.pending.insert(id.into(), change.clone());
            }
        }
    }
}
pub fn poll(s: &mut State) {
    let ready: Vec<_> = s
        .remote
        .pending
        .keys()
        .filter(|id| {
            s.docs
                .iter()
                .find(|d| d.id() == id.as_str())
                .is_none_or(|d| {
                    d.revision == d.saved
                        && d.queued.is_none()
                        && !d.pending_action
                        && d.versions.iter().all(|v| v.edit.preedit.is_none())
                })
        })
        .cloned()
        .collect();
    for id in ready {
        let change = s.remote.pending.remove(&id).unwrap();
        let seq = change["seq"].as_u64().unwrap_or(0);
        // A save may have merged this exact notification already.
        if s.docs
            .iter()
            .find(|d| d.id() == id)
            .is_some_and(|d| d.seen >= seq)
        {
            continue;
        }
        let mut drafts: Vec<_> = s
            .docs
            .iter()
            .filter(|d| d.id() != id)
            .map(Document::snapshot)
            .collect();
        if change["draft"].is_object() {
            drafts.push(change["draft"].clone());
        }
        if drafts.is_empty() {
            // /new recreates an empty inbox through the normal serialized queue.
            s.reload(true);
            continue;
        }
        install(s, drafts, seq);
        if let Some(d) = s.docs.iter_mut().find(|d| d.id() == id) {
            d.seen = seq;
        }
        s.notice = "Updated from sync".into();
    }
}
fn install(s: &mut State, drafts: Vec<Value>, seq: u64) {
    let active = s.docs[s.selected].id().into();
    // Preserve the observed revisions and unsaved state of unrelated documents.
    let revisions: HashMap<_, _> = s
        .docs
        .iter()
        .map(|d| {
            (
                d.id().to_owned(),
                (
                    d.revision,
                    d.saved,
                    d.queued,
                    d.seen,
                    d.pending_action,
                    d.pending_removal,
                ),
            )
        })
        .collect();
    s.install(Library {
        active,
        drafts,
        archived: s.archived,
        seq,
        histories: HashMap::new(),
    });
    for d in &mut s.docs {
        if let Some(&(revision, saved, queued, seen, action, removal)) = revisions.get(d.id()) {
            d.revision = revision;
            d.saved = saved;
            d.queued = queued;
            d.seen = seen;
            d.pending_action = action;
            d.pending_removal = removal;
        }
    }
}
pub fn saved(s: &mut State, id: &str, revision: u64, result: Result<Value, String>) {
    let Some(di) = s.docs.iter().position(|d| d.id() == id) else {
        return;
    };
    if s.docs[di].queued == Some(revision) {
        s.docs[di].queued = None;
    }
    match result {
        Ok(value) => {
            let seq = value["seq"].as_u64().unwrap_or(s.docs[di].seen);
            if value["draft"].is_object()
                && s.docs[di].revision == revision
                && s.docs[di].versions.iter().all(|v| v.edit.preedit.is_none())
            {
                let drafts = s
                    .docs
                    .iter()
                    .map(|d| {
                        if d.id() == id {
                            value["draft"].clone()
                        } else {
                            d.snapshot()
                        }
                    })
                    .collect();
                install(s, drafts, seq);
            }
            let d = s.docs.iter_mut().find(|d| d.id() == id).unwrap();
            d.saved = d.saved.max(revision.min(d.revision));
            if !value["draft"].is_object() || d.revision == revision {
                d.seen = seq;
            }
        }
        Err(error) => {
            s.notice = format!("Could not save: {error}");
            s.due = Some(Instant::now() + Duration::from_secs(5));
        }
    }
    if s.docs
        .iter()
        .all(|d| d.saved == d.revision && !d.pending_action)
    {
        s.notice = "All changes saved".into();
    }
}
