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
  // Mount the docs at the site root, and build a static site for GitHub Pages. The site is published
  // to the gh-pages ROOT so the docs index.html IS the homepage (https://<user>.github.io/openab/) —
  // coexisting with the Helm chart repo's index.yaml (a different file) at the same root.
  basePath: "",
  deploy: { target: "github-pages", basePath: "/openab" },
});
