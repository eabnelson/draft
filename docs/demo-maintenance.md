# Keeping the website demo current

The homepage imports the production App, editor, Preferences, official update card, theme, components and feature catalog. It does not maintain separate copies of that interface. The in-memory store simulates external agents, build waits and desktop restarts, and provides reading time and focus mode as illustrative personal features. No website visitor's machine or documents are modified.

The loop briefly shows writing, alternatives and overflow, then focuses on adding features, building an update, using those features, accepting an official update while keeping them, and returning to official Draft with writing intact. Keep the loop focused; every small capability need not get its own scene.

When changing app behavior or UI:

1. Update `features.json`, including the feature's date and code paths.
2. Update `website/demo/tour.ts` and `store.ts` if a step, label or behavior changed. Reuse production UI. New or removed official features require matching entries in `website/demo/coverage.json`. Its notes explain the scene or intentional omission from the short tour.
3. Run `bun run demo:review` to record the app source under review, then `bun run website:build` and `bun run test:demo`. If needed, first install the test browser with `bun run node_modules/@playwright/test/cli.js install chromium`.
4. Watch the resulting walkthrough, check desktop and mobile, and commit the demo and `coverage.json` alongside the app change. `bun run demo:check` verifies that no app changes happened after that review.

The review fingerprint covers the entire app UI, desktop controller, native helpers, host update UI and catalog. Generated release version stamps are excluded; feature dates and descriptions are included. A changed fingerprint or unreviewed feature blocks website builds and releases. CI also watches the complete production homepage loop at three sizes and resizes the same page across fifteen viewport sizes without refreshing. It verifies the actual controls, alternatives, queued ideas, personal features, official-update retention, reset, and preserved writing. A broken or interrupted tour fails CI and prevents automatic publication. Failure reports include screenshots and browser traces.

The separate launch film under `website/demo/film/`, when present, is a manually exported social asset. An already posted MP4 is not changed by a website deployment; regenerate it explicitly when a new film is needed.
