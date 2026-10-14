// Real application + isolated tome_test fixtures; no mocked responses or session injection.
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { guardDatabase } = require("../scripts/db-test-guard.cjs");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
guardDatabase(fixture.databaseUrl);
const phase = process.argv[2];
if (!["before", "after"].includes(phase))
  throw new Error("Expected before or after");
const output = "docs/evidence/product-ux-batch2";
fs.mkdirSync(output, { recursive: true });
const server = spawn(process.execPath, ["scripts/browser-server.cjs"], {
  stdio: "ignore",
});
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const { sourceFingerprint } =
    await import("../scripts/source-fingerprint.mjs");
  const fingerprint = sourceFingerprint().sha256;
  let browser;
  try {
    for (let n = 0; n < 100; n++) {
      if (
        await fetch("http://127.0.0.1:4320/api/system/ready")
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      check(n < 99, "Isolated server readiness failed");
      await wait(100);
    }
    browser = await chromium.launch();
    const page = await browser.newPage({
      baseURL: "http://127.0.0.1:4320",
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto("http://127.0.0.1:4320/");
    await page.getByLabel("登录邮箱").fill(fixture.email);
    await page.getByLabel("密码", { exact: true }).fill(fixture.password);
    const [login] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/auth/login") &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "进入工作台" }).click(),
    ]);
    check(login.status() === 201, "Real login failed");
    await page.locator(".sidebar-bottom strong").waitFor();
    const auth = await (await page.request.get("/api/auth/me")).json();
    const headers = {
      Origin: "http://127.0.0.1:4320",
      "X-CSRF-Token": auth.csrf,
    };
    const created = await page.request.post("/api/items", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {
        title: "UX 合成样品 · 羊毛夹克",
        category: "CLOTHING",
        ownership: "OWN",
        dataMode: "TEST",
        currentPrice: 238000,
        currency: "CNY",
        facts: {
          sizeLabel: "M",
          measurements: "肩宽40cm，胸围90cm，衣长60cm",
          material: "80%羊毛、20%锦纶",
          condition: "袖口轻微磨损",
          descriptionZh: "合成测试商品，仅用于界面验收。",
        },
      },
    });
    check(created.ok(), "Synthetic item creation failed");
    const item = await created.json();
    for (let n = 0; n < 13; n++) {
      const buffer = await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="440"><rect width="360" height="440" fill="#eee8df"/><path d="M125 65 95 83 50 220 98 238 119 178 113 380 248 380 241 178 263 238 310 220 265 83 235 65 206 92 180 100 153 90Z" fill="#686253"/><text x="180" y="420" text-anchor="middle" font-size="18">SYNTHETIC ${n + 1}</text></svg>`,
        ),
      )
        .png()
        .toBuffer();
      const uploaded = await page.request.post("/api/assets/upload", {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        multipart: {
          itemId: item.id,
          role: "PRODUCT",
          origin: "OWN",
          sourceNote: "synthetic UX evidence",
          file: {
            name: `synthetic-${n + 1}.png`,
            mimeType: "image/png",
            buffer,
          },
        },
      });
      check(uploaded.ok(), "Synthetic image upload failed");
    }
    const metrics = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const capture = async (name) => {
        await page.screenshot({
          path: `${output}/${phase}-${width}-${name}.png`,
        });
        metrics.push(
          await page.evaluate(
            ({ name, width }) => {
              const root = document.querySelector("main") || document.body;
              const visible = (el) => {
                if (
                  !el.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true,
                  })
                )
                  return false;
                let b = el.getBoundingClientRect();
                let top = Math.max(0, b.top),
                  bottom = Math.min(innerHeight, b.bottom),
                  left = Math.max(0, b.left),
                  right = Math.min(innerWidth, b.right);
                for (let p = el.parentElement; p; p = p.parentElement) {
                  const s = getComputedStyle(p),
                    r = p.getBoundingClientRect();
                  if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) {
                    top = Math.max(top, r.top);
                    bottom = Math.min(bottom, r.bottom);
                  }
                  if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {
                    left = Math.max(left, r.left);
                    right = Math.min(right, r.right);
                  }
                }
                return bottom > top && right > left;
              };
              const controls = [
                ...root.querySelectorAll(
                  "button,a.ant-btn,a.btn,summary,[role=button]",
                ),
              ].filter(visible);
              return {
                name,
                width,
                visibleActions: controls.length,
                actionLabels: controls.map(
                  (el) =>
                    el.getAttribute("aria-label") || el.textContent.trim(),
                ),
                pageOverflow: document.documentElement.scrollWidth > innerWidth,
              };
            },
            { name, width },
          ),
        );
      };
      await page.goto(
        `http://127.0.0.1:4320/#/items?dataMode=TEST&q=${item.code}&view=table`,
      );
      await page.getByRole("link", { name: `编辑商品 ${item.code}` }).waitFor();
      await capture("list");
      await page.locator(`[data-pick="${item.id}"]`).check();
      await capture("selected");
      await page.getByRole("button", { name: "图片", exact: true }).click();
      await page.locator(".product-card").waitFor();
      await capture("cards");
      await page.getByRole("link", { name: `编辑商品 ${item.code}` }).click();
      await page.getByLabel("商品名称", { exact: true }).waitFor();
      await page
        .locator("[data-dictionary][data-ready=true]")
        .first()
        .waitFor();
      await page.evaluate(() => scrollTo(0, 0));
      await capture("editor");
      await page.locator(".entry-existing-media").scrollIntoViewIfNeeded();
      await capture("gallery");
      await page.locator("[data-section=dimensions]").scrollIntoViewIfNeeded();
      await capture("dimensions");
    }
    fs.writeFileSync(
      `${output}/${phase}-metrics.json`,
      JSON.stringify(
        {
          phase,
          sourceCommit: require("node:child_process")
            .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
            .trim(),
          syntheticOnly: true,
          sourceSha256: fingerprint,
          sourceUnchanged: sourceFingerprint().sha256 === fingerprint,
          metrics,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify({ phase, captures: metrics.length, metrics }));
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
