import { sourceFingerprint } from "./source-fingerprint.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import archiver from "archiver";
const dirs = [
  "agent",
  "deploy",
  "src",
  "tools",
  "web",
  "prisma",
  "scripts",
  "test",
  "harness",
  "docs",
  ".github",
];
const files = [
  "Dockerfile",
  "compose.production.yaml",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.mjs",
  "playwright.config.cjs",
  "playwright.webkit.config.cjs",
  "eslint.config.mjs",
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "compose.yaml",
  "README.md",
  "AGENTS.md",
  "启动工作台.command",
  "启动工作台.bat",
];
const entries = [];
function walk(p) {
  for (const d of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, d.name);
    if (d.isSymbolicLink()) throw new Error("No symlinks in release");
    if (d.isDirectory()) walk(f);
    else entries.push(f);
  }
}
for (const d of dirs) walk(d);
entries.push(...files);
entries.sort();
const verification = JSON.parse(
  fs.readFileSync(
    `docs/validation/${JSON.parse(fs.readFileSync("package.json", "utf8")).version}/summary.json`,
    "utf8",
  ),
);
if (
  verification.passed !== true ||
  verification.sourceUnchanged !== true ||
  verification.sourceSha256 !== sourceFingerprint().sha256 ||
  verification.fullHarnessExitCode !== 0
)
  throw new Error(
    "Release source differs from the verified baseline; rerun verification before packaging",
  );
for (const entry of entries) {
  if (
    /(?:^|\/)(?:data|node_modules|backups|reports)(?:\/|$)/.test(entry) ||
    /(?:^|\/)\.env(?!\.example$)/.test(entry) ||
    /\.(?:key|pem|p12)$/.test(entry)
  )
    throw new Error("Private file would enter release: " + entry);
}

const manifest = {
  version: JSON.parse(fs.readFileSync("package.json", "utf8")).version,
  createdAt: new Date().toISOString(),
  sourceSha256: verification.sourceSha256,
  boundary:
    "Verified internal-workbench candidate; public deployment requires operations approval",
  files: Object.fromEntries(
    entries.map((f) => [
      f,
      crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"),
    ]),
  ),
};
fs.mkdirSync("release", { recursive: true });
const name = `release/tome-workbench-${manifest.version}.zip`,
  out = fs.createWriteStream(name),
  zip = archiver("zip", { zlib: { level: 9 } });
zip.pipe(out);
for (const f of entries)
  zip.file(f, {
    name: `tome-workbench/${f}`,
    mode:
      f.endsWith(".command") || f === "tools/tome-ingest/cli.mjs"
        ? 0o755
        : 0o644,
  });
zip.append(JSON.stringify(manifest, null, 2), {
  name: "tome-workbench/SHA256-MANIFEST.json",
});
await zip.finalize();
await new Promise((resolve, reject) => {
  out.on("close", resolve);
  out.on("error", reject);
});
console.log(name + " " + fs.statSync(name).size + " bytes");
