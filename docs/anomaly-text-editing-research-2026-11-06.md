# Learning from Anomaly's text editing

Research date: November 6, 2026. Sources were read directly from Anomaly's public
repositories. The Rune prototype pins commit
[`7ead7d63`](https://github.com/anomalyco/rune/commit/7ead7d63fcf6f9dd9669385a8b90e2ae80015d7b).
Other links describe the branches inspected on this date.

## Findings worth applying

### OpenCode: protect the user's live editing state

OpenCode's desktop/web composer uses Solid and a custom editable DOM. Its editor
sync machine distinguishes local input from store updates, including a special
case that preserves blank lines when the stored prompt normalizes to empty.
An equal echo does not redraw the editor. Its tests explicitly cover keeping
native undo and preserving line breaks. The useful lesson for Draft is to avoid
replacing a live editor buffer just because persistence acknowledged a change.
[Editor](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/composer/editor/editor.tsx),
[sync machine](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/composer/editor/machine.ts),
[regression cases](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/composer/editor/machine.test.ts).

The interaction code yields shortcuts to IME composition, including Safari's
key-code-229 cases. Its paste path normalizes line endings and inserts multiline
text as one operation to avoid repeated parsing and preserve undo. These are
behavioral requirements for either Draft frontend.
[Composition and paste handling](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/composer/editor/interaction.ts).

Its composer persistence also keys state by draft/session identity. That supports
the decision to retain a distinct editor model for each Draft version, rather
than reuse one model and replace its text when switching.
[Persistence](https://github.com/anomalyco/opencode/blob/dev/packages/app/src/composer/persistence.tsx).

Applied in the prototype: per-version buffers; equality checks on reload;
generation guards against stale loads; composition-safe formatting and Return;
and executable checks for undo and edits arriving during a save.

### OpenTUI: separate text from the viewport

OpenTUI's `EditBuffer` owns editing operations and exposes distinct replacement
operations that reset or preserve history. Its `EditorView` separately owns
viewport and wrapping behavior. This is useful architecture to study for
selection, grapheme operations, scrolling, and editor regression tests, even
though its renderer targets terminals.
[Edit buffer](https://github.com/anomalyco/opentui/blob/main/packages/core/src/edit-buffer.ts),
[editor view](https://github.com/anomalyco/opentui/blob/main/packages/core/src/editor-view.ts),
[project scope](https://github.com/anomalyco/opentui).

Applied in the prototype: one Rune `TextEdit` per version, stable keys for each
scroll viewport, and cached Markdown decorations independent of document text.
No OpenTUI runtime or terminal rendering dependency was added.

### Hex: native clipboard and platform behavior deserve their own work

Hex is Anomaly's local dictation app for Mac, Windows, and Linux. Its Mac paste
implementation records clipboard revisions and generations around restoration;
its platform paths use OS data locations and a separate test-build profile.
It is a particularly relevant source for a future dictation feature and for
learning how native text delivery differs between platforms.
[Hex overview](https://github.com/anomalyco/hex),
[paste implementation](https://github.com/anomalyco/hex/blob/dev/src/paste.rs),
[application paths](https://github.com/anomalyco/hex/blob/dev/src/app_paths.rs).

For Draft, use these as requirements to investigate: preserve the clipboard,
respect the focused target, isolate development data, and verify OS behavior
separately. Integrating dictation is outside this prototype.

### Rune: reuse its editor mechanics, verify Draft's behavior

Rune supplies text-editing state, rich clipboard input, IME events, decoration
spans, accessibility, and headless input/rendering tools. The prototype uses its
plain editor with source-based decorations so existing Markdown stays intact.
It uses an image-paste hook to save through Draft's store before inserting the
reference. [Rich clipboard example](https://github.com/anomalyco/rune/blob/7ead7d63fcf6f9dd9669385a8b90e2ae80015d7b/examples/rich-clipboard/src/main.rs),
[editor source](https://github.com/anomalyco/rune/blob/7ead7d63fcf6f9dd9669385a8b90e2ae80015d7b/crates/rune/src/edit.rs),
[accessibility source](https://github.com/anomalyco/rune/blob/7ead7d63fcf6f9dd9669385a8b90e2ae80015d7b/crates/rune/src/a11y/mod.rs).

One concrete issue found during evaluation: the pinned Rune dependency enables
Parley's `std` feature without `complex-scripts`. The synthetic Japanese editing
scenario emitted missing-segmentation-model warnings. Enabling that feature in
[the prototype manifest](../native/rune-prototype/Cargo.toml) removed the warnings
on rerun. This does not establish complete language support or replace testing
with actual input methods.
[Pinned dependency configuration](https://github.com/anomalyco/rune/blob/7ead7d63fcf6f9dd9669385a8b90e2ae80015d7b/crates/rune/Cargo.toml#L69).

## Other useful leads

- OpenCode's internal `@opencode/patchmark` package exports incremental Markdown
  streams, block patches, and incomplete-inline healing. It is worth studying
  if Draft adds streamed writing suggestions. It is marked private, so treat it
  as source to learn from rather than a supported public dependency.
  [Exports](https://github.com/anomalyco/opencode/blob/dev/packages/patchmark/src/index.ts),
  [manifest](https://github.com/anomalyco/opencode/blob/dev/packages/patchmark/package.json).
- **Rift** provides copy-on-write workspaces using APFS on macOS and supported
  Linux filesystems. It could be relevant to speeding Draft's personal-feature
  preparations. Workspace snapshots do not replace process isolation or document
  recovery. It is early software and was not integrated.
  [Rift](https://github.com/anomalyco/rift).
- **Text.js** renders applications in the browser console. Despite the name,
  it is not a prose-editor engine and is a lower-priority reference for Draft.
  [Text.js](https://github.com/anomalyco/textjs).

## Evaluation result and next decision

[The runnable prototype](../native/rune-prototype/README.md) establishes a small
native frontend over Draft's existing store. Mac GUI checks verified text entry,
Unicode paste, and save/reload. Executable runtime checks cover editing, IME
events, joined emoji, independent undo, save concurrency, media, and accessible
names. Rust compilation also passed in a Debian Linux container.

Keep the current application on Tauri while evaluating the remaining writing
requirements: cursor behavior around concealed Markdown punctuation, truly inline
images, durable undo across restarts, spelling, real IME and screen-reader
behavior, and X11/Wayland interaction. A Rust personal-feature build and rollback
path also remains necessary. The prototype does not settle memory, latency, or
startup comparisons; those require representative, optimized builds measured
on the same machines.
