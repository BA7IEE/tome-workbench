const { submitLogin } = require("./login.cjs");
const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const sharp = require("sharp");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await submitLogin(page);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
}
async function api(page, path, body, method = "POST") {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const r = await page.request.fetch("/api" + path, {
    method,
    data: body,
    headers: {
      Origin: "http://127.0.0.1:4320",
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function machine(
  page,
  path,
  token,
  body,
  method = "POST",
  key = randomUUID(),
) {
  const r = await page.request.fetch("/api" + path, {
    method,
    data: body,
    headers: { "X-Ingest-Token": token, "Idempotency-Key": key },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
function trrOrder(sourceId, suffix) {
  const rows = [
    ["WDI571039", "Diane von Furstenberg", "Silk Midi Length Dress", 19500],
    ["WDI581338", "Diane von Furstenberg", "Wool Knee-Length Dress", 12500],
    [
      "GIO194599",
      "Giorgio Armani",
      "Virgin Wool Houndstooth Print Blazer",
      6500,
    ],
    ["WDI580085", "Diane von Furstenberg", "Nylon Long Dress", 19500],
    ["LAN245875", "Lanvin", "Linen Mini Dress", 13500],
    ["LAN244886", "Lanvin", "Silk Knee-Length Dress w/ Tags", 21000],
    ["LAN245375", "Lanvin", "Silk Knee-Length Dress", 17500],
  ];
  const lines = rows.map(([sku, brand, title, lineAmount]) => ({
    lineKey: sku,
    sourceSku: sku,
    title,
    brandRaw: brand,
    categoryRaw: "Women / Clothing / Dresses",
    productUrl: "https://example.invalid/" + sku,
    currency: "USD",
    lineAmount,
    sourceCurrentPrice: null,
    sourceEstimatedRetail: null,
    sourceConditionRaw: "",
    sourceStatusRaw: "",
    sizeLabelRaw: "",
    colorRaw: "",
    materialRaw: "",
    measurements: {},
    measurementsEstimated: false,
    descriptionRaw: "",
    imageUrls: [],
    rawPayload: { synthetic: true },
  }));
  Object.assign(lines[0], {
    sourceCurrentPrice: 7800,
    sourceEstimatedRetail: 40000,
    sourceConditionRaw: "Excellent",
    sourceStatusRaw: "Sold",
    sizeLabelRaw: "XL",
    colorRaw: "Blue",
    materialRaw: "100% Silk",
    measurements: { Bust: "37 in", Length: "44.5 in" },
    measurementsEstimated: true,
  });
  return {
    procurementSourceId: sourceId,
    externalOrderNo: "TRR-V1-" + suffix,
    orderedAt: "2026-06-27T12:00:00.000Z",
    sourceStatusRaw: "Shipped",
    returnabilityRaw: "Not returnable",
    currency: "USD",
    subtotalAmount: 110000,
    totalAmount: 70200,
    paymentAmount: 70200,
    rawPayload: { synthetic: true },
    lines,
    adjustments: [
      {
        adjustmentKey: "SHIPPING",
        kind: "SHIPPING",
        label: "Shipping",
        amount: 6000,
        currency: "USD",
      },
      {
        adjustmentKey: "STORE_CREDIT",
        kind: "STORE_CREDIT",
        label: "Store Credit",
        amount: -7500,
        currency: "USD",
      },
      {
        adjustmentKey: "D60",
        kind: "DISCOUNT",
        label: "Discount",
        amount: -11700,
        currency: "USD",
      },
      {
        adjustmentKey: "D20",
        kind: "DISCOUNT",
        label: "Discount",
        amount: -3800,
        currency: "USD",
      },
      {
        adjustmentKey: "D30",
        kind: "DISCOUNT",
        label: "Discount",
        amount: -17400,
        currency: "USD",
      },
      {
        adjustmentKey: "D40",
        kind: "DISCOUNT",
        label: "Discount",
        amount: -5400,
        currency: "USD",
      },
    ],
    shipments: [
      {
        shipmentKey: "PKG-A",
        externalShipmentRef: "SYN-A",
        carrier: "Synthetic",
        statusRaw: "Shipped",
        shippedAt: null,
        deliveredAt: null,
        lineKeys: ["WDI571039", "WDI581338", "GIO194599"],
        rawPayload: {},
      },
      {
        shipmentKey: "PKG-B",
        externalShipmentRef: "SYN-B",
        carrier: "Synthetic",
        statusRaw: "Shipped",
        shippedAt: null,
        deliveredAt: null,
        lineKeys: ["WDI580085", "LAN245875", "LAN244886", "LAN245375"],
        rawPayload: {},
      },
    ],
    returns: [],
  };
}
async function setupAgentOrder(page) {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase();
  const source = await api(page, "/procurement/sources", {
    code: "V1" + suffix,
    name: "TRR V1 " + suffix,
    kind: "MARKETPLACE",
    defaultCurrency: "USD",
    notes: "browser synthetic",
  });
  const session = await api(page, "/ingest/sessions", {
    procurementSourceId: source.id,
    label: "Browser Agent " + suffix,
    ttlMinutes: 60,
  });
  const orderInput = trrOrder(source.id, suffix),
    order = await machine(
      page,
      "/agent-ingest/orders",
      session.token,
      orderInput,
    );
  const batch = await machine(page, "/agent-ingest/batches", session.token, {
    externalBatchKey: "history-" + suffix,
    agentName: "Synthetic Agent",
    agentVersion: "1.0",
    kind: "ORDER_HISTORY",
    rawManifest: { synthetic: true },
  });
  const byKey = new Map(order.lines.map((x) => [x.lineKey, x]));
  const candidates = orderInput.lines.map((line) => ({
    externalKey: `TRR:${orderInput.externalOrderNo}:${line.lineKey}`,
    sourceItemKey: line.sourceSku,
    purchaseLineId: byKey.get(line.lineKey).id,
    titleRaw: line.title,
    brandRaw: line.brandRaw,
    categoryRaw: line.categoryRaw,
    conditionRaw: line.sourceConditionRaw,
    statusRaw: line.sourceStatusRaw,
    currency: line.currency,
    sourceLineAmount: line.lineAmount,
    sourceCurrentPrice: line.sourceCurrentPrice,
    sourceEstimatedRetail: line.sourceEstimatedRetail,
    sourceFacts: {
      sizeLabel: line.sizeLabelRaw,
      color: line.colorRaw,
      material: line.materialRaw,
      measurements: line.measurements,
    },
    rawPayload: { synthetic: true, sku: line.sourceSku },
  }));
  const imported = await machine(
    page,
    `/agent-ingest/batches/${batch.id}/candidates`,
    session.token,
    { candidates },
  );
  return { source, session, order, batch, orderInput, candidates, imported };
}
async function uploadCandidatePhoto(page, token, id) {
  const marker = randomUUID();
  const buffer = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="460"><rect width="360" height="460" fill="#eee"/><path d="M110 70h140l40 90-55 30-10 200H135l-10-200-55-30z" fill="#555"/><text x="4" y="452" font-size="4">${marker}</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const r = await page.request.post(
    `/api/agent-ingest/candidates/${id}/assets`,
    {
      headers: { "X-Ingest-Token": token, "Idempotency-Key": randomUUID() },
      multipart: {
        sourceUrl: "https://example.invalid/image.jpg",
        roleHint: "PRODUCT",
        file: { name: "source.png", mimeType: "image/png", buffer },
      },
    },
  );
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test.beforeEach(async ({ page }) => login(page));

test("v1 Agent导入7件TRR后只在待确认页批量一次生成7个TM", async ({ page }) => {
  const x = await setupAgentOrder(page);
  await uploadCandidatePhoto(page, x.session.token, x.imported.rows[0].id);
  const before = (
    await (await page.request.get("/api/items?dataMode=ALL")).json()
  ).total;
  await page.goto("/#/candidates?sourceId=" + x.source.id);
  await expect(
    page.getByRole("heading", { name: "待确认商品", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".candidate-card")).toHaveCount(7);
  const first = page
    .locator(".candidate-card")
    .filter({ hasText: "WDI571039" });
  await expect(first.locator("img")).toBeVisible();
  await expect(first).toContainText("Excellent");
  await expect(first).toContainText("Sold");
  await page.getByLabel("选择本页").check();
  await expect(page.locator("#candidate-bulk")).toContainText("已选 7 件");
  await page
    .getByRole("button", { name: "批量生成TM", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "批量生成TM · 7件" });
  await expect(d.getByLabel("生成TM后的状态")).toHaveValue("PAUSED");
  await d.getByLabel("生成TM后的状态").selectOption("AVAILABLE");
  await d.getByLabel("我已确认所选商品为实际持有并应纳入经营").check();
  await d.getByRole("button", { name: "确认生成TM", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(page.locator(".candidate-card")).toHaveCount(0);
  const after = (
    await (await page.request.get("/api/items?dataMode=ALL")).json()
  ).total;
  expect(after).toBe(before + 7);
  const confirmed = await (
    await page.request.get(
      `/api/ingest/candidates?decision=CONFIRMED&sourceId=${x.source.id}&size=100`,
    )
  ).json();
  expect(confirmed.total).toBe(7);
  expect(confirmed.rows.every((r) => r.item)).toBe(true);
  for (const c of confirmed.rows)
    expect((await (await page.request.get(`/api/items/${c.item.id}`)).json()).status).toBe("AVAILABLE");
});
test("v1 待确认真实支持一页100件，101件时确认一页后只剩1件待下一批", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase();
  const source = await api(page, "/procurement/sources", {
    code: "B" + suffix,
    name: "Bulk " + suffix,
    kind: "OFFLINE",
    defaultCurrency: "CNY",
    notes: "100 item browser gate",
  });
  const session = await api(page, "/ingest/sessions", {
    procurementSourceId: source.id,
    label: "Bulk Agent",
    ttlMinutes: 60,
  });
  const batch = await machine(page, "/agent-ingest/batches", session.token, {
    externalBatchKey: "bulk-" + suffix,
    agentName: "Bulk Synthetic Agent",
    agentVersion: "1.0",
    kind: "ITEM_BATCH",
    rawManifest: { synthetic: true },
  });
  const candidates = Array.from({ length: 101 }, (_, n) => ({
    externalKey: `BULK:${suffix}:${n + 1}`,
    sourceItemKey: `B${String(n + 1).padStart(3, "0")}`,
    purchaseLineId: null,
    titleRaw: `批量候选 ${suffix} ${n + 1}`,
    brandRaw: "",
    categoryRaw: "Clothing",
    conditionRaw: "",
    statusRaw: "",
    currency: "CNY",
    sourceLineAmount: 10000 + n,
    sourceCurrentPrice: null,
    sourceEstimatedRetail: null,
    sourceFacts: {},
    rawPayload: { synthetic: true, index: n + 1 },
  }));
  await machine(
    page,
    `/agent-ingest/batches/${batch.id}/candidates`,
    session.token,
    { candidates },
  );
  await page.goto("/#/candidates?sourceId=" + source.id);
  await expect(page.locator(".candidate-card")).toHaveCount(100);
  await page.getByLabel("选择本页").check();
  await expect(page.locator("#candidate-bulk")).toContainText("已选 100 件");
  await page
    .getByRole("button", { name: "批量生成TM", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "批量生成TM · 100件" });
  await d.getByLabel("我已确认所选商品为实际持有并应纳入经营").check();
  await d.getByRole("button", { name: "确认生成TM" }).click();
  await expect(d).not.toBeVisible({ timeout: 45000 });
  await expect(page.locator(".candidate-card")).toHaveCount(1, {
    timeout: 45000,
  });
  const pending = await (
    await page.request.get(
      `/api/ingest/candidates?sourceId=${source.id}&decision=PENDING&size=100`,
    )
  ).json();
  expect(pending.total).toBe(1);
});
test("v1 TRR订单级成本一次分摊到全部TM，商品页直接显示人民币成本", async ({
  page,
}) => {
  const x = await setupAgentOrder(page);
  await api(page, "/ingest/candidates/bulk-confirm", {
    ids: x.imported.rows.map((r) => r.id),
    possession: "IN_HAND",
    status: "AVAILABLE",
  });
  await page.goto("/#/procurement/" + x.order.id);
  await expect(
    page.getByRole("heading", {
      name: new RegExp(x.orderInput.externalOrderNo),
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "来源成本规则", exact: true }).click();
  let d = page.getByRole("dialog", { name: "来源成本规则" });
  await d.getByLabel("每单附加成本（人民币）").fill("200");
  await d.getByLabel("Store Credit是否计入支付价值").selectOption("true");
  await d.getByRole("button", { name: "保存规则" }).click();
  await expect(d).not.toBeVisible();
  await page
    .getByRole("button", { name: "确认订单成本依据", exact: true })
    .click();
  d = page.getByRole("dialog", { name: "确认订单成本依据" });
  await d.getByLabel("换算方式").selectOption("ACTUAL_CASH_CNY");
  await d.getByLabel("实际人民币扣款").fill("5054.40");
  await d.getByLabel("本单附加成本（人民币）").fill("200");
  await d.getByLabel("确认依据").fill("浏览器合成测试：实际扣款5054.40");
  await d.getByRole("button", { name: "保存成本依据" }).click();
  await expect(d).not.toBeVisible();
  const panel = page.locator(".procurement-cost-panel");
  await expect(panel).toContainText("CNY 5,794.40");
  await expect(panel.locator("tbody tr")).toHaveCount(7);
  await panel
    .getByRole("button", { name: "确认写入 7 件TM成本", exact: true })
    .click();
  await expect(page.locator("#toast")).toContainText("人民币成本已写入TM商品");
  const confirmed = await (
      await page.request.get(
        `/api/ingest/candidates?decision=CONFIRMED&sourceId=${x.source.id}&size=100`,
      )
    ).json(),
    itemId = confirmed.rows[0].item.id;
  const item = await (await page.request.get("/api/items/" + itemId)).json();
  expect(item.currentCostCny).toBeGreaterThan(0);
  await page.goto("/#/items/" + itemId + "/edit");
  await expect(page.locator(".studio-cost-fact")).toContainText(
    "当前人民币成本",
  );
  await expect(page.locator(".studio-cost-fact")).toContainText("CNY");
});

test("Credit退款明细校验后一次算净额，重开保留明细与固定汇率", async ({ page }) => {
  const x = await setupAgentOrder(page);
  await api(page, "/ingest/candidates/bulk-confirm", {
    ids: x.imported.rows.map(r => r.id), possession: "IN_HAND", status: "AVAILABLE",
  });
  await page.goto("/#/procurement/" + x.order.id);
  await page.getByRole("button", { name: "确认订单成本依据", exact: true }).click();
  let d = page.getByRole("dialog", { name: "确认订单成本依据" });
  await d.getByLabel("实际人民币扣款").fill("2160");
  await d.getByLabel("本单附加成本（人民币）").fill("200");
  await d.getByLabel("确认依据").fill("合成支付300美元现金、100美元Credit，退款50美元Credit且无需退货");
  await d.getByText("核对现金与Credit支付、退款", { exact: true }).click();
  await d.getByLabel("原始现金支付（USD）").fill("300");
  await d.getByRole("button", { name: "保存成本依据" }).click();
  await expect(d).toContainText("请填全现金、Credit及两项退款金额");
  await expect(d.getByLabel("原始现金支付（USD）")).toHaveValue("300");
  await d.getByLabel("使用的Store Credit（USD）").fill("100");
  await d.getByLabel("退回现金（USD）").fill("0");
  await d.getByLabel("退回Store Credit（USD）").fill("500");
  await d.getByRole("button", { name: "保存成本依据" }).click();
  await expect(d).toContainText("退款不能超过现金与Credit支付总额");
  await d.getByLabel("退回Store Credit（USD）").fill("50");
  await d.getByText("退款明确属于某件商品", { exact: true }).click();
  await d.getByLabel(`${x.orderInput.lines[0].title} · 退款（USD）`, { exact: true }).fill("20");
  await d.getByRole("button", { name: "保存成本依据" }).click();
  await expect(d).toContainText("逐件退款合计必须等于现金与Credit退款总额");
  await d.getByLabel(`${x.orderInput.lines[0].title} · 退款（USD）`, { exact: true }).fill("50");
  await d.getByRole("button", { name: "保存成本依据" }).click();
  await expect(d).not.toBeVisible();
  await expect(page.locator(".procurement-cost-panel")).toContainText("CNY 2,720.00");
  await page.getByRole("button", { name: "修改订单成本依据", exact: true }).click();
  d = page.getByRole("dialog", { name: "确认订单成本依据" });
  await expect(d.getByLabel("退回Store Credit（USD）")).toHaveValue("50.00");
  await expect(d.getByLabel(`${x.orderInput.lines[0].title} · 退款（USD）`, { exact: true })).toHaveValue("50.00");
  await expect(d.getByLabel("确认汇率")).toHaveValue("7.2");
  await expect(d.getByLabel("RMA/排除后的最终经济支付（订单币种）")).toHaveValue("350.00");
  // Re-saving the persisted breakdown must not subtract the same refund again.
  await d.getByRole("button", { name: "保存成本依据" }).click();
  await expect(d).not.toBeVisible();
  const panel = page.locator(".procurement-cost-panel");
  await expect(panel).toContainText("CNY 2,720.00");
  await panel.getByRole("button", { name: "确认写入 7 件TM成本", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("人民币成本已写入TM商品");
  const preview = await (await page.request.get(`/api/costing/orders/${x.order.id}/preview`)).json();
  expect(preview.rows.reduce((n, r) => n + r.totalCny, 0)).toBe(272000);
});

test("v1 Agent接入Token只在创建时显示一次，之后后台只保留会话元数据", async ({
  page,
}) => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase(),
    source = await api(page, "/procurement/sources", {
      code: "TOK" + suffix,
      name: "Token Source " + suffix,
      kind: "MARKETPLACE",
      defaultCurrency: "USD",
      notes: "token browser gate",
    });
  await page.goto("/#/candidates");
  await page.getByRole("button", { name: "Agent接入", exact: true }).click();
  let d = page.getByRole("dialog", { name: "Agent接入" });
  await d.getByRole("button", { name: "＋ 创建导入会话", exact: true }).click();
  d = page.getByRole("dialog", { name: "创建Agent导入会话" });
  await d.getByLabel("数据来源").selectOption(source.id);
  await d.getByLabel("会话名称").fill("一次性Token测试");
  await d.getByRole("button", { name: "创建会话" }).click();
  d = page.getByRole("dialog", { name: "Agent接入信息 · 仅显示一次" });
  const token = (await d.locator("code").textContent()).trim();
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  await d.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "Agent接入", exact: true }).click();
  d = page.getByRole("dialog", { name: "Agent接入" });
  await expect(d).toContainText("一次性Token测试");
  await expect(d).not.toContainText(token);
});

test("v1 手机待确认保持单一批量任务且无横向溢出", async ({ browser, page }) => {
  const x = await setupAgentOrder(page),
    context = await browser.newContext({
      baseURL: "http://127.0.0.1:4320",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
  const mobile = await context.newPage();
  try {
    await login(mobile);
    await mobile.goto("/#/candidates?sourceId=" + x.source.id);
    const root = mobile.locator(".candidate-page");
    await expect(root).toBeVisible();
    await expect(mobile.locator(".candidate-card")).toHaveCount(7);
    expect(
      await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    ).toBe(true);
    await mobile.getByLabel("选择本页").check();
    await expect(
      mobile.getByRole("button", { name: "批量生成TM", exact: true }),
    ).toBeVisible();
    await mobile.screenshot({
      path: "reports/screenshots/v1-candidates-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});


test("v1 经营待办把Agent候选直接带回对应来源的待确认处理页", async ({ page }) => {
  const x = await setupAgentOrder(page);
  await page.goto("/#/tasks?scope=CANDIDATE");
  await expect(page.getByRole("heading", { name: "经营待办", exact: true })).toBeVisible();
  await expect(page.locator(".metrics.compact")).toContainText("商品待确认");
  const row = page.locator("tbody tr").filter({ hasText: "商品待确认" }).filter({ hasText: x.candidates[0].titleRaw }).first();
  await expect(row).toContainText("商品待确认");
  await row.getByRole("link", { name: "去确认", exact: true }).click();
  await expect(page.getByRole("heading", { name: "待确认商品", exact: true })).toBeVisible();
  await expect(page.locator(".candidate-card")).toHaveCount(1);
  await expect(page.locator(".candidate-card").first()).toContainText("WDI571039");
});

test("v1.0.0-rc.3 同图候选在待确认页提示已有TM并可人工归入同一主档", async ({ page }) => {
  const marker = randomUUID();
  const buffer = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="381" height="479"><rect width="381" height="479" fill="#ddd8cf"/><text x="12" y="240" font-size="11">${marker}</text></svg>`),
  ).png().toBuffer();
  const upload = async (token, id, name) => {
    const r = await page.request.post(`/api/agent-ingest/candidates/${id}/assets`, {
      headers: { "X-Ingest-Token": token, "Idempotency-Key": randomUUID() },
      multipart: {
        sourceUrl: `https://example.invalid/${name}.jpg`,
        roleHint: "PRODUCT",
        file: { name: `${name}.png`, mimeType: "image/png", buffer },
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  };
  const first = await setupAgentOrder(page), a = first.imported.rows[0];
  await upload(first.session.token, a.id, "same-a");
  const created = await api(page, `/ingest/candidates/${a.id}/confirm`, {
    version: a.version,
    possession: "IN_HAND",
    status: "AVAILABLE",
    duplicateOverride: false,
    note: "浏览器测试第一来源建档",
  });
  const second = await setupAgentOrder(page), b = second.imported.rows[0];
  await upload(second.session.token, b.id, "same-b");
  await page.goto("/#/candidates?sourceId=" + second.source.id);
  const card = page.locator(".candidate-card").filter({ hasText: "WDI571039" });
  await expect(card).toContainText("疑似同一实物");
  await card.getByRole("button", { name: "核对重复", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "核对疑似重复商品" });
  await expect(dialog).toContainText("先判断是不是同一件实物");
  await dialog.getByRole("button", { name: "核对并关联已有TM", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "关联已有TM" });
  await expect(dialog).toContainText(created.code);
  await expect(dialog).toContainText("完全相同的来源图片");
  await expect(
    dialog.locator(`input[name="matchedItemRef"][value="${created.code}"]`),
  ).toBeChecked();
  await dialog.getByLabel("我已核对，确认这是同一件实物，不新建第二个TM").check();
  await dialog.getByRole("button", { name: "确认关联", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const confirmed = await (
    await page.request.get(`/api/ingest/candidates/${b.id}`)
  ).json();
  expect(confirmed.item.id).toBe(created.itemId);
  await page.goto("/#/candidates?sourceId=" + second.source.id + "&decision=CONFIRMED");
  const linkedCard = page.locator(".candidate-card").filter({ hasText: "WDI571039" });
  await expect(linkedCard).toContainText(created.code);
});


test("rc.4 经营待办默认聚焦高优先事项，手机按卡片阅读而不是横向大表", async ({ browser, page }) => {
  await page.goto("/#/tasks");
  await expect(page.getByRole("heading", { name: "经营待办", exact: true })).toBeVisible();
  await expect(page.getByLabel("查看范围")).toHaveValue("IMPORTANT");
  const desktopRows = page.locator(".work-queue-table tbody tr");
  expect(await desktopRows.count()).toBeLessThanOrEqual(60);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4320",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const mobile = await context.newPage();
  try {
    await login(mobile);
    await mobile.goto("/#/tasks");
    const root = mobile.locator(".work-queue-table");
    await expect(root).toBeVisible();
    const layout = await root.evaluate((el) => {
      const row = el.querySelector("tbody tr");
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        rowDisplay: row ? getComputedStyle(row).display : "",
        tableDisplay: getComputedStyle(el.querySelector("table")).display,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(2);
    expect(layout.rowDisplay).toBe("grid");
    expect(layout.tableDisplay).toBe("block");
  } finally {
    await context.close();
  }
});

test("rc.4 普通候选只保留单件处理入口，复杂动作退到二级弹窗", async ({ page }) => {
  const x = await setupAgentOrder(page);
  await page.goto("/#/candidates?sourceId=" + x.source.id);
  const card = page.locator(".candidate-card").filter({ hasText: "WDI571039" });
  await expect(card.getByRole("button", { name: "单件处理", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "确认新建TM", exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "关联已有TM", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "单件处理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "单件处理" });
  await expect(dialog.getByRole("button", { name: "关联已有TM", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认这是另一件并新建TM", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "调整本地字段", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "查看来源事实", exact: true })).toBeVisible();
});

test('跨页选择101件分段确认，真实写入回执丢失后重试不重复建档',async({page})=>{
  const suffix=randomUUID().slice(0,8).toUpperCase();
  const source=await api(page,'/procurement/sources',{code:'CP'+suffix,name:'跨页测试 '+suffix,kind:'OFFLINE',defaultCurrency:'CNY'});
  const session=await api(page,'/ingest/sessions',{procurementSourceId:source.id,label:'跨页合成',ttlMinutes:60});
  const batch=await machine(page,'/agent-ingest/batches',session.token,{externalBatchKey:'cross-'+suffix,agentName:'Synthetic',rawManifest:{synthetic:true}});
  const imported=await machine(page,`/agent-ingest/batches/${batch.id}/candidates`,session.token,{candidates:Array.from({length:101},(_,n)=>({externalKey:`CP:${suffix}:${n}`,titleRaw:`跨页合成商品${n}`,sourceFacts:{},rawPayload:{synthetic:true}}))});
  await page.goto('/#/candidates?sourceId='+source.id);
  await page.getByLabel('选择本页').check();
  await page.locator('#candidate-filter input[name=q]').fill('不存在的合成查询');
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await expect(page.locator('#candidate-bulk')).toBeHidden();
  await page.locator('#candidate-filter input[name=q]').fill('');
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await expect(page.locator('[data-pick]:checked')).toHaveCount(0);
  await page.getByLabel('选择本页').check();

  await page.getByRole('link',{name:'下一页',exact:true}).click();
  await expect(page.locator('.candidate-card')).toHaveCount(1);
  await expect(page.locator('#candidate-bulk')).toContainText('已选 100 件');
  await page.getByLabel('选择本页').check();
  await expect(page.locator('#candidate-bulk')).toContainText('已选 101 件');
  await page.getByRole('link',{name:'上一页',exact:true}).click();
  await expect(page.locator('[data-pick]:checked')).toHaveCount(100);
  let lost=false;const requests=[];
  await page.route('**/api/ingest/candidates/bulk-confirm',async route=>{
    requests.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
    const response=await route.fetch();
    if(!lost) {lost=true;await route.abort('failed');} else await route.fulfill({response});
  });
  await page.getByRole('button',{name:'批量生成TM',exact:true}).click();
  const d=page.getByRole('dialog',{name:'批量生成TM · 101件'});
  await d.getByLabel('我已确认所选商品为实际持有并应纳入经营').check();
  await d.getByRole('button',{name:'确认生成TM',exact:true}).click();
  await expect(d.locator('.form-error')).toContainText('网络中断',{timeout:45000});
  const interim=await (await page.request.get(`/api/ingest/candidates?sourceId=${source.id}&decision=CONFIRMED`)).json();
  expect(interim.total).toBe(100);
  await d.getByRole('button',{name:'确认生成TM',exact:true}).click();
  await expect(d).not.toBeVisible({timeout:45000});
  await expect(page.locator('.candidate-card')).toHaveCount(0);
  const result=await (await page.request.get(`/api/ingest/candidates?sourceId=${source.id}&decision=CONFIRMED`)).json();
  expect(result.total).toBe(101);expect(imported.rows.length).toBe(101);
  expect(requests[0]).toEqual(requests[1]);expect(requests[2].body.ids).toHaveLength(1);
  await page.unroute('**/api/ingest/candidates/bulk-confirm');
});

test('来源图册直接查看全部原图与参数，建档后原地查看不丢人工草稿',async({page})=>{
  const {createHash}=require('node:crypto'),x=await setupAgentOrder(page),first=x.imported.rows[0],marker=randomUUID();
  const files=[];
  for(let n=0;n<2;n++) {
    const width=1800+n,height=2200+n,buffer=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${n?'#abc':'#cab'}"/><text x="100" y="200">${marker}-${n}</text></svg>`)).png().toBuffer();
    files.push({buffer,width,height,sha256:createHash('sha256').update(buffer).digest('hex'),sourceUrl:`https://example.invalid/original-${n}.png`,quality:'ORIGINAL'});
  }
  const input={...x.candidates[0],sourceFacts:{...x.candidates[0].sourceFacts,description:'合成来源完整描述，原文保留',material:'100% Silk',measurements:{Bust:'37 in',Length:'44.5 in'},capture:{pageUrl:'https://example.invalid/item',capturedAt:'2026-09-14T00:00:00.000Z',fields:[{path:'titleRaw',label:'名称',status:'CAPTURED'},{path:'sourceFacts.description',label:'商品描述',status:'CAPTURED'}],images:files.map(({buffer,...rest})=>rest)}}};
  const updated=await machine(page,`/agent-ingest/batches/${x.batch.id}/candidates`,x.session.token,{candidates:[input]});
  for(const f of files) {
    const r=await page.request.post(`/api/agent-ingest/candidates/${first.id}/assets`,{headers:{'X-Ingest-Token':x.session.token,'Idempotency-Key':randomUUID()},multipart:{sourceUrl:f.sourceUrl,file:{name:'original.png',mimeType:'image/png',buffer:f.buffer}}});expect(r.ok(),await r.text()).toBeTruthy();
  }
  await machine(page,`/agent-ingest/batches/${x.batch.id}/seal`,x.session.token,{});
  await page.goto('/#/candidates?sourceId='+x.source.id);
  const card=page.locator(`[data-candidate="${first.id}"]`);
  await expect(card).toContainText('清单已核对');
  await card.getByRole('button',{name:'查看图片与资料',exact:true}).click();
  const d=page.getByRole('dialog',{name:'商品来源资料'});
  await expect(d).toContainText('100% Silk');await expect(d).toContainText('37 in');await expect(d).toContainText('合成来源完整描述');
  await expect(d.locator('.evidence-gallery img')).toHaveCount(2);
  for(let n=0;n<2;n++) await expect.poll(()=>d.locator('.evidence-gallery img').nth(n).evaluate(i=>i.naturalWidth)).toBe(1800+n);
  await page.setViewportSize({width:390,height:844});
  expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:'reports/screenshots/ingest-original-evidence-mobile.png',fullPage:true});
  await d.getByRole('button',{name:'关闭',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'导入检查',exact:true}).click();
  await page.getByRole('button',{name:'查看检查结果',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'批次完整性检查'})).toContainText('已收到7件');
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  const confirmed=await api(page,`/ingest/candidates/${first.id}/confirm`,{version:updated.rows[0].version,possession:'IN_HAND',note:'合成原图确认'});
  // The source gallery alone did not prove that operators could recognize the
  // imported item in the catalog. Reference photos must remain internal while
  // being visible on the ordinary catalog path.
  const catalog = await (await page.request.get('/api/items?q='+confirmed.code)).json();
  const importedItem = catalog.rows.find(i=>i.id===confirmed.itemId);
  expect(importedItem._count.assets).toBe(2);
  expect(importedItem.assets[0].role).toBe('REFERENCE');
  expect(importedItem.assets[0].rights).toBe('INTERNAL');
  expect(importedItem.assets[0].verified).toBe(false);
  await page.goto('/#/items?q='+confirmed.code);
  const catalogRow=page.locator('tbody tr').filter({hasText:confirmed.code});
  await expect(catalogRow).toContainText('2 张图片');
  await expect.poll(()=>catalogRow.locator('img').evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);
  await page.goto(`/#/items/${confirmed.itemId}/edit`);
  await page.getByLabel('商品名称',{exact:true}).fill('尚未保存的人工草稿');
  await page.getByRole('button',{name:'查看全部来源资料',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'商品来源资料'}).locator('.evidence-gallery img')).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.getByLabel('商品名称',{exact:true})).toHaveValue('尚未保存的人工草稿');
});

test('批量部分失败显示逐件原因，成功移除而失败保留供重新核对',async({page})=>{
  const x=await setupAgentOrder(page),first=x.imported.rows[0],second=x.imported.rows[1];
  await page.goto('/#/candidates?sourceId='+x.source.id);
  await page.locator(`[data-pick="${first.id}"]`).check();await page.locator(`[data-pick="${second.id}"]`).check();
  await api(page,`/ingest/candidates/${first.id}/review`,{version:first.version,possession:'UNKNOWN',title:'并发核对后的名称',note:'合成并发变更'});
  await page.getByRole('button',{name:'批量生成TM',exact:true}).click();
  await page.getByLabel('我已确认所选商品为实际持有并应纳入经营').check();
  await page.getByRole('button',{name:'确认生成TM',exact:true}).click();
  const result=page.getByRole('dialog',{name:'批量处理结果'});
  await expect(result).toContainText('1件成功，1件需要处理');await expect(result).toContainText('修改');
  await result.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.locator(`[data-candidate="${second.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-pick="${first.id}"]`)).toBeChecked();
  await page.locator(`[data-pick="${first.id}"]`).uncheck();await page.locator(`[data-pick="${first.id}"]`).check();
  await page.getByRole('button',{name:'批量生成TM',exact:true}).click();
  await page.getByLabel('我已确认所选商品为实际持有并应纳入经营').check();
  await page.getByRole('button',{name:'确认生成TM',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const confirmed=await (await page.request.get(`/api/ingest/candidates?sourceId=${x.source.id}&decision=CONFIRMED`)).json();expect(confirmed.total).toBe(2);
});


test('单件建档清除该件批量勾选并保留其他候选',async({page})=>{
  const x=await setupAgentOrder(page),first=x.imported.rows[0],second=x.imported.rows[1];
  await page.goto('/#/candidates?sourceId='+x.source.id);
  await page.locator(`[data-pick="${first.id}"]`).check();
  await page.locator(`[data-pick="${second.id}"]`).check();
  await page.locator(`[data-candidate="${first.id}"]`).getByRole('button',{name:'单件处理',exact:true}).click();
  await page.getByRole('button',{name:'确认这是另一件并新建TM',exact:true}).click();
  await page.getByLabel('我已确认实物在手并应纳入经营').check();
  await page.getByRole('button',{name:'确认生成新TM',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator(`[data-candidate="${first.id}"]`)).toHaveCount(0);
  await expect(page.locator('#candidate-bulk')).toContainText('已选 1 件');
  await expect(page.locator(`[data-pick="${second.id}"]`)).toBeChecked();
});

test('来源品牌成色与品相在商品常用位置可见，人工等级优先且不伪造字典', async ({page}) => {
  const x=await setupAgentOrder(page), first=x.imported.rows[0];
  const brand='合成未入字典品牌-'+randomUUID();
  const input={...x.candidates[0],brandRaw:brand,conditionRaw:'Excellent',sourceFacts:{...x.candidates[0].sourceFacts,conditionDescription:'Minor wear <not-a-tag> at cuff'}};
  const updated=await machine(page,`/agent-ingest/batches/${x.batch.id}/candidates`,x.session.token,{candidates:[input]});
  const confirmed=await api(page,`/ingest/candidates/${first.id}/confirm`,{version:updated.rows[0].version,possession:'IN_HAND',note:'合成来源字段可见性核对'});
  const getItem=async()=> (await page.request.get('/api/items/'+confirmed.itemId)).json();
  const original=await getItem();
  expect(original.brand).toBe('');
  expect(original.dictionary.brand).toBeUndefined();
  expect(original.facts.conditionGrade).toBe('');
  expect(original.facts.color).toBe('');
  expect(original.facts.attributes.sourceBrand).toBe(brand);
  expect(original.facts.attributes.sourceConditionDetails).toBe('Minor wear <not-a-tag> at cuff');
  const dictionary=await (await page.request.get('/api/dictionaries?kind=BRAND&exact=1&q='+encodeURIComponent(brand))).json();
  expect(dictionary.total).toBe(0);
  await page.goto('/#/items?q='+confirmed.code);
  const row=page.locator('tbody tr').filter({hasText:confirmed.code});
  await expect(row).toContainText(brand+'（来源品牌）');
  await expect(row).toContainText('来源成色：Excellent');
  await page.getByRole('button',{name:'图片',exact:true}).click();
  await expect(page.locator('article.product-card')).toContainText('来源成色：Excellent');
  await expect(page.locator('article.product-card')).toContainText('尺码 XL');
  await page.goto(`/#/items/${confirmed.itemId}/edit`);
  await expect(page.locator('[data-source-field=brand]')).toContainText(brand);
  await expect(page.locator('[data-source-field=condition]')).toContainText('Minor wear <not-a-tag> at cuff');
  await expect(page.locator('[data-source-field=condition] not-a-tag')).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'成色',exact:true})).toHaveValue('');
  await page.setViewportSize({width:390,height:844});
  expect(await page.locator('[data-source-field=condition]').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});
  // Explicit local maintenance is authoritative; displaying the source note
  // must neither select a grade nor replace an existing inspection note.
  const grades=await (await page.request.get('/api/dictionaries?kind=CONDITION')).json();
  const grade=grades.rows.find(r=>r.label==='良好');
  expect(grade).toBeTruthy();
  // The operator control is labeled 成色; 成色等级 is the backend dictionary name.
  await page.getByRole('combobox',{name:'成色',exact:true}).selectOption(grade.id);
  await page.getByLabel('瑕疵与使用痕迹',{exact:true}).fill('合成实物核验记录');
  // A committed database write is not yet a completed UI save. Hold the real
  // PATCH receipt until the busy-state/leave guard assertions have executed.
  let releaseReceipt, writes = 0;
  const receipt = new Promise(resolve => { releaseReceipt = resolve; });
  await page.route('**/api/items/'+confirmed.itemId, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    writes++;
    const response = await route.fetch();
    await receipt;
    await route.fulfill({response});
  });
  try {
    await page.getByRole('button',{name:'保存商品',exact:true}).click();
    await expect.poll(async()=> (await getItem()).facts.conditionGrade).toBe('良好');
    await expect(page.getByRole('button',{name:'保存商品',exact:true})).toBeDisabled();
    await expect(page.locator('.entry-save-state')).toHaveText('保存中…');
    await page.getByRole('link',{name:'取消编辑',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'正在保存，请稍候'})).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/items/'+confirmed.itemId+'/edit$'));
    expect(writes).toBe(1);
  } finally {
    releaseReceipt();
  }
  await expect(page.locator('.entry-save-state')).toHaveText('已保存');
  await expect(page.getByRole('button',{name:'保存商品',exact:true})).toBeEnabled();
  expect(writes).toBe(1);
  await page.goto('/#/items?q='+confirmed.code);
  await expect(page.locator('tbody tr').filter({hasText:confirmed.code})).toContainText('良好');
  await expect(page.locator('tbody tr').filter({hasText:confirmed.code})).not.toContainText('来源成色：Excellent');
  await page.goto(`/#/items/${confirmed.itemId}/edit`);
  await expect(page.getByLabel('瑕疵与使用痕迹',{exact:true})).toHaveValue('合成实物核验记录');
  await expect(page.locator('[data-source-field=condition]')).toContainText('Excellent');
  expect((await getItem()).facts.attributes).toEqual(original.facts.attributes);
});