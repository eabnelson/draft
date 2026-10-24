# Draft website

The landing page and looping app walkthrough live here in the Draft repository.

```sh
bun install --frozen-lockfile
bun run website:dev
```

Open http://127.0.0.1:4320/. `bun run website:build` produces the static site in `website/dist/`, ready for any static host. No hosting account or service is required.

The iframe runs the real Draft editor and Features components with an in-memory transport. Writing, alternatives, set aside, overflow, the feature list, export, reading time, and focus mode work in the browser. AI generation and the wait for an update are simulated and sped up. Only the two demonstrated custom features can be activated in this demo; the Mac app uses the person's real agent to build arbitrary requests. No visitor account is detected and no personal writing is stored or transmitted.

The tour is watch-only, with Play/Pause and Replay controls. Reduced-motion preferences start it paused. Demo-only labels and instructions are omitted from the page and app preview. The tour resets its temporary writing when replaying. Third-party license notices are included in the built output.

The walkthrough uses a fixed 1152 × 720 app canvas, scaled uniformly into the available screen space. Only the viewer's window size changes that scale. The page, heading, controls, and source links fit within the viewport; content scrolls gently inside the app where needed. A glass cursor moves between targets and pulses on clicks, with a step-specific heading and time to read each result. Pause freezes the cursor, tour timing, and simulated download; Replay starts a fresh loop. Reduced-motion playback skips cursor travel and fades.
