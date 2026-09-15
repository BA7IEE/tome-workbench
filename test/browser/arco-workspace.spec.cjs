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

for (const width of [1440, 390]) {
  test(`${width}px 商品排序与每页数量即时生效，翻页保留选择且待输入筛选不被丢弃`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const prefix = "商品排序 " + randomUUID().slice(0, 8);
    const items = [];
    for (let n = 0; n < 31; n++)
      items.push(
        await command(page, "/items", {
          title: `${prefix} ${String(n).padStart(2, "0")}`,
        }),
      );
    await page.goto("/#/items?q=" + encodeURIComponent(prefix));
    await expect(page.locator("tbody tr")).toHaveCount(30);
    await expect(page.locator("tbody tr").first()).toContainText(
      items[30].code,
    );
    if (width > 1000) {
      const alignment = await page
        .locator("#catalog-search")
        .evaluate((form) => {
          const input = form
            .querySelector("input[name=q]")
            .getBoundingClientRect();
          const buttons = Array.from(
            form.querySelectorAll(".filter-actions > button"),
          ).map((button) => button.getBoundingClientRect());
          return buttons.every(
            (rect) =>
              Math.abs(rect.bottom - input.bottom) < 2 &&
              Math.abs(rect.height - input.height) < 2,
          );
        });
      expect(alignment).toBe(true);
    }
    await page.getByLabel("选择 " + items[30].code, { exact: true }).check();
    await page.getByRole("combobox", { name: "排序", exact: true }).click();
    await page.getByRole("option", { name: "最早录入", exact: true }).click();
    await expect(page.locator("tbody tr").first()).toContainText(items[0].code);
    await expect(page.locator("#bulk-toolbar")).toContainText("已选 1 件");
    await page.getByLabel("下一页", { exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText(items[30].code);
    await page.getByRole("combobox", { name: "每页数量", exact: true }).click();
    await page.getByRole("option", { name: "60 件/页", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(31);
    await expect(page.locator(".catalog-count")).toContainText("第 1 / 1 页");
    await expect(page.locator("#bulk-toolbar")).toContainText("已选 1 件");
    await page.getByRole("combobox", { name: "排序", exact: true }).click();
    await page.getByRole("option", { name: "最新录入", exact: true }).click();
    await expect(page.locator("tbody tr").first()).toContainText(
      items[30].code,
    );
    await expect(
      page.getByRole("combobox", { name: "每页数量", exact: true }),
    ).toContainText("60 件/页");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/screenshots/catalog-controls-${width}.png`,
      fullPage: false,
    });
    await page.locator(".catalog-pagination").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `reports/screenshots/catalog-pagination-${width}.png`,
      fullPage: false,
    });

    // Changing a result control applies valid visible filters; it cannot silently erase them.
    await page.getByLabel("搜索商品", { exact: true }).fill(prefix + " 10");
    await page.getByRole("button", { name: "图片", exact: true }).click();
    await expect(page.locator(".product-card")).toHaveCount(1);
    await expect(page.locator(".product-card")).toContainText(items[10].code);
    await expect(page.getByLabel("搜索商品", { exact: true })).toHaveValue(
      prefix + " 10",
    );
    await expect(page.locator("#bulk-toolbar")).toBeHidden();
    await page.getByText("更多筛选", { exact: true }).click();
    await page.getByLabel("品牌", { exact: true }).fill("未选择的品牌");
    const before = page.url();
    await page.getByRole("combobox", { name: "排序", exact: true }).click();
    await page.getByRole("option", { name: "最早录入", exact: true }).click();
    await expect(page.locator("#toast")).toContainText("品牌");
    expect(page.url()).toBe(before);
    await expect(page.getByLabel("品牌", { exact: true })).toHaveValue(
      "未选择的品牌",
    );
  });
}
