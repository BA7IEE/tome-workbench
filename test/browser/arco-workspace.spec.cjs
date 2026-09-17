const { submitLogin, fillLogin } = require("./login.cjs");
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
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
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

for (const width of [1440, 390]) {
  test(`${width}px 全系统页面沿用同一主题且采购样式和原生控件不再受旧规则影响`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const key = randomUUID().slice(0, 8);
    const item = await command(page, "/items", {
      title: "系统样式 " + key,
      facts: {
        attributes: {
          sourceBrand: "Synthetic brand",
          sourceCondition: "Very Good",
          sourcePlatform: "Synthetic source",
        },
      },
    });
    const source = await command(page, "/procurement/sources", {
      code: "UI" + key,
      name: "合成样式来源 " + key,
      defaultCurrency: "USD",
    });
    const order = await command(page, "/procurement/orders/import", {
      procurementSourceId: source.id,
      externalOrderNo: "UI-" + key,
      orderedAt: "2024-06-15T12:00:00Z",
      currency: "USD",
      paymentAmount: 10000,
      totalAmount: 10000,
      rawPayload: { synthetic: true },
      lines: [
        {
          lineKey: "UI-LINE",
          title: "合成商品 " + key,
          currency: "USD",
          lineAmount: 10000,
        },
      ],
    });
    const routes = [
      "items?view=grid",
      "items?view=table",
      "items/new",
      `items/${item.id}/edit`,
      `items/${item.id}?tab=facts`,
      `items/${item.id}?tab=media`,
      "imports",
      "candidates",
      "settings",
      "dictionaries",
      "sources",
      "procurement",
      `procurement/${order.id}`,
      "tasks",
      "sales",
      "inquiries",
      "listings",
      "collections",
      "intake",
      "settlements",
      "operations",
      "audit",
      "jobs",
      "dashboard",
      "trash",
    ];
    for (const route of routes) {
      const previousContent = await page.locator("#content").elementHandle();
      await page.goto("/#/" + route);
      // Wait for this hash route to mount before inspecting its UI, including
      // routes that share a heading or show the same type of search form.
      await page.waitForFunction(
        (previous) => !previous.isConnected,
        previousContent,
      );
      await previousContent.dispose();
      const content = page.locator("#content");
      await expect(content).not.toContainText("正在读取数据");
      await expect(content).not.toContainText("没有完成读取");
      await expect(content.locator("h1,h2").first()).toBeVisible();
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        background: getComputedStyle(document.body).backgroundColor,
        primary: getComputedStyle(document.body)
          .getPropertyValue("--ui-primary")
          .trim(),
        border: getComputedStyle(document.body)
          .getPropertyValue("--ui-border")
          .trim(),
      }));
      expect(layout.overflow, route).toBeLessThanOrEqual(2);
      expect(layout.background, route).toBe("rgb(242, 243, 245)");
      expect(layout.primary, route).toMatch(/rgb\(\s*22,\s*93,\s*255\s*\)/);
      expect(layout.border, route).toBeTruthy();
      if (route === "imports") {
        const positions = await content
          .locator(".admin-filter-form")
          .evaluate((form) => {
            const input = form.querySelector("input").getBoundingClientRect(),
              button = form.querySelector("button").getBoundingClientRect();
            return {
              inputHeight: input.height,
              buttonHeight: button.height,
              bottomDifference: Math.abs(input.bottom - button.bottom),
            };
          });
        expect(positions.inputHeight).toBe(width < 760 ? 40 : 36);
        expect(positions.buttonHeight).toBe(positions.inputHeight);
        if (width > 760) expect(positions.bottomDifference).toBeLessThan(2);
      }
      if (route === "sources") {
        const geometry = await content.evaluate((el) => {
          const rect = (s) => el.querySelector(s).getBoundingClientRect(),
            input = rect("#source-search"),
            select = rect("#source-search-form select"),
            button = rect("#source-search-form button"),
            title = rect(".page-title > div:first-child"),
            actions = rect(".page-title > .button-row");
          return {
            heights: [input.height, select.height, button.height],
            actionsBelowTitle: actions.top >= title.bottom,
            actionsWidth: actions.width,
          };
        });
        expect(geometry.heights).toEqual(Array(3).fill(width < 720 ? 40 : 36));
        if (width < 720) {
          expect(geometry.actionsBelowTitle).toBe(true);
          expect(geometry.actionsWidth).toBeGreaterThan(350);
        }
        await page
          .getByRole("button", { name: "手工录货", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "快速录货", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel("商品名称", { exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await expect(page).toHaveURL(/#\/sources$/);
      }
      if (route === "settings") {
        // Channel.defaultCurrency is now an operating fact shown with the
        // account, so the former six-column layout expectation is obsolete.
        await expect(content.locator(".record-table").first()).toContainText(
          "默认币种",
        );
        const columns = await content
          .locator(".record-table")
          .first()
          .locator("tbody tr")
          .first()
          .locator("td")
          .evaluateAll((cells) =>
            cells.map((cell) => cell.getBoundingClientRect().width),
          );
        expect(columns.length).toBe(7);
        expect(columns.every((value) => value >= 80)).toBe(true);
      }
      if (route === `procurement/${order.id}`) {
        await expect(page.locator(".procurement-line")).toHaveCount(1);
        await expect(page.locator(".procurement-line")).toHaveCSS(
          "border-top-width",
          "1px",
        );
        await expect(page.locator(".procurement-line")).toHaveCSS(
          "background-color",
          "rgb(255, 255, 255)",
        );
        await expect(page.locator(".procurement-page")).toHaveCSS(
          "row-gap",
          "20px",
        );
      }
      if (
        [
          "imports",
          "settings",
          "sources",
          `items/${item.id}/edit`,
          `procurement/${order.id}`,
        ].includes(route)
      ) {
        await page.screenshot({
          path: `reports/screenshots/system-ui-${width}-${route.split("/")[0]}.png`,
        });
      }
    }
    await page.goto("/#/items?q=" + encodeURIComponent("系统样式 " + key));
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "列表", exact: true }),
    ).toHaveCSS("background-color", "rgb(232, 243, 255)");
    await page.getByRole("button", { name: "图片", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "图片", exact: true }),
    ).toHaveCSS("background-color", "rgb(232, 243, 255)");
    await expect(
      page.getByRole("button", { name: "列表", exact: true }),
    ).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.getByRole("button", { name: "更多筛选", exact: true }).click();
    await page.getByLabel("品牌", { exact: true }).fill("没有选中的合成品牌");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator("#toast")).toContainText("品牌");
    await expect(page.getByLabel("品牌", { exact: true })).toHaveValue(
      "没有选中的合成品牌",
    );
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByLabel("登录邮箱")).toBeVisible();
    await page.getByLabel("登录邮箱").click();
    await expect(page.getByLabel("登录邮箱")).toHaveCSS(
      "border-top-color",
      "rgb(22, 93, 255)",
    );
    await expect(page.getByRole("button", { name: "进入工作台" })).toHaveCSS(
      "background-color",
      "rgb(22, 93, 255)",
    );
    await page.screenshot({
      path: `reports/screenshots/system-ui-${width}-login.png`,
    });
    await page.goto("/showroom");
    await expect(page.locator(".showroom")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });
}
