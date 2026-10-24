# Releasing Draft

The macOS application and editable application source ship together. Version values in package.json, features.json, Cargo.toml, tauri.conf.json, and the host version constant must agree.

## Build and verify

Use the locked dependencies, run `bun run test`, then `bun run desktop:build`. Verify first launch, local saving, connected-provider discovery, one real feature update, removal, reset, and reopening a saved document. A release must preserve the original transcript and initial specification checksums.

The current alpha targets Apple Silicon. Intel builds need an x86_64 Bun binary and matching native npm packages in their resources; changing only the Rust target is insufficient.

## macOS distribution

A public consumer release needs a Developer ID Application certificate, hardened runtime signing, notarization, and stapling. Supply `APPLE_SIGNING_IDENTITY` and the notarization credentials supported by the Tauri CLI through protected release secrets. Sign embedded executables and native libraries as well as the outer bundle. Never commit credentials or export a signing key into the source template.

Without those credentials, the build is an explicitly labeled, ad-hoc-signed alpha. It is useful for development and local testing, but does not satisfy the one-click, trusted download release criterion. Do not describe it as notarized or ask users to disable macOS security protections.

## Official source updates

`bun run release:prepare` creates a source archive including its built renderer, and a `draft-update.json` manifest. Set `DRAFT_UPDATE_SIGNING_KEY_PATH` to the private Ed25519 PEM key matching `update-public-key.pem`. Store that private key outside the repository and source template. The manifest signs the archive's SHA-256 digest. The desktop host verifies both before unpacking.

Upload the source archive, manifest, and desktop download to the corresponding GitHub release. Source-update signing is independent of Apple signing. A source update may modify the renderer and `src/runtime.ts`; native-host changes need a desktop release.

Use a prerelease tag for unnotarized or incomplete alpha builds. Draft's official update check follows the latest non-prerelease release, so test builds are not silently offered as stable updates.
