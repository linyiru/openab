// Scaffold an ephemeral Kura app from a single kura.toml, then the caller runs `kura build`.
// Convention over configuration: the user commits ONLY kura.toml (+ their docs/); everything else
// (package.json, app/global.css, tsconfig, the content tree + nav) is generated here at build time.
//
//   bun kura-scaffold.mjs <repoRoot> <buildDir>
// Reads <repoRoot>/kura.toml, writes a ready-to-build app into <buildDir>. docs/ is never modified.
import fs from "node:fs";
import path from "node:path";

const [, , repoRoot, buildDir] = process.argv;
if (!repoRoot || !buildDir) {
  console.error("usage: bun kura-scaffold.mjs <repoRoot> <buildDir>");
  process.exit(1);
}

// Pinned so a broken `latest` can never silently break a deploy (overridable via env).
const KURA_DOCS = process.env.KURA_DOCS_VERSION || "^0.0.39";
const KURA_CLI = process.env.KURA_CLI_VERSION || "^0.0.25";

const tomlPath = path.join(repoRoot, "kura.toml");
if (!fs.existsSync(tomlPath)) {
  console.error(`kura-scaffold: no kura.toml at ${tomlPath}`);
  process.exit(1);
}
const raw = (await import(path.resolve(tomlPath))).default;

// --- TOML (snake_case) → KuraConfig (camelCase). Explicit, path-aware renames — never a blind deep
//     transform (that would mangle data keys like i18n locale codes or label names). ---------------
const rename = (obj, map) => {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[map[k] ?? k] = v;
  return out;
};

const cfg = {};
if (raw.site) {
  cfg.site = rename(raw.site, { title_template: "titleTemplate" });
  // Default the HTML <title> to "{page title} - {site name}" (the page title itself defaults to the
  // doc's H1). Overridable via [site] title_template; the homepage stays just the site name (Kura
  // skips the template when the page title equals site.name).
  if (!cfg.site.titleTemplate && cfg.site.name) cfg.site.titleTemplate = `%s - ${cfg.site.name}`;
}
if (raw.markdown) cfg.markdown = raw.markdown;
if (raw.base_path !== undefined) cfg.basePath = raw.base_path;
if (raw.sections) cfg.sections = raw.sections;
if (raw.highlight) cfg.highlight = raw.highlight;
if (raw.i18n) cfg.i18n = rename(raw.i18n, { default_locale: "defaultLocale" });
if (raw.deploy) cfg.deploy = rename(raw.deploy, { base_path: "basePath" });
// Mount the repo's docs/ VERBATIM, in place — flat slugs, files never moved. Defaults to ../docs
// (convention); override with [[content.sources]]. The build dir is one level under the repo root,
// so a repo-relative dir gets a "../" prefix.
const sources = raw.content?.sources ?? [{ dir: "docs", mount: "" }];
cfg.content = { sources: sources.map((s) => ({ ...s, dir: path.isAbsolute(s.dir) ? s.dir : "../" + s.dir })) };
// [nav] (virtual navigation) maps 1:1 to config.nav — group flat slugs into tabs + sidebar groups
// with no folder moves and no slug prefixes. Passed straight through.
if (raw.nav) cfg.nav = raw.nav;

// --- writers ------------------------------------------------------------------
const write = (rel, content) => {
  const p = path.join(buildDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
// Emit a TS object LITERAL with UNQUOTED identifier keys (the kura CLI text-scans the config source
// with regexes that expect `markdown:` / `basePath:`; JSON.stringify's `"markdown":` would miss).
const isIdent = (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k);
const lit = (v, ind = "") => {
  if (Array.isArray(v)) return v.length ? "[\n" + v.map((x) => ind + "  " + lit(x, ind + "  ")).join(",\n") + "\n" + ind + "]" : "[]";
  if (v && typeof v === "object") {
    const e = Object.entries(v);
    return e.length ? "{\n" + e.map(([k, val]) => `${ind}  ${isIdent(k) ? k : JSON.stringify(k)}: ${lit(val, ind + "  ")}`).join(",\n") + "\n" + ind + "}" : "{}";
  }
  return JSON.stringify(v);
};

write("kura.config.ts",
  `// @generated from kura.toml — do not edit.\nimport { defineKura } from "@kurajs/docs";\nexport default defineKura(${lit(cfg)});\n`);
write("package.json", JSON.stringify({
  name: "kura-docs-ephemeral", private: true, type: "module",
  scripts: { build: "kura build --no-embed" },
  dependencies: { "@kurajs/docs": KURA_DOCS, react: "^19.2.0", "react-dom": "^19.2.0" },
  devDependencies: {
    "@kurajs/cli": KURA_CLI, "@tailwindcss/node": "^4.3.1", "@tailwindcss/oxide": "^4.3.1",
    "@tailwindcss/typography": "^0.5.20", "@types/react": "^19.2.0", tailwindcss: "^4.3.1", typescript: "^5.9.0",
  },
}, null, 2) + "\n");
write("app/global.css", `@import "tailwindcss";\n@import "@kurajs/docs/css";\n`);
write("tsconfig.json", JSON.stringify({ extends: "@kurajs/docs/tsconfig.kura.json", include: ["app", "kura.config.ts"] }, null, 2) + "\n");

// --- content --------------------------------------------------------------------
const siteName = cfg.site?.name ?? "Documentation";
const siteDesc = cfg.site?.description ?? "";
const landing = () => write("content/docs/index.md",
  `---\ntitle: ${JSON.stringify(siteName)}\n${siteDesc ? `description: ${JSON.stringify(siteDesc)}\n` : ""}---\n\n# ${siteName}\n\n` +
  `${siteDesc ? siteDesc + "\n\n" : ""}Use the sidebar or search (\`/\`) to browse the docs. Every page is also available as ` +
  `Markdown (append \`.md\`) and JSON, and via an MCP tool at \`/mcp\`.\n`);

// The ONLY generated content: a landing page (also seeds the content collection for `june gen`).
// The docs themselves are mounted VERBATIM from ../docs — nothing copied, moved, or injected. The
// sidebar tabs/groups come from config.nav (virtual grouping over the flat slugs).
landing();

// Never silently drop a doc: warn about any docs/*.md not placed in a [nav] group (flat slugs whose
// group isn't listed, and subfolder files whose folder isn't a group). Titles come from each H1.
const tabs = raw.nav?.tabs ?? [];
const groups = raw.nav?.groups ?? {};
const placed = new Set();
for (const gid of tabs.flatMap((t) => t.groups ?? [])) {
  const g = groups[gid] ?? {};
  if (g.pages) for (const p of g.pages) placed.add(typeof p === "string" ? p : p.slug);
  else placed.add(gid + "/"); // subfolder auto-fill: mark the whole prefix as covered
}
const onDisk = [];
const walk = (dir, pre = "") => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), pre + e.name + "/");
    else if (e.name.endsWith(".md")) onDisk.push(pre + e.name.replace(/\.md$/, ""));
  }
};
walk(path.join(repoRoot, "docs"));
const missing = onDisk.filter((s) => !placed.has(s) && ![...placed].some((p) => p.endsWith("/") && s.startsWith(p)));
console.log(`kura-scaffold: ${buildDir} (virtual nav) tabs=${tabs.map((t) => t.title).join("/") || "—"} mounted=${onDisk.length}`);
if (missing.length) console.warn(`kura-scaffold: ⚠ ${missing.length} ungrouped docs (add to [nav]): ${missing.join(", ")}`);
