const { submitLogin } = require("./login.cjs");
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const fixture=JSON.parse(fs.readFileSync('data/browser-fixture.json','utf8'));
async function login(page){
  await page.goto('/');
  await page.getByLabel('登录邮箱').fill(fixture.email);
  await page.getByLabel('密码',{exact:true}).fill(fixture.password);
  await submitLogin(page);
  await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeVisible();
}
test('低频经营页面使用统一后台语言和布局',async({page})=>{
  await login(page);
  const routes=['sources','tasks','listings','sales','inquiries','settings','audit','jobs'];
  for(const route of routes){
    await page.goto('/#/'+route);
    await expect(page.locator('#content .panel, #content .page-title').first()).toBeVisible();
    await expect(page.locator('#content')).not.toContainText('没有完成读取');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
    await page.screenshot({path:`reports/screenshots/ux09-${route}.png`,fullPage:true});
  }
});

test('设置页角色使用业务中文，技术入口默认收起',async({page})=>{
  await login(page);await page.goto('/#/settings');
  await expect(page.getByText('用户与权限',{exact:true})).toBeVisible();
  const roleCells=await page.locator('.panel').filter({hasText:'用户与权限'}).locator('tbody tr td:nth-child(3)').allTextContents();
  expect(roleCells.join(' ')).not.toMatch(/\b(?:ADMIN|OPERATOR|VIEWER|REVIEWER|FINANCE)\b/);
  await expect(page.getByText('管理员',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('日常运营',{exact:true}).first()).toBeVisible();
  const tech=page.getByText('技术维护',{exact:true});await expect(tech).toBeVisible();
  await expect(page.getByRole('link',{name:'API接口说明',exact:true})).not.toBeVisible();
});

test('成交记录每行只突出补收支，其余危险动作收进更多',async({page})=>{
  await login(page);await page.goto('/#/sales');
  await expect(page.getByRole('heading',{name:'经营账',exact:true})).toBeVisible();
  const first=page.locator('tbody tr').first();if(await first.count()){
    await expect(first.getByRole('button',{name:'补收支',exact:true})).toBeVisible();
    await expect(first.getByText('更多',{exact:true})).toBeVisible();
    await expect(first.getByRole('button',{name:'记录退款',exact:true})).not.toBeVisible();
    await first.getByText('更多',{exact:true}).click();
    await expect(first.getByRole('button',{name:'记录退款',exact:true})).toBeVisible();
  }
});
