//! Model and feature requests use a separate worker from writing and saving.
use super::*;

#[derive(Default)]
pub struct Services {
    jobs: Option<mpsc::Sender<(String, Option<Value>)>>,
    pub providers: Value,
    pub desktop: Value,
    pub features: Value,
    pub prompt: TextEdit,
    pub message: String,
    pub busy: bool,
    next_refresh: Option<Instant>,
    confirmed: bool,
}
pub struct Update(String, Result<Value, String>);
pub fn setup(s: &mut State, replies: mpsc::Sender<Reply>, waker: Waker) {
    let (jobs, receive) = mpsc::channel::<(String, Option<Value>)>();
    let _ = jobs.send(("/desktop/preferences".into(), None));
    s.services.busy = true;
    s.services.jobs = Some(jobs);
    let mut host = s.host.clone();
    host.agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(190)))
        .build()
        .into();
    std::thread::spawn(move || {
        while let Ok((path, body)) = receive.recv() {
            let result = if let Some(body) = body {
                host.post(&path, &body)
            } else {
                host.get(&path)
            };
            if replies.send(Reply::Services(Update(path, result))).is_err() {
                break;
            }
            waker();
        }
    });
}
pub fn request(s: &mut State, path: &str, body: Option<Value>) {
    if s.services.busy {
        return;
    }
    if let Some(jobs) = &s.services.jobs {
        s.services.busy = jobs.send((path.into(), body)).is_ok();
        s.services.message = "Working…".into();
    }
}
pub fn receive(s: &mut State, update: Update, tx: &mut Tx) {
    s.services.busy = false;
    match update.1 {
        Ok(value) => {
            if update.0 == "/desktop/preferences" {
                desktop::preferences(s, value);
            } else if update.0 == "/api/health" {
                request(
                    s,
                    "/api/updates/confirm",
                    Some(json!({"version":value["version"]})),
                );
            } else if update.0.starts_with("/api/providers") {
                s.services.providers = value;
            } else if update.0 == "/api/features" {
                s.services.features = value;
            } else if update.0 == "/api/updates/apply" {
                keyboard::quit(s, tx);
            }
            s.services.message = "".into();
            s.services.next_refresh = Some(
                Instant::now()
                    + Duration::from_secs(
                        if matches!(update.0.as_str(), "/api/features" | "/api/providers") {
                            3
                        } else {
                            0
                        },
                    ),
            );
        }
        Err(error) => {
            s.services.message = error;
            s.services.next_refresh = Some(Instant::now() + Duration::from_secs(10));
        }
    }
}
pub fn poll(s: &mut State, tx: &mut Tx) {
    if !s.services.confirmed && std::env::var_os("DRAFT_PACKAGED").is_some() && !s.services.busy {
        s.services.confirmed = true;
        request(s, "/api/health", None);
        return;
    }
    if !s.preferences || s.settings.section < 5 || s.services.busy {
        return;
    }
    let due = s.services.next_refresh.get_or_insert_with(Instant::now);
    if *due <= Instant::now() {
        let path = if s.settings.section == 5 {
            "/api/providers"
        } else {
            "/api/features"
        };
        request(s, path, None);
    } else {
        tx.wake_after(due.saturating_duration_since(Instant::now()));
    }
}
fn label(value: &Value, key: &str, fallback: &str) -> String {
    value[key].as_str().unwrap_or(fallback).into()
}
pub fn page(s: &State, p: design::Palette) -> El {
    let mut body = col().w_full().gap(12.0);
    if !s.services.message.is_empty() {
        body = body.child(settings::copy(&s.services.message, p).wrap());
    }
    if s.settings.section == 5 {
        body=body.child(settings::copy("Use your existing Claude Code or Codex connection for writing and personal features.",p).wrap());
        if let Some(providers) = s.services.providers["providers"].as_array() {
            for provider in providers {
                let id = label(provider, "id", "");
                body = body.child(
                    text(label(provider, "name", "Model"))
                        .font(TextStyle::new(18.0, 550.0))
                        .color(p.text),
                );
                if provider["ready"].as_bool() == Some(true) {
                    if let Some(models) = provider["models"].as_array() {
                        let mut seen = std::collections::HashSet::new();
                        for model in models {
                            if !seen.insert(model["id"].clone().to_string()) {
                                continue;
                            }
                            let selection = json!({"provider":id,"model":model["id"]});
                            let selected = s.services.providers["selection"] == selection;
                            body = body.child(settings::button(
                                &format!("model-{id}-{}", model["id"].as_str().unwrap_or_default()),
                                &format!(
                                    "{}{}",
                                    if selected { "✓  " } else { "" },
                                    label(model, "name", "Model")
                                ),
                                p,
                                move |s, _| {
                                    request(s, "/api/providers/select", Some(selection.clone()))
                                },
                            ));
                        }
                    }
                } else {
                    let installed = provider["installed"].as_bool() == Some(true);
                    let provider = id.clone();
                    body = body.child(settings::button(
                        &format!("connect-{id}"),
                        if installed { "Connect" } else { "Install" },
                        p,
                        move |s, _| {
                            request(
                                s,
                                if installed {
                                    "/api/providers/login"
                                } else {
                                    "/api/external"
                                },
                                Some(if installed {
                                    json!({"provider":provider})
                                } else {
                                    json!({"kind":provider})
                                }),
                            )
                        },
                    ));
                }
            }
        }
    } else if s.settings.section == 6 {
        body=body.child(settings::copy("Describe a change to make Draft your own. Prepared changes are checked before you apply them.",p).wrap())
            .child(text_input(&s.services.prompt,TextStyle::new(14.0,400.0)).key("feature-request").role("textbox").label("Describe a personal feature").w_full().min_h(110.0).padding(12.0).radius(12.0).fill(p.glass).color(p.text).caret(s.caret.color(p.text),p.text.alpha(0.2)).on_edit(|s:&mut State|&mut s.services.prompt))
            .child(settings::button("feature-add","Prepare feature",p,|s,_|request(s,"/api/updates/request",Some(json!({"kind":"add","request":s.services.prompt.text})))));
        if let Some(features) = s.services.features["current"]["features"].as_array() {
            for feature in features.iter().filter(|f| f["state"] == "active") {
                let id = feature["id"].clone();
                let title = label(feature, "title", "Feature");
                body=body.child(settings::copy(&title,p).wrap()).child(settings::button(&format!("feature-remove-{id}"),"Prepare removal",p,move|s,_|request(s,"/api/updates/request",Some(json!({"kind":"remove","featureId":id,"request":format!("Remove {title}")})))));
            }
        }
    } else {
        body = body
            .child(settings::button(
                "check-updates",
                "Check for updates",
                p,
                |s, _| request(s, "/api/updates/check", Some(json!({}))),
            ))
            .child(settings::button(
                "undo-update",
                "Undo last update",
                p,
                |s, _| {
                    request(
                        s,
                        "/api/updates/request",
                        Some(json!({"kind":"rollback","request":"Undo last update"})),
                    )
                },
            ));
    }
    if s.settings.section >= 6
        && let Some(updates) = s.services.features["updates"].as_array()
    {
        for update in updates.iter().take(10) {
            let id = update["id"].clone();
            let mut card = col()
                .w_full()
                .padding(12.0)
                .radius(12.0)
                .fill(p.glass)
                .gap(8.0)
                .child(
                    settings::copy(
                        format!(
                            "{} · {}",
                            label(update, "title", "Update"),
                            label(update, "stage", "")
                        ),
                        p,
                    )
                    .wrap(),
                );
            if let Some(error) = update["error"].as_str() {
                card = card.child(settings::copy(error, p).wrap());
            }
            if update["state"] == "ready" {
                let apply = id.clone();
                card = card.child(settings::button(
                    &format!("apply-{id}"),
                    "Apply and restart",
                    p,
                    move |s, tx| match s.flush(tx) {
                        Ok(()) => request(s, "/api/updates/apply", Some(json!({"id":apply}))),
                        Err(error) => s.services.message = error,
                    },
                ));
            }
            if matches!(
                update["state"].as_str(),
                Some("preparing" | "building" | "ready" | "needs-attention")
            ) {
                card = card.child(settings::button(
                    &format!("discard-{id}"),
                    "Discard",
                    p,
                    move |s, _| request(s, "/api/updates/discard", Some(json!({"id":id}))),
                ));
            }
            body = body.child(card);
        }
    }
    if s.services.busy {
        body = body.inert();
    }
    body
}
