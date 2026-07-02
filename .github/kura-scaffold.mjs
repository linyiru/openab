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
const KURA_DOCS = process.env.KURA_DOCS_VERSION || "^0.0.38";
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
// content.sources (mount as-is) only when there's no [nav] — a nav reorganizes the content itself.
if (!raw.nav && raw.content?.sources) {
  cfg.content = {
    sources: raw.content.sources.map((s) => ({ ...s, dir: path.isAbsolute(s.dir) ? s.dir : "../" + s.dir })),
  };
}

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

if (!raw.nav) {
  // No nav → mount-as-is (a flat, auto-derived sidebar). content.sources already set above.
  landing();
  console.log(`kura-scaffold: ${buildDir} (mount) site=${siteName} deploy=${cfg.deploy?.target} basePath=${cfg.deploy?.basePath}`);
} else {
  // [nav] → reorganize docs/ into a folder tree with tabs. Titles: a page's { title } override,
  // else its de-boilerplated H1, else the slug. docs/ stays untouched (we read + copy).
  const docsRoot = path.join(repoRoot, "docs");
  const readDoc = (rel) => fs.readFileSync(path.join(docsRoot, rel), "utf8");
  const h1Of = (body) => (body.split("\n").find((l) => /^#\s+/.test(l)) || "").replace(/^#\s+/, "").trim();
  const cleanTitle = (h1) => {
    let t = (h1 || "").replace(/^ADR:\s*/i, "");
    t = t.replace(/\s*\([^)]*\)\s*$/, "");                                        // trailing "(…)"
    t = t.replace(/\s*[—–-]\s*[^—–-]*\b(Guide|Backend|Adapter|Pattern)\b.*$/i, ""); // dash boilerplate
    t = t.replace(/\s+(Setup Guide|Setup|Guide|CLI)\s*$/i, "");                    // trailing boilerplate word
    return t.trim();
  };
  // Copy one source doc into content/docs/<group>/<name>.md, injecting a title (unless the source
  // already ships its own front-matter). Returns the destination slug segment.
  const emit = (group, srcRel, override) => {
    const body = readDoc(srcRel);
    const name = path.basename(srcRel).replace(/\.md$/, "");
    const dest = `content/docs/${group}/${name}.md`;
    if (body.startsWith("---")) write(dest, body); // respect an authored front-matter block
    else write(dest, `---\ntitle: ${JSON.stringify(override || cleanTitle(h1Of(body)) || name)}\n---\n\n${body.trimEnd()}\n`);
    return name;
  };

  const groups = raw.nav.groups || {};
  const used = new Set();
  const tabDefs = [];
  for (const tab of raw.nav.tabs || []) {
    const tabGroups = [];
    for (const g of tab.groups || []) {
      const gc = groups[g] || {};
      let pageSlugs;
      if (gc.pages) {
        // explicit list: entries are "slug" or { slug, title }; a slug may include a docs/ subpath.
        pageSlugs = gc.pages.map((p) => {
          const slug = typeof p === "string" ? p : p.slug;
          used.add(slug);
          return emit(g, slug + ".md", typeof p === "object" ? p.title : undefined);
        });
      } else if (fs.existsSync(path.join(docsRoot, g)) && fs.statSync(path.join(docsRoot, g)).isDirectory()) {
        // title-only group → auto-fill from the docs/<g>/ subfolder (alphabetical).
        pageSlugs = fs.readdirSync(path.join(docsRoot, g)).filter((f) => f.endsWith(".md")).sort()
          .map((f) => { used.add(`${g}/${f.replace(/\.md$/, "")}`); return emit(g, `${g}/${f}`); });
      } else {
        console.warn(`kura-scaffold: group "${g}" has no pages and no docs/${g}/ folder — skipped`);
        continue;
      }
      write(`content/docs/${g}/meta.json`, JSON.stringify({ title: gc.title || g, pages: pageSlugs }, null, 2) + "\n");
      tabGroups.push(g);
    }
    tabDefs.push({ title: tab.title, pages: tabGroups });
  }
  write("content/docs/meta.json", JSON.stringify({ tabs: tabDefs }, null, 2) + "\n");
  landing();

  // Never silently drop a doc: report any docs/*.md (or subfolder file) not placed by the nav.
  const onDisk = [];
  const walk = (dir, pre = "") => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), pre + e.name + "/");
      else if (e.name.endsWith(".md")) onDisk.push(pre + e.name.replace(/\.md$/, ""));
    }
  };
  walk(docsRoot);
  const missing = onDisk.filter((s) => !used.has(s));
  console.log(`kura-scaffold: ${buildDir} (nav) tabs=${tabDefs.map((t) => t.title).join("/")} pages=${used.size}`);
  if (missing.length) console.warn(`kura-scaffold: ⚠ ${missing.length} ungrouped docs (add them to [nav]): ${missing.join(", ")}`);
}
