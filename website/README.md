# Draft website

The landing page for https://draft.studiofour.io/. GitHub Pages serves the build from `main`; the repository's Pages settings hold the custom domain. Cloudflare routes only the `draft` subdomain with a DNS-only CNAME to `eabnelson.github.io`.

```sh
bun install --frozen-lockfile
bun run website:dev
```

Open http://127.0.0.1:4320/. `bun run website:build` produces the static site in `website/dist/` and points the download button at the latest published Mac release.

The page plays a walkthrough of the real app: `website/demo/` mounts `src/App.tsx` in a frame and answers its requests from an in-memory store (`demo/store.ts`), and `demo/tour.ts` drives it through the workflow Draft is built for: a brain dump, new versions beside it, refining a few, marking one ready, then asking Draft for a feature of his own and restarting into it. `player.ts` runs the headline, glass cursor, Pause and Replay on the page around the frame.

The shared browser interface mirrors the approved native design: rounded glass
sidebar groups, joined tab silhouettes and rims, nearby glass menus, and a bottom
Back control in Settings. `src/chrome.css` defines those surfaces for both the web
app and this demo. The tour also visits the illustrated Light/Dark appearance
choices and responsive shortcut keycaps before demonstrating a personal feature.
Its writing and simulated updates stay in memory; rebuilding the website does not
publish it. The Pages workflow deploys after the changes reach checked `main`.
