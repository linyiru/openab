// Scaffold an ephemeral Kura app from a single kura.toml, then the caller runs `kura build`.
// Convention over configuration: the user commits ONLY kura.toml (+ their docs/); everything else
// (package.json, app/global.css, tsconfig, a landing page) is generated here at build time.
//
//   bun kura-scaffold.mjs <repoRoot> <buildDir>
// Reads <repoRoot>/kura.toml, writes a ready-to-build app into <buildDir>. content.sources dirs are
// rewritten relative to <buildDir> (one level under the repo root).
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

// --- read kura.toml (Bun parses .toml natively on import) ---------------------
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
if (raw.site) cfg.site = rename(raw.site, { title_template: "titleTemplate" });
if (raw.markdown) cfg.markdown = raw.markdown;
if (raw.base_path !== undefined) cfg.basePath = raw.base_path;
if (raw.sections) cfg.sections = raw.sections;
if (raw.highlight) cfg.highlight = raw.highlight;
if (raw.i18n) cfg.i18n = rename(raw.i18n, { default_locale: "defaultLocale" });
if (raw.deploy) cfg.deploy = rename(raw.deploy, { base_path: "basePath" });
// content.sources: user writes dirs relative to the REPO ROOT; the app lives one level down in
// buildDir, so prefix "../" (an absolute dir is left as-is).
if (raw.content?.sources) {
  cfg.content = {
    sources: raw.content.sources.map((s) => ({
      ...s,
      dir: path.isAbsolute(s.dir) ? s.dir : "../" + s.dir,
    })),
  };
}

// --- write the ephemeral app --------------------------------------------------
const write = (rel, content) => {
  const p = path.join(buildDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

// Emit a TS object LITERAL with UNQUOTED identifier keys (quote only non-identifier keys like
// "ja-JP") — the kura CLI text-scans the config source with regexes that expect `markdown:` /
// `basePath:` (JSON.stringify's `"markdown":` would silently miss, falling back to MDX + wrong route).
const isIdent = (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k);
const lit = (v, ind = "") => {
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return "[\n" + v.map((x) => ind + "  " + lit(x, ind + "  ")).join(",\n") + "\n" + ind + "]";
  }
  if (v && typeof v === "object") {
    const e = Object.entries(v);
    if (!e.length) return "{}";
    return "{\n" + e.map(([k, val]) => `${ind}  ${isIdent(k) ? k : JSON.stringify(k)}: ${lit(val, ind + "  ")}`).join(",\n") + "\n" + ind + "}";
  }
  return JSON.stringify(v); // strings / numbers / booleans
};

write("kura.config.ts",
  `// @generated from kura.toml — do not edit.\n` +
  `import { defineKura } from "@kurajs/docs";\n` +
  `export default defineKura(${lit(cfg)});\n`,
);

write("package.json", JSON.stringify({
  name: "kura-docs-ephemeral",
  private: true,
  type: "module",
  scripts: { build: "kura build --no-embed" },
  dependencies: { "@kurajs/docs": KURA_DOCS, react: "^19.2.0", "react-dom": "^19.2.0" },
  devDependencies: {
    "@kurajs/cli": KURA_CLI,
    "@tailwindcss/node": "^4.3.1",
    "@tailwindcss/oxide": "^4.3.1",
    "@tailwindcss/typography": "^0.5.20",
    "@types/react": "^19.2.0",
    tailwindcss: "^4.3.1",
    typescript: "^5.9.0",
  },
}, null, 2) + "\n");

write("app/global.css", `@import "tailwindcss";\n@import "@kurajs/docs/css";\n`);
write("tsconfig.json", JSON.stringify({ extends: "@kurajs/docs/tsconfig.kura.json", include: ["app", "kura.config.ts"] }, null, 2) + "\n");

// A local landing page bootstraps the content collection (a mount-only site has no local content for
// `june gen` to seed _content from) and gives the site a homepage, synthesized from [site].
const siteName = cfg.site?.name ?? "Documentation";
const siteDesc = cfg.site?.description ?? "";
write("content/docs/index.md",
  `---\ntitle: "${siteName}"\n${siteDesc ? `description: ${JSON.stringify(siteDesc)}\n` : ""}---\n\n` +
  `# ${siteName}\n\n${siteDesc ? siteDesc + "\n\n" : ""}` +
  `Use the sidebar or search (\`/\`) to browse the docs. Every page is also available as Markdown ` +
  `(append \`.md\`) and JSON, and via an MCP tool at \`/mcp\`.\n`,
);

console.log(`kura-scaffold: wrote ${buildDir} from kura.toml`);
console.log(`  site=${siteName} deploy.target=${cfg.deploy?.target} basePath=${cfg.deploy?.basePath} sources=${JSON.stringify(cfg.content?.sources)}`);
