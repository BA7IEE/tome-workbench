const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
async function run(p, transform) {
  const { checks } = await import("../scripts/harness.mjs");
  return checks((f) => {
    const s = fs.readFileSync(f, "utf8");
    return f === p ? transform(s) : s;
  });
}
test("harness baseline passes", async () =>
  assert.ok((await run("", (s) => s)).every((x) => x.pass)));
for (const [name, p, fn, id] of [
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
