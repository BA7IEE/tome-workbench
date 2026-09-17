const { submitLogin, fillLogin } = require("./login.cjs");
const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const sharp = require("sharp");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function api(page, path, data, method = "POST") {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const r = await page.request.fetch("/api" + path, {
    method,
    data,
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(r.ok(), `${method} ${path}: ${await r.text()}`).toBeTruthy();
  return r.json();
}
async function read(page, path) {
  const r = await page.request.get("/api" + path);
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function ready(page, title) {
  const i = await api(page, "/items", {
    title,
    brand: "SYNTHETIC",
    currentPrice: 80000,
    facts: {
      material: "合成羊毛",
      condition: "合成无明显瑕疵",
      measurements: "肩宽40cm",
      measurementSource: "合成测量",
      descriptionZh: "合成测试服装",
      descriptionEn: "Synthetic garment",
      authentication: { status: "PASSED", evidence: "合成复核记录" },
    },
  });
  const auth = await read(page, "/auth/me");
  const r = await page.request.post("/api/assets/upload", {
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
    multipart: {
      itemId: i.id,
      role: "PRODUCT",
      origin: "OWN",
      file: {
        name: "synthetic.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 64, height: 80, channels: 3, background: "#ccc" },
        })
          .png()
          .toBuffer(),
      },
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const a = await r.json();
  await api(page, "/assets/" + a.id + "/review", {
    rights: "PUBLIC",
    verified: true,
    sourceNote: "合成测试图片许可",
    validUntil: null,
    position: 0,
  });
  await api(page, "/items/" + i.id + "/approve", {
    version: (await read(page, "/items/" + i.id)).version,
  });
  return read(page, "/items/" + i.id);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
  await expect(page.locator(".sidebar-bottom")).toBeVisible();
});

test("批量定价逐件展示并在真实写入回执丢失后重试，不重写成功项", async ({
  page,
}) => {
  const prefix = "集中报价 " + randomUUID(),
    a = await api(page, "/items", { title: prefix + " A" }),
    b = await api(page, "/items", { title: prefix + " B" });
  await page.goto("/#/items?q=" + encodeURIComponent(prefix));
  await page.locator("#select-page").check();
  await page.locator(".bulk-more > summary").click();
  await page.getByRole("button", { name: "批量定价", exact: true }).click();
  let d = page.getByRole("dialog");
  expect(
    await d.evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThan(900);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await d.evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await d.getByLabel("拟售价 " + a.code, { exact: true }).fill("1234.56");
  await d.getByLabel("拟售价 " + b.code, { exact: true }).fill("2345.67");
  await d.getByLabel("我已逐件核对以上售价与币种").check();
  let writesA = 0,
    lost = false;
  await page.route("**/api/items/" + a.id, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writesA++;
    const r = await route.fetch();
    if (!lost) {
      lost = true;
      expect(r.ok()).toBeTruthy();
      return route.abort("failed");
    }
    return route.fulfill({ response: r });
  });
  await d.getByRole("button", { name: "确认并执行" }).click();
  await expect(d.getByRole("heading", { name: "批量定价结果" })).toBeVisible();
  await expect(d.locator("#batch-summary")).toHaveText("完成1 / 2");
  await d.getByRole("button", { name: "重试未完成项" }).click();
  await expect(d.locator("#batch-summary")).toHaveText("完成2 / 2");
  expect(writesA).toBe(2);
  const afterA = await read(page, "/items/" + a.id),
    afterB = await read(page, "/items/" + b.id);
  expect(afterA.currentPrice).toBe(123456);
  expect(afterB.currentPrice).toBe(234567);
  expect(afterA.version).toBe(2);
  expect(afterB.version).toBe(2);
});

test("询盘旧窗口保留本次输入，核对最新沟通后追加历史", async ({ page }) => {
  const i = await api(page, "/items", { title: "询盘冲突 " + randomUUID() }),
    n = await api(page, "/inquiries", {
      itemId: i.id,
      channel: "合成门店",
      customerRef: "客户甲",
      notes: "初次联系",
    });
  await page.goto("/#/inquiries?id=" + n.id);
  await page.getByRole("button", { name: "更新跟进", exact: true }).click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("沟通记录 / 流失原因", { exact: true })
    .fill("本窗口约定周五试穿");
  await api(page, "/inquiries/" + n.id + "/status", {
    version: 1,
    state: "FOLLOWUP",
    notes: "另一窗口确认客户尺码",
    nextFollowUpAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await expect(d).toContainText("另一窗口确认客户尺码");
  await expect(d.getByLabel("下次跟进时间", { exact: true })).not.toHaveValue("");
  await expect(
    d.getByLabel("沟通记录 / 流失原因", { exact: true }),
  ).toHaveValue("本窗口约定周五试穿");
  await d.getByLabel("已核对最新沟通，保留本次输入继续提交").check();
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await expect(d).not.toBeVisible();
  const h = await read(page, "/inquiries/" + n.id + "/history");
  expect(h.rows.map((x) => x.detail.notes)).toEqual([
    "另一窗口确认客户尺码",
    "本窗口约定周五试穿",
  ]);
  expect((await read(page, "/items/" + i.id)).status).toBe("AVAILABLE");
});

test("商品经营记录原地查看不丢草稿，并可精确定位同件第二笔成交", async ({
  page,
}) => {
  const i = await api(page, "/items", { title: "经营记录 " + randomUUID() }),
    first = await api(page, "/items/" + i.id + "/sold", {
      channel: "合成门店",
      customerRef: "客户一",
    });
  await api(page, "/sales/" + first.id + "/finance", {
    version: 1,
    amount: 10000,
    cost: 5000,
    fees: 0,
    currency: "CNY",
    paid: true,
    note: "合成收款核对",
  });
  await api(page, "/sales/" + first.id + "/refund", {
    amount: 10000,
    reason: "合成全额退款",
  });
  await api(page, "/sales/" + first.id + "/return", {
    intact: true,
    evidence: "合成完整回收",
  });
  await api(page, "/items/" + i.id + "/state", {
    state: "AVAILABLE",
    reason: "合成复检完成",
  });
  const second = await api(page, "/items/" + i.id + "/sold", {
    channel: "合成门店",
    customerRef: "客户二",
  });
  await page.goto("/#/items/" + i.id + "/edit");
  await page.getByLabel("中文介绍", { exact: true }).fill("尚未保存的介绍");
  await page.locator("details.studio-stock-menu > summary").click();
  await page.getByRole("button", { name: "经营记录", exact: true }).click();
  const d = page.getByRole("dialog");
  await expect(d).toContainText("客户二");
  await d.locator("button.close").click();
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "尚未保存的介绍",
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  // Existing work-queue tools now live under the approved MVP Settings entry.
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByText("其他业务记录与维护工具", { exact: true }).click();
  await page.getByRole("link", { name: "经营待办", exact: true }).click();
  await expect(page.getByLabel("查看范围", { exact: true })).toBeVisible();
  await page.goto("/#/sales?id=" + second.id + "&from=tasks");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("客户二");
  await expect(page.locator("tbody")).not.toContainText("客户一");
  await page
    .getByRole("link", { name: "返回成交补账待办", exact: true })
    .click();
  await expect(page.getByLabel("查看范围", { exact: true })).toHaveValue(
    "SALE_FINANCE",
  );
  expect(first.id).not.toBe(second.id);
});

test("二十件看图选品集中显示两件缺项，维护返回保留标题选择并且失败前不生成资料包", async ({
  page,
}) => {
  test.setTimeout(120000);
  const prefix = "选品预检 " + randomUUID(),
    items = [];
  for (let n = 0; n < 18; n++) items.push(await ready(page, prefix + " " + n));
  for (let n = 18; n < 20; n++)
    items.push(await api(page, "/items", { title: prefix + " " + n }));
  const c = await api(page, "/channels", {
    platform: "OTHER",
    name: prefix,
    locale: "zh-CN",
    titleLimit: 200,
  });
  await page.goto("/#/items?q=" + encodeURIComponent(prefix));
  await page.locator("#select-page").check();
  await page.locator(".bulk-more > summary").click();
  await page.getByRole("button", { name: "创建客户选品", exact: true }).click();
  await page.getByLabel("合集名称", { exact: true }).fill("周末试穿二十件");
  await page.getByLabel("语言与内容模板", { exact: true }).selectOption(c.id);
  let packages = 0;
  await page.route("**/api/items/*/packages", (r) => {
    if (r.request().method() === "POST") packages++;
    return r.continue();
  });
  await page.getByRole("button", { name: "检查当前选择", exact: true }).click();
  await expect(page.locator("[data-collection-error]")).toContainText(
    "部分商品尚未就绪",
  );
  await expect(
    page.locator(".selection-row").filter({ has: page.locator(".form-error") }),
  ).toHaveCount(2);
  expect(packages).toBe(0);
  await page
    .locator(".selection-row")
    .filter({ hasText: items[18].code })
    .getByRole("link", { name: "原地完善后返回" })
    .click();
  await page.getByLabel("中文介绍", { exact: true }).fill("先补充这件的说明");
  await page.locator("details.studio-more summary").click();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page.getByLabel("合集名称", { exact: true })).toHaveValue(
    "周末试穿二十件",
  );
  await expect(page.locator(".selection-row")).toHaveCount(20);
  expect(packages).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(2);
});

test("看图选品真实创建后丢失回执，重试只生成一个合集和资料包", async ({
  page, context,
}) => {
  const prefix = "选品恢复 " + randomUUID(),
    i = await ready(page, prefix);
  const c = await api(page, "/channels", {
    platform: "OTHER",
    name: prefix,
    locale: "zh-CN",
    titleLimit: 200,
  });
  await page.goto("/#/items?q=" + encodeURIComponent(prefix));
  await page.locator("#select-page").check();
  await page.locator(".bulk-more > summary").click();
  await page.getByRole("button", { name: "创建客户选品", exact: true }).click();
  await page.getByLabel("合集名称", { exact: true }).fill(prefix);
  await page.getByLabel("语言与内容模板", { exact: true }).selectOption(c.id);
  await page.getByLabel("我已确认选择的商品，生成本次客户选品快照").check();
  let lost = false,
    packs = 0;
  await page.route("**/api/items/" + i.id + "/packages", (r) => {
    packs++;
    return r.continue();
  });
  await page.route("**/api/collections", async (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const response = await r.fetch();
    if (!lost) {
      lost = true;
      expect(response.ok(), await response.text()).toBeTruthy();
      return r.abort("failed");
    }
    return r.fulfill({ response });
  });
  await page.getByRole("button", { name: "生成选品合集", exact: true }).click();
  await expect(page.locator("[data-collection-error]")).not.toHaveText("");
  await page.getByLabel("合集名称", { exact: true }).fill(prefix + " 改名");
  for (let n = 0; n < 2; n++) {
    await page
      .getByRole("button", { name: "生成选品合集", exact: true })
      .click();
    await expect(page.locator("[data-collection-error]")).toContainText(
      "上次结果待确认",
    );
  }
  await page.close();
  page = await context.newPage();
  await page.goto("/#/collections/new");
  await expect(page.getByLabel("合集名称", { exact: true })).toHaveValue(prefix + " 改名");
  await api(page, "/channels/" + c.id, {
    version: 1,
    name: prefix,
    locale: "zh-CN",
    titleLimit: 200,
    active: false,
  });
  await page
    .getByRole("button", { name: "恢复上次提交内容", exact: true })
    .click();
  await expect(page.getByLabel("合集名称", { exact: true })).toHaveValue(
    prefix,
  );
  await page.getByLabel("我已确认选择的商品，生成本次客户选品快照").check();
  await page.getByRole("button", { name: "生成选品合集", exact: true }).click();
  await expect(page).toHaveURL(/#\/collections\/[0-9a-f-]{36}$/);
  expect(
    (await read(page, "/collections")).filter((x) => x.title === prefix),
  ).toHaveLength(1);
  expect(packs).toBe(1);
});

test("渠道维护可修改停用，发布查询保留显式范围且手机可操作", async ({
  page,
}) => {
  const title = "维护账号 " + randomUUID(),
    c = await api(page, "/channels", {
      platform: "OTHER",
      name: title,
      locale: "zh-CN",
      titleLimit: 100,
    });
  await page.goto("/#/settings");
  const row = page.locator("tr").filter({ hasText: title });
  await row.getByRole("button", { name: "修改 / 停用", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("账号显示名称", { exact: true }).fill(title + " 更新");
  await d.getByLabel("启用渠道", { exact: true }).uncheck();
  await d.getByRole("button", { name: "保存渠道设置", exact: true }).click();
  await expect(d).not.toBeVisible();
  expect(
    (await read(page, "/channels")).find((x) => x.id === c.id),
  ).toMatchObject({ active: false, version: 2, name: title + " 更新" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/listings");
  await page.getByLabel("发布记录类型", { exact: true }).selectOption("TEST");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page).toHaveURL(/dataMode=TEST/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(2);
});

async function procurement(
  page,
  count,
  { linked = false, refundLast = false } = {},
) {
  const key = randomUUID().slice(0, 8),
    s = await api(page, "/procurement/sources", {
      code: "BT" + key,
      name: "合成批量 " + key,
      defaultCurrency: "USD",
    });
  await api(page, "/costing/sources/" + s.id + "/policy", {
    version: 1,
    orderOverheadCny: 20000,
    costAllocationMethod: "PROPORTIONAL_LINE_AMOUNT",
    storeCreditAsPayment: true,
    note: "合成每单200元附加成本规则",
  });
  const orders = [];
  for (let n = 0; n < count; n++) {
    const o = await api(page, "/procurement/orders/import", {
      procurementSourceId: s.id,
      externalOrderNo: "BATCH-" + key + "-" + String(n).padStart(2, "0"),
      orderedAt: "2024-06-15T12:00:00Z",
      currency: "USD",
      paymentAmount: 10000,
      totalAmount: 10000,
      rawPayload: { synthetic: true },
      lines: [
        {
          lineKey: "SKU" + n,
          title: "合成采购 " + key + " " + n,
          currency: "USD",
          lineAmount: 10000,
        },
      ],
      adjustments:
        refundLast && n === count - 1
          ? [
              {
                adjustmentKey: "credit-refund",
                kind: "REFUND",
                label: "Store Credit refund",
                amount: 1000,
                currency: "USD",
              },
            ]
          : [],
    });
    if (linked || n === 0) {
      const i = await api(page, "/items", {
        title: "合成采购 " + key + " " + n,
      });
      await api(page, "/procurement/lines/" + o.lines[0].id + "/review", {
        version: o.lines[0].version,
        businessDecision: "INCLUDE",
        possession: "IN_HAND",
        reviewNote: "合成实物确认",
      });
      await api(page, "/procurement/lines/" + o.lines[0].id + "/link-item", {
        itemId: i.id,
        note: "合成关联",
      });
      o.itemId = i.id;
    }
    orders.push(o);
  }
  return { source: s, orders, key };
}
test("集中成本批量确认两单，退款单保留待核对且回执丢失重试只写一次", async ({
  page,
}) => {
  const x = await procurement(page, 3, { linked: true, refundLast: true });
  await page.goto(
    "/#/procurement?mode=costs&sourceId=" + x.source.id + "&month=2024-06",
  );
  await page.getByRole("button", { name: "选择本页", exact: true }).click();
  await expect(page.locator("[data-cost-count]")).toContainText("已选 3 单");
  await page
    .getByRole("button", { name: "批量确认汇率依据", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("本月采用汇率", { exact: true }).fill("7.1");
  await d
    .getByLabel("汇率来源与确认说明", { exact: true })
    .fill("合成测试经确认的月参考汇率");
  await d
    .getByLabel("我已核对本月汇率，并确认按各来源已配置的每单附加成本执行")
    .check();
  let lost = false;
  await page.route(
    "**/api/costing/orders/" + x.orders[0].id + "/basis",
    async (route) => {
      const r = await route.fetch();
      if (!lost) {
        lost = true;
        expect(r.ok(), await r.text()).toBeTruthy();
        return route.abort("failed");
      }
      return route.fulfill({ response: r });
    },
  );
  await d.getByRole("button", { name: "确认并执行" }).click();
  await expect(d.locator("#batch-summary")).toHaveText("完成1 / 3");
  await expect(d).toContainText("请逐单确认净支付");
  await d.getByRole("button", { name: "重试未完成项" }).click();
  await expect(d.locator("#batch-summary")).toHaveText("完成2 / 3");
  await d.locator("button.close").click();
  await expect(page.locator("[data-cost-count]")).toContainText("已选 3 单");
  await page
    .getByRole("button", { name: "批量写入TM成本", exact: true })
    .click();
  await d.getByLabel("我已逐单核对本批成本预览和依据").check();
  await d.getByRole("button", { name: "确认并执行" }).click();
  await expect(d.locator("#batch-summary")).toHaveText("完成2 / 3");
  for (const o of x.orders.slice(0, 2)) {
    expect((await read(page, "/items/" + o.itemId)).currentCostCny).toBe(91000);
    expect(
      (await read(page, "/costing/orders/" + o.id + "/preview")).basis.version,
    ).toBe(1);
  }
  expect(
    (await read(page, "/items/" + x.orders[2].itemId)).currentCostCny,
  ).toBeNull();
});

test("采购第二页往返TM保留关键词来源页码和列表位置", async ({ page }) => {
  test.setTimeout(90000);
  const x = await procurement(page, 31);
  const hash =
    "/#/procurement?sourceId=" + x.source.id + "&q=" + x.key + "&page=2";
  await page.goto(hash);
  await expect(
    page.getByRole("link", { name: "上一页", exact: true }),
  ).toBeVisible();
  const row = page.locator("tbody tr").first();
  await row.getByRole("link", { name: "核对订单", exact: true }).click();
  const orderHash = new URL(page.url()).hash;
  await expect(
    page.getByRole("link", { name: "← 采购订单", exact: true }),
  ).toHaveAttribute("href", hash.slice(1));
  const orderId = orderHash.match(/procurement\/([^?]+)/)[1],
    order = await read(page, "/procurement/orders/" + orderId);
  if (!order.lines[0].itemLink) {
    const i = await api(page, "/items", { title: "返回路径关联合成商品" });
    await api(page, "/procurement/lines/" + order.lines[0].id + "/review", {
      version: order.lines[0].version,
      businessDecision: "INCLUDE",
      possession: "IN_HAND",
      reviewNote: "合成确认",
    });
    await api(page, "/procurement/lines/" + order.lines[0].id + "/link-item", {
      itemId: i.id,
      note: "合成返回路径",
    });
    await page.getByRole("link", { name: "← 采购订单", exact: true }).click();
    await page
      .locator("tbody tr")
      .first()
      .getByRole("link", { name: "核对订单", exact: true })
      .click();
  }
  await page
    .getByRole("link", { name: /^查看 TM/ })
    .first()
    .click();
  await expect(page.locator(".product-overview")).toBeVisible();
  await page.getByRole("button", { name: "编辑商品", exact: true }).click();
  await page.getByLabel("中文介绍", { exact: true }).fill("合成采购往返补充");
  await page.locator("details.studio-more summary").click();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page.locator(".product-overview")).toContainText(
    "合成采购往返补充",
  );
  await page.getByRole("link", { name: "← 返回采购记录", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4320/" + orderHash);
  await page.getByRole("link", { name: "← 采购订单", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4320" + hash);
  await expect(
    page.getByRole("link", { name: "上一页", exact: true }),
  ).toBeVisible();
});

test("图片归档按商品名称选择，保留来源输入且原图与中文批次状态可用", async ({
  page,
}) => {
  const title = "归档找货 " + randomUUID(),
    i = await api(page, "/items", { title }),
    b = await api(page, "/intake/batches", { name: title });
  const auth = await read(page, "/auth/me");
  const original = await sharp({
    create: { width: 160, height: 240, channels: 3, background: "#ccc" },
  })
    .png()
    .toBuffer();
  const response = await page.request.post(
    "/api/intake/batches/" + b.id + "/upload",
    {
      headers: {
        Origin: new URL(page.url()).origin,
        "X-CSRF-Token": auth.csrf,
        "Idempotency-Key": randomUUID(),
      },
      multipart: {
        file: { name: "unknown.png", mimeType: "image/png", buffer: original },
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const file = await response.json();
  await page.goto("/#/intake");
  await expect(page.locator("tr").filter({ hasText: title })).toContainText(
    "进行中",
  );
  await page.getByRole("link", { name: title, exact: true }).click();
  const row = page.locator("tr").filter({ hasText: "unknown.png" });
  await expect(
    row.getByRole("link", { name: "查看原图 unknown.png", exact: true }),
  ).toHaveAttribute("href", "/api/intake/files/" + file.id + "/original");
  const received = await page.request.get(
    "/api/intake/files/" + file.id + "/original",
  );
  expect(await received.body()).toEqual(original);
  await row.getByRole("button", { name: "确认归属", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("本次归档依据及来源").fill("合成自有照片，人工匹配");
  await d.getByLabel("按名称或编号找商品").fill(title);
  await d.getByRole("button", { name: "查找商品", exact: true }).click();
  await d
    .getByRole("button", { name: i.code + " · " + title, exact: true })
    .click();
  await expect(d.getByLabel("商品TM号")).toHaveValue(i.code);
  await expect(d.getByLabel("本次归档依据及来源")).toHaveValue(
    "合成自有照片，人工匹配",
  );
  await d.getByRole("button", { name: "确认归档", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(row).toContainText("已归档");
  const item = await read(page, "/items/" + i.id);
  expect(item.assets).toHaveLength(1);
  expect(item.assets[0]).toMatchObject({ rights: "INTERNAL", verified: false });
});

test("分次加入选品按合并后的数量限制，超限不改变已有选择", async ({ page }) => {
  const prefix = "选品容量 " + randomUUID();
  const rows = [];
  for (let n = 0; n < 41; n++)
    rows.push(await api(page, "/items", { title: prefix + " " + n }));
  for (let n = 0; n < 40; n++) {
    await page.evaluate((id) => {
      location.hash = "/items?q=" + id;
    }, rows[n].code);
    await page.locator("#select-page").check();
    await page.locator(".bulk-more > summary").click();
    await page
      .getByRole("button", { name: "创建客户选品", exact: true })
      .click();
    await expect(page.locator(".selection-row")).toHaveCount(n + 1);
  }
  await page.evaluate((id) => {
    location.hash = "/items?q=" + id;
  }, rows[40].code);
  await page.locator("#select-page").check();
  await page.locator(".bulk-more > summary").click();
  await page.getByRole("button", { name: "创建客户选品", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("超过40件");
  await page.evaluate(() => {
    location.hash = "/collections/new";
  });
  await expect(page.locator(".selection-row")).toHaveCount(40);
});

for (const route of ["sales", "inquiries", "listings"])
  test(`${route}重置保留商品与返回路径，查看全部才解除商品范围`, async ({
    page,
  }) => {
    const title = "记录范围 " + randomUUID();
    const item = await api(page, "/items", { title });
    const back = "#/items/" + item.id + "/edit";
    const query = new URLSearchParams({
      itemId: item.id,
      returnTo: back,
      q: "没有匹配的筛选",
      channel: "不匹配渠道",
      page: "3",
      ...(route === "inquiries" ? {} : { dataMode: "TEST" }),
    });
    await page.goto("/#/" + route + "?" + query);
    await page.getByRole("link", { name: "重置", exact: true }).click();
    await expect(
      page.getByLabel(route === "sales" ? "搜索成交商品" : "搜索商品", {
        exact: true,
      }),
    ).toHaveValue("");
    let params = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
    expect(params.get("itemId")).toBe(item.id);
    expect(params.get("returnTo")).toBe(back);
    expect(params.has("page")).toBe(false);
    expect(params.has("channel")).toBe(false);
    if (route !== "inquiries") expect(params.get("dataMode")).toBe("TEST");
    await expect(page.locator(".inquiry-context")).toContainText(
      "当前仅显示这件商品",
    );
    await page
      .getByRole("link", {
        name: route === "inquiries" ? "查看全部询盘" : "查看全部记录",
        exact: true,
      })
      .click();
    await expect(page.locator(".inquiry-context")).not.toContainText(
      "当前仅显示这件商品",
    );
    params = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
    expect(params.has("itemId")).toBe(false);
    expect(params.get("returnTo")).toBe(back);
    if (route !== "inquiries") expect(params.get("dataMode")).toBe("TEST");
    await page
      .getByRole("link", { name: "返回商品工作区", exact: true })
      .click();
    await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(
      title,
    );
  });

test("待办进入单条询盘后重置仍只显示原记录，返回保留待办筛选", async ({
  page,
}) => {
  const item = await api(page, "/items", { title: "待办返回 " + randomUUID() });
  const customer = "本次客户 " + randomUUID(),
    other = "其他客户 " + randomUUID();
  const inquiry = await api(page, "/inquiries", {
    itemId: item.id,
    channel: "合成",
    customerRef: customer,
  });
  await api(page, "/inquiries", {
    itemId: item.id,
    channel: "合成",
    customerRef: other,
  });
  const back = "#/tasks?scope=INQUIRY&q=" + encodeURIComponent("待办返回");
  await page.goto(
    "/#/inquiries?" +
      new URLSearchParams({
        id: inquiry.id,
        from: "tasks",
        returnTo: back,
        q: "没有匹配",
      }),
  );
  await page.getByRole("link", { name: "重置", exact: true }).click();
  await expect(page.locator("main")).toContainText(customer);
  await expect(page.locator("main")).not.toContainText(other);
  await page.getByRole("link", { name: "返回来源页面", exact: true }).click();
  await expect(page.getByLabel("查看范围", { exact: true })).toHaveValue(
    "INQUIRY",
  );
  await expect(page.getByLabel("搜索事项 / 商品", { exact: true })).toHaveValue(
    "待办返回",
  );
});

test("选品草稿关页恢复时重读商品且只保存账号范围内的必要字段", async ({ page, context }) => {
  const prefix = "选品草稿 " + randomUUID();
  const item = await api(page, "/items", { title: prefix });
  await page.goto("/#/items?q=" + encodeURIComponent(prefix));
  await page.locator("#select-page").check();
  await page.locator(".bulk-more > summary").click();
  await page.getByRole("button", { name: "创建客户选品", exact: true }).click();
  await page.getByLabel("合集名称", { exact: true }).fill("待继续 " + prefix);
  const owner = (await read(page, "/auth/me")).user.id;
  const draft = await page.evaluate(id => JSON.parse(localStorage.getItem("tome:collection-draft:" + id)), owner);
  expect(draft.itemIds).toEqual([item.id]);
  expect(Object.keys(draft).sort()).toEqual(["attempt", "channelId", "itemIds", "title", "updatedAt"]);
  const latest = await read(page, "/items/" + item.id);
  await api(page, "/items/" + item.id, { version: latest.version, title: prefix + " 已更新" }, "PATCH");
  await page.close();
  const resumed = await context.newPage();
  await resumed.goto("/#/collections/new");
  await expect(resumed.getByLabel("合集名称", { exact: true })).toHaveValue("待继续 " + prefix);
  await expect(resumed.locator(".selection-row")).toContainText(prefix + " 已更新");
  await resumed.getByLabel("我已确认选择的商品，生成本次客户选品快照").check();
  await resumed.getByRole("button", { name: "生成选品合集", exact: true }).click();
  await expect(resumed.locator("[data-collection-error]")).toContainText("部分商品尚未就绪");
  expect((await read(resumed, "/items/" + item.id)).packages).toHaveLength(0);
  const email = `draft-owner-${randomUUID()}@tome.test`, password = "Synthetic!" + randomUUID();
  await api(resumed, "/auth/users", { email, password, name: "另一位选品员", role: "OPERATOR" });
  await resumed.getByRole("button", { name: "退出登录", exact: true }).click();
  await fillLogin(resumed, email, password);
  await submitLogin(resumed);
  await expect(resumed.getByLabel("合集名称", { exact: true })).toHaveValue("");
  await expect(resumed.locator(".selection-row")).toHaveCount(0);
});
