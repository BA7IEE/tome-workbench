const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function login(page) {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.locator(".sidebar-bottom")).toBeVisible();
}
async function openNew(page) {
  await page.goto("/#/items/new");
  await expect(page.getByLabel("商品名称", { exact: true })).toBeVisible();
  await expect(page.locator("[data-dictionary][data-ready=true]")).toHaveCount(
    4,
  );
}
test.beforeEach(async ({ page }) => login(page));

test("桌面商品编辑器保持清晰主栏与侧栏，不横向溢出", async ({ page }) => {
  await openNew(page);
  const g = await page.evaluate(() => ({
    main: document.querySelector(".studio-main-column").getBoundingClientRect()
      .width,
    side: document.querySelector(".studio-inspector").getBoundingClientRect()
      .width,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  expect(g.main).toBeGreaterThan(600);
  expect(g.side).toBeGreaterThan(280);
  expect(g.overflow).toBeLessThanOrEqual(2);
});

test("手机商品页按真实录货顺序排布且所有卡片占满宽度", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNew(page);
  const y = await page.evaluate(() => {
    const pos = (s) =>
      document.querySelector(s)?.getBoundingClientRect().top ?? -1;
    return {
      title: pos(".studio-title-card"),
      media: pos(".studio-main-column>[data-media-slot]"),
      classification: pos(".studio-classification-card"),
      price: pos(".studio-price-card"),
      condition: pos(".studio-condition-card"),
      description: pos(".studio-description"),
      dimensions: pos("[data-section=dimensions]"),
      overflow: document.documentElement.scrollWidth - innerWidth,
      width: document.querySelector(".entry-photos").getBoundingClientRect()
        .width,
    };
  });
  expect(
    [
      y.title,
      y.media,
      y.classification,
      y.price,
      y.condition,
      y.description,
      y.dimensions,
    ].every((v, i, a) => i === 0 || v > a[i - 1]),
  ).toBe(true);
  expect(y.width).toBeGreaterThan(350);
  expect(y.overflow).toBeLessThanOrEqual(2);
});

test("手机顶级业务导航全部可达", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/items");
  await expect(
    page.getByRole("link", { name: "商品库", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "导入记录", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByText("其他业务记录与维护工具", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "经营待办", exact: true }),
  ).toBeVisible();
  await page.getByText("销售", { exact: true }).click();
  await page.getByRole("link", { name: "发布记录", exact: true }).click();
  await expect(page).toHaveURL(/#\/listings/);
});

test("正式商品列表状态标签克制，页头只保留一个主动作", async ({ page }) => {
  await page.goto("/#/items?dataMode=BUSINESS");
  await expect(
    page.getByRole("heading", { name: "商品", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "＋ 快速录货", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "从货源导入", exact: true }),
  ).toHaveCount(0);
  const row = page.locator("tbody tr").first();
  if (await row.count()) {
    expect(await row.locator(".status-pill").count()).toBeLessThanOrEqual(2);
    await expect(row).not.toContainText("正式商品");
  }
});

test("视觉层只有一个最终设计系统所有者", async () => {
  const main = fs.readFileSync("web/src/main.ts", "utf8");
  expect(main).toContain('import "./ui08.css"');
  for (const old of [
    "style.css",
    "interaction.css",
    "usability.css",
    "admin-flow.css",
    "studio.css",
    "ux2.css",
  ]) {
    expect(main).not.toContain(`import "./${old}"`);
    // rc.18 retained active rules in ui08.css; retired files must not return.
    expect(fs.existsSync("web/src/" + old)).toBe(false);
  }
  expect(main.match(/import "\.\/[^\"]+\.css"/g)).toEqual([
    'import "./ui08.css"',
  ]);
});

const { randomUUID } = require("node:crypto");
async function uiApi(page, path, body, method = "POST") {
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

test("列表末行菜单不被裁切，外部点击与Escape收起并可实际修改", async ({
  page,
}) => {
  const title = "菜单边界 " + randomUUID(),
    item = await uiApi(page, "/items", { title });
  await page.goto("/#/items?q=" + encodeURIComponent(title));
  const menu = page.getByRole("button", {
      name: item.code + " 更多操作",
      exact: true,
    }),
    summary = menu;
  // A click can auto-scroll the table and hide an offscreen action column.
  // Operators must see this entry before scrolling sideways.
  await expect(menu).toBeVisible();
  await expect(page.locator(".catalog-row-menu")).toHaveCount(1);
  expect(
    await menu.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth;
    }),
  ).toBe(true);
  await summary.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() =>
      page.locator(".catalog-dropdown-actions").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + 20, r.bottom - 15));
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toBeFocused();
  await summary.click();
  await page.getByRole("heading", { name: "商品", exact: true }).click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await summary.click();
  await page.getByRole("button", { name: "快速修改", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("对外报价", { exact: true }).fill("218");
  await d.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(d).not.toBeVisible();
  expect(
    (await (await page.request.get("/api/items/" + item.id)).json())
      .currentPrice,
  ).toBe(21800);
});

test("商品重置保留测试范围和图片视图，空状态可恢复且选择可见", async ({
  page,
}) => {
  const title = "筛选恢复 " + randomUUID();
  await uiApi(page, "/items", { title, dataMode: "TEST" });
  await page.goto(
    "/#/items?view=grid&dataMode=TEST&q=" + encodeURIComponent(title),
  );
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.locator(".product-card")).toContainText("尚未报价");
  await page.getByLabel("选择本页", { exact: true }).check();
  await expect(page.locator(".product-card")).toHaveClass(/is-selected/);
  await page.getByLabel("搜索商品").fill("不存在" + randomUUID());
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "没有找到商品" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择本页", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(page).toHaveURL(/dataMode=TEST/);
  await expect(page).toHaveURL(/view=grid/);
  await expect(
    page.locator(".product-card").filter({ hasText: title }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "图片", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#bulk-toolbar")).toBeHidden();
});

test("快速修改完整页入口保护未保存输入，来源等级仍待人工选择", async ({
  page,
}) => {
  const title = "完整入口 " + randomUUID(),
    item = await uiApi(page, "/items", {
      title,
      facts: {
        attributes: {
          sourcePlatform: "合成来源",
          sourceBrand: "Example",
          sourceCondition: "Excellent",
        },
      },
    });
  await page.goto("/#/items?q=" + encodeURIComponent(title));
  // A hash navigation may return before its event is dispatched. Wait for the
  // intended item, rather than matching every menu in the previous catalogue.
  await page
    .getByRole("button", { name: `${item.code} 更多操作`, exact: true })
    .click();
  await page.getByRole("button", { name: "快速修改", exact: true }).click();
  const d = page.getByRole("dialog");
  await expect(d.locator("[data-source-field=condition]")).toContainText(
    "Excellent",
  );
  await expect(d.getByLabel("成色", { exact: true })).toHaveValue("");
  await d.getByLabel("商品名称", { exact: true }).fill(title + " 未保存");
  page.once("dialog", (x) => x.dismiss());
  await d.getByRole("button", { name: "完整商品页", exact: true }).click();
  await expect(d).toBeVisible();
  await expect(d.getByLabel("商品名称", { exact: true })).toHaveValue(
    title + " 未保存",
  );
  page.once("dialog", (x) => x.accept());
  await d.getByRole("button", { name: "完整商品页", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(item.id + "/edit"));
  await expect(d).not.toBeVisible();
  await expect(
    page.locator(".product-entry-form").getByLabel("商品名称", { exact: true }),
  ).toHaveValue(title);
  expect(
    (await (await page.request.get("/api/items/" + item.id)).json()).version,
  ).toBe(1);
});

test("手机批量操作随滚动可达，菜单和快速修改不溢出", async ({ page }) => {
  const title = "手机批量 " + randomUUID();
  for (let n = 0; n < 5; n++)
    await uiApi(page, "/items", { title: title + " " + n });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/items?view=grid&q=" + encodeURIComponent(title));
  await expect(page.locator(".product-card")).toHaveCount(5);
  const columns = await page.locator(".product-card").evaluateAll((els) =>
    els.slice(0, 2).map((el) => ({
      x: el.getBoundingClientRect().x,
      y: el.getBoundingClientRect().y,
    })),
  );
  expect(columns[1].x).toBeGreaterThan(columns[0].x);
  expect(columns[1].y).toBe(columns[0].y);
  await page.getByLabel("选择本页", { exact: true }).check();
  await page.locator(".product-card").last().scrollIntoViewIfNeeded();
  const toolbar = page.locator("#bulk-toolbar");
  await expect(toolbar).toContainText("已选 5 件");
  expect(
    await toolbar.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom < innerHeight;
    }),
  ).toBe(true);
  await toolbar.getByRole("button", { name: "取消选择", exact: true }).click();
  await expect(toolbar).toBeHidden();
  await page.locator(".catalog-row-menu").last().click();
  await page.getByRole("button", { name: "快速修改", exact: true }).click();
  const d = page.getByRole("dialog");
  expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(
    true,
  );
  await d.getByRole("button", { name: "取消", exact: true }).click();
  await expect(d).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(2);
});

test("候选全部筛选包含已排除，空结果有恢复入口，手机筛选不溢出", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8),
    source = await uiApi(page, "/procurement/sources", {
      code: "UI" + suffix,
      name: "界面合成 " + suffix,
      kind: "OFFLINE",
      defaultCurrency: "CNY",
    });
  const session = await uiApi(page, "/ingest/sessions", {
    procurementSourceId: source.id,
    label: "UI synthetic",
    ttlMinutes: 60,
  });
  async function machine(path, body) {
    const r = await page.request.post("/api" + path, {
      data: body,
      headers: {
        "X-Ingest-Token": session.token,
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  }
  const batch = await machine("/agent-ingest/batches", {
    externalBatchKey: suffix,
    agentName: "UI synthetic",
    agentVersion: "1",
    kind: "ITEM_BATCH",
    rawManifest: { synthetic: true },
  });
  await machine("/agent-ingest/batches/" + batch.id + "/candidates", {
    candidates: [
      {
        externalKey: suffix,
        titleRaw: "筛选候选 " + suffix,
        sourceFacts: {},
        rawPayload: { synthetic: true },
      },
    ],
  });
  await page.goto("/#/candidates?sourceId=" + source.id);
  await expect(page.locator(".candidate-card")).toHaveCount(1);
  await page.getByLabel("选择本页", { exact: true }).check();
  await page.getByRole("button", { name: "批量排除", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("排除原因", { exact: true }).fill("合成测试排除");
  await d.getByRole("button", { name: "确认排除", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "没有符合条件的商品" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择本页", { exact: true })).toBeDisabled();
  await page.getByLabel("状态", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.locator(".candidate-card")).toHaveCount(1);
  await expect(page.getByLabel("状态", { exact: true })).toHaveValue("");
  await expect(page.locator(".candidate-card")).toContainText("已排除");
  await page.getByRole("link", { name: "表格模式", exact: true }).click();
  await expect(page.locator(".candidate-table tbody tr")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("搜索候选", { exact: true }).fill("缺失" + suffix);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "没有符合条件的商品" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(2);
  await page.getByRole("link", { name: "清除筛选", exact: true }).click();
  await expect(page).toHaveURL(/view=table/);
  await uiApi(page, "/ingest/sessions/" + session.id + "/revoke", {
    reason: "合成测试完成",
  });
});

test("空待办给出继续操作入口，手机资料弹窗标题与关闭按钮可用", async ({
  page,
}) => {
  await page.goto("/#/tasks?q=" + randomUUID());
  await expect(
    page.getByRole("heading", { name: "没有匹配的待办" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看全部事项", exact: true }).click();
  await expect(page.getByLabel("查看范围", { exact: true })).toHaveValue("ALL");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/candidates");
  await page.getByRole("button", { name: "导入检查", exact: true }).click();
  const d = page.getByRole("dialog");
  await expect(d).toBeVisible();
  const geometry = await d.evaluate((el) => {
    const h = el.querySelector(":scope > header"),
      b = h.querySelector(".close"),
      r = b.getBoundingClientRect();
    return {
      overflow: el.scrollWidth - el.clientWidth,
      width: r.width,
      height: r.height,
      hit: b.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      ),
    };
  });
  expect(geometry.overflow).toBeLessThanOrEqual(2);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(40);
  expect(geometry.hit).toBe(true);
  await d.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(d).not.toBeVisible();
});

test("商品工作区原地记录询盘，真实写入回执中断后重试不丢商品草稿", async ({
  page,
}) => {
  const item = await uiApi(page, "/items", {
    title: "就地询盘 " + randomUUID(),
  });
  const before = await (await page.request.get("/api/items/" + item.id)).json(); // Creation returns identity only; compare persisted facts.
  await page.goto("/#/items/" + item.id + "/edit");
  await page.getByLabel("中文介绍", { exact: true }).fill("还没保存的商品文案");
  await page.getByRole("button", { name: "记录询盘", exact: true }).click();
  const d = page.getByRole("dialog", { name: "记录询盘", exact: true });
  await d.getByLabel("渠道", { exact: true }).fill("合成微信");
  await d
    .getByLabel("客户内部标记", { exact: true })
    .fill("客户 " + randomUUID());
  await d.getByLabel("问题、跟进计划与沟通摘要").fill("询问尺码，周五回复");
  let lost = false;
  const keys = [];
  await page.route("**/api/inquiries", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await d.getByRole("button", { name: "保存询盘", exact: true }).click();
  await expect(d.locator(".form-error")).not.toBeEmpty();
  await d.getByRole("button", { name: "保存询盘", exact: true }).click();
  await expect(d).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "还没保存的商品文案",
  );
  await expect(page.locator(".entry-save-state")).toContainText("未保存");
  const rows = await (
    await page.request.get("/api/inquiries?itemId=" + item.id)
  ).json();
  expect(rows).toHaveLength(1);
  expect(rows[0].quote).toBeNull();
  const current = await (
    await page.request.get("/api/items/" + item.id)
  ).json();
  expect(current.version).toBe(before.version);
  expect(current.status).toBe(before.status);
  expect(current.facts.descriptionZh).not.toBe("还没保存的商品文案");
});

test("从经营待办直接跟进指定询盘，完成后返回待办且不改变库存", async ({
  page,
}) => {
  const title = "询盘路径 " + randomUUID(),
    item = await uiApi(page, "/items", { title });
  const before = await (await page.request.get("/api/items/" + item.id)).json();
  const inquiry = await uiApi(page, "/inquiries", {
    itemId: item.id,
    channel: "合成门店",
    customerRef: "路径客户",
    notes: "待回复",
  });
  await uiApi(page, "/inquiries", {
    itemId: item.id,
    channel: "合成其他",
    customerRef: "另一个客户",
  });
  await page.goto("/#/tasks?scope=INQUIRY&q=" + encodeURIComponent(title));
  const row = page
    .locator(".work-queue-table tr")
    .filter({ hasText: "路径客户" });
  await row.getByRole("link", { name: "去跟进", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("inquiries\\?id=" + inquiry.id));
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("路径客户");
  await expect(page.locator("tbody")).not.toContainText("另一个客户");
  await page.getByRole("button", { name: "更新跟进", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("进度", { exact: true }).selectOption("LOST");
  await d
    .getByLabel("沟通记录 / 流失原因", { exact: true })
    .fill("尺码不合，已回复");
  await d.getByRole("button", { name: "保存", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(page.locator("tbody")).toContainText("尺码不合，已回复");
  await page
    .getByRole("link", { name: "返回客户跟进待办", exact: true })
    .click();
  await expect(page.getByLabel("查看范围", { exact: true })).toHaveValue(
    "INQUIRY",
  );
  await expect(page.locator(".work-queue-table")).not.toContainText("路径客户");
  expect(
    (await (await page.request.get("/api/items/" + item.id)).json()).status,
  ).toBe(before.status);
});

test("已确认候选不再提供无效勾选，维护商品后返回原候选筛选", async ({
  page,
}) => {
  const key = randomUUID().slice(0, 8),
    source = await uiApi(page, "/procurement/sources", {
      code: "RT" + key,
      name: "返回来源 " + key,
      kind: "OFFLINE",
      defaultCurrency: "CNY",
    }),
    session = await uiApi(page, "/ingest/sessions", {
      procurementSourceId: source.id,
      label: "return synthetic",
      ttlMinutes: 60,
    });
  async function machine(path, body) {
    const r = await page.request.post("/api" + path, {
      data: body,
      headers: {
        "X-Ingest-Token": session.token,
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  }
  const batch = await machine("/agent-ingest/batches", {
      externalBatchKey: key,
      agentName: "Return synthetic",
      agentVersion: "1",
      kind: "ITEM_BATCH",
      rawManifest: { synthetic: true },
    }),
    imported = await machine(
      "/agent-ingest/batches/" + batch.id + "/candidates",
      {
        candidates: [
          {
            externalKey: key,
            titleRaw: "返回商品 " + key,
            brandRaw: "非标准合成品牌",
            sourceFacts: {},
            rawPayload: { synthetic: true },
          },
        ],
      },
    );
  await uiApi(page, "/ingest/candidates/" + imported.rows[0].id + "/confirm", {
    version: imported.rows[0].version,
    possession: "IN_HAND",
    status: "AVAILABLE",
    note: "合成实物确认",
  });
  const hash =
    "/#/candidates?sourceId=" +
    source.id +
    "&decision=CONFIRMED&view=cards&q=" +
    key;
  await page.goto(hash);
  await expect(page.locator(".candidate-card")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator(".candidate-history-note")).not.toHaveAttribute(
    "open",
    "",
  );
  await page.locator(".candidate-history-note summary").click();
  await expect(page.locator(".candidate-warning")).toBeVisible();
  await page.locator(".candidate-actions a").click();
  await expect(
    page.getByRole("link", { name: "返回候选列表", exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel("中文介绍", { exact: true }).fill("在TM中维护后的说明");
  await page.locator(".studio-more summary").click();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4320" + hash);
  await expect(page.locator(".candidate-card")).toHaveCount(1);
  await uiApi(page, "/ingest/sessions/" + session.id + "/revoke", {
    reason: "合成测试完成",
  });
});

test("最终样式负责侧栏宽度与弹窗间距，不被旧样式覆盖", async ({ page }) => {
  await page.goto("/#/items");
  const layout = await page.evaluate(() => ({
    aside: document.querySelector(".admin-sidebar").getBoundingClientRect()
      .right,
    workspace: document.querySelector(".workspace").getBoundingClientRect()
      .left,
  }));
  expect(layout.aside).toBe(layout.workspace);
  await page.getByRole("button", { name: "＋ 快速录货", exact: true }).click();
  const d = page.getByRole("dialog");
  const margins = await d.evaluate((el) => ({
    head: getComputedStyle(el.querySelector("header")).marginBottom,
    foot: getComputedStyle(el.querySelector("footer")).marginTop,
  }));
  expect(margins).toEqual({ head: "0px", foot: "0px" });
  await d.getByRole("button", { name: "取消", exact: true }).click();
});
