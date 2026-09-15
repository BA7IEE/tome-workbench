const { defineConfig } = require("@playwright/test");
const base = require("./playwright.config.cjs");
module.exports = defineConfig({
  ...base,
  testMatch: [
    "product-library.spec.cjs",
    "studio.spec.cjs",
    "dictionaries.spec.cjs",
    "interaction.spec.cjs",
    "operations.spec.cjs",
    "workbench.spec.cjs",
    "ui08.spec.cjs",
    "system-review.spec.cjs",
    "ux2.spec.cjs",
    "ux09-audit.spec.cjs",
    "ux09.spec.cjs",
    "ux10.spec.cjs",
    "procurement.spec.cjs",
    "v1-item-center.spec.cjs",
  ],
  use: { ...base.use, browserName: "webkit" },
  reporter: [["list"], ["json", { outputFile: "reports/browser-webkit.json" }]],
  outputDir: "data/browser-webkit-artifacts",
});
