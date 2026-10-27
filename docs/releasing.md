# Releasing Draft

The macOS application and editable application source ship together. Version values in package.json, features.json, Cargo.toml, tauri.conf.json, and the host version constant must agree.

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

A tagged release is first uploaded as a private draft. A separate fresh macOS runner, without the distribution keychain or Apple credentials, downloads the exact assets, verifies their Ed25519 signature and hashes, checks the stapled Apple tickets and Gatekeeper approval, copies the app from the disk image into Applications, adds browser-style quarantine metadata, and launches it with a new local profile. It also runs the document and official-update integration checks with the app’s bundled Bun and build tools, including real personal builds and conflict choices. It verifies the first document library and expected app version, then closes only its own test process. Only a successful check publishes the release and dispatches the website rebuild.

The website resolves the newest published Apple Silicon installer when it builds, ignoring private drafts and unexpected download addresses. If the release API is unavailable, it keeps a known download rather than constructing a link for a version that may not exist. After the first notarized release, advance that fallback to the verified version.

The supported public target is Apple Silicon. Intel requires its own Bun executable, matching native dependencies, signed package, and clean-runner test.

## Official app updates

The first supported automatic-update release is 0.2.0-alpha.18. Older installations require one manual install. After that, the app checks the repository release list automatically. Alpha installations follow prereleases; stable installations follow stable releases. Version ordering prevents downgrades. An unsupported release or failed network check never reports a false “up to date” result on a manual check.

After `bun run release:notarize` succeeds, `bun run release:prepare` packages the desktop ZIP, DMG, matching source archive with its built renderer, checksums, and `draft-update.json`. Set `DRAFT_UPDATE_SIGNING_KEY_PATH` to the private Ed25519 PEM key matching `update-public-key.pem`. The private key must remain outside the repository, source template, and app resources.

The manifest is a JSON envelope with `payload` (the exact serialized version-2 manifest) and its base64 Ed25519 `signature`. The signed payload binds the version, native-host version, bundle identity, architecture, release notes, source, desktop and installer URLs, sizes, and SHA-256 digests. Both downloads are verified before use. The separate native installer verifies the envelope and desktop archive again immediately before swapping apps. This update authentication is independent of Apple distribution signing.

Configure the repository secret `DRAFT_UPDATE_SIGNING_KEY` with that PEM key. Push a matching version tag (`v…`) after the main checks and the isolated installed-app test pass. The release workflow builds on Apple Silicon, notarizes, signs the manifest, and verifies a private draft on another Mac runner before publishing the prerelease. It reads the key only in the final signing step and deletes its temporary file. Never use an older manifest or source archive with a newer desktop build. For a stable release, remove the workflow’s prerelease flag after meeting the distribution requirements above.

The updater merges original official source, current personal source, and incoming official source. It preserves independent edits, prompts for overlapping features and dependency changes, and validates retained feature identities, enabled/removed states, personal checks, controller integrity, tests, and builds. Personal native/controller edits require a separately built package and cannot be silently replaced through the ordinary feature flow.

Applying waits for writing to save and quits the old host. A detached helper exchanges the app bundles on the same volume, launches the replacement, and waits for renderer confirmation. Failure restores the app and version pointers. Documents are never copied into an app build or rollback. One previous desktop bundle is retained for Undo; version source and document recovery files remain separate.

## Update verification

Run `bun run test` for portable editor and feature checks, `bun run test:host` for release authentication, merge/conflict, real candidate build, native installer and spelling checks, and `bun run desktop:build` for the complete native package. Personal updates run the portable suite using bundled tools; they do not compile Swift or require Xcode.

Before publishing an updater change, use an isolated data profile and signed local release feed to exercise automatic notice, multiple personal features, conflict choices, the actual native Restart control, saved writing, later queued ideas, a second launch, and Undo across a native-host change. Also test tampered downloads, missing model access, an interrupted preparation, and failed startup recovery. Keep test release feeds restricted to the `.update-check` application identifier. The production host does not accept a local release-feed configuration.
