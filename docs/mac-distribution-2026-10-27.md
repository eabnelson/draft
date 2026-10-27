# Mac distribution verification — October 27, 2026

Draft 0.2.0-alpha.20 is the first published Developer ID signed and Apple-notarized download. It targets Apple Silicon and macOS 13 or later.

The [release](https://github.com/eabnelson/draft/releases/tag/v0.2.0-alpha.20) contains a stapled disk image, a stapled application ZIP, editable source, authenticated update manifest, checksums, and distribution report. The app and embedded native executables use the same Developer ID team, hardened runtime, and secure timestamps. Bun alone receives its required JIT entitlement.

[The release build](https://github.com/eabnelson/draft/actions/runs/40564837700) passed 74 portable and 16 host checks, signed the app, and received Apple's approval for both the app and installer. [Fresh-Mac verification](https://github.com/eabnelson/draft/actions/runs/40568141850) then passed on a separate macOS runner without the release keychain or Apple credentials. Gatekeeper enforcement was enabled. It verified the exact authenticated downloads, Apple tickets, signatures, browser-style quarantine assessment, matching installer/updater binaries, installation, and first launch. The first document library opened in 1,860 ms.

That same fresh Mac ran 79 document and update integration checks using the shipped Bun and build tools, with system Node unavailable through normal tool lookup. Real personal builds, preserved features, explicit conflict choices, missing model access, and recovery checks passed.

The first launch test initially failed because its temporary path used macOS's /var symlink. Tauri intentionally refuses an executable launched through symlinked parents. Canonicalizing the test installation path fixed the failure without changing the signed app, disabling Gatekeeper, removing quarantine, or weakening Tauri's path checks. The already notarized candidate stayed private until the corrected test passed.

The installed alpha.18 app discovered the public update, downloaded and built the merge, displayed “Keeping Light & dark mode,” and applied alpha.20 through Restart to update. Native host and active source both reached alpha.20, activation completed, and the custom feature remained active. Both native document files and their library index matched the saved pre-update versions after excluding routine autosave timestamps. The previous working app remains available through Undo.

The public website’s Download for Mac link was clicked in the browser. Its downloaded DMG matched the signed release manifest’s checksum and size, passed stapled-ticket validation, and was accepted as Notarized Developer ID. The installed app passed the same Apple policy assessment after its in-app update.

The signed runtime also discovered the existing Claude Code and Codex installations and selected Claude Opus 5.5 by default. Signing credentials remain outside the repository and app resources; the local release keychain is locked. Original transcript, provenance, and initial specification checksums remain unchanged.
