const { revealSection } = require("./reveal-section.cjs");
// Synthetic test records only. Real pointer/keyboard actions; never force clicks.
const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);
test.use({ actionTimeout: 8000 });
async function login(page) {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.locator(".sidebar-bottom strong")).toContainText(
    "合成ADMIN",
  );
}
async function command(page, path, body) {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const r = await page.request.post("/api" + path, {
    data: body,
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(r.ok(), path + " " + r.status() + " " + (await r.text())).toBeTruthy();
  return r.json();
}
async function product(page, review = true) {
  const i = await command(page, "/items", {
    title: "交互验收 " + randomUUID().slice(0, 8),
    brand: "SYNTHETIC",
    currentPrice: 200000,
    facts: {
      condition: "合成品相，非真实商品",
      measurements: "测试40cm",
      measurementSource: "合成量测",
      descriptionZh: "合成中文介绍",
      descriptionEn: "Synthetic description",
      authentication: { status: "PASSED", evidence: "合成依据" },
    },
  });
  const auth = await (await page.request.get("/api/auth/me")).json();
  const file = await require("sharp")({
    create: { width: 80, height: 100, channels: 3, background: "#ddd" },
  })
    .png()
    .toBuffer();
  const r = await page.request.post("/api/assets/upload", {
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": auth.csrf,
      "Idempotency-Key": randomUUID(),
    },
    multipart: {
      itemId: i.id,
      role: "PRODUCT",
      origin: "OWN",
      sourceNote: "合成测试图片",
      file: { name: i.code + ".png", mimeType: "image/png", buffer: file },
    },
  });
  expect(r.ok()).toBeTruthy();
  const a = await r.json();
  if (review)
    await command(page, `/assets/${a.id}/review`, {
      rights: "PUBLIC",
      verified: true,
      sourceNote: "合成公开授权",
      validUntil: null,
      position: 0,
    });
  await command(page, `/items/${i.id}/approve`, { version: 1 });
  return { ...i, assetId: a.id };
}
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test.describe(`pointer ${viewport.width}`, () => {
    test.use({ viewport, hasTouch: viewport.width === 390 });
    test.beforeEach(async ({ page }) => {
      await login(page);
    });
    test("图库真实点击选择和批量复核可以提交", async ({ page }) => {
      const i = await product(page, false);
      await page.goto(`/#/items/${i.id}?tab=assets`);
      const box = page.getByRole("checkbox", {
        name: "选择 " + i.code + ".png",
        exact: true,
      });
      if (viewport.width === 390) await box.tap();
      else await box.click();
      await expect(box).toBeChecked();
      await expect(page.locator(".selection-tools")).toContainText("已选 1 张");
      await page.getByRole("button", { name: "批量复核所选图片" }).click();
      for (const name of [
        "以上每张图片均已与实物核对一致",
        "以上每张图片均有权用于本商品公开展示",
      ]) {
        await page.getByText(name, { exact: true }).click();
        await expect(page.getByRole("checkbox", { name })).toBeChecked();
      }
      await page
        .getByLabel("统一依据与授权说明")
        .fill("合成测试授权，已逐图核验");
      await page.getByRole("button", { name: "核对后进入批量执行" }).click();
      await page.getByRole("button", { name: "开始执行", exact: true }).click();
      await expect(page.locator("#batch-summary")).toHaveText("完成1 / 1");
      await page
        .locator("#dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await expect(page.locator("#dialog")).not.toBeVisible();
      await expect(page.locator(".photo-card")).toContainText(
        "已核验 · 可公开使用",
      );
    });
    test("渠道确认勾选后能生成发布资料", async ({ page }) => {
      const i = await product(page);
      await page.goto(`/#/items/${i.id}?tab=use`);
      const confirm = page.getByRole("checkbox", {
        name: "已核对本次文案、图片、品相及报价，确认可以使用",
      });
      if (viewport.width === 390) await confirm.tap();
      else await confirm.click();
      await expect(confirm).toBeChecked();
      await page.getByRole("button", { name: "生成可复制的发布资料" }).click();
      await expect(
        page.getByRole("button", { name: "下载JPG图片与文案" }),
      ).toBeVisible();
    });
  });
test.describe("failure journeys", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  test("原生必填缺项也显示可读错误而非没有反应", async ({ page }) => {
    await page.goto("/#/items/new");
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await expect(
      page.locator(".studio-save-feedback .form-error"),
    ).toContainText("商品名称");
    await page
      .getByLabel("商品名称", { exact: true })
      .fill("纠错后保存 " + randomUUID().slice(0, 8));
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await expect(page.locator(".entry-save-state")).toContainText("已保存");
  });
  test("渠道保存响应中断重试使用同一请求，不陷入版本冲突", async ({ page }) => {
    const i = await product(page);
    await page.goto(`/#/items/${i.id}?tab=use`);
    const keys = [];
    let lost = false;
    await page.route("**/api/items/*/publishing-draft", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("textbox", { name: "此渠道正文", exact: true })
      .fill("响应丢失测试，只写入一次");
    await page.getByRole("button", { name: "保存渠道草稿" }).click();
    await expect(page.locator(".draft-state")).toContainText("网络");
    await page.getByRole("button", { name: "保存渠道草稿" }).click();
    await expect(page.locator(".draft-state")).toContainText("草稿已保存");
    expect(keys.length).toBe(2);
    expect(keys[1]).toBe(keys[0]);
  });
  test("研究资料确认框可用文字标签勾选并保存", async ({ page }) => {
    const i = await product(page);
    await page.goto(`/#/items/${i.id}?tab=facts`);
    await page.getByRole("button", { name: "编辑商品", exact: true }).click();
    await page.getByText("鉴定与资料", { exact: true }).click();
    await page.getByRole("button", { name: "＋ 添加一条资料依据" }).click();
    await page.getByLabel("结论或线索").fill("合成款式研究");
    await page.getByLabel("来源链接或核对说明").fill("合成资料");
    await page.getByText("已人工确认此依据", { exact: true }).click();
    await expect(page.getByLabel("已人工确认此依据")).toBeChecked();
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await expect(page.locator(".entry-save-state")).toContainText("已保存");
  });
});

test.describe("edit and retry", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  test("确认后修改正文必须重新勾选，不能沿用旧确认", async ({ page }) => {
    const i = await product(page);
    await page.goto(`/#/items/${i.id}?tab=use`);
    const checkbox = page.getByRole("checkbox", {
      name: "已核对本次文案、图片、品相及报价，确认可以使用",
    });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await page
      .getByRole("textbox", { name: "此渠道正文", exact: true })
      .fill("修改后的合成文案");
    await expect(checkbox).not.toBeChecked();
    await page.getByRole("button", { name: "生成可复制的发布资料" }).click();
    await expect(page.locator(".publish-feedback")).toContainText("勾选确认");
    await checkbox.press("Space");
    await expect(checkbox).toBeChecked();
    await page.getByRole("button", { name: "生成可复制的发布资料" }).click();
    await expect(page.locator(".release-card")).toHaveCount(1);
  });
  test("生成资料响应丢失后重试不会重复生成", async ({ page }) => {
    const i = await product(page);
    await page.goto(`/#/items/${i.id}?tab=use`);
    let lost = false;
    const keys = [];
    await page.route("**/api/items/*/packages", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("checkbox", {
        name: "已核对本次文案、图片、品相及报价，确认可以使用",
      })
      .click();
    await page.getByRole("button", { name: "生成可复制的发布资料" }).click();
    await expect(page.locator(".draft-state")).toContainText("网络");
    await page
      .getByRole("button", { name: "核对上次提交", exact: true })
      .click();
    await expect(page.locator(".release-card")).toHaveCount(1);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });
});
test.describe("form recovery", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  test("登录失效后原位重新登录并保留表单内容", async ({ page }) => {
    const i = await product(page);
    await page.goto(`/#/items/${i.id}?tab=facts`);
    await page.getByRole("button", { name: "编辑商品", exact: true }).click();
    await revealSection(page, "dimensions");

    await page
      .getByLabel("材质成分 / 细节", { exact: true })
      .fill("保留的未保存材质");
    await command(page, "/auth/logout", {});
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await page
      .getByRole("button", { name: "重新登录并保留输入", exact: true })
      .click();
    await page
      .locator(".reauth-dialog")
      .getByLabel("密码", { exact: true })
      .fill(fixture.password);
    await page
      .locator(".reauth-dialog")
      .getByRole("button", { name: "恢复登录", exact: true })
      .click();
    await expect(page.locator(".reauth-dialog")).toHaveCount(0);
    await expect(
      page.getByLabel("材质成分 / 细节", { exact: true }),
    ).toHaveValue("保留的未保存材质");
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await expect(page.locator(".entry-save-state")).toContainText("已保存");
    await expect(
      page.getByLabel("材质成分 / 细节", { exact: true }),
    ).toHaveValue("保留的未保存材质");
  });
  test("上传被明确拒绝后修正来源可以重新提交", async ({ page }) => {
    const i = await product(page);
    await page.goto(`/#/items/${i.id}?tab=assets`);
    await page.getByRole("button", { name: "＋ 上传图片" }).click();
    const buffer = await require("sharp")({
      create: { width: 50, height: 60, channels: 3, background: "#ddd" },
    })
      .png()
      .toBuffer();
    await page.getByLabel("选择图片").setInputFiles({
      name: "correctable.png",
      mimeType: "image/png",
      buffer,
    });
    await page.getByLabel("来源", { exact: true }).selectOption("REFERENCE");
    await page.getByRole("button", { name: "开始上传", exact: true }).click();
    await expect(page.locator("#upload-queue")).toContainText("不能声明");
    await page.getByLabel("来源", { exact: true }).selectOption("OWN");
    await page
      .getByRole("button", { name: "重试未完成图片", exact: true })
      .click();
    await expect(page.locator("#upload-summary")).toContainText("已保存 1 / 1");
  });
});
test.describe("selection and in-flight writes", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  test("本页全选和部分选择状态一致", async ({ page }) => {
    await page.goto("/#/items");
    await page.getByLabel("选择本页", { exact: true }).click();
    const boxes = page.locator("[data-pick]");
    const count = await boxes.count();
    expect(count).toBeGreaterThan(1);
    await boxes.first().click();
    await expect(boxes.first()).not.toBeChecked();
    await expect(page.locator("#bulk-toolbar")).toContainText(
      `已选 ${count - 1} 件`,
    );
    expect(
      await page.locator("#select-page").evaluate((el) => el.indeterminate),
    ).toBe(true);
    await page.getByLabel("选择本页", { exact: true }).click();
    await expect(page.locator("#bulk-toolbar")).toContainText(
      `已选 ${count} 件`,
    );
  });
  test("双击保存只提交一次且请求期间不能修改输入", async ({ page }) => {
    const i = await product(page);
    await page.goto(`/#/items/${i.id}`);
    await page.getByRole("button", { name: "编辑商品", exact: true }).click();
    await revealSection(page, "dimensions");

    await page
      .getByLabel("材质成分 / 细节", { exact: true })
      .fill("双击保护的合成材质");
    let writes = 0;
    await page.route(`**/api/items/${i.id}`, async (route) => {
      if (route.request().method() === "PATCH") {
        writes++;
        await new Promise((r) => setTimeout(r, 700));
      }
      await route.continue();
    });
    await page
      .getByRole("button", { name: "保存商品", exact: true })
      .dblclick();
    await expect(
      page.getByLabel("材质成分 / 细节", { exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".entry-save-state")).toContainText("已保存");
    expect(writes).toBe(1);
    await expect(
      page.getByLabel("材质成分 / 细节", { exact: true }),
    ).toHaveValue("双击保护的合成材质");
  });
  test("未核验图片明确说明不可选原因并提供处理入口", async ({ page }) => {
    const i = await product(page, false);
    await page.goto(`/#/items/${i.id}?tab=use`);
    await expect(
      page.getByRole("checkbox", { name: "选择图片 " + i.code + ".png" }),
    ).toBeDisabled();
    await expect(page.locator(".choose-images")).toContainText("待复核");
    await page.getByRole("link", { name: "前往素材页核验或处理授权" }).click();
    await expect(
      page.getByRole("heading", { name: "商品图片", exact: true }),
    ).toBeVisible();
  });
});

test.describe("回执丢失后登录失效", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  async function restore(page) {
    await page
      .getByRole("button", { name: "重新登录并保留输入", exact: true })
      .click();
    await page
      .locator(".reauth-dialog")
      .getByLabel("密码", { exact: true })
      .fill(fixture.password);
    await page
      .locator(".reauth-dialog")
      .getByRole("button", { name: "恢复登录", exact: true })
      .click();
    await expect(page.locator(".reauth-dialog")).toHaveCount(0);
  }
  async function loseFirst(page, path) {
    const keys = [];
    if (path === "/assets/upload") {
      // WebKit route.fetch exposes multipart fields without file bytes. Let the
      // actual XHR reach the server intact; discard only its first success callback.
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api" + path
        )
          keys.push(request.headers()["idempotency-key"]);
      });
      await page.evaluate(() => {
        const send = XMLHttpRequest.prototype.send;
        let lost = false;
        XMLHttpRequest.prototype.send = function (body) {
          if (!lost && body instanceof FormData && body.has("file")) {
            lost = true;
            const loaded = this.onload,
              failed = this.onerror;
            this.onload = function (event) {
              if (this.status >= 200 && this.status < 300)
                failed?.call(this, new ProgressEvent("error"));
              else loaded?.call(this, event);
            };
          }
          return send.call(this, body);
        };
      });
      return keys;
    }
    await page.route("**/api" + path, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      if (keys.length === 1) {
        expect(response.ok(), await response.text()).toBeTruthy();
        return route.abort("failed");
      }
      return route.fulfill({ response });
    });
    return keys;
  }
  test("建档原请求在登录失效后仍待核对，改名不会再建一件", async ({ page }) => {
    const title = "登录恢复建档 " + randomUUID();
    await page.goto("/#/items/new");
    await page.getByLabel("商品名称", { exact: true }).fill(title);
    const keys = await loseFirst(page, "/items");
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await expect(
      page.locator(".studio-save-feedback .form-error"),
    ).toContainText("网络");
    await command(page, "/auth/logout", {});
    await page
      .getByRole("button", { name: "核对上次提交", exact: true })
      .click();
    await restore(page);
    await page.getByLabel("商品名称", { exact: true }).fill(title + " 改名");
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await expect(
      page.locator(".studio-save-feedback .form-error"),
    ).toContainText("核对上次提交");
    expect(keys).toHaveLength(2);
    await page
      .getByRole("button", { name: "核对上次提交", exact: true })
      .click();
    await expect(
      page.locator(".studio-save-feedback .form-error"),
    ).toContainText("上次提交已核对");
    await page.getByRole("button", { name: "保存商品", exact: true }).click();
    await expect(page.locator(".entry-save-state")).toContainText("已保存");
    const rows = await (
      await page.request.get("/api/items?q=" + encodeURIComponent(title))
    ).json();
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].title).toBe(title + " 改名");
    expect(new Set(keys).size).toBe(1);
  });
  test("询盘回执丢失再登录失效，修改输入仍不能重复提交", async ({ page }) => {
    const i = await product(page);
    await page.goto(`/#/items/${i.id}`);
    await page.getByRole("button", { name: "记录询盘", exact: true }).click();
    const d = page.locator("#dialog"),
      customer = "恢复询盘 " + randomUUID();
    await d.getByLabel("渠道", { exact: true }).selectOption("OTHER");
    await d
      .getByLabel("其他渠道名称（仅选择“其他渠道”时填写）", { exact: true })
      .fill("合成渠道");
    await d.getByLabel("客户内部标记", { exact: true }).fill(customer);
    const keys = await loseFirst(page, "/inquiries");
    await d.getByRole("button", { name: "保存询盘", exact: true }).click();
    await expect(d.locator(".form-feedback .form-error")).toContainText("网络");
    await command(page, "/auth/logout", {});
    await d.getByRole("button", { name: "保存询盘", exact: true }).click();
    await restore(page);
    await d
      .getByLabel("客户内部标记", { exact: true })
      .fill(customer + " 改名");
    await d.getByRole("button", { name: "保存询盘", exact: true }).click();
    await expect(d.locator(".form-feedback .form-error")).toContainText(
      "上次提交结果待确认",
    );
    expect(keys).toHaveLength(2);
    await d.getByLabel("客户内部标记", { exact: true }).fill(customer);
    await d.getByRole("button", { name: "保存询盘", exact: true }).click();
    await expect(d).not.toBeVisible();
    const rows = await (
      await page.request.get("/api/inquiries?itemId=" + i.id)
    ).json();
    expect(rows).toHaveLength(1);
    expect(new Set(keys).size).toBe(1);
  });
  for (const mode of ["完整录货", "图片弹窗"])
    test(`${mode}上传回执丢失再登录失效，恢复后保留原图和来源且不重复`, async ({
      page,
    }) => {
      const i = await product(page),
        name = "auth-original-" + randomUUID() + ".png";
      const buffer = await require("sharp")({
        create: { width: 1500, height: 1900, channels: 3, background: "#abc" },
      })
        .png()
        .toBuffer();
      await page.goto(
        mode === "完整录货"
          ? `/#/items/${i.id}/edit`
          : `/#/items/${i.id}?tab=assets`,
      );
      if (mode === "图片弹窗")
        await page
          .getByRole("button", { name: "＋ 上传图片", exact: true })
          .click();
      await page
        .getByLabel(mode === "完整录货" ? "选择商品图片" : "选择图片", {
          exact: true,
        })
        .setInputFiles({ name, mimeType: "image/png", buffer });
      const keys = await loseFirst(page, "/assets/upload");
      const save = () =>
        page
          .getByRole("button", {
            name:
              mode === "完整录货"
                ? "保存商品"
                : keys.length
                  ? "重试未完成图片"
                  : "开始上传",
            exact: true,
          })
          .click();
      const firstUpload = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/assets/upload" &&
          r.request().method() === "POST",
      );
      await save();
      expect((await firstUpload).ok()).toBeTruthy();
      const queue = page.locator(
        mode === "完整录货" ? ".entry-file-list" : "#upload-queue",
      );
      await expect(queue).toContainText("结果待确认");
      await command(page, "/auth/logout", {});
      await save();
      await restore(page);
      await page
        .getByLabel(mode === "完整录货" ? "本批图片来源" : "来源", {
          exact: true,
        })
        .selectOption("SUPPLIER");
      await save();
      await expect(
        page.locator(
          mode === "完整录货" ? ".entry-save-state" : "#upload-summary",
        ),
      ).toContainText(mode === "完整录货" ? "已保存" : "已保存 1 / 1");
      const item = await (await page.request.get("/api/items/" + i.id)).json();
      const assets = item.assets.filter((a) => a.originalName === name);
      expect(assets).toHaveLength(1);
      expect(assets[0].origin).toBe("OWN");
      expect(assets[0].sha256).toBe(
        require("node:crypto")
          .createHash("sha256")
          .update(buffer)
          .digest("hex"),
      );
      expect(keys).toHaveLength(3);
      expect(new Set(keys).size).toBe(1);
    });
});