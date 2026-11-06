# Draft's Rune editor experiment

Question: can a native Rune frontend preserve Draft's writing behavior while
keeping the existing Markdown document store?

Run from the repository root with Bun, Rust, and Cargo installed:

```sh
bun run rune:dev
```

The first run downloads and builds the pinned Rust dependencies. On macOS the
launcher creates a development app bundle and opens its native window. Start it
with this command so the Bun document host runs alongside it. Close the native
window when finished. To try an optimized build, use `bun run rune:dev --release`.

## What to try

- Edit the version columns, switch drafts, and return to your writing. Extra
  open versions scroll horizontally.
- Right-click a sidebar draft for Open, Rename, Pin, New version, versions,
  status, Export, Archive, or Delete. Version rows and tabs have their own menu
  for renaming, copying, closing, or deleting that version. Delete asks first
  and keeps writing in Recovery; Settings can restore the last archived draft.
- Control+Tab and Control+Shift+Tab cycle forward and backward through the open
  versions, including when the highlighted draft in the sidebar has focus.
- Right-click selected text for Bold, Italic, Code, Undo, or Redo. Cmd/Ctrl-I
  formats italic; Cmd/Ctrl-B toggles the sidebar, as in Draft. Cmd/Ctrl-S saves.
  Plain Return always inserts a newline.
- Paste an image. It becomes a Markdown reference plus an image preview below
  the editor. Image insertion is one undo step. If typing continues while the
  image saves, it inserts at the current caret in the original version.
- Choose **Settings → Reload files** to read the saved `.draft` packages. Equal text retains
  the live editor's selection and undo history.
- Settings offers system/light/dark appearance and **Show Markdown**. The initial
  dark appearance matches the original app reference, with Markdown punctuation
  concealed in the prose.

The sidebar and editor are Rune, without a webview. The layout follows the
existing Draft design: a single frosted surface, joined floating version tabs,
compact draft previews and status chips, and bottom-corner settings and save
controls. The selected draft, joined tabs, and floating menus share a glass
treatment. Tab lighting follows the full outline through its necks. Settings
anchors just above the gear; context menus flip near window edges.
macOS loads its system font from the OS; Linux retains Rune's font
fallback. Formatting and concealed punctuation use display spans over the same
Markdown source. Ordinary saves and image
imports run on a worker. The Bun host reuses `desktop/documents.ts` and Draft's
model rather than introducing another document format.

## Disposable data and checks

Writing lives under `native/rune-prototype/scratch/Drafts/`, separate from the
installed app. `DRAFT_RUNE_DATA_ROOT` selects another experimental library.
The launcher uses a random loopback port and a per-launch authorization token.

```sh
bun run rune:check
bun run rune:snap
cargo clippy --manifest-path native/rune-prototype/Cargo.toml --locked -- -D warnings
```

Checks create and remove their own temporary library. They exercise real Rune
input routing and Draft storage: Unicode round trips, IME preedit/commit,
formatting, joined-emoji deletion, independent undo, delayed saves, image paste,
accessible editor names, sidebar menu targeting, metadata persistence, version
actions, export, archive/restore, Recovery, and the final write barrier. Snapshots and tree dumps
go to `native/rune-prototype/artifacts/`.

Linux compilation was checked in the official `rust:1.96.1-bookworm` container,
with `pkg-config`, `libxkbcommon-dev`, and `libwayland-dev` installed. Running a
Linux window also requires a desktop session and graphics drivers. X11/Wayland
interaction and Orca have not been verified.

## What this establishes

The Mac window supports native text entry, Unicode paste, and save/reload. The
executable checks pass, and the same frontend passes Linux `cargo check`.
Parley's `complex-scripts` feature is enabled explicitly; without it the
Japanese-text scenario emitted missing-segmentation-model warnings.

This remains a prototype. The native rendering is an approximation of Draft's
glass, not a pixel-identical port. Concealed punctuation needs further checks
for cursor movement and selection around invisible source positions. It keeps
undo only for the current process, and does not implement Draft's spelling, full inline-image
editing, sync, personal-feature builds, native updater, or distribution. Manual
screen-reader and real input-method checks are still needed. No comparative
performance claim has been established. Keep this experiment on its prototype
branch rather than releasing it as Draft.

See [the Anomaly findings](../../docs/anomaly-text-editing-research-2026-11-06.md)
for the source patterns and next decisions.
