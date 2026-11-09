//! Model and feature requests use a separate worker from writing and saving.
use super::*;

#[derive(Default)]
pub struct Services {
    jobs: Option<mpsc::Sender<Job>>,
    pub providers: Value,
    pub desktop: Value,
    pub features: Value,
    pub prompt: TextEdit,
    pub message: String,
    /// A person's action is waiting for the host. Only this blocks the page.
    pub busy: bool,
    /// A silent refresh is on its way. It never blocks the page or shows "Working…".
    pub(crate) refreshing: bool,
    /// The provider whose models are listed, when someone opens another one.
    pub(crate) expanded: Option<String>,
    pub(crate) next_refresh: Option<Instant>,
    pub(crate) next_background: Option<Instant>,
    pub(crate) confirmed: bool,
}
type Job = (String, Option<Value>, bool);
pub struct Update(String, Result<Value, String>, bool);
pub fn setup(s: &mut State, replies: mpsc::Sender<Reply>, waker: Waker) {
    let (jobs, receive) = mpsc::channel::<Job>();
    let _ = jobs.send(("/desktop/preferences".into(), None, false));
    s.services.busy = true;
    s.services.jobs = Some(jobs);
    let mut host = s.host.clone();
    host.agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(190)))
        .build()
        .into();
    std::thread::spawn(move || {
        while let Ok((path, body, background)) = receive.recv() {
            let result = if let Some(body) = body {
                host.post(&path, &body)
            } else {
                host.get(&path)
            };
            if replies
                .send(Reply::Services(Update(path, result, background)))
                .is_err()
            {
                break;
            }
            waker();
        }
    });
}
/// Something a person asked for. The page waits for it and says so.
pub fn request(s: &mut State, path: &str, body: Option<Value>) {
    if s.services.busy {
        return;
    }
    if let Some(jobs) = &s.services.jobs {
        s.services.busy = jobs.send((path.into(), body, false)).is_ok();
        s.services.message = "Working…".into();
    }
}
/// Fresh status for the page. Quiet: the page stays usable and nothing moves.
fn refresh(s: &mut State, path: &str) {
    if s.services.busy || s.services.refreshing {
        return;
    }
    if let Some(jobs) = &s.services.jobs {
        s.services.refreshing = jobs.send((path.into(), None, true)).is_ok();
    }
}
pub fn receive(s: &mut State, update: Update, tx: &mut Tx) {
    let Update(path, result, background) = update;
    if background {
        s.services.refreshing = false;
    } else {
        s.services.busy = false;
    }
    let every = if path.starts_with("/api/providers") {
        10
    } else {
        3
    };
    match result {
        Ok(value) => {
            if path == "/desktop/preferences" {
                desktop::preferences(s, value);
            } else if path == "/api/health" {
                request(
                    s,
                    "/api/updates/confirm",
                    Some(json!({"version":value["version"]})),
                );
            } else if path == "/api/providers" {
                s.services.providers = value;
            } else if path == "/api/providers/login" && value["providers"].is_array() {
                s.services.providers["providers"] = value["providers"].clone();
            } else if path == "/api/features" {
                s.services.features = value;
            } else if path == "/api/updates/request" {
                // The request is on its way; its progress shows below.
                s.services.prompt = TextEdit::default();
            } else if path == "/api/updates/apply" {
                keyboard::quit(s, tx);
            }
            if !background {
                // An action changes what the page shows, so look again right away.
                if s.services.message == "Working…" {
                    s.services.message.clear();
                }
                s.services.next_refresh = Some(Instant::now());
            } else {
                s.services.next_refresh = Some(Instant::now() + Duration::from_secs(every));
            }
        }
        Err(error) => {
            // A failed refresh says nothing unless the page has nothing else to show.
            let empty = if path == "/api/providers" {
                s.services.providers.is_null()
            } else {
                s.services.features.is_null()
            };
            if !background || empty {
                s.services.message = error;
            }
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
    if s.services.busy || s.services.refreshing || s.services.jobs.is_none() {
        return;
    }
    if !s.preferences || s.settings.section < 5 {
        // Outside Settings, look in on updates now and then so a found one shows in the footer.
        let due = s
            .services
            .next_background
            .get_or_insert_with(|| Instant::now() + Duration::from_secs(5));
        if *due <= Instant::now() {
            s.services.next_background = Some(Instant::now() + Duration::from_secs(60));
            refresh(s, "/api/features");
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
        refresh(s, path);
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
/// A provider's models once each, by real name. Claude Code also lists its default as
/// "Default (recommended)" under the same id; that becomes a Recommended tag instead.
fn model_list(provider: &Value) -> Vec<(String, String, bool)> {
    let mut list: Vec<(String, String, bool)> = vec![];
    for model in provider["models"].as_array().into_iter().flatten() {
        let Some(id) = model["id"].as_str() else {
            continue;
        };
        let name = label(model, "name", id);
        let alias = name.starts_with("Default");
        let recommended = model["isDefault"] == true || alias;
        match list.iter_mut().find(|(seen, _, _)| seen == id) {
            Some(entry) => {
                if entry.1.starts_with("Default") && !alias {
                    entry.1 = name;
                }
                entry.2 |= recommended;
            }
            None => list.push((id.to_string(), name, recommended)),
        }
    }
    list
}
/// Which model Draft uses, from the Claude Code and Codex sign-ins already on this computer.
fn models(s: &State, dark: bool, p: design::Palette, mut body: El) -> El {
    body = body.child(
        settings::copy(
            "Draft uses your own Claude Code or Codex sign-in for writing help and for building personal features.",
            p,
        )
        .wrap(),
    );
    let Some(providers) = s.services.providers["providers"].as_array() else {
        return body.child(settings::copy("Looking for Claude Code and Codex…", p));
    };
    let selection = &s.services.providers["selection"];
    let chosen = providers.iter().find_map(|provider| {
        let (_, model, _) = model_list(provider).into_iter().find(|(id, _, _)| {
            provider["id"] == selection["provider"] && selection["model"] == id.as_str()
        })?;
        Some((label(provider, "name", "Model"), model))
    });
    let (color, headline) = match &chosen {
        Some((provider, model)) => (
            p.stage(dark, "Ready"),
            format!("Using {model} with {provider}"),
        ),
        None => (
            design::caution(dark),
            "Choose a model to use writing help and personal features".into(),
        ),
    };
    body = body.child(
        row()
            .key("model-current")
            .role("status")
            .label(headline.as_str())
            .w_full()
            .padding(16.0)
            .radius(12.0)
            .fill(p.glass)
            .gap(10.0)
            .center_y()
            .child(el().size(10.0, 10.0).radius(5.0).fill(color))
            .child(
                text(headline.clone())
                    .grow(1.0)
                    .min_w(0.0)
                    .wrap()
                    .font(TextStyle::new(15.0, 600.0))
                    .color(p.text),
            ),
    );
    // The provider in use starts open; another opens when someone asks to see its models.
    let open = s
        .services
        .expanded
        .clone()
        .or_else(|| selection["provider"].as_str().map(str::to_owned))
        .or_else(|| {
            providers
                .iter()
                .find(|provider| provider["ready"] == true)
                .map(|provider| label(provider, "id", ""))
        });
    for provider in providers {
        let id = label(provider, "id", "");
        let name = label(provider, "name", "Model");
        let ready = provider["ready"] == true;
        let installed = provider["installed"] == true;
        let (state_color, state) = if ready {
            (p.stage(dark, "Ready"), "Signed in")
        } else if installed {
            (design::caution(dark), "Not signed in")
        } else {
            (p.muted, "Not installed")
        };
        let showing = ready && open.as_deref() == Some(id.as_str());
        let toggle = id.clone();
        let mut header = row()
            .key(format!("provider-{id}"))
            .w_full()
            .gap(10.0)
            .center_y()
            .child(
                text(name.clone())
                    .grow(1.0)
                    .min_w(0.0)
                    .font(TextStyle::new(15.0, 600.0))
                    .color(p.text),
            )
            .child(el().size(8.0, 8.0).radius(4.0).fill(state_color))
            .child(text(state).font(TextStyle::new(13.0, 400.0)).color(p.muted));
        if ready {
            header = header
                .role("button")
                .label(format!(
                    "{name}, {state}. {} its models",
                    if showing { "Hide" } else { "Show" }
                ))
                .focusable(true)
                .on_press(move |s: &mut State| {
                    let open = s.services.expanded.clone().or_else(|| {
                        s.services.providers["selection"]["provider"]
                            .as_str()
                            .map(str::to_owned)
                    });
                    s.services.expanded = Some(if open.as_deref() == Some(toggle.as_str()) {
                        String::new()
                    } else {
                        toggle.clone()
                    });
                });
        }
        let mut card = col()
            .key(format!("provider-card-{id}"))
            .w_full()
            .padding(16.0)
            .radius(12.0)
            .fill(p.glass)
            .gap(6.0)
            .child(header);
        if let Some(error) = provider["error"].as_str().filter(|_| !ready) {
            card = card.child(settings::copy(error, p).wrap());
        }
        if !ready {
            let provider = id.clone();
            card = card.child(settings::button(
                &format!("connect-{id}"),
                if installed { "Sign in" } else { "Get it" },
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
        } else if showing {
            for (model, name, recommended) in model_list(provider) {
                let choice = json!({"provider":id,"model":model});
                let selected = *selection == choice;
                let mut option = row()
                    .key(format!("model-{id}-{model}"))
                    .role("button")
                    .label(if selected {
                        format!("{name}, selected")
                    } else {
                        name.clone()
                    })
                    .focusable(true)
                    .w_full()
                    .h(32.0)
                    .min_h(32.0)
                    .px(10.0)
                    .gap(10.0)
                    .radius(9.0)
                    .continuous_corners()
                    .center_y()
                    .hover(p.selected)
                    .child(
                        text(name)
                            .grow(1.0)
                            .min_w(0.0)
                            .truncate()
                            .font(TextStyle::new(13.0, if selected { 600.0 } else { 400.0 }))
                            .color(p.text),
                    )
                    .on_press(move |s: &mut State| {
                        // Show the choice at once; the host saves it in the background.
                        s.services.providers["selection"] = choice.clone();
                        s.services.expanded = None;
                        request(s, "/api/providers/select", Some(choice.clone()));
                    });
                if recommended {
                    option = option.child(
                        text("Recommended")
                            .font(TextStyle::new(12.0, 400.0))
                            .color(p.muted),
                    );
                }
                if selected {
                    option = option
                        .fill(p.selected)
                        .child(rune::icon(&design::CHECK, 14.0).color(p.text));
                }
                card = card.child(option);
            }
        }
        body = body.child(card);
    }
    body
}
/// Describe a change, and see the features this Draft has.
fn features(s: &State, p: design::Palette, mut body: El) -> El {
    body = body
        .child(
            settings::copy(
                "Describe a change to make Draft your own. Draft builds it with your model and checks it before you apply it.",
                p,
            )
            .wrap(),
        )
        .child(
            text_input(&s.services.prompt, TextStyle::new(14.0, 400.0))
                .key("feature-request")
                .role("textbox")
                .label("Describe a personal feature")
                .placeholder(
                    "For example: show a word count at the bottom of each draft",
                    p.muted,
                )
                .w_full()
                .min_h(110.0)
                .padding(12.0)
                .radius(12.0)
                .fill(p.glass)
                .color(p.text)
                .caret(s.caret.color(p.text), p.text.alpha(0.2))
                .on_selection_change(|s: &mut State, _, _| s.caret.restart())
                .on_edit(|s: &mut State| &mut s.services.prompt),
        )
        .child(settings::button("feature-add", "Prepare feature", p, |s, _| {
            request(
                s,
                "/api/updates/request",
                Some(json!({"kind":"add","request":s.services.prompt.text})),
            )
        }));
    if let Some(features) = s.services.features["current"]["features"].as_array() {
        let mut list = col()
            .key("feature-list")
            .w_full()
            .padding(16.0)
            .radius(12.0)
            .fill(p.glass)
            .gap(12.0)
            .child(
                text("In your Draft")
                    .font(TextStyle::new(15.0, 600.0))
                    .color(p.text)
                    .pb(4.0),
            );
        for feature in features.iter().filter(|f| f["state"] == "active") {
            let id = label(feature, "id", "");
            let title = label(feature, "title", "Feature");
            let personal = feature["origin"] == "personal";
            let remove = title.clone();
            list = list.child(
                row()
                    .w_full()
                    .gap(10.0)
                    .center_y()
                    .child(
                        col()
                            .grow(1.0)
                            .min_w(0.0)
                            .gap(2.0)
                            .child(
                                text(if personal { format!("{title} · yours") } else { title.clone() })
                                    .font(TextStyle::new(14.0, 500.0))
                                    .color(p.text),
                            )
                            .child(
                                text(label(feature, "description", ""))
                                    .w_full()
                                    .wrap()
                                    .font(TextStyle::new(13.0, 400.0))
                                    .color(p.muted),
                            ),
                    )
                    .child(
                        ui::menu_item(&format!("feature-remove-{id}"), "Remove…", p, move |s, _| {
                            request(
                                s,
                                "/api/updates/request",
                                Some(json!({"kind":"remove","featureId":id,"request":format!("Remove {remove}")})),
                            )
                        })
                        .w(92.0),
                    ),
            );
        }
        body = body.child(list);
    }
    body
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
pub fn page(s: &State, dark: bool, p: design::Palette) -> El {
    let mut body = col().w_full().gap(12.0);
    if !s.services.message.is_empty() {
        body = body.child(settings::copy(&s.services.message, p).wrap());
    }
    if s.settings.section == 5 {
        body = models(s, dark, p, body);
    } else if s.settings.section == 6 {
        body = features(s, p, body);
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
