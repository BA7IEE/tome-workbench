const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const sharp = require("sharp");
const { submitLogin, fillLogin } = require("./login.cjs");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function api(page, path, data) {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const response = await page.request.post("/api" + path, {
    data,
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
  await expect(page.locator(".sidebar-bottom strong")).toBeVisible();
});
for (const width of [1440, 390]) {
  test(`商品操作减法 ${width}px：菜单、取消、焦点与失败保留`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const title = "操作减法合成 " + randomUUID().slice(0, 8);
    const item = await api(page, "/items", { title, dataMode: "TEST" });
    const buffer = await sharp({
      create: { width: 100, height: 120, channels: 3, background: "#bbb" },
    })
      .png()
      .toBuffer();
    const auth = await (await page.request.get("/api/auth/me")).json();
    const upload = await page.request.post("/api/assets/upload", {
      headers: {
        Origin: new URL(page.url()).origin,
        "X-CSRF-Token": auth.csrf,
        "Idempotency-Key": randomUUID(),
      },
      multipart: {
        itemId: item.id,
        role: "PRODUCT",
        origin: "OWN",
        sourceNote: "synthetic simplification fixture",
        file: { name: "original.png", mimeType: "image/png", buffer },
      },
    });
    expect(upload.ok()).toBe(true);
    const back = `#/items?dataMode=TEST&q=${encodeURIComponent(title)}&view=table&size=30`;
    await page.goto(`/#/items/${item.id}`);
    await expect(
      page.getByRole("link", { name: "准备发布", exact: true }),
    ).toBeVisible();
    await page.goto("/" + back);
    await expect(page.locator("#bulk-toolbar")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "资料包与变化", exact: true }),
    ).toBeHidden();
    await page.locator(`[data-pick="${item.id}"]`).check();
    await expect(page.locator(".bulk-primary > button:visible")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "逐件编辑", exact: true }),
    ).toBeHidden();
    await page.locator(".bulk-more > summary").click();
    await expect(
      page.getByRole("button", { name: "逐件编辑", exact: true }),
    ).toBeVisible();
    await page.locator(".bulk-more > summary").click();
    await page.getByRole("link", { name: `编辑商品 ${item.code}` }).click();
    await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(
      title,
    );
    await expect(page.locator(".studio-operating-options")).not.toHaveAttribute(
      "open",
    );
    await expect(
      page.locator(".studio-command-actions > button:visible"),
    ).toHaveCount(1);
    await expect(page.locator("[data-section=dimensions]")).toHaveAttribute(
      "open",
      "",
    );
    const save = page.getByRole("button", { name: "保存商品", exact: true });
    await save.focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "取消编辑", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const more = page.locator(".studio-more > summary");
    await expect(more).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "保存并下载资料", exact: true }),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(page.locator(".studio-more")).not.toHaveAttribute("open");
    await page.locator("[data-entry-focus=images]").click();
    await expect(page.locator(".entry-drop")).toBeFocused();
    const photo = page.locator(".studio-photo").first();
    await expect(
      photo.getByRole("button", { name: "移除", exact: true }),
    ).toBeHidden();
    const photoMore = photo.locator("summary");
    await photoMore.focus();
    await page.keyboard.press("Enter");
    await expect(photo.locator(".studio-photo-menu")).toContainText(
      "取消编辑不撤销",
    );
    await page.keyboard.press("Escape");
    await expect(photoMore).toBeFocused();
    await photoMore.click();
    let archives = 0,
      classifications = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/archive")) archives++;
      if (r.method() === "POST" && r.url().endsWith("/classify"))
        classifications++;
    });
    page.once("dialog", (d) => d.dismiss());
    await photo.getByRole("button", { name: "移除", exact: true }).click();
    expect(archives).toBe(0);
    await expect(photoMore).toBeFocused();
    await photoMore.click();
    await photo
      .getByRole("button", { name: "标瑕疵", exact: true })
      .click({ clickCount: 2 });
    await expect(page.locator(".studio-image-outcome")).toContainText(
      "瑕疵标记已保存",
    );
    expect(classifications).toBe(1);
    await expect(photoMore).toBeFocused();
    await page.locator("[data-entry-focus=measurements]").click();
    await expect(page.getByLabel("实测尺寸", { exact: true })).toBeFocused();
    await page.getByLabel("实测尺寸", { exact: true }).fill("肩宽42cm");
    const pendingBuffer = await sharp(buffer)
      .modulate({ brightness: 0.7 })
      .png()
      .toBuffer();
    await page.getByLabel("选择商品图片", { exact: true }).setInputFiles({
      name: "pending.png",
      mimeType: "image/png",
      buffer: pendingBuffer,
    });
    await expect(page.locator(".entry-file-summary")).toContainText(
      "1 张待保存",
    );
    const keys = [];
    await page.route(`**/api/items/${item.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1) await route.abort("failed");
      else await route.continue();
    });
    await save.click();
    await expect(page.locator("#entry-retry")).toBeVisible();
    await expect(page.getByLabel("实测尺寸", { exact: true })).toHaveValue(
      "肩宽42cm",
    );
    await expect(page.locator(".entry-file-list")).toContainText("pending.png");
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("link", { name: "取消编辑", exact: true }).click();
    await expect(page.getByLabel("实测尺寸", { exact: true })).toHaveValue(
      "肩宽42cm",
    );
    await page.locator("#entry-retry").click();
    await expect(page.locator(".entry-save-state")).toHaveText(
      "已核对，继续保存",
    );
    await save.click();
    await expect(page.locator(".entry-save-state")).toHaveText("已保存");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    const latest = await (
      await page.request.get(`/api/items/${item.id}`)
    ).json();
    expect(latest.facts.measurements).toBe("肩宽42cm");
    expect(latest.assets.filter((a) => !a.archived)).toHaveLength(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "取消编辑", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:4320/" + back);
    await expect(page.locator(`[data-pick="${item.id}"]`)).toBeChecked();
  });
}
