# Draft's native development app

This is the approved design and native development direction for Draft, as of
November 6, 2026. It keeps the existing Markdown document store and Bun services.
See the [rollout](../../docs/native-design-rollout-2026-11-06.md) for the agreed
interface and remaining product migration work. The directory and isolated
preview profile keep their existing names so current preview writing stays in place.

Run from the repository root with Bun, Rust, and Cargo installed:

```sh
bun run dev
```

The first run downloads and builds the pinned Rust dependencies. On macOS the
launcher creates a development app bundle and opens its native window. Start it
with this command so the Bun document host runs alongside it. Close the native
window when finished. To try an optimized build, use `bun run dev --release`.
`bun run desktop:dev` and `bun run native:dev` open the same app; `rune:*`
commands remain available for existing scripts.

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
- Paste or drop an image. It becomes a Markdown reference with an inline preview
  between paragraphs. Click the image to choose a social size, drag its framing,
  zoom, save the crop, or copy the image. The original remains available for
  re-cropping. Image insertion is one undo step. If typing continues while the
  image saves, it inserts at the current caret in the original version.
- Choose **Settings → Files → Reload files** to read the saved `.draft` packages. Equal text retains
  the live editor's selection and undo history.
- The gear opens Settings, including Appearance, Editor, Files, Sync, Shortcuts,
  Model, Features, and Updates, using the writing view's sidebar cards and floating glass headers.
  Cmd/Ctrl-comma opens it too; Escape or the bottom chevron-and-Back tab returns
  to the editor. Appearance offers system/light/dark, and Editor offers **Show Markdown**. The initial
  appearance follows the system, with Markdown punctuation
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
credential is separate from the installed app. Sign-in uses macOS Keychain or
Linux Secret Service. Remote changes refresh clean buffers; edits in progress
are preserved and merged when saved.

## Disposable data and checks

Writing lives under `native/rune-prototype/scratch/Drafts/`, separate from the
installed app. `DRAFT_RUNE_DATA_ROOT` selects another experimental library.
The launcher uses a random loopback port and a per-launch authorization token.

```sh
bun run native:check
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

Linux compilation, formatting, Clippy, and the full headless interaction checks
pass in the official `rust:1.96.1-bookworm` ARM64 container with Bun 1.4.3,
`pkg-config`, `libxkbcommon-dev`, and `libwayland-dev` installed. Running a
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
executable checks pass on Mac and in a Linux container.
Parley's `complex-scripts` feature is enabled explicitly; without it the
Japanese-text scenario emitted missing-segmentation-model warnings.

Writing history, selection, appearance, navigation, and scroll positions persist
across restart. Rich paste becomes Markdown. Links can be added, edited, opened,
and removed from the text menu. Local spelling uses macOS dictionaries or Linux
Hunspell. Sync refreshes clean buffers and merges stale saves; concurrent writing
survives a remote archive or deletion. Automatic model titles and summaries are
optional under Editor and remain off until enabled.

## Standalone packages

```sh
bun run native:build
```

This produces `artifacts/Draft Native.app` on macOS or a Linux portable directory
and archive. The package contains its own Bun host, native renderer, build source,
dependencies, and independent update controls. It launches without a development
server. macOS packages are ad-hoc signed unless `APPLE_SIGNING_IDENTITY` is set.
`--installer` also creates a macOS DMG; public distribution still requires
Developer ID signing and notarization.

On Linux, unpack the archive and run `Draft-Native/bin/draft`. Optionally run
`Draft-Native/install-desktop` to add a shortcut at that unpacked location, or
`Draft-Native/install-desktop --uninstall` to remove it. After moving the folder,
run the installer again. This does not enable launch at login.
Use a folder without literal backslashes: Bun 1.4.3 interprets them as path
separators when loading its host script, including on Linux.

The package uses `~/Library/Application Support/Draft Native` on Mac or
`${XDG_DATA_HOME:-~/.local/share}/draft-native` on Linux. Override with
`DRAFT_NATIVE_DATA_ROOT` or `--profile PATH`. This intentionally leaves the installed
Draft profile separate. A second launch activates the existing process. Files
settings controls the menu bar/tray icon and optional launch at login.

Linux needs `xdg-utils` for links, `libsecret-tools` and an unlocked Secret Service
keyring for sync credentials, and Hunspell with a language dictionary for spelling.
Personal native builds need the pinned Rust toolchain, cached Cargo dependencies,
and `bubblewrap` with user namespaces enabled on Linux. Builds use an isolated
filesystem and loopback-only networking for local test hosts. The additional
`bun native/rune-prototype/checks/update.ts` check exercises a real native feature
build, verification, activation, and rollback without contacting a model.

The framework extension for inline media and Mesa rendering is documented under
[`native/vendor`](../vendor/README.md). Manual screen-reader, real input-method,
desktop-wide quick capture, and Linux desktop activation checks still gate a
public native release. Linux full-host upgrades currently require downloading
the portable package; the existing signed Mac host installer is reused on Mac.
The existing published release channel remains unchanged until native release
verification and distribution-channel configuration are complete.

See [the Anomaly findings](../../docs/anomaly-text-editing-research-2026-11-06.md)
for the source patterns that informed the native editor.
