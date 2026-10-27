# Releasing Draft

The macOS application and editable application source ship together. Version values in package.json, features.json, Cargo.toml, tauri.conf.json, and the host version constant must agree.

## Build and verify

Use the locked dependencies, run `bun run test`, then `bun run desktop:build`. Verify first launch, local saving, connected-provider discovery, one real feature update, removal, reset, and reopening a saved document. A release must preserve the original transcript and initial specification checksums.

The current alpha targets Apple Silicon. Intel builds need an x86_64 Bun binary and matching native npm packages in their resources; changing only the Rust target is insufficient.

## macOS distribution

A public consumer release needs a Developer ID Application certificate, hardened runtime signing, notarization, and stapling. Supply `APPLE_SIGNING_IDENTITY` and the notarization credentials supported by the Tauri CLI through protected release secrets. Sign embedded executables and native libraries as well as the outer bundle. Never commit credentials or export a signing key into the source template.

Without those credentials, the build is an explicitly labeled, ad-hoc-signed alpha. It is useful for development and local testing, but does not satisfy the one-click, trusted download release criterion. Do not describe it as notarized or ask users to disable macOS security protections.

## Official app updates

The first supported automatic-update release is 0.2.0-alpha.18. Older installations require one manual install. After that, the app checks the repository release list automatically. Alpha installations follow prereleases; stable installations follow stable releases. Version ordering prevents downgrades. An unsupported release or failed network check never reports a false “up to date” result on a manual check.

`bun run release:prepare` packages the desktop ZIP, DMG, matching source archive with its built renderer, checksums, and `draft-update.json`. Set `DRAFT_UPDATE_SIGNING_KEY_PATH` to the private Ed25519 PEM key matching `update-public-key.pem`. The private key must remain outside the repository, source template, and app resources.

The manifest is a JSON envelope with `payload` (the exact serialized version-2 manifest) and its base64 Ed25519 `signature`. The signed payload binds the version, native-host version, bundle identity, architecture, release notes, source and desktop URLs, sizes, and SHA-256 digests. Both downloads are verified before use. The separate native installer verifies the envelope and desktop archive again immediately before swapping apps. This update authentication is independent of Apple distribution signing.

Configure the repository secret `DRAFT_UPDATE_SIGNING_KEY` with that PEM key. Push a matching version tag (`v…`) after the main checks and the isolated installed-app test pass. The release workflow builds on Apple Silicon, signs the manifest, and uploads matching assets to one prerelease. It reads the key only in the final signing step and deletes its temporary file. Never use an older manifest or source archive with a newer desktop build. For a stable release, remove the workflow’s prerelease flag after meeting the distribution requirements above.

The updater merges original official source, current personal source, and incoming official source. It preserves independent edits, prompts for overlapping features and dependency changes, and validates retained feature identities, enabled/removed states, personal checks, controller integrity, tests, and builds. Personal native/controller edits require a separately built package and cannot be silently replaced through the ordinary feature flow.

Applying waits for writing to save and quits the old host. A detached helper exchanges the app bundles on the same volume, launches the replacement, and waits for renderer confirmation. Failure restores the app and version pointers. Documents are never copied into an app build or rollback. One previous desktop bundle is retained for Undo; version source and document recovery files remain separate.

## Update verification

Run `bun run test` for portable editor and feature checks, `bun run test:host` for release authentication, merge/conflict, real candidate build, native installer and spelling checks, and `bun run desktop:build` for the complete native package. Personal updates run the portable suite using bundled tools; they do not compile Swift or require Xcode.

Before publishing an updater change, use an isolated data profile and signed local release feed to exercise automatic notice, multiple personal features, conflict choices, the actual native Restart control, saved writing, later queued ideas, a second launch, and Undo across a native-host change. Also test tampered downloads, missing model access, an interrupted preparation, and failed startup recovery. Keep test release feeds restricted to the `.update-check` application identifier. The production host does not accept a local release-feed configuration.
