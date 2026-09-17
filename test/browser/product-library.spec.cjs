const { submitLogin, fillLogin } = require("./login.cjs");
const { test, expect } = require("@playwright/test");
const { randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs");
const sharp = require("sharp");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/#/items");
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
  await expect(
    page.getByRole("heading", { name: "商品", exact: true }),
  ).toBeVisible();
}
async function api(page, path, body, method = "POST", key = randomUUID()) {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const r = await page.request.fetch("/api" + path, {
    method,
    ...(body !== undefined ? { data: body } : {}),
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": key,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function machine(page, path, token, body) {
  const r = await page.request.post("/api" + path, {
    data: body,
    headers: { "X-Ingest-Token": token, "Idempotency-Key": randomUUID() },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
function standardManifest(extra = {}) {
  return {
    ...extra,
    protocolVersion: "1.2",
    skillVersion: "tome-ingest/1.0",
    profile: "GENERIC_MARKETPLACE/1.0",
  };
}
const genericProfileFields = [
  ["titleRaw", "商品名称"],
  ["sourceItemKey", "来源货号"],
  ["brandRaw", "来源品牌"],
  ["categoryRaw", "来源品类"],
  ["conditionRaw", "来源成色"],
  ["sourceFacts.sizeLabel", "标签尺码"],
  ["sourceFacts.productUrl", "来源页面"],
  ["sourceFacts.description", "来源描述"],
  ["sourceCurrentPrice", "来源当前价"],
];
async function makeBatch(page, count, gaps = false) {
  const suffix = randomUUID().slice(0, 8),
    source = await api(page, "/procurement/sources", {
      code: "MVP" + suffix.toUpperCase(),
      name: "MVP批量 " + suffix,
      kind: "OFFLINE",
      defaultCurrency: "CNY",
    });
  const session = await api(page, "/ingest/sessions", {
    procurementSourceId: source.id,
    label: "合成测试",
    ttlMinutes: 60,
  });
  const batch = await machine(page, "/agent-ingest/batches", session.token, {
    externalBatchKey: "MVP批次 " + suffix,
    agentName: "Synthetic",
    kind: "OFFLINE_IMPORT",
    rawManifest: standardManifest({ synthetic: true }),
  });
  const images = gaps
    ? []
    : await Promise.all(
        Array.from({ length: count }, async (_, n) => {
          const buffer = await sharp(
            Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="2000"><rect width="1500" height="2000" fill="#71896c"/><text x="40" y="100" font-size="36">${suffix}-${n}</text></svg>`,
            ),
          )
            .png()
            .toBuffer();
          return {
            buffer,
            sourceUrl: `https://example.invalid/mvp/${suffix}/${n}.png`,
            sha256: createHash("sha256").update(buffer).digest("hex"),
            width: 1500,
            height: 2000,
          };
        }),
      );
  const candidates = Array.from({ length: count }, (_, n) => {
    const sourceUrl = `https://example.invalid/mvp/${suffix}/${n}`;
    return {
      externalKey: suffix + ":" + n,
      sourceItemKey: `MVP-${suffix}-${n}`,
      titleRaw: "MVP合成外套 " + suffix + " " + n,
      brandRaw: "MVP合成品牌",
      categoryRaw: "Outerwear",
      conditionRaw: "Synthetic checked",
      sourceCurrentPrice: 10000 + n,
      sourceFacts: {
        sizeLabel: "M",
        productUrl: sourceUrl,
        description: "合成来源完整说明 " + n,
        capture: {
          ...(gaps
            ? {
                fileEvidence: {
                  name: "合成表.csv",
                  sha256: "a".repeat(64),
                  row: "第" + (n + 1) + "行",
                },
              }
            : { pageUrl: sourceUrl }),
          capturedAt: new Date().toISOString(),
          fields: [
            ...genericProfileFields.map(([path, label]) => ({
              path,
              label,
              status: "CAPTURED",
            })),
            ...(gaps
              ? [
                  {
                    path: "sourceFacts.measurements",
                    label: "尺寸",
                    status: "UNAVAILABLE",
                    reason: "原记录未提供",
                  },
                ]
              : []),
          ],
          images: gaps
            ? [
                {
                  sourceFile: `MVP无图记录-${n}.txt`,
                  quality: "UNAVAILABLE",
                  reason: "合成来源未提供图片",
                },
              ]
            : [
                {
                  sourceUrl: images[n].sourceUrl,
                  sha256: images[n].sha256,
                  width: images[n].width,
                  height: images[n].height,
                  quality: "ORIGINAL",
                },
              ],
        },
      },
      rawPayload: { synthetic: true },
    };
  });
  const rows = await machine(
    page,
    `/agent-ingest/batches/${batch.id}/candidates`,
    session.token,
    { candidates },
  );
  for (const [n, row] of rows.rows.entries())
    if (!gaps) {
      const image = images[n],
        uploaded = await page.request.post(
          `/api/agent-ingest/candidates/${row.id}/assets`,
          {
            headers: {
              "X-Ingest-Token": session.token,
              "Idempotency-Key": randomUUID(),
            },
            multipart: {
              sourceUrl: image.sourceUrl,
              roleHint: "PRODUCT",
              file: {
                name: `mvp-${n}.png`,
                mimeType: "image/png",
                buffer: image.buffer,
              },
            },
          },
        );
      expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    }
  await machine(
    page,
    `/agent-ingest/batches/${batch.id}/seal`,
    session.token,
    {},
  );
  return {
    batch,
    source: { ...source, name: "MVP批量 " + suffix },
    rows: rows.rows,
  };
}
async function photo(name = "MVP原图.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 1500, height: 2000, channels: 3, background: "#71896c" },
    })
      .png()
      .toBuffer(),
  };
}
function zipFiles(buffer) {
  const files = new Map(),
    end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let cursor = buffer.readUInt32LE(end + 16);
  for (let n = 0; n < buffer.readUInt16LE(end + 10); n++) {
    const method = buffer.readUInt16LE(cursor + 10),
      size = buffer.readUInt32LE(cursor + 20),
      nl = buffer.readUInt16LE(cursor + 28),
      extra = buffer.readUInt16LE(cursor + 30),
      comment = buffer.readUInt16LE(cursor + 32),
      offset = buffer.readUInt32LE(cursor + 42),
      name = buffer.subarray(cursor + 46, cursor + 46 + nl).toString(),
      start =
        offset +
        30 +
        buffer.readUInt16LE(offset + 26) +
        buffer.readUInt16LE(offset + 28),
      data = buffer.subarray(start, start + size);
    files.set(
      name,
      method === 8 ? require("node:zlib").inflateRawSync(data) : data,
    );
    cursor += 46 + nl + extra + comment;
  }
  return files;
}

test.beforeEach(async ({ page }) => login(page));

test("商品资料库按尺码位置来源及缺项找货，手机日常入口可实际切换", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8),
    title = "MVP查找 " + suffix;
  await api(page, "/items", {
    title,
    location: "货架MVP-5",
    facts: { sizeLabel: "XL", attributes: { sourcePlatform: "线下门店" } },
  });
  await api(page, "/items", {
    title: title + " 已定价",
    location: "货架MVP-5",
    currentPrice: 128000,
    facts: { sizeLabel: "XL", attributes: { sourcePlatform: "线下门店" } },
  });
  await page.goto("/#/items?q=" + encodeURIComponent(title));
  await page.getByText("更多筛选", { exact: true }).click();
  await page.getByLabel("尺码", { exact: true }).fill("xl");
  await page.getByLabel("实物位置", { exact: true }).fill("MVP-5");
  await page.getByLabel("来源名称", { exact: true }).fill("线下");
  await page.getByLabel("待补资料", { exact: true }).selectOption("price");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText(title);
  await expect(page.locator("tbody tr")).not.toContainText("已定价");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ["工作台", "商品库", "导入记录", "销售", "更多"])
    await expect(
      page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("link", { name: label, exact: true }),
    ).toBeVisible();
  await page.getByRole("link", { name: "导入记录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "导入记录", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(2);
  await page.getByRole("link", { name: "商品库", exact: true }).click();
  await expect(page.locator(".product-grid")).toBeVisible();
  await page.screenshot({
    path: "reports/screenshots/mvp-library-mobile.png",
    fullPage: true,
  });
});

test("导入记录精确进入本批，来源缺项可集中核对并逐件保留依据", async ({
  page,
}) => {
  const x = await makeBatch(page, 3, true);
  await page.goto("/#/imports?q=" + encodeURIComponent(x.source.name));
  await expect(page.locator(".import-record")).toHaveCount(1);
  await page.getByRole("link", { name: "处理本批", exact: true }).click();
  await expect(page.locator(".candidate-card")).toHaveCount(3);
  await page.getByLabel("选择本页", { exact: true }).check();
  await page
    .getByRole("button", { name: "批量生成TM", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("生成TM后的状态")).toHaveValue("PAUSED");
  await d.getByLabel("我已确认所选商品为实际持有并应纳入经营").check();
  await d.getByLabel("我已核对上述缺项，允许先建档并保留逐件说明").check();
  await d
    .getByLabel("本批缺项处理依据")
    .fill("已核实在手，原记录没有尺寸，后续实测");
  await d.getByRole("button", { name: "确认生成TM", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "当前没有待确认商品" }),
  ).toBeVisible();
  const result = await api(
    page,
    `/ingest/candidates?batchId=${x.batch.id}&decision=CONFIRMED`,
    undefined,
    "GET",
  );
  expect(result.total).toBe(3);
  expect(new Set(result.rows.map((c) => c.item.id)).size).toBe(3);
  for (const c of result.rows)
    expect((await api(page, `/items/${c.item.id}`, undefined, "GET")).status).toBe("PAUSED");
  await page.getByRole("link", { name: "返回导入记录", exact: false }).click();
  await page.getByLabel("查找导入批次").fill(x.source.name);
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await expect(page.locator(".import-record")).toHaveCount(1);
  await expect(page.locator(".import-record")).toContainText("已归入 3");
});

test("批量真实写入后丢回执，关闭页面再继续只保留一份TM", async ({
  page,
  context,
}) => {
  const x = await makeBatch(page, 3);
  await page.goto("/#/candidates?batchId=" + x.batch.id);
  await page.getByLabel("选择本页", { exact: true }).check();
  await page
    .getByRole("button", { name: "批量生成TM", exact: true })
    .click();
  let intercepted = false;
  await page.route("**/api/ingest/candidates/bulk-confirm", async (route) => {
    const response = await route.fetch();
    intercepted = true;
    await route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: "{",
    });
  });
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("生成TM后的状态")).toHaveValue("PAUSED");
  await d.getByLabel("我已确认所选商品为实际持有并应纳入经营").check();
  await d.getByRole("button", { name: "确认生成TM", exact: true }).click();
  await expect(d.locator(".form-error")).toContainText("响应未完整收到");
  expect(intercepted).toBe(true);
  const before = await api(
    page,
    `/ingest/candidates?batchId=${x.batch.id}&decision=CONFIRMED`,
    undefined,
    "GET",
  );
  expect(before.total).toBe(3);
  for (const c of before.rows)
    expect((await api(page, `/items/${c.item.id}`, undefined, "GET")).status).toBe("PAUSED");
  // Closing and reopening is the recovery scenario, not a refresh hiding stale rendering.
  await page.close();
  const resumed = await context.newPage();
  await resumed.goto("/#/candidates?batchId=" + x.batch.id);
  await resumed
    .getByRole("button", { name: "继续上次处理", exact: true })
    .click();
  await resumed
    .getByRole("dialog")
    .getByRole("button", { name: "继续处理", exact: true })
    .click();
  await expect(resumed.getByRole("dialog")).not.toBeVisible();
  const after = await api(
    resumed,
    `/ingest/candidates?batchId=${x.batch.id}&decision=CONFIRMED`,
    undefined,
    "GET",
  );
  expect(after.rows.map((c) => c.item.id).sort()).toEqual(
    before.rows.map((c) => c.item.id).sort(),
  );
  await expect(
    resumed.getByRole("button", { name: "继续上次处理" }),
  ).toHaveCount(0);
});

test("从商品库真实下载原图资料包，售价用元且能查看后续补图变化", async ({
  page,
}) => {
  const title = "MVP导出 " + randomUUID().slice(0, 8),
    i = await api(page, "/items", {
      title,
      currentPrice: 128000,
      facts: { sizeLabel: "XL" },
    });
  await page.goto(`/#/items/${i.id}/edit`);
  const p = await photo();
  await page.getByLabel("选择商品图片", { exact: true }).setInputFiles(p);
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  await page.goto("/#/items?q=" + encodeURIComponent(title));
  await page.getByLabel("选择本页", { exact: true }).check();
  await page.getByRole("button", { name: "下载商品资料", exact: true }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("本批资料名称").fill(title + " 资料");
  await d
    .getByLabel("我知道来源参考图需另行核对外部使用权限，下载不代表已经发布")
    .check();
  const event = page.waitForEvent("download");
  await d.getByRole("button", { name: "生成并下载", exact: true }).click();
  d = page.getByRole("dialog", { name: title + " 资料" });
  await expect(d).toBeVisible();
  const download = await event,
    files = zipFiles(fs.readFileSync(await download.path()));
  const manifest = JSON.parse(files.get("商品资料.json").toString()),
    picture = manifest.items[0].images[0];
  expect(
    createHash("sha256").update(files.get(picture.path)).digest("hex"),
  ).toBe(createHash("sha256").update(p.buffer).digest("hex"));
  expect(files.get("商品清单.csv").toString()).toContain('"1280.00"');
  expect("costCnyMinor" in manifest.items[0]).toBe(false);
  await page.keyboard.press("Escape");
  await page.goto(`/#/items/${i.id}/edit`);
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await photo("补图.png"));
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  await page.goto("/#/items?q=" + encodeURIComponent(title));
  await page.getByRole("button", { name: "资料包与变化", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator(".import-check-row")
    .filter({ hasText: title + " 资料" })
    .getByRole("button", { name: "查看变化 / 下载", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("已变化：图片");
  await expect(
    page.getByRole("button", { name: "下载原图资料包", exact: true }),
  ).toHaveCount(0);
});

test("原图实际上传后断线，关闭页面再进入可恢复文件和原请求", async ({
  page,
  context,
}) => {
  const i = await api(page, "/items", {
      title: "MVP上传恢复 " + randomUUID().slice(0, 8),
    }),
    p = await photo("恢复原图.png");
  const filesBefore = fs.readdirSync("data/test-media").sort();
  await page.goto(`/#/items/${i.id}/edit`);
  await page.getByLabel("选择商品图片", { exact: true }).setInputFiles(p);
  const keys = [];
  const observe = request => {
    if (request.url().endsWith("/api/assets/upload") && request.method() === "POST") keys.push(request.headers()["idempotency-key"]);
  };
  page.on("request", observe);
  // Keep WebKit's native multipart bytes; lose delivery only after the real write succeeds.
  await page.evaluate(() => {
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData && body.has("file")) {
        const loaded = this.onload;
        this.onload = function (event) {
          window.__committedUploadStatus = this.status;
          if (this.status === 201) this.onerror?.call(this, new ProgressEvent("error"));
          else loaded?.call(this, event);
        };
        XMLHttpRequest.prototype.send = send;
      }
      return send.call(this, body);
    };
  });
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-file-list")).toContainText("结果待确认");
  expect(await page.evaluate(() => window.__committedUploadStatus)).toBe(201);
  const filesCommitted = fs.readdirSync("data/test-media").sort();
  expect(filesCommitted.length - filesBefore.length).toBe(2);
  await page.close();
  const resumed = await context.newPage();
  resumed.on("request", observe);
  await resumed.goto(`/#/items/${i.id}/edit`);
  await expect(resumed.locator(".entry-file-list")).toContainText(
    "恢复原图.png",
  );
  await resumed.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(resumed.locator(".entry-save-state")).toHaveText("已保存");
  const result = await api(resumed, "/items/" + i.id, undefined, "GET");
  expect(result.assets).toHaveLength(1);
  expect(result.assets[0].sha256).toBe(
    createHash("sha256").update(p.buffer).digest("hex"),
  );
  expect(fs.readdirSync("data/test-media").sort()).toEqual(filesCommitted);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("商品页保存后直接整理资料，真实回执丢失并关页后仍只产生一份记录", async ({
  page,
  context,
}) => {
  const title = "MVP就地资料 " + randomUUID().slice(0, 8);
  const i = await api(page, "/items", { title });
  await page.goto(`/#/items/${i.id}/edit`);
  await page.getByLabel("商品名称", { exact: true }).fill(title + " 已补文案");
  await page
    .getByRole("button", { name: "保存并下载资料", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "下载商品资料" });
  await expect(d).toBeVisible();
  expect((await api(page, `/items/${i.id}`, undefined, "GET")).title).toBe(
    title + " 已补文案",
  );
  await d.getByLabel("本批资料名称").fill(title);
  await d
    .getByLabel("我知道来源参考图需另行核对外部使用权限，下载不代表已经发布")
    .check();
  const keys = [];
  await page.route("**/api/material-exports", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: "{",
    });
  });
  await d.getByRole("button", { name: "生成并下载", exact: true }).click();
  await expect(d.locator(".form-error")).toContainText("响应未完整收到");
  const before = await api(page, "/material-exports", undefined, "GET");
  expect(before.rows.filter((r) => r.title === title)).toHaveLength(1);
  await page.close();
  const resumed = await context.newPage();
  await resumed.goto(`/#/items/${i.id}/edit`);
  await resumed
    .getByRole("button", { name: "保存并下载资料", exact: true })
    .click();
  const pending = resumed.getByRole("dialog", { name: "继续整理上次资料" });
  await expect(pending).toBeVisible();
  resumed.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/material-exports")
    )
      keys.push(request.headers()["idempotency-key"]);
  });
  await pending
    .getByRole("button", { name: "继续原提交", exact: true })
    .click();
  await expect(
    resumed.getByRole("dialog", { name: title, exact: true }),
  ).toBeVisible();
  const after = await api(resumed, "/material-exports", undefined, "GET");
  expect(after.total).toBe(before.total);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

// rc.19: viewing is the default; writes require an explicit action.
test("商品从列表先查看，取消不写入，保存回详情并保留原筛选与相邻商品", async ({
  page,
}) => {
  const prefix = "浏览路径 " + randomUUID().slice(0, 8);
  const first = await api(page, "/items", {
    title: prefix + " A",
    facts: { sizeLabel: "M" },
  });
  const second = await api(page, "/items", { title: prefix + " B" });
  const before = await api(page, `/items/${first.id}`, undefined, "GET");
  const hash =
    "#/items?" +
    new URLSearchParams({
      q: prefix,
      view: "grid",
      sort: "oldest",
      size: "60",
    });
  await page.goto("/" + hash);
  const writes = [];
  page.on("request", (r) => {
    if (
      /\/api\//.test(r.url()) &&
      ["POST", "PATCH", "DELETE"].includes(r.method())
    )
      writes.push(r.url());
  });
  await page
    .getByRole("link", { name: prefix + " A", exact: true })
    .last()
    .click();
  await expect(page.locator(".product-overview")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存商品", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".product-overview-facts").first()).toContainText(
    "M",
  );
  await page.getByRole("link", { name: "下一件", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: prefix + " B", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(second.id));
  await page.getByRole("link", { name: "上一件", exact: true }).click();
  await page.getByRole("button", { name: "编辑商品", exact: true }).click();
  await page.getByLabel("中文介绍", { exact: true }).fill("取消的草稿");
  const cancelled = new Promise((resolve) =>
    page.once("dialog", async (d) => {
      await d.dismiss();
      resolve();
    }),
  );
  await page.getByRole("link", { name: "取消编辑", exact: true }).click();
  await cancelled;
  await expect(page).toHaveURL(new RegExp(first.id + "/edit"));
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "取消的草稿",
  );
  const left = new Promise((resolve) =>
    page.once("dialog", async (d) => {
      await d.accept();
      resolve();
    }),
  );
  await page.getByRole("link", { name: "取消编辑", exact: true }).click();
  await left;
  await expect(page.locator(".product-overview")).toBeVisible();
  expect(writes).toEqual([]);
  const unchanged = await api(page, `/items/${first.id}`, undefined, "GET");
  expect(unchanged.version).toBe(before.version);
  expect(unchanged.facts).toEqual(before.facts);
  await page.getByRole("button", { name: "编辑商品", exact: true }).click();
  await page.getByLabel("中文介绍", { exact: true }).fill("这次主动保存的说明");
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".product-overview")).toContainText(
    "这次主动保存的说明",
  );
  expect(writes.filter((x) => x.endsWith(first.id))).toHaveLength(1);
  await page.getByRole("link", { name: "← 返回商品列表", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4320/" + hash);
  await expect(page.getByLabel("搜索商品")).toHaveValue(prefix);
});

async function attachOverviewImage(page, item, p) {
  const auth = await api(page, "/auth/me", undefined, "GET");
  const r = await page.request.post("/api/assets/upload", {
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
    multipart: { itemId: item.id, role: "PRODUCT", origin: "OWN", file: p },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}

for (const width of [1440, 390]) {
  test(`商品详情 ${width}px 可连续翻图查看真正原图，下载字节不变且不显示编辑控件`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const title = "原图浏览 " + randomUUID().slice(0, 8);
    const item = await api(page, "/items", { title, currentPrice: 128000 });
    const original = await photo("overview-front.png"),
      other = await photo("overview-back.png");
    await attachOverviewImage(page, item, original);
    await attachOverviewImage(page, item, other);
    await page.goto(`/#/items/${item.id}`);
    await expect(page.locator(".product-overview")).toBeVisible();
    const cover = page.locator(".overview-cover-button img");
    await expect
      .poll(() => cover.evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "设封面", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `reports/screenshots/product-overview-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "查看商品大图", exact: true })
      .click();
    const d = page.getByRole("dialog", { name: "查看商品图片" });
    await expect(
      d.getByRole("button", { name: "上一张", exact: true }),
    ).toBeDisabled();
    await d.getByRole("button", { name: "下一张", exact: true }).click();
    await expect(d.locator(".image-viewer-name")).toHaveText(other.name);
    await page.keyboard.press("ArrowLeft");
    await expect(d.locator(".image-viewer-name")).toHaveText(original.name);
    await d.getByRole("button", { name: "查看原图", exact: true }).click();
    await expect
      .poll(() => d.locator("img").evaluate((img) => img.naturalHeight))
      .toBe(2000);
    await d.getByRole("button", { name: "放大", exact: true }).click();
    await expect(
      d.getByRole("button", { name: "适应窗口", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(
      true,
    );
    const event = page.waitForEvent("download");
    await d.getByRole("link", { name: "下载原图", exact: true }).click();
    expect(
      fs.readFileSync(await (await event).path()).equals(original.buffer),
    ).toBe(true);
    await d.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator(".product-overview")).toBeVisible();
  });
}

test("完成批次直达本批商品，重置和查看已归入不丢范围，详情往返仍在本批", async ({
  page,
}) => {
  const x = await makeBatch(page, 1),
    other = await makeBatch(page, 1);
  const c = x.rows[0];
  await api(page, `/ingest/candidates/${c.id}/confirm`, {
    version: c.version,
    possession: "IN_HAND",
  });
  await page.goto("/#/imports?q=" + encodeURIComponent(x.source.name));
  await page.getByRole("link", { name: "查看本批商品", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "本批商品", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toContain("batchId=" + x.batch.id);
  await page
    .getByLabel("搜索候选", { exact: true })
    .fill("没有这种商品-" + randomUUID());
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "没有符合条件的商品", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "重置", exact: true }).click();
  await expect(page.locator(".candidate-card")).toHaveCount(1);
  expect(
    new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("batchId"),
  ).toBe(x.batch.id);
  await page.getByLabel("状态", { exact: true }).selectOption("PENDING");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前没有待确认商品", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看已归入TM", exact: true }).click();
  await expect(page.locator(".candidate-card")).toHaveCount(1);
  const hash = new URL(page.url()).hash;
  await page.locator(".candidate-actions a").click();
  await expect(page.locator(".product-overview")).toBeVisible();
  await page
    .getByRole("link", { name: "← 返回本次导入记录", exact: true })
    .click();
  await expect(page).toHaveURL("http://127.0.0.1:4320/" + hash);
  const pending = await api(
    page,
    `/ingest/candidates?batchId=${other.batch.id}&decision=PENDING`,
    undefined,
    "GET",
  );
  expect(pending.total).toBe(1);
});

test("单件录货可保存关闭，下载失败只重试文件不重复整理", async ({ page }) => {
  const title = "单件完成 " + randomUUID().slice(0, 8);
  await page.getByRole("button", { name: "＋ 快速录入我方现货", exact: true }).click();
  const intake = page.getByRole("dialog", { name: "快速录入我方现货" });
  await intake.getByLabel("商品名称", { exact: true }).fill(title);
  await intake.getByRole("button", { name: "保存并关闭", exact: true }).click();
  await expect(intake).not.toBeVisible();
  const rows = await api(
    page,
    "/items?q=" + encodeURIComponent(title),
    undefined,
    "GET",
  );
  expect(rows.total).toBe(1);
  await page.goto(`/#/items/${rows.rows[0].id}`);
  await page.getByRole("button", { name: "下载商品资料", exact: true }).click();
  const d = page.getByRole("dialog", { name: "下载商品资料" });
  await d.getByLabel("本批资料名称").fill(title);
  await d
    .getByLabel("我知道来源参考图需另行核对外部使用权限，下载不代表已经发布")
    .check();
  let dropped = false;
  await page.route("**/api/material-exports/*/download", async (route) => {
    if (!dropped) {
      dropped = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await d.getByRole("button", { name: "生成并下载", exact: true }).click();
  const result = page.getByRole("dialog", { name: title, exact: true });
  await expect(result.locator(".material-download-state")).toContainText(
    "下载未完成",
  );
  const event = page.waitForEvent("download");
  await result
    .getByRole("button", { name: "下载原图资料包", exact: true })
    .click();
  await event;
  const exports = await api(page, "/material-exports", undefined, "GET");
  expect(exports.rows.filter((r) => r.title === title)).toHaveLength(1);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "← 返回商品列表", exact: true }).click();
  await page.getByRole("button", { name: "资料包与变化", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator(".import-check-row")
    .filter({ hasText: title })
    .getByRole("button", { name: "查看变化 / 下载", exact: true })
    .click();
  await page
    .getByRole("button", { name: "返回资料包记录", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "资料包与变化", exact: true }),
  ).toBeVisible();
});

test("详情暂停需要确认，真实写入丢回执后同键重试且不产生销售", async ({
  page,
}) => {
  const item = await api(page, "/items", { title: "暂停确认 " + randomUUID() });
  await page.goto(`/#/items/${item.id}`);
  await page.locator(".studio-stock-menu summary").click();
  await page.getByRole("button", { name: "暂停推广", exact: true }).click();
  const d = page.getByRole("dialog", { name: "暂停这件商品推广" });
  await d.getByRole("button", { name: "取消", exact: true }).click();
  expect((await api(page, `/items/${item.id}`, undefined, "GET")).status).toBe(
    "AVAILABLE",
  );
  await page.getByRole("button", { name: "暂停推广", exact: true }).click();
  const keys = [];
  await page.route(`**/api/items/${item.id}/state`, async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 1) {
      const r = await route.fetch();
      expect(r.ok()).toBe(true);
      await route.fulfill({
        status: r.status(),
        contentType: "application/json",
        body: "{",
      });
    } else await route.continue();
  });
  await d.getByRole("button", { name: "确认暂停", exact: true }).click();
  await expect(d.locator(".form-error")).toContainText("响应未完整收到");
  await d.getByRole("button", { name: "确认暂停", exact: true }).click();
  await expect(d).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const latest = await api(page, `/items/${item.id}`, undefined, "GET");
  expect(latest.status).toBe("PAUSED");
  const sales = await api(page, `/sales?itemId=${item.id}`, undefined, "GET");
  expect(Array.isArray(sales) ? sales : sales.rows).toHaveLength(0);
  await expect(page.locator(".studio-stock-badge")).toContainText("已暂停");
  await expect(page.locator("[data-overview-status]")).toContainText("已暂停");
});

test("只读角色默认详情不暴露成本、编辑或库存写入入口", async ({
  page,
  browser,
}) => {
  const suffix = randomUUID(),
    email = `viewer-${suffix}@example.test`,
    password = "Synthetic-" + suffix;
  await api(page, "/auth/users", {
    email,
    password,
    name: "详情只读合成账户",
    role: "VIEWER",
  });
  const item = await api(page, "/items", { title: "只读商品 " + suffix });
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4320",
  });
  const viewer = await context.newPage();
  try {
    await viewer.goto("/");
    await fillLogin(viewer, email, password);
    await submitLogin(viewer);
    await expect(
      viewer.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeVisible();
    await viewer.goto(`/#/items/${item.id}`);
    await expect(viewer.locator(".product-overview")).toBeVisible();
    await expect(
      viewer.getByRole("button", { name: "编辑商品", exact: true }),
    ).toHaveCount(0);
    await expect(viewer.getByText("人民币成本", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      viewer.getByRole("button", { name: "记录询盘", exact: true }),
    ).toHaveCount(0);
    await expect(viewer.locator(".studio-stock-menu")).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "暂停推广", exact: true }),
    ).toHaveCount(0);
    const body = await (
      await viewer.request.get(`/api/items/${item.id}`)
    ).json();
    expect("currentCostCny" in body).toBe(false);
  } finally {
    await context.close();
  }
});
