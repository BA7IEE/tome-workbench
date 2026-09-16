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
const lineHeader =
  "行键\t原货号\t品牌\t商品名称\t品类\t订单行金额\t平台现价\t估计零售价\t平台成色\t平台状态\t标签尺码\t颜色\t材质\t尺寸\t尺寸为估测\t商品链接\t商品描述\t图片链接";
const lineText = [lineHeader, ...lines.map((r) => r.join("\t"))].join("\n");
async function createOrder(page) {
  await page.goto("/#/procurement");
  const before = (
    await (await page.request.get("/api/items?dataMode=ALL")).json()
  ).total;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(),
    sourceName = "The RealReal 合成 " + suffix,
    orderNo = "TRR-SYN-" + suffix;
  await page
    .getByRole("button", { name: "＋ 新增采购来源", exact: true })
    .click();
  let d = page.getByRole("dialog", { name: "新增采购来源" });
  await d.getByLabel("来源编码").fill("TRR" + suffix);
  await d.getByLabel("来源名称").fill(sourceName);
  await d.getByRole("button", { name: "保存来源" }).click();
  await expect(d).not.toBeVisible();
  await page
    .getByRole("button", { name: "＋ 导入采购订单", exact: true })
    .click();
  d = page.getByRole("dialog", { name: "导入采购订单" });
  const sourceSelect = d.getByLabel("采购来源"),
    sourceValue = await sourceSelect
      .locator("option")
      .filter({ hasText: sourceName })
      .getAttribute("value");
  expect(sourceValue).toBeTruthy();
  await sourceSelect.selectOption(sourceValue);
  await d.getByLabel("订单号").fill(orderNo);
  await d.getByLabel("下单日期").fill("2026-06-27");
  await d.getByLabel("平台订单状态").fill("Shipped");
  await d.getByLabel("平台退货限制 / 标记").fill("Not returnable");
  await d.getByLabel("订单币种").selectOption("USD");
  await d.getByLabel("商品小计").fill("1100");
  await d.getByLabel("订单总额").fill("702");
  await d.getByLabel("实际支付金额").fill("702");
  await d.getByLabel("订单行 · 从Excel粘贴").fill(lineText);
  await d
    .getByLabel("折扣 / 运费 / 抵用额")
    .fill(
      "调整键\t类型\t名称\t金额\nSHIPPING\t运费\tShipping\t60\nSTORE_CREDIT\t抵用余额\tStore Credit\t-75\nD60\t折扣\t60% Off Women's\t-117\nD20\t折扣\t20% Off Women's\t-38\nD30\t折扣\t30% Off Women's\t-174\nD40\t折扣\t40% Off Women's\t-54",
    );
  await d
    .getByLabel("物流包裹（可留空）")
    .fill(
      "包裹键\t物流单号\t承运商\t状态\t订单行键\nPKG-A\tSYN-A\tSynthetic Carrier\tShipped\tWDI571039,WDI581338,GIO194599\nPKG-B\tSYN-B\tSynthetic Carrier\tShipped\tWDI580085,LAN245875,LAN244886,LAN245375",
    );
  await d.getByRole("button", { name: "生成预览", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "核对采购订单" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("7件");
  await expect(preview).toContainText("USD 1,100.00");
  await expect(preview).toContainText("USD -398.00");
  await expect(preview).toContainText("USD 702.00");
  await preview.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page).toHaveURL(/#\/procurement\/[a-f0-9-]+/);
  return {
    before,
    sourceName,
    orderNo,
    orderId: page.url().match(/procurement\/([a-f0-9-]+)/)[1],
  };
}
test.beforeEach(async ({ page }) => login(page));

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
test("v1 采购历史不再逐件手填成本，统一由订单级成本面板计算", async ({
  page,
}) => {
  const ctx = await createOrder(page),
    first = page.locator(".procurement-line").filter({ hasText: "WDI571039" });
  await expect(
    first.getByRole("button", { name: "确认人民币成本", exact: true }),
  ).toHaveCount(0);
  await expect(first).toContainText("USD 195.00");
  await expect(first).toContainText("USD 78.00");
  const panel = page.locator(".procurement-cost-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("人民币取得成本");
  await expect(panel).toContainText("暂不能自动写入成本");
  await expect(panel).toContainText("尚未完成保留/排除确认");
  await expect(
    panel.getByRole("button", { name: "确认订单成本依据", exact: true }),
  ).toBeVisible();
  const order = await (
      await page.request.get("/api/procurement/orders/" + ctx.orderId)
    ).json(),
    line = order.lines.find((x) => x.sourceSku === "WDI571039");
  expect(line.lineAmount).toBe(19500);
  expect(line.sourceCurrentPrice).toBe(7800);
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
