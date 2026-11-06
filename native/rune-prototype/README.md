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
- Cmd/Ctrl-T copies the active version into a new tab. Cmd/Ctrl-W closes that tab
  without deleting its writing; the final tab stays open. In Settings it returns
  to drafts. Cmd/Ctrl-1 through 8 select the corresponding sidebar draft, and 9
  selects the last one. Returning to a draft restores its selected version.
- Cmd/Ctrl-N opens a blank draft, reusing the most recently created draft while it
  is empty. Alt-period brings Draft forward with a blank draft from another app,
  or hides Draft when it is active. The process stays running after closing its
  window (Cmd/Ctrl-Shift-W) so quick capture still works; Quit ends it.
  `bun run rune:dev --release --hidden` starts it in the background.
- Cmd/Ctrl-plus (or equals), minus, and zero zoom in, out, and reset the whole
  interface. The zoom level is saved under the prototype's own data root.
- Right-click selected text for Bold, Italic, Code, Undo, or Redo. Cmd/Ctrl-I
  formats italic; Cmd/Ctrl-U toggles underline. Cmd/Ctrl-Z undoes, and
  Cmd/Ctrl-Shift-Z or Cmd/Ctrl-Y redoes in the active version. Cmd/Ctrl-B toggles
  the sidebar, as in Draft. Cmd/Ctrl-S saves, including from the sidebar.
  Plain Return always inserts a newline.
- Paste an image. It becomes a Markdown reference plus an image preview below
  the editor. Image insertion is one undo step. If typing continues while the
  image saves, it inserts at the current caret in the original version.
- Choose **Settings → Files → Reload files** to read the saved `.draft` packages. Equal text retains
  the live editor's selection and undo history.
- The gear opens the Settings page, with Appearance, Editor, Files, Sync, and
  Shortcuts sections, using the writing view's sidebar cards and floating glass headers.
  Cmd/Ctrl-comma opens it too; Escape or the bottom chevron-and-Back tab returns
  to the editor. Appearance offers system/light/dark, and Editor offers **Show Markdown**. The initial
  dark appearance matches the original app reference, with Markdown punctuation
  concealed in the prose.
- Appearance offers illustrated Light, Dark, and System previews of Draft's writing
  workspace, with daylight, moonlight, and a split day/night view. The selected
  preview has a glass edge; click or use arrow keys to choose a mode.
- Settings → Shortcuts shows individual beveled keycaps, with Mac modifier symbols
  and Linux Ctrl/Alt labels. Its card grid fits one, two, or three columns as the
  window changes width, and alternate combinations wrap together within a card.
- Text fields use the text color for their blinking caret. Typing and caret movement
  restart its visible phase; composition keeps it visible, and unfocused windows hide it.

The sidebar and editor are Rune, without a webview. The layout follows the
existing Draft design: a single frosted surface, joined floating version tabs,
compact draft previews with colored status text, and a bottom-corner settings
button. The selected draft, joined tabs, and floating menus share a glass
treatment. A cropped, separable Gaussian blur follows only the tab silhouette,
including its scooped necks; the rest of the header has no glass strip. The cloud
button appears only for a sync error and opens Settings directly to Sync.
Context menus flip near window edges.
macOS loads its system font from the OS; Linux retains Rune's font
fallback. Formatting and concealed punctuation use display spans over the same
Markdown source. Ordinary saves and image
imports run on a worker. The Bun host reuses `desktop/documents.ts` and Draft's
model rather than introducing another document format.

Sync settings reuse `desktop/zo-sync.ts`, with status and commands on a separate
worker from document saves. Sync is off initially; the prototype's data-root-specific
credential is separate from the installed app. Sign-in uses the existing macOS
Keychain backend. New sync downloads can be loaded through Files → Reload files;
automatic reconciliation into live native editor buffers is not implemented yet.

## Disposable data and checks

Writing lives under `native/rune-prototype/scratch/Drafts/`, separate from the
installed app. `DRAFT_RUNE_DATA_ROOT` selects another experimental library.
The launcher uses a random loopback port and a per-launch authorization token.

```sh
bun run rune:check
bun native/rune-prototype/run.ts --check-shortcuts
bun run rune:snap
cargo clippy --manifest-path native/rune-prototype/Cargo.toml --locked -- -D warnings
```

The optional GPU glass regression (`python3 native/rune-prototype/checks/glass-tabs.py`,
with Pillow installed) compares tab colors while switching drafts and active versions
in light and dark mode. It uses temporary libraries and saves snapshots in `artifacts/glass-tabs`.

Checks create and remove their own temporary library. They exercise real Rune
input routing and Draft storage: Unicode round trips, IME preedit/commit,
formatting, joined-emoji deletion, independent undo, delayed saves, image paste,
accessible editor names, sidebar menu targeting, metadata persistence, version
actions, export, archive/restore, Recovery, Settings navigation, sync-error visibility
and recovery, and the final write barrier. Snapshots and tree dumps
go to `native/rune-prototype/artifacts/`.

Linux compilation was checked in the official `rust:1.96.1-bookworm` container,
with `pkg-config`, `libxkbcommon-dev`, and `libwayland-dev` installed. Running a
Linux window also requires a desktop session and graphics drivers. X11/Wayland
interaction and Orca have not been verified.

The shortcut checks cover repeated tab commands while storage replies are pending,
all numbered sidebar positions, selection retention, empty-draft reuse, zoom
persistence and menu placement, underline undo/redo, and IME ownership. macOS native
menus use the same actions. Global quick capture uses Rune's Carbon backend on
macOS, X11 grabs, or the Wayland GlobalShortcuts portal. An unavailable or already
claimed shortcut is reported in Settings → Shortcuts; the existing installed app
may already own Alt-period while both copies are running.
The optional `--check-shortcuts` scenario needs a GPU. It dispatches registered
global shortcuts and native menu actions through Rune's headless host, with a
temporary document library. macOS app-targeted keypresses and menus were also
checked in the live window; a real desktop-wide keypress and Linux desktop
activation have not been verified by that test.

## What this establishes

The Mac window supports native text entry, Unicode paste, and save/reload. The
executable checks pass, and the same frontend passes Linux `cargo check`.
Parley's `complex-scripts` feature is enabled explicitly; without it the
Japanese-text scenario emitted missing-segmentation-model warnings.

This remains a prototype. The native rendering is an approximation of Draft's
glass, not a pixel-identical port. Concealed punctuation needs further checks
for cursor movement and selection around invisible source positions. It keeps
undo only for the current process, and does not implement Draft's spelling, full inline-image
editing, automatic refresh after sync, personal-feature builds, native updater, or distribution. Manual
screen-reader and real input-method checks are still needed. No comparative
performance claim has been established. Keep this experiment on its prototype
branch rather than releasing it as Draft.

See [the Anomaly findings](../../docs/anomaly-text-editing-research-2026-11-06.md)
for the source patterns and next decisions.
