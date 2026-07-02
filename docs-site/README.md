# OpenAB docs site (Kura)

A [Kura](https://kura.build) documentation site that **mounts the repo's own `docs/`** — no
content duplication. Authors keep editing `docs/*.md`; this renders them for humans and serves
Markdown/JSON + an MCP tool for agents.

## Local preview

```bash
cd docs-site
bun install
bun run dev      # http://localhost:3000
bun run build    # → dist/static/  (static site for GitHub Pages)
```

## How it deploys

`.github/workflows/docs.yml` builds `dist/static/` and publishes it to the **`gh-pages` root** with
`keep_files: true` — so the docs `index.html` is the site homepage (`https://<owner>.github.io/openab/`)
**and** the Helm chart repo's `index.yaml` (a different file) is preserved and keeps serving at
`/openab/index.yaml`. The Helm release (`helm/chart-releaser-action`) only ever commits `index.yaml`,
so the two publishers are additive and coexist — neither deletes the other's files.

GitHub Pages source must be **`gh-pages` branch, `/ (root)`** (not the `/docs` folder option).
`kura.config.ts` sets `deploy.basePath: "/openab"` (the project subpath) so assets and links resolve,
and `content.sources` mounts `../docs`. `content/docs/index.md` is the landing page.

> Note: `docs/*.md` have no front-matter, so sidebar labels fall back to the file slug. Add a
> `title:` (and optional `description:`) front-matter block to a page to give it a nicer label.
