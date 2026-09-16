const { submitLogin, fillLogin } = require("./login.cjs");
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);

async function login(page, email = fixture.email, password = fixture.password) {
  await page.goto("/");
  await fillLogin(page, email, password);
  await submitLogin(page);
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
  await expect(
    page.getByRole("link", { name: "工作台", exact: true }),
  ).toHaveAttribute("aria-current", "page");
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
  await dialog
    .getByRole("button", { name: "保存并下一件", exact: true })
    .click();
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
  await fillLogin(page, email, password);
  await submitLogin(page);
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "销售", exact: true }),
  ).toBeVisible();
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
  for (const key of [
    "amount",
    "cost",
    "fees",
    "refunded",
    "paid",
    "cooperation",
  ])
    expect(Object.prototype.hasOwnProperty.call(facts.rows[0], key)).toBe(
      false,
    );
  expect(
    (await page.request.get(`/api/sales?page=1&itemId=${item.id}`)).status(),
  ).toBe(403);
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "销售", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "成交记录" })).toBeVisible();
  await expect(
    page.getByText(
      "成交额、成本、费用、退款、到账和合作分成只向经营财务角色显示",
    ),
  ).toBeVisible();
  const salesHash = new URL(page.url()).hash;
  await page.locator(".itemlink").filter({ hasText: item.code }).click();
  await expect(page.locator(".product-overview")).toBeVisible();
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "返回成交记录", exact: false }).click();
  expect(new URL(page.url()).hash).toBe(salesHash);
});

test("只读详情直接预留和解除，真实写入丢回执后同键重试且不自动恢复可售", async ({
  page,
}) => {
  const item = await api(page, "/items", {
    title: "UX详情库存 " + randomUUID(),
  });
  await page.goto(`/#/items/${item.id}`);
  await expect(page.locator(".product-overview")).toBeVisible();
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveCount(0);
  for (const [action, open, submit, state] of [
    ["reserve", "预留", "确认预留", "RESERVED"],
    ["release", "解除预留", "确认解除", "PAUSED"],
  ]) {
    const keys = [],
      path = `**/api/items/${item.id}/${action}`;
    await page.route(path, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      if (keys.length === 1)
        await route.fulfill({
          status: response.status(),
          contentType: "application/json",
          body: "{",
        });
      else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: open, exact: true }).click();
    const d = page.getByRole("dialog");
    if (action === "reserve")
      await d.getByLabel("客户内部标记", { exact: true }).fill("合成预留客户");
    await d.getByRole("button", { name: submit, exact: true }).click();
    await expect(d.getByRole("alert")).toContainText("响应未完整收到");
    expect(
      (await api(page, `/items/${item.id}`, undefined, "GET")).status,
    ).toBe(state);
    await d.getByRole("button", { name: submit, exact: true }).click();
    await expect(d).not.toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await page.unroute(path);
    const latest = await api(page, `/items/${item.id}`, undefined, "GET");
    expect(latest.status).toBe(state);
    // The item API exposes active reservations; release retains history in the DB.
    expect(latest.reservations).toHaveLength(action === "reserve" ? 1 : 0);
  }
  await expect(page.locator("[data-overview-status]")).toHaveText("已暂停");
  await page.getByRole("button", { name: "恢复可售", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("实物、库存与品相复核依据").fill("合成实物已重新核对");
  await d.getByLabel("已重新核对库存，确认可以销售").check();
  await d.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(page.locator("[data-overview-status]")).toHaveText("可售");
  expect((await api(page, `/items/${item.id}`, undefined, "GET")).status).toBe(
    "AVAILABLE",
  );
});

test("登录真实响应延迟时先等确定回执，保留页面断言且只提交一次", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext();
  const other = await context.newPage();
  let writes = 0,
    committed;
  const received = new Promise((resolve) => {
    committed = resolve;
  });
  try {
    await other.goto(new URL(page.url()).origin);
    await fillLogin(other, fixture.email, fixture.password);
    await other.route("**/api/auth/login", async (route) => {
      writes++;
      const response = await route.fetch();
      committed();
      // Deliberate post-write response latency, not a retry or a substitute backend.
      await new Promise((resolve) => setTimeout(resolve, 5500));
      await route.fulfill({ response });
    });
    const pending = submitLogin(other);
    await received;
    await expect(
      other.getByRole("button", { name: "进入工作台" }),
    ).toBeDisabled();
    await expect(other.locator(".sidebar-bottom")).toHaveCount(0);
    await pending;
    await expect(other.locator(".sidebar-bottom strong")).toHaveText(
      "合成ADMIN",
    );
    await expect(
      other.getByRole("heading", { name: "工作总览", exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    expect(
      (
        await other.request.get(new URL(page.url()).origin + "/api/auth/me")
      ).status(),
    ).toBe(200);
  } finally {
    await context.close();
  }
});

test("各角色界面使用服务端能力，商品编辑与销售入口符合真实权限", async ({ page, browser }) => {
  const { permission } = require("../../dist/auth/auth");
  for (const role of ["ADMIN", "REVIEWER", "OPERATOR", "FINANCE", "VIEWER"]) {
    const email = `ui-cap-${randomUUID()}@tome.test`, password = "Synthetic!" + randomUUID();
    await api(page, "/auth/users", { email, password, name: "合成能力核验", role });
    const account = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const other = await account.newPage();
      await login(other, email, password);
      const session = await (await other.request.get("/api/auth/me")).json();
      expect(session.capabilities.includes("sell")).toBe(permission(role, "sell"));
      await expect(other.getByRole("link", { name: "销售", exact: true })).toHaveCount(permission(role, "sell") ? 1 : 0);
      await other.goto("/#/items");
      await expect(other.getByRole("heading", { name: "商品", exact: true })).toBeVisible();
      await expect(other.getByRole("button", { name: "＋ 快速录货", exact: true })).toHaveCount(permission(role, "edit") ? 1 : 0);
      const users = await other.request.get("/api/auth/users");
      expect(users.status()).toBe(permission(role, "users") ? 200 : 403);
    } finally { await account.close(); }
  }
});
