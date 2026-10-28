# Releasing Draft

The macOS application and editable application source ship together. Version values in package.json, features.json, Cargo.toml, Cargo.lock, tauri.conf.json, and the host version constant must agree.

## Automatic releases from main

Every push to `main` runs **Check**, including the full homepage walkthrough on desktop, mobile and compact landscape. A successful push starts **Release Mac app** for that exact checked commit. Failed checks, pull requests, forks, and superseded main heads cannot start a release. Rapid pushes can be combined into the newest checked main head; all included changes ship together.

The preparation script reserves the next `alpha.N` version above every existing version tag, including unpublished candidates. It creates a release commit with the checked main commit as its only parent and stamps all six version locations together. Only the release tag points to that commit: main is never rewritten or given a recursive bot version commit. Retrying preparation reuses the same release commit; an already public release is skipped. The current run builds the generated tag directly, because tags created with `GITHUB_TOKEN` do not trigger another workflow.

The signing, notarization, authenticated manifest, and separate clean-Mac installation gates below remain mandatory. A failed candidate stays private. Only after all gates pass is the update published and the website rebuilt from that release tag. Installed alpha users discover it on launch, when returning to the app, or during the six-hour background check. Updates remain optional; personal changes use the existing merge and conflict choices, and writing stays outside app versions.

`main` currently follows the alpha channel. Stable releases remain explicit version tags. Before beginning a new release series after a stable version, advance main's package baseline to that series with `bun scripts/release-version.ts 0.3.0-alpha.1` (substitute the intended version). Automatic preparation refuses to issue a version below a later stable tag.

Keep `release-notes.json` consumer-friendly and current. Run `bun run demo:check` before pushing; see [demo maintenance](demo-maintenance.md). Main's package version is a baseline, while each generated release tag contains the exact shipped version.

## Build and verify

Use the locked dependencies, run `bun run test`, then `bun run desktop:build`. Verify first launch, local saving, connected-provider discovery, one real feature update, removal, reset, and reopening a saved document. A release must preserve the original transcript and initial specification checksums.

The current alpha targets Apple Silicon. Intel builds need an x86_64 Bun binary and matching native npm packages in their resources; changing only the Rust target is insufficient.

## macOS distribution

Public releases require a Developer ID Application certificate and Apple notarization. Local development builds can still use ad-hoc signing; `release:prepare` refuses an ad-hoc or unstapled app. The source transcript and initial specification remain immutable.

The release workflow imports an encrypted PKCS#12 identity into an ephemeral keychain. It signs every embedded Mach-O tool and library before signing the app. Only Bun receives the JIT entitlement needed for JavaScript; no library-validation or debugging exceptions are added. The runtime, helper tools, and app must use the same release team, hardened runtime, and secure timestamps.

Notarization submits a ZIP containing the signed app, waits for Apple's acceptance, and staples the ticket to the app. It then creates and signs a disk image containing that stapled app and an Applications shortcut, notarizes the disk image, and staples its ticket. Re-running `bun run release:notarize` resumes a matching recorded submission; a changed signed app produces a new submission. Both distribution formats are checked before the authenticated update manifest is produced. The manifest also binds the disk image's checksum and size.

Required GitHub secrets:

- `APPLE_CERTIFICATE`: base64 PKCS#12 containing the release identity and intermediate certificate chain.
- `APPLE_CERTIFICATE_PASSWORD`: its high-entropy export password.
- `APPLE_API_PRIVATE_KEY`: the dedicated notarization API key's PEM contents.
- `DRAFT_UPDATE_SIGNING_KEY`: the existing Ed25519 update-signing key.

Required repository variables: `APPLE_TEAM_ID`, `APPLE_SIGNING_IDENTITY` (the certificate fingerprint), `APPLE_API_KEY`, and `APPLE_API_ISSUER`. Signing material is written only into the runner's temporary directory and is removed after use. No credentials belong in the repo, editable source, or app resources. Personal feature builders are denied access to the local Draft signing folder and App Store Connect private keys.

A tagged release is first uploaded as a private draft. A separate fresh macOS runner, without the distribution keychain or Apple credentials, downloads the exact assets, verifies their Ed25519 signature and hashes, checks the stapled Apple tickets and Gatekeeper approval, copies the app from the disk image into Applications, adds browser-style quarantine metadata, and launches it with a new local profile. It also runs the document and official-update integration checks with the app’s bundled Bun and build tools, including real personal builds and conflict choices with system Node unavailable on PATH. It verifies the first document library and expected app version, then closes only its own test process. Only a successful check publishes the release and dispatches the website rebuild.

If only the verification harness needs repair after a candidate has already been signed and notarized, keep the candidate private and retry with `gh workflow run release.yml --ref main -f verify_existing=true -f tag=v0.2.0-alpha.21` (substitute the existing candidate tag). The current verification harness is locally stamped with that candidate's version; no new package is built. This downloads the existing artifacts onto a new Mac without importing signing credentials. All verification gates still run before publication. Changes to shipped application code require a new version and a full release build. The temporary installation path is canonicalized because Tauri intentionally refuses to launch a Mac executable through symlinked parents.

The website resolves the newest published Apple Silicon installer when it builds, ignoring private drafts and unexpected download addresses. If the release API is unavailable, it keeps a known download rather than constructing a link for a version that may not exist. The known fallback is the verified alpha.20 installer. Advance it after publishing later verified releases.

The supported public target is Apple Silicon. Intel requires its own Bun executable, matching native dependencies, signed package, and clean-runner test.

## Official app updates

The first supported automatic-update release is 0.2.0-alpha.18. Older installations require one manual install. After that, the app checks the repository release list automatically. Alpha installations follow prereleases; stable installations follow stable releases. Version ordering prevents downgrades. An unsupported release or failed network check never reports a false “up to date” result on a manual check.

After `bun run release:notarize` succeeds, `bun run release:prepare` packages the desktop ZIP, DMG, matching source archive with its built renderer, checksums, and `draft-update.json`. Set `DRAFT_UPDATE_SIGNING_KEY_PATH` to the private Ed25519 PEM key matching `update-public-key.pem`. The private key must remain outside the repository, source template, and app resources.

The manifest is a JSON envelope with `payload` (the exact serialized version-2 manifest) and its base64 Ed25519 `signature`. The signed payload binds the version, native-host version, bundle identity, architecture, release notes, source, desktop and installer URLs, sizes, and SHA-256 digests. Both downloads are verified before use. The separate native installer verifies the envelope and desktop archive again immediately before swapping apps. This update authentication is independent of Apple distribution signing.

Configure the repository secret `DRAFT_UPDATE_SIGNING_KEY` with that PEM key. Main releases reserve their matching version tag automatically after checks pass; a matching explicit `v…` tag is also supported. The release workflow builds on Apple Silicon, notarizes, signs the manifest, and verifies a private draft on another Mac runner before publishing the prerelease. It reads the key only in the final signing step and deletes its temporary file. Never use an older manifest or source archive with a newer desktop build. For a stable release, remove the workflow’s prerelease flag after meeting the distribution requirements above.

The updater merges original official source, current personal source, and incoming official source. It preserves independent edits, prompts for overlapping features and dependency changes, and validates retained feature identities, enabled/removed states, personal checks, controller integrity, tests, and builds. Personal native/controller edits require a separately built package and cannot be silently replaced through the ordinary feature flow.

Applying waits for writing to save and quits the old host. A detached helper exchanges the app bundles on the same volume, launches the replacement, and waits for renderer confirmation. Failure restores the app and version pointers. Documents are never copied into an app build or rollback. One previous desktop bundle is retained for Undo; version source and document recovery files remain separate.

## Update verification

Run `bun run test` for portable editor and feature checks, `bun run test:host` for release authentication, merge/conflict, real candidate build, native installer and spelling checks, and `bun run desktop:build` for the complete native package. Personal updates run the portable suite using bundled tools; they do not compile Swift or require Xcode.

Before publishing an updater change, use an isolated data profile and signed local release feed to exercise automatic notice, multiple personal features, conflict choices, the actual native Restart control, saved writing, later queued ideas, a second launch, and Undo across a native-host change. Also test tampered downloads, missing model access, an interrupted preparation, and failed startup recovery. Keep test release feeds restricted to the `.update-check` application identifier. The production host does not accept a local release-feed configuration.
