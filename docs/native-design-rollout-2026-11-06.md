# Native Draft: approved design and rollout

Date: November 6, 2026
Status: Erik approved continuing with the Rune design after reviewing the native app.

## Direction

Use the native Rune interface as Draft's design and development baseline for macOS
and Linux. Continue from the reviewed implementation in
[`native/rune-prototype`](../native/rune-prototype/README.md). Its existing directory,
preview profile, and app identity are retained so this change does not move writing
or create another experimental library.

Keep Draft's Markdown packages and the existing Bun document, sync, and update
services. The [Draft 2 product baseline](draft-2-spec-2026-10-31.md) still applies;
an incomplete native feature remains migration work rather than a product removal.

## Approved interface

- Rounded glass selection around the selected draft and its expanded versions,
  with a quieter inset background for the versions.
- Joined glass version tabs with scooped necks. Only the tab silhouette blurs
  writing beneath it. The surrounding header stays clear, and tab positions and
  material colors stay steady while changing drafts or versions.
- Glass context menus that target the clicked draft or version and stay near
  the click, flipping at window edges.
- Settings uses the writing view's sidebar, floating header, and spacing. The
  bottom gear becomes a joined chevron-and-Back control in the same position.
- Status is colored text. A sync button appears only when sync needs attention
  and goes directly to Sync settings.
- Light, Dark, and System have illustrated workspace previews, a glass selection
  edge, and keyboard selection. The layout adapts to the available width.
- Shortcuts use physical-looking keycaps in a responsive grid. The caret matches
  the writing color and blinks, restarting when typing or moving it.
- Preserve the restored keyboard commands, including new/close/switch version,
  numbered draft navigation, Settings, sidebar, zoom, and global quick capture.

## Development

`bun run dev` and `bun run desktop:dev` now launch this native interface, with its
authenticated local document host. `bun run native:dev` is the explicit native
entry point. Existing `rune:*` commands remain compatible.

The preview continues using `native/rune-prototype/scratch`, separate from the
installed app's data. Its drafts, screenshots, and generated app bundles are
excluded from source copies and source hashes used by personal updates and
packaging. The shared source functions have a regression check for that boundary.

`bun run native:check` runs the native interaction and storage checks using a
temporary library. The Check workflow is configured to run native formatting,
Clippy, and those checks on macOS and Linux. GPU rendering and real desktop
integration require separate verification.

Verified locally on November 6: the default native launch and headless checks on
macOS, 110 app tests, 36 host tests, TypeScript, and native formatting/Clippy.
Native formatting, Clippy, and the full headless interaction checks also pass in
a Debian ARM64 container with Rust 1.96.1 and Bun 1.4.3. This does not verify a
Linux desktop session or the new workflow on GitHub's runners.

`bun run web:dev` retains the browser preview; `bun run tauri:dev` retains the
previous desktop frontend. The existing release build and updater still produce
that frontend until native distribution and feature parity are implemented.

## Migration work

| Area | Current native state | Work before the native release |
| --- | --- | --- |
| Writing and versions | Native buffers, editing, independent undo during the process, saves, recovery, version menus, and shortcuts | Persist undo across restarts; verify concealed Markdown caret/selection behavior with real input methods |
| Preferences and navigation | Appearance choices, Settings sections, and persisted window zoom | Persist appearance and other preferences; preserve draft/version navigation and scroll state across the required lifetimes |
| Media and links | Image paste stores media and displays previews below the text | Restore inline media editing, social crops, file drops, rich paste, links, spelling, and the remaining Draft 2 writing interactions |
| Sync | Existing sync engine and isolated sign-in settings | Reconcile remote changes into open native buffers without overwriting typing; complete settings parity and Linux credentials/opening |
| Personal and official updates | Existing services and previous frontend retained | Native Features/model settings, verified native build/activation, save-before-restart, rollback, and host-owned recovery controls |
| Desktop and distribution | Mac development app, native menus, quick-capture handlers; Linux build and headless checks pass | Self-contained launch with its host, login/tray behavior, real desktop-wide shortcut and activation checks, Linux GUI/accessibility checks, packaging, signing, and updater integration |
| Quality | Native interaction checks pass on Mac and in a Linux container; light/dark GPU comparisons pass on Mac | Representative launch/typing/scroll/idle measurements, long-document checks, manual screen-reader/input-method verification, and both-platform release verification |

Start with writing/session durability and preferences, then live sync and media,
then personal-update and distribution integration. These are the next engineering
steps on the approved design; the design experiment is no longer an open choice
between Rune and the previous renderer.
