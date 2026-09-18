const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const currentVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
async function run(p, transform) {
  const { checks } = await import("../scripts/harness.mjs");
  return checks((f) => {
    const s = fs.readFileSync(f, "utf8");
    return f === p ? transform(s) : s;
  });
}
test("harness baseline passes", async () =>
  assert.ok((await run("", (s) => s)).every((x) => x.pass)));
for (const state of [
  "未合并 main",
  "尚未合并到 `main`",
  "未合入 **main**",
  "UX 1.0.2 在独立分支实现本机选品草稿",
  "独立分支实现",
  "独立分支待验收",
  "UX 1.0.2 独立切片尚未交付",
]) {
  test(`harness rejects stale release state: ${state}`, async () => {
    const result = await run(
      "docs/CURRENT-RELEASE.md",
      (s) => `${s}\n${state}`,
    );
    assert.equal(
      result.find((x) => x.id === "current-release-no-transient-state")?.pass,
      false,
    );
  });
}
test("harness permits outstanding production and business acceptance", async () => {
  const result = await run(
    "docs/CURRENT-RELEASE.md",
    (s) =>
      `${s}\n未部署，实际异地备份、告警收件人测试和真实经营 UAT 尚未验收。`,
  );
  assert.ok(result.every((x) => x.pass));
});
for (const [name, p, fn, id] of [
  [
    "stale current version",
    "docs/CURRENT-RELEASE.md",
    (s) => s.replace(/"version": "[^"]+"/, '\"version\": \"0.0.0\"'),
    "current-release-version",
  ],
  [
    "stale production title",
    "docs/PRODUCTION.md",
    (s) => s.replace(/^.*\n/, "# old production\n"),
    "current-production-version",
  ],
  [
    "stale validation version",
    `docs/validation/${currentVersion}/summary.json`,
    (s) => s.replace(`"version": "${currentVersion}"`, '"version": "0.0.0"'),
    "current-validation-version",
  ],
  [
    "stale validation source",
    `docs/validation/${currentVersion}/summary.json`,
    (s) => s.replace(/"sourceSha256": "[^"]+"/, '"sourceSha256": "stale"'),
    "current-validation-source",
  ],
  [
    "stale validation report version",
    "docs/VALIDATION.md",
    (s) => s.replace(/^# 当前验证记录 — [^\n]+$/m, "# 当前验证记录 — 0.0.0"),
    "current-validation-report-version",
  ],
  [
    "stale validation report source",
    "docs/VALIDATION.md",
    (s) => s.replace(/验证源码指纹为\s*\n`[a-f0-9]{64}`/m, "验证源码指纹为\n`stale`"),
    "current-validation-report-source",
  ],
  [
    "stale validation artifact version",
    "docs/VALIDATION.md",
    (s) =>
      s.replace(
        `validation/${currentVersion}/summary.json`,
        "validation/0.0.0/summary.json",
      ),
    "current-validation-artifact-version",
  ],
  [
    "one-off agent PR state",
    "AGENTS.md",
    (s) => s + "\nPR #999 尚未合并",
    "current-agent-contract",
  ],
  [
    "hardcoded release tag",
    "scripts/production-config.mjs",
    (s) => s + "\n// TOME_IMAGE_TAG=0.0.1",
    "release-version-source",
  ],
  [
    "silent release default",
    "compose.production.yaml",
    (s) => s.replace("TOME_IMAGE_TAG:?", "TOME_IMAGE_TAG:-"),
    "release-version-source",
  ],
  [
    "external default",
    ".env.example",
    (s) =>
      s.replace(
        "EXTERNAL_EFFECTS_ENABLED=false",
        "EXTERNAL_EFFECTS_ENABLED=true",
      ),
    "no-real-external-default",
  ],
  [
    "DB guard",
    "src/common/config.ts",
    (s) => s.replace("禁止连接 SRVF", "允许连接旧库"),
    "database-isolation",
  ],
  [
    "reset guard",
    "test/integration.test.cjs",
    (s) => s.replace("guardDatabase(url.toString())", "void 0"),
    "test-reset-guard",
  ],
  [
    "reused browser server",
    "playwright.config.cjs",
    (s) =>
      s.replace(/reuseExistingServer\s*:\s*false/, "reuseExistingServer:true"),
    "browser-no-reused-server",
  ],
  [
    "hidden skipped tests",
    "test/unit.test.cjs",
    (s) => s + '\ntest.skip("mutant",()=>{});',
    "no-skipped-tests",
  ],
  [
    "missing UX WebKit suite",
    "playwright.webkit.config.cjs",
    (s) => s.replace('"ux101.spec.cjs",', ""),
    "browser-suite-parity",
  ],
  [
    "skipped UX browser journey",
    "test/browser/ux101.spec.cjs",
    (s) => s + '\ntest.skip("mutant",()=>{});',
    "no-skipped-tests",
  ],
  [
    "sales truth",
    "src/trading/trading.service.ts",
    (s) =>
      s.replace(
        "const saleCurrency = inquiry.currency",
        "const saleCurrency = item.currency",
      ),
    "v11-inquiry-followup-and-sale-currency",
  ],
  [
    "network in domain",
    "src/common/domain.ts",
    (s) => s + '\nfetch("untrusted");',
    "domain-has-no-network",
  ],
  [
    "mutated migration",
    "prisma/migrations/202609100001_initial/migration.sql",
    (s) => s + "\n-- mutation",
    "sealed-migrations",
  ],
  [
    "lost documentation",
    "docs/ARCHITECTURE.md",
    () => "",
    "file:docs/ARCHITECTURE.md",
  ],
  [
    "retired stylesheet import",
    "web/src/main.ts",
    (s) => s + '\nimport "./style.css";',
    "single-visual-owner",
  ],
])
  test("harness rejects " + name, async () =>
    assert.equal((await run(p, fn)).find((x) => x.id === id).pass, false),
  );
