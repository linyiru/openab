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

`.github/workflows/docs.yml` builds `dist/static/` and publishes it to the `gh-pages` branch under
`/docs` (`keep_files: true`, so it never touches anything else already on `gh-pages` — e.g. a Helm
chart repo's `index.yaml`). Live at `https://<owner>.github.io/openab/docs/`.

`kura.config.ts` sets `deploy.basePath: "/openab/docs"` (the project subpath) so assets and links
resolve there, and `content.sources` mounts `../docs`. `content/docs/index.md` is the landing page.

> Note: `docs/*.md` have no front-matter, so sidebar labels fall back to the file slug. Add a
> `title:` (and optional `description:`) front-matter block to a page to give it a nicer label.
