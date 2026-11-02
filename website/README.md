# Draft website

The landing page for https://draft.studiofour.io/. GitHub Pages serves the build from `main`; the repository's Pages settings hold the custom domain. Cloudflare routes only the `draft` subdomain with a DNS-only CNAME to `eabnelson.github.io`.

```sh
bun install --frozen-lockfile
bun run website:dev
```

Open http://127.0.0.1:4320/. `bun run website:build` produces the static site in `website/dist/` and points the download button at the latest published Mac release.

During Draft 2.0 development the site is a plain download page. The interactive walkthrough will be redesigned after 2.0 ships.
