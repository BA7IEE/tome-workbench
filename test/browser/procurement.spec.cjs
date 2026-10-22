const { submitLogin, fillLogin } = require("./login.cjs");
const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/");
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
}
const lines = [
  [
    "WDI571039",
    "WDI571039",
    "Diane von Furstenberg",
    "Silk Midi Length Dress",
    "Women / Clothing / Dresses",
    "195",
    "78",
    "400",
    "Excellent",
    "Sold",
    "XL",
    "Blue",
    "100% Silk; Lining 97% Polyester, 3% Spandex",
    "Bust 37 in; Waist 29 in; Hip 29 in; Length 44.5 in",
    "是",
    "https://example.test/WDI571039",
    "Synthetic TRR structure sample",
    "",
  ],
  [
    "WDI581338",
    "WDI581338",
    "Diane von Furstenberg",
    "Wool Knee-Length Dress",
    "Women / Clothing / Dresses",
    "125",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "GIO194599",
    "GIO194599",
    "Giorgio Armani",
    "Virgin Wool Houndstooth Print Blazer",
    "Women / Clothing / Jackets",
    "65",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "WDI580085",
    "WDI580085",
    "Diane von Furstenberg",
    "Nylon Long Dress",
    "Women / Clothing / Dresses",
    "195",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "LAN245875",
    "LAN245875",
    "Lanvin",
    "Linen Mini Dress",
    "Women / Clothing / Dresses",
    "135",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "LAN244886",
    "LAN244886",
    "Lanvin",
    "Silk Knee-Length Dress w/ Tags",
    "Women / Clothing / Dresses",
    "210",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "LAN245375",
    "LAN245375",
    "Lanvin",
    "Silk Knee-Length Dress",
    "Women / Clothing / Dresses",
    "175",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
];
const netBySku = {
  WDI571039: "78",
  WDI581338: "100",
  GIO194599: "52",
  WDI580085: "136.50",
  LAN245875: "81",
  LAN244886: "147",
  LAN245375: "122.50",
};
async function createOrder(page) {
  const before = (await (await page.request.get("/api/items?dataMode=ALL")).json()).total;
  const suffix = randomUUID().slice(0, 8).toUpperCase(), sourceName = "The RealReal 合成 " + suffix, orderNo = "TRR-SYN-" + suffix;
  const auth = await (await page.request.get("/api/auth/me")).json();
  const command = async (path, data) => {
    const result = await page.request.post("/api" + path, { data, headers: {
      Origin: new URL(page.url()).origin, "X-CSRF-Token": auth.csrf, "Idempotency-Key": randomUUID(),
    } });
    expect(result.ok(), await result.text()).toBeTruthy();
    return result.json();
  };
  const source = await command("/procurement/sources", { code: "TRR-" + suffix, name: sourceName, kind: "MARKETPLACE", defaultCurrency: "USD" });
  const order = await command("/procurement/orders/import", {
    procurementSourceId: source.id, externalOrderNo: orderNo, orderedAt: "2026-06-27T00:00:00.000Z",
    sourceStatusRaw: "Shipped", returnabilityRaw: "Not returnable", currency: "USD",
    subtotalAmount: 110000, totalAmount: 70200, paymentAmount: 70200, rawPayload: { synthetic: true },
    lines: lines.map(row => ({
      lineKey: row[0], sourceSku: row[1], brandRaw: row[2], title: row[3], categoryRaw: row[4],
      currency: "USD", lineAmount: Math.round(Number(row[5]) * 100),
      sourceLineNetAmount: Math.round(Number(netBySku[row[0]]) * 100), sourceCurrentPrice: null,
      sourceEstimatedRetail: row[7] ? Number(row[7]) * 100 : null,
      sourceConditionRaw: row[8], sourceStatusRaw: row[9], sizeLabelRaw: row[10],
      colorRaw: row[11], materialRaw: row[12], measurements: row[13] ? { text: row[13] } : {},
      measurementsEstimated: row[14] === "是", productUrl: row[15], descriptionRaw: row[16],
    })),
    adjustments: [
      { adjustmentKey: "SHIPPING", kind: "SHIPPING", label: "Shipping", amount: 6000, currency: "USD" },
      { adjustmentKey: "CREDIT", kind: "STORE_CREDIT", label: "Store Credit", amount: -7500, currency: "USD" },
      { adjustmentKey: "D60", kind: "DISCOUNT", label: "Discount60", amount: -11700, currency: "USD" },
      { adjustmentKey: "D20", kind: "DISCOUNT", label: "Discount20", amount: -3800, currency: "USD" },
      { adjustmentKey: "D30", kind: "DISCOUNT", label: "Discount30", amount: -17400, currency: "USD" },
      { adjustmentKey: "D40", kind: "DISCOUNT", label: "Discount40", amount: -5400, currency: "USD" },
    ],
    shipments: [
      { shipmentKey: "A", externalShipmentRef: "SYN-A", carrier: "Synthetic Carrier", statusRaw: "Shipped", lineKeys: lines.slice(0,3).map(row => row[0]) },
      { shipmentKey: "B", externalShipmentRef: "SYN-B", carrier: "Synthetic Carrier", statusRaw: "Shipped", lineKeys: lines.slice(3).map(row => row[0]) },
    ],
  });
  await page.goto("/#/procurement/" + order.id);
  return { before, sourceName, orderNo, orderId: order.id };
}
test.beforeEach(async ({ page }) => login(page));

test("采购来源默认币种可经正式后台入口更正", async ({ page }) => {
  await page.goto("/#/procurement");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(),
    sourceName = "默认币种更正合成 " + suffix;
  await page
    .getByRole("button", { name: "＋ 新增采购来源", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "新增采购来源" });
  await dialog.getByLabel("来源编码").fill("TRR-" + suffix);
  await dialog.getByLabel("来源名称").fill(sourceName);
  await dialog.getByLabel("默认币种").selectOption("CNY");
  await dialog.getByRole("button", { name: "保存来源", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  const row = page.locator(".procurement-sources tbody tr:not(.ant-table-measure-row)").filter({
    hasText: sourceName,
  });
  await expect(row).toContainText("CNY");
  await row
    .getByRole("button", { name: "调整默认币种", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "调整采购来源默认币种" });
  await expect(dialog).toContainText("不会改写既有订单、候选、TM、库存或成本");
  await dialog.getByLabel("默认币种").selectOption("USD");
  await dialog
    .getByLabel("更正依据")
    .fill("合成验证：TRR 采购来源后续候选默认使用美元。");
  await dialog
    .getByRole("button", { name: "保存默认币种", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toContainText("USD");
  await expect(row).toContainText("来源版本 v2");
});

test("TRR结构订单导入后只形成采购事实，不自动生成库存或人民币成本", async ({
  page,
}) => {
  const ctx = await createOrder(page);
  await expect(
    page.getByRole("heading", { name: new RegExp(ctx.orderNo) }),
  ).toBeVisible();
  await expect(page.locator(".procurement-line")).toHaveCount(7);
  await expect(page.getByText("SYN-A", { exact: true })).toBeVisible();
  await expect(page.getByText("SYN-B", { exact: true })).toBeVisible();
  const first = page
    .locator(".procurement-line")
    .filter({ hasText: "WDI571039" });
  await expect(first).toContainText("USD 195.00");
  await expect(first).toContainText("USD 78.00");
  await expect(first).toContainText("USD 400.00");
  await expect(first).toContainText("待核对");
  await first.getByText("查看来源资料", { exact: true }).click();
  await expect(first).toContainText("Excellent");
  await expect(first).toContainText("Sold");
  const after = (
    await (await page.request.get("/api/items?dataMode=ALL")).json()
  ).total;
  expect(after).toBe(ctx.before);
  const order = await (
    await page.request.get("/api/procurement/orders/" + ctx.orderId)
  ).json();
  expect(order.lines).toHaveLength(7);
  expect(order.shipments).toHaveLength(2);
  expect(order.lines[0].costConfirmations).toHaveLength(0);
});

test("订单行人工确认在手且纳入经营后才出现货源候选入口", async ({ page }) => {
  const ctx = await createOrder(page);
  let first = page
    .locator(".procurement-line")
    .filter({ hasText: "WDI571039" });
  await first.getByRole("button", { name: "核对实物", exact: true }).click();
  const d = page.getByRole("dialog", { name: "核对实物与经营去向" });
  await d.getByLabel("经营处理").selectOption("INCLUDE");
  await d.getByLabel("实物情况").selectOption("IN_HAND");
  await d
    .getByLabel("核对说明")
    .fill("合成测试：已人工核对实物在手并决定纳入经营");
  await d.getByRole("button", { name: "保存核对" }).click();
  await expect(d).not.toBeVisible();
  first = page.locator(".procurement-line").filter({ hasText: "WDI571039" });
  await expect(first).toContainText("纳入经营");
  await expect(first).toContainText("实物在手");
  await first
    .getByRole("button", { name: "生成货源候选", exact: true })
    .click();
  await expect(
    first.getByRole("link", { name: "建立TM商品", exact: true }),
  ).toBeVisible();
  const order = await (
    await page.request.get("/api/procurement/orders/" + ctx.orderId)
  ).json();
  expect(
    order.lines.find((x) => x.sourceSku === "WDI571039").sourceCandidate,
  ).toBeTruthy();
});
test("采购来源保留原始金额但不再要求成本确认", async ({
  page,
}) => {
  const ctx = await createOrder(page),
    first = page.locator(".procurement-line").filter({ hasText: "WDI571039" });
  await expect(
    first.getByRole("button", { name: "确认人民币成本", exact: true }),
  ).toHaveCount(0);
  await expect(first).toContainText("USD 195.00");
  await expect(first).toContainText("USD 78.00");
  await expect(page.locator(".procurement-cost-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认订单成本依据", exact: true })).toHaveCount(0);
  const order = await (
      await page.request.get("/api/procurement/orders/" + ctx.orderId)
    ).json(),
    line = order.lines.find((x) => x.sourceSku === "WDI571039");
  expect(line.lineAmount).toBe(19500);
  expect(line.sourceLineNetAmount).toBe(7800);
  expect(line.sourceCurrentPrice).toBeNull();
  expect(line.costConfirmations).toHaveLength(0);
});

test("采购订单手机端按订单事实与本地核对分层，不横向溢出", async ({
  browser,
  page,
}) => {
  const ctx = await createOrder(page);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4320",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const mobile = await context.newPage();
  try {
    await login(mobile);
    await mobile.goto("/#/procurement/" + ctx.orderId);
    const root = mobile.locator(".procurement-page");
    await expect(root).toBeVisible();
    expect(
      await root.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    ).toBe(true);
    await expect(mobile.locator(".procurement-line")).toHaveCount(7);
    await expect(
      mobile
        .locator(".procurement-line")
        .first()
        .getByRole("button", { name: "核对实物", exact: true }),
    ).toBeVisible();
    await mobile.screenshot({
      path: "reports/screenshots/procurement-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
