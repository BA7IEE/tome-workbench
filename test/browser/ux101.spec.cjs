const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);

async function login(page, email = fixture.email, password = fixture.password) {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.locator(".sidebar-bottom")).toBeVisible();
}

async function api(page, path, body, method = "POST") {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const response = await page.request.fetch("/api" + path, {
    method,
    ...(body === undefined ? {} : { data: body }),
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test.beforeEach(async ({ page }) => login(page));

test("无hash登录后默认进入工作台而不是全量商品库", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "工作总览" })).toBeVisible();
  await expect(page.getByRole("link", { name: "工作台", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("快速录货先校验图片，坏文件不会留下半成品TM", async ({ page }) => {
  const title = "预校验不建档 " + randomUUID();
  await page.goto("/#/items");
  await page.getByRole("button", { name: "＋ 快速录货", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("商品名称", { exact: true }).fill(title);
  await dialog.getByLabel("商品图片", { exact: true }).setInputFiles({
    name: "not-supported.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("synthetic-not-an-image"),
  });
  await dialog.getByRole("button", { name: "保存并下一件", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("TM尚未创建");
  const result = await (
    await page.request.get("/api/items?q=" + encodeURIComponent(title))
  ).json();
  expect(result.total).toBe(0);
});

test("运营可以看成交事实但不能读取经营财务账", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8),
    email = `operator-${suffix}@tome.test`,
    password = "Operator-UX-123456";
  const item = await api(page, "/items", { title: "运营成交可见 " + suffix });
  await api(page, "/auth/users", {
    name: "UX运营 " + suffix,
    email,
    password,
    role: "OPERATOR",
  });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByLabel("登录邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  const salesGroup = page.locator("details.nav-group").filter({ hasText: "销售" });
  await salesGroup.locator("summary").click();
  await expect(page.getByRole("link", { name: "成交记录", exact: true })).toBeVisible();
  await api(page, `/items/${item.id}/sold`, {
    channel: "线下成交",
    customerRef: "UX客户",
    note: "合成交事实权限测试",
  });
  const factsResponse = await page.request.get(
    `/api/sale-facts?page=1&itemId=${item.id}`,
  );
  expect(factsResponse.status()).toBe(200);
  const facts = await factsResponse.json();
  expect(facts.rows).toHaveLength(1);
  for (const key of ["amount", "cost", "fees", "refunded", "paid", "cooperation"])
    expect(Object.prototype.hasOwnProperty.call(facts.rows[0], key)).toBe(false);
  expect((await page.request.get(`/api/sales?page=1&itemId=${item.id}`)).status()).toBe(403);
  await page.getByRole("link", { name: "成交记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "成交记录" })).toBeVisible();
  await expect(page.getByText("成交额、成本、费用、退款、到账和合作分成只向经营财务角色显示")).toBeVisible();
});
