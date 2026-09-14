const { chooseDictionary } = require("./dictionary-control.cjs");
const { revealSection } = require("./reveal-section.cjs");
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.locator(".sidebar-bottom strong")).toContainText(
    "合成ADMIN",
  );
}
async function productMore(page) {
  const summary = page.locator("details.studio-more > summary");
  if (await summary.count()) {
    await summary.click();
    await page
      .locator("details.studio-more[open]")
      .waitFor({ state: "attached" });
  }
}
async function create(page, name) {
  await page.goto("/#/items/new");
  await page.getByLabel("商品名称", { exact: true }).fill(name);
  await chooseDictionary(page, "品牌", "DEMO", "DEMO");
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page).toHaveURL(/#\/items\/[a-f0-9-]+\/edit/);
  // The new identity is adopted before save follow-up reads finish. A URL
  // change alone does not mean the leave guard has released the editor.
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  await expect(
    page.getByRole("button", { name: "保存商品", exact: true }),
  ).toBeEnabled();
  await productMore(page);
  await page.getByRole("link", { name: "查看详细记录", exact: true }).click();
  await expect(page.locator("#content")).toContainText(name);
  await expect(page.locator("#content")).toContainText(/TM\d{6,}/);
  await expect(
    page.getByRole("button", { name: "编辑商品", exact: true }),
  ).toBeVisible();
}
const faults = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => faults.push(e.message));
  await login(page);
});
test.afterEach(() => {
  expect(faults.splice(0)).toEqual([]);
});
test("真实登录、商品列表与全部运营入口可读取", async ({ page }) => {
  for (const hash of [
    "dashboard",
    "items",
    "sources",
    "tasks",
    "listings",
    "inquiries",
    "sales",
    "settings",
    "audit",
    "jobs",
  ]) {
    await page.goto("/#/" + hash);
    await expect(page.locator("#content")).not.toContainText("没有完成读取");
    await expect(
      page.locator("#content .panel, #content .page-title").first(),
    ).toBeVisible();
  }
  await page.goto("/#/dashboard");
  await expect(
    page.getByRole("heading", { name: "工作总览", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "reports/screenshots/dashboard.png",
    fullPage: true,
  });
});
test("资料不完整仍可建档、维护并按缺项安排工作", async ({ page }) => {
  const name = "浏览器自有服装 " + randomUUID().slice(0, 8);
  await create(page, name);
  await page.getByRole("button", { name: "编辑商品", exact: true }).click();
  await revealSection(page, "dimensions");

  await page.getByLabel("材质成分 / 细节", { exact: true }).fill("羊毛");
  await revealSection(page, "dimensions");

  await chooseDictionary(page, "颜色", "黑色", "黑色 · Black");
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      /\/api\/items\/[a-f0-9-]+$/.test(r.url()),
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await saved;
  await expect(page.locator(".entry-save-state")).toContainText("已保存");
  await productMore(page);
  await page.getByRole("link", { name: "查看详细记录", exact: true }).click();
  await expect(page.locator("#content")).toContainText("羊毛");
  await page.getByRole("button", { name: "用途检查", exact: true }).click();
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#dialog")).toContainText("用途检查结果");
  await expect(page.locator("#dialog")).toContainText("只为缺失的结果");
  await page.locator("#dialog .close").click();
  await page.screenshot({
    path: "reports/screenshots/item.png",
    fullPage: true,
  });
});
test("卖出先停推广，金额未知不会被填成零", async ({ page }) => {
  const name = "浏览器售出 " + randomUUID().slice(0, 8);
  await create(page, name);
  await page.getByRole("button", { name: "我方已售出", exact: true }).click();
  await page
    .getByLabel("客户内部标记（建议不用手机号）")
    .fill("浏览器合成客户");
  await page.getByRole("button", { name: "确认已售出", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#content")).toContainText("我方已售");
  await page.goto("/#/sales");
  const row = page.locator("tr").filter({ hasText: name });
  await expect(row).toContainText("待补");
  await expect(row).toContainText("合作");
  await row.getByRole("button", { name: "补收支" }).click();
  await page.getByLabel("成交总额", { exact: true }).fill("2000");
  await page.getByLabel("本次取得成本").fill("1000");
  await page.getByLabel("本次直接费用合计").fill("100");
  await page.getByLabel("已核对实际到账").check();
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(row).toContainText("900.00");
});
test("货源批次先预览再写入，不直接变成自有库存", async ({ page }) => {
  const key = "BROWSER:" + randomUUID();
  await page.goto("/#/sources");
  await page.getByRole("button", { name: "导入表格" }).click();
  await page
    .getByLabel("粘贴表格内容")
    .fill("sourceKey,title,brand\n" + key + ",浏览器来源记录,DEMO");
  await page.locator("#dialog button[type=submit]").click();
  await expect(page.locator("#dialog")).toContainText("核对后导入货源");
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#content")).toContainText(key);
});
test("上传图片保存原件，待复核授权不冒充已核验", async ({ page }) => {
  await create(page, "浏览器素材 " + randomUUID().slice(0, 8));
  await page.getByRole("link", { name: "素材", exact: true }).click();
  await page.getByRole("button", { name: "＋ 上传图片" }).click();
  const sharp = require("sharp");
  const buffer = await sharp({
    create: { width: 100, height: 120, channels: 3, background: "#ddd" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("选择图片").setInputFiles({
    name: "browser-synthetic.png",
    mimeType: "image/png",
    buffer,
  });
  await page.getByLabel("来源与授权说明").fill("仅供自动化验收的合成图片");
  await page.getByRole("button", { name: "开始上传", exact: true }).click();
  await expect(page.locator("#upload-summary")).toContainText("已保存 1 / 1");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#content")).toContainText("browser-synthetic.png");
  await expect(page.locator("#content")).toContainText("待核验");
});
test("手机尺寸商品列表无整页横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/items");
  await expect(page.locator("#content")).toContainText("商品");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "reports/screenshots/mobile.png",
    fullPage: true,
  });
});
test("未登录展厅可看有效公开展示，不泄漏内部经营字段", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/showroom");
  await expect(page.locator("#app")).toContainText("ToMeBoutique");
  await expect(page.locator("#app")).not.toContainText("登录工作台");
  await expect(page.locator("#app")).not.toContainText("取得成本");
  await ctx.close();
});
test("退出后无法返回受保护内容", async ({ page }) => {
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
  const r = await page.request.get("/api/items");
  expect(r.status()).toBe(401);
});

async function browserCommand(page, path, method, body) {
  const me = await (await page.request.get("/api/auth/me")).json();
  const r = await page.request.fetch("/api" + path, {
    method,
    data: body,
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": me.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(r.ok(), method + " " + path + " HTTP " + r.status()).toBeTruthy();
  return r.json();
}
async function preparedFixture(page, name, currency = "CNY") {
  const i = await browserCommand(page, "/items", "POST", {
    title: name,
    brand: "SYNTHETIC",
    currency,
    currentPrice: 200000,
    facts: {
      condition: "合成品相说明",
      measurements: "合成尺寸40cm",
      measurementSource: "测试量测记录",
      descriptionZh: "仅用于浏览器验收的合成商品",
      descriptionEn: "Synthetic browser fixture only",
      authentication: { status: "PASSED", evidence: "合成复核，不是真实鉴定" },
    },
  });
  const auth = await (await page.request.get("/api/auth/me")).json();
  const upload = await page.request.post("/api/assets/upload", {
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
    multipart: {
      itemId: i.id,
      role: "PRODUCT",
      origin: "OWN",
      sourceNote: "合成样本图",
      file: {
        name: "synthetic.png",
        mimeType: "image/png",
        buffer: await require("sharp")({
          create: { width: 24, height: 24, channels: 3, background: "#ddd" },
        })
          .png()
          .toBuffer(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const asset = await upload.json();
  await browserCommand(page, `/assets/${asset.id}/review`, "POST", {
    rights: "PUBLIC",
    verified: true,
    sourceNote: "仅合成测试授权",
    validUntil: null,
    position: 0,
  });
  await browserCommand(page, `/items/${i.id}/approve`, "POST", { version: 1 });
  return i;
}
test("新增作业入口与运行健康页面读取真实数据", async ({ page }) => {
  for (const route of ["intake", "collections", "settlements", "operations"]) {
    await page.goto("/#/" + route);
    await expect(page.locator("#content .panel").first()).toBeVisible();
    await expect(page.locator("#content")).not.toContainText("没有完成读取");
  }
  await expect(page.locator("#content")).toContainText(
    "单机部署不等于基础设施高可用",
  );
  const operationsText = await page.locator("#content").innerText();
  expect(operationsText).not.toMatch(
    /\b(?:FAILED|PENDING|WORKING|DONE|NO_HEALTHY_WORKER|FAILED_JOBS)\b/,
  );
  expect(operationsText).toContain("后台处理服务");
  await page.screenshot({
    path: "reports/screenshots/operations.png",
    fullPage: true,
  });
});
test("操作人员可关联旧编号并显式记录和撤回尺寸不适用", async ({ page }) => {
  const title = "编号与适用性 " + randomUUID().slice(0, 8);
  await create(page, title);
  await page.getByRole("button", { name: "关联旧编号", exact: true }).click();
  const alias = "OLD_" + randomUUID().slice(0, 8).toUpperCase();
  await page.getByLabel("旧编号", { exact: true }).fill(alias);
  await page.getByLabel("来源，例如原闲鱼货号").fill("合成旧商品编号");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#content")).toContainText(alias);
  await page
    .getByRole("button", { name: "声明尺寸不适用", exact: true })
    .click();
  await page
    .getByLabel("为什么该件商品不适用尺寸要求？")
    .fill("仅用于验证不适用决策记录的合成理由");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "记录声明", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "撤回不适用", exact: true }).click();
  await expect(page.locator("#content")).toContainText("已撤回");
});
test("批量上传可先暂存，人工确认归属后才加入商品素材", async ({ page }) => {
  await create(page, "批次归档商品 " + randomUUID().slice(0, 8));
  const code = (await page.locator("#content").innerText()).match(
    /TM\d{6,}/,
  )[0];
  await page.goto("/#/intake");
  await page.getByRole("button", { name: "创建批次", exact: true }).click();
  const title = "批量测试 " + randomUUID().slice(0, 8);
  await page.getByLabel("批次名称").fill(title);
  await page
    .locator("#dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "批量上传图片", exact: true }).click();
  const image = await require("sharp")({
    create: { width: 24, height: 24, channels: 3, background: "#ddd" },
  })
    .png()
    .toBuffer();
  await page.locator("#dialog input[type=file]").setInputFiles([
    { name: code + "_front.png", mimeType: "image/png", buffer: image },
    { name: "unknown_fixture.png", mimeType: "image/png", buffer: image },
  ]);
  await page
    .locator("#dialog")
    .getByRole("button", { name: "上传到待归属池", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  const row = page.locator("tr").filter({ hasText: code + "_front.png" });
  await row.getByRole("button", { name: "确认归属", exact: true }).click();
  await expect(page.getByLabel("商品TM号")).toHaveValue(code);
  await page
    .getByLabel("本次归档依据及来源")
    .fill("合成测试原件，人工确认对应商品编号");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "确认归档", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(
    page.locator("tr").filter({ hasText: code + "_front.png" }),
  ).toContainText("已归档");
  const unknown = page.locator("tr").filter({ hasText: "unknown_fixture.png" });
  await unknown.getByRole("button", { name: "暂不采用", exact: true }).click();
  await page
    .getByLabel("原因", { exact: true })
    .fill("合成无归属图片，保留历史暂不使用");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "关闭批次", exact: true }).click();
  await page
    .locator("#dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("[data-batch-state]")).toHaveAttribute(
    "data-batch-state",
    "CLOSED",
  );
  await page.screenshot({
    path: "reports/screenshots/intake.png",
    fullPage: true,
  });
});
test("客户合集直接使用TM编号创建，售出一件只停止该件取用", async ({ page }) => {
  const a = await preparedFixture(page, "合集一 " + randomUUID().slice(0, 8)),
    b = await preparedFixture(page, "合集二 " + randomUUID().slice(0, 8));
  await page.goto("/#/collections");
  await page.getByRole("button", { name: "创建合集", exact: true }).click();
  const title = "客户合成选品 " + randomUUID().slice(0, 8);
  await page.getByLabel("合集名称").fill(title);
  await page
    .getByLabel("商品编号（每行一个，如 TM000001）")
    .fill(a.code + "\n" + b.code);
  await page.locator("#dialog input[name=confirmed]").check();
  await page
    .locator("#dialog")
    .getByRole("button", { name: "生成选品合集", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.locator("tr").filter({ hasText: "可使用" })).toHaveCount(2);
  await browserCommand(page, `/items/${a.id}/sold`, "POST", {
    channel: "合成浏览器交易",
  });
  await page.reload();
  await expect(page.locator("tr").filter({ hasText: "停止取用" })).toHaveCount(
    1,
  );
  await expect(page.locator("tr").filter({ hasText: "可使用" })).toHaveCount(1);
});
test("明确启用合成规则后可核对并确认单币种快照，不执行打款", async ({
  page,
  browserName,
}) => {
  // Each browser has an independent one-sale journal fixture; never change the expected arithmetic.
  const statementCurrency = browserName === "webkit" ? "GBP" : "SGD";
  const i = await preparedFixture(
      page,
      "快照浏览器交易 " + randomUUID().slice(0, 8),
      statementCurrency,
    ),
    s = await browserCommand(page, `/items/${i.id}/sold`, "POST", {
      channel: "浏览器合成渠道",
    });
  await browserCommand(page, `/sales/${s.id}/finance`, "POST", {
    version: 1,
    amount: 200000,
    cost: 100000,
    fees: 10000,
    currency: statementCurrency,
    paid: true,
    note: "合成收支，不是真实收入",
  });
  await page.goto("/#/settlements");
  await page.getByRole("button", { name: "新建规则草稿", exact: true }).click();
  const name = "合成规则 " + randomUUID().slice(0, 8),
    ref = "SYNTHETIC-ONLY-" + randomUUID().slice(0, 8);
  await page.getByLabel("规则名称", { exact: true }).fill(name);
  await page.getByLabel("合作方比例（%）").fill("30");
  await page.getByLabel("明确的协议/规则版本引用").fill(ref);
  await page.getByLabel("协议生效时间").fill("2020-01-01T00:00");
  await page.getByLabel("协议截止时间").fill("2030-01-01T00:00");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page
    .locator("tr")
    .filter({ hasText: name })
    .getByRole("button", { name: "确认启用", exact: true })
    .click();
  await page.locator("#dialog input[name=agreementRef]").fill(ref);
  await page.locator("#dialog input[name=confirmed]").check();
  await page
    .locator("#dialog")
    .getByRole("button", { name: "启用已核对规则", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "生成核对快照", exact: true }).click();
  await page.getByLabel("规则", { exact: true }).selectOption({ label: name });
  await page
    .getByLabel("币种", { exact: true })
    .selectOption(statementCurrency);
  await page.getByLabel("期间开始（含）").fill("2026-01-01T00:00");
  await page.getByLabel("期间结束（不含）").fill("2027-01-01T00:00");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "生成预览", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#content")).toContainText(
    `${statementCurrency} 900.00`,
  );
  await expect(page.locator("#content")).toContainText(
    `${statementCurrency} 270.00`,
  );
  await page.getByRole("button", { name: "确认此快照", exact: true }).click();
  await page.locator("#dialog input[name=confirmed]").check();
  await page
    .locator("#dialog")
    .getByRole("button", { name: "确认并保留不可变快照", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#content")).toContainText("已确认");
  await page.screenshot({
    path: "reports/screenshots/settlement.png",
    fullPage: true,
  });
});

test("商品列表可删除、取消删除并在回收站恢复原编号", async ({ page }) => {
  const title = "合成回收站 " + randomUUID().slice(0, 8);
  const i = await browserCommand(page, "/items", "POST", {
    title,
    brand: "SYNTHETIC",
  });
  await page.goto("/#/items?q=" + encodeURIComponent(title));
  const row = page.locator("tr").filter({ hasText: title });
  await row.locator(".catalog-row-menu > summary").click();
  await row.getByRole("button", { name: "删除商品", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(row).toBeVisible();
  if ((await row.locator(".catalog-row-menu").getAttribute("open")) === null)
    await row.locator(".catalog-row-menu > summary").click();
  await row.getByRole("button", { name: "删除商品", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await page.locator(".page-actions-menu > summary").click();
  await page.getByRole("link", { name: "回收站", exact: true }).click();
  const deleted = page.locator("tr").filter({ hasText: i.code });
  await expect(deleted).toContainText("测试商品");
  await page.screenshot({
    path: "reports/screenshots/recycle-bin.png",
    fullPage: true,
  });
  await deleted.getByRole("button", { name: "恢复商品" }).click();
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(deleted).toHaveCount(0);
  await page.goto("/#/items?q=" + encodeURIComponent(title));
  await expect(row).toContainText(i.code);
  await expect(row).toContainText("已暂停");
});
test("批量清理仅影响本测试创建并勾选的两件样本", async ({ page }) => {
  const prefix = "SYNTHETIC-TRASH-" + randomUUID();
  const samples = [];
  for (let n = 0; n < 3; n++) {
    samples.push(
      await browserCommand(page, "/items", "POST", { title: prefix + " " + n }),
    );
  }
  await page.goto("/#/items?q=" + encodeURIComponent(prefix));
  for (const sample of samples.slice(0, 2)) {
    await page.locator(`[data-pick="${sample.id}"]`).click();
  }
  await page.getByRole("button", { name: "批量删除", exact: true }).click();
  await page.getByRole("button", { name: "核对所选商品", exact: true }).click();
  await page.getByRole("button", { name: "开始执行", exact: true }).click();
  await expect(page.locator("#batch-summary")).toContainText("完成2 / 2");
  await page
    .locator("#dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.locator("[data-pick]")).toHaveCount(1);
  await expect(page.locator(`[data-pick="${samples[2].id}"]`)).toBeVisible();
});
test("手机商品详情提供删除，旧编辑页提示先恢复", async ({ page }) => {
  const sample = await browserCommand(page, "/items", "POST", {
    title: "SYNTHETIC-MOBILE-TRASH-" + randomUUID(),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/items/${sample.id}`);
  await page.getByRole("button", { name: "删除商品", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.locator("#content")).toContainText("已移入回收站");
  await page.goto(`/#/items/${sample.id}/edit`);
  await expect(page.locator("#content")).toContainText("请先恢复商品");
  await expect(
    page.getByRole("button", { name: "保存商品", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "恢复商品", exact: true }).click();
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存商品", exact: true }),
  ).toBeVisible();
});
