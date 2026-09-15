const { submitLogin } = require("./login.cjs");
const {chooseDictionary}=require("./dictionary-control.cjs");
const { test, expect } = require("@playwright/test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { dictionaryRoot } = require("./dictionary-control.cjs");
const fixture = JSON.parse(
  fs.readFileSync("data/browser-fixture.json", "utf8"),
);

async function login(page) {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill(fixture.email);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await submitLogin(page);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
}
async function entry(page) {
  await page.goto("/#/items/new");
  await expect(page.getByLabel("商品名称", { exact: true })).toBeVisible();
  await expect(page.locator("[data-dictionary][data-ready=true]")).toHaveCount(
    4,
  );
}
test.beforeEach(async ({ page }) => login(page));
test("字典控件按选项规模选择正确交互，不再一律做搜索框",async({page})=>{
  await entry(page);
  const brand=await dictionaryRoot(page,"品牌");
  await expect(brand.input).toHaveAttribute("role","combobox");
  await expect(brand.root.locator("select")).toHaveCount(0);
  await expect(brand.root.locator(".dictionary-input")).toHaveCount(1);
  const condition=await dictionaryRoot(page,"成色");
  await expect(condition.input).toHaveJSProperty("tagName","SELECT");
  await expect(condition.root.locator(".dictionary-input")).toHaveCount(0);
  await page.getByText("尺寸与材质",{exact:true}).click();
  for(const label of ["颜色","主要材质"]){
    const fixed=await dictionaryRoot(page,label);
    await expect(fixed.root.locator("select.dictionary-select")).toHaveCount(1);
    await expect(fixed.root.locator(".dictionary-input")).toHaveCount(0);
  }
});

test("品牌输入即搜索，鼠标和键盘都能完成真实选择", async ({ page }) => {
  await entry(page);
  const brand = await dictionaryRoot(page, "品牌");
  await brand.input.fill("LV");
  await expect(
    brand.root.locator("[role=option]").filter({ hasText: "Louis Vuitton" }),
  ).toBeVisible();
  await brand.root
    .locator("[role=option]")
    .filter({ hasText: "Louis Vuitton" })
    .click();
  await expect(brand.input).toHaveValue("Louis Vuitton");
  await expect(brand.root.locator("input[type=hidden]")).not.toHaveValue("");
  await brand.input.fill("Dio");
  await expect(
    brand.root.locator("[role=option]").filter({ hasText: "Dior" }),
  ).toBeVisible();
  await brand.input.press("ArrowDown");
  await brand.input.press("Enter");
  await expect(brand.input).toHaveValue("Dior");
});
test("列表筛选输入了品牌但没真正选择时明确阻止，不会静默忽略", async ({
  page,
}) => {
  await page.goto("/#/items");
  await page.getByText("更多筛选", { exact: true }).click();
  const brand = await dictionaryRoot(page, "品牌");
  await brand.input.fill("Dior");
  await expect(
    brand.root.locator("[role=option]").filter({ hasText: "Dior" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("请从建议中选择品牌");
  await expect(page).toHaveURL(/#\/items/);
});

test("新增品牌从当前输入预填，保存后回到同一个商品并自动选中", async ({
  page,
}) => {
  await entry(page);
  const title = "未保存商品 " + randomUUID();
  const label = "新品牌 " + randomUUID();
  await page.getByLabel("商品名称", { exact: true }).fill(title);
  const brand = await dictionaryRoot(page, "品牌");
  await brand.input.fill(label);
  await expect(
    brand.root.getByRole("button", { name: "新增品牌", exact: true }),
  ).toBeVisible();
  await brand.root
    .getByRole("button", { name: "新增品牌", exact: true })
    .click();
  await expect(page.locator("#dialog").getByLabel("标准名称")).toHaveValue(
    label,
  );
  await page.getByRole("button", { name: "保存选项", exact: true }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.getByLabel("商品名称", { exact: true })).toHaveValue(title);
  await expect(page.getByLabel("品牌", { exact: true })).toHaveValue(label);
});

test("已生效的字典筛选刷新后仍明确显示当前选项",async({page})=>{
  await page.goto("/#/items");await page.getByText("更多筛选",{exact:true}).click();
  await chooseDictionary(page,"品牌","LV","Louis Vuitton");
  await page.getByRole("button",{name:"搜索",exact:true}).click();
  await expect(page.getByLabel("品牌",{exact:true})).toHaveValue("Louis Vuitton");
  await page.reload();await expect(page.getByLabel("品牌",{exact:true})).toHaveValue("Louis Vuitton");
});

test("已选品牌继续输入时替换旧值而不是拼接到旧标签后面",async({page})=>{
  await page.goto("/#/items/new");await chooseDictionary(page,"品牌","LV","Louis Vuitton");
  const input=page.getByLabel("品牌",{exact:true});await input.click();await input.press("End");await input.type("Dior");
  await expect(input).toHaveValue("Dior");
  const root=input.locator("xpath=ancestor::*[@data-dictionary][1]");
  await expect(root.locator('[role="option"]')).toContainText("Dior");
  await root.getByRole("option",{name:"Dior",exact:true}).click();await expect(input).toHaveValue("Dior");
});
