# Draft website

The landing page and interactive app demo live here in the Draft repository.

```sh
bun install --frozen-lockfile
bun run website:dev
```

Open http://127.0.0.1:4320/. `bun run website:build` produces the static site in `website/dist/`, ready for any static host. No hosting account or service is required.

The iframe runs the real Draft editor and Features components with an in-memory transport. Writing, alternatives, set aside, overflow, the feature list, export, reading time, and focus mode work in the browser. AI generation and the wait for an update are simulated and sped up. Only the two demonstrated custom features can be activated in this demo; the Mac app uses the person's real agent to build arbitrary requests. No visitor account is detected and no personal writing is stored or transmitted.

The tour loops, pauses when someone interacts, and offers Play, Replay, and Try it. Reduced-motion preferences start it paused. The demo resets its temporary writing when replaying. Third-party license notices are included in the built output.
