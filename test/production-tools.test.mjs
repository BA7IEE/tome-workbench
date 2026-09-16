import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { releaseVersion, versionChecks } from "../scripts/release-version.mjs";

test("configuration generator derives an arbitrary package version and refuses overwrite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tome-config-test-"));
  try {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ version: "1.0.1-rc.937" }),
    );
    const args = [
      path.resolve("scripts/production-config.mjs"),
      "--rehearsal",
      "--dir=config",
    ];
    execFileSync(process.execPath, args, { cwd: dir, stdio: "pipe" });
    assert.match(
      fs.readFileSync(path.join(dir, "config/compose.env"), "utf8"),
      /TOME_IMAGE_TAG=1\.0\.1-rc\.937\n/,
    );
    const config = JSON.parse(
      fs.readFileSync(path.join(dir, "config/configuration.json"), "utf8"),
    );
    assert.equal(config.appVersion, "1.0.1-rc.937");
    assert.equal(config.rehearsal, true);
    assert.equal(config.publicBind, false);
    assert.throws(() =>
      execFileSync(process.execPath, args, { cwd: dir, stdio: "pipe" }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight rejects stale configuration, either API and either worker version", () => {
  const v = releaseVersion();
  const observations = Object.fromEntries(
    [
      "api-a-image-version",
      "api-b-image-version",
      "worker-a-image-version",
      "worker-b-image-version",
      "api-a-runtime-version",
      "api-b-runtime-version",
      "public-api-version",
    ].map((key) => [key, v]),
  );
  assert.ok(versionChecks(v, v, v, observations).every((c) => c.pass));
  for (const key of Object.keys(observations)) {
    for (const wrong of ["0.0.0", null, undefined]) {
      assert.equal(
        versionChecks(v, v, v, { ...observations, [key]: wrong }).find(
          (c) => c.id === key,
        ).pass,
        false,
      );
    }
  }
  assert.equal(versionChecks(v, "0.0.0", v, observations)[0].pass, false);
  assert.equal(versionChecks(v, v, "dev", observations)[1].pass, false);
});
