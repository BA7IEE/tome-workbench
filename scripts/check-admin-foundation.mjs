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
const legacyArco = new Set([
  "arco/runtime.tsx",
  "arco/catalog.tsx",
  "arco/fields.tsx",
  "arco/product-header.tsx",
  "arco/product-fields.tsx",
  "arco/catalog-pagination.tsx",
  "arco/quick-fields.tsx",
]);
for (const file of walk(sourceRoot).filter((file) => /\.tsx?$/.test(file))) {
  const relative = path.relative(sourceRoot, file);
  const text = fs.readFileSync(file, "utf8");
  if (relative.startsWith("foundation/")) continue;
  if (/class=["'][^"']*\b(?:admin-sidebar|topbar|shell)\b/.test(text))
    errors.push(`${relative}: application layout belongs to Foundation`);
  if (
    /\b(?:from|import)\s*["'](?:antd|@ant-design\/pro-components)(?:\/|["'])/.test(
      text,
    )
  )
    errors.push(`${relative}: use Foundation adapters for AntD/ProComponents`);
  if (text.includes("@arco-design/") && !legacyArco.has(relative))
    errors.push(`${relative}: new Arco dependency outside migration baseline`);
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
if (/#[\da-f]{3,8}\b/i.test(css.slice(css.lastIndexOf("@layer foundation"))))
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
