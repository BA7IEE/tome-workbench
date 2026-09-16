import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return [
    { id: "current-release-version", pass: facts?.version === version },
    { id: "current-migrations", pass: equal(facts?.migrations, migrations) },
    {
      id: "current-browser-scope",
      pass: equal(facts?.browserFiles, specs) && equal(specs, webkit),
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
