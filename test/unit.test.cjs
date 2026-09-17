const { test } = require("node:test");
const assert = require("node:assert/strict");
const d = require("../dist/common/domain");
const { hash } = require("../dist/common/transaction");
const {
  permission,
  passwordHash,
  passwordMatches,
} = require("../dist/auth/auth");
const { guardDatabase } = require("../scripts/db-test-guard.cjs");
const { netPayment, creditValue } = require("../dist/costing/costing.logic");
const {
  anqicmsSpikeProtocol,
  buildAnqicmsSpikePayload,
  buildAnqicmsTakedownProjection,
  normalizeAnqicmsReceipt,
} = require("../dist/distribution/anqicms-spike");
const anqicmsSpikeFixtures = require("./fixtures/anqicms-spike/deidentified-20.json");
test("现金与Credit支付退款同值，净额只扣一次且允许全额退回", () => {
  assert.equal(netPayment({ cashPaid: 30000, creditUsed: 10000, cashRefunded: 0, creditRefunded: 5000 }), 35000);
  assert.equal(netPayment({ cashPaid: 30000, creditUsed: 10000, cashRefunded: 5000, creditRefunded: 0 }), 35000);
  assert.equal(netPayment({ cashPaid: 30000, creditUsed: 10000, cashRefunded: 0, creditRefunded: 40000 }), 0);
  assert.throws(() => netPayment({ cashPaid: 0, creditUsed: 100, cashRefunded: 0, creditRefunded: 101 }));
  assert.throws(() => netPayment({ cashPaid: -1, creditUsed: 100, cashRefunded: 0, creditRefunded: 0 }));
  assert.equal(creditValue([-10000, 5000], true), 10000);
  assert.equal(creditValue([-10000, 5000], false), 0);
});
test("TM号稳定且六位耗尽后自然增长", () => {
  assert.equal(d.tm(1), "TM000001");
  assert.equal(d.tm(999999), "TM999999");
  assert.equal(d.tm(1000000), "TM1000000");
  assert.throws(() => d.tm(0));
});
test("标题保留完整TM号且不重复附加", () => {
  const s = d.titleWithCode("很长的中古夹克介绍", "TM000001", 12);
  assert.equal(Array.from(s).length, 12);
  assert.ok(s.endsWith(" TM000001"));
  assert.equal(d.titleWithCode("包 TM000001", "TM000001", 30), "包 TM000001");
  assert.throws(() => d.titleWithCode("包", "TM000001", 8));
});
test("金额小数转换没有浮点累计误差", () => {
  assert.equal(d.parseMoney("19.99"), 1999);
  assert.equal(d.parseMoney("0.10"), 10);
  assert.throws(() => d.parseMoney("1.999"));
  assert.throws(() => d.parseMoney("-1"));
  assert.throws(() => d.parseMoney("Infinity"));
});
test("首次900，全退-100，再售720，累计620", () => {
  const sale = {
    amount: 200000,
    cost: 100000,
    fees: 10000,
    refunded: 0,
    returned: false,
    paid: true,
    cooperation: "INCLUDED",
  };
  assert.equal(d.contribution(sale).value, 90000);
  assert.equal(
    d.contribution({ ...sale, refunded: 200000, returned: true }).value,
    -10000,
  );
  const next = d.contribution({ ...sale, amount: 180000, fees: 8000 }).value;
  assert.equal(next, 72000);
  assert.equal(next - 10000, 62000);
});
test("部分退款不恢复成本", () =>
  assert.equal(
    d.contribution({
      amount: 200000,
      cost: 100000,
      fees: 10000,
      refunded: 20000,
      returned: false,
      paid: true,
      cooperation: "INCLUDED",
    }).value,
    70000,
  ));
test("未知成本不当作0，例外整笔排除", () => {
  const s = {
    amount: 10000,
    cost: null,
    fees: 0,
    refunded: 0,
    returned: false,
    paid: true,
    cooperation: "INCLUDED",
  };
  assert.equal(d.contribution(s).state, "PENDING");
  assert.equal(d.contribution({ ...s, cooperation: "EXCLUDED" }).value, null);
  assert.equal(
    d.contribution({ ...s, cost: 0, cooperation: "PENDING_REVIEW" }).state,
    "PENDING",
  );
});
test("素材必须实物、公开、核验且未过期", () => {
  const a = {
    rights: "PUBLIC",
    verified: true,
    validUntil: null,
    role: "PRODUCT",
    origin: "OWN",
  };
  assert.ok(d.assetUsable(a));
  for (const patch of [
    { rights: "INTERNAL" },
    { verified: false },
    { role: "AI_MARKETING" },
    { origin: "AI" },
    { validUntil: new Date(1) },
  ])
    assert.equal(d.assetUsable({ ...a, ...patch }), false);
});
const complete = () => ({
  title: "样本",
  brand: "品牌",
  category: "BAG",
  facts: d.factsSchema.parse({
    condition: "轻微磨损",
    measurements: "20cm",
    measurementSource: "供应商原始量尺图",
    descriptionZh: "如实介绍",
    authentication: { status: "PASSED", evidence: "逐件检查记录" },
  }),
  assetCount: 1,
  english: false,
  trade: true,
  offerValid: true,
  ownership: "SUPPLIER",
  price: 10000,
  status: "AVAILABLE",
});
test("供应商资料齐全时不派生拍摄测量任务", () =>
  assert.deepEqual(d.requirements(complete()), []));
test("只缺英文只生成英文缺项", () =>
  assert.deepEqual(
    d.requirements({ ...complete(), english: true }).map((x) => x.code),
    ["english"],
  ));
test("供货失效只标明供货缺项，不能略过", () =>
  assert.ok(
    d
      .requirements({ ...complete(), offerValid: false })
      .some((x) => x.code === "supply"),
  ));
test("客户资料卡不强制交易鉴定价格条件", () =>
  assert.deepEqual(
    d.requirements({
      ...complete(),
      trade: false,
      price: null,
      facts: {
        ...complete().facts,
        authentication: { status: "UNKNOWN", evidence: "" },
      },
    }),
    [],
  ));
test("字段校验不接受未声明任意结构", () => {
  assert.throws(() => d.factsSchema.parse({ secret: 1 }));
  assert.throws(() =>
    d.factsSchema.parse({ attributes: { x: { arbitrary: true } } }),
  );
});
test("请求摘要与字段顺序无关，但正文变化不同", () => {
  assert.equal(hash({ x: 1, y: 2 }), hash({ y: 2, x: 1 }));
  assert.notEqual(hash({ x: 1 }), hash({ x: 2 }));
});
test("运营不具财务/复核权限，只读不能写", () => {
  assert.equal(permission("OPERATOR", "finance"), false);
  assert.equal(permission("OPERATOR", "review"), false);
  assert.equal(permission("VIEWER", "edit"), false);
  assert.equal(permission("ADMIN", "finance"), true);
});
test("密码带随机盐，原文不保存，错误密码失败", () => {
  const a = passwordHash("Long-pass-for-tests!");
  assert.notEqual(a, passwordHash("Long-pass-for-tests!"));
  assert.ok(passwordMatches("Long-pass-for-tests!", a));
  assert.equal(passwordMatches("bad", a), false);
});
test("数据库破坏性测试只允许本地专用test库", () => {
  assert.ok(guardDatabase("postgresql://user:pw@127.0.0.1:55438/tome_test"));
  for (const url of [
    "postgresql://u:p@127.0.0.1/tome_dev",
    "postgresql://u:p@prod.example.com/tome_test",
    "postgresql://u:p@127.0.0.1/srvf",
  ])
    assert.throws(() => guardDatabase(url));
});

test("运行版本必须与交付包版本一致，不能沿用旧硬编码", () => {
  const { APP_VERSION } = require("../dist/version.js");
  const manifest = require("../package.json");
  assert.equal(APP_VERSION, manifest.version);
});

test('采集检查区分来源缺项、漏传文件和未核验，不能用空字段冒充完整', () => {
  const {inspectCapture,captureEvidence}=require('../dist/ingest/ingest-integrity');
  const sha='a'.repeat(64), capture={pageUrl:'https://example.invalid/item',capturedAt:'2026-09-14T00:00:00.000Z',fields:[{path:'titleRaw',label:'名称',status:'CAPTURED',reason:''}],images:[{sourceUrl:'https://example.invalid/1.png',sha256:sha,width:1500,height:2000,quality:'ORIGINAL',reason:''}]};
  assert.equal(inspectCapture({sourceFacts:{}},[]).state,'UNVERIFIED');
  assert.equal(inspectCapture({titleRaw:'',sourceFacts:{capture}},[{sha256:sha}]).state,'GAPS');
  assert.ok(inspectCapture({titleRaw:'衣服',sourceFacts:{capture}},[]).blockers.length);
  assert.ok(inspectCapture({titleRaw:'衣服',sourceFacts:{capture}},[{sha256:sha,width:500,height:700}]).blockers.length);
  assert.equal(inspectCapture({titleRaw:'衣服',sourceFacts:{capture}},[{sha256:sha,width:1500,height:2000}]).state,'COMPLETE');
  assert.equal(captureEvidence.safeParse({...capture,fields:[...capture.fields,...capture.fields]}).success,false);
  assert.equal(captureEvidence.safeParse({...capture,images:[{sourceUrl:'https://example.invalid/2.png',quality:'UNAVAILABLE'}]}).success,false);
});

test('文件型来源凭据无需伪造网址，缺少原文件或记录位置仍拒绝',()=>{
  const {captureEvidence,inspectCapture}=require('../dist/ingest/ingest-integrity');
  const evidence={fileEvidence:{name:'合成来源.csv',sha256:'a'.repeat(64),row:'第2行'},capturedAt:'2026-09-15T00:00:00.000Z',fields:[{path:'titleRaw',label:'名称',status:'CAPTURED'}],images:[{sourceFile:'原图.png',sha256:'b'.repeat(64),width:1500,height:2000,quality:'ORIGINAL'}]};
  assert.equal(captureEvidence.safeParse(evidence).success,true);
  assert.equal(captureEvidence.safeParse({...evidence,fileEvidence:{...evidence.fileEvidence,row:''}}).success,false);
  assert.equal(captureEvidence.safeParse({...evidence,pageUrl:'https://example.invalid/product'}).success,false);
  const check=inspectCapture({titleRaw:'合成外套',sourceFacts:{capture:evidence}},[]);assert.match(check.blockers.join(),/原文件尚未保存/);
});

const anqicmsInput = (row, action, listing = null) => ({
  action,
  item: {
    tmCode: row.tmCode,
    title: "Deidentified " + row.category + " " + row.tmCode,
    body: "Local-only AnQiCMS handoff fixture. " + row.condition,
    price: row.price,
    currency: "USD",
    status: row.status,
    brand: row.brand,
    category: row.category,
    conditionGrade: "VERY_GOOD",
    conditionDescription: row.condition,
    size: "One size",
    color: "Neutral",
    material: "Synthetic material note",
    measurements: "20 × 12 × 8 cm",
    year: "2022",
    collection: "Local contract set",
    styleNumber: row.case,
  },
  images: Array.from({ length: row.imageCount }, (_, position) => ({
    id: row.case + "-image-" + (position + 1),
    role: position === row.imageCount - 1 && row.imageCount > 9 ? "DEFECT" : "PRODUCT",
    position,
    download: "/local-spike/" + row.case + "/" + (position + 1),
  })),
  listing,
});

test("AnQiCMS 标准交付合同：20件脱敏商品冻结 USD、图片、库存、SEO 与售出页", () => {
  const rows = anqicmsSpikeFixtures.items;
  assert.equal(anqicmsSpikeFixtures.protocol, anqicmsSpikeProtocol);
  assert.equal(rows.length, 20);
  let overflowCases = 0;
  for (const row of rows) {
    const available = row.status === "AVAILABLE";
    const payload = available
      ? buildAnqicmsSpikePayload(anqicmsInput(row, "PUBLISH"))
      : buildAnqicmsTakedownProjection({
          action: "DELIST",
          item: { tmCode: row.tmCode, status: row.status },
          listing: {
            archiveId: "archive-" + row.case.toLowerCase(),
            url: "https://example.invalid/archive",
          },
        });
    assert.equal(payload.protocol, anqicmsSpikeProtocol);
    assert.equal(payload.identity.tm_code, row.tmCode);
    assert.equal(JSON.stringify(payload).includes("cost"), false);
    assert.equal(JSON.stringify(payload).includes("supplier"), false);
    if (!available) {
      assert.equal(payload.operation, "STOCK_ZERO");
      assert.equal(payload.fields.stock, 0);
      assert.equal(payload.page.retain, true);
      continue;
    }
    assert.equal(payload.operation, "LOOKUP_THEN_CREATE");
    assert.equal(payload.fields.currency, "USD");
    assert.equal(payload.fields.stock, 1);
    assert.equal(payload.fields.custom.tm_code, row.tmCode);
    assert.equal(payload.fields.custom.condition_grade, "VERY_GOOD");
    assert.equal(payload.fields.custom.condition_description, row.condition);
    assert.equal(payload.fields.custom.styleNumber, row.case);
    assert.equal("condition" in payload.fields.custom, false);
    assert.equal("style_number" in payload.fields.custom, false);
    assert.ok(payload.fields.content.includes(row.condition));
    assert.ok(payload.fields.images.length <= 9);
    assert.equal(
      payload.fields.images.length + payload.fields.contentImages.length,
      row.imageCount,
    );
    if (row.imageCount > 9) {
      overflowCases += 1;
      assert.ok(payload.fields.contentImages.some((image) => image.role === "DEFECT"));
    }
  }
  assert.ok(overflowCases >= 5);
});

test("AnQiCMS 标准交付合同：archive ID 复用更新，回执规范化并拒绝伪远端身份", () => {
  const row = anqicmsSpikeFixtures.items[0];
  const update = buildAnqicmsSpikePayload(
    anqicmsInput(row, "UPDATE", {
      archiveId: "archive-verified-990001",
      url: "https://example.invalid/products/archive-verified-990001",
    }),
  );
  assert.equal(update.operation, "UPDATE");
  assert.equal(update.identity.archive_id, "archive-verified-990001");
  assert.equal("lookup" in update, false);
  const result = normalizeAnqicmsReceipt(
    {
      archive_id: "archive-verified-990001",
      url: "https://example.invalid/products/archive-verified-990001",
      ignored_external_field: "local mock only",
    },
    row.tmCode,
  );
  assert.equal(result.remoteId, "archive-verified-990001");
  assert.equal(result.evidence.locator, "tm_code=" + row.tmCode);
  assert.throws(() =>
    normalizeAnqicmsReceipt({ archive_id: "MANUAL:TM990001" }, row.tmCode),
  );
  assert.throws(() =>
    buildAnqicmsTakedownProjection({
      action: "DELIST",
      item: { tmCode: row.tmCode, status: "SOLD" },
      listing: null,
    }),
  );
});

test("styleNumber 统一新写入，旧 style_number 只作兼容读取", () => {
  const canonical = d.factsSchema.parse({
    attributes: { styleNumber: "NEW-STYLE", style_number: "OLD-STYLE" },
    attributeLabels: { styleNumber: "款号", style_number: "旧款号" },
  });
  assert.deepEqual(canonical.attributes, { styleNumber: "NEW-STYLE" });
  assert.deepEqual(canonical.attributeLabels, { styleNumber: "款号" });
  const legacy = d.factsSchema.parse({
    attributes: { style_number: "OLD-STYLE" },
    attributeLabels: { style_number: "旧款号" },
  });
  assert.deepEqual(legacy.attributes, { styleNumber: "OLD-STYLE" });
  assert.deepEqual(legacy.attributeLabels, { styleNumber: "旧款号" });
});
