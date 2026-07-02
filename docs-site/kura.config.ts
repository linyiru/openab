import { defineKura } from "@kurajs/docs";

export default defineKura({
  site: {
    name: "OpenAB",
    brand: "OpenAB",
    titleTemplate: "%s · OpenAB Docs",
    description: "A lightweight, cloud-native ACP harness connecting chat platforms to AI coding agents.",
  },
  // Docs-as-code: mount the repo's own docs/ tree — no duplication. Authors keep editing docs/*.md;
  // this site renders them for humans (and serves Markdown/JSON + an MCP tool for agents).
  content: { sources: [{ dir: "../docs", mount: "" }] },
  // OpenAB's docs are plain prose, not MDX — CommonMark renders them verbatim and avoids MDX's
  // footgun where a stray `{…}` or `<tag>` fails the page.
  markdown: "commonmark",
  // Mount the docs at the site root (no /docs prefix), and build a static site for GitHub Pages.
  // basePath = the project subpath the site is served under: https://<user>.github.io/openab/docs/.
  basePath: "",
  deploy: { target: "github-pages", basePath: "/openab/docs" },
});
