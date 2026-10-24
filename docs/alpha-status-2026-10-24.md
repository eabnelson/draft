# Alpha status — October 24, 2026

The accepted product baseline describes the intended product. This first alpha is a testable implementation, rather than a declaration that every release criterion is finished.

## Verified

- The macOS Apple Silicon application builds and opens with a bundled local runtime and editable source.
- Twenty-three document/model/controller checks pass, including archive recovery, failed-save protection, explicit activation, rollback, and rejection of modified candidates.
- A real Claude Opus 5.5 request added reading time, passed independent checks, and was applied with Update app. Removing that feature and returning to official Draft used the same interaction. The document contents survived all three updates.
- Both installed providers returned authenticated writing responses. Codex writing requests were also tested inside the restricted process.
- Native typing, reopening, window closing, and Quit were checked. The native Quit path now waits for a save acknowledgment; the last text was verified on disk while the editor had still shown Saving.
- Original transcript and initial-spec checksums match their archived copies.

## Remaining release work

- Developer ID signing, notarization, and stapling for a trusted consumer download. The alpha is ad-hoc signed.
- Performance budgets and measurements across representative Macs, Intel packaging, and broader accessibility verification.
- A live official-release synchronization/conflict test with multiple personal features. The signature verification and integration path exist, but the first alpha is not a stable release to offer through that channel.
- English article assistance from the optional P1 scope is not implemented yet.
- Native-shell/controller customization needs a full desktop package; the in-app builder currently supports renderer and local-runtime changes.

Automated checks cannot establish that every generated feature is semantically correct. Preparation failures retain the current app; document files remain outside the version directories.
