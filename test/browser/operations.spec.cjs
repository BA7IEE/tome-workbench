const { submitLogin, fillLogin } = require("./login.cjs");
const { chooseDictionary } = require("./dictionary-control.cjs");
const { revealSection } = require("./reveal-section.cjs");

async function productMore(page) {
  const summary = page.locator("details.studio-more > summary");
  if (await summary.count()) {
    await summary.click();
    await page
      .locator("details.studio-more[open]")
      .waitFor({ state: "attached" });
  }
}
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/#/items");
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
}
async function api(page, path, body, method = "POST") {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const response = await page.request.fetch("/api" + path, {
    method,
    data: body,
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(response.ok(), `${method} ${path} ${response.status()}`).toBeTruthy();
  return response.json();
}
async function image(name = "front.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 96, height: 128, channels: 3, background: "#ddd" },
    })
      .png()
      .toBuffer(),
  };
}
async function distributionReady(page, title) {
  const item = await api(page, "/items", {
    title,
    category: "BAG",
    brand: "SYNTHETIC",
    currentPrice: 280000,
    currency: "CNY",
    facts: {
      material: "合成羊毛",
      condition: "合成资料中的轻微使用痕迹",
      measurements: "肩宽40cm，衣长60cm",
      measurementSource: "合成测量依据",
      descriptionZh: "用于分发中心交互验收的合成商品。",
      descriptionEn: "Synthetic item for handoff UI acceptance.",
      authentication: { status: "PASSED", evidence: "合成复核依据" },
    },
  });
  const auth = await (await page.request.get("/api/auth/me")).json();
  const uploaded = await page.request.fetch("/api/assets/upload", {
    method: "POST",
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
    multipart: {
      itemId: item.id,
      role: "PRODUCT",
      origin: "OWN",
      sourceNote: "分发中心合成交互图片",
      file: await image("handoff.png"),
    },
  });
  expect(uploaded.ok()).toBeTruthy();
  const asset = await uploaded.json();
  await api(page, "/assets/" + asset.id + "/review", {
    rights: "PUBLIC",
    verified: true,
    sourceNote: "合成图片已核对并可公开使用",
    validUntil: null,
    position: 0,
  });
  await api(page, "/items/" + item.id + "/approve", { version: 1 });
  return item;
}
async function find(page, name) {
  return (
    await (
      await page.request.get(
        "/api/items?q=" + encodeURIComponent(name) + "&dataMode=ALL",
      )
    ).json()
  ).rows.filter((r) => r.title === name);
}
async function newForm(page) {
  await page.goto("/#/items/new");
  await expect(page.getByLabel("商品名称", { exact: true })).toBeVisible();
}
const faults = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => faults.push(error.message));
  await login(page);
});
test.afterEach(() => {
  expect(faults.splice(0)).toEqual([]);
});
test("手工录一件衣服：同页填写和选图，保存后继续维护而不是进入固定流水线", async ({
  page,
}) => {
  const name = "手工服装 " + randomUUID().slice(0, 8);
  await newForm(page);
  await page.getByLabel("商品名称", { exact: true }).fill(name);
  await chooseDictionary(page, "品牌", "SYNTHETIC", "SYNTHETIC");
  await revealSection(page, "dimensions");

  await page
    .getByLabel("材质成分 / 细节", { exact: true })
    .fill("合成面料资料");
  await page
    .getByLabel("本批图片来源", { exact: true })
    .selectOption("SUPPLIER");
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await image());
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page).toHaveURL(/#\/items\/[a-f0-9-]+\/edit/);
  await expect(page.getByRole("heading", { name: /已保存图片/ })).toContainText(
    "1 张",
  );
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(name);
  const rows = await find(page, name);
  expect(rows).toHaveLength(1);
  expect(rows[0].approvedValid).toBe(false);
  expect(rows[0]._count.assets).toBe(1);
  expect(
    (await (await page.request.get("/api/items/" + rows[0].id)).json())
      .assets[0].origin,
  ).toBe("SUPPLIER");
  await page.screenshot({
    path: "reports/screenshots/manual-product-form.png",
    fullPage: true,
  });
});
test("手工连续录货：保存并新增不会带入上一件资料，编号各自唯一", async ({
  page,
}) => {
  const prefix = "连续录货 " + randomUUID().slice(0, 8);
  await newForm(page);
  await page.getByLabel("商品名称", { exact: true }).fill(prefix + " A");
  await chooseDictionary(page, "品牌", "FIRST", "FIRST");
  await productMore(page);
  await page
    .getByRole("button", { name: "保存并新增下一件", exact: true })
    .click();
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("品牌", { exact: true })).toHaveValue("");
  await page.getByLabel("商品名称", { exact: true }).fill(prefix + " B");
  await productMore(page);
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "商品", exact: true }),
  ).toBeVisible();
  const a = await find(page, prefix + " A"),
    b = await find(page, prefix + " B");
  expect(a).toHaveLength(1);
  expect(b).toHaveLength(1);
  expect(a[0].code).not.toBe(b[0].code);
});
test("供应商包袋：接手时复用资料和保管方式，不抄供货价为售价", async ({
  page,
}) => {
  const title = "供应商包袋 " + randomUUID().slice(0, 8),
    supplier = await api(page, "/supply/suppliers", {
      name: "合成供货店 " + randomUUID().slice(0, 6),
    });
  await api(page, "/supply/sources/import", [
    {
      sourceKey: "OPS:" + randomUUID(),
      title,
      supplierId: supplier.id,
      payload: {
        brand: "SUPPLIER",
        category: "包袋",
        measurements: "30×20×10cm",
        measurementSource: "供应商已提供尺寸",
        quotedCost: "8000",
        descriptionZh: "现成供应商商品资料",
      },
    },
  ]);
  await page.goto("/#/sources?q=" + encodeURIComponent(title));
  await page.getByRole("button", { name: "接手建档", exact: true }).click();
  await expect(page.getByLabel("品牌", { exact: true })).toHaveValue(
    "SUPPLIER",
  );
  await expect(page.getByLabel("品类", { exact: true })).toHaveValue("BAG");
  await expect(page.getByLabel("实测尺寸", { exact: true })).toHaveValue(
    "30×20×10cm",
  );
  await expect(page.getByLabel("对外报价", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("实物持有", { exact: true })).toHaveValue(
    "SUPPLIER",
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toContainText("已保存");
  await expect(page).toHaveURL(/#\/items\/[a-f0-9-]+\/edit/);
  const savedId = page.url().match(/items\/([a-f0-9-]+)\/edit/)[1];
  const saved = await (await page.request.get("/api/items/" + savedId)).json();
  expect(saved.title).toBe(title);
  expect(saved.ownership).toBe("SUPPLIER");
  expect(saved.currentPrice).toBeNull();
  expect(saved.assets).toHaveLength(0);
});
test("保存图片的回执中断：保留已建商品，重试不生成第二件或第二张图", async ({
  page,
}) => {
  const title = "录货回执 " + randomUUID().slice(0, 8);
  await newForm(page);
  await page.getByLabel("商品名称", { exact: true }).fill(title);
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await image("retry.png"));
  const keys = [];
  let lost = false;
  await page.route("**/api/assets/upload", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-save-feedback .form-error")).toContainText(
    "商品档案已保存",
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.getByRole("heading", { name: /已保存图片/ })).toContainText(
    "1 张",
  );
  const rows = await find(page, title);
  expect(rows).toHaveLength(1);
  expect(rows[0]._count.assets).toBe(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});
test("跨页选择后逐件编辑，保存回到原筛选页且不混淆两件商品", async ({
  page,
}) => {
  const prefix = "跨页 " + randomUUID().slice(0, 8);
  const created = [];
  for (let n = 0; n < 32; n++)
    created.push(
      await api(page, "/items", {
        title: prefix + " " + String(n).padStart(2, "0"),
        category: "BAG",
        brand: "QUEUE",
      }),
    );
  await page.goto("/#/items?q=" + encodeURIComponent(prefix) + "&category=BAG");
  const first = page.locator("[data-pick]").first();
  const firstId = await first.getAttribute("data-pick");
  await first.click();
  // Arco pagination exposes a keyboard-focusable, labelled page entry.
  await page.getByLabel("下一页", { exact: true }).click();
  await expect(page.locator(".catalog-count")).toContainText("第 2 / 2 页");
  const second = page.locator("[data-pick]").first();
  const secondId = await second.getAttribute("data-pick");
  expect(secondId).not.toBe(firstId);
  await second.click();
  await expect(page.locator("#bulk-toolbar")).toContainText("已选 2 件");
  await page.getByRole("button", { name: "逐件编辑", exact: true }).click();
  await expect(page.locator(".editing-queue")).toContainText("第 1 / 2 件");
  await revealSection(page, "dimensions");

  await page
    .getByLabel("材质成分 / 细节", { exact: true })
    .fill("第一件的合成材质");
  await productMore(page);
  await page
    .getByRole("button", { name: "保存并编辑下一件", exact: true })
    .click();
  await expect(page.locator(".editing-queue")).toContainText("第 2 / 2 件");
  await expect(page.getByLabel("材质成分 / 细节", { exact: true })).toHaveValue(
    "",
  );
  await revealSection(page, "dimensions");

  await page
    .getByLabel("材质成分 / 细节", { exact: true })
    .fill("第二件的合成材质");
  await productMore(page);
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByLabel("筛选品类", { exact: true })).toHaveValue("BAG");
  const one = await (await page.request.get("/api/items/" + firstId)).json(),
    two = await (await page.request.get("/api/items/" + secondId)).json();
  expect(one.facts.material).toBe("第一件的合成材质");
  expect(two.facts.material).toBe("第二件的合成材质");
  await page.screenshot({
    path: "reports/screenshots/admin-product-table.png",
    fullPage: true,
  });
});
test("两人改同一件：显示差异、保留本次输入，确认合并后才写入", async ({
  page,
}) => {
  const item = await api(page, "/items", {
    title: "并发编辑 " + randomUUID().slice(0, 8),
    facts: { material: "原材质", color: "黑色" },
  });
  await page.goto(`/#/items/${item.id}/edit`);
  await revealSection(page, "dimensions");

  await page
    .getByLabel("材质成分 / 细节", { exact: true })
    .fill("我录入的材质");
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await image("conflict-keep.png"));
  await api(
    page,
    "/items/" + item.id,
    { version: 1, facts: { material: "同事录入的材质", color: "蓝色" } },
    "PATCH",
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-conflicts")).toContainText(
    "同事录入的材质",
  );
  await expect(page.getByLabel("材质成分 / 细节", { exact: true })).toHaveValue(
    "我录入的材质",
  );
  await page.getByLabel("我已核对差异，保留下面输入的改动").click();
  await page
    .getByRole("button", { name: "合并后继续编辑", exact: true })
    .click();
  await expect(
    page.getByLabel("颜色", { exact: true }).locator("option:checked"),
  ).toHaveText("蓝色 · Blue");
  await page.evaluate(() => {
    const send = XMLHttpRequest.prototype.send;
    window.__conflictUploads = 0;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData && body.has("file")) {
        const loaded = this.onload;
        this.onload = function (event) {
          window.__conflictUploadStatus = this.status;
          window.__conflictUploads++;
          window.__releaseConflictUpload = () => loaded?.call(this, event);
        };
      }
      return send.call(this, body);
    };
  });
  try {
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.__conflictUploadStatus))
      .toBe(201);
    await expect(
      page.getByRole("button", { name: "保存商品", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".entry-save-state")).not.toHaveText("已保存");
  } finally {
    await page.evaluate(() => window.__releaseConflictUpload?.());
  }
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  await expect(
    page.getByRole("button", { name: "保存商品", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => window.__conflictUploads)).toBe(1);
  const now = await (await page.request.get("/api/items/" + item.id)).json();
  expect(now.facts.material).toBe("我录入的材质");
  expect(now.facts.color).toBe("蓝色");
  expect(
    now.assets.filter((a) => a.originalName === "conflict-keep.png"),
  ).toHaveLength(1);
});
test("建档回执丢失后先核对原请求，仍只保存一件商品", async ({ page }) => {
  const title = "建档中断 " + randomUUID().slice(0, 8);
  await newForm(page);
  await page.getByLabel("商品名称", { exact: true }).fill(title);
  let lost = false;
  const keys = [];
  await page.route("**/api/items", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-save-feedback .form-error")).toContainText(
    "网络",
  );
  await page.getByRole("button", { name: "核对上次提交", exact: true }).click();
  await expect(page.locator(".studio-save-feedback .form-error")).toContainText(
    "上次提交已核对",
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.getByLabel("商品名称", { exact: true })).toBeVisible();
  expect(await find(page, title)).toHaveLength(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});
test("手机整页录货：触摸确认、保存及返回可操作，无整页横向溢出", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4320",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    await newForm(page);
    await page
      .getByLabel("商品名称", { exact: true })
      .fill("手机录货 " + randomUUID().slice(0, 8));
    await revealSection(page, "authentication");
    await page
      .getByLabel("我已核对本次商品资料，保存时同时确认供后续发布使用")
      .tap();
    await page.getByRole("button", { name: "保存商品", exact: true }).tap();
    await expect(page.getByLabel("商品名称", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "reports/screenshots/manual-entry-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
test("完整手工路径：录货、图片核对、准备渠道资料、登记发布、售出停售", async ({
  page,
}) => {
  const title = "完整手工路径 " + randomUUID().slice(0, 8);
  await newForm(page);
  await page.getByLabel("商品名称", { exact: true }).fill(title);
  await chooseDictionary(page, "品牌", "SYNTHETIC", "SYNTHETIC");
  await page.getByLabel("对外报价", { exact: true }).fill("2800");
  await page
    .getByLabel("瑕疵与使用痕迹", { exact: true })
    .fill("合成测试品相，不涉及真实商品");
  await revealSection(page, "dimensions");

  await page.getByLabel("实测尺寸", { exact: true }).fill("肩宽40cm、胸围90cm");
  await revealSection(page, "dimensions");

  await page.getByLabel("尺寸来源", { exact: true }).fill("合成量测资料");
  await page
    .getByLabel("中文介绍", { exact: true })
    .fill("用于完整流程验证的合成中古服装资料");
  await page.getByText("鉴定与资料", { exact: true }).click();
  await page.getByLabel("真实性复核", { exact: true }).selectOption("PASSED");
  await page
    .getByLabel("鉴定 / 复核依据", { exact: true })
    .fill("合成鉴定 / 复核依据，不是真实鉴定");
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await image("flow.png"));
  await page
    .getByLabel("我已核对本次商品资料，保存时同时确认供后续发布使用")
    .click();
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.getByRole("heading", { name: /已保存图片/ })).toBeVisible();
  await page.getByRole("link", { name: "更多素材操作", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "选择 flow.png", exact: true })
    .click();
  await page
    .getByRole("button", { name: "批量复核所选图片", exact: true })
    .click();
  await page.getByLabel("以上每张图片均已与实物核对一致").click();
  await page.getByLabel("以上每张图片均有权用于本商品公开展示").click();
  await page.getByLabel("统一依据与授权说明").fill("本次合成图片的测试授权");
  await page
    .getByRole("button", { name: "确认并执行", exact: true })
    .click();
  await expect(page.locator("#batch-summary")).toContainText("完成1 / 1");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.locator(".photo-card")).toContainText("可公开使用");
  await page.getByRole("link", { name: "发布资料", exact: true }).click();
  await page
    .getByLabel("已核对本次文案、图片、品相及报价，确认可以使用")
    .click();
  await page
    .getByRole("button", { name: "生成可复制的发布资料", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "下载JPG图片与文案", exact: true }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载JPG图片与文案", exact: true })
    .click();
  const downloaded = await pending;
  expect(await downloaded.failure()).toBeNull();
  await page.getByRole("button", { name: "登记已发布", exact: true }).click();
  await page
    .getByLabel("平台商品链接（可稍后补充）")
    .fill("https://example.invalid/synthetic-post");
  await page.getByRole("button", { name: "记录发布结果", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "我方已售出", exact: true }).click();
  await page.getByRole("button", { name: "确认已售出", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator(".item-status")).toContainText("我方已售");
  const row = (await find(page, title))[0],
    detail = await (await page.request.get("/api/items/" + row.id)).json();
  expect(detail.status).toBe("SOLD");
  expect(detail.listings).toHaveLength(0);
  const attempts = await (
    await page.request.get(`/api/distribution/attempts?itemId=${row.id}`)
  ).json();
  expect(attempts).toHaveLength(2);
  const publishAttempt = attempts.find((attempt) => attempt.action === "PUBLISH");
  const delistAttempt = attempts.find((attempt) => attempt.action === "DELIST");
  expect(publishAttempt.state).toBe("SUCCEEDED");
  expect(publishAttempt.remoteId).toBe("");
  expect(delistAttempt.state).toBe("PENDING");
  expect(delistAttempt.sourceAttemptId).toBe(publishAttempt.id);
  await page.goto("/#/distribution");
  await expect(
    page.getByRole("heading", { name: "商品分发", exact: true }),
  ).toBeVisible();
  await expect(page.locator("table")).toContainText(title);
});

test("分发中心只展示交付语义，UNKNOWN 可在原记录上人工核对为失败", async ({
  page,
}) => {
  const title = "分发核对 " + randomUUID().slice(0, 8);
  const item = await distributionReady(page, title);
  const channel = await api(page, "/channels", {
    name: "分发交付验收 " + randomUUID().slice(0, 8),
    platform: "XIANYU",
    locale: "zh-CN",
    titleLimit: 80,
    defaultCurrency: "CNY",
    distributionMode: "MANUAL",
  });
  const pack = await api(page, `/items/${item.id}/packages`, {
    channelId: channel.id,
    purpose: "TRADE",
    confirmed: true,
  });
  const attempt = await api(page, "/distribution/plan", { packageId: pack.id });
  await api(page, `/distribution/attempts/${attempt.id}/manual-result`, {
    state: "UNKNOWN",
    errorCode: "SYNTHETIC_UNKNOWN",
    errorMessage: "合成外部回执没有确认结果。",
  });

  await page.goto(`/#/distribution?attemptId=${attempt.id}`);
  await expect(
    page.getByRole("heading", { name: "商品分发", exact: true }),
  ).toBeVisible();
  const row = page.locator("table").filter({ hasText: title });
  await expect(row).toContainText("需要核对");
  await expect(row).toContainText("发布资料");
  await expect(page.locator("main")).not.toContainText("租约");
  await page.getByRole("button", { name: "核对结果", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("只更新这一条分发记录，不会重新发布");
  await dialog.getByLabel("结果", { exact: true }).selectOption("FAILED");
  await dialog
    .getByLabel("核对依据", { exact: true })
    .fill("已按永久 TM 在目标账号核对。 ");
  await dialog
    .getByLabel("失败代码（失败或未知时必填）", { exact: true })
    .fill("NOT_FOUND_AFTER_RECONCILIATION");
  await dialog
    .getByLabel("失败详情（失败或未知时必填）", { exact: true })
    .fill("目标渠道中未找到该 TM。");
  await dialog
    .getByRole("button", { name: "确认核对结果", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const attempts = await (
    await page.request.get(`/api/distribution/attempts?itemId=${item.id}`)
  ).json();
  expect(attempts).toHaveLength(1);
  expect(attempts[0].id).toBe(attempt.id);
  expect(attempts[0].state).toBe("FAILED");
});

test("询盘确认成交通过原子动作停售，已转化记录不再显示普通跟进", async ({
  page,
}) => {
  const item = await api(page, "/items", {
    title: "询盘转成交界面 " + randomUUID().slice(0, 8),
  });
  const current = await (await page.request.get(`/api/items/${item.id}`)).json();
  if (current.status !== "AVAILABLE")
    await api(page, `/items/${item.id}/state`, {
      state: "AVAILABLE",
      reason: "仅用于隔离浏览器成交转化验证",
    });
  const inquiry = await api(page, "/inquiries", {
    itemId: item.id,
    channel: "合成门店",
    customerRef: "合成客户",
    notes: "已确认购买意向",
  });
  await page.goto(`/#/inquiries?id=${inquiry.id}`);
  await expect(
    page.getByRole("button", { name: "确认成交", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认成交", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("成交说明", { exact: true })
    .fill("在本地隔离浏览器流程中确认成交，金额后续补录。");
  await dialog
    .getByRole("button", { name: "确认成交并停售", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("table")).toContainText("已转化成交");
  await expect(
    page.getByRole("button", { name: "更新跟进", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/items/${item.id}`)).json()).status,
  ).toBe("SOLD");
});

test("批量渠道价不会用零伪造未知默认报价，必须由操作者明确填写", async ({
  page,
}) => {
  const title = "未知默认价渠道批量 " + randomUUID().slice(0, 8);
  const created = await api(page, "/items", { title });
  const item = await (await page.request.get(`/api/items/${created.id}`)).json();
  expect(item.currentPrice).toBeNull();
  const channel = await api(page, "/channels", {
    name: "渠道价界面验证 " + randomUUID().slice(0, 8),
    platform: "XIANYU",
    locale: "zh-CN",
    defaultCurrency: "CNY",
    distributionMode: "MANUAL",
  });
  await page.goto(`/#/items?q=${encodeURIComponent(title)}`);
  await page
    .getByRole("checkbox", { name: `选择 ${item.code}`, exact: true })
    .check();
  await page.getByText("批量操作", { exact: true }).click();
  await page
    .getByRole("button", { name: "批量渠道价", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("目标渠道账号", { exact: true }).selectOption(channel.id);
  const rows = dialog.getByLabel("渠道价格", { exact: true });
  await expect(rows).toHaveValue(item.code);
  await dialog.getByLabel(/我已逐件核对/).check();
  await dialog
    .getByRole("button", { name: "确认写入渠道价", exact: true })
    .click();
  await expect(dialog.locator(".form-error")).toContainText("尚未填写金额");
  await rows.fill(`${item.code} 1380`);
  await dialog
    .getByRole("button", { name: "确认写入渠道价", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "渠道价格写入结果", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#batch-summary")).toHaveText("完成1 / 1");
  const prices = await (
    await page.request.get(`/api/items/${item.id}/channel-prices`)
  ).json();
  expect(prices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        channelId: channel.id,
        amount: 138000,
        currency: "CNY",
      }),
    ]),
  );
});

test("渠道账号和批量渠道价会同步目标币种，不把人民币金额带成美元", async ({
  page,
}) => {
  const title = "跨币种渠道价界面 " + randomUUID().slice(0, 8);
  const created = await api(page, "/items", {
    title,
    currentPrice: 880000,
    currency: "CNY",
  });
  const item = await (await page.request.get(`/api/items/${created.id}`)).json();
  const cny = await api(page, "/channels", {
    name: "人民币渠道价界面 " + randomUUID().slice(0, 8),
    platform: "XIANYU",
    locale: "zh-CN",
  });
  const usd = await api(page, "/channels", {
    name: "美元渠道价界面 " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    locale: "en",
  });
  await page.goto(`/#/items?q=${encodeURIComponent(title)}`);
  await page
    .getByRole("checkbox", { name: `选择 ${item.code}`, exact: true })
    .check();
  await page.getByText("批量操作", { exact: true }).click();
  await page
    .getByRole("button", { name: "批量渠道价", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const rows = dialog.getByLabel("渠道价格", { exact: true });
  await dialog.getByLabel("目标渠道账号", { exact: true }).selectOption(cny.id);
  await expect(dialog.getByLabel("币种", { exact: true })).toHaveValue("CNY");
  await expect(rows).toHaveValue(`${item.code} 8800`);
  await dialog.getByLabel("目标渠道账号", { exact: true }).selectOption(usd.id);
  await expect(dialog.getByLabel("币种", { exact: true })).toHaveValue("USD");
  await expect(rows).toHaveValue(item.code);
  await expect(rows).not.toHaveValue(/8800/);
  await expect(dialog).toContainText("不同于商品默认币种的金额没有带入");
  await dialog.getByLabel("目标渠道账号", { exact: true }).selectOption(cny.id);
  await expect(dialog.getByLabel("币种", { exact: true })).toHaveValue("CNY");
  await expect(rows).toHaveValue(`${item.code} 8800`);
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  await page.goto("/#/settings");
  await page.getByRole("button", { name: "＋ 创建渠道", exact: true }).click();
  const channelDialog = page.getByRole("dialog");
  await channelDialog.getByLabel("平台", { exact: true }).selectOption("ANQICMS");
  await expect(
    channelDialog.getByLabel("渠道默认币种", { exact: true }),
  ).toHaveValue("USD");
  await channelDialog.getByLabel("平台", { exact: true }).selectOption("XIANYU");
  await expect(
    channelDialog.getByLabel("渠道默认币种", { exact: true }),
  ).toHaveValue("CNY");
});

test("记录询盘会预填目标渠道的有效价格和币种", async ({ page }) => {
  const item = await api(page, "/items", {
    title: "询盘渠道价界面 " + randomUUID().slice(0, 8),
    currentPrice: 880000,
    currency: "CNY",
  });
  const channel = await api(page, "/channels", {
    name: "询盘美元账号 " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    locale: "en",
  });
  await api(page, `/items/${item.id}/channel-prices/${channel.id}`, {
    amount: 138000,
    currency: "USD",
  });
  await page.goto(`/#/items/${item.id}`);
  await page.getByRole("button", { name: "记录询盘", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("渠道", { exact: true }).selectOption(channel.id);
  await expect(dialog.getByLabel("报价（可留空）", { exact: true })).toHaveValue(
    "1380",
  );
  await expect(dialog.getByLabel("币种", { exact: true })).toHaveValue("USD");
});

test("回执未确认时继续编辑不会把新内容误当已保存，核对后正确更新同一件商品", async ({
  page,
}) => {
  const original = "原提交 " + randomUUID().slice(0, 8),
    changed = "新输入 " + randomUUID().slice(0, 8);
  await newForm(page);
  await page.getByLabel("商品名称", { exact: true }).fill(original);
  let lost = false;
  await page.route("**/api/items", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-save-feedback .form-error")).toContainText(
    "网络",
  );
  await page.getByLabel("商品名称", { exact: true }).fill(changed);
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-save-feedback .form-error")).toContainText(
    "核对上次提交",
  );
  await page.getByRole("button", { name: "核对上次提交", exact: true }).click();
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(
    changed,
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toContainText("已保存");
  expect(await find(page, original)).toHaveLength(0);
  expect(await find(page, changed)).toHaveLength(1);
});
