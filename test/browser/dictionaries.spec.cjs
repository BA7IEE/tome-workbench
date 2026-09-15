const { submitLogin } = require("./login.cjs");
const {
  chooseDictionary,
  dictionaryRoot,
} = require("./dictionary-control.cjs");
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
const { randomUUID } = require("node:crypto");
const fixture = JSON.parse(
  require("node:fs").readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/#/items");
  await page.getByLabel("登录邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await submitLogin(page);
  await expect(page.locator(".sidebar-bottom strong")).toBeVisible();
}
async function command(page, path, body) {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const r = await page.request.post("/api" + path, {
    data: body,
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(r.ok(), path + " " + (await r.text())).toBeTruthy();
  return r.json();
}
async function newForm(page) {
  await page.goto("/#/items/new");
  await expect(page.getByLabel("商品名称", { exact: true })).toBeVisible();
}
const faults = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => faults.push(e.message));
  await login(page);
});
test.afterEach(() => expect(faults.splice(0)).toEqual([]));
test("录商品直接选择品牌、国际成色、颜色与材质，保存后筛选到同一件", async ({
  page,
}) => {
  const name = "字典录货 " + randomUUID();
  await newForm(page);
  await page.getByLabel("商品名称", { exact: true }).fill(name);
  await chooseDictionary(page, "品牌", "LV", "Louis Vuitton");
  await chooseDictionary(
    page,
    "成色",
    "非常好",
    "非常好 · Very good condition",
  );
  await revealSection(page, "dimensions");

  await chooseDictionary(page, "颜色", "黑色", "黑色 · Black");
  await revealSection(page, "dimensions");

  await chooseDictionary(page, "主要材质", "羊毛", "羊毛 · Wool");
  await revealSection(page, "dimensions");

  await page.getByLabel("材质成分 / 细节", { exact: true }).fill("主体80%羊毛");
  await page.getByLabel("瑕疵与使用痕迹").fill("袖口轻微磨损");
  await productMore(page);
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "商品", exact: true }),
  ).toBeVisible();
  await page.getByText("更多筛选", { exact: true }).click();
  await chooseDictionary(page, "品牌", "Louis", "Louis Vuitton");
  await chooseDictionary(
    page,
    "成色",
    "非常好",
    "非常好 · Very good condition",
  );
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  // MVP opens an image grid; explicitly switch to the table before checking its rows.
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator("tbody")).toContainText(name);
  const rows = await (
    await page.request.get("/api/items?q=" + encodeURIComponent(name))
  ).json();
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].dictionary.brand).toBeTruthy();
  await page.screenshot({
    path: "reports/screenshots/dictionary-filters.png",
    fullPage: true,
  });
});
test("录货中新增缺少的品牌，原商品输入不丢且新选项立即可选", async ({
  page,
}) => {
  const name = "未保存商品 " + randomUUID(),
    brand = "ZBrand " + randomUUID();
  await newForm(page);
  await page.getByLabel("商品名称", { exact: true }).fill(name);
  await page.getByLabel("品牌", { exact: true }).click();
  await page.getByRole("button", { name: "新增品牌", exact: true }).click();
  await expect(page.locator("#dialog").getByLabel("标准名称")).toHaveValue("");
  await page.locator("#dialog").getByLabel("标准名称").fill(brand);
  await page
    .locator("#dialog")
    .getByLabel("别名（每行一个）")
    .fill("ZA-" + randomUUID());
  await page.getByRole("button", { name: "保存选项", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(name);
  await expect(page.getByLabel("品牌", { exact: true })).toHaveValue(brand);
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page).toHaveURL(/#\/items\/[a-f0-9-]+\/edit/);
  await expect(page.getByLabel("品牌", { exact: true })).toHaveValue(brand);
});
test("字典维护可编辑和停用，重复别名有明确提示", async ({ page }) => {
  const label = "ZEdit " + randomUUID();
  await page.goto("/#/dictionaries?kind=BRAND");
  await page.getByRole("button", { name: "新增品牌", exact: true }).click();
  await page.getByLabel("标准名称").fill(label);
  await page.getByLabel("别名（每行一个）").fill("LV");
  await page.getByRole("button", { name: "保存选项", exact: true }).click();
  await expect(page.locator("#dialog .form-error")).toContainText("已属于");
  await page.getByLabel("别名（每行一个）").fill("ZAlias-" + randomUUID());
  await page.getByRole("button", { name: "保存选项", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.getByLabel("搜索字典").fill(label);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page
    .locator("tr")
    .filter({ hasText: label })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByLabel("启用此选项").uncheck();
  await page.getByRole("button", { name: "保存选项", exact: true }).click();
  await expect(page.locator("tbody")).toContainText("停用");
  await page.screenshot({
    path: "reports/screenshots/dictionary-management.png",
    fullPage: true,
  });
});
test("大量品牌时通过服务器搜索找到首批选项之外的品牌", async ({ page }) => {
  const prefix = "ZZZ-" + randomUUID();
  for (let n = 0; n < 42; n++)
    await command(page, "/dictionaries", {
      kind: "BRAND",
      label: prefix + "-" + n,
      sortOrder: 500,
    });
  const target = await command(page, "/dictionaries", {
    kind: "BRAND",
    label: "ZZZ-目标-" + randomUUID(),
    aliases: ["远端别名-" + randomUUID()],
    sortOrder: 99999,
  });
  await newForm(page);
  await expect(
    page.locator("[data-dictionary=BRAND][data-ready=true]"),
  ).toBeVisible();
  const remoteBrand = await dictionaryRoot(page, "品牌");
  await remoteBrand.input.click();
  await expect(
    remoteBrand.root
      .locator('[role="option"]')
      .filter({ hasText: target.label }),
  ).toHaveCount(0);
  await chooseDictionary(page, "品牌", target.aliases[0], target.label);
});
test("成色只显示VC五级与说明，不要求填写九成新或程序编码", async ({ page }) => {
  await newForm(page);
  const condition = await dictionaryRoot(page, "成色");
  const labels = condition.input.locator("option");
  await expect(labels).toHaveCount(6);
  expect(await labels.allTextContents()).toEqual([
    "请选择成色",
    "未使用，有原装标签 · Never worn, with tag",
    "未使用 · Never worn",
    "非常好 · Very good condition",
    "良好 · Good condition",
    "一般 · Fair condition",
  ]);
  await chooseDictionary(page, "成色", "一般", "一般 · Fair condition");
  await expect(
    page.locator("[data-dictionary=CONDITION] .dictionary-description"),
  ).toContainText("明显瑕疵");
});
test("操作记录与失败任务默认展示中文，不把JSON放在主表格", async ({ page }) => {
  await page.goto("/#/audit?q=" + encodeURIComponent("新增字典"));
  await expect(page.locator("tbody")).toContainText("新增字典选项");
  expect(await page.locator("tbody").innerText()).not.toContain(
    "DICTIONARY_CREATED",
  );
  await expect(page.locator("tbody")).toContainText("合成ADMIN");
  await page.goto("/#/jobs");
  await expect(
    page.getByRole("heading", { name: "后台任务", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("任务状态")).toHaveValue("FAILED");
  expect(await page.locator("#content").innerText()).not.toContain(
    "BUSINESS_ERROR",
  );
});

test("只搜索未选择品牌时明确提示，不能把搜索词当作已保存的选项", async ({
  page,
}) => {
  await newForm(page);
  await page
    .getByLabel("商品名称", { exact: true })
    .fill("搜索不等于选择 " + randomUUID());
  await page
    .getByLabel("品牌", { exact: true })
    .fill("完全未知品牌-" + randomUUID());
  await expect(
    page.locator("[data-dictionary=BRAND][data-ready=true]"),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-save-feedback .form-error")).toContainText(
    "从建议中选择品牌",
  );
  await expect(page).toHaveURL(/#\/items\/new/);
  await chooseDictionary(page, "品牌", "LV", "Louis Vuitton");
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page).toHaveURL(/#\/items\/[a-f0-9-]+\/edit/);
});
test("手机录货选择国际成色并保存，新增选项入口不遮挡提交", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newForm(page);
  const name = "手机字典 " + randomUUID();
  await page.getByLabel("商品名称", { exact: true }).fill(name);
  await chooseDictionary(page, "品牌", "Dior", "Dior");
  await chooseDictionary(page, "成色", "良好", "良好 · Good condition");
  await revealSection(page, "dimensions");

  await chooseDictionary(page, "颜色", "蓝色", "蓝色 · Blue");
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page).toHaveURL(/#\/items\/[a-f0-9-]+\/edit/);
  await expect(
    page.getByLabel("成色", { exact: true }).locator("option:checked"),
  ).toHaveText("良好 · Good condition");
  await expect(page.getByLabel("成色", { exact: true })).not.toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "reports/screenshots/dictionary-entry-mobile.png",
    fullPage: true,
  });
});

test("测试商品从建档即分区，保存返回测试列表，不混入正式商品", async ({
  page,
}) => {
  await newForm(page);
  const name = "完整测试模式 " + randomUUID();
  await page.getByLabel("商品名称", { exact: true }).fill(name);
  await revealSection(page, "supply");
  await page.getByLabel("记录类型", { exact: true }).selectOption("TEST");
  await expect(page.locator("[data-dictionary][data-ready=true]")).toHaveCount(
    4,
  );
  await productMore(page);
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page).toHaveURL(/dataMode=TEST/);
  await expect(page.locator("tbody")).toContainText(name);
  expect(
    (
      await (
        await page.request.get("/api/items?q=" + encodeURIComponent(name))
      ).json()
    ).total,
  ).toBe(0);
});
test("有模拟成交也能从删除窗口清理，保留历史金额并显示测试成交", async ({
  page,
}) => {
  const i = await command(page, "/items", {
    title: "有模拟成交 " + randomUUID(),
  });
  const sale = await command(page, `/items/${i.id}/sold`, {
    channel: "浏览器模拟渠道",
  });
  await page.goto("/#/items/" + i.id);
  await page.locator(".overview-more summary").click();
  await page.getByRole("button", { name: "删除商品", exact: true }).click();
  await page
    .getByRole("button", { name: "有模拟成交？清理测试数据", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认清理测试数据", exact: true })
    .click();
  await expect(page.locator("#dialog")).toBeVisible();
  await page.getByLabel("输入商品编号确认", { exact: true }).fill(i.code);
  await page
    .getByLabel("我确认关联成交、费用和退款仅为测试，没有真实交易和资金往来")
    .check();
  await page
    .getByLabel("我确认没有仍在对外销售的真实商品，关联发布记录仅为测试")
    .check();
  await page
    .getByRole("button", { name: "确认清理测试数据", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#content")).toContainText("回收站");
  const business = await (
      await page.request.get("/api/sales?q=" + i.code)
    ).json(),
    testRows = await (
      await page.request.get("/api/sales?dataMode=TEST&q=" + i.code)
    ).json();
  expect(business).toHaveLength(0);
  expect(testRows.map((s) => s.id)).toContain(sale.id);
  await page.goto("/#/sales?dataMode=TEST&q=" + i.code);
  await expect(page.locator("#content")).toContainText(i.code);
  await expect(page.locator("#content")).toContainText("不计入正式合作对账");
  await page.screenshot({
    path: "reports/screenshots/test-sales-separated.png",
    fullPage: true,
  });
});
test("批量改品牌只影响勾选商品与指定字段，版本冲突单独显示", async ({
  page,
}) => {
  const tag = "批量属性-" + randomUUID();
  const a = await command(page, "/items", {
      title: tag + "-A",
      facts: { condition: "保留袖口瑕疵" },
    }),
    b = await command(page, "/items", { title: tag + "-B" }),
    c = await command(page, "/items", { title: tag + "-C" });
  await page.goto("/#/items?q=" + encodeURIComponent(tag));
  await expect(page.locator("[data-pick]")).toHaveCount(3);
  await page.getByLabel("选择 " + a.code, { exact: true }).check();
  await page.getByLabel("选择 " + b.code, { exact: true }).check();
  await page.locator(".bulk-more > summary").click();
  await page.getByRole("button", { name: "批量修改属性", exact: true }).click();
  await page.locator("#dialog").getByLabel("修改品牌", { exact: true }).check();
  await chooseDictionary(page.locator("#dialog"), "品牌", "Dior", "Dior");
  await page.getByLabel("我已逐件核对，所选属性适用于本次全部商品").check();
  // Another authorized action changes B after the selection, so it must not be overwritten.
  await command(page, `/items/${b.id}/move`, {
    version: 1,
    to: "合成新库位",
    evidence: "模拟其他操作者登记交接",
  });
  await page
    .getByRole("button", { name: "核对后进入批量执行", exact: true })
    .click();
  await page.getByRole("button", { name: "开始执行", exact: true }).click();
  await expect(page.locator("#batch-summary")).toContainText("完成1 / 2");
  await expect(page.locator(".batch-results")).toContainText(
    "资料已被其他人修改",
  );
  const A = await (await page.request.get("/api/items/" + a.id)).json(),
    B = await (await page.request.get("/api/items/" + b.id)).json(),
    C = await (await page.request.get("/api/items/" + c.id)).json();
  expect(A.brand).toBe("Dior");
  expect(A.facts.condition).toBe("保留袖口瑕疵");
  expect(B.brand).toBe("");
  expect(C.brand).toBe("");
  expect(B.location).toBe("合成新库位");
});
