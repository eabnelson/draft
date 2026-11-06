//! File decoding and media persistence happen on the save worker, never in a view.
use super::*;
use std::io::Cursor;
pub fn png(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 25 * 1024 * 1024 {
        return Err("Choose an image smaller than 25 MB.".into());
    }
    let mut reader = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    limits.max_image_width = Some(16000);
    limits.max_image_height = Some(16000);
    reader.limits(limits);
    let image = reader.decode().map_err(|e| e.to_string())?;
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(output.into_inner())
}
pub fn files(s: &mut State, di: usize, vi: usize, files: &[PathBuf]) {
    if s.docs[di].pending_removal {
        return;
    }
    let d = &s.docs[di];
    let edit = &d.versions[vi].edit;
    for path in files.iter().take(20) {
        if let Some(jobs) = &s.jobs {
            let _ = jobs.send(Job::Image {
                draft: d.id().into(),
                version: d.versions[vi].id.clone(),
                selection: (edit.anchor, edit.focus),
                before: edit.text.clone(),
                bytes: vec![],
                file: Some(path.clone()),
            });
        }
    }
}
pub fn insertion(edit: &mut TextEdit, src: &str) {
    let [from, to] = [edit.anchor.min(edit.focus), edit.anchor.max(edit.focus)];
    let before = &edit.text[..from];
    let after = &edit.text[to..];
    let lead = if before.is_empty() || before.ends_with("\n\n") {
        ""
    } else if before.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    let trail = if after.starts_with("\n\n") {
        ""
    } else if after.starts_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    edit.break_history_group();
    edit.insert(&format!("{lead}![Pasted image]({src}){trail}"));
    edit.break_history_group();
}

#[derive(Clone)]
pub struct Record {
    pub range: std::ops::Range<usize>,
    pub src: String,
    pub title: String,
}
pub fn records(source: &str) -> Vec<Record> {
    Parser::new(source)
        .into_offset_iter()
        .filter_map(|(event, range)| match event {
            Event::Start(Tag::Image {
                dest_url, title, ..
            }) if safe(&dest_url) => Some(Record {
                range,
                src: dest_url.into_string(),
                title: title.into_string(),
            }),
            _ => None,
        })
        .collect()
}
fn safe(src: &str) -> bool {
    src.strip_prefix("media/").is_some_and(|name| {
        !name.is_empty()
            && name.len() < 80
            && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
    })
}
pub fn inline(
    s: &State,
    di: usize,
    vi: usize,
    width: f32,
    mut editor: El,
    cx: &Cx<State>,
    mut spans: Vec<Span>,
) -> El {
    let v = &s.docs[di].versions[vi];
    let key = format!("editor-wrap-{}", v.id);
    let mut overlays = Vec::new();
    if !s.source {
        for record in records(&v.edit.text) {
            let image = s.images.get(&s.image_path(s.docs[di].id(), &record.src));
            let ratio = image
                .and_then(Image::size)
                .map_or(1.5, |[w, h]| w as f32 / h.max(1) as f32);
            let height = (width / ratio).clamp(60.0, 500.0);
            let anchor = format!("inline-{}-{}", v.id, record.range.start);
            spans.push(Span::new(record.range.start, record.range.end).size(0.0));
            spans.push(
                Span::new(record.range.start, record.range.start + 1)
                    .size(0.0)
                    .attachment(width, height),
            );
            editor = editor.text_highlight(
                rune::TextHighlight::new(
                    record.range.start..record.range.start + 1,
                    Color::TRANSPARENT,
                )
                .pad(0.0)
                .key(&anchor),
            );
            if let (Some([x, y, _, _]), Some([ox, oy, _, _])) =
                (cx.layout(&anchor), cx.layout(&key))
            {
                let src = record.src.clone();
                let marker = v.edit.text[record.range.clone()].to_owned();
                let title = record.title.clone();
                let mut surface = el()
                    .key(format!("image-{}-{}", v.id, record.range.start))
                    .role("button")
                    .label("Edit image crop")
                    .focusable(true)
                    .size(width, height)
                    .absolute(x - ox, y - oy)
                    .radius(10.0)
                    .fill(Color::BLACK.alpha(0.04))
                    .on_press(move |s: &mut State| open(s, di, vi, &src, &title, &marker));
                if let Some(image) = image {
                    surface = surface.pixels_fit(image.pixels(), rune::SurfaceFit::Fit);
                }
                overlays.push(surface);
            }
        }
    }
    editor = editor.spans(spans);
    let mut wrapper = el().key(key).w_full().child(editor);
    for overlay in overlays {
        wrapper = wrapper.child(overlay);
    }
    wrapper
}
const SHAPES: [(&str, &str, u32, u32); 6] = [
    ("original", "Original", 0, 0),
    ("instagram-reel", "Instagram Reel · 9:16", 1080, 1920),
    ("instagram-carousel", "Instagram carousel · 4:5", 1080, 1350),
    ("instagram-tall", "Instagram tall slide · 3:4", 1080, 1440),
    ("tiktok", "TikTok · 9:16", 1080, 1920),
    ("horizontal", "YouTube & web · 16:9", 1920, 1080),
];
#[derive(Clone)]
pub struct Editing {
    pub anchor: String,
    pub draft: String,
    pub version: String,
    pub marker: String,
    alt: String,
    pub original: String,
    pub shape: usize,
    pub zoom: f32,
    pub center: [f32; 2],
    size: [f32; 2],
    size_known: bool,
    center_default: bool,
    drag_start: [f32; 2],
}
fn crop(edit: &Editing) -> [f32; 4] {
    let [w, h] = edit.size;
    let (_, _, sw, sh) = SHAPES[edit.shape];
    let ratio = if sw == 0 {
        w / h
    } else {
        sw as f32 / sh as f32
    };
    let cw = w.min(h * ratio) / edit.zoom.clamp(1.0, 4.0);
    let ch = cw / ratio;
    [
        (edit.center[0] - cw / 2.0).clamp(0.0, (w - cw).max(0.0)),
        (edit.center[1] - ch / 2.0).clamp(0.0, (h - ch).max(0.0)),
        cw,
        ch,
    ]
}
pub fn open(s: &mut State, di: usize, vi: usize, src: &str, title: &str, marker: &str) {
    let parts: Vec<_> = title.split_whitespace().collect();
    let original = parts
        .get(4)
        .filter(|p| safe(p))
        .copied()
        .unwrap_or(src)
        .to_owned();
    let path = s.image_path(s.docs[di].id(), &original);
    let size = s
        .images
        .get(&path)
        .and_then(Image::size)
        .unwrap_or([1000, 1000])
        .map(|v| v as f32);
    let shape = parts
        .first()
        .and_then(|p| p.strip_prefix("draft-crop:"))
        .and_then(|id| SHAPES.iter().position(|s| s.0 == id))
        .unwrap_or(0);
    let parse = |at: usize, default: f32| {
        parts
            .get(at)
            .and_then(|p| p.parse::<f32>().ok())
            .filter(|v| v.is_finite())
            .unwrap_or(default)
    };
    s.attachment = Some(Editing {
        anchor: format!(
            "image-{}-{}",
            s.docs[di].versions[vi].id,
            s.docs[di].versions[vi].edit.text.find(marker).unwrap_or(0)
        ),
        draft: s.docs[di].id().into(),
        version: s.docs[di].versions[vi].id.clone(),
        marker: marker.into(),
        alt: links::label(marker.strip_prefix('!').unwrap_or(marker)).into(),
        original,
        shape,
        zoom: parse(1, 1.0).clamp(1.0, 4.0),
        center: [parse(2, size[0] / 2.0), parse(3, size[1] / 2.0)],
        size,
        size_known: s.images.get(&path).and_then(Image::size).is_some(),
        center_default: parts.get(2).is_none(),
        drag_start: [0.0; 2],
    });
    s.context = None;
    s.item_menu = None;
    if let Some(cache) = &s.cache {
        s.images
            .entry(path.clone())
            .or_insert_with(|| cache.file(path, 1200.0, 2.0));
    }
}
pub fn render(edit: &Editing, path: &std::path::Path) -> Result<Vec<u8>, String> {
    let bytes = png(path)?;
    let image = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let mut actual = edit.clone();
    actual.size = [image.width() as f32, image.height() as f32];
    if !actual.size_known && actual.center_default {
        actual.center = actual.size.map(|v| v / 2.0);
    }
    let [x, y, w, h] = crop(&actual);
    let image = image.crop_imm(x as u32, y as u32, (w as u32).max(1), (h as u32).max(1));
    let (_, _, sw, sh) = SHAPES[edit.shape];
    let image = if sw > 0 {
        image.resize_exact(sw, sh, image::imageops::FilterType::Lanczos3)
    } else {
        image.thumbnail(4096, 4096)
    };
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(output.into_inner())
}
pub fn panel(s: &State, dark: bool, p: design::Palette) -> El {
    let edit = s.attachment.as_ref().unwrap();
    let [x, y, w, h] = crop(edit);
    let scale = 300.0 / w;
    let frame_h = (h * scale).min(300.0);
    let scale = scale.min(frame_h / h);
    let mut frame = el()
        .key("crop-preview")
        .size(w * scale, h * scale)
        .clip_rounded(8.0)
        .fill(Color::BLACK.alpha(0.1));
    if let Some(image) = s.images.get(&s.image_path(&edit.draft, &edit.original)) {
        frame = frame.child(
            el().size(edit.size[0] * scale, edit.size[1] * scale)
                .pixels(image.pixels())
                .absolute(-x * scale, -y * scale),
        );
    }
    let frame = frame.on_drag(move |s: &mut State, drag, _| {
        if let Some(edit) = &mut s.attachment {
            match drag.phase {
                rune::Phase::Down => edit.drag_start = edit.center,
                rune::Phase::Move => {
                    edit.center = [
                        edit.drag_start[0] - drag.dx / scale,
                        edit.drag_start[1] - drag.dy / scale,
                    ];
                    let [x, y, w, h] = crop(edit);
                    edit.center = [x + w / 2.0, y + h / 2.0];
                }
                _ => {}
            }
        }
    });
    let mut content = col()
        .key("image-crop-panel")
        .w(340.0)
        .padding(16.0)
        .gap(8.0)
        .radius(16.0)
        .child(settings::copy("Drag to frame your image", p))
        .child(frame);
    for (i, (_, label, _, _)) in SHAPES.iter().enumerate() {
        content = content.child(settings::button(
            &format!("crop-shape-{i}"),
            &format!("{}{}", if edit.shape == i { "✓  " } else { "" }, label),
            p,
            move |s, _| {
                if let Some(edit) = &mut s.attachment {
                    edit.shape = i;
                }
            },
        ));
    }
    content = content
        .child(
            row()
                .w_full()
                .gap(8.0)
                .child(
                    ui::menu_item("crop-zoom-out", "−", p, |s, _| {
                        if let Some(edit) = &mut s.attachment {
                            edit.zoom = (edit.zoom - 0.25).max(1.0);
                        }
                    })
                    .w(60.0),
                )
                .child(
                    text(format!("{:.0}%", edit.zoom * 100.0))
                        .font(TextStyle::new(13.0, 400.0))
                        .color(p.text),
                )
                .child(
                    ui::menu_item("crop-zoom-in", "+", p, |s, _| {
                        if let Some(edit) = &mut s.attachment {
                            edit.zoom = (edit.zoom + 0.25).min(4.0);
                        }
                    })
                    .w(60.0),
                ),
        )
        .child(settings::button("crop-save", "Save crop", p, |s, _| {
            if let Some(edit) = s.attachment.take()
                && let Some(jobs) = &s.jobs
            {
                let path = s.image_path(&edit.draft, &edit.original);
                let _ = jobs.send(Job::Crop(edit, path));
            }
        }))
        .child(settings::button("crop-copy", "Copy image", p, |s, _| {
            if let Some(edit) = s.attachment.clone()
                && let Some(jobs) = &s.jobs
            {
                let path = s.image_path(&edit.draft, &edit.original);
                let _ = jobs.send(Job::CopyImage(edit, path));
            }
        }))
        .child(settings::button("crop-cancel", "Cancel", p, |s, _| {
            s.attachment = None
        }));
    design::glass_surface(content, dark)
        .fill(p.menu.alpha(0.95))
        .backdrop_blur(22.0)
}
pub fn markdown(edit: &Editing, src: &str) -> String {
    format!(
        "![{}]({src} \"draft-crop:{} {:.4} {:.2} {:.2} {}\")",
        edit.alt, SHAPES[edit.shape].0, edit.zoom, edit.center[0], edit.center[1], edit.original
    )
}
pub fn received(s: &mut State, edit: Editing, result: Result<String, String>, tx: &mut Tx) {
    match result {
        Ok(src) => {
            let location = s.docs.iter().enumerate().find_map(|(di, d)| {
                if d.id() == edit.draft {
                    d.versions
                        .iter()
                        .position(|v| v.id == edit.version)
                        .map(|vi| (di, vi))
                } else {
                    None
                }
            });
            if let Some((di, vi)) = location {
                let buffer = &mut s.docs[di].versions[vi].edit;
                if let Some(at) = buffer.text.find(&edit.marker) {
                    buffer.anchor = at;
                    buffer.focus = at + edit.marker.len();
                    buffer.break_history_group();
                    buffer.insert(&markdown(&edit, &src));
                    buffer.break_history_group();
                    s.edited(di, vi, tx);
                } else {
                    s.notice =
                        "The image changed while its crop was being saved. Open it again.".into();
                }
            }
        }
        Err(error) => s.notice = format!("Could not crop image: {error}"),
    }
}

pub fn key(s: &mut State, di: usize, vi: usize, key: &KeyEvent, tx: &mut Tx) -> bool {
    if s.source || key.mods.cmd || key.mods.ctrl || key.mods.alt {
        return false;
    }
    let edit = &mut s.docs[di].versions[vi].edit;
    if edit.anchor != edit.focus {
        return false;
    }
    let at = edit.focus;
    let record = records(&edit.text).into_iter().find(|r| match key.key {
        Key::Left | Key::Backspace => r.range.start < at && at <= r.range.end,
        Key::Right | Key::Delete => r.range.start <= at && at < r.range.end,
        _ => false,
    });
    let Some(record) = record else { return false };
    match key.key {
        Key::Left | Key::Right => {
            edit.focus = if key.key == Key::Left {
                record.range.start
            } else {
                record.range.end
            };
            if !key.mods.shift {
                edit.anchor = edit.focus;
            }
        }
        _ => {
            edit.anchor = record.range.start;
            edit.focus = record.range.end;
            edit.break_history_group();
            edit.insert("");
            edit.break_history_group();
            s.edited(di, vi, tx);
        }
    }
    true
}

pub fn poll(s: &mut State) -> bool {
    let ready = s
        .images
        .values()
        .filter(|image| image.size().is_some())
        .count();
    let mut changed = ready != s.ready_images;
    s.ready_images = ready;
    if let Some(edit) = &s.attachment {
        let path = s.image_path(&edit.draft, &edit.original);
        if let Some(size) = s.images.get(&path).and_then(Image::size)
            && !edit.size_known
        {
            let edit = s.attachment.as_mut().unwrap();
            edit.size = size.map(|v| v as f32);
            edit.size_known = true;
            if edit.center_default {
                edit.center = edit.size.map(|v| v / 2.0);
            }
            changed = true;
        }
    }
    changed
}
