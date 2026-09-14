import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(f);
    else if (/\.(mjs|cjs|js)$/.test(f)) files.push(f);
  }
}
walk("scripts");
walk("test");
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stderr || "Syntax check failed: " + f);
    process.exitCode = 1;
  }
}
if (!process.exitCode)
  console.log(`SYNTAX_OK ${files.length} executable JavaScript files`);
