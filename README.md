# Draft

Write it, version it, post it.

Draft is a Mac app for writing drafts for social. Open a new draft from anywhere, keep every version side by side, and track where each one went live. Ask your connected coding agent for a feature, then apply the finished work with **Restart to update**.

**macOS first · MIT · Draft 2.0 in progress**

[Draft 2.0 spec — October 31, 2026](docs/draft-2-spec-2026-10-31.md) · [Official update flow and end-to-end verification](docs/official-updates-2026-10-27.md) · [Download the latest build](https://github.com/eabnelson/draft/releases)

## Use Draft

Use **Download for Mac** on [the website](https://draft.studiofour.io/), open the disk image, and drag Draft to Applications. Apple Silicon and macOS 13 or later are required. Public releases must pass Developer ID signing, Apple notarization, and a fresh-Mac installation check before publication. Older alpha downloads remain in the release history. Building from source is supported below.

On Linux, use **Draft for Linux** at the bottom of [the website](https://draft.studiofour.io/) and download the `x64` or `arm64` build. Unpack it somewhere you own, such as `~/Applications`, and run `Draft/install-desktop` to add Draft to your app launcher. Builds target Ubuntu 22.04 or later, or another distribution with glibc 2.35 or later. Draft updates itself in that folder, so keep it somewhere you can write to.

Writing works without an AI connection. For assistance and personal updates, install and sign in to [Claude Code](https://claude.com/product/claude-code) or [Codex](https://developers.openai.com/codex/cli). Draft discovers those installations and their available models. It reuses their normal login flow and does not copy tokens into its settings. When available, Claude Opus 5.5 is the default. Model settings lets you change it.

Your provider processes the writing context or feature request you submit. Provider subscriptions, access, limits, and usage charges still apply. Draft runs its document store, editor, build tools, and app versions on your Mac.

## Make it yours

Open **Preferences** to compare **Official Draft** with **Your changes**. Every high-level feature has a date. Add ideas to your list, choose which ones you want, then choose **Download update**. Draft checks for an existing equivalent, creates a separate source workspace, asks your selected agent to implement all selected changes together, then runs independent document tests, type checks, and builds.

The download shows an estimated wait based on recent preparations. When those checks succeed, choose **Restart to update**. The editor saves your writing before restarting into the new version. Ideas added during a download stay in your list for next time. A failed or interrupted preparation leaves the current version running. If the updated renderer fails to start, Draft restores the previous version.

If Claude needs you to sign in again, the update card explains what happened and offers **Sign in again**. Draft keeps your feature queued and retries after the connection is restored. If your app, model, or selected ideas changed during sign-in, review your list before downloading again. Model settings shows **Sign-in needed** until you reconnect.

Removing a feature and returning to official Draft use the same prepare → update flow. Draft checks for official updates on opening, periodically while running, and when you return to the app. An update appears in the header and Preferences. **Draft → Check for Updates…** is always available, including with an older personal interface.

Every successful change on `main` prepares a versioned release for Mac and Linux automatically. Signing, Apple notarization, and fresh Mac and Linux installations must pass before users can download it. Users choose when to install.

**Download update** brings in the matching signed app and source. Independent changes combine automatically. If changes overlap, choose **Keep mine**, **Use Draft’s**, or **Combine both** for each high-level feature. Draft uses your connected model when integration needs work, then checks the result before offering **Restart to update**. Personal features and features you turned off remain recorded; only changes you explicitly replace are dropped. Missing model access, interrupted downloads, or unresolved checks keep the current app running.

The native app and personal source update together after saving. A failed startup restores the previous app. **Undo last update** in Preferences returns to the previous working app while keeping your current documents and queued ideas. These controls are owned by the desktop host so personal interface changes cannot hide the recovery route. Versions before 0.2.0-alpha.18 need a one-time desktop download to gain this updater.

The alpha supports changes to the editor and its local runtime. Changes to the native shell or update controller require a new packaged desktop build. Automated checks reduce mistakes; they cannot prove every generated feature is correct. Keep a backup before relying on an experimental feature.

If a feature isn’t quite right, choose **Keep working on this**. **Copy prompt** gives your local Claude Code or Codex agent the request, progress, and a separate working copy. Tell it what you want changed, then return to **Check my changes**. Draft checks the work and offers **Restart to update** when it is ready. Your current app and writing stay in place while you iterate.

## Your files and source

The native Mac app keeps its data in `~/Library/Application Support/Draft Native/`
(Linux uses `${XDG_DATA_HOME:-~/.local/share}/draft-native`):

- `Drafts/`: one `<id>.draft` folder per draft. Each holds `draft.json` (title, stage, versions, publications), every version as Markdown in `versions/`, its images in `media/`, and undo history in `history/`. `Archive/` holds archived drafts and `Recovery/` keeps the previous text of every changed or deleted version.
- `Documents/`: Draft 1 files. They are migrated into `Drafts/` once and left in place as a recovery copy.
- `versions/`: the exact source and built application for official and personal versions.
- `Workspaces/`: unfinished feature work shared with your local agent, kept until you finish iterating.
- `zo-sync.json`: the connected Zo workspace, folder and what has already been saved there. `zo-auth.json` records the OAuth client and refresh recovery state; credentials stay in the Keychain.
- `state.json`: model choice, queued ideas, feature-update history, and active/previous version pointers.
- `Exports/`: exported drafts, each a plain folder with every version as Markdown and text plus its media.

**Your source code** and **Your documents** in Preferences open those folders. Code updates and resets retain document files. Preparation workspaces live separately in `~/Library/Caches/Draft/Builds/`. The app bundles Bun and its JavaScript dependencies. Personal native interface updates also require Rust, Cargo, and cached Rust dependencies; Node and a GitHub account are not required.

The update builder edits candidate source rather than live files. Its process is restricted from your drafts and the activation record; verification also runs without network access. New package dependencies are installed in the candidate with lifecycle scripts disabled. Personal backend code runs as part of the app after you apply it, so request features you trust.

## Sync with Zo

**Settings → Sync → Connect to Zo** opens Zo in your browser. Approve the workspace you want and choose the **Draft** service account on the consent page. Back in Draft, choose the workspace, open a folder, then choose **Sync with …**. Nothing uploads until you choose a folder.

For a new workspace, open **First time? Prepare your workspace → Copy setup prompt**. Give it to an AI agent connected to Zo. The agent:
1. creates `/workspace/Draft`;
2. creates a service account named **Draft**;
3. grants it the Builder role, so it can add files, plus edit access to that one folder (`policy_zo_knowledge_all`, which Zo's app can't grant yet);
4. tells you the workspace name and folder path, without creating a client secret.

Return to Draft and choose **Connect to Zo**. Browser consent issues a credential for the identity you select; it does not grant folder access. Draft does not fall back to granting workspace Full access. Choosing your own identity instead gives Draft your current permissions in that workspace.

Existing service-account `.env` credentials still work under **Use an existing service-account credential**. They retain the previous token-exchange behavior; browser sign-in is the default for new connections.

**Change folder** brings that folder's drafts to this Mac and saves this Mac's drafts there; the old folder keeps its copy. **Reconnect** lets you authorize again and choose a workspace and folder. Refresh tokens stay in the login Keychain. Browser sign-ins expire after at most 30 days, when Draft asks you to reconnect. A service account needs explicit access to a private folder.

Sync works both ways. New drafts, edits, archiving, restoring and deleting on this Mac change Zo, and changes made in Zo or on another connected Mac come here. Each Mac keeps a working copy, so writing never waits on the network:
- **When it syncs.** Changes go up once you pause writing for 15 seconds, or after 2 minutes of steady writing. Opening Draft, returning to it, and reconnecting to the network check for cloud changes. Background checks read a small shared index every 2 minutes while active, backing off to 15 minutes when idle or in the background. An unchanged index needs one conditional request and no folder scan. A full scan every 30 minutes, or **Sync now**, also finds edits from older apps and changes made directly in Zo.
- **How it checks.** Draft lists Knowledge folders directly. Version and image folders use overlapping change-time polls between complete inventories every five minutes, which catch deletions and moves. Matching file hashes avoid downloading metadata-only revisions. A write conflict waits for reconciliation before retrying.
- **Your typing comes first.** A draft with typing not yet saved is never replaced while you write. Its next save is merged on this Mac.
- **Nothing is lost.** What changed on only one side is taken from that side. If the same version changed in both places, this Mac's text stays and Zo's becomes a new version named "(from Zo)".
- **Deleting.** A deleted draft goes to Zo's trash and is cleared; its folder in Zo goes once Zo allows it. A draft deleted in Zo, or on another Mac, moves to Draft's Recovery folder here. If you kept writing in it here, your writing wins and it's saved to Zo again.
- **Archiving.** Archived drafts move to `Archive/` in Zo, keeping each file's history.
- **A safety stop.** If most drafts disappear from Zo at once, Draft keeps them and says so in Settings rather than deleting them here.
- **What's in Zo.** Each draft folder holds `draft.json`, every version as Markdown, and its images. `Drafts.md` lists them by title. Undo history stays on each Mac.
- **Blank drafts stay put.** A blank draft that was never synced stays on its Mac.

**Disconnect** revokes this browser sign-in and removes its credential from this Mac, keeping drafts here and in Zo. Legacy service-account secrets are only forgotten locally; revoke them in Zo to stop other uses. Without Zo, Draft works entirely on this Mac.

The desktop OAuth client is registered once with Zo as `draft-desktop`, display name **Draft**, callback `http://127.0.0.1/callback` (dynamic loopback port). This uses Zo's existing operator registration command and requires no hostagent code changes.

## Landing page

[Visit the website](https://draft.studiofour.io/). It plays a walkthrough of the real app and the workflow it is built for: a brain dump, then new versions side by side; the source is in [website/](website/). Run `bun run website:dev` to preview it locally.

Pushes to `main` build and publish the landing page to GitHub Pages through the [website workflow](.github/workflows/pages.yml).

## Develop

The [approved native design](docs/native-design-rollout-2026-11-06.md) is now the
default development app for macOS and Linux. Install [Bun](https://bun.sh), Rust,
and Cargo (plus Xcode command-line tools on macOS), then:

```sh
bun install
bun run test
bun run dev
```

This opens the Rune interface with its local document host and a separate preview
library in `native/rune-prototype/scratch`. `bun run desktop:dev` opens the same
app, and `bun run dev --release` uses an optimized build. Native interaction checks
run with `bun run native:check`. See the [native README](native/rune-prototype/README.md)
for Linux build libraries, verification, and current feature coverage.

`bun run website:dev` previews the web demo and landing page. Shared web components
also provide the protected update and recovery controls. The installed writing
interface uses Rune, with an authenticated host on a random loopback port.

A standalone development package is available with `bun run native:build`. It
bundles its host and tools and uses the Draft Native profile. The signed native
Mac app has shipped since 0.3.0-alpha.71. See the
[native rollout status](docs/native-design-rollout-2026-11-06.md) for verification.

Build the native public application with Xcode command-line tools installed on macOS:

```sh
bun run desktop:build
```

The app is produced at `native/rune-prototype/artifacts/Draft.app`. The release
pipeline signs and notarizes it, creates the installer under `release/`, verifies
the exact downloads on a clean Mac, and publishes them. The package includes
matching editable source and local tools. Personal native feature builds require
Rust and cached Cargo dependencies. See [Releasing](docs/releasing.md).

## Specs

Product decisions are kept as dated documents in [docs/](docs/). The current direction is the [Draft 2.0 spec](docs/draft-2-spec-2026-10-31.md). The [October 24 baseline](docs/draft-product-spec-2026-10-24.md) still describes personal and official updates.

The neutral interface follows the Studio Four components. [T3 Code](https://github.com/pingdotgg/t3code) was a reference for discovering existing authenticated coding tools; its source was not copied.

## License

Draft’s application code and specifications are [MIT licensed](LICENSE). Dependency licenses are separate.
