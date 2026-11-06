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
macOS, 111 app tests, 37 host tests, TypeScript, and native formatting/Clippy.
Native formatting, Clippy, and the full headless interaction checks also pass in
a Debian ARM64 container with Rust 1.96.1 and Bun 1.4.3. This does not verify a
Linux desktop session or the new workflow on GitHub's runners.

`bun run web:dev` retains the browser preview; `bun run tauri:dev` retains the
previous desktop frontend. The published release still produces that frontend
until the native public-release gates below are satisfied.

## Migration implementation

| Area | Native implementation | Remaining verification or release gate |
| --- | --- | --- |
| Writing | Unicode editing, serialized saves, revision-aware sync, validated delta undo/redo across restart, preserved unknown metadata, and recovery | Real IME conversion, dictation, and concealed-source selection with assistive technology |
| Session | Appearance, source mode, sidebar expansion/visibility, selected versions, selection, scroll positions, and zoom persist | Extended daily-use checks across multiple displays and sessions |
| Media and text | Inline image geometry in one editor buffer; paste/drop, social crops, remembered originals, clipboard copy, rich-paste Markdown conversion, links, local spelling | Wayland file drops remain limited by upstream winit; use paste there |
| Sync | Clean remote refresh, dirty-buffer deferral, stale-client merge, older-ack protection, and recovery of unsaved writing after a remote move/delete | Real signed-in Linux keyring and multi-device desktop session |
| Models and features | Native settings, optional titles/summaries, protected host, offline native feature compilation/checks, activation confirmation, rollback, and independent recovery controls | A real provider sign-in/build session; the deterministic native update check passes on Mac |
| Desktop | Standalone host launcher, profile isolation, single instance, menu bar/tray actions, optional login launch, native menus and quick-capture handlers | Actual desktop-wide shortcut and activation on Linux; installed Draft may own Alt-period on this Mac |
| Packaging | macOS app with bundled Bun/helpers/source and signature verification; Linux portable archive; Mac host update helper | Developer ID/notarization, native release-channel configuration, and Linux full-host updater automation |

Automated verification now includes 111 app tests, 37 host tests, four Rust unit
checks, native interaction checks, and light/dark glass-color comparisons on Mac.
The native feature check edits Rust interface source, passes the real isolated
build gate, verifies activation, and rolls back without a model call. The Mac
standalone smoke test verifies launch, Unicode writing, new tabs, settings, and
quit in an isolated profile, including undo/redo after reopening. Linux ARM64
compilation, interaction checks, portable
packaging, and a real frame rendered with Mesa software Vulkan pass in Debian.
The Vulkan frame caught and fixed a half-float shader capability failure that
compilation and headless interaction checks did not expose.

A 120-frame optimized long-document sanity run on this Mac reported a 246 ms
first rendered frame and 0.38 ms p95 CPU time for forced idle frames. That is a
rendering sanity check, not an end-to-end typing benchmark or a comparison with
the previous renderer.

These are preview artifacts. Public release remains gated by the manual desktop,
input-method, accessibility, signing, and channel checks above. No installed
library was migrated and no release was published. `bun run native:build` prepares
the native package; the existing `desktop:build` release remains the previous
frontend until that gate is satisfied.

Linux implementation references: [Secret Service CLI](https://manpages.debian.org/bookworm/libsecret-tools/secret-tool.1.en.html),
[Hunspell protocol](https://manpages.debian.org/bookworm/hunspell/hunspell.1.en.html),
and [bubblewrap isolation](https://manpages.debian.org/bookworm/bubblewrap/bwrap.1.en.html).
Desktop shortcut quoting follows the [Desktop Entry specification](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html).
