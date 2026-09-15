const { test, expect } = require("@playwright/test");
const { randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs");
const sharp = require("sharp");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "进入工作台" }).click();
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
  });
  const candidates = Array.from({ length: count }, (_, n) => ({
    externalKey: suffix + ":" + n,
    titleRaw: "MVP合成外套 " + suffix + " " + n,
    sourceFacts: gaps
      ? {
          capture: {
            fileEvidence: {
              name: "合成表.csv",
              sha256: "a".repeat(64),
              row: "第" + (n + 1) + "行",
            },
            capturedAt: new Date().toISOString(),
            fields: [
              { path: "titleRaw", label: "名称", status: "CAPTURED" },
              {
                path: "sourceFacts.measurements",
                label: "尺寸",
                status: "UNAVAILABLE",
                reason: "原记录未提供",
              },
            ],
            images: [],
          },
        }
      : {},
    rawPayload: { synthetic: true },
  }));
  const rows = await machine(
    page,
    `/agent-ingest/batches/${batch.id}/candidates`,
    session.token,
    { candidates },
  );
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

test("商品资料库按尺码位置来源及缺项找货，手机三入口可实际切换", async ({
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
  for (const label of ["商品库", "导入记录", "设置"])
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
    .getByRole("button", { name: "确认在手并生成TM", exact: true })
    .click();
  const d = page.getByRole("dialog");
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
    .getByRole("button", { name: "确认在手并生成TM", exact: true })
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
  await d.getByRole("button", { name: "整理资料包", exact: true }).click();
  d = page.getByRole("dialog", { name: title + " 资料" });
  await expect(d).toBeVisible();
  const event = page.waitForEvent("download");
  await d.getByRole("button", { name: "下载原图资料包", exact: true }).click();
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
  await page.goto(`/#/items/${i.id}/edit`);
  await page.getByLabel("选择商品图片", { exact: true }).setInputFiles(p);
  await page.route("**/api/assets/upload", async (route) => {
    await route.fetch();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{",
    });
  });
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-file-list")).toContainText("结果待确认");
  await page.close();
  const resumed = await context.newPage();
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
  await d.getByRole("button", { name: "整理资料包", exact: true }).click();
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
