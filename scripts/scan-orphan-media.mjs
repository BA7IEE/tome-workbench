import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
const require = createRequire(import.meta.url);
const { maintenance, dbName } = require("./runtime-lock.cjs");
const originalPattern = /^[a-f0-9-]{36}\.original$/;
export async function scanMedia(
  db,
  directory,
  { apply = false, now = Date.now() } = {},
) {
  const root = path.resolve(directory);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Media directory must be a real directory");
  const references = new Set(
    (
      await Promise.all([
        db.asset.findMany({ select: { objectKey: true } }),
        db.intakeFile.findMany({ select: { objectKey: true } }),
        db.ingestCandidateAsset.findMany({ select: { objectKey: true } }),
      ])
    )
      .flat()
      .map((r) => r.objectKey),
  );
  const entries = new Map();
  const ignored = [];
  for (const name of await fs.readdir(root)) {
    const stat = await fs.lstat(path.join(root, name));
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !originalPattern.test(name.replace(/\.webp$/, ""))
    ) {
      ignored.push(name);
      continue;
    }
    entries.set(name, stat);
  }
  const report = {
    orphanOriginals: [],
    missingPreviews: [],
    missingOriginals: [],
    orphanPreviews: [],
    deleted: [],
    ignored,
  };
  for (const key of references) {
    if (!entries.has(key)) report.missingOriginals.push(key);
    if (!entries.has(key + ".webp")) report.missingPreviews.push(key);
  }
  for (const [name] of entries) {
    const key = name.replace(/\.webp$/, "");
    if (name === key && !references.has(key)) report.orphanOriginals.push(name);
    if (name !== key && !entries.has(key)) report.orphanPreviews.push(name);
    // The caller must hold the exclusive maintenance gate for the entire scan.
    // Both files must be unreferenced and at least 24 hours old.
    const pair = [entries.get(key), entries.get(key + ".webp")].filter(Boolean);
    if (
      apply &&
      !references.has(key) &&
      pair.every((s) => now - s.mtimeMs >= 86400000)
    ) {
      await fs.unlink(path.join(root, name));
      report.deleted.push(name);
    }
  }
  return report;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dbName();
  // Reuse the application's database/media isolation and external-effect rules.
  const { config } = require("../dist/common/config.js");
  const cfg = config();
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--offline-confirmed"))
    throw new Error(
      "Deletion requires --apply --offline-confirmed and stopped API/Worker",
    );
  const release = apply ? await maintenance() : async () => {};
  const db = new PrismaClient();
  try {
    console.log(
      JSON.stringify(await scanMedia(db, cfg.mediaDir, { apply }), null, 2),
    );
  } finally {
    await db.$disconnect();
    await release();
  }
}
