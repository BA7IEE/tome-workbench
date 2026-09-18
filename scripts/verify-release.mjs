import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { sourceFingerprint } from "./source-fingerprint.mjs";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version))
  throw new Error("Invalid release version");
const before = sourceFingerprint(),
  started = Date.now();
fs.mkdirSync("reports", { recursive: true });
const dest = path.join("docs", "validation", version),
  summaryPath = path.join(dest, "summary.json");
fs.mkdirSync(dest, { recursive: true });
fs.writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      version,
      startedAt: new Date(started).toISOString(),
      sourceSha256: before.sha256,
      fullHarnessExitCode: null,
      sourceUnchanged: false,
      passed: false,
      error: "Verification in progress",
      evidence: {},
      productionDeployment: false,
    },
    null,
    2,
  ) + "\n",
);
const logPath = "reports/release-verification.log",
  stream = fs.createWriteStream(logPath, { flags: "w" });
const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "harness:full"],
  { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const channel of [child.stdout, child.stderr])
  channel.on("data", (buffer) => {
    stream.write(buffer);
    output += buffer.toString();
  });
const exitCode = await new Promise((resolve) => {
  child.once("error", (error) => {
    stream.write(error.message);
    resolve(1);
  });
  child.once("close", (code) => resolve(code === null ? 1 : code));
});
await new Promise((resolve) => stream.end(resolve));
const after = sourceFingerprint();
function report(name) {
  const file = path.join("reports", name);
  if (fs.statSync(file).mtimeMs < started)
    throw new Error("Stale verification report: " + name);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
let evidence = {},
  error = "";
try {
  const browser = report("browser.json"),
    webkit = report("browser-webkit.json"),
    ha = report("high-availability.json"),
    recovery = report("recovery.json"),
    launchScale = report("benchmark-launch-scale.json"),
    guards = report("harness.json");
  const nodeSuites = [
    ...output.matchAll(/# tests (\d+)[\s\S]*?# pass (\d+)\s*# fail (\d+)/g),
  ].map((m) => ({
    tests: Number(m[1]),
    passed: Number(m[2]),
    failed: Number(m[3]),
  }));
  evidence = {
    nodeSuites,
    browserStats: browser.stats,
    webkitStats: webkit.stats,
    highAvailability: ha,
    recovery,
    launchScale,
    staticGuards: guards.results,
  };
  if (
    exitCode !== 0 ||
    before.sha256 !== after.sha256 ||
    !ha.passed ||
    !recovery.passed ||
    !launchScale.passed ||
    Object.values(launchScale.durationsMs || {}).some(
      (duration) => typeof duration !== "number" || duration > 1000,
    ) ||
    guards.results.some((row) => !row.pass) ||
    browser.stats.flaky ||
    webkit.stats.flaky ||
    browser.stats.expected !== webkit.stats.expected ||
    browser.config.projects.some((p) => p.retries !== 0) ||
    webkit.config.projects.some((p) => p.retries !== 0) ||
    browser.stats.unexpected ||
    browser.stats.skipped ||
    webkit.stats.unexpected ||
    webkit.stats.skipped
  )
    throw new Error("Release validation incomplete or source changed");
} catch (e) {
  error = e.message;
}
const summary = {
  version,
  startedAt: new Date(started).toISOString(),
  finishedAt: new Date().toISOString(),
  sourceSha256: after.sha256,
  fullHarnessExitCode: exitCode,
  sourceUnchanged: before.sha256 === after.sha256,
  passed: !error,
  error,
  evidence,
  productionDeployment: false,
};
fs.writeFileSync(
  summaryPath,
  JSON.stringify(summary, null, 2) + "\n",
);
fs.copyFileSync(logPath, path.join(dest, "verification.log"));
console.log(
  JSON.stringify(
    {
      version,
      passed: summary.passed,
      fullHarnessExitCode: exitCode,
      sourceUnchanged: summary.sourceUnchanged,
      error,
      log: logPath,
      summary: path.join(dest, "summary.json"),
    },
    null,
    2,
  ),
);
if (!summary.passed) process.exitCode = 1;
