import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const { maintenance, dbName } = createRequire(import.meta.url)(
  "./runtime-lock.cjs",
);
if (!process.argv.includes("--offline-confirmed"))
  throw new Error(
    "Stop API + Worker; run npm run backup -- --offline-confirmed",
  );
const name = dbName();
if (
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw new Error("This local backup script only supports local DB");
const release = await maintenance();
try {
  const container =
    process.env.TOME_PG_CONTAINER ||
    spawnSync("docker", ["compose", "ps", "-q", "postgres"], {
      encoding: "utf8",
    }).stdout.trim();
  if (!container)
    throw new Error("No dedicated postgres container; set TOME_PG_CONTAINER");
  const dest = path.resolve(
    "backups",
    new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      crypto.randomBytes(3).toString("hex"),
  );
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  const dump = path.join(dest, "database.dump"),
    fd = fs.openSync(dump, "wx", 0o600);
  let run;
  try {
    run = spawnSync(
      "docker",
      [
        "exec",
        container,
        "pg_dump",
        "-U",
        "tome",
        "-d",
        name,
        "-Fc",
        "--no-owner",
        "--no-acl",
      ],
      { stdio: ["ignore", fd, "pipe"] },
    );
  } finally {
    fs.closeSync(fd);
  }
  if (run.status !== 0)
    throw new Error(
      "pg_dump failed; incomplete backup retained for inspection",
    );
  const media = path.resolve(process.env.MEDIA_DIR || "data/media");
  if (fs.existsSync(media))
    fs.cpSync(media, path.join(dest, "media"), {
      recursive: true,
      dereference: false,
    });
  else fs.mkdirSync(path.join(dest, "media"), { mode: 0o700 });
  const files = {};
  function scan(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Symlinks prohibited in backup");
      if (entry.isDirectory()) scan(p);
      else {
        fs.chmodSync(p, 0o600);
        files[path.relative(dest, p)] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(p))
          .digest("hex");
      }
    }
  }
  scan(dest);
  fs.writeFileSync(
    path.join(dest, "manifest.json"),
    JSON.stringify(
      {
        format: 1,
        database: name,
        at: new Date().toISOString(),
        externalEffects: "OFF",
        consistency: "offline-app-and-worker",
        files,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(dest);
} finally {
  await release();
}
