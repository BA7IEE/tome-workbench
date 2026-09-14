import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const [backup, target] = process.argv.slice(2);
if (!backup || !/^tome_restore_[a-z0-9]+$/.test(target || ""))
  throw new Error(
    "Usage: npm run restore -- /trusted/backup tome_restore_check; target must be new isolated tome_restore_*",
  );
if (process.env.EXTERNAL_EFFECTS_ENABLED === "true")
  throw new Error("Disable external effects");
const root = path.resolve(backup),
  manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
if (manifest.format !== 1) throw new Error("Unknown backup format");
for (const [name, hash] of Object.entries(manifest.files)) {
  const p = path.resolve(root, name);
  if (
    !p.startsWith(root + path.sep) ||
    fs.lstatSync(p).isSymbolicLink() ||
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") !==
      hash
  )
    throw new Error("Backup integrity failed: " + name);
}
if (!manifest.files["database.dump"]) throw new Error("Missing dump");
const container =
  process.env.TOME_PG_CONTAINER ||
  spawnSync("docker", ["compose", "ps", "-q", "postgres"], {
    encoding: "utf8",
  }).stdout.trim();
if (!container) throw new Error("No dedicated postgres container");
function run(args, input) {
  const p = spawnSync(
    "docker",
    ["exec", ...(input ? ["-i"] : []), container, ...args],
    {
      input,
      encoding: input ? undefined : "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (p.status !== 0)
    throw new Error("Restore command failed; no existing DB is overwritten");
  return p.stdout;
}
// createdb refuses an existing name; never drop/reset/overwrite a database.
run(["createdb", "-U", "tome", target]);
run(
  [
    "pg_restore",
    "-U",
    "tome",
    "-d",
    target,
    "--no-owner",
    "--no-acl",
    "--single-transaction",
  ],
  fs.readFileSync(path.join(root, "database.dump")),
);
const media = path.resolve("data", "restore-" + target);
if (fs.existsSync(media))
  throw new Error("Restore media destination already exists");
fs.cpSync(path.join(root, "media"), media, { recursive: true });
fs.chmodSync(media, 0o700);
console.log(
  "Restored to " +
    target +
    "; media " +
    media +
    "; no API, Worker or external action started. Compare data and TM sequence before approved cutover.",
);
