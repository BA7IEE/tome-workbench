import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFingerprint } from "./source-fingerprint.mjs";
export function currentDocsChecks(read = (p) => fs.readFileSync(p, "utf8")) {
  const version = JSON.parse(read("package.json")).version;
  const release = read("docs/CURRENT-RELEASE.md");
  const facts = JSON.parse(
    release.match(/<!-- current-facts -->\s*```json\s*([\s\S]*?)```/)?.[1] ||
      "null",
  );
  const migrations = fs
    .readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const specs = fs
    .readdirSync("test/browser")
    .filter((n) => n.endsWith(".spec.cjs"))
    .sort();
  const webkit = [
    ...read("playwright.webkit.config.cjs").matchAll(/"([^"]+\.spec\.cjs)"/g),
  ]
    .map((m) => m[1])
    .sort();
  let validation = null;
  try {
    validation = JSON.parse(read(`docs/validation/${version}/summary.json`));
  } catch {
    validation = null;
  }
  const validationReport = read("docs/VALIDATION.md");
  const validationReportVersion =
    validationReport.match(/^# 当前验证记录 — ([^\n]+)$/m)?.[1]?.trim() ||
    null;
  const validationReportSource =
    validationReport.match(/验证源码指纹为\s*\n`([a-f0-9]{64})`/m)?.[1] ||
    null;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return [
    { id: "current-release-version", pass: facts?.version === version },
    {
      id: "current-release-no-transient-state",
      pass: !/(?:未合(?:并|入)(?:到|至)?main\b|独立(?:分支|切片)(?:实现|待验收|尚未交付)|在独立分支)/i.test(
        release.replace(/[`*_\s]/g, ""),
      ),
    },
    { id: "current-migrations", pass: equal(facts?.migrations, migrations) },
    {
      id: "current-browser-scope",
      pass: equal(facts?.browserFiles, specs) && equal(specs, webkit),
    },
    {
      id: "current-validation-version",
      pass: validation?.version === version,
    },
    {
      id: "current-validation-source",
      pass: validation?.sourceSha256 === sourceFingerprint().sha256,
    },
    {
      id: "current-validation-report-version",
      pass:
        validationReportVersion === version &&
        validationReportVersion === validation?.version,
    },
    {
      id: "current-validation-report-source",
      pass:
        validationReportSource === validation?.sourceSha256 &&
        validationReportSource === sourceFingerprint().sha256,
    },
    {
      id: "current-production-version",
      pass: read("docs/PRODUCTION.md").startsWith(
        `# 生产部署与发布手册 · ${version}\n`,
      ),
    },
    {
      id: "current-agent-contract",
      pass: !/PR\s*#\d+.*(?:尚未合并|未合并|open)/i.test(read("AGENTS.md")),
    },
  ];
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const checks = currentDocsChecks();
  console.log(JSON.stringify(checks, null, 2));
  if (checks.some((c) => !c.pass)) process.exitCode = 1;
}
