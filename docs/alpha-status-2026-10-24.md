# Alpha status — October 24, 2026

Update: the official release synchronization, conflict resolution, and native recovery flow were implemented and tested on October 27. See [the dated verification](official-updates-2026-10-27.md).

The accepted product baseline describes the intended product. This first alpha is a testable implementation, rather than a declaration that every release criterion is finished.

## Verified

- The macOS Apple Silicon application builds and opens with a bundled local runtime and editable source.
- Forty-one document/model/controller checks pass, including archive recovery, failed-save protection, explicit activation, rollback, and rejection of modified candidates.
- A real Claude Opus 5.5 request added reading time, passed independent checks, and was applied with the explicit update control. Removing that feature and returning to official Draft used the same interaction. The document contents survived all three updates.
- The same real feature preparation and application also passed in the installed desktop app using its bundled build tools.
- Both installed providers returned authenticated writing responses. Codex writing requests were also tested inside the restricted process.
- Native typing, reopening, window closing, and Quit were checked. The native Quit path now waits for a save acknowledgment; the last text was verified on disk while the editor had still shown Saving.
- A real two-feature batch through Claude Opus 5.5 created reading time and focus mode together in 144 seconds. Both passed the independent checks. The native Restart to update reopened the process with both features, retained saved writing, and kept an idea added after the download for a later update. Focus and Escape were checked in the restarted app. Returning to official Draft also restarted successfully while preserving the document and later idea.
- The repo website runs the actual editor and Features UI in an isolated in-memory demo. Its looping tour reaches both working example features; generation is labeled as sped up and simulated.
- Original transcript and initial-spec checksums match their archived copies.

## Remaining release work

- Developer ID signing, notarization, and stapling for a trusted consumer download. The alpha is ad-hoc signed.
- Performance budgets and measurements across representative Macs, Intel packaging, and broader accessibility verification.
- English article assistance from the optional P1 scope is not implemented yet.
- Native-shell/controller customization needs a full desktop package; the in-app builder currently supports renderer and local-runtime changes.

Automated checks cannot establish that every generated feature is semantically correct. Preparation failures retain the current app; document files remain outside the version directories.
