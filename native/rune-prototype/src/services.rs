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
    pub(crate) next_refresh: Option<Instant>,
    pub(crate) next_background: Option<Instant>,
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
    if s.services.busy {
        return;
    }
    if !s.preferences || s.settings.section < 5 {
        // Outside Settings, look in on updates now and then so a ready one shows in the footer.
        if s.services.jobs.is_none() {
            return;
        }
        let due = s
            .services
            .next_background
            .get_or_insert_with(|| Instant::now() + Duration::from_secs(5));
        if *due <= Instant::now() {
            s.services.next_background = Some(Instant::now() + Duration::from_secs(60));
            request(s, "/api/features", None);
            s.services.message.clear();
        } else {
            tx.wake_after(due.saturating_duration_since(Instant::now()));
        }
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
/// "Draft 0.3.0-alpha.78" for official releases, which older records call "A new version of Draft".
fn update_title(update: &Value) -> String {
    match update["version"].as_str() {
        Some(version) if update["kind"] == "official" => format!("Draft {version}"),
        _ => label(update, "title", "Update"),
    }
}
/// An update that is being prepared or is waiting for a restart.
pub fn pending_update(features: &Value) -> Option<&Value> {
    features["updates"].as_array()?.iter().find(|update| {
        matches!(
            update["state"].as_str(),
            Some("checking" | "preparing" | "building" | "ready" | "needs-attention" | "applying")
        )
    })
}
/// What the footer's update button says, and whether the update is ready to restart into.
/// It shows from the moment a newer Draft is found until it is installed.
pub fn update_hint(features: &Value) -> Option<(String, bool)> {
    if let Some(update) = pending_update(features) {
        let title = update_title(update);
        return Some(match update["state"].as_str() {
            Some("ready") => (format!("{title} is ready. Open Updates to restart"), true),
            Some("needs-attention") => {
                (format!("{title} needs your attention. Open Updates"), false)
            }
            _ => (format!("Getting {title} ready. Open Updates"), false),
        });
    }
    let latest = features["latestOfficial"]["tag"]
        .as_str()?
        .trim_start_matches('v');
    Some((format!("Draft {latest} is available. Open Updates"), false))
}
/// Which Draft is running, whether a newer one exists, and what you can do about it.
fn updates(s: &State, p: design::Palette, mut body: El) -> El {
    let f = &s.services.features;
    let Some(version) = f["appVersion"].as_str() else {
        return body.child(settings::copy("Loading…", p));
    };
    let latest = f["latestOfficial"]["tag"]
        .as_str()
        .map(|tag| tag.trim_start_matches('v').to_string());
    let pending = pending_update(f);
    let status = if let Some(update) = pending {
        let title = update_title(update);
        match update["state"].as_str() {
            Some("ready") => format!("{title} is ready. Restart Draft to finish updating."),
            Some("needs-attention") => format!("{title} needs your attention."),
            Some("applying") => format!("Installing {title}…"),
            _ => format!("Getting {title} ready. You can keep writing."),
        }
    } else if f["checkingUpdates"] == true {
        "Checking for updates…".into()
    } else if let Some(latest) = &latest {
        format!("Draft {latest} is available.")
    } else if let Some(error) = f["updateCheck"]["error"].as_str() {
        format!(
            "Draft couldn’t check for updates {}. {error}",
            f["updateCheck"]["when"].as_str().unwrap_or_default()
        )
    } else if let Some(when) = f["updateCheck"]["when"].as_str() {
        format!("You’re up to date. Checked {when}.")
    } else {
        "Draft checks for updates when it opens and every few hours.".into()
    };
    body = body
        .child(
            text(format!(
                "Draft {version}{}",
                if f["personal"] == true {
                    " with your changes"
                } else {
                    ""
                }
            ))
            .key("current-version")
            .font(TextStyle::new(18.0, 550.0))
            .color(p.text),
        )
        .child(settings::copy(status, p).key("update-status").wrap());
    if pending.is_none()
        && let Some(latest) = latest
    {
        if let Some(notes) = f["latestOfficial"]["notes"].as_array() {
            for note in notes.iter().filter_map(Value::as_str) {
                body = body.child(settings::copy(format!("•  {note}"), p).wrap());
            }
        }
        body = body.child(settings::button(
            "install-update",
            &format!("Update to Draft {latest}"),
            p,
            |s, _| {
                request(
                    s,
                    "/api/updates/request",
                    Some(json!({"kind":"official","request":"Update Draft."})),
                )
            },
        ));
    }
    body = body.child(settings::button(
        "check-updates",
        "Check for updates",
        p,
        |s, _| request(s, "/api/updates/check", Some(json!({}))),
    ));
    if f["canUndo"] == true {
        let previous = f["previousAppVersion"]
            .as_str()
            .map(|v| format!("Go back to Draft {v}"))
            .unwrap_or_else(|| "Undo last update".into());
        body = body.child(settings::button("undo-update", &previous, p, |s, _| {
            request(
                s,
                "/api/updates/request",
                Some(json!({"kind":"rollback","request":"Undo last update"})),
            )
        }));
    }
    body
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
        body = updates(s, p, body);
    }
    if s.settings.section >= 6
        && let Some(updates) = s.services.features["updates"].as_array()
    {
        let mut history = false;
        for (n, update) in updates.iter().take(10).enumerate() {
            let current = !matches!(
                update["state"].as_str(),
                Some("applied" | "failed" | "cancelled")
            );
            // Old discarded attempts say nothing about what you have now.
            if update["state"] == "cancelled" && n > 0 {
                continue;
            }
            if !current && !history && s.settings.section == 7 {
                history = true;
                body = body.child(
                    text("History")
                        .font(TextStyle::new(15.0, 600.0))
                        .color(p.text)
                        .pt(8.0),
                );
            }
            let id = update["id"].clone();
            let mut heading = vec![update_title(update), label(update, "stage", "")];
            if let Some(when) = update["when"].as_str().filter(|w| !w.is_empty()) {
                heading.push(when.into());
            }
            let mut card = col()
                .w_full()
                .padding(12.0)
                .radius(12.0)
                .fill(p.glass)
                .gap(8.0)
                .child(
                    settings::copy(
                        heading
                            .into_iter()
                            .filter(|part| !part.is_empty())
                            .collect::<Vec<_>>()
                            .join(" · "),
                        p,
                    )
                    .wrap(),
                );
            if current && let Some(summary) = update["summary"].as_str().filter(|s| !s.is_empty()) {
                card = card.child(settings::copy(summary, p).wrap());
            }
            if let Some(error) = update["error"].as_str() {
                card = card.child(settings::copy(error, p).wrap());
            }
            if update["state"] == "ready" {
                let apply = id.clone();
                card = card.child(settings::button(
                    &format!("apply-{}", label(update, "id", "")),
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
                    &format!("discard-{}", label(update, "id", "")),
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
