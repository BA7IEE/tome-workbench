import fs from "node:fs";
import { currentDocsChecks } from "./check-current-docs.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const required = [
  "src/catalog/materials.controller.ts",
  "web/src/materials.ts",
  "web/src/imports-page.ts",
  "web/src/work-storage.ts",
  "test/browser/arco-workspace.spec.cjs",
  "test/browser/product-library.spec.cjs",
  "test/browser/ux101.spec.cjs",
  "test/browser/login.cjs",
  "docs/contracts/product-materials.md",
  "prisma/migrations/202609150011_product_materials/migration.sql",
  "src/catalog/test-data.controller.ts",
  "web/src/test-data.ts",
  "web/src/bulk-dictionaries.ts",
  "prisma/migrations/202609120007_test_data_scope/migration.sql",
  "src/catalog/trash.controller.ts",
  "web/src/recycle-bin.ts",
  "prisma/migrations/202609110005_item_recycle_bin/migration.sql",
  "web/src/product-entry.ts",
  "web/src/product-fields.ts",
  "web/src/product-upload-queue.ts",
  "web/src/catalog-context.ts",
  "web/src/admin-navigation.ts",
  "src/catalog/catalog-query.ts",
  "test/browser/operations.spec.cjs",
  "web/src/product-editor.ts",
  "web/src/catalog-screen.ts",
  "web/src/publishing-workspace.ts",
  "web/src/media-uploader.ts",
  "web/src/sources-screen.ts",
  "src/publishing/drafts.controller.ts",
  "src/media/actions.controller.ts",
  "scripts/verify-release.mjs",
  "Dockerfile",
  "compose.production.yaml",
  "deploy/Caddyfile",
  "scripts/migrate-safe.mjs",
  "scripts/probe.mjs",
  "scripts/supervise-container.mjs",
  "scripts/validate-syntax.mjs",
  "test/high-availability.test.mjs",
  "AGENTS.md",
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/OPERATIONS.md",
  "docs/AC_MATRIX.md",
  "docs/PROVENANCE.md",
  "docs/V1-ITEM-CENTER.md",
  "docs/AGENT-INGEST-PROTOCOL.md",
  "docs/RELEASE-NOTES-1.0.md",
  "package-lock.json",
  "prisma/schema.prisma",
  "prisma/migrations/202609100001_initial/migration.sql",
  "harness/sealed.json",
  "test/unit.test.cjs",
  "test/integration.test.cjs",
  "test/browser/workbench.spec.cjs",
  "test/browser/interaction.spec.cjs",
  "test/harness.test.cjs",
  "scripts/backup.mjs",
  "scripts/restore.mjs",
  "scripts/package.mjs",
  ".github/workflows/ci.yml",
  "src/dictionaries/dictionary.controller.ts",
  "src/dictionaries/dictionary-initializer.ts",
  "src/dictionaries/item-dictionaries.ts",
  "web/src/dictionary-picker.ts",
  "web/src/dictionaries-page.ts",
  "src/operations/logs.controller.ts",
  "web/src/logs-page.ts",
  "test/browser/dictionaries.spec.cjs",
  "prisma/migrations/202609110006_dictionary_catalog/migration.sql",
  "src/catalog/approve-revision.ts",
  "src/publishing/studio.controller.ts",
  "web/src/studio-fields.ts",
  "web/src/studio-publisher.ts",
  "web/src/studio-media.ts",
  "web/src/studio-stock.ts",
  "test/browser/studio.spec.cjs",
  "test/browser/ui08.spec.cjs",
  "test/browser/system-review.spec.cjs",
  "web/src/ui08.css",
  "test/browser/reveal-section.cjs",
  "test/browser/ux2.spec.cjs",
  "test/browser/dictionary-control.cjs",
  "test/browser/ux09.spec.cjs",
  "test/browser/ux09-audit.spec.cjs",
  "web/src/quick-intake.ts",
  "web/src/quick-edit.ts",
  "test/browser/ux10.spec.cjs",
  "src/procurement/procurement.schemas.ts",
  "src/procurement/procurement.logic.ts",
  "src/procurement/procurement.controller.ts",
  "web/src/procurement-page.ts",
  "prisma/migrations/202609120008_procurement_records/migration.sql",
  "test/browser/procurement.spec.cjs",
  "src/ingest/ingest.schemas.ts",
  "src/ingest/ingest.logic.ts",
  "src/ingest/ingest.service.ts",
  "src/ingest/ingest.controller.ts",
  "src/costing/costing.schemas.ts",
  "src/costing/costing.logic.ts",
  "src/costing/costing.service.ts",
  "src/costing/costing.controller.ts",
  "src/procurement/procurement.service.ts",
  "web/src/candidates-page.ts",
  "test/browser/v1-item-center.spec.cjs",
  "prisma/migrations/202609130009_item_centric_v1/migration.sql",
];
export function checks(
  read = (p) => fs.readFileSync(path.join(root, p), "utf8"),
) {
  const results = [];
  const check = (id, fn) => {
    try {
      results.push({ id, pass: !!fn() });
    } catch (e) {
      results.push({ id, pass: false, reason: e.message });
    }
  };
  for (const p of required) check("file:" + p, () => read(p).length > 20);
  // Retired stylesheet presence is no longer a UX gate; the shared owner and
  // the existing studio/ux2 browser behavior are the current contract.
  check("single-visual-owner", () => {
    const imports = [
      ...read("web/src/main.ts").matchAll(
        /import\s+["'](\.\/[^"']+\.css)["']/g,
      ),
    ].map((match) => match[1]);
    return (
      imports.length === 1 &&
      imports[0] === "./ui08.css" &&
      read("web/src/ui08.css").startsWith(
        "@layer arco-base, workbench, arco, product;",
      )
    );
  });
  check(
    "no-real-external-default",
    () =>
      read(".env.example").includes("EXTERNAL_EFFECTS_ENABLED=false") &&
      read("src/common/config.ts").includes(
        "禁止开启 EXTERNAL_EFFECTS_ENABLED",
      ),
  );
  check(
    "database-isolation",
    () =>
      read("src/common/config.ts").includes("禁止连接 SRVF") &&
      read("scripts/db-test-guard.cjs").includes("/tome_test"),
  );
  check("test-reset-guard", () =>
    read("test/integration.test.cjs").includes("guardDatabase(url.toString())"),
  );
  check("browser-no-reused-server", () =>
    /reuseExistingServer\s*:\s*false/.test(read("playwright.config.cjs")),
  );
  check("no-skipped-tests", () =>
    [
      "test/browser/arco-workspace.spec.cjs",
      "test/browser/product-library.spec.cjs",
      "test/browser/ux101.spec.cjs",
      "test/unit.test.cjs",
      "test/integration.test.cjs",
      "test/browser/workbench.spec.cjs",
      "test/browser/interaction.spec.cjs",
      "test/browser/dictionaries.spec.cjs",
      "test/browser/studio.spec.cjs",
      "test/browser/ui08.spec.cjs",
      "test/browser/system-review.spec.cjs",
      "web/src/ui08.css",
      "test/browser/ux2.spec.cjs",
      "test/browser/ux09-audit.spec.cjs",
      "test/browser/ux09.spec.cjs",
      "test/browser/ux10.spec.cjs",
      "test/browser/procurement.spec.cjs",
      "test/browser/v1-item-center.spec.cjs",
      "test/browser/operations.spec.cjs",
      "test/harness.test.cjs",
      "test/high-availability.test.mjs",
    ].every((p) => !/^\s*(?:test|it)\.(?:skip|todo|only)\s*\(/m.test(read(p))),
  );
  check("inventory-database-constraints", () =>
    [
      "Reservation_one_active_item",
      "Sale_one_open_sale_in_cycle",
      "Item_current_cycle_anchor",
      "Item_approved_revision_anchor",
      "UsePackage_append_only",
      "Sale_complete_return",
    ].every((x) =>
      read("prisma/migrations/202609100001_initial/migration.sql").includes(x),
    ),
  );
  check(
    "domain-has-no-network",
    () =>
      !/(?:\bfetch\s*\(|\baxios\b|\bopenai\b|\bhttps?:\/\/)/.test(
        read("src/common/domain.ts"),
      ),
  );
  check(
    "domain-has-no-prisma",
    () => !/@prisma|PrismaService/.test(read("src/common/domain.ts")),
  );
  check("keep-secrets-out", () =>
    [".env", "data/", "node_modules/"].every((x) =>
      read(".gitignore").includes(x),
    ),
  );
  check("fixed-dependencies", () => {
    const p = JSON.parse(read("package.json"));
    return Object.values({ ...p.dependencies, ...p.devDependencies }).every(
      (v) => /^\d+\.\d+\.\d+$/.test(v),
    );
  });
  for (const row of currentDocsChecks(read)) check(row.id, () => row.pass);
  check("release-version-source", () => {
    const generator = read("scripts/production-config.mjs");
    const compose = read("compose.production.yaml");
    return (
      generator.includes("releaseVersion()") &&
      !/TOME_IMAGE_TAG=\d+\.\d+\.\d+/.test(generator) &&
      !/TOME_IMAGE_TAG:-/.test(compose) &&
      compose.includes("TOME_IMAGE_TAG:?") &&
      read("Dockerfile").includes(
        "org.opencontainers.image.version=$APP_VERSION",
      )
    );
  });
  check("sealed-migrations", () =>
    Object.entries(JSON.parse(read("harness/sealed.json")).files).every(
      ([p, h]) =>
        crypto.createHash("sha256").update(read(p)).digest("hex") === h,
    ),
  );
  check("all-migrations-sealed", () => {
    const sealed = JSON.parse(read("harness/sealed.json")).files;
    const names = fs
      .readdirSync(path.join(root, "prisma/migrations"))
      .filter((n) =>
        fs.existsSync(path.join(root, "prisma/migrations", n, "migration.sql")),
      );
    return (
      names.every((n) => sealed[`prisma/migrations/${n}/migration.sql`]) &&
      Object.keys(sealed).length === names.length
    );
  });
  check("runtime-heartbeat-api", () =>
    read("scripts/runtime-lock.cjs").includes("release.heartbeat"),
  );
  check("worker-probe-uuid", () =>
    read("scripts/probe.mjs").includes("ANY($1::uuid[])"),
  );
  check(
    "complete-local-installer",
    () =>
      !read("scripts/start-local.mjs").includes("init-env.mjs") &&
      read("scripts/start-local.mjs").includes("migrate-safe.mjs"),
  );
  check(
    "non-root-production-image",
    () =>
      read("Dockerfile").includes("USER node") &&
      read("compose.production.yaml").includes("read_only: true"),
  );
  check("production-db-privilege-guard", () =>
    read("scripts/runtime-lock.cjs").includes("least-privilege database role"),
  );
  check(
    "interaction-tests-use-real-clicks",
    () => !/force\s*:\s*true/.test(read("test/browser/interaction.spec.cjs")),
  );
  check(
    "v1-agent-boundary",
    () =>
      read("src/auth/auth.ts").includes("MachineIngest") &&
      read("src/ingest/ingest.controller.ts").includes("agent-ingest") &&
      read("test/integration.test.cjs").includes("Agent短期Token只能写采集层"),
  );
  check("v1-item-center-webkit", () =>
    read("playwright.webkit.config.cjs").includes("v1-item-center.spec.cjs"),
  );
  check(
    "v1-candidate-batch-100",
    () =>
      read("test/browser/v1-item-center.spec.cjs").includes(
        "101件时确认一页后只剩1件",
      ) &&
      read("src/ingest/ingest.controller.ts").includes("max(100).default(100)"),
  );
  check(
    "v1-source-facts-do-not-become-local-condition",
    () =>
      read("test/integration.test.cjs").includes(
        "来源Sold/Excellent/颜色不污染本地库存与标准字段",
      ) &&
      read("src/ingest/ingest.service.ts").includes("attrs.sourceCondition") &&
      read("src/ingest/ingest.service.ts").includes("attrs.sourceColor"),
  );
  check(
    "v1-cost-snapshot",
    () =>
      read("src/trading/trading.service.ts").includes("costSnapshot") &&
      read("src/costing/costing.service.ts").includes(
        "PROCUREMENT_COST_APPLIED",
      ),
  );
  check(
    "v1-candidate-identity-dedupe",
    () =>
      read("src/ingest/ingest.service.ts").includes(
        "POSSIBLE_DUPLICATE_ITEM",
      ) &&
      read("src/ingest/ingest.service.ts").includes("linkCandidateToItem") &&
      read("test/integration.test.cjs").includes("同图候选阻止静默重复建TM") &&
      read("test/browser/v1-item-center.spec.cjs").includes(
        "同图候选在待确认页提示已有TM",
      ),
  );
  check("webkit-in-full-harness", () =>
    JSON.parse(read("package.json")).scripts["harness:full"].includes(
      "test:browser:webkit",
    ),
  );
  check("browser-suite-parity", () => {
    const chromium = read("playwright.config.cjs"),
      webkit = read("playwright.webkit.config.cjs"),
      files = fs
        .readdirSync(path.join(root, "test/browser"))
        .filter((name) => name.endsWith(".spec.cjs"))
        .sort(),
      listed = [...webkit.matchAll(/["']([^"']+\.spec\.cjs)["']/g)]
        .map((match) => match[1])
        .sort();
    return (
      chromium.includes("testDir:'./test/browser'") &&
      !/testMatch|testIgnore/.test(chromium) &&
      !/testIgnore/.test(webkit) &&
      JSON.stringify(files) === JSON.stringify(listed)
    );
  });
  check(
    "product-library-both-browsers",
    () =>
      read("playwright.webkit.config.cjs").includes(
        "product-library.spec.cjs",
      ) &&
      read("playwright.config.cjs").includes("testDir:'./test/browser'") &&
      !/force\s*:\s*true/.test(read("test/browser/product-library.spec.cjs")),
  );
  check(
    "arco-workspace-both-browsers",
    () =>
      read("playwright.webkit.config.cjs").includes(
        "arco-workspace.spec.cjs",
      ) &&
      read("playwright.config.cjs").includes("testDir:'./test/browser'") &&
      !/force\s*:\s*true/.test(read("test/browser/arco-workspace.spec.cjs")),
  );
  return results;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--seal")) {
    if (!process.argv.includes("--acknowledge-baseline-change"))
      throw new Error("Seal requires reviewed baseline change acknowledgement");
    fs.mkdirSync(path.join(root, "harness"), { recursive: true });
    const prior = fs.existsSync(path.join(root, "harness/sealed.json"))
      ? JSON.parse(
          fs.readFileSync(path.join(root, "harness/sealed.json"), "utf8"),
        ).files
      : {};
    const files = { ...prior };
    for (const [p, h] of Object.entries(prior)) {
      if (
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(root, p)))
          .digest("hex") !== h
      )
        throw new Error("Cannot reseal a modified applied migration: " + p);
    }
    for (const n of fs.readdirSync(path.join(root, "prisma/migrations"))) {
      const p = `prisma/migrations/${n}/migration.sql`;
      if (fs.existsSync(path.join(root, p)))
        files[p] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(root, p)))
          .digest("hex");
    }
    fs.writeFileSync(
      path.join(root, "harness/sealed.json"),
      JSON.stringify(
        {
          policy:
            "Applied migrations are immutable. Add new migrations; never reseal silently.",
          files,
        },
        null,
        2,
      ) + "\n",
    );
  }
  const results = checks();
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "reports/harness.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        kind: "static-guard-not-runtime-or-business-approval",
        results,
      },
      null,
      2,
    ),
  );
  for (const x of results)
    console.log(
      `${x.pass ? "PASS" : "FAIL"} ${x.id}${x.reason ? " " + x.reason : ""}`,
    );
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}
