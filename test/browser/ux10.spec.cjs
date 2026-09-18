const { submitLogin } = require("./login.cjs");
const {test,expect}=require('@playwright/test');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const sharp=require('sharp');
const {chooseDictionary}=require('./dictionary-control.cjs');
const fixture=JSON.parse(fs.readFileSync('data/browser-fixture.json','utf8'));
async function login(page){await page.goto('/');await page.getByLabel('登录邮箱').fill(fixture.email);await page.getByLabel('密码',{exact:true}).fill(fixture.password);await submitLogin(page);await expect(page.getByRole('button',{name:'退出登录',exact:true})).toBeVisible();}
async function photo(name='quick.png'){return{name,mimeType:'image/png',buffer:await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><rect width="500" height="600" fill="#eee"/><path d="M160 100h180l50 110-70 35-15 250H195l-15-250-70-35z" fill="#555"/></svg>')).png().toBuffer()};}
async function openQuick(page){await page.goto('/#/items');await page.getByRole('button',{name:'＋ 快速录入我方现货',exact:true}).click();const d=page.getByRole('dialog',{name:'快速录入我方现货'});await expect(d).toBeVisible();return d;}

test.beforeEach(async({page})=>login(page));
test('快速录货只暴露首次需要的字段，完整建档退到更多',async({page})=>{
 const d=await openQuick(page);for(const label of ['商品名称','品牌','品类','对外报价','币种','成色','图片来源'])await expect(d.getByLabel(label,{exact:true})).toBeVisible();
 for(const hidden of ['实测尺寸','主要材质','鉴定 / 复核依据','英文介绍'])await expect(d.getByLabel(hidden,{exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(page.getByRole('heading',{name:'快速录入我方现货'})).not.toBeVisible();await page.locator('#content').getByText('更多',{exact:true}).click();await expect(page.getByRole('link',{name:'完整建档',exact:true})).toBeVisible();
});
test('快速录入只接收我方现货，供应商和远端货源明确转到来源维护',async({page})=>{
 const d=await openQuick(page);await expect(d).toContainText('这里只录入已经实际在手的我方现货');await expect(d).toContainText('图片来源＝供应商提供');await d.getByRole('link',{name:'货源与供应商',exact:true}).click();await expect(page).toHaveURL(/#\/sources$/);
});
test('快速录货保存图片后直接下一件，上一件内容不带入',async({page})=>{
 const d=await openQuick(page);const title='快速录货A '+randomUUID().slice(0,8);await d.getByLabel('商品名称',{exact:true}).fill(title);await chooseDictionary(d,'品牌','Dior','Dior');await d.getByLabel('成色',{exact:true}).selectOption({label:'非常好 · Very good condition'});await d.getByLabel('对外报价',{exact:true}).fill('1680');await d.getByLabel('商品图片').setInputFiles(await photo());
 await page.getByRole('button',{name:'保存并下一件',exact:true}).click();const next=page.getByRole('dialog',{name:'快速录入我方现货'});await expect(next).toBeVisible();await expect(next.getByText(/上一件 TM\d+ .*已保存/)).toBeVisible();await expect(next.getByLabel('商品名称',{exact:true})).toHaveValue('');await expect(next.getByLabel('品牌',{exact:true})).toHaveValue('');await expect(next.locator('.quick-intake-previews figure')).toHaveCount(0);
 const rows=await(await page.request.get('/api/items?q='+encodeURIComponent(title))).json();expect(rows.total).toBe(1);const item=await(await page.request.get('/api/items/'+rows.rows[0].id)).json();expect(item.assets).toHaveLength(1);expect(item.currentPrice).toBe(168000);expect(item.brand).toBe('Dior');expect(item.ownership).toBe('OWN');
});

test('快速录货保存并完善，无缝进入同一件完整商品页',async({page})=>{
 const d=await openQuick(page);const title='快速录货B '+randomUUID().slice(0,8);await d.getByLabel('商品名称',{exact:true}).fill(title);await chooseDictionary(d,'品牌','LV','Louis Vuitton');await d.getByLabel('品类',{exact:true}).selectOption('BAG');await d.getByLabel('商品图片').setInputFiles(await photo('bag.png'));
 await page.getByRole('button',{name:'保存并完善',exact:true}).click();await expect(page).toHaveURL(/#\/items\/[a-f0-9-]+\/edit/);const editor=page.locator('.product-entry-form');await expect(editor.getByLabel('商品名称',{exact:true})).toHaveValue(title);await expect(editor.getByLabel('品牌',{exact:true})).toHaveValue('Louis Vuitton');await expect(page.locator('.studio-photo')).toHaveCount(1);
 const rows=await(await page.request.get('/api/items?q='+encodeURIComponent(title))).json();expect(rows.total).toBe(1);
});

test('快速录货打开即聚焦名称，Ctrl+Enter保存并进入下一件',async({page})=>{
 const d=await openQuick(page),title='键盘录货 '+randomUUID().slice(0,8);await expect(d.getByLabel('商品名称',{exact:true})).toBeFocused();await d.getByLabel('商品名称',{exact:true}).fill(title);await page.keyboard.press('Control+Enter');const next=page.getByRole('dialog',{name:'快速录入我方现货'});await expect(next.getByLabel('商品名称',{exact:true})).toHaveValue('');const rows=await(await page.request.get('/api/items?q='+encodeURIComponent(title))).json();expect(rows.total).toBe(1);
});

test('快速录货可在提交前单张移除图片，服务器只保存保留项',async({page})=>{
 const d=await openQuick(page),title='图片取舍 '+randomUUID().slice(0,8);await d.getByLabel('商品名称',{exact:true}).fill(title);await d.getByLabel('商品图片').setInputFiles([await photo('keep.png'),await photo('remove.png')]);await expect(d.locator('.quick-intake-previews figure')).toHaveCount(2);await d.getByRole('button',{name:'移除图片 remove.png',exact:true}).click();await expect(d.locator('.quick-intake-previews figure')).toHaveCount(1);await d.getByRole('button',{name:'保存并下一件',exact:true}).click();const next=page.getByRole('dialog',{name:'快速录入我方现货'});await expect(next.getByLabel('商品名称',{exact:true})).toHaveValue('');const rows=await(await page.request.get('/api/items?q='+encodeURIComponent(title))).json(),item=await(await page.request.get('/api/items/'+rows.rows[0].id)).json();expect(item.assets.map(a=>a.originalName)).toEqual(['keep.png']);
});

test('快速录货桌面与手机布局保持单一主任务，不横向溢出',async({browser,page})=>{
 const d=await openQuick(page);await page.screenshot({path:'reports/screenshots/ux10-quick-desktop.png',fullPage:true});expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);await page.keyboard.press('Escape');
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4320',viewport:{width:390,height:844},hasTouch:true});const mobile=await context.newPage();try{await login(mobile);const m=await openQuick(mobile);expect(await m.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);await expect(m.getByLabel('商品名称',{exact:true})).toBeFocused();for(const label of ['商品图片','商品名称','品牌','品类','对外报价','成色'])await expect(m.getByLabel(label,{exact:true})).toBeVisible();await expect(m.getByRole('button',{name:'保存并完善'})).toBeVisible();await expect(m.getByRole('button',{name:'保存并下一件'})).toBeVisible();await mobile.screenshot({path:'reports/screenshots/ux10-quick-mobile.png',fullPage:true});}finally{await context.close();}
});

async function api(page,path,body,method='POST'){const auth=await(await page.request.get('/api/auth/me')).json();const r=await page.request.fetch('/api'+path,{method,data:body,headers:{Origin:new URL(page.url()).origin,'X-CSRF-Token':auth.csrf,'Idempotency-Key':randomUUID()}});expect(r.ok(),await r.text()).toBeTruthy();return r.json();}

test('商品列表可快速修改常用信息，不必进入完整编辑页',async({page})=>{
 const title='快速修改 '+randomUUID().slice(0,8),created=await api(page,'/items',{title});await page.goto('/#/items?q='+encodeURIComponent(title));const row=page.locator('tbody tr').filter({hasText:title});await row.locator('.catalog-row-menu').click();await page.getByRole('button',{name:'快速修改',exact:true}).click();const d=page.getByRole('dialog',{name:new RegExp('快速修改')});await expect(d).toBeVisible();for(const label of ['商品名称','品牌','品类','对外报价','币种','成色'])await expect(d.getByLabel(label,{exact:true})).toBeVisible();for(const hidden of ['商品图片','实测尺寸','鉴定 / 复核依据'])await expect(d.getByLabel(hidden,{exact:true})).toHaveCount(0);await chooseDictionary(d,'品牌','Dior','Dior');await d.getByLabel('对外报价',{exact:true}).fill('1990');await d.getByLabel('成色',{exact:true}).selectOption({label:'良好 · Good condition'});await d.getByRole('button',{name:'保存修改',exact:true}).click();await expect(d).not.toBeVisible();const item=await(await page.request.get('/api/items/'+created.id)).json();expect(item.brand).toBe('Dior');expect(item.currentPrice).toBe(199000);expect(item.facts.conditionGrade).toBe('良好');
});

test('快速修改遇到并发变更时保留输入并阻止覆盖',async({page})=>{
 const title='快速修改冲突 '+randomUUID().slice(0,8),created=await api(page,'/items',{title});await page.goto('/#/items?q='+encodeURIComponent(title));const row=page.locator('tbody tr').filter({hasText:title});await row.locator('.catalog-row-menu').click();await page.getByRole('button',{name:'快速修改',exact:true}).click();const d=page.getByRole('dialog',{name:/快速修改/});await d.getByLabel('对外报价',{exact:true}).fill('2888');await api(page,'/items/'+created.id,{version:1,title:title+' 同事更新'},'PATCH');await d.getByRole('button',{name:'保存修改',exact:true}).click();await expect(d.locator('.form-error')).toContainText('刚被其他人修改');await expect(d.getByLabel('对外报价',{exact:true})).toHaveValue('2888');const item=await(await page.request.get('/api/items/'+created.id)).json();expect(item.currentPrice).toBeNull();expect(item.title).toContain('同事更新');
});
