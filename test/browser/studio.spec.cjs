const { submitLogin, fillLogin } = require("./login.cjs");
const { revealPublishing, revealSection } = require("./reveal-section.cjs");
const { chooseDictionary } = require("./dictionary-control.cjs");
// New default product workspace: no force clicks, no page reloads masking stale rendering.
const { test, expect } = require("@playwright/test");
const { randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs");
const sharp = require("sharp");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
async function productMore(page) {
  const summary = page.locator("details.studio-more > summary");
  if (await summary.count()) {
    await summary.click();
    await page
      .locator("details.studio-more[open]")
      .waitFor({ state: "attached" });
  }
}
async function stockMore(page) {
  const operations = page.locator("details.studio-operating-options");
  if (
    (await operations.count()) &&
    (await operations.getAttribute("open")) === null
  )
    await operations.locator(":scope > summary").click();
  const summary = page.locator("details.studio-stock-menu > summary");
  if (await summary.count()) {
    await summary.click();
    await page
      .locator("details.studio-stock-menu[open]")
      .waitFor({ state: "attached" });
  }
}
async function login(page) {
  await page.goto("/");
  await fillLogin(page, fixture.email, fixture.password);
  await submitLogin(page);
  await expect(page.locator(".sidebar-bottom strong")).toBeVisible();
}
async function start(page) {
  await page.goto("/#/items/new");
  await expect(page.getByLabel("商品名称", { exact: true })).toBeVisible();
  await expect(page.locator("[data-dictionary][data-ready=true]")).toHaveCount(
    4,
  );
  await page.evaluate(() => {
    window.studioSession = "same-document";
  });
}
async function photograph(name = "front.png") {
  return {
    name,
    mimeType: "image/png",
    buffer: await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="880"><rect width="720" height="880" fill="#f2f3f4"/><path d="M250 130 190 165 100 440 195 475 238 355 225 760 495 760 482 355 525 475 620 440 530 165 470 130 412 184 360 200 306 180Z" fill="#494753"/><path d="M306 180 360 200 412 184 360 390Z" fill="#efedf1"/><path d="M360 390V760" stroke="#292934" stroke-width="6"/><circle cx="380" cy="440" r="6" fill="#c4b7a4"/><circle cx="380" cy="525" r="6" fill="#c4b7a4"/><text x="360" y="840" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#76808e">SYNTHETIC TEST GARMENT</text></svg>',
      ),
    )
      .png()
      .toBuffer(),
  };
}
async function basic(page, name) {
  await page.getByLabel("商品名称", { exact: true }).fill(name);
  await chooseDictionary(page, "品牌", "Dior", "Dior");
  await page.getByLabel("对外报价", { exact: true }).fill("2380");
  await chooseDictionary(
    page,
    "成色",
    "非常好",
    "非常好 · Very good condition",
  );
  await page.getByLabel("瑕疵与使用痕迹").fill("袖口有轻微磨损，详见实拍");
  await page
    .getByLabel("中文介绍", { exact: true })
    .fill("中古羊毛夹克，修身剪裁，袖口有轻微磨损。");
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await photograph());
}
async function tradeFacts(page) {
  await revealSection(page, "dimensions");
  await page.getByLabel("实测尺寸").fill("肩宽40cm，胸围90cm，衣长60cm");
  await page.getByLabel("尺寸来源").fill("已核对供应商尺寸记录");
  await page.getByText("鉴定与资料", { exact: true }).click();
  await page.getByLabel("真实性复核").selectOption("PASSED");
  await page
    .getByLabel("鉴定 / 复核依据", { exact: true })
    .fill("合成逐件复核样本，不是真实鉴定证明");
}
async function api(page, path, body, method = "POST") {
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
const failures = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => failures.push(e.message));
  await login(page);
});
test.afterEach(() => expect(failures.splice(0)).toEqual([]));
for (const width of [1440, 390]) {
  test(`商品库直接完整编辑 ${width}px：13图上传前置、尺寸展开、保存重开与取消上下文`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const title = "编辑体验合成 " + randomUUID().slice(0, 8);
    const item = await api(page, "/items", { title, dataMode: "TEST" });
    const original = await photograph("已保存原图.png");
    const auth = await (await page.request.get("/api/auth/me")).json();
    for (let n = 0; n < 13; n++) {
      const image = await sharp(original.buffer)
        .modulate({ brightness: 0.5 + n / 20 })
        .png()
        .toBuffer();
      const response = await page.request.post("/api/assets/upload", {
        headers: {
          Origin: new URL(page.url()).origin,
          "X-CSRF-Token": auth.csrf,
          "Idempotency-Key": randomUUID(),
        },
        multipart: {
          itemId: item.id,
          role: "PRODUCT",
          origin: "OWN",
          sourceNote: "隔离合成图库",
          file: {
            name: `合成图-${n}.png`,
            mimeType: "image/png",
            buffer: image,
          },
        },
      });
      expect(response.ok()).toBeTruthy();
    }
    for (const view of ["table", "grid"]) {
      const back = `#/items?dataMode=TEST&q=${encodeURIComponent(title)}&view=${view}&sort=newest&page=1&size=30`;
      const listed = await page.request.get("/api/items?" + back.split("?")[1]);
      expect(listed.ok()).toBeTruthy();
      expect((await listed.json()).rows.some((row) => row.id === item.id)).toBe(
        true,
      );
      await page.goto("/" + back);
      await expect(page.locator(".catalog-page")).toBeVisible();
      await page.getByLabel(`选择 ${item.code}`, { exact: true }).check();
      await page
        .getByRole("link", { name: `编辑商品 ${item.code}`, exact: true })
        .click();
      await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(
        title,
      );
      await expect(page.locator('[data-section="dimensions"]')).toHaveAttribute(
        "open",
        "",
      );
      const geometry = await page.evaluate(() => {
        const drop = document
          .querySelector(".entry-drop")
          .getBoundingClientRect();
        const gallery = document.querySelector(".studio-gallery");
        return {
          dropY: drop.top + scrollY,
          galleryY: gallery.getBoundingClientRect().top + scrollY,
          galleryHeight: gallery.clientHeight,
          scrollable: gallery.scrollHeight > gallery.clientHeight,
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
        };
      });
      expect(geometry.dropY).toBeLessThan(geometry.galleryY);
      expect(geometry.dropY).toBeLessThan(width === 390 ? 844 : 1000);
      expect(geometry.galleryHeight).toBeLessThanOrEqual(
        width === 390 ? 240 : 360,
      );
      expect(geometry.scrollable).toBe(true);
      expect(geometry.overflow).toBe(false);
      await page
        .getByRole("button", { name: "定位尺寸与材质", exact: true })
        .click();
      await expect(page.getByLabel("实测尺寸", { exact: true })).toBeFocused();
      await page
        .getByLabel("实测尺寸", { exact: true })
        .fill(`合成肩宽40cm-${view}`);
      await page
        .getByLabel("材质成分 / 细节", { exact: true })
        .fill(`合成羊毛-${view}`);
      const added = await photograph(`新增-${view}.png`);
      added.buffer = await sharp(added.buffer)
        .resize(view === "table" ? 701 : 702, 900)
        .png()
        .toBuffer();
      await page
        .getByLabel("选择商品图片", { exact: true })
        .setInputFiles(added);
      await page.getByRole("button", { name: "保存商品", exact: true }).click();
      await expect(page.locator(".entry-save-state")).toHaveText("已保存");
      await page.getByRole("link", { name: "取消编辑", exact: true }).click();
      await expect(page).toHaveURL((url) => url.hash === back);
      await expect(
        page.getByLabel(`选择 ${item.code}`, { exact: true }),
      ).toBeChecked();
      await page
        .getByRole("link", { name: `编辑商品 ${item.code}`, exact: true })
        .click();
      await expect(page.getByLabel("实测尺寸", { exact: true })).toHaveValue(
        `合成肩宽40cm-${view}`,
      );
      await expect(
        page.getByLabel("材质成分 / 细节", { exact: true }),
      ).toHaveValue(`合成羊毛-${view}`);
      const saved = await (
        await page.request.get(`/api/items/${item.id}`)
      ).json();
      // Multipart filename encodings vary; original bytes and their server hash identify this upload.
      const image = saved.assets.find(
        (asset) =>
          asset.sha256 ===
          createHash("sha256").update(added.buffer).digest("hex"),
      );
      expect(image).toBeTruthy();
      expect(saved.assets).toHaveLength(view === "table" ? 14 : 15);
      const originalFile = await page.request.get(
        `/api/assets/${image.id}/original`,
      );
      expect(originalFile.ok()).toBeTruthy();
      expect(await originalFile.body()).toEqual(added.buffer);
      await page.getByLabel("实测尺寸", { exact: true }).fill("取消的尺寸");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("link", { name: "取消编辑", exact: true }).click();
      await expect(page).toHaveURL((url) => url.hash === back);
      const afterCancel = await (
        await page.request.get(`/api/items/${item.id}`)
      ).json();
      expect(afterCancel.facts.measurements).toBe(`合成肩宽40cm-${view}`);
      expect(afterCancel.version).toBe(saved.version);
    }
  });
}

test("完整编辑冲突保留文件；实际保存后断线、重复点击与原请求核对", async ({
  page,
}) => {
  const item = await api(page, "/items", {
    title: "编辑故障合成 " + randomUUID(),
    dataMode: "TEST",
  });
  await page.goto(`/#/items/${item.id}/edit`);
  await page.getByLabel("实测尺寸", { exact: true }).fill("我的合成尺寸");
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await photograph("冲突保留.png"));
  const before = await (await page.request.get(`/api/items/${item.id}`)).json();
  await api(
    page,
    `/items/${item.id}`,
    { version: before.version, facts: { material: "同事的合成材质" } },
    "PATCH",
  );
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toHaveText("保存未完成");
  await expect(page.locator(".entry-conflicts")).toBeVisible();
  await expect(page.locator(".entry-file-list")).toContainText("冲突保留.png");
  await page.getByLabel("我已核对差异，保留下面输入的改动").check();
  await page
    .getByRole("button", { name: "合并后继续编辑", exact: true })
    .click();
  await expect(page.getByLabel("材质成分 / 细节", { exact: true })).toHaveValue(
    "同事的合成材质",
  );
  await expect(page.getByLabel("实测尺寸", { exact: true })).toHaveValue(
    "我的合成尺寸",
  );
  const keys = [];
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      request.url().endsWith(`/api/items/${item.id}`)
    )
      keys.push(request.headers()["idempotency-key"]);
  });
  await page.route(`**/api/items/${item.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const real = await route.fetch();
    expect(real.ok()).toBeTruthy();
    await route.abort("connectionreset");
    await page.unroute(`**/api/items/${item.id}`);
  });
  await page
    .getByRole("button", { name: "保存商品", exact: true })
    .click({ clickCount: 2 });
  await expect(page.locator(".entry-save-state")).toHaveText("保存结果待核对");
  expect(keys).toHaveLength(1);
  await expect(page.locator(".entry-file-list")).toContainText("冲突保留.png");
  await page.getByRole("button", { name: "核对上次提交", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toHaveText(
    "已核对，继续保存",
  );
  expect(keys).toEqual([keys[0], keys[0]]);
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  const saved = await (await page.request.get(`/api/items/${item.id}`)).json();
  expect(saved.facts.measurements).toBe("我的合成尺寸");
  expect(saved.facts.material).toBe("同事的合成材质");
  expect(saved.assets).toHaveLength(1);
});

test("只录标题、价格和图片即可保存，不要求先走审核或流水线", async ({
  page,
}) => {
  await start(page);
  const title = "快速录货 " + randomUUID();
  await page.getByLabel("商品名称", { exact: true }).fill(title);
  await page.getByLabel("对外报价", { exact: true }).fill("980");
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await photograph());
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page).toHaveURL(/#\/items\/[a-f0-9-]+\/edit/);
  await expect(
    page.getByRole("heading", { name: "已保存图片 · 1 张" }),
  ).toBeVisible();
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  const item = (
    await (
      await page.request.get("/api/items?q=" + encodeURIComponent(title))
    ).json()
  ).rows[0];
  expect(item._count.assets).toBe(1);
  expect(item.approvedValid).toBe(false);
  expect(await page.evaluate(() => window.studioSession)).toBe("same-document");
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".entry-save-state")).toHaveText("已保存");
  expect(
    (
      await (
        await page.request.get("/api/items?q=" + encodeURIComponent(title))
      ).json()
    ).total,
  ).toBe(1);
  await page.screenshot({
    path: "reports/screenshots/studio-minimal.png",
    fullPage: true,
  });
});
test("一页录货到可复制资料：集中核对一次，不往返商品、素材和渠道页", async ({
  page,
}) => {
  await start(page);
  const title = "整条工作区流程 " + randomUUID();
  await basic(page, title);
  await tradeFacts(page);
  const navigations = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations.push(f.url());
  });
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  await expect(
    page.getByLabel("供应商图片授权依据", { exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".studio-missing")).toContainText("资料已齐");
  await expect(page.getByLabel("发布正文", { exact: true })).toContainText(
    "袖口",
  );
  await page
    .getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布")
    .check();
  await page.getByRole("button", { name: "生成发布资料", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "资料已就绪", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "复制正文", exact: true }),
  ).toBeVisible();
  const item = (
    await (
      await page.request.get("/api/items?q=" + encodeURIComponent(title))
    ).json()
  ).rows[0];
  const detail = await (await page.request.get("/api/items/" + item.id)).json();
  expect(detail.packages).toHaveLength(1);
  expect(detail.listings).toHaveLength(0);
  expect(detail.assets[0].verified).toBe(true);
  expect(await page.evaluate(() => window.studioSession)).toBe("same-document");
  expect(navigations.filter((u) => !/\/edit/.test(u))).toHaveLength(0);
  await page.screenshot({
    path: "reports/screenshots/studio-publishing.png",
    fullPage: true,
  });
  fs.mkdirSync("reports/journeys", { recursive: true });
  fs.writeFileSync(
    "reports/journeys/one-product.json",
    JSON.stringify(
      {
        kind: "robotic-synthetic-journey-not-human-timing",
        screensAfterEntry: 1,
        manualReviewCheckboxes: 1,
        intermediateDialogs: 0,
        recordedListings: 0,
        passed: true,
      },
      null,
      2,
    ),
  );
});
test("发布缺项直接在本页补齐，已经修改的渠道文案保留", async ({ page }) => {
  await start(page);
  await basic(page, "原地补齐 " + randomUUID());
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  const url = page.url();
  await page
    .getByLabel("发布正文", { exact: true })
    .fill("我自己精修的开头；袖口有轻微磨损。");
  await page.locator("[data-studio-fix=measurements]").click();
  await expect(page.getByLabel("实测尺寸")).toBeFocused();
  await page.getByLabel("实测尺寸").fill("宽40cm，长60cm");
  await page.getByLabel("尺寸来源").fill("供应商提供的原始尺寸");
  await page.locator("[data-studio-fix=authentication]").click();
  await page.getByLabel("真实性复核").selectOption("PASSED");
  await page
    .getByLabel("鉴定 / 复核依据", { exact: true })
    .fill("合成复核证据");
  await page
    .getByRole("button", { name: "保存商品并重新检查", exact: true })
    .click();
  await expect(page.getByLabel("发布正文", { exact: true })).toHaveValue(
    "我自己精修的开头；袖口有轻微磨损。",
  );
  await expect(page.locator(".studio-missing")).toContainText("资料已齐");
  expect(page.url()).toBe(url);
  await expect(
    page.getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布"),
  ).not.toBeChecked();
});
test("集中复核回执丢失后可继续，不能重复生成或误报已发到平台", async ({
  page,
}) => {
  await start(page);
  const name = "集中复核重试 " + randomUUID();
  await basic(page, name);
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  let once = true;
  await page.route("**/api/items/*/review-for-use", async (r) => {
    if (once) {
      once = false;
      await r.fetch();
      await r.abort("failed");
    } else await r.continue();
  });
  await page
    .getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布")
    .check();
  await page.getByRole("button", { name: "生成发布资料", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续上次提交", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续上次提交", exact: true }).click();
  await expect(page.getByRole("heading", { name: "资料已就绪" })).toBeVisible();
  const item = (
    await (
      await page.request.get("/api/items?q=" + encodeURIComponent(name))
    ).json()
  ).rows[0];
  const detail = await (await page.request.get("/api/items/" + item.id)).json();
  expect(detail.packages).toHaveLength(1);
  expect(detail.listings).toHaveLength(0);
});
test("已保存图片可以原地查看、标瑕疵和移除，未保存文字不丢失", async ({
  page,
}) => {
  await start(page);
  await page
    .getByLabel("商品名称", { exact: true })
    .fill("原地图片 " + randomUUID());
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles([
      await photograph("front.png"),
      await photograph("defect.png"),
    ]);
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-photo")).toHaveCount(2);
  const url = page.url();
  await page
    .getByLabel("中文介绍", { exact: true })
    .fill("这段还没保存，不能丢。");
  await page.locator(".studio-photo").last().locator("summary").click();
  await page
    .locator(".studio-photo")
    .last()
    .getByRole("button", { name: "标瑕疵", exact: true })
    .click();
  await expect(
    page.locator(".studio-photo").last().locator(":scope > span"),
  ).toContainText("瑕疵");
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "这段还没保存，不能丢。",
  );
  await expect(page.locator(".studio-image-outcome")).toContainText(
    "瑕疵标记已保存",
  );
  await expect(page.locator(".entry-save-state")).toContainText("未保存");
  expect(page.url()).toBe(url);
  await page.locator(".studio-photo").first().locator("summary").click();
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".studio-photo")
    .first()
    .getByRole("button", { name: "移除", exact: true })
    .click();
  await expect(page.locator(".studio-photo")).toHaveCount(1);
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "这段还没保存，不能丢。",
  );
  await expect(page.locator(".studio-image-outcome")).toContainText("原件保留");
  page.once("dialog", (d) => {
    expect(d.message()).toContain("已生效的图片和经营记录保留");
    return d.accept();
  });
  await page.getByRole("link", { name: "取消编辑", exact: true }).click();
  await expect(page).not.toHaveURL(url);
  const id = new URL(url).hash.match(/items\/([^/]+)/)[1];
  const saved = await (await page.request.get("/api/items/" + id)).json();
  expect(saved.facts.descriptionZh).not.toBe("这段还没保存，不能丢。");
  expect(saved.assets.filter((asset) => !asset.archived)).toHaveLength(1);
  expect(saved.assets.find((asset) => !asset.archived).role).toBe("DEFECT");
});
test("手机主流程可触摸使用，基础表单无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page
    .getByLabel("商品名称", { exact: true })
    .fill("手机主流程 " + randomUUID());
  await page.getByLabel("对外报价", { exact: true }).fill("800");
  await page
    .getByLabel("选择商品图片", { exact: true })
    .setInputFiles(await photograph());
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-photo")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  // No-horizontal-overflow alone missed shrink-wrapped cards; assert real usable widths.
  const mobileGeometry = await page.evaluate(() => {
    const widths = [
      ".studio-title-card",
      ".studio-description",
      "[data-section=dimensions]",
    ].map(
      (selector) =>
        document.querySelector(selector).getBoundingClientRect().width,
    );
    return {
      widths,
      commandbarHeight: document
        .querySelector(".studio-commandbar")
        .getBoundingClientRect().height,
    };
  });
  for (const width of mobileGeometry.widths) expect(width).toBeGreaterThan(330);
  expect(mobileGeometry.commandbarHeight).toBeLessThan(90);
  await page.screenshot({
    path: "reports/screenshots/studio-mobile.png",
    fullPage: true,
  });
});

test("别人更新了渠道草稿时并排核对，不能借刷新悄悄覆盖对方", async ({
  page,
}) => {
  await start(page);
  await basic(page, "渠道并发 " + randomUUID());
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  await page.getByLabel("发布正文", { exact: true }).fill("第一次手工文案");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".studio-publish-feedback")).toContainText(
    "草稿已保存",
  );
  const id = page.url().match(/items\/([a-f0-9-]+)\/edit/)[1],
    channelId = await page.getByLabel("发布目标账号").inputValue();
  const space = await (
    await page.request.get(`/api/items/${id}/studio?channelId=${channelId}`)
  ).json();
  await page
    .getByLabel("发布正文", { exact: true })
    .fill("我的第二次修改仍应保留");
  await api(page, `/items/${id}/publishing-draft`, {
    channelId,
    purpose: "TRADE",
    version: space.draft.version,
    title: space.draft.title,
    body: "同事刚提交的新文案",
    assetIds: space.draft.assetIds,
    basisRevisionId: space.draft.basisRevisionId,
    basisPrice: space.draft.basisPrice,
    basisCurrency: space.draft.basisCurrency,
  });
  await page
    .getByRole("button", { name: "保存商品并重新检查", exact: true })
    .click();
  await expect(page.locator(".studio-draft-conflict")).toBeVisible();
  await expect(page.getByLabel("发布正文", { exact: true })).toHaveValue(
    "我的第二次修改仍应保留",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".studio-publish-feedback")).toContainText(
    "先处理渠道文案冲突",
  );
  expect(
    (
      await (
        await page.request.get(`/api/items/${id}/studio?channelId=${channelId}`)
      ).json()
    ).draft.body,
  ).toBe("同事刚提交的新文案");
  await page.getByLabel("已比较双方文案和选图，确认处理方式").check();
  await page
    .getByRole("button", { name: "核对后保留我的文案", exact: true })
    .click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".studio-publish-feedback")).toContainText(
    "草稿已保存",
  );
  expect(
    (
      await (
        await page.request.get(`/api/items/${id}/studio?channelId=${channelId}`)
      ).json()
    ).draft.body,
  ).toBe("我的第二次修改仍应保留");
});
test("图片回执丢失显示可操作错误，重试后原地恢复而不是空白或死按钮", async ({
  page,
}) => {
  await start(page);
  await basic(page, "图片复原 " + randomUUID());
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-photo")).toHaveCount(1);
  await page.getByLabel("中文介绍", { exact: true }).fill("尚未保存的描述");
  await page.locator(".studio-photo summary").click();
  let first = true;
  await page.route("**/api/assets/*/classify", async (r) => {
    if (first) {
      first = false;
      await r.fetch();
      await r.abort("failed");
    } else await r.continue();
  });
  await page
    .locator(".studio-photo")
    .getByRole("button", { name: "标瑕疵", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "核对图片操作", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".studio-media-error")).not.toBeEmpty();
  await page.getByRole("button", { name: "核对图片操作", exact: true }).click();
  await expect(page.locator(".studio-photo>span")).toContainText("瑕疵");
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "尚未保存的描述",
  );
});
test("已经生成资料后仍能编辑并再次生成，回执恢复不会锁死输入框", async ({
  page,
}) => {
  await start(page);
  await basic(page, "复用之后继续编辑 " + randomUUID());
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  let first = true;
  await page.route("**/api/items/*/packages", async (r) => {
    if (r.request().method() === "POST" && first) {
      first = false;
      await r.fetch();
      await r.abort("failed");
    } else await r.continue();
  });
  await page
    .getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布")
    .check();
  await page.getByRole("button", { name: "生成发布资料", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续上次提交", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续上次提交", exact: true }).click();
  await expect(page.getByRole("heading", { name: "资料已就绪" })).toBeVisible();
  await expect(page.getByLabel("发布正文", { exact: true })).toBeEnabled();
  await page
    .getByLabel("发布正文", { exact: true })
    .fill("第二次改好的文案，袖口有轻微磨损。");
  await expect(page.locator(".studio-release-result")).toBeHidden();
  await page
    .getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布")
    .check();
  await page.getByRole("button", { name: "生成发布资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "资料已就绪" })).toBeVisible();
});

test("供应商持有的包袋在本页补供货确认，不要求调货或重新拍摄", async ({
  page,
}) => {
  await start(page);
  await basic(page, "供应商包袋工作区 " + randomUUID());
  await page.getByLabel("品类", { exact: true }).selectOption("BAG");
  await page
    .getByLabel("本批图片来源", { exact: true })
    .selectOption("SUPPLIER");
  await page.getByText("货源与实物", { exact: true }).click();
  await page.getByLabel("实物持有", { exact: true }).selectOption("SUPPLIER");
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("[data-studio-fix=supply]")).toBeVisible();
  const url = page.url();
  await page.locator("[data-studio-fix=supply]").click();
  await page.getByRole("button", { name: "确认当前供货", exact: true }).click();
  await page
    .locator("#dialog")
    .getByLabel("确认依据", { exact: true })
    .fill("合成供应商库存确认记录");
  await page.getByLabel("已向供货方确认该商品当前有货").check();
  await page.getByRole("button", { name: "保存供货确认", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator(".studio-missing")).toContainText("资料已齐");
  expect(page.url()).toBe(url);
  await page
    .getByLabel("供应商图片授权依据", { exact: true })
    .fill("合成供应商授权此批图片用于本商品展示");
  await page
    .getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布")
    .check();
  await page.getByRole("button", { name: "生成发布资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "资料已就绪" })).toBeVisible();
  const id = page.url().match(/items\/([a-f0-9-]+)\/edit/)[1],
    i = await (await page.request.get("/api/items/" + id)).json();
  expect(i.ownership).toBe("SUPPLIER");
  expect(i.assets).toHaveLength(1);
  expect(i.offers[0].canReserve).toBe(false);
  expect(i.movements).toHaveLength(0);
});
test("渠道切换先保存各自文案，返回原账号不丢内容不串号", async ({ page }) => {
  await start(page);
  await basic(page, "两渠道独立文案 " + randomUUID());
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  const first = await page.getByLabel("发布目标账号").inputValue();
  const second = await api(page, "/channels", {
    name: "独立第二渠道 " + randomUUID(),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
  });
  await page
    .getByRole("button", { name: "保存商品并重新检查", exact: true })
    .click();
  await page.getByLabel("发布正文", { exact: true }).fill("第一账号独立文案");
  await page.getByLabel("发布目标账号").selectOption(second.id);
  await expect(page.getByLabel("发布目标账号")).toHaveValue(second.id);
  await expect(page.getByLabel("发布正文", { exact: true })).not.toHaveValue(
    "第一账号独立文案",
  );
  await page.getByLabel("发布正文", { exact: true }).fill("第二账号独立文案");
  await page.getByLabel("发布目标账号").selectOption(first);
  await expect(page.getByLabel("发布正文", { exact: true })).toHaveValue(
    "第一账号独立文案",
  );
});
test("在工作区标记售出后停止旧资料取用，不离开或清空未保存输入", async ({
  page,
}) => {
  await start(page);
  await basic(page, "即时售出 " + randomUUID());
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  await page
    .getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布")
    .check();
  await page.getByRole("button", { name: "生成发布资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "资料已就绪" })).toBeVisible();
  const id = page.url().match(/items\/([a-f0-9-]+)\/edit/)[1],
    i = await (await page.request.get("/api/items/" + id)).json(),
    pack = i.packages[0];
  await page.getByLabel("中文介绍", { exact: true }).fill("尚未保存的内部补充");
  await stockMore(page);
  await page.getByRole("button", { name: "标记售出", exact: true }).click();
  await page.getByRole("button", { name: "确认已售出", exact: true }).click();
  await expect(page.locator(".studio-stock-badge")).toContainText("我方已售");
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "尚未保存的内部补充",
  );
  expect(
    (await page.request.get("/api/packages/" + pack.id + "/usable")).ok(),
  ).toBe(false);
});

test("点击可见上传区域就打开文件选择器，不需要寻找隐藏的素材入口", async ({
  page,
}) => {
  await start(page);
  await page
    .getByLabel("商品名称", { exact: true })
    .fill("实际点击上传 " + randomUUID());
  const picking = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "点击或拖入商品图片", exact: true })
    .click();
  const file = await photograph("clicked.png");
  await (await picking).setFiles(file);
  await expect(page.locator(".entry-file")).toHaveCount(1);
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.locator(".studio-photo")).toHaveCount(1);
});
test("服务端发现同平台历史暴露时可二次确认加入上架渠道", async ({ page }) => {
  await start(page);
  await basic(page, "服务端经营确认 " + randomUUID());
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "加入此分发渠道", exact: true }),
  ).toBeVisible();

  let posts = 0;
  await page.route("**/api/items/*/distribution-targets/*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() || "{}");
    posts += 1;
    if (posts === 1) {
      expect(body.duplicatePlatformConfirmed).toBe(false);
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "DUPLICATE_PLATFORM_TARGET_CONFIRMATION_REQUIRED",
            message: "该商品在同平台仍有历史在线暴露，需要明确确认",
          },
        }),
      });
      return;
    }
    expect(body.duplicatePlatformConfirmed).toBe(true);
    await route.continue();
  });

  let confirmation = "";
  page.once("dialog", (dialog) => {
    confirmation = dialog.message();
    void dialog.accept();
  });
  await page
    .getByRole("button", { name: "加入此分发渠道", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "加入此分发渠道", exact: true }),
  ).toHaveCount(0);
  expect(posts).toBe(2);
  expect(confirmation).toContain("仍在线记录");
});

test("登记已发布使用本页回执，不跳转或重载工作区", async ({ page }) => {
  await start(page);
  await basic(page, "本页发布回执 " + randomUUID());
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "加入此分发渠道", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "加入此分发渠道", exact: true })
    .click();
  await page
    .getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布")
    .check();
  await page.getByRole("button", { name: "生成发布资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "资料已就绪" })).toBeVisible();
  const current = page.url();
  await page.getByLabel("中文介绍", { exact: true }).fill("不会丢掉的本地备注");
  await page.getByRole("button", { name: "保存商品", exact: true }).click();
  await page
    .getByRole("button", { name: "保存商品并重新检查", exact: true })
    .click();
  await page
    .getByLabel("我已核对商品信息、瑕疵和图片，确认可用于本次发布")
    .check();
  await page.getByRole("button", { name: "生成发布资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "资料已就绪" })).toBeVisible();
  await page.getByRole("button", { name: "登记已发布", exact: true }).click();
  await page
    .getByLabel("平台商品链接（可稍后补充）")
    .fill("https://example.com/synthetic-studio-" + randomUUID());
  await page.getByRole("button", { name: "记录发布结果", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator(".studio-publish-feedback")).toContainText(
    "已记录人工发布执行结果",
  );
  await expect(page.getByLabel("中文介绍", { exact: true })).toHaveValue(
    "不会丢掉的本地备注",
  );
  expect(page.url()).toBe(current);
  expect(await page.evaluate(() => window.studioSession)).toBe("same-document");
});
test("保存并返回同时保留当前渠道的未保存文案，不会悄悄丢弃", async ({
  page,
}) => {
  await start(page);
  await basic(page, "离开前保存 " + randomUUID());
  await tradeFacts(page);
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  const id = page.url().match(/items\/([a-f0-9-]+)\/edit/)[1],
    channelId = await page.getByLabel("发布目标账号").inputValue();
  await page
    .getByLabel("发布正文", { exact: true })
    .fill("离开前必须保存的渠道文案");
  await productMore(page);
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "商品", exact: true }),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/items/${id}/studio?channelId=${channelId}`)
      ).json()
    ).draft.body,
  ).toBe("离开前必须保存的渠道文案");
});

test("未改过的预览在补齐尺寸后直接更新，不再要求手工重填一遍", async ({
  page,
}) => {
  await start(page);
  await basic(page, "自动预览更新 " + randomUUID());
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  await page.locator("[data-studio-fix=measurements]").click();
  await page.getByLabel("实测尺寸").fill("宽39厘米、长度66厘米");
  await page.getByLabel("尺寸来源").fill("已确认的供应商尺寸说明");
  await page
    .getByRole("button", { name: "保存商品并重新检查", exact: true })
    .click();
  await expect(page.getByLabel("发布正文", { exact: true })).toContainText(
    "宽39厘米、长度66厘米",
  );
});
test("读取发布预览失败可原地重试，已经保存的商品和图片不会消失", async ({
  page,
}) => {
  await start(page);
  const name = "发布读取重试 " + randomUUID();
  await basic(page, name);
  let first = true;
  await page.route("**/api/items/*/studio?*", async (r) => {
    if (first) {
      first = false;
      await r.abort("failed");
    } else await r.continue();
  });
  await revealPublishing(page);
  await page
    .getByRole("button", { name: "保存并准备上架", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "重新读取发布信息", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".studio-photo")).toHaveCount(1);
  await page
    .getByRole("button", { name: "重新读取发布信息", exact: true })
    .click();
  await expect(page.locator("#studio-publish-form")).toBeVisible();
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(name);
});

test.describe("触摸设备的发布排序", () => {
  test.use({ hasTouch: true });
  test("发布图片可拖动键盘及手机指定位置，排序只改发布草稿", async ({
    page,
  }) => {
    await start(page);
    await basic(page, "发布排序 " + randomUUID());
    await page
      .getByLabel("选择商品图片", { exact: true })
      .setInputFiles(await photograph("order-b.png"));
    await tradeFacts(page);
    await revealPublishing(page);
    await page
      .getByRole("button", { name: "保存并准备上架", exact: true })
      .click();
    await expect(page.locator(".studio-order-row")).toHaveCount(2);
    const id = page.url().match(/items\/([a-f0-9-]+)\/edit/)[1];
    const before = await (await page.request.get("/api/items/" + id)).json();
    const ids = await page
      .locator(".studio-order-row")
      .evaluateAll((rows) => rows.map((row) => row.dataset.orderId));
    await page
      .locator(".studio-order-row")
      .last()
      .dragTo(page.locator(".studio-order-row").first());
    await expect(page.locator(".studio-order-row").first()).toHaveAttribute(
      "data-order-id",
      ids[1],
    );
    const up = page
      .locator(".studio-order-row")
      .last()
      .getByRole("button", { name: /^上移/ });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".studio-order-row").first()).toHaveAttribute(
      "data-order-id",
      ids[0],
    );
    await expect
      .poll(() =>
        page
          .locator(".studio-order-row")
          .first()
          .locator("select")
          .evaluate((el) => el === document.activeElement),
      )
      .toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator(".studio-order-row")
      .first()
      .locator("select")
      .selectOption({ value: "1" });
    await expect(page.locator(".studio-order-row").first()).toHaveAttribute(
      "data-order-id",
      ids[1],
    );
    expect(
      (
        await page
          .locator(".studio-order-row")
          .first()
          .getByRole("button", { name: /^下移/ })
          .boundingBox()
      ).height,
    ).toBeGreaterThanOrEqual(44);
    await page
      .locator(".studio-order-row")
      .first()
      .getByRole("button", { name: /^下移/ })
      .tap();
    await expect(page.locator(".studio-order-row").first()).toHaveAttribute(
      "data-order-id",
      ids[0],
    );
    await page
      .locator(".studio-order-row")
      .last()
      .getByRole("button", { name: /^上移/ })
      .tap();
    await expect(page.locator(".studio-order-row").first()).toHaveAttribute(
      "data-order-id",
      ids[1],
    );
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes("/publishing-draft") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON().assetIds).toEqual([
      ids[1],
      ids[0],
    ]);
    const after = await (await page.request.get("/api/items/" + id)).json();
    expect(after.assets.map((a) => [a.id, a.sha256, a.position])).toEqual(
      before.assets.map((a) => [a.id, a.sha256, a.position]),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(2);
    await page.screenshot({
      path: "reports/screenshots/ux102-image-order-mobile.png",
      fullPage: true,
    });
  });
});
