import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { sourceFingerprint } from "./source-fingerprint.mjs";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version))
  throw new Error("Invalid release version");
function syncCurrentValidationFacts(releaseVersion, sourceSha256) {
  const reportPath = path.join("docs", "VALIDATION.md");
  const report = fs.readFileSync(reportPath, "utf8");
  const withVersion = report.replace(
    /^# 当前验证记录 — [^\n]+$/m,
    `# 当前验证记录 — ${releaseVersion}`,
  );
  if (!/^# 当前验证记录 — [^\n]+$/m.test(report))
    throw new Error("Current validation report has no version heading");
  const sourcePattern = /(验证源码指纹为\s*\n`)[a-f0-9]{64}(`)/m;
  if (!sourcePattern.test(withVersion))
    throw new Error("Current validation report has no source fingerprint");
  const next = withVersion.replace(sourcePattern, `$1${sourceSha256}$2`);
  fs.writeFileSync(reportPath, next);
}
function syncCurrentValidationEvidence(summary) {
  const reportPath = path.join("docs", "VALIDATION.md");
  let report = fs.readFileSync(reportPath, "utf8");
  const completionPattern =
    /^(?:远端|本地)完整验证完成：[^\n]*验证源码指纹为$/m;
  if (!completionPattern.test(report))
    throw new Error("Current validation report has no completion evidence line");
  const runId = process.env.GITHUB_RUN_ID || "",
    headSha = process.env.GITHUB_SHA || "";
  report = report.replace(
    completionPattern,
    runId
      ? `远端完整验证完成：\`${summary.finishedAt}\`（GitHub Actions run \`${runId}\`，checkout \`${headSha}\`）。验证源码指纹为`
      : `本地完整验证完成：\`${summary.finishedAt}\`。验证源码指纹为`,
  );
  const replaceRow = (label, value) => {
    const prefix = `| ${label} |`;
    const lines = report.split("\n");
    const matches = lines
      .map((line, index) => ({ line, index }))
      .filter((entry) => entry.line.startsWith(prefix));
    if (matches.length !== 1)
      throw new Error(`Current validation report has ${matches.length} ${label} rows`);
    lines[matches[0].index] = `| ${label} | ${value} |`;
    report = lines.join("\n");
  };
  const suites = summary.evidence.nodeSuites || [];
  if (
    suites.length !== 4 ||
    suites.some(
      (suite) =>
        !Number.isInteger(suite.tests) ||
        !Number.isInteger(suite.passed) ||
        !Number.isInteger(suite.failed),
    )
  )
    throw new Error("Current validation summary has incomplete Node suites");
  const browser = summary.evidence.browserStats,
    webkit = summary.evidence.webkitStats,
    scale = summary.evidence.launchScale?.durationsMs,
    guards = summary.evidence.staticGuards || [],
    ha = summary.evidence.highAvailability,
    recovery = summary.evidence.recovery;
  if (
    !browser ||
    !webkit ||
    !scale ||
    !ha?.passed ||
    !recovery?.passed ||
    !Number.isInteger(browser.expected) ||
    !Number.isInteger(webkit.expected) ||
    !Number.isFinite(scale.operations) ||
    !Number.isFinite(scale.dashboard) ||
    !Number.isFinite(scale.workQueue)
  )
    throw new Error("Current validation summary has incomplete release evidence");
  const suiteText = suites
    .map((suite) => `${suite.passed}/${suite.tests}`)
    .join("、");
  replaceRow(
    "Node 测试组（unit / Harness selftest / integration / HA）",
    `${suiteText}；失败均为 ${suites.reduce((sum, suite) => sum + suite.failed, 0)}`,
  );
  replaceRow(
    "Chromium",
    `${browser.expected} 通过，unexpected/skipped/flaky 均为 0，retries=0`,
  );
  replaceRow(
    "WebKit",
    `${webkit.expected} 通过，unexpected/skipped/flaky 均为 0，retries=0`,
  );
  replaceRow(
    "1,000 Item 规模基准",
    `Operations ${scale.operations.toFixed(3)}ms、Dashboard ${scale.dashboard.toFixed(3)}ms、Work Queue ${scale.workQueue.toFixed(3)}ms，均小于 1 秒`,
  );
  replaceRow(
    "完整 Harness",
    `exit ${summary.fullHarnessExitCode}，${guards.length} 项静态守卫全部通过，sourceUnchanged=${summary.sourceUnchanged}`,
  );
  const apiFailover = ha.checks?.apiCrash?.observedFailoverMs,
    workerRecovery = ha.checks?.workerCrash?.observedRecoveryMs;
  if (!Number.isFinite(apiFailover) || !Number.isFinite(workerRecovery))
    throw new Error("Current validation summary has incomplete HA timings");
  replaceRow(
    "HA",
    `8 项隔离真实进程故障检查通过；两 API 副本切换 ${apiFailover}ms、Worker 恢复 ${workerRecovery}ms，未执行外部动作`,
  );
  replaceRow(
    "Recovery",
    "本地离线恢复演练通过：运行中进程阻止备份、所选表哈希一致、TM 序列推进、原图哈希一致",
  );
  fs.writeFileSync(reportPath, report);
}
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
syncCurrentValidationFacts(version, before.sha256);
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
  ...(process.env.GITHUB_RUN_ID
    ? {
        ci: {
          runId: Number(process.env.GITHUB_RUN_ID),
          checkoutSha: process.env.GITHUB_SHA || "",
          event: process.env.GITHUB_EVENT_NAME || "",
        },
      }
    : {}),
};
fs.writeFileSync(
  summaryPath,
  JSON.stringify(summary, null, 2) + "\n",
);
syncCurrentValidationFacts(version, summary.sourceSha256);
if (summary.passed) syncCurrentValidationEvidence(summary);
fs.copyFileSync(logPath, path.join(dest, "verification.log"));
console.log(
  JSON.stringify(
    {
      version,
      passed: summary.passed,
      fullHarnessExitCode: exitCode,
      sourceUnchanged: summary.sourceUnchanged,
      sourceSha256: summary.sourceSha256,
      nodeSuites: summary.evidence.nodeSuites || [],
      browserExpected: summary.evidence.browserStats?.expected ?? null,
      webkitExpected: summary.evidence.webkitStats?.expected ?? null,
      launchScaleDurationsMs:
        summary.evidence.launchScale?.durationsMs || null,
      highAvailabilityPassed:
        summary.evidence.highAvailability?.passed ?? null,
      recoveryPassed: summary.evidence.recovery?.passed ?? null,
      error,
      log: logPath,
      summary: path.join(dest, "summary.json"),
    },
    null,
    2,
  ),
);
if (!summary.passed) process.exitCode = 1;
