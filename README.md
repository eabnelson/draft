# Draft

A local writing app you can make your own. Write, compare alternate wording, set passages aside, and keep spare ideas in overflow. Ask your connected coding agent for a feature, then apply the finished work with **Restart to update**.

**macOS first · MIT · Early alpha**

[Verified behavior and remaining release work](docs/alpha-status-2026-10-24.md).

[Download the latest build](https://github.com/eabnelson/draft/releases) · [Product spec — October 24, 2026](docs/draft-product-spec-2026-10-24.md) · [Original inspiration](https://x.com/jasonfried/status/2105403067793584590)

## Use Draft

Download the Apple Silicon macOS build from Releases, extract it, and move Draft to Applications. macOS 13 or later is required. This alpha is not notarized; a signed, notarized distribution is a remaining release requirement. Building from source is supported below.

Writing works without an AI connection. For assistance and personal updates, install and sign in to [Claude Code](https://claude.com/product/claude-code) or [Codex](https://developers.openai.com/codex/cli). Draft discovers those installations and their available models. It reuses their normal login flow and does not copy tokens into its settings. When available, Claude Opus 5.5 is the default. Model settings lets you change it.

Your provider processes the writing context or feature request you submit. Provider subscriptions, access, limits, and usage charges still apply. Draft runs its document store, editor, build tools, and app versions on your Mac.

## Make it yours

Open **Features** to compare **Official Draft** with **Your changes**. Every high-level feature has a date. Add ideas to your list, choose which ones you want, then choose **Download update**. Draft checks for an existing equivalent, creates a separate source workspace, asks your selected agent to implement all selected changes together, then runs independent document tests, type checks, and builds.

The download shows an estimated wait based on recent preparations. When those checks succeed, choose **Restart to update**. The editor saves your writing before restarting into the new version. Ideas added during a download stay in your list for next time. A failed or interrupted preparation leaves the current version running. If the updated renderer fails to start, Draft restores the previous version.

Removing a feature and returning to official Draft use the same prepare → update flow. Official source updates are checked against signed release metadata and can be integrated with personal changes by your agent. An unresolved conflict produces a failed preparation rather than replacing the working app.

The alpha supports changes to the editor and its local runtime. Changes to the native shell or update controller require a new packaged desktop build. Automated checks reduce mistakes; they cannot prove every generated feature is correct. Keep a backup before relying on an experimental feature.

If a feature isn’t quite right, choose **Keep working on this**. **Copy prompt** gives your local Claude Code or Codex agent the request, progress, and a separate working copy. Tell it what you want changed, then return to **Check my changes**. Draft checks the work and offers **Restart to update** when it is ready. Your current app and writing stay in place while you iterate.

## Your files and source

Draft keeps its data in `~/Library/Application Support/Draft/`:

- `Documents/`: full `.draft.json` writing files, the library index, and previous-file recovery copies. Alternatives, hidden passages, and overflow are included.
- `versions/`: the exact source and built application for official and personal versions.
- `Workspaces/`: unfinished feature work shared with your local agent, kept until you finish iterating.
- `state.json`: model choice, queued ideas, feature-update history, and active/previous version pointers.
- `Exports/`: plain text, Markdown, and complete draft exports.

**Your source code** and **Your documents** in Features open those folders. Code updates and resets retain document files. Preparation workspaces live separately in `~/Library/Caches/Draft/Builds/`. The app bundles Bun and its build dependencies; ordinary personal updates do not require Node, Rust, Xcode, Git, or a GitHub account.

The update builder edits candidate source rather than live files. Its process is restricted from the document store and activation record; verification also runs without network access. New package dependencies are installed in the candidate with lifecycle scripts disabled. Personal backend code runs as part of the app after you apply it, so request features you trust.

## Landing page

[Visit the website](https://eabnelson.github.io/draft/). The minimal landing page lives in [website/](website/). Run `bun run website:dev` to preview it locally.

Pushes to `main` build and publish the landing page and walkthrough to GitHub Pages through the [website workflow](.github/workflows/pages.yml).

## Develop

Install [Bun](https://bun.sh), then:

```sh
bun install
bun run test
bun run dev
```

The local preview runs at `http://127.0.0.1:4319`. Development mode is loopback-only and uses a separate profile when `DRAFT_DATA_ROOT` is set. The packaged app uses a random loopback port and a per-launch session cookie.

For the native macOS app, install Rust and Xcode command-line tools:

```sh
bun run desktop:build
```

The app and disk image are produced under `src-tauri/target/release/bundle/`. The packaged app includes matching editable source and local build tools. See [Releasing](docs/releasing.md) for distribution signing and source-update signing.

## Inspiration and dated source material

Draft began with [Jason Fried’s writing-editor demonstration](https://x.com/jasonfried/status/2105403067793584590). He is credited as the source of inspiration; this project is independent and does not imply his endorsement.

- [Full timestamped transcript](sources/transcript.md), [plain text](sources/transcript.txt), and [all 120 timed segments](sources/transcript.json).
- [Initial product spec — October 22, 2026](docs/initial-product-spec.md), preserved unchanged from the first build.
- [Accepted Draft baseline — October 24, 2026](docs/draft-product-spec-2026-10-24.md), including macOS, local agents, feature comparison, and the update interaction.
- [Provenance](provenance.json) and [reference-file checksums](SHA256SUMS).

The automated English transcript was generated locally with [toscript](https://github.com/eabnelson/toscript) using `mlx-community/whisper-large-v3-turbo`. The spoken material remains attributed to Jason Fried; see [NOTICE](NOTICE.md).

The neutral interface follows the Studio Four components used in the first local build. [T3 Code](https://github.com/pingdotgg/t3code) was a reference for discovering existing authenticated coding tools; its source was not copied.

## License

Draft’s original application code and project-authored specifications are [MIT licensed](LICENSE). Third-party transcript material and dependency licenses are separate; see [NOTICE](NOTICE.md).
