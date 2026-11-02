# Draft website

The landing page for https://draft.studiofour.io/. GitHub Pages serves the build from `main`; the repository's Pages settings hold the custom domain. Cloudflare routes only the `draft` subdomain with a DNS-only CNAME to `eabnelson.github.io`.

```sh
bun install --frozen-lockfile
bun run website:dev
```

Open http://127.0.0.1:4320/. `bun run website:build` produces the static site in `website/dist/` and points the download button at the latest published Mac release.

The page plays a walkthrough of the real app: `website/demo/` mounts `src/App.tsx` in a frame and answers its requests from an in-memory store (`demo/store.ts`), and `demo/tour.ts` drives it through writing, versioning and posting a draft. `player.ts` runs the headline, glass cursor, Pause and Replay on the page around the frame.
