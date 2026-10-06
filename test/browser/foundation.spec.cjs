const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { submitLogin, fillLogin } = require("./login.cjs");
// prepare-test creates only disposable, synthetic tome_test users and records.
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/#/items");
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
  await expect(page.locator(".foundation-shell")).toBeVisible();
  await expect(page.locator("#content .loading")).toHaveCount(0);
}

function luminance(color) {
  const rgb = color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number);
  const linear = rgb.map((component) => {
    const value = component / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(foreground, background) {
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const width of [1280, 1440, 1920]) {
  test(`Foundation desktop ${width}: collapse, navigate, focus and logout`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    // Test rendered body, selected navigation and role annotations against AA.
    const pairs = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const nav = getComputedStyle(
        document.querySelector('.library-navigation [aria-current="page"]'),
      );
      const role = getComputedStyle(
        document.querySelector(".sidebar-bottom small"),
      );
      const aside = getComputedStyle(document.querySelector(".admin-sidebar"));
      const tags = [...document.querySelectorAll("#content .ant-tag")].map(
        (tag) => {
          const style = getComputedStyle(tag);
          return [style.color, style.backgroundColor];
        },
      );
      if (!tags.length)
        throw new Error("Real catalog status Tags are required");
      return [
        [body.color, body.backgroundColor],
        [nav.color, nav.backgroundColor],
        [role.color, aside.backgroundColor],
        ...tags,
      ];
    });
    for (const [foreground, background] of pairs)
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toHaveCount(1);
    const toggle = page.getByRole("button", { name: "折叠导航", exact: true });
    // Guard the real framework entry, not a detached component demo.
    await expect(toggle).toHaveClass(/ant-btn/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(
      page.getByRole("button", { name: "展开导航", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".foundation-brand-short")).toBeVisible();
    await expect(page.locator(".foundation-brand-full")).toBeHidden();
    const iconsInside = await page
      .locator(".admin-sidebar")
      .evaluate((sidebar) => {
        const bounds = sidebar.getBoundingClientRect();
        return [...sidebar.querySelectorAll(".foundation-nav-icon")].every(
          (icon) => {
            const rect = icon.getBoundingClientRect();
            return (
              rect.width === 20 &&
              rect.height === 20 &&
              rect.left >= bounds.left &&
              rect.right <= bounds.right
            );
          },
        );
      });
    expect(iconsInside).toBe(true);
    await page.getByRole("link", { name: "工作台", exact: true }).click();
    await expect(page.locator("#content .loading")).toHaveCount(0);
    await expect(page.locator(".foundation-shell")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    await expect(
      page.getByRole("link", { name: "工作台", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "展开导航", exact: true }).click();
    await expect(page.locator(".foundation-brand-full")).toBeVisible();
    const before = new URL(page.url()).hash;
    await page.getByRole("link", { name: "跳到页面内容" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#content")).toBeFocused();
    expect(new URL(page.url()).hash).toBe(before);
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
    const [logout] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/logout") &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "退出登录", exact: true }).click(),
    ]);
    expect(logout.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: "登录工作台" }),
    ).toBeVisible();
  });
}

test("Foundation mobile keeps named navigation and a single logout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole("button", { name: "折叠导航" })).toBeHidden();
  await expect(
    page.getByRole("link", { name: "商品库", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
});
