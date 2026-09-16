const { submitLogin, fillLogin } = require("./login.cjs");
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/#/items");
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
  await expect(page.locator(".sidebar-bottom strong")).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await login(page);
});
test("新建商品首屏提供保存和下载资料，发布从更多进入", async ({ page }) => {
  await page.goto("/#/items/new");
  await expect(page.getByLabel("商品名称", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存商品", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存并下载资料", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".entry-footer")).toHaveCount(0);
  await expect(page.getByLabel("品牌", { exact: true })).toBeVisible();
  await expect(page.getByLabel("对外报价", { exact: true })).toBeVisible();
  await expect(page.getByLabel("成色", { exact: true })).toBeVisible();
  await expect(page.getByText("尺寸与材质", { exact: true })).toBeVisible();
  const visibleButtons = await page
    .locator(".studio-command-actions > button:visible")
    .count();
  expect(visibleButtons).toBe(2);
  await page.screenshot({
    path: "reports/screenshots/ux2-new-product.png",
    fullPage: true,
  });
});
test("次要保存动作放入更多菜单，不和主动作抢界面", async ({ page }) => {
  await page.goto("/#/items/new");
  await page.getByText("更多", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存并返回", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存并新增下一件", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("details.studio-more .studio-more-menu")
      .getByRole("link", { name: "返回商品列表", exact: true }),
  ).toBeVisible();
});
test("商品列表行内不再同时堆编辑加图删除发布按钮", async ({ page }) => {
  await page.goto("/#/items");
  await expect(
    page.getByRole("heading", { name: "商品", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("搜索商品")).toBeVisible();
  await expect(page.getByText("更多筛选", { exact: true })).toBeVisible();
  const first = page.locator("tbody tr").first();
  if (await first.count()) {
    await expect(
      first.getByRole("button", { name: "编辑", exact: true }),
    ).toHaveCount(0);
    await expect(
      first.getByRole("button", { name: "加图", exact: true }),
    ).toHaveCount(0);
    await expect(
      first.getByRole("button", { name: "删除", exact: true }),
    ).toHaveCount(0);
    await expect(first.locator(".catalog-row-menu")).toHaveCount(1);
  }
  await page.screenshot({
    path: "reports/screenshots/ux2-catalog.png",
    fullPage: true,
  });
});
