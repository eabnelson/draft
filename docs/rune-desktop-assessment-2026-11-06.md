# Rune for Draft on macOS and Linux

Research date: November 6, 2026. Rune's `dev` branch was inspected through GitHub;
Draft was inspected in this checkout. This is a source-based assessment. Rune was
not built or benchmarked, and no Linux installation was tested.

## Recommendation

Rune is worth evaluating as the foundation for a future native Draft interface.
For shipping Linux support sooner, continue with Tauri and port Draft's existing
platform services. Evaluate Rune in a separate, small editor executable before
committing to a migration.

This recommendation reflects the amount of existing Draft behavior that must
survive, particularly writing and personal feature updates. It is not a measured
performance comparison. Tauri already supports Linux distribution, including
Debian packages, AppImage, and RPM; changing UI frameworks is not a prerequisite.
[Tauri distribution documentation](https://v2.tauri.app/distribute/#linux).

## What Rune could improve

- **Rendering and motion.** Rune provides its own GPU-rendered interface and
  spring animations. Its current default features include a native Metal backend
  for macOS, with wgpu used elsewhere. This makes it a candidate for improving
  responsiveness and visual consistency, subject to measurements with Draft's
  workload. [Rune overview](https://github.com/anomalyco/rune),
  [feature definitions](https://github.com/anomalyco/rune/blob/dev/crates/rune/Cargo.toml).
- **macOS appearance.** Native system materials support Liquid Glass on macOS 26
  and a material fallback on earlier versions. Other platforms use a drawn
  fallback. [System materials](https://github.com/anomalyco/rune/blob/dev/crates/rune/README.md#system-materials-elsystem_material-system_material).
- **Agent verification.** Headless PNG rendering, element-tree dumps, scripted
  input, and a virtual clock could give Draft's feature builder stronger UI
  checks. They would need to be integrated into our build gates.
  [Agent tooling](https://github.com/anomalyco/rune/blob/dev/crates/rune/README.md#agent-tooling-headless-no-window-same-renderer-fixed-virtual-clock).
- **Desktop integration.** The source includes global shortcut implementations
  for macOS, X11, and Wayland, with a permission-aware Wayland portal backend.
  Accessibility adapters cover macOS and Linux through AccessKit, enabled by
  default. These are useful building blocks, with application behavior still
  requiring validation. [Shortcut source](https://github.com/anomalyco/rune/blob/dev/crates/rune/src/shortcuts/mod.rs),
  [accessibility source](https://github.com/anomalyco/rune/blob/dev/crates/rune/src/a11y/mod.rs),
  [default features](https://github.com/anomalyco/rune/blob/dev/crates/rune/Cargo.toml).

Rune is a Rust UI framework with its own rendering and layout, rather than a
React component library or a switch in Tauri's configuration. Its views and text
editor types are exported as Rust APIs. A migration would involve implementing
Draft's interface against those APIs.
[Core API exports](https://github.com/anomalyco/rune/blob/dev/crates/rune/src/lib.rs).

## Why a migration needs evidence first

### The editor is a substantial part of Draft

[Editor.tsx](../src/Editor.tsx) uses CodeMirror with per-version state, persistent
undo history, independent scrolling, formatting, spelling menus, image paste,
and selection handling. [editor-markdown.ts](../src/editor-markdown.ts) implements
the Markdown editing presentation.

Rune already documents rich-text editing, IME composition, clipboard support,
and undo. Those capabilities do not establish parity with our Markdown editor
or its persisted history format. Reproducing the current behavior, including
inline images, would be migration work.
[Text fields and rich editing](https://github.com/anomalyco/rune/blob/dev/crates/rune/README.md#text-fields).

### Personal updates currently depend on the web stack

[updates.ts](../desktop/updates.ts) validates personal changes using Bun tests,
TypeScript, Vite, and the bundled local runtime. It expects `dist/index.html` and
rejects ordinary personal updates that change protected host files.
[prepare-resources.ts](../scripts/prepare-resources.ts) bundles Bun and the
JavaScript dependencies needed to build those updates.

If personal features change a Rust interface, Draft needs a way to compile,
validate, distribute, activate, and recover those native changes. That could
mean bundled native toolchains or a separate build service, plus a revised
update boundary. Rune's headless tools help with verification; they do not
replace this delivery system. Retaining the Bun document and sync backend is
possible in a prototype, so a native frontend need not also rewrite storage.

### Current platform gaps affect Draft features

- Rune's built-in tray implements Linux and Windows and explicitly reports that
  macOS is unsupported. Draft's existing menu-bar behavior would require another
  implementation. [Tray source](https://github.com/anomalyco/rune/blob/dev/crates/rune/src/tray.rs).
- Rune documents missing Wayland file-drag events in its current winit shell and
  restrictions on positioning, topmost windows, and activation. These need to
  be considered for image workflows and opening Draft from anywhere.
  [File drops](https://github.com/anomalyco/rune/blob/dev/crates/rune/README.md#dropping-files-in-from-other-apps-on_drop_files),
  [tray-controlled windows](https://github.com/anomalyco/rune/blob/dev/crates/rune/README.md#compact-tray-controlled-windows).
- Rune remains pre-release, with consumers told to pin a Git revision and no
  releases listed in its changelog. Adopting it means budgeting for framework
  changes. [Installation guidance](https://github.com/anomalyco/rune#add-it),
  [changelog](https://github.com/anomalyco/rune/blob/dev/CHANGELOG.md).

## Linux work that either approach still needs

These are concrete dependencies in Draft, independent of its renderer:

1. **Shell and window behavior.** [main.rs](../src-tauri/src/main.rs) contains
   unguarded Objective-C bindings, AppKit quit handling, macOS Spaces behavior,
   and macOS window configuration. Separate platform behavior while preserving
   the save-before-quit barrier, shortcuts, tray, and login preferences.
2. **Credentials and operating-system actions.**
   [zo-sync.ts](../desktop/zo-sync.ts) uses `/usr/bin/security` for Keychain.
   [links.ts](../desktop/links.ts) and [server.ts](../desktop/server.ts) use
   `/usr/bin/open`; [images.ts](../desktop/images.ts) uses AppleScript for image
   copying. Add Linux implementations. The existing `Secrets` interface already
   provides a seam for credential storage.
3. **Spelling.** [spelling.ts](../desktop/spelling.ts) explicitly enables only
   macOS and invokes the helper built from [Spelling.swift](../native/Spelling.swift).
   Provide a Linux spelling implementation and verify editor integration.
4. **Feature-builder isolation.** [agents.ts](../desktop/agents.ts) and
   [updates.ts](../desktop/updates.ts) launch work through macOS `sandbox-exec`.
   Implement equivalent Linux isolation for feature generation and verification.
5. **Paths, packaging, and updates.** [server.ts](../desktop/server.ts) defaults
   to a macOS Application Support path. [tauri.conf.json](../src-tauri/tauri.conf.json)
   selects only app/DMG bundles, [package-desktop.ts](../scripts/package-desktop.ts)
   constructs a Mac installer, and [native-update.ts](../desktop/native-update.ts)
   expects `.app` bundles and Apple verification tools. Add Linux resource paths,
   packages, installation, rollback, and CI verification.

## A useful Rune evaluation

Use a separate executable and disposable Draft data. Pin the Rune revision and
reuse the document/API boundary where practical. Build a sidebar and two editable
version columns with save/load, formatting, image paste, and independent undo.

Evaluate typing and scrolling with realistic documents, cold launch, idle CPU,
memory, and frame timing against the existing app on the same machines. Verify
IME composition, spelling, clipboard behavior, VoiceOver/Orca, and save/recovery.
Exercise Linux under both Wayland and X11. Include one agent-authored interface
change through a proposed native build and rollback path.

Proceed with migration only if the editor preserves Draft's writing behavior,
measurements show a useful benefit, and personal updates have a workable
delivery model. Until then, platform-service changes in the current app provide
the clearest route to Linux support and remain useful if Rune is adopted later.
