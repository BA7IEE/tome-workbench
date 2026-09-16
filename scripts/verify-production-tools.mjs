// Explicit localhost synthetic rehearsal; never accepts a public deployment.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request } from "@playwright/test";
import sharp from "sharp";
import { context, docker } from "./production-backup-lib.mjs";
const exec = promisify(execFile),
  ctx = context();
if (
  !ctx.config.rehearsal ||
  ctx.config.domain !== "localhost" ||
  ctx.project !== "tome-stabilization-rehearsal"
)
  throw new Error(
    "Only the isolated tome-stabilization-rehearsal project is permitted",
  );
const credential = await docker([
  ...ctx.compose,
  "exec",
  "-T",
  "api-a",
  "cat",
  "/app/data/first-admin.txt",
]);
const email = credential.match(/登录：([^\r\n]+)/)?.[1],
  password = credential.match(/初始密码：([^\r\n]+)/)?.[1];
if (email !== "stabilization@tome.test" || !password)
  throw new Error(
    "Create the synthetic admin through the standard admin CLI first",
  );
const client = await request.newContext({
  baseURL: ctx.config.origin,
  ignoreHTTPSErrors: true,
});
const invoke = async (file, args = []) => {
  try {
    return (
      await exec(
        process.execPath,
        [file, `--config-dir=${ctx.dir}`, `--project=${ctx.project}`, ...args],
        { maxBuffer: 2 * 1024 * 1024 },
      )
    ).stdout;
  } catch {
    throw new Error("Rehearsal step failed: " + file);
  }
};
const checks = {};
try {
  const login = await client.post("/api/auth/login", {
    headers: { Origin: ctx.config.origin },
    data: { email, password },
  });
  assert.equal(login.status(), 201);
  const { csrf } = await login.json();
  const headers = () => ({
    Origin: ctx.config.origin,
    "X-CSRF-Token": csrf,
    "Idempotency-Key": randomUUID(),
  });
  const buffer = await sharp({
    create: { width: 120, height: 150, channels: 3, background: "#cc8844" },
  })
    .png()
    .toBuffer();
  for (let n = 0; n < 3; n++) {
    const response = await client.post("/api/items", {
      headers: headers(),
      data: {
        title: `合成稳定化备份 ${n} ${randomUUID().slice(0, 8)}`,
        dataMode: "TEST",
      },
    });
    assert.equal(response.status(), 201);
    const item = await response.json();
    const h = headers(),
      multipart = {
        itemId: item.id,
        file: { name: "synthetic.png", mimeType: "image/png", buffer },
      };
    const uploaded = await client.post("/api/assets/upload", {
      headers: h,
      multipart,
    });
    assert.equal(uploaded.status(), 201);
    const asset = await uploaded.json();
    const replay = await client.post("/api/assets/upload", {
      headers: h,
      multipart,
    });
    assert.deepEqual(await replay.json(), asset);
    const original = await client.get(`/api/assets/${asset.id}/original`);
    assert.equal(
      createHash("sha256")
        .update(await original.body())
        .digest("hex"),
      createHash("sha256").update(buffer).digest("hex"),
    );
  }
  checks.realHttpOriginalReplay = true;
  let refused = false;
  try {
    await invoke("scripts/production-backup.mjs", ["--offline-confirmed"]);
  } catch {
    refused = true;
  }
  assert.equal(refused, true);
  checks.runningBackupRefused = true;
  await docker([
    ...ctx.compose,
    "stop",
    "api-a",
    "api-b",
    "worker-a",
    "worker-b",
  ]);
  try {
    const output = await invoke("scripts/production-backup.mjs", [
      "--offline-confirmed",
    ]);
    const { backup } = JSON.parse(output.trim().split("\n").at(-1));
    checks.backup = true;
    const target = "tome_restore_" + Date.now().toString(36);
    await invoke("scripts/production-restore.mjs", [
      `--backup=${backup}`,
      `--target=${target}`,
      `--media-dir=${path.join(ctx.dir, target)}`,
    ]);
    checks.restore = JSON.parse(
      fs.readFileSync("reports/production-recovery.json", "utf8"),
    );
    let duplicateRefused = false;
    try {
      await invoke("scripts/production-restore.mjs", [
        `--backup=${backup}`,
        `--target=${target}`,
        `--media-dir=${path.join(ctx.dir, target + "-duplicate")}`,
      ]);
    } catch {
      duplicateRefused = true;
    }
    assert.equal(duplicateRefused, true);
    checks.existingDatabaseRefused = true;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(backup, "manifest.json"), "utf8"),
    );
    checks.manifest = {
      appVersion: manifest.appVersion,
      modelCount: manifest.modelCount,
      migrationCount: manifest.migrationCount,
      mediaFiles: manifest.mediaFiles,
    };
  } finally {
    await docker([
      ...ctx.compose,
      "up",
      "-d",
      "--wait",
      "api-a",
      "api-b",
      "worker-a",
      "worker-b",
    ]);
  }
  const preflight = await invoke("scripts/production-preflight.mjs", [
    `--ca=${path.join(ctx.dir, "rehearsal-ca.crt")}`,
    "--allow-rehearsal",
  ]);
  const ready = JSON.parse(preflight);
  assert.equal(ready.softwareReady, true);
  assert.equal(ready.publicReady, false);
  checks.versionPreflight = true;
  fs.writeFileSync(
    "reports/production-tools.json",
    JSON.stringify(
      {
        passed: true,
        at: new Date().toISOString(),
        checks,
        publicDeployment: false,
        offHostBackupVerified: false,
        businessUat: false,
        alertDelivered: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, checks, publicDeployment: false }, null, 2),
  );
} finally {
  await client.dispose();
}
