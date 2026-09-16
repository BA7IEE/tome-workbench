import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { releaseVersion } from "./release-version.mjs";
import {
  arg,
  context,
  docker,
  offlineProject,
  maintenanceSession,
  databaseSnapshot,
  fileManifest,
  sha256,
  dumpDatabase,
  verifyBackup,
} from "./production-backup-lib.mjs";
if (!process.argv.includes("--offline-confirmed"))
  throw new Error(
    "Use --offline-confirmed after stopping API/Worker and all CLI writers",
  );
const ctx = context();
if (ctx.config.appVersion !== releaseVersion())
  throw new Error("Configuration/source version mismatch");
await offlineProject(ctx);
const db = await maintenanceSession(ctx);
try {
  const root = path.resolve(arg("--output-dir", path.join(ctx.dir, "backups")));
  const dest = path.join(
    root,
    "backup-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      crypto.randomBytes(3).toString("hex"),
  );
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  const snapshot = await databaseSnapshot(db);
  const actualMigrations = fs
    .readdirSync("prisma/migrations")
    .filter((n) => fs.existsSync(`prisma/migrations/${n}/migration.sql`))
    .sort();
  const applied = snapshot.migrations.filter((r) => !r.rolled_back);
  if (
    applied.length !== actualMigrations.length ||
    applied.some(
      (r) =>
        !r.finished ||
        !actualMigrations.includes(r.migration_name) ||
        sha256(
          fs.readFileSync(
            `prisma/migrations/${r.migration_name}/migration.sql`,
          ),
        ) !== r.checksum,
    )
  )
    throw new Error("Applied migration history differs from this source");
  await dumpDatabase(ctx, path.join(dest, "database.dump"));
  const api = await docker([...ctx.compose, "ps", "-a", "-q", "api-a"]);
  if (!api)
    throw new Error(
      "Stopped api-a container with the shared media mount is required",
    );
  fs.mkdirSync(path.join(dest, "media"), { mode: 0o700 });
  await docker(["cp", api + ":/app/data/media/.", path.join(dest, "media")]);
  const media = fileManifest(path.join(dest, "media"));
  const refs = JSON.parse(
    await db.query(
      `SELECT COALESCE(json_agg(x),'[]') FROM (SELECT "objectKey","sha256" FROM "Asset" UNION SELECT "objectKey","sha256" FROM "IntakeFile" UNION SELECT "objectKey","sha256" FROM "IngestCandidateAsset") x`,
    ),
  );
  for (const row of refs)
    if (media[row.objectKey] !== row.sha256)
      throw new Error(
        "Referenced original missing or corrupt; backup is incomplete",
      );
  const save = (name, value) =>
    fs.writeFileSync(
      path.join(dest, name),
      JSON.stringify(value, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
  save("media-manifest.json", media);
  save("migration-manifest.json", snapshot.migrations);
  save("model-manifest.json", {
    models: snapshot.models,
    sequence: snapshot.sequence,
  });
  if (JSON.stringify(await databaseSnapshot(db)) !== JSON.stringify(snapshot))
    throw new Error("Database changed during maintenance backup");
  const files = fileManifest(dest);
  const createdAt = new Date().toISOString();
  save("manifest.json", {
    format: 1,
    appVersion: releaseVersion(),
    database: "tome_production",
    at: createdAt,
    createdAt,
    migrationCount: applied.length,
    mediaFiles: Object.keys(media).length,
    modelCount: Object.keys(snapshot.models).length,
    databaseSha256: files["database.dump"],
    mediaManifestSha256: files["media-manifest.json"],
    consistency: "offline-app-and-worker-exclusive-maintenance-lock",
    externalEffects: "OFF",
    rehearsal: ctx.config.rehearsal,
    files,
    offHostVerified: false,
  });
  const hashes = {
    ...files,
    "manifest.json": sha256(fs.readFileSync(path.join(dest, "manifest.json"))),
  };
  fs.writeFileSync(
    path.join(dest, "checksums.sha256"),
    Object.entries(hashes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([n, h]) => `${h}  ${n}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  verifyBackup(dest);
  console.log(
    JSON.stringify({
      backup: dest,
      verified: true,
      offHostVerified: false,
      servicesRestarted: false,
    }),
  );
} finally {
  db.close();
}
