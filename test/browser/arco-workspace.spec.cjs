const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const {
  chooseDictionary,
  clearDictionary,
} = require("./dictionary-control.cjs");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("link", { name: "设置", exact: true }),
  ).toBeVisible();
}
async function command(page, path, body, method = "POST") {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const r = await page.request.fetch("/api" + path, {
    method,
    data: body,
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test.beforeEach(async ({ page }) => login(page));

test("选择商品和操作菜单不擦除尚未提交的筛选输入，键盘可继续筛选", async ({
  page,
}) => {
  const prefix = "Arco筛选 " + randomUUID().slice(0, 8);
  const a = await command(page, "/items", {
    title: prefix + " A",
    category: "BAG",
    facts: { sizeLabel: "XL" },
  });
  await command(page, "/items", {
    title: prefix + " B",
    category: "BAG",
    facts: { sizeLabel: "XL" },
  });
  await page.goto("/#/items?q=" + encodeURIComponent(prefix));
  await page.getByText("更多筛选", { exact: true }).click();
  await page.getByLabel("搜索商品", { exact: true }).fill(prefix + " A");
  await page.getByLabel("尺码", { exact: true }).fill("xl");
  await page.getByLabel("筛选品类", { exact: true }).selectOption("BAG");
  const brand = await chooseDictionary(page, "品牌", "Dior", "Dior");
  const brandId = await brand.inputValue();
  await page.getByLabel("选择 " + a.code, { exact: true }).check();
  await expect(page.getByLabel("品牌", { exact: true })).toHaveValue("Dior");
  await expect(brand).toHaveValue(brandId);
  const more = page.locator(".bulk-more > summary");
  await more.click();
  await expect(
    page.getByRole("button", { name: "批量定价", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await expect(
    page.getByRole("button", { name: "批量定价", exact: true }),
  ).not.toBeVisible();
  await expect(page.getByLabel("搜索商品", { exact: true })).toHaveValue(
    prefix + " A",
  );
  await expect(page.getByLabel("尺码", { exact: true })).toHaveValue("xl");
  await expect(page.getByLabel("筛选品类", { exact: true })).toHaveValue("BAG");
  await clearDictionary(page, "品牌");
  await page.getByLabel("搜索商品", { exact: true }).press("Enter");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText(a.code);
  await expect(page.locator("#bulk-toolbar")).toBeHidden();
});

test("完整编辑遇到并发改价后保留中文草稿，合并仍需主动保存", async ({
  page,
}) => {
  const title = "Arco合并 " + randomUUID().slice(0, 8);
  const item = await command(page, "/items", {
    title,
    currentPrice: 50000,
    facts: { descriptionZh: "旧介绍" },
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`/#/items/${item.id}/edit`);
  await page.getByLabel("中文介绍", { exact: true }).fill("这次补充的介绍");
  await command(
    page,
    `/items/${item.id}`,
    { version: 1, currentPrice: 60000 },
    "PATCH",
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-conflicts")).toBeVisible();
  await page.getByLabel("我已核对差异，保留下面输入的改动").check();
  await page
    .getByRole("button", { name: "合并后继续编辑", exact: true })
    .click();
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "这次补充的介绍",
  );
  await expect(page.getByLabel("对外报价", { exact: true })).toHaveValue("600");
  const before = await (await page.request.get(`/api/items/${item.id}`)).json();
  expect(before.facts.descriptionZh).toBe("旧介绍");
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  await page.getByRole("link", { name: "商品库", exact: true }).click();
  await page.goto(`/#/items/${item.id}/edit`);
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "这次补充的介绍",
  );
  expect(pageErrors).toEqual([]);
});
