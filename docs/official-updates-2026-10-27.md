# Official updates — October 27, 2026

Implemented for macOS Apple Silicon in 0.2.0-alpha.18. Installations older than this need one desktop download to bootstrap the updater. Later official updates are discovered and prepared inside Draft.

## Writer experience

The header announces an available update. Preferences describes it and offers Download update. Independent personal changes are kept automatically. Overlapping changes appear as high-level feature choices: Keep mine, Use Draft’s, or Combine both. Integration uses the writer’s connected model where needed. The current app remains available until the verified candidate is ready and the writer chooses Restart to update.

The desktop menu always offers Check for Updates, including when a personal renderer predates these controls. Undo last update returns to the previous working app. Returning to official Draft and removing personal features retain the same explicit update interaction. Writing and queued ideas are outside application version folders.

## Automated verification

The portable suite has 74 passing checks. The host suite has 12 passing checks covering signed release discovery, forged metadata, version ordering, three-way source merging, personal removals, dependency conflicts, explicit replacement of one feature while keeping another, real candidate tests and builds, cancellation, missing model access, retained personal checks, interrupted installation, native app replacement, changed archive rejection, failed startup recovery, and native Undo. Native installer checks compile and sign disposable macOS application bundles and execute the actual helper; source update integration uses real files, archives, builds, and document storage. Only the external model boundary is supplied deterministically in those automated checks.

The desktop package builds successfully. The original transcript, initial product specification, and provenance checksums still match their preserved copies.

## Installed-app end-to-end verification

A separate `.update-check` desktop app used an isolated profile and a locally served, Ed25519-signed release with matching source and native app assets. No real writing files were used. The real Claude Opus 5.5 connection handled integration.

1. Started from the prior personal renderer with two custom features: System/Light/Dark appearance and reading time. Kept one later idea queued.
2. The app discovered the newer signed prerelease automatically. The native menu opened the host-owned update screen and saved writing before leaving the editor.
3. Downloaded the source and native archive. Both custom features appeared as conflicts. Chose Keep mine for both and continued.
4. Claude integrated the new official behavior while retaining both custom features. The candidate passed 84 portable and personal checks, TypeScript, renderer build, and runtime build without changing the active app.
5. Clicked the actual Restart to update button. The helper replaced the native bundle and opened the candidate; startup confirmed the new official baseline and personal source version.
6. Confirmed the new official behavior, working appearance menu, and reading-time display together. The saved draft and queued idea remained intact.
7. Added a new paragraph after updating. Chose Undo last update and Restart to update. The native host and personal renderer returned to the previous version, retaining that newly written paragraph, both custom features, and the later queued idea.

Local proof screenshots and the disposable profile are stored outside the repository. They are not bundled with downloads.

## Limits

This is still an ad-hoc-signed alpha, without Developer ID notarization or Intel packaging. Update manifests authenticate official app/source downloads independently of Apple distribution signing. A connected model and its available access are needed for overlapping behavior that cannot merge automatically. Checks can reject broken integrations; they cannot prove every generated feature has the intended semantics. Personal changes to the native host/controller require a separately packaged app and are not silently discarded by this flow.
