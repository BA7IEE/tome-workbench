const { submitLogin, fillLogin } = require("./login.cjs");
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
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
  await page.getByRole("button", { name: "＋ 快速录入我方现货", exact: true }).click();
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
      await expect(other.getByRole("button", { name: "＋ 快速录入我方现货", exact: true })).toHaveCount(permission(role, "edit") ? 1 : 0);
      const users = await other.request.get("/api/auth/users");
      expect(users.status()).toBe(permission(role, "users") ? 200 : 403);
    } finally { await account.close(); }
  }
});

async function quickIntakeImage(name = "intake-valid.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 24, height: 32, channels: 3, background: "#c8c2b8" },
    }).png().toBuffer(),
  };
}

test("快速录货跳转货源先检查草稿，拒绝离开保留名称和图片", async ({ page }) => {
  await page.goto("/#/items");
  await page.getByRole("button", { name: "＋ 快速录入我方现货", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const title = "离开录货 " + randomUUID();
  let creates = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/items") creates++;
  });
  await dialog.getByLabel("商品名称", { exact: true }).fill(title);
  await dialog.getByLabel("商品图片", { exact: true }).setInputFiles(await quickIntakeImage());
  page.once("dialog", (d) => d.dismiss());
  await dialog.getByRole("link", { name: "货源与供应商", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/#\/items$/);
  await expect(dialog.getByLabel("商品名称", { exact: true })).toHaveValue(title);
  expect(await dialog.getByLabel("商品图片", { exact: true }).evaluate((el) => el.files.length)).toBe(1);
  expect(creates).toBe(0);
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("link", { name: "货源与供应商", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/#\/sources$/);
  expect(creates).toBe(0);
});

for (const change of ["改字段", "换图片", "换保存意图"]) {
  test(`快速录货图片真实拒绝后${change}，继续同一TM不再建档`, async ({ page }) => {
    const prefix = "恢复录货 " + randomUUID();
    let creates = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/items") creates++;
    });
    await page.goto("/#/items");
    await page.getByRole("button", { name: "＋ 快速录入我方现货", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("商品名称", { exact: true }).fill(prefix);
    await dialog.getByLabel("商品图片", { exact: true }).setInputFiles({
      name: "intake-corrupt.png",
      mimeType: "image/png",
      buffer: Buffer.from("synthetic-corrupt-png"),
    });
    const uploaded = (r) => new URL(r.url()).pathname === "/api/assets/upload" && r.request().method() === "POST";
    const [rejected] = await Promise.all([
      page.waitForResponse(uploaded),
      dialog.getByRole("button", { name: "保存并关闭", exact: true }).click(),
    ]);
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).error.code).toBe("INVALID_IMAGE");
    await expect(dialog.getByRole("alert")).toContainText("无法解码");
    const before = await (await page.request.get("/api/items?q=" + encodeURIComponent(prefix))).json();
    expect(before.total).toBe(1);
    const id = before.rows[0].id;
    if (change === "改字段") await dialog.getByLabel("商品名称", { exact: true }).fill(prefix + " 更正");
    if (change === "换图片") await dialog.getByLabel("商品图片", { exact: true }).setInputFiles(await quickIntakeImage("replacement.png"));
    const [retried] = await Promise.all([
      page.waitForResponse(uploaded),
      dialog.getByRole("button", { name: change === "换保存意图" ? "保存并完善" : "保存并关闭", exact: true }).click(),
    ]);
    expect(retried.status()).toBe(change === "换图片" ? 201 : 400);
    const after = await (await page.request.get("/api/items?q=" + encodeURIComponent(prefix))).json();
    expect(after.total).toBe(1);
    expect(after.rows[0].id).toBe(id);
    expect(creates).toBe(1);
    if (change === "改字段") expect(after.rows[0].title).toBe(prefix + " 更正");
    if (change === "换图片") {
      await expect(dialog).not.toBeVisible();
      const item = await (await page.request.get("/api/items/" + id)).json();
      expect(item.assets).toHaveLength(1);
      expect(item.assets[0].originalName).toBe("replacement.png");
    }
  });
}

test("快速录货首次建档回执丢失，关闭再开核对原请求仍只有同一TM", async ({ page }) => {
  const title = "跨窗口建档恢复 " + randomUUID();
  const keys = [];
  let lost = false;
  await page.route("**/api/items", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await page.goto("/#/items");
  await page.getByRole("button", { name: "＋ 快速录入我方现货", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("商品名称", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "保存并关闭", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("提交结果可能未确认");
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#catalog-search")).toBeVisible();
  await page.getByRole("button", { name: "＋ 快速录入我方现货", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("商品名称", { exact: true })).toHaveValue(title);
  await dialog.getByRole("button", { name: "核对本次提交", exact: true }).click();
  await expect(dialog.locator(".quick-intake-upload-status")).toContainText("原提交已核对");
  await dialog.getByRole("button", { name: "保存并关闭", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const result = await (await page.request.get("/api/items?q=" + encodeURIComponent(title))).json();
  expect(result.total).toBe(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("快速录货图片真实保存丢回执后登录失效，保留未知尝试并原键核对", async ({ page }) => {
  const title = "图片回执与登录核对 " + randomUUID();
  let lost = false;
  const keys = [];
  await page.route("**/api/assets/upload", async route => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (!lost) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      lost = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto("/#/items");
  await page.getByRole("button", {name:"＋ 快速录入我方现货",exact:true}).click();
  const d=page.getByRole("dialog",{name:"快速录入我方现货"});
  await d.getByLabel("商品名称",{exact:true}).fill(title);
  await d.getByLabel("商品图片",{exact:true}).setInputFiles(await quickIntakeImage("lost-image.png"));
  await d.getByRole("button",{name:"保存并关闭",exact:true}).click();
  await expect(d.getByRole("alert")).toContainText("结果待确认");
  const auth=await (await page.request.get("/api/auth/me")).json();
  const items=await (await page.request.get("/api/items?q="+encodeURIComponent(title))).json();
  expect(items.total).toBe(1);
  const itemId=items.rows[0].id;
  await api(page,"/auth/logout",{});
  await d.getByRole("button",{name:"保存并关闭",exact:true}).click();
  await expect(d.getByRole("button",{name:"重新登录并保留输入",exact:true})).toBeVisible();
  const queue=await page.evaluate(async key => {
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("tome-work-recovery",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error("synthetic recovery read failed"));});
    const value=await new Promise((resolve,reject)=>{const r=db.transaction("work","readonly").objectStore("work").get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error("synthetic recovery read failed"));});db.close();
    return value.map(job=>({uncertain:job.uncertain,state:job.state}));
  },`images:${auth.user.id}:${itemId}`);
  expect(queue).toEqual([{uncertain:true,state:"结果待确认"}]);
  await d.getByRole("button",{name:"重新登录并保留输入",exact:true}).click();
  const loginDialog=page.getByRole("dialog",{name:"恢复登录"});
  await loginDialog.getByLabel("密码",{exact:true}).fill(fixture.password);
  const receipt=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/auth/login"&&r.request().method()==="POST");
  await loginDialog.getByRole("button",{name:"恢复登录",exact:true}).click();
  expect((await receipt).ok()).toBe(true);
  await expect(loginDialog).not.toBeVisible();
  await expect(d.getByRole("alert")).toContainText("登录已恢复");
  await d.getByRole("button",{name:"保存并关闭",exact:true}).click();
  await expect(d).not.toBeVisible();
  expect(keys).toHaveLength(3);expect(new Set(keys).size).toBe(1);
  const saved=await (await page.request.get(`/api/items/${itemId}`)).json();
  expect(saved.assets).toHaveLength(1);expect(saved.assets[0].originalName).toBe("lost-image.png");
  expect((await (await page.request.get("/api/items?q="+encodeURIComponent(title))).json()).total).toBe(1);
});
