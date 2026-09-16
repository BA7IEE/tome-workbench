import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export function sourceFingerprint(root = process.cwd()) {
  const files = [];
  const visit = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), {
      withFileTypes: true,
    })) {
      const f = path.posix.join(dir, e.name);
      if (e.isSymbolicLink())
        throw new Error("Symlinks are not release inputs");
      if (e.isDirectory()) visit(f);
      else if (!e.name.startsWith(".DS_")) files.push(f);
    }
  };
  for (const d of [
    "src",
    "web",
    "prisma",
    "scripts",
    "test",
    "harness",
    "deploy",
    ".github",
  ])
    visit(d);
  for (const f of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.mjs",
    "playwright.config.cjs",
    "playwright.webkit.config.cjs",
    "eslint.config.mjs",
    "Dockerfile",
    "compose.yaml",
    "compose.production.yaml",
    ".env.example",
    ".dockerignore",
    ".gitignore",
    "README.md",
    "AGENTS.md",
    "docs/ARCHITECTURE.md",
    "docs/CURRENT-RELEASE.md",
    "docs/CURRENT-ARCHITECTURE.md",
    "docs/CURRENT-BUSINESS-RULES.md",
    "docs/PRODUCTION.md",
    "docs/OPERATIONS.md",
    "docs/AC_MATRIX.md",
    "启动工作台.command",
    "启动工作台.bat",
  ])
    files.push(f);
  const hashes = Object.fromEntries(
    files.sort().map((f) => [
      f,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, f)))
        .digest("hex"),
    ]),
  );
  return {
    sha256: crypto
      .createHash("sha256")
      .update(JSON.stringify(hashes))
      .digest("hex"),
    files: hashes,
  };
}
