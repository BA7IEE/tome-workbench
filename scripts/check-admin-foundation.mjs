// Lightweight source admission gate. Run only in a coordinated validation window.
// This is not a build, browser check, or proof of component compatibility.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "web/src");
const errors = [];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const legacyNativeTables = new Set([
  "core.ts",
  "sources-screen.ts",
  "candidates-page.ts",
  "bulk-prices.ts",
  "product-entry.ts",
]);
const legacyNativeForms = new Set([
  "arco/catalog.tsx",
  "core.ts",
  "main.ts",
  "product-entry.ts",
  "record-controls.ts",
  "pages.ts",
  "imports-page.ts",
  "candidates-page.ts",
  "procurement-page.ts",
  "sources-screen.ts",
  "recycle-bin.ts",
  "collection-builder.ts",
  "logs-page.ts",
  "publishing-workspace.ts",
  "distribution-center.ts",
  "studio-publisher.ts",
  "cost-batch.ts",
  "dictionaries-page.ts",
]);
for (const file of walk(sourceRoot).filter((file) => /\.tsx?$/.test(file))) {
  const relative = path.relative(sourceRoot, file);
  const text = fs.readFileSync(file, "utf8");
  if (relative.startsWith("foundation/")) {
    if (/\b(?:fetch|request)\s*\(/.test(text))
      errors.push(
        `${relative}: Foundation must delegate network effects to domain controllers`,
      );
    continue;
  }
  if (/<table\b/.test(text) && !legacyNativeTables.has(relative))
    errors.push(
      `${relative}: records must use Foundation; no new page table markup`,
    );
  if (/<form\b/.test(text) && !legacyNativeForms.has(relative))
    errors.push(
      `${relative}: forms must use Foundation/domain submission adapters`,
    );
  if (/\bimport\s+["'][^"']+\.css["']/.test(text) && relative !== "main.ts")
    errors.push(`${relative}: ui08.css is the only stylesheet entry`);
  if (
    /import\s*{[^}]*\b(?:ProTable|ProForm|ProDescriptions)\b[^}]*}\s*from\s*["'][^"']*foundation\/components/.test(
      text,
    )
  )
    errors.push(
      `${relative}: use the constrained record/form/detail adapters, not raw Pro defaults`,
    );
  if (/class=["'][^"']*\b(?:admin-sidebar|topbar|shell)\b/.test(text))
    errors.push(`${relative}: application layout belongs to Foundation`);
  if (
    /\b(?:from|import)\s*["'](?:antd|@ant-design\/pro-components)(?:\/|["'])/.test(
      text,
    )
  )
    errors.push(`${relative}: use Foundation adapters for AntD/ProComponents`);
  if (text.includes("@arco-design/"))
    errors.push(
      `${relative}: Arco runtime dependency is retired; use Foundation adapters`,
    );
}
const main = fs.readFileSync(path.join(sourceRoot, "main.ts"), "utf8");
if (
  !main.includes("mountAppShell(app,") ||
  !main.includes("applyDesignTokens();")
)
  errors.push("main.ts: real entry must use Foundation shell and tokens");
const css = fs.readFileSync(path.join(sourceRoot, "ui08.css"), "utf8");
if (!css.includes("@layer foundation"))
  errors.push("ui08.css: missing Foundation layer");
let foundationStyles = "";
for (const match of css.matchAll(/@layer foundation\s*{/g)) {
  let depth = 1,
    position = match.index + match[0].length;
  const start = position;
  while (depth && position < css.length) {
    if (css[position] === "{") depth++;
    if (css[position] === "}") depth--;
    position++;
  }
  foundationStyles += css.slice(start, position - 1);
}
if (/#[\da-f]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/i.test(foundationStyles))
  errors.push(
    "Foundation CSS must reference semantic tokens, not literal colors",
  );

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(
    "Foundation source admission PASS (runtime and migration completion NOT assessed)",
  );
}
