# Draft website

The landing page and looping app walkthrough live here in the Draft repository.

```sh
bun install --frozen-lockfile
bun run website:dev
```

Open http://127.0.0.1:4320/. `bun run website:build` produces the static site in `website/dist/`, ready for any static host. No hosting account or service is required.

The iframe runs the real Draft editor and Features components with an in-memory transport. Writing, alternatives, set aside, overflow, the feature list, export, reading time, and focus mode work in the browser. AI generation and the wait for an update are simulated and sped up. Only the two demonstrated custom features can be activated in this demo; the Mac app uses the person's real agent to build arbitrary requests. No visitor account is detected and no personal writing is stored or transmitted.

The tour is watch-only, with Play/Pause and Replay controls. Reduced-motion preferences start it paused. Demo-only labels and instructions are omitted from the page and app preview. The tour resets its temporary writing when replaying. Third-party license notices are included in the built output.

The walkthrough scales its entire app canvas uniformly into the available width and height. Wide windows use a 1152 × 720 desktop layout. Narrow windows and smaller touch browsers use a 430 × 780 portrait layout, or an 800 × 480 compact landscape layout. Writing tools become a bottom panel and personal features appear above official features in the compact layouts. Resizing within a layout preserves playback; crossing layouts restarts the walkthrough while keeping Play/Pause state. The page, heading, controls, and source links fit within the viewport; content scrolls gently inside the app where needed. A circular glass cursor moves between targets and pulses on clicks, with a step-specific heading and time to read each result. Input fields have no focus or attention rings in the walkthrough. The draft and request fields share the same typing style and blinking caret, with a faster opening draft; the glass pointer steps aside while text is entered. Pause freezes the cursor, tour timing, and simulated download; Replay starts a fresh loop. Reduced-motion playback skips cursor travel and fades.


## Check live resizing

With the local website server running, open http://127.0.0.1:4320/__checks__/resize.html. It loads the actual website wide, narrows the same page without refreshing, and reports PASS only when the app and its frame remain inside the viewport. Add `?full=1` to exercise width-only and height-only changes, mobile layouts, and returning to desktop. This browser regression catches the intrinsic minimum-width constraint that a fresh load at a narrow size can hide. The check is served locally from `tests/fixtures/` and is excluded from the built static website.
