/* Real HTTP + PostgreSQL tests. Only tome_test on localhost may be reset. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
require("dotenv").config({ quiet: true });
const { guardDatabase } = require("../scripts/db-test-guard.cjs");
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/tome_test";
guardDatabase(url.toString());
process.env.DATABASE_URL = url.toString();
process.env.APP_ENV = "test";
process.env.APP_ORIGIN = "http://127.0.0.1:4320";
process.env.PORT = "4320";
process.env.MEDIA_DIR = "./data/test-media";
process.env.COOKIE_SECURE = "false";
process.env.EXTERNAL_EFFECTS_ENABLED = "false";
// Legacy claim/lease coverage stays explicit in this isolated suite. Product
// defaults keep that compatibility runtime off.
process.env.DISTRIBUTION_COMPAT_RUNTIME_ENABLED = "true";
process.env.DISTRIBUTION_HANDOFF_STALE_HOURS = "24";
const { PrismaClient } = require("@prisma/client");
const { createApp } = require("../dist/bootstrap");
const { passwordHash } = require("../dist/auth/auth");
const { WorkerService } = require("../dist/jobs/worker.service");
const { PublishingService } = require("../dist/publishing/publishing.service");
const { PublicationHealthService } = require("../dist/distribution/publication-health.service");
const { contribution } = require("../dist/common/domain");
const sharp = require("sharp");
const db = new PrismaClient();
let app, worker, admin, operator, viewer, channel, showChannel, supplier;
const origin = process.env.APP_ORIGIN;
const future = () => new Date(Date.now() + 86400000).toISOString();
async function api(
  path,
  method = "GET",
  body,
  who = admin,
  key = randomUUID(),
  extra = {},
) {
  const headers = {
    Origin: origin,
    ...(who ? { Cookie: who.cookie, "X-CSRF-Token": who.csrf } : {}),
    "Idempotency-Key": key,
    ...extra,
  };
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const r = await fetch(origin + "/api" + path, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const out = {
    status: r.status,
    headers: r.headers,
    data: await r.json().catch(() => null),
  };
  return out;
}
async function ok(path, method = "GET", body, who = admin, key) {
  const r = await api(path, method, body, who, key);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${method} ${path} ${r.status}: ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
async function login(email, password) {
  const r = await api("/auth/login", "POST", { email, password }, null);
  assert.equal(r.status, 201);
  return {
    ...r.data.user,
    csrf: r.data.csrf,
    cookie: r.headers.get("set-cookie").split(";")[0],
  };
}
// Production sweep intentionally handles at most 25 rows. Walk a full cycle rather than assuming a random UUID is in the first page.
async function sweepAllItems() {
  const limit = 2 * Math.ceil((await db.item.count()) / 25) + 6;
  let wraps = 0;
  for (let n = 0; n < limit; n++) {
    await worker.sweep();
    const state = await db.sweepLease.findUnique({ where: { id: "expiry" } });
    if (!state?.cursor && ++wraps === 2) return;
  }
  assert.fail("Bounded sweep did not complete two cursor cycles");
}
async function sparse(extra = {}) {
  return ok("/items", "POST", {
    title: "合成测试 " + randomUUID().slice(0, 8),
    ...extra,
  });
}
async function item(id) {
  return ok("/items/" + id);
}
async function upload(id, extra = {}) {
  const fd = new FormData();
  fd.set("itemId", id);
  fd.set("role", "PRODUCT");
  fd.set("origin", "OWN");
  fd.set("sourceNote", "合成测试图，不代表真实商品");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  fd.set(
    "file",
    new Blob(
      [
        await sharp({
          create: {
            width: 64,
            height: 80,
            channels: 3,
            background: { r: 210, g: 220, b: 215 },
          },
        })
          .png()
          .toBuffer(),
      ],
      { type: "image/png" },
    ),
    "synthetic.png",
  );
  return ok("/assets/upload", "POST", fd);
}
async function assetReview(id, patch = {}) {
  return ok(`/assets/${id}/review`, "POST", {
    rights: "PUBLIC",
    verified: true,
    sourceNote: "合成样本的内部测试授权",
    validUntil: null,
    position: 0,
    ...patch,
  });
}
async function ready(extra = {}) {
  const r = await sparse({
    brand: "TEST BRAND",
    currentPrice: 200000,
    facts: {
      material: "测试羊毛",
      condition: "袖口轻微磨损",
      measurements: "肩宽40cm，衣长60cm",
      measurementSource: "合成测量记录",
      descriptionZh: "合成测试中文；明确袖口有轻微磨损。",
      descriptionEn: "Synthetic fixture, worn cuffs.",
      authentication: {
        status: "PASSED",
        evidence: "合成逐件复核记录；不是实际鉴定",
      },
    },
    ...extra,
  });
  const a = await upload(r.id);
  await assetReview(a.id);
  await ok(`/items/${r.id}/approve`, "POST", { version: 1 });
  return { ...r, asset: a.id };
}
async function pack(id, ch = channel, purpose = "TRADE") {
  return ok(`/items/${id}/packages`, "POST", {
    channelId: ch.id,
    purpose,
    confirmed: true,
  });
}
async function listed(id, ch = channel, purpose = "TRADE") {
  const p = await pack(id, ch, purpose);
  const l = await ok("/listings", "POST", {
    packageId: p.id,
    remoteId: randomUUID(),
    url: "",
  });
  return { pack: p.id, listing: l.id };
}
async function sold(id, extra = {}) {
  return ok(`/items/${id}/sold`, "POST", {
    channel: "线下测试",
    customerRef: "客户合成标记",
    ...extra,
  });
}
async function finance(id, patch = {}) {
  const s = await db.sale.findUniqueOrThrow({ where: { id } });
  return ok(`/sales/${id}/finance`, "POST", {
    version: s.version,
    amount: 200000,
    cost: 100000,
    fees: 10000,
    currency: "CNY",
    paid: true,
    note: "合成收支测试",
    ...patch,
  });
}
async function activeCnyCost(itemId, amount) {
  const current = await db.item.findUniqueOrThrow({ where: { id: itemId } });
  return db.costEntry.create({
    data: {
      itemId,
      cycleNumber: current.cycle,
      kind: "MANUAL",
      amount,
      currency: "CNY",
      confirmed: true,
      status: "ACTIVE",
      sourceType: "TEST_FIXTURE",
      sourceRef: "",
      note: "仅用于隔离成交成本快照验证",
      createdBy: admin.id,
      occurredAt: new Date(),
    },
  });
}
before(async () => {
  await db.$connect();
  // Static table names read from this project's schema, validated before SQL interpolation.
  const tables =
    await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  for (const t of tables) assert.match(t.tablename, /^[A-Za-z][A-Za-z0-9_]*$/);
  if (tables.length)
    await db.$executeRawUnsafe(
      "TRUNCATE " +
        tables.map((t) => '"' + t.tablename + '"').join(",") +
        " RESTART IDENTITY CASCADE",
    );
  const password = "Test!" + randomBytes(18).toString("hex");
  for (const role of ["ADMIN", "OPERATOR", "VIEWER"])
    await db.user.create({
      data: {
        email: role.toLowerCase() + "@tome.test",
        name: "合成" + role,
        role,
        passwordHash: passwordHash(password),
      },
    });
  app = await createApp();
  await app.listen(4320, "127.0.0.1");
  worker = app.get(WorkerService);
  admin = await login("admin@tome.test", password);
  operator = await login("operator@tome.test", password);
  // Explicit fixture dictionary, never populated from production or unknown incoming product text.
  for (const label of [
    "TEST BRAND",
    "SYNTHETIC",
    "DEMO",
    "FIRST",
    "SUPPLIER",
    "QUEUE",
    "Diane von Furstenberg",
    "合成品牌",
    "new",
  ])
    await ok("/dictionaries", "POST", { kind: "BRAND", label, labelEn: label });
  viewer = await login("viewer@tome.test", password);
  channel = await ok("/channels", "POST", {
    name: "测试闲鱼账号",
    platform: "XIANYU",
    locale: "zh-CN",
    titleLimit: 40,
  });
  showChannel = await ok("/channels", "POST", {
    name: "合成自有展厅",
    platform: "SHOWROOM",
    locale: "en",
    titleLimit: 80,
  });
  supplier = await ok("/supply/suppliers", "POST", {
    name: "合成供应商",
    notes: "不是真实供应商",
  });
  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/browser-fixture.json",
    JSON.stringify({
      email: "admin@tome.test",
      password,
      databaseUrl: url.toString(),
    }),
    { mode: 0o600 },
  );
});
after(async () => {
  await app?.close();
  await db.$disconnect();
});
test("HTTP: unauthorized read, bad origin and missing CSRF are rejected", async () => {
  assert.equal((await api("/items", "GET", undefined, null)).status, 401);
  assert.equal(
    (
      await api("/items", "POST", { title: "bad" }, admin, randomUUID(), {
        Origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/items", "POST", { title: "bad" }, admin, randomUUID(), {
        "X-CSRF-Token": "",
      })
    ).status,
    403,
  );
  assert.equal(
    (await api("/items", "POST", { title: "bad" }, viewer)).status,
    403,
  );
  assert.equal((await api("/sales", "GET", undefined, operator)).status, 403);
});
test("TM number, default cooperation and request replay are atomic", async () => {
  const key = randomUUID(),
    b = { title: "合成唯一编号" };
  const a = await ok("/items", "POST", b, admin, key),
    r = await ok("/items", "POST", b, admin, key);
  assert.equal(a.id, r.id);
  assert.match(a.code, /^TM\d{6,}$/);
  assert.equal(await db.item.count({ where: { id: a.id } }), 1);
  assert.equal(
    (await db.cycle.findFirst({ where: { itemId: a.id } })).cooperation,
    "INCLUDED",
  );
  assert.equal(
    (await api("/items", "POST", { title: "changed" }, admin, key)).status,
    409,
  );
  assert.equal(
    (await api(`/items/${a.id}`, "PATCH", { version: 1, code: "TM999999" }))
      .status,
    400,
  );
});
test("Source preview writes nothing; raw revisions never overwrite maintained Item", async () => {
  const data = [
    {
      sourceKey: "TEST:001",
      supplierId: supplier.id,
      title: "原始衣服",
      payload: { material: "silk" },
    },
  ];
  const count = await db.source.count();
  await ok("/supply/sources/preview", "POST", data);
  assert.equal(await db.source.count(), count);
  const r = await ok("/supply/sources/import", "POST", data);
  const i = await sparse({ sourceId: r.ids[0], facts: { material: "wool" } });
  const again = await sparse({ sourceId: r.ids[0] });
  assert.equal(i.id, again.id);
  data[0].payload.material = "nylon";
  await ok("/supply/sources/import", "POST", data);
  assert.equal((await item(i.id)).facts.material, "wool");
  assert.equal(
    await db.sourceRevision.count({ where: { sourceId: r.ids[0] } }),
    2,
  );
});
test("Partial fact edits preserve unrelated values and concurrent edits conflict", async () => {
  const i = await sparse({ facts: { material: "wool", color: "black" } });
  const r = await Promise.all([
    api(`/items/${i.id}`, "PATCH", { version: 1, facts: { color: "white" } }),
    api(`/items/${i.id}`, "PATCH", { version: 1, facts: { color: "blue" } }),
  ]);
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await item(i.id)).facts.material, "wool");
  assert.equal(
    (
      await api(
        `/items/${i.id}`,
        "PATCH",
        {
          version: 2,
          facts: { authentication: { status: "PASSED", evidence: "x" } },
        },
        operator,
      )
    ).status,
    403,
  );
});
test("Real image upload preserves original bytes, role and public rights are protected", async () => {
  const i = await sparse();
  const a = await upload(i.id);
  assert.equal(
    (await db.asset.findUnique({ where: { id: a.id } })).rights,
    "INTERNAL",
  );
  const original = await fetch(`${origin}/api/assets/${a.id}/original`, {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(original.status, 200);
  assert.equal(original.headers.get("content-type").split(";")[0], "image/png");
  const document = await upload(i.id, { role: "DOCUMENT" });
  assert.equal(
    (await api(`/assets/${document.id}/original`, "GET", undefined, operator))
      .status,
    403,
  );
  assert.equal(
    (
      await api(`/assets/${document.id}/review`, "POST", {
        rights: "PUBLIC",
        verified: true,
        sourceNote: "not permitted",
      })
    ).status,
    400,
  );
  const fd = new FormData();
  fd.set("itemId", i.id);
  fd.set("file", new Blob(["<svg></svg>"], { type: "image/svg+xml" }), "x.svg");
  assert.equal((await api("/assets/upload", "POST", fd)).status, 400);
});
test("Complete supplier item needs no local photography/measurement workflow", async () => {
  const i = await ready({ ownership: "SUPPLIER", category: "BAG" });
  await ok("/supply/offers", "POST", {
    itemId: i.id,
    supplierId: supplier.id,
    amount: 150000,
    currency: "CNY",
    validUntil: future(),
    canReserve: true,
  });
  const r = await ok(
    `/items/${i.id}/readiness?channelId=${channel.id}&purpose=TRADE`,
  );
  assert.deepEqual(r.missing, []);
  await ok(`/items/${i.id}/prepare`, "POST", {
    channelId: channel.id,
    purpose: "TRADE",
  });
  assert.equal(await db.task.count({ where: { itemId: i.id } }), 0);
});
test("Preparation requirements stay live by target and never create stale PREPARE tasks", async () => {
  const i = await sparse();
  const legacy = await db.task.create({
    data: {
      itemId: i.id,
      dedupeKey: `legacy-prepare-${randomUUID()}`,
      kind: "PREPARE",
      title: "历史资料待补齐",
      status: "OPEN",
      assignee: "",
      note: "仅用于兼容审计",
    },
  });
  const evaluations = [];
  for (let n = 0; n < 2; n++)
    evaluations.push(await ok(`/items/${i.id}/prepare`, "POST", {
      channelId: channel.id,
      purpose: "TRADE",
    }));
  assert.ok(evaluations.every((row) => row.missing.includes("images")));
  const tasks = await db.task.findMany({ where: { itemId: i.id } });
  assert.deepEqual(tasks.map((task) => task.id), [legacy.id]);
  const queue = await ok(`/work-queue?scope=TASK&q=${encodeURIComponent(legacy.title)}`);
  assert.equal(queue.rows.some((row) => row.entityId === legacy.id), false);
});
test("Approved copy stays fixed while drafts change; actual critical changes revoke it", async () => {
  const i = await ready();
  const p = await pack(i.id);
  const old = await ok("/packages/" + p.id);
  let d = await item(i.id);
  await ok(`/items/${i.id}`, "PATCH", {
    version: d.version,
    facts: { descriptionZh: "修改中的草稿" },
  });
  assert.equal(
    (await ok("/packages/" + p.id)).snapshot.body,
    old.snapshot.body,
  );
  assert.equal((await item(i.id)).approvedValid, true);
  d = await item(i.id);
  await ok(`/items/${i.id}`, "PATCH", {
    version: d.version,
    facts: { material: "cotton" },
  });
  assert.equal((await item(i.id)).approvedValid, false);
  const download = await fetch(`${origin}/api/packages/${p.id}/download`, {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(download.status, 409);
});
test("Frozen package has full TM code but no supplier cost, credentials or internal identifiers", async () => {
  const i = await ready();
  const p = await pack(i.id);
  const stored = await ok("/packages/" + p.id);
  assert.ok(stored.snapshot.title.endsWith(i.code));
  for (const forbidden of [
    "cost",
    "supplier",
    "password",
    "customerRef",
    "objectKey",
  ])
    assert.equal(
      JSON.stringify(stored.snapshot).includes('"' + forbidden + '"'),
      false,
    );
  const r = await fetch(`${origin}/api/packages/${p.id}/download`, {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(r.status, 200);
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.equal(bytes[0], 80);
  assert.equal(bytes[1], 75);
});
test("Customer card cannot bypass trade checks through Listing receipt", async () => {
  const i = await ready({
    currentPrice: null,
    facts: {
      condition: "测试品相",
      measurements: "20cm",
      measurementSource: "测试依据",
      descriptionZh: "测试介绍",
    },
  });
  const p = await pack(i.id, channel, "CUSTOMER_CARD");
  assert.equal(
    (
      await api("/listings", "POST", {
        packageId: p.id,
        remoteId: "card-bypass",
      })
    ).status,
    400,
  );
});
test("Manual listing receipt is explicitly MANUAL, not API-confirmed", async () => {
  const i = await ready(),
    l = await listed(i.id);
  const record = await db.listing.findUnique({ where: { id: l.listing } });
  assert.equal(record.observed, "MANUAL_REPORTED_LIVE");
  assert.equal(record.desired, "LIVE");
});
test("Sold with incomplete finances stops inventory immediately with a real source-linked delist", async () => {
  const i = await ready(),
    l = await listed(i.id);
  await sold(i.id);
  assert.equal((await item(i.id)).status, "SOLD");
  let record = await db.listing.findUnique({ where: { id: l.listing } });
  assert.equal(record.desired, "OFFLINE");
  assert.equal(record.observed, "MANUAL_REPORTED_LIVE");
  const source = await db.distributionAttempt.findFirstOrThrow({
    where: {
      itemId: i.id,
      channelId: channel.id,
      action: { in: ["PUBLISH", "UPDATE"] },
      state: "SUCCEEDED",
    },
  });
  const stop = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${source.id}` },
  });
  assert.equal(stop.action, "DELIST");
  assert.equal(stop.sourceAttemptId, source.id);
  assert.equal(stop.state, "PENDING");
  await sweepAllItems();
  assert.equal(
    await db.task.count({ where: { listingId: l.listing, kind: "DELIST" } }),
    0,
  );
  await ok(`/distribution/attempts/${stop.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: { method: "TM_SEARCH", note: "人工实际核对的合成停售回执" },
  });
  record = await db.listing.findUnique({ where: { id: l.listing } });
  assert.equal(record.observed, "MANUAL_REPORTED_OFFLINE");
  assert.equal(
    (await db.sale.findFirst({ where: { itemId: i.id } })).amount,
    null,
  );
});
test("Unique effective reservation survives concurrent attempts", async () => {
  const i = await sparse();
  const r = await Promise.all([
    api(`/items/${i.id}/reserve`, "POST", { customerRef: "a", minutes: 20 }),
    api(
      `/items/${i.id}/reserve`,
      "POST",
      { customerRef: "b", minutes: 20 },
      operator,
    ),
  ]);
  assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
  assert.equal(
    await db.reservation.count({ where: { itemId: i.id, status: "ACTIVE" } }),
    1,
  );
  await ok(`/items/${i.id}/release`, "POST", {});
  assert.equal((await item(i.id)).status, "PAUSED");
});
test("Expired reservation does not auto-relist", async () => {
  const i = await sparse();
  const r = await ok(`/items/${i.id}/reserve`, "POST", {
    customerRef: "expired",
    minutes: 5,
  });
  await db.reservation.update({
    where: { id: r.id },
    data: { expiresAt: new Date(1) },
  });
  await sweepAllItems();
  assert.equal((await item(i.id)).status, "PAUSED");
});
test("Ordinary own offline sale is included; valid friend intent is transaction-scoped", async () => {
  const a = await sparse(),
    s = await sold(a.id);
  assert.equal(
    (await db.sale.findUnique({ where: { id: s.id } })).cooperation,
    "INCLUDED",
  );
  const b = await sparse(),
    intent = await ok(`/items/${b.id}/intents`, "POST", {
      customerRef: "friend",
      reason: "合成例外约定",
      expiresAt: future(),
      pause: true,
    });
  const sale = await sold(b.id, { customerRef: "friend", intentId: intent.id });
  assert.equal(
    (await db.sale.findUnique({ where: { id: sale.id } })).cooperation,
    "EXCLUDED",
  );
  assert.equal(
    (await db.cycle.findFirst({ where: { itemId: b.id } })).cooperation,
    "INCLUDED",
  );
});
test("Invalid exception never blocks safe sold recording; classification requires admin evidence", async () => {
  const i = await sparse(),
    s = await sold(i.id, { intentId: "invalid-intention" });
  assert.equal((await item(i.id)).status, "SOLD");
  assert.equal(
    (await db.sale.findUnique({ where: { id: s.id } })).cooperation,
    "PENDING_REVIEW",
  );
  await ok(`/sales/${s.id}/classify`, "POST", {
    version: 1,
    cooperation: "INCLUDED",
    confirmed: true,
    reason: "合成核对",
    ruleReference: "DRAFT_TEST",
  });
  assert.equal(
    (await db.sale.findUnique({ where: { id: s.id } })).cooperation,
    "INCLUDED",
  );
});
test("Gift and independent supplier sale do not create our income", async () => {
  const a = await sparse(),
    b = await sparse({ ownership: "SUPPLIER" });
  await ok(`/items/${a.id}/state`, "POST", {
    state: "GIFTED",
    reason: "赠出合成样本",
  });
  await ok(`/items/${b.id}/state`, "POST", {
    state: "SUPPLIER_SOLD",
    reason: "供应商确认售出",
  });
  assert.equal(
    await db.sale.count({ where: { itemId: { in: [a.id, b.id] } } }),
    0,
  );
  assert.equal(
    (
      await api(`/items/${a.id}/state`, "POST", {
        state: "AVAILABLE",
        reason: "bad reopen",
      })
    ).status,
    409,
  );
});
test("Same external order is deduplicated independently from request key", async () => {
  const i = await sparse(),
    key = "TEST:ORDER:" + randomUUID();
  const a = await sold(i.id, { externalKey: key }),
    b = await sold(i.id, { externalKey: key });
  assert.equal(a.id, b.id);
  assert.equal(await db.sale.count({ where: { itemId: i.id } }), 1);
  const c = await sold(i.id);
  assert.equal(c.conflict, true);
  assert.equal(await db.sale.count({ where: { itemId: i.id } }), 1);
});
test("Concurrent sale registration never creates two confirmed sales", async () => {
  const i = await sparse();
  const r = await Promise.all([
    sold(i.id, { customerRef: "one" }),
    sold(i.id, { customerRef: "two" }),
  ]);
  assert.equal(r.filter((x) => x.conflict).length, 1);
  assert.equal(await db.sale.count({ where: { itemId: i.id } }), 1);
});
test("Refund + intact return + resale produces 620, not duplicated acquisition costs", async () => {
  const i = await ready(),
    s = await sold(i.id);
  await finance(s.id);
  assert.equal(
    contribution(await db.sale.findUnique({ where: { id: s.id } })).value,
    90000,
  );
  await ok(`/sales/${s.id}/refund`, "POST", {
    amount: 200000,
    reason: "全额退款测试",
  });
  await ok(`/sales/${s.id}/return`, "POST", {
    intact: true,
    evidence: "同件完整回收测试",
  });
  assert.equal((await item(i.id)).status, "QUARANTINED");
  assert.equal((await item(i.id)).cycle, 1);
  assert.equal(
    contribution(await db.sale.findUnique({ where: { id: s.id } })).value,
    -10000,
  );
  await ok(`/items/${i.id}/state`, "POST", {
    state: "AVAILABLE",
    reason: "已经复检合成样本",
  });
  const next = await sold(i.id);
  await finance(next.id, { amount: 180000, fees: 8000 });
  assert.equal(
    contribution(await db.sale.findUnique({ where: { id: next.id } })).value,
    72000,
  );
  const rows = await db.sale.findMany({ where: { itemId: i.id } });
  assert.equal(
    rows.reduce((sum, s) => sum + contribution(s).value, 0),
    62000,
  );
});
test("Partial refund retains cost and excess refunds are rejected", async () => {
  const i = await sparse(),
    s = await sold(i.id);
  await finance(s.id);
  await ok(`/sales/${s.id}/refund`, "POST", {
    amount: 20000,
    reason: "部分退款",
  });
  assert.equal(
    contribution(await db.sale.findUnique({ where: { id: s.id } })).value,
    70000,
  );
  assert.equal(
    (
      await api(`/sales/${s.id}/refund`, "POST", {
        amount: 200000,
        reason: "too much",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/sales/${s.id}/return`, "POST", {
        intact: true,
        evidence: "bad",
      })
    ).status,
    409,
  );
});
test("Cost estimates, confirmed costs and void history are separate from sale snapshot", async () => {
  const i = await sparse(),
    r = await ok(`/items/${i.id}/costs`, "POST", {
      kind: "PURCHASE",
      amount: 100000,
      currency: "CNY",
      confirmed: false,
      note: "估算，未当实际成本",
      occurredAt: new Date().toISOString(),
    });
  assert.equal((await ok(`/items/${i.id}/costs`))[0].confirmed, false);
  assert.equal(
    (await api(`/items/${i.id}/costs`, "GET", undefined, operator)).status,
    403,
  );
  await ok(`/costs/${r.id}/void`, "POST", { reason: "估算修正" });
  assert.equal(
    (await db.costEntry.findUnique({ where: { id: r.id } })).status,
    "VOID",
  );
});
test("Same remote listing can be explicitly republished to new valid package without losing audit", async () => {
  const i = await ready(),
    l = await listed(i.id);
  let d = await item(i.id);
  await ok(`/items/${i.id}`, "PATCH", {
    version: d.version,
    facts: { descriptionZh: "经过审核的新文案" },
  });
  d = await item(i.id);
  await ok(`/items/${i.id}/approve`, "POST", { version: d.version });
  const p = await pack(i.id),
    old = await db.listing.findUnique({ where: { id: l.listing } });
  const r = await ok("/listings", "POST", {
    packageId: p.id,
    remoteId: old.remoteId,
  });
  assert.equal(r.id, l.listing);
  assert.equal(r.updated, true);
  assert.equal(
    await db.audit.count({
      where: { resourceId: i.id, action: "LISTING_REPUBLISHED" },
    }),
    1,
  );
});
test("Showroom dynamically removes sold goods before worker catches up", async () => {
  const i = await ready(),
    l = await listed(i.id, showChannel, "SHOWROOM");
  assert.ok(
    (await ok("/showroom", "GET", undefined, null)).some(
      (x) => x.id === l.pack,
    ),
  );
  await sold(i.id);
  assert.ok(
    !(await ok("/showroom", "GET", undefined, null)).some(
      (x) => x.id === l.pack,
    ),
  );
});
test("Withdrawal or expiry of rights creates a local source-linked stop even with a Listing", async () => {
  const i = await ready(),
    l = await listed(i.id);
  await assetReview(i.asset, { rights: "REVOKED" });
  await sweepAllItems();
  const source = await db.distributionAttempt.findFirstOrThrow({
    where: {
      itemId: i.id,
      channelId: channel.id,
      action: { in: ["PUBLISH", "UPDATE"] },
      state: "SUCCEEDED",
    },
  });
  const stop = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${source.id}` },
  });
  assert.equal(stop.action, "DELIST");
  assert.equal(stop.sourceAttemptId, source.id);
  assert.equal(stop.state, "PENDING");
  assert.equal(
    (await db.listing.findUnique({ where: { id: l.listing } })).desired,
    "LIVE",
  );
  const j = await ready(),
    p = await pack(j.id);
  await db.asset.update({
    where: { id: j.asset },
    data: { validUntil: new Date(1) },
  });
  await assert.rejects(
    db.$transaction((tx) => app.get(PublishingService).validPackage(tx, p.id)),
  );
});
test("Old worker event cannot resurrect a sold item; persisted jobs finish after fresh worker starts", async () => {
  const i = await ready(),
    l = await listed(i.id);
  await sold(i.id);
  await db.outbox.create({
    data: { itemId: i.id, kind: "OLD_CONTENT_CHANGED", payload: {} },
  });
  const fresh = new WorkerService(db, app.get(PublicationHealthService));
  for (let n = 0; n < 250 && (await fresh.tick()); n++) {}
  assert.equal((await item(i.id)).status, "SOLD");
  assert.equal(
    (await db.listing.findUnique({ where: { id: l.listing } })).desired,
    "OFFLINE",
  );
  assert.equal(
    await db.outbox.count({ where: { itemId: i.id, status: "PENDING" } }),
    0,
  );
});
test("Worker failure preserves durable job for bounded retry rather than claiming success", async () => {
  const job = await db.outbox.create({
    data: {
      itemId: randomUUID(),
      kind: "TEST_FAILURE",
      payload: {},
      nextAt: new Date(0),
      createdAt: new Date(0),
      attempts: 7,
    },
  });
  await worker.tick();
  const r = await db.outbox.findUnique({ where: { id: job.id } });
  assert.equal(r.status, "FAILED");
  assert.equal(r.attempts, 8);
  assert.equal(r.lastError, "BUSINESS_ERROR");
});
test("AI candidate is version-bound and only changes draft; live AI cannot make billable calls", async () => {
  const i = await sparse();
  const s = await ok(`/items/${i.id}/suggestions`, "POST", {
    version: 1,
    locale: "en",
    text: "Synthetic draft",
  });
  await ok(`/items/${i.id}`, "PATCH", { version: 1, facts: { color: "red" } });
  assert.equal(
    (await api(`/suggestions/${s.id}/apply`, "POST", {})).status,
    409,
  );
  const current = await item(i.id),
    next = await ok(`/items/${i.id}/suggestions`, "POST", {
      version: current.version,
      locale: "en",
      text: "Approved by human as draft",
    });
  await ok(`/suggestions/${next.id}/apply`, "POST", {});
  assert.equal((await item(i.id)).approvedValid, false);
  assert.equal((await api(`/items/${i.id}/ai-draft`, "POST", {})).status, 503);
});
test("Database protects append-only evidence and composite item anchors", async () => {
  const i = await ready(),
    p = await pack(i.id);
  await assert.rejects(
    db.usePackage.update({
      where: { id: p.id },
      data: { validUntil: new Date(1) },
    }),
  );
  const audit = await db.audit.findFirst();
  await assert.rejects(db.audit.delete({ where: { id: audit.id } }));
  const other = await sparse(),
    rev = await db.itemRevision.findFirst({ where: { itemId: other.id } });
  await assert.rejects(
    db.item.update({ where: { id: i.id }, data: { approvedId: rev.id } }),
  );
});
test("Revoked access prevents replaying an earlier command response", async () => {
  const key = randomUUID();
  await ok("/items", "POST", { title: "操作员合成档案" }, operator, key);
  await ok("/auth/user-access", "POST", {
    id: operator.id,
    role: "OPERATOR",
    active: false,
  });
  assert.equal(
    (await api("/items", "POST", { title: "操作员合成档案" }, operator, key))
      .status,
    401,
  );
});
test("Concurrent different items receive distinct complete TM codes", async () => {
  const items = await Promise.all(
    Array.from({ length: 12 }, (_, n) =>
      sparse({ title: "并发合成建档 " + n }),
    ),
  );
  assert.equal(new Set(items.map((x) => x.id)).size, 12);
  assert.equal(new Set(items.map((x) => x.code)).size, 12);
  for (const x of items) assert.match(x.code, /^TM\d{6,}$/);
});
test("Browser fixture uses synthetic-only records and route contract has protected endpoint inventory", async () => {
  const contract = await ok("/system/openapi");
  assert.ok(Object.keys(contract.paths).length > 20);
  mkdirSync("docs/contracts", { recursive: true });
  writeFileSync(
    "docs/contracts/openapi.json",
    JSON.stringify(contract, null, 2) + "\n",
  );
  assert.ok((await db.item.count()) > 10);
});

// Release 0.2 business journeys; all fixtures remain inside guarded tome_test.
test("Aliases are searchable, globally exclusive, and cannot occupy TM namespace", async () => {
  const a = await sparse(),
    b = await sparse(),
    alias = "OLD_" + randomUUID().slice(0, 8).toUpperCase();
  await ok(`/items/${a.id}/aliases`, "POST", {
    code: alias.toLowerCase(),
    source: "合成历史货号",
  });
  const found = await ok("/items?q=" + alias);
  assert.equal(found.rows[0].id, a.id);
  assert.equal(
    (
      await api(`/items/${b.id}/aliases`, "POST", {
        code: alias,
        source: "合成冲突",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(`/items/${a.id}/aliases`, "POST", {
        code: "TM999999",
        source: "不得占用主号",
      })
    ).status,
    400,
  );
  assert.equal((await item(a.id)).code, a.code);
});
test("A reviewer may declare measurements inapplicable but never waive authentication", async () => {
  const a = await ready({
    category: "OTHER",
    facts: {
      condition: "合成纸质配件",
      descriptionZh: "合成不可测量配件说明",
      authentication: { status: "PASSED", evidence: "合成依据" },
    },
  });
  const before = await ok(
    `/items/${a.id}/readiness?channelId=${channel.id}&purpose=TRADE`,
  );
  assert.ok(before.missing.some((m) => m.code === "measurements"));
  const w = await ok(`/items/${a.id}/waivers`, "POST", {
    code: "measurements",
    reason: "此合成测试配件不适用服装或包袋的测量要求",
  });
  const p = await pack(a.id);
  assert.ok(p.id);
  assert.equal(
    (
      await api(`/items/${a.id}/waivers`, "POST", {
        code: "authentication",
        reason: "不可绕过逐件真实性复核",
      })
    ).status,
    400,
  );
  await ok(`/items/${a.id}/waivers/${w.id}/revoke`, "POST", {});
  await assert.rejects(app.get(PublishingService).validPackage(db, p.id));
});
async function intakeUpload(batchId, name, key = randomUUID()) {
  const image = await sharp({
    create: {
      width: 48,
      height: 48,
      channels: 3,
      background: { r: 220, g: 220, b: 220 },
    },
  })
    .png()
    .toBuffer();
  const d = new FormData();
  d.set("file", new Blob([image], { type: "image/png" }), name);
  return ok(`/intake/batches/${batchId}/upload`, "POST", d, admin, key);
}
test("Batch intake preserves originals without manufacturing inventory or approval", async () => {
  const a = await sparse(),
    n = await db.item.count(),
    b = await ok("/intake/batches", "POST", { name: "合成拍摄批次" });
  const k = randomUUID(),
    f = await intakeUpload(b.id, a.code + "_front.png", k),
    again = await intakeUpload(b.id, a.code + "_front.png", k);
  assert.equal(f.id, again.id);
  assert.equal(f.hint, a.code);
  assert.equal(await db.item.count(), n);
  assert.equal(
    (await api(`/intake/batches/${b.id}/close`, "POST", {})).status,
    409,
  );
  const beforeFile = await db.intakeFile.findUniqueOrThrow({
    where: { id: f.id },
  });
  const assigned = await ok(`/intake/batches/${b.id}/assign`, "POST", {
    entries: [
      {
        fileId: f.id,
        itemId: a.id,
        origin: "SUPPLIER",
        sourceNote: "合成供应商授权待核对",
      },
    ],
  });
  const asset = await db.asset.findUniqueOrThrow({
    where: { id: assigned.ids[0] },
  });
  assert.equal(asset.sha256, beforeFile.sha256);
  assert.equal(asset.objectKey, beforeFile.objectKey);
  assert.equal(asset.rights, "INTERNAL");
  assert.equal(asset.verified, false);
  await ok(`/intake/batches/${b.id}/close`, "POST", {});
});
test("Two operators cannot attach one intake original to different physical items", async () => {
  const a = await sparse(),
    b = await sparse(),
    batch = await ok("/intake/batches", "POST", { name: "合成归属竞争" }),
    file = await intakeUpload(batch.id, "unknown.png");
  const results = await Promise.all(
    [a, b].map((i) =>
      api(`/intake/batches/${batch.id}/assign`, "POST", {
        entries: [
          { fileId: file.id, itemId: i.id, sourceNote: "人工确认测试归属" },
        ],
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 1);
  const f = await db.intakeFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(f.state, "ASSIGNED");
  assert.ok(f.assetId);
});
test("Collection rechecks each product and withholds only unavailable entries", async () => {
  const a = await ready(),
    b = await ready(),
    pa = await pack(a.id, channel, "CUSTOMER_CARD"),
    pb = await pack(b.id, channel, "CUSTOMER_CARD");
  const c = await ok("/collections", "POST", {
    title: "合成客户选品",
    packageIds: [pa.id, pb.id],
    confirmed: true,
  });
  const before = await ok(`/collections/${c.id}`);
  assert.equal(before.entries.filter((e) => e.status === "USABLE").length, 2);
  await sold(a.id);
  const after = await ok(`/collections/${c.id}`);
  assert.equal(after.entries.filter((e) => e.status === "USABLE").length, 1);
  assert.equal(JSON.stringify(after).includes("passwordHash"), false);
  assert.equal(JSON.stringify(after).includes("supplierId"), false);
});
test("Operations health is authenticated, reports real queue state, and declares infrastructure limits", async () => {
  assert.equal(
    (await api("/operations/status", "GET", undefined, viewer)).status,
    403,
  );
  const r = await ok("/operations/status");
  assert.equal(r.guarantees.productionHA, false);
  assert.equal(r.guarantees.externalEffects, false);
  assert.ok(Array.isArray(r.queue));
  const health = await api("/system/health", "GET", undefined, null);
  assert.equal(health.status, 200);
  assert.ok(health.headers.get("x-request-id"));
});
let statementFixture;
async function statementBody(id) {
  return ok(`/settlements/${id}`);
}
test("Statement rules require explicit activation and incomplete sales cannot be confirmed", async () => {
  const period = {
    periodStart: "2024-01-01T00:00:00.000Z",
    periodEnd: "2024-02-01T00:00:00.000Z",
    currency: "CNY",
  };
  const rule = await ok("/settlements/rules", "POST", {
    name: "合成30%核对规则",
    agreementRef: "SYNTHETIC-ONLY-NOT-A-SIGNED-AGREEMENT",
    basisPoints: 3000,
    effectiveFrom: "2024-01-01T00:00:00.000Z",
    effectiveTo: "2025-01-01T00:00:00.000Z",
  });
  assert.equal(
    (await api("/settlements/preview", "POST", { ...period, ruleId: rule.id }))
      .status,
    409,
  );
  assert.equal(
    (
      await api(`/settlements/rules/${rule.id}/activate`, "POST", {
        confirmed: true,
        agreementRef: "WRONG",
      })
    ).status,
    409,
  );
  await ok(`/settlements/rules/${rule.id}/activate`, "POST", {
    confirmed: true,
    agreementRef: "SYNTHETIC-ONLY-NOT-A-SIGNED-AGREEMENT",
  });
  const a = await sparse(),
    s = await sold(a.id);
  await db.sale.update({
    where: { id: s.id },
    data: { soldAt: new Date("2024-01-10T12:00:00.000Z") },
  });
  const p = await ok("/settlements/preview", "POST", {
    ...period,
    ruleId: rule.id,
  });
  assert.equal(
    (
      await api(`/settlements/${p.id}/confirm`, "POST", {
        digest: p.digest,
        confirmed: true,
      })
    ).status,
    409,
  );
  await finance(s.id);
  statementFixture = { item: a, sale: s, rule, period };
});
test("Statement confirmation detects stale fees and only confirms one immutable snapshot", async () => {
  const { sale, rule, period } = statementFixture;
  const stale = await ok("/settlements/preview", "POST", {
    ...period,
    ruleId: rule.id,
  });
  await finance(sale.id, { fees: 12000 });
  const rejected = await api(`/settlements/${stale.id}/confirm`, "POST", {
    digest: stale.digest,
    confirmed: true,
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.error.code, "STALE_PREVIEW");
  await finance(sale.id, { fees: 10000 });
  const p = await ok("/settlements/preview", "POST", {
    ...period,
    ruleId: rule.id,
  });
  const results = await Promise.all(
    [1, 2].map(() =>
      ok(`/settlements/${p.id}/confirm`, "POST", {
        digest: p.digest,
        confirmed: true,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.confirmed === true).length, 1);
  assert.equal(
    await db.audit.count({
      where: { resourceId: p.id, action: "SETTLEMENT_CONFIRMED" },
    }),
    1,
  );
  const row = await statementBody(p.id);
  assert.equal(row.snapshot.summary.profit, 90000);
  assert.equal(row.snapshot.summary.partnerShare, 27000);
  await assert.rejects(
    db.settlementStatement.update({
      where: { id: p.id },
      data: { digest: "0".repeat(64) },
    }),
  );
  await assert.rejects(
    db.settlementRule.update({
      where: { id: rule.id },
      data: { basisPoints: 8000 },
    }),
  );
  statementFixture.confirmed = p;
});
test("Closed transaction currencies cannot move into another statement or currency", async () => {
  const { sale } = statementFixture,
    current = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
  const r = await api(`/sales/${sale.id}/finance`, "POST", {
    version: current.version,
    amount: 200000,
    cost: 100000,
    fees: 10000,
    currency: "USD",
    paid: true,
    note: "合成错误币种请求",
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "CLOSED_CURRENCY");
  await assert.rejects(
    db.sale.update({ where: { id: sale.id }, data: { currency: "USD" } }),
  );
});
test("Later refund creates a delta correction without rewriting the closed period", async () => {
  const { sale, rule, period, confirmed } = statementFixture,
    original = await statementBody(confirmed.id);
  await ok(`/sales/${sale.id}/refund`, "POST", {
    amount: 10000,
    reason: "合成后续退款，不执行外部退款",
  });
  const p = await ok("/settlements/preview", "POST", {
    ...period,
    ruleId: rule.id,
    baseId: confirmed.id,
  });
  const row = await statementBody(p.id);
  assert.equal(row.snapshot.summary.profit, 80000);
  assert.equal(row.snapshot.delta.partnerShare, -3000);
  await ok(`/settlements/${p.id}/confirm`, "POST", {
    digest: p.digest,
    confirmed: true,
  });
  assert.deepEqual(
    (await statementBody(confirmed.id)).snapshot,
    original.snapshot,
  );
  const duplicate = await ok("/settlements/preview", "POST", {
    ...period,
    ruleId: rule.id,
  });
  assert.equal(
    (
      await api(`/settlements/${duplicate.id}/confirm`, "POST", {
        digest: duplicate.digest,
        confirmed: true,
      })
    ).status,
    409,
  );
});
test("Statement arithmetic rounds signed minor units once and never combines currencies", async () => {
  const { shareMinor } = require("../dist/trading/settlement.service");
  assert.equal(shareMinor(1, 5000), 1);
  assert.equal(shareMinor(-1, 5000), -1);
  assert.equal(shareMinor(62000, 3000), 18600);
  const a = await sparse({ currency: "USD" }),
    s = await sold(a.id);
  await finance(s.id, { currency: "USD" });
  await db.sale.update({
    where: { id: s.id },
    data: { soldAt: new Date("2024-01-12T12:00:00.000Z") },
  });
  const p = await ok("/settlements/preview", "POST", {
    ...statementFixture.period,
    currency: "USD",
    ruleId: statementFixture.rule.id,
  });
  const row = await statementBody(p.id);
  assert.equal(row.snapshot.lines.length, 1);
  assert.equal(row.snapshot.summary.profit, 90000);
  const foreignConfirm = await api(`/settlements/${p.id}/confirm`, "POST", {
    digest: p.digest,
    confirmed: true,
  });
  assert.equal(foreignConfirm.status, 409);
  assert.equal(
    foreignConfirm.data.error.code,
    "FOREIGN_SETTLEMENT_FX_BASIS_REQUIRED",
  );
  assert.equal(
    (await db.settlementStatement.findUniqueOrThrow({ where: { id: p.id } }))
      .status,
    "DRAFT",
  );
  assert.equal(
    (await db.sale.findUniqueOrThrow({ where: { id: s.id } })).currency,
    "USD",
  );
});
test("An expired claim cannot acknowledge a new worker's lease", async () => {
  const i = await sparse(),
    j = await db.outbox.create({
      data: {
        itemId: i.id,
        kind: "FENCING_TEST",
        payload: {},
        nextAt: new Date(0),
        createdAt: new Date(0),
      },
    });
  const old = await worker.claimNext();
  assert.equal(old.id, j.id);
  await db.outbox.update({
    where: { id: j.id },
    data: { leaseUntil: new Date(1) },
  });
  const next = await worker.claimNext();
  assert.equal(next.id, j.id);
  assert.notEqual(next.token, old.token);
  await worker.executeClaim(old);
  assert.equal(
    (await db.outbox.findUnique({ where: { id: j.id } })).status,
    "WORKING",
  );
  await worker.executeClaim(next);
  assert.equal(
    (await db.outbox.findUnique({ where: { id: j.id } })).status,
    "DONE",
  );
});
test("Repeated worker crashes reach a bounded failed state, not an infinite reclaim loop", async () => {
  const i = await sparse(),
    j = await db.outbox.create({
      data: {
        itemId: i.id,
        kind: "CRASH_EXHAUSTION",
        payload: {},
        status: "WORKING",
        attempts: 8,
        leaseUntil: new Date(1),
        leaseToken: randomUUID(),
      },
    });
  await worker.claimNext();
  const row = await db.outbox.findUniqueOrThrow({ where: { id: j.id } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.lastError, "LEASE_EXHAUSTED");
  await ok(`/jobs/${j.id}/retry`, "POST", {});
  assert.equal(
    (await db.outbox.findUniqueOrThrow({ where: { id: j.id } })).attempts,
    0,
  );
});
test("A corrupt item cannot starve the bounded expiry sweep", async () => {
  const first = await db.item.findFirstOrThrow({ orderBy: { id: "asc" } });
  await db.sweepLease.upsert({
    where: { id: "expiry" },
    create: { id: "expiry" },
    update: { cursor: null, token: null, leaseUntil: null },
  });
  try {
    await db.item.update({
      where: { id: first.id },
      data: { facts: { invalidSyntheticFixture: true } },
    });
    const r = await worker.sweep();
    assert.ok(r.scanned > 1 && r.scanned <= 25);
    assert.ok(r.errors >= 1);
    const cursor = await db.sweepLease.findUniqueOrThrow({
      where: { id: "expiry" },
    });
    assert.ok(cursor.cursor !== first.id);
  } finally {
    await db.item.update({
      where: { id: first.id },
      data: { facts: first.facts },
    });
  }
});

// Explicit earliest nextAt isolates scheduler fixtures; production jobs remain ordered by due time.
test("Assigned private documents cannot be read through the former intake URL", async () => {
  await ok("/auth/user-access", "POST", {
    id: operator.id,
    role: "OPERATOR",
    active: true,
  });
  const fixture = JSON.parse(
    require("node:fs").readFileSync("data/browser-fixture.json", "utf8"),
  );
  operator = await login("operator@tome.test", fixture.password);
  const i = await sparse(),
    b = await ok("/intake/batches", "POST", { name: "合成凭证权限测试" }),
    f = await intakeUpload(b.id, "synthetic-document.png");
  const a = await ok(`/intake/batches/${b.id}/assign`, "POST", {
    entries: [
      {
        fileId: f.id,
        itemId: i.id,
        role: "DOCUMENT",
        origin: "OWN",
        sourceNote: "仅合成凭证",
      },
    ],
  });
  assert.equal(
    (await api(`/intake/files/${f.id}/preview`, "GET", undefined, operator))
      .status,
    403,
  );
  assert.equal(
    (await api(`/assets/${a.ids[0]}/preview`, "GET", undefined, operator))
      .status,
    403,
  );
  const filtered = await ok(
    `/intake/batches/${b.id}`,
    "GET",
    undefined,
    operator,
  );
  assert.equal(filtered.files.length, 0);
  const all = await ok(`/intake/batches/${b.id}`);
  assert.equal(all.files.length, 1);
});

// Operational usability additions use the same real HTTP authorization and test database.
async function saveChannelDraft(id, ch = channel, overrides = {}) {
  const space = await ok(
    `/items/${id}/publishing-space?channelId=${ch.id}&purpose=TRADE`,
  );
  const result = await ok(`/items/${id}/publishing-draft`, "POST", {
    channelId: ch.id,
    purpose: "TRADE",
    version: space.draft?.version || 0,
    title: space.suggested?.title || space.item.title,
    body: space.suggested?.body || "",
    assetIds: space.assets.filter((a) => a.usable).map((a) => a.id),
    basisRevisionId: space.item.approvedId,
    basisPrice: space.item.price,
    basisCurrency: space.item.currency,
    ...overrides,
  });
  return result;
}
test("Channel drafts persist independently without approving or publishing a product", async () => {
  const i = await sparse();
  const a = await saveChannelDraft(i.id, channel, {
    title: "闲鱼还在整理",
    body: "只是一段未完成草稿",
  });
  const second = await ok("/channels", "POST", {
    name: "第二交易渠道独立草稿测试",
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
  });
  await saveChannelDraft(i.id, second, {
    title: "另一种讲法",
    body: "第二交易渠道独立保存",
  });
  const one = await ok(
      `/items/${i.id}/publishing-space?channelId=${channel.id}`,
    ),
    two = await ok(`/items/${i.id}/publishing-space?channelId=${second.id}`);
  assert.equal(one.draft.body, "只是一段未完成草稿");
  assert.equal(two.draft.body, "第二交易渠道独立保存");
  assert.equal((await item(i.id)).approvedValid, false);
  assert.equal(await db.listing.count({ where: { itemId: i.id } }), 0);
  assert.equal(
    (
      await api(`/items/${i.id}/packages`, "POST", {
        channelId: channel.id,
        purpose: "TRADE",
        draftId: a.id,
        draftVersion: a.version,
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api(
        `/items/${i.id}/publishing-space?channelId=${channel.id}`,
        "GET",
        undefined,
        viewer,
      )
    ).status,
    403,
  );
});
test("Saving a stale channel draft cannot overwrite another operator's saved content", async () => {
  const i = await ready(),
    draft = await saveChannelDraft(i.id);
  const s = await ok(`/items/${i.id}/publishing-space?channelId=${channel.id}`);
  const body = {
    channelId: channel.id,
    purpose: "TRADE",
    version: draft.version,
    title: "最新版",
    body: "第一位编辑保存",
    assetIds: s.draft.assetIds,
    basisRevisionId: s.item.approvedId,
    basisPrice: s.item.price,
    basisCurrency: s.item.currency,
  };
  await ok(`/items/${i.id}/publishing-draft`, "POST", body);
  assert.equal(
    (
      await api(`/items/${i.id}/publishing-draft`, "POST", {
        ...body,
        body: "旧编辑尝试覆盖",
      })
    ).status,
    409,
  );
  assert.equal(
    (await ok(`/items/${i.id}/publishing-space?channelId=${channel.id}`)).draft
      .body,
    "第一位编辑保存",
  );
});
test("Current channel copy can complete publishing without duplicating it into master description", async () => {
  const i = await ready({
    facts: {
      condition: "袖口轻微磨损",
      measurements: "合成衣长60cm",
      measurementSource: "合成测量",
      authentication: { status: "PASSED", evidence: "合成复核" },
    },
  });
  const d = await saveChannelDraft(i.id, channel, {
    body: "本渠道独立维护的商品介绍",
  });
  const p = await ok(`/items/${i.id}/packages`, "POST", {
    channelId: channel.id,
    purpose: "TRADE",
    draftId: d.id,
    draftVersion: d.version,
    confirmed: true,
  });
  const usable = await ok(`/packages/${p.id}/usable`);
  assert.ok(usable.snapshot.body.includes("袖口轻微磨损"));
  assert.ok(usable.snapshot.body.includes("本渠道独立维护"));
  assert.equal((await item(i.id)).facts.descriptionZh, "");
  assert.equal(await db.listing.count({ where: { itemId: i.id } }), 0);
});
test("A changed product basis preserves channel text but blocks freezing until explicitly reconciled", async () => {
  const i = await ready(),
    d = await saveChannelDraft(i.id, channel, { body: "人工精修内容不应覆盖" });
  await ok(`/items/${i.id}`, "PATCH", { version: 1, currentPrice: 210000 });
  const changed = await ok(
    `/items/${i.id}/publishing-space?channelId=${channel.id}`,
  );
  assert.equal(changed.outdated, true);
  assert.equal(changed.draft.body, "人工精修内容不应覆盖");
  assert.equal(
    (
      await api(`/items/${i.id}/packages`, "POST", {
        channelId: channel.id,
        purpose: "TRADE",
        draftId: d.id,
        draftVersion: d.version,
        confirmed: true,
      })
    ).status,
    409,
  );
  const updated = await saveChannelDraft(i.id, channel, {
    body: "已经核对新价格，保留精修内容",
  });
  await ok(`/items/${i.id}/packages`, "POST", {
    channelId: channel.id,
    purpose: "TRADE",
    draftId: updated.id,
    draftVersion: updated.version,
    confirmed: true,
  });
});
test("Publication selection is item-bound and cannot hide approved defect photos", async () => {
  const i = await ready(),
    j = await ready();
  const defect = await upload(i.id, { role: "DEFECT" });
  await assetReview(defect.id);
  assert.equal(
    (
      await api(`/items/${i.id}/packages`, "POST", {
        channelId: channel.id,
        confirmed: true,
        assetIds: [j.asset],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api(`/items/${i.id}/packages`, "POST", {
        channelId: channel.id,
        confirmed: true,
        assetIds: [i.asset],
      })
    ).status,
    400,
  );
  const p = await ok(`/items/${i.id}/packages`, "POST", {
    channelId: channel.id,
    confirmed: true,
    assetIds: [defect.id, i.asset],
  });
  assert.deepEqual(
    (await ok(`/packages/${p.id}/usable`)).snapshot.assets.map((a) => a.id),
    [defect.id, i.asset],
  );
});
test("Archiving preserves originals, invalidates reuse, and restore requires a new image review", async () => {
  const i = await ready(),
    p = await pack(i.id);
  const before = await db.asset.findUnique({ where: { id: i.asset } });
  await ok(`/assets/${i.asset}/archive`, "POST", {
    archived: true,
    reason: "不再采用当前图片",
  });
  assert.equal((await api(`/packages/${p.id}/usable`)).status, 409);
  assert.equal(await db.asset.count({ where: { id: i.asset } }), 1);
  await ok(`/assets/${i.asset}/archive`, "POST", {
    archived: false,
    reason: "恢复后重新检查",
  });
  const restored = await db.asset.findUnique({ where: { id: i.asset } });
  assert.equal(restored.objectKey, before.objectKey);
  assert.equal(restored.sha256, before.sha256);
  assert.equal(restored.verified, false);
  assert.equal(restored.rights, "INTERNAL");
});
test("Image ordering has an explicit expected set and does not overwrite a changed gallery", async () => {
  const i = await ready(),
    second = await upload(i.id);
  const initial = (await item(i.id)).assets
    .filter((a) => !a.archived && a.role !== "DOCUMENT")
    .map((a) => a.id);
  await ok(`/items/${i.id}/image-order`, "POST", {
    expectedOrder: initial,
    assetIds: [second.id, i.asset],
  });
  assert.equal((await item(i.id)).assets[0].id, second.id);
  assert.equal(
    (
      await api(`/items/${i.id}/image-order`, "POST", {
        expectedOrder: initial,
        assetIds: initial,
      })
    ).status,
    409,
  );
});
function zipFiles(buffer) {
  const files = new Map();
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    const method = buffer.readUInt16LE(cursor + 10),
      size = buffer.readUInt32LE(cursor + 20),
      nameLength = buffer.readUInt16LE(cursor + 28),
      extra = buffer.readUInt16LE(cursor + 30),
      comment = buffer.readUInt16LE(cursor + 32),
      offset = buffer.readUInt32LE(cursor + 42),
      name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    const dataStart =
        offset +
        30 +
        buffer.readUInt16LE(offset + 26) +
        buffer.readUInt16LE(offset + 28),
      compressed = buffer.subarray(dataStart, dataStart + size);
    files.set(
      name,
      method === 8
        ? require("node:zlib").inflateRawSync(compressed)
        : compressed,
    );
    cursor += 46 + nameLength + extra + comment;
  }
  return files;
}
test("Manual publishing download contains ordered JPEGs and separate title/body files; sold copies are refused", async () => {
  const i = await ready(),
    p = await pack(i.id);
  const response = await fetch(`${origin}/api/packages/${p.id}/download`, {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(response.status, 200);
  const files = zipFiles(Buffer.from(await response.arrayBuffer()));
  assert.ok(files.has(`${i.code}/标题.txt`));
  assert.ok(files.has(`${i.code}/正文.txt`));
  const photo = files.get(`${i.code}/01_${i.code}.jpg`);
  assert.ok(photo);
  assert.equal((await sharp(photo).metadata()).format, "jpeg");
  const original = await db.asset.findUnique({ where: { id: i.asset } });
  assert.equal(original.mime, "image/png");
  await sold(i.id);
  assert.equal((await api(`/packages/${p.id}/usable`)).status, 409);
});
test("Chinese attribute labels and research values persist, and foreign revision anchors are rejected", async () => {
  const i = await sparse();
  await ok(`/items/${i.id}`, "PATCH", {
    version: 1,
    facts: {
      attributes: { custom_series: "春夏系列" },
      attributeLabels: { custom_series: "系列名称" },
      research: [{ claim: "年份待查", evidence: "合成线索", confirmed: false }],
    },
  });
  const updated = await item(i.id);
  assert.equal(updated.facts.attributeLabels.custom_series, "系列名称");
  assert.equal(updated.facts.attributes.custom_series, "春夏系列");
  const second = await sparse();
  const foreignRev = await db.itemRevision.findFirst({
    where: { itemId: second.id },
  });
  await assert.rejects(
    db.publishingDraft.create({
      data: {
        itemId: i.id,
        channelId: channel.id,
        purpose: "TRADE",
        basisRevisionId: foreignRev.id,
        basisCurrency: "CNY",
        updatedBy: admin.id,
      },
    }),
  );
});
test("Source pagination and server-side search reach older records without treating a page as the whole inventory", async () => {
  const prefix = "PAGED-" + randomUUID();
  const rows = Array.from({ length: 52 }, (_, n) => ({
    sourceKey: prefix + ":" + n,
    title: prefix + " 商品 " + n,
    payload: { brand: "合成品牌" },
  }));
  await ok("/supply/sources/import", "POST", rows);
  const first = await ok(`/supply/sources?page=1&q=${prefix}`),
    second = await ok(`/supply/sources?page=2&q=${prefix}`);
  assert.equal(first.total, 52);
  assert.equal(first.rows.length, 50);
  assert.equal(second.rows.length, 2);
  assert.equal(
    new Set([...first.rows, ...second.rows].map((s) => s.id)).size,
    52,
  );
  const source = second.rows[0];
  await sparse({ sourceId: source.id });
  const adopted = await ok(`/supply/sources?page=1&q=${prefix}&stage=adopted`),
    pending = await ok(`/supply/sources?page=1&q=${prefix}&stage=pending`);
  assert.equal(adopted.total, 1);
  assert.equal(adopted.rows[0].id, source.id);
  assert.equal(pending.total, 51);
  assert.equal(
    (await api(`/supply/sources?page=1&q=${prefix}`, "GET", undefined, viewer))
      .status,
    403,
  );
});

test("Catalog filters apply before counts and pagination, not only to the visible page", async () => {
  const tag = "catalog-filters-" + randomUUID();
  const own = await sparse({ title: tag + " clothing", category: "CLOTHING" });
  const bag = await sparse({
    title: tag + " bag",
    category: "BAG",
    ownership: "SUPPLIER",
  });
  const rows = await ok(
    "/items?q=" +
      tag +
      "&category=BAG&ownership=SUPPLIER&review=pending&size=60",
  );
  assert.equal(rows.total, 1);
  assert.equal(rows.size, 60);
  assert.equal(rows.rows[0].id, bag.id);
  assert.ok(!rows.rows.some((r) => r.id === own.id));
  const invalid = await api("/items?size=10000");
  assert.equal(invalid.status, 400);
  assert.equal((await api("/items?category=INVALID")).status, 400);
});
test("Empty and out-of-range catalog pages report an accurate reachable page", async () => {
  const tag = "page-clamp-" + randomUUID();
  const item = await sparse({ title: tag });
  const page = await ok("/items?q=" + tag + "&page=999&sort=oldest");
  assert.equal(page.total, 1);
  assert.equal(page.page, 1);
  assert.equal(page.rows[0].id, item.id);
  const empty = await ok("/items?q=does-not-exist-" + randomUUID() + "&page=9");
  assert.equal(empty.total, 0);
  assert.equal(empty.page, 1);
  assert.deepEqual(empty.rows, []);
});
test("Source prefill endpoint preserves supplier facts and requires supply permission", async () => {
  const key = "prefill-" + randomUUID();
  await ok("/supply/sources/import", "POST", [
    {
      sourceKey: key,
      title: "Supplier prefill",
      supplierId: supplier.id,
      payload: { quotedCost: "8000", category: "包袋" },
    },
  ]);
  const source = await db.source.findUniqueOrThrow({
    where: { sourceKey: key },
  });
  const read = await ok("/supply/sources/" + source.id);
  assert.equal(read.payload.quotedCost, "8000");
  assert.equal(read.supplier.id, supplier.id);
  assert.equal(
    (await api("/supply/sources/" + source.id, "GET", undefined, viewer))
      .status,
    403,
  );
  assert.equal(await db.item.count({ where: { sourceId: source.id } }), 0);
});

async function deleteInput(id) {
  return {
    version: (await item(id)).version,
    reason: "合成删除验收",
    confirmed: true,
  };
}
test("Recycle bin hides unused items but preserves identity, originals and invalidates old packages", async () => {
  const i = await ready(),
    p = await pack(i.id),
    before = await ok("/dashboard");
  const original = await fetch(`${origin}/api/assets/${i.asset}/original`, {
    headers: { Cookie: admin.cookie },
  });
  const bytes = Buffer.from(await original.arrayBuffer());
  await ok(`/items/${i.id}/trash`, "POST", await deleteInput(i.id));
  assert.equal((await ok(`/items?q=${i.code}`)).total, 0);
  assert.equal((await ok("/dashboard")).items, before.items - 1);
  assert.equal((await ok(`/recycle-bin/items?q=${i.code}`)).rows[0].id, i.id);
  assert.ok((await item(i.id)).deletedAt);
  assert.equal((await item(i.id)).status, "PAUSED");
  assert.equal((await api(`/packages/${p.id}/usable`)).status, 409);
  const retained = await fetch(`${origin}/api/assets/${i.asset}/original`, {
    headers: { Cookie: admin.cookie },
  });
  assert.deepEqual(Buffer.from(await retained.arrayBuffer()), bytes);
  assert.equal(
    (
      await api(`/items/${i.id}`, "PATCH", {
        version: (await item(i.id)).version,
        title: "stale edit",
      })
    ).data.error.code,
    "ITEM_DELETED",
  );
  await ok(`/items/${i.id}/restore`, "POST", await deleteInput(i.id));
  const restored = await item(i.id);
  assert.equal(restored.code, i.code);
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.status, "PAUSED");
  assert.equal(restored.approvedValid, false);
  assert.equal((await ok(`/items?q=${i.code}`)).total, 1);
  assert.equal((await ok(`/recycle-bin/items?q=${i.code}`)).total, 0);
  assert.equal((await api(`/packages/${p.id}/usable`)).status, 409);
  assert.ok((await sparse()).code !== i.code);
});
test("Deletion requires permission, explicit confirmation and a current item version", async () => {
  const i = await sparse(),
    input = await deleteInput(i.id);
  assert.equal(
    (await api(`/items/${i.id}/trash`, "POST", input, viewer)).status,
    403,
  );
  assert.equal(
    (await api(`/items/${i.id}/trash`, "POST", { ...input, confirmed: false }))
      .status,
    400,
  );
  await ok(`/items/${i.id}`, "PATCH", { version: input.version, brand: "new" });
  assert.equal(
    (await api(`/items/${i.id}/trash`, "POST", input)).data.error.code,
    "VERSION_CONFLICT",
  );
  assert.equal((await item(i.id)).deletedAt, null);
});
test("Sales and cost history cannot be erased through inventory deletion", async () => {
  const i = await sparse(),
    sale = await sold(i.id);
  assert.equal(
    (await api(`/items/${i.id}/trash`, "POST", await deleteInput(i.id))).data
      .error.code,
    "TRASH_HAS_SALES",
  );
  assert.ok(await db.sale.findUnique({ where: { id: sale.id } }));
  assert.equal((await item(i.id)).deletedAt, null);
  const costItem = await sparse();
  await ok(`/items/${costItem.id}/costs`, "POST", {
    kind: "PURCHASE",
    amount: 100,
    currency: "CNY",
    confirmed: true,
    note: "合成成本",
    occurredAt: new Date().toISOString(),
  });
  assert.equal(
    (
      await api(
        `/items/${costItem.id}/trash`,
        "POST",
        await deleteInput(costItem.id),
      )
    ).data.error.code,
    "TRASH_HAS_COSTS",
  );
  assert.equal(await db.costEntry.count({ where: { itemId: costItem.id } }), 1);
});
test("Active reservations and listings block deletion until actually resolved", async () => {
  const i = await sparse();
  await ok(`/items/${i.id}/reserve`, "POST", {
    customerRef: "test",
    minutes: 5,
  });
  assert.equal(
    (await api(`/items/${i.id}/trash`, "POST", await deleteInput(i.id))).data
      .error.code,
    "TRASH_RESERVED",
  );
  await ok(`/items/${i.id}/release`, "POST", {});
  await ok(`/items/${i.id}/trash`, "POST", await deleteInput(i.id));
  const live = await ready();
  await listed(live.id);
  assert.equal(
    (await api(`/items/${live.id}/trash`, "POST", await deleteInput(live.id)))
      .data.error.code,
    "TRASH_DISTRIBUTION_EXPOSURE",
  );
  await ok(`/items/${live.id}/state`, "POST", {
    state: "PAUSED",
    reason: "合成下架",
  });
  assert.equal(
    (await api(`/items/${live.id}/trash`, "POST", await deleteInput(live.id)))
      .data.error.code,
    "TRASH_DISTRIBUTION_EXPOSURE",
  );
  const source = await db.distributionAttempt.findFirstOrThrow({
    where: {
      itemId: live.id,
      channelId: channel.id,
      action: { in: ["PUBLISH", "UPDATE"] },
      state: "SUCCEEDED",
    },
  });
  const stop = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${source.id}` },
  });
  await ok(`/distribution/attempts/${stop.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: { method: "TM_SEARCH", note: "合成来源关联下架回执" },
  });
  await ok(`/items/${live.id}/trash`, "POST", await deleteInput(live.id));
  assert.ok(await db.listing.findFirst({ where: { itemId: live.id } }));
});
test("Deleting versus recording a sale cannot leave a sold item hidden in the recycle bin", async () => {
  const i = await sparse(),
    b = await deleteInput(i.id);
  const replies = await Promise.all([
    api(`/items/${i.id}/trash`, "POST", b),
    api(`/items/${i.id}/sold`, "POST", {
      channel: "test",
      customerRef: "test",
    }),
  ]);
  assert.equal(replies.filter((r) => r.status === 201).length, 1);
  assert.equal(replies.filter((r) => r.status === 409).length, 1);
  const row = await item(i.id),
    sales = await db.sale.count({ where: { itemId: i.id } });
  assert.equal(Boolean(row.deletedAt), sales === 0);
});
test("Deletion replay does not duplicate audit or re-delete a later restored item", async () => {
  const i = await sparse(),
    b = await deleteInput(i.id),
    key = randomUUID();
  const first = await ok(`/items/${i.id}/trash`, "POST", b, admin, key);
  assert.deepEqual(
    await ok(`/items/${i.id}/trash`, "POST", b, admin, key),
    first,
  );
  assert.equal(
    await db.audit.count({
      where: { action: "ITEM_TRASHED", resourceId: i.id },
    }),
    1,
  );
  await ok(`/items/${i.id}/restore`, "POST", await deleteInput(i.id));
  await ok(`/items/${i.id}/trash`, "POST", b, admin, key);
  assert.equal((await item(i.id)).deletedAt, null);
});
test("Deleted source items cannot be re-adopted and old events cannot revive deleted stock", async () => {
  const imported = await ok("/supply/sources/import", "POST", [
    { sourceKey: randomUUID(), title: "删除来源", payload: {} },
  ]);
  const i = await sparse({ sourceId: imported.ids[0] });
  await ok(`/items/${i.id}/prepare`, "POST", {
    channelId: channel.id,
    purpose: "TRADE",
  });
  await ok(`/items/${i.id}/trash`, "POST", await deleteInput(i.id));
  assert.equal(
    (
      await api("/items", "POST", {
        title: "重复接手",
        sourceId: imported.ids[0],
      })
    ).data.error.code,
    "SOURCE_ITEM_DELETED",
  );
  await db.$transaction((tx) => worker.reconcile(tx, i.id));
  const row = await item(i.id);
  assert.ok(row.deletedAt);
  assert.equal(row.status, "PAUSED");
  assert.equal(
    (await ok("/tasks")).some((t) => t.item.id === i.id),
    false,
  );
  assert.equal(
    await db.item.count({ where: { sourceId: imported.ids[0] } }),
    1,
  );
  assert.equal(
    (await api(`/items/${i.id}/approve`, "POST", { version: row.version })).data
      .error.code,
    "ITEM_DELETED",
  );
  assert.equal(
    (
      await api("/inquiries", "POST", {
        itemId: i.id,
        channel: "test",
        customerRef: "test",
      })
    ).data.error.code,
    "ITEM_DELETED",
  );
});
test("Database constraint rejects reopening a deleted item even outside the ordinary state endpoint", async () => {
  const i = await sparse();
  await ok(`/items/${i.id}/trash`, "POST", await deleteInput(i.id));
  await assert.rejects(
    db.item.update({ where: { id: i.id }, data: { status: "AVAILABLE" } }),
  );
  assert.equal((await item(i.id)).status, "PAUSED");
});

// Dictionary behavior is exercised through the real API and isolated database.
async function dictionaryOption(kind, code) {
  return db.dictionaryEntry.findUniqueOrThrow({
    where: { kind_code: { kind, code } },
  });
}
test("Dictionary aliases resolve to one identity and unregistered brand text is rejected", async () => {
  const lv = await dictionaryOption("BRAND", "LOUIS_VUITTON");
  for (const q of ["LV", "路易威登", "Louis Vuitton", "ＬＶ"]) {
    const result = await ok(
      "/dictionaries?kind=BRAND&exact=1&q=" + encodeURIComponent(q),
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, lv.id);
  }
  const i = await sparse({ brand: "LV" });
  assert.equal((await item(i.id)).brand, "Louis Vuitton");
  assert.equal((await item(i.id)).dictionary.brand, lv.id);
  assert.ok((await ok("/items?q=LV")).rows.some((row) => row.id === i.id));
  const invalid = await api("/items", "POST", {
    title: "未知品牌应拒绝",
    brand: "NEVER_REGISTERED_" + randomUUID(),
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error.code, "DICTIONARY_REQUIRED");
});
test("Condition choices use exactly the five VC labels and cannot be redefined as percent grades", async () => {
  const data = await ok("/dictionaries?kind=CONDITION");
  assert.deepEqual(
    data.rows.map((r) => r.labelEn),
    [
      "Never worn, with tag",
      "Never worn",
      "Very good condition",
      "Good condition",
      "Fair condition",
    ],
  );
  assert.equal(
    (await api("/dictionaries", "POST", { kind: "CONDITION", label: "九成新" }))
      .status,
    400,
  );
  const row = data.rows[0];
  assert.equal(
    (
      await api("/dictionaries/" + row.id, "POST", {
        version: row.version,
        label: "95新",
        labelEn: "95%",
        aliases: [],
        description: row.description,
        categories: [],
        sortOrder: row.sortOrder,
        active: true,
      })
    ).status,
    400,
  );
});
test("Dictionary management has fresh permission checks and case-normalized alias uniqueness", async () => {
  assert.equal(
    (
      await api(
        "/dictionaries",
        "POST",
        { kind: "BRAND", label: "unauthorized" },
        operator,
      )
    ).status,
    403,
  );
  const first = await ok("/dictionaries", "POST", {
    kind: "BRAND",
    label: "Unique " + randomUUID(),
    aliases: ["Alias-" + randomUUID()],
  });
  const duplicate = await api("/dictionaries", "POST", {
    kind: "BRAND",
    label: "Duplicate " + randomUUID(),
    aliases: [first.aliases[0].toUpperCase()],
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error.code, "DICTIONARY_DUPLICATE");
  assert.equal(
    (await api("/dictionaries?kind=BRAND&all=1", "GET", undefined, operator))
      .status,
    403,
  );
});
test("Typed selections persist with product snapshots, filtering, and English condition copy", async () => {
  const brand = await dictionaryOption("BRAND", "DIOR"),
    condition = await dictionaryOption("CONDITION", "VERY_GOOD"),
    color = await dictionaryOption("COLOR", "BLACK"),
    material = await dictionaryOption("MATERIAL", "WOOL");
  const i = await ready({
      brand: "",
      dictionary: {
        brand: brand.id,
        condition: condition.id,
        color: color.id,
        material: material.id,
      },
    }),
    current = await item(i.id);
  assert.equal(current.brand, "Dior");
  assert.equal(current.facts.color, "黑色");
  assert.equal(current.facts.conditionGrade, "非常好");
  assert.equal(current.facts.conditionGradeEn, "Very good condition");
  assert.equal(current.dictionarySelections.length, 4);
  const result = await ok(
    `/items?brandId=${brand.id}&conditionId=${condition.id}&colorId=${color.id}&materialId=${material.id}`,
  );
  assert.ok(result.rows.some((r) => r.id === i.id));
  const frozen = await pack(i.id, showChannel, "SHOWROOM");
  const pkg = await db.usePackage.findUniqueOrThrow({
    where: { id: frozen.id },
  });
  assert.ok(pkg.snapshot.body.includes("Very good condition"));
  const missing = await api("/items", "POST", {
    title: "wrong-kind",
    dictionary: { brand: condition.id },
  });
  assert.equal(missing.status, 400);
});
test("Disabling a used dictionary entry preserves prior selections but rejects new use", async () => {
  const e = await ok("/dictionaries", "POST", {
    kind: "BRAND",
    label: "Disable test " + randomUUID(),
    labelEn: "Disable test",
  });
  const i = await sparse({ dictionary: { brand: e.id } });
  const update = {
    version: e.version,
    label: e.label,
    labelEn: e.labelEn,
    aliases: e.aliases,
    description: e.description,
    categories: e.categories,
    sortOrder: e.sortOrder,
    active: false,
  };
  await ok("/dictionaries/" + e.id, "POST", update);
  assert.equal(
    (
      await api("/items", "POST", {
        title: "disabled",
        dictionary: { brand: e.id },
      })
    ).status,
    400,
  );
  await ok(`/items/${i.id}`, "PATCH", {
    version: 1,
    facts: { material: "独立说明" },
  });
  assert.equal((await item(i.id)).dictionary.brand, e.id);
  assert.equal(
    (await ok("/dictionaries?kind=BRAND&q=" + encodeURIComponent(e.label))).rows
      .length,
    0,
  );
});
test("Renaming a dictionary does not rewrite approved product snapshots", async () => {
  const e = await ok("/dictionaries", "POST", {
      kind: "BRAND",
      label: "Snapshot " + randomUUID(),
      labelEn: "Snapshot name",
    }),
    i = await ready({ brand: "", dictionary: { brand: e.id } });
  const approvedBefore = (await item(i.id)).revisions.find(
    (r) => r.approvedAt,
  ).snapshot;
  await ok("/dictionaries/" + e.id, "POST", {
    version: e.version,
    label: "Renamed " + randomUUID(),
    labelEn: "Renamed name",
    aliases: [],
    description: "name corrected",
    categories: [],
    sortOrder: 2,
    active: true,
  });
  const approvedAfter = (await item(i.id)).revisions.find(
    (r) => r.approvedAt,
  ).snapshot;
  assert.deepEqual(approvedAfter, approvedBefore);
  assert.equal((await item(i.id)).brand, e.label);
});
test("Readable logs preserve access control and expose human operation and task descriptions", async () => {
  const auditRows = await ok(
    "/operations/audit-logs?q=" + encodeURIComponent("新增字典"),
  );
  assert.ok(auditRows.rows.length);
  assert.ok(auditRows.rows.every((r) => r.actionLabel === "新增字典选项"));
  assert.ok(auditRows.rows.some((r) => r.actorName === "合成ADMIN"));
  assert.equal(
    (await api("/operations/audit-logs", "GET", undefined, viewer)).status,
    403,
  );
  const i = await sparse();
  await db.outbox.create({
    data: {
      itemId: i.id,
      kind: "ITEM_CHANGED",
      status: "FAILED",
      lastError: "BUSINESS_ERROR",
      payload: {},
    },
  });
  const jobs = await ok("/operations/background-jobs?status=FAILED");
  assert.ok(
    jobs.rows.some(
      (r) =>
        r.itemId === i.id &&
        r.statusLabel === "执行失败" &&
        r.help.includes("业务条件"),
    ),
  );
});

async function testCleanupInput(id) {
  const p = await ok(`/items/${id}/test-cleanup-preview`);
  return {
    version: p.version,
    digest: p.digest,
    typedCode: p.code,
    reason: "仅用于自动化验证的模拟商品",
    noRealTransaction: true,
    noRealPublication: true,
    acknowledgeStatements: true,
  };
}
test("Test scope is explicit, admin-only and not editable through ordinary item patches", async () => {
  const b = { title: "合成测试用途", dataMode: "TEST" };
  assert.equal((await api("/items", "POST", b, operator)).status, 403);
  const i = await ok("/items", "POST", b);
  const row = await ok("/items/" + i.id);
  assert.equal(row.dataMode, "TEST");
  assert.ok(row.testMarkedAt);
  assert.equal((await ok("/items?q=" + i.code)).total, 0);
  assert.equal((await ok("/items?q=" + i.code + "&dataMode=TEST")).total, 1);
  assert.equal(
    (
      await api("/items/" + i.id, "PATCH", {
        version: row.version,
        dataMode: "BUSINESS",
      })
    ).status,
    400,
  );
});
test("Test cleanup preserves simulated sales, refunds, costs and originals while excluding business totals", async () => {
  const i = await ready(),
    p = await listed(i.id);
  const s = await sold(i.id);
  await finance(s.id);
  await ok(`/sales/${s.id}/refund`, "POST", {
    amount: 10000,
    reason: "合成部分退款",
  });
  await ok(`/items/${i.id}/costs`, "POST", {
    kind: "PURCHASE",
    amount: 100000,
    currency: "CNY",
    confirmed: true,
    note: "合成成本",
    occurredAt: new Date().toISOString(),
  });
  const before = await db.sale.findUniqueOrThrow({ where: { id: s.id } }),
    asset = await db.asset.findUniqueOrThrow({ where: { id: i.asset } }),
    observed = (
      await db.listing.findUniqueOrThrow({ where: { id: p.listing } })
    ).observed;
  const body = await testCleanupInput(i.id);
  const result = await ok(`/items/${i.id}/test-cleanup`, "POST", body);
  assert.equal(result.financeRecordsPreserved, true);
  assert.equal(
    (await db.sale.findUniqueOrThrow({ where: { id: s.id } })).refunded,
    before.refunded,
  );
  assert.equal(await db.costEntry.count({ where: { itemId: i.id } }), 1);
  assert.equal(
    (await db.asset.findUniqueOrThrow({ where: { id: i.asset } })).objectKey,
    asset.objectKey,
  );
  assert.equal(
    (await db.listing.findUniqueOrThrow({ where: { id: p.listing } })).observed,
    observed,
  );
  assert.equal((await ok("/sales?q=" + i.code)).length, 0);
  assert.equal((await ok("/sales?dataMode=TEST&q=" + i.code)).length, 1);
  assert.notEqual((await api(`/packages/${p.pack}/usable`)).status, 200);
  const archived = await ok("/items/" + i.id);
  assert.equal(archived.dataMode, "TEST");
  assert.ok(archived.deletedAt);
  await ok(`/items/${i.id}/restore`, "POST", {
    version: archived.version,
    reason: "查看保留的测试数据",
    confirmed: true,
  });
  const restored = await ok("/items/" + i.id);
  assert.equal(restored.dataMode, "TEST");
  assert.equal(restored.status, "PAUSED");
  assert.equal((await ok("/items?q=" + i.code)).total, 0);
});
test("Test cleanup rejects missing declarations, wrong identities, revoked roles and changed previews", async () => {
  const i = await sparse(),
    body = await testCleanupInput(i.id);
  assert.equal(
    (await api(`/items/${i.id}/test-cleanup`, "POST", body, operator)).status,
    403,
  );
  assert.equal(
    (
      await api(`/items/${i.id}/test-cleanup`, "POST", {
        ...body,
        noRealTransaction: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api(`/items/${i.id}/test-cleanup`, "POST", {
        ...body,
        typedCode: "TM000000",
      })
    ).status,
    400,
  );
  await ok(`/items/${i.id}/costs`, "POST", {
    kind: "PREPARATION",
    amount: 100,
    currency: "CNY",
    confirmed: false,
    note: "预览后新增合成成本",
    occurredAt: new Date().toISOString(),
  });
  const stale = await api(`/items/${i.id}/test-cleanup`, "POST", body);
  assert.equal(stale.data.error.code, "TEST_PREVIEW_STALE");
  assert.equal((await ok("/items/" + i.id)).dataMode, "BUSINESS");
  assert.equal((await ok("/items/" + i.id)).deletedAt, null);
});
test("Concurrent test cleanup and sale cannot silently turn a new actual-operation record into a test record", async () => {
  const i = await sparse(),
    body = await testCleanupInput(i.id);
  const [a, b] = await Promise.all([
    api(`/items/${i.id}/test-cleanup`, "POST", body),
    api(`/items/${i.id}/sold`, "POST", { channel: "合成并发渠道" }),
  ]);
  assert.ok(
    [a, b].filter((r) => r.status >= 200 && r.status < 300).length === 1,
  );
  const row = await db.item.findUniqueOrThrow({ where: { id: i.id } });
  if (row.dataMode === "TEST")
    assert.equal(await db.sale.count({ where: { itemId: i.id } }), 0);
  else assert.equal(await db.sale.count({ where: { itemId: i.id } }), 1);
});
test("Test inventory is never exposed through public showroom or public image endpoints", async () => {
  const i = await ready({ dataMode: "TEST" }),
    l = await listed(i.id, showChannel, "SHOWROOM");
  const listing = await db.listing.findUniqueOrThrow({
    where: { id: l.listing },
  });
  const publicItems = await ok("/showroom", "GET", undefined, null);
  assert.ok(!publicItems.some((p) => p.id === l.pack));
  const image = await fetch(
    origin + `/api/showroom/${listing.packageId}/image/${i.asset}`,
  );
  assert.notEqual(image.status, 200);
  assert.equal((await ok(`/packages/${l.pack}/usable`)).id, l.pack);
});
test("Isolating a simulated confirmed sale preserves the old statement and supports an explicit correction", async () => {
  const i = await sparse(),
    s = await sold(i.id);
  await finance(s.id);
  await db.sale.update({
    where: { id: s.id },
    data: { soldAt: new Date("2032-03-03T12:00:00Z") },
  });
  const ref = "SYNTHETIC-ARCHIVE-" + randomUUID();
  const rule = await ok("/settlements/rules", "POST", {
    name: "合成隔离更正规则",
    agreementRef: ref,
    basisPoints: 3000,
    effectiveFrom: "2032-01-01T00:00:00Z",
    effectiveTo: "2033-01-01T00:00:00Z",
  });
  await ok(`/settlements/rules/${rule.id}/activate`, "POST", {
    confirmed: true,
    agreementRef: ref,
  });
  const period = {
    ruleId: rule.id,
    periodStart: "2032-03-01T00:00:00Z",
    periodEnd: "2032-04-01T00:00:00Z",
    currency: "CNY",
  };
  const preview = await ok("/settlements/preview", "POST", period);
  await ok(`/settlements/${preview.id}/confirm`, "POST", {
    digest: preview.digest,
    confirmed: true,
  });
  const before = await db.settlementStatement.findUniqueOrThrow({
      where: { id: preview.id },
    }),
    body = await testCleanupInput(i.id);
  assert.equal(
    (
      await api(`/items/${i.id}/test-cleanup`, "POST", {
        ...body,
        acknowledgeStatements: false,
      })
    ).data.error.code,
    "TEST_STATEMENT_ACK_REQUIRED",
  );
  await ok(`/items/${i.id}/test-cleanup`, "POST", body);
  assert.deepEqual(
    (
      await db.settlementStatement.findUniqueOrThrow({
        where: { id: preview.id },
      })
    ).snapshot,
    before.snapshot,
  );
  assert.equal((await ok("/settlements/" + preview.id)).isolatedTestLines, 1);
  const correction = await ok("/settlements/preview", "POST", {
      ...period,
      baseId: preview.id,
    }),
    detail = await ok("/settlements/" + correction.id);
  assert.equal(detail.snapshot.summary.profit, 0);
  assert.equal(detail.snapshot.delta.profit, -90000);
  await ok(`/settlements/${correction.id}/confirm`, "POST", {
    digest: correction.digest,
    confirmed: true,
  });
});
test("Audit search understands operator names, product names and human TM codes", async () => {
  const i = await sparse({ title: "操作记录精准搜索-" + randomUUID() });
  const byCode = await ok("/operations/audit-logs?q=" + i.code),
    byTitle = await ok(
      "/operations/audit-logs?q=" +
        encodeURIComponent((await ok("/items/" + i.id)).title),
    );
  assert.ok(
    byCode.rows.some(
      (r) => r.resourceId === i.id && r.action === "ITEM_CREATED",
    ),
  );
  assert.ok(byTitle.rows.some((r) => r.resourceId === i.id));
  const byActor = await ok(
    "/operations/audit-logs?q=" + encodeURIComponent("合成ADMIN"),
  );
  assert.ok(byActor.rows.length > 0);
  assert.ok(byActor.rows.every((r) => r.actorName === "合成ADMIN"));
  const injection = await ok(
    "/operations/audit-logs?q=" + encodeURIComponent("' OR 1=1 --"),
  );
  assert.equal(injection.total, 0);
});

async function studioPlan(id){return ok(`/items/${id}/studio?channelId=${channel.id}`,'GET');}
function reviewBody(plan,ids){return {version:plan.version,digest:plan.digest,assetIds:ids,authorizationNote:'合成审查：本人核对实拍及公开使用权',confirmed:true};}
test('Studio preview works before approval but does not publish or silently verify anything',async()=>{
 const i=await sparse({brand:'Dior',facts:{condition:'袖口磨损',descriptionZh:'如实披露的样本'}}),a=await upload(i.id),p=await studioPlan(i.id);
 assert.equal(p.previewOnly,true);assert.ok(p.preview.body.includes('袖口磨损'));assert.equal(p.canReview,true);assert.equal((await item(i.id)).approvedValid,false);assert.equal((await db.asset.findUnique({where:{id:a.id}})).verified,false);assert.equal(await db.usePackage.count({where:{itemId:i.id}}),0);
});
test('Studio review combines explicit selection and shared item approval in one atomic audited command',async()=>{
 const i=await sparse({brand:'Dior'}),a=await upload(i.id),p=await studioPlan(i.id),key=randomUUID(),body=reviewBody(p,[a.id]);
 const r=await ok(`/items/${i.id}/review-for-use`,'POST',body,admin,key);await ok(`/items/${i.id}/review-for-use`,'POST',body,admin,key);
 assert.ok(r.approvedId);assert.equal((await item(i.id)).approvedValid,true);assert.equal((await db.asset.findUnique({where:{id:a.id}})).rights,'PUBLIC');assert.equal(await db.audit.count({where:{action:'STUDIO_REVIEW_CONFIRMED',resourceId:i.id}}),1);assert.equal(await db.listing.count({where:{itemId:i.id}}),0);
});
test('Studio review refuses operator authority, changed metadata and foreign-item image substitutions',async()=>{
 const i=await sparse({brand:'Dior'}),a=await upload(i.id),p=await studioPlan(i.id),j=await sparse(),foreign=await upload(j.id);
 assert.equal((await api(`/items/${i.id}/review-for-use`,'POST',reviewBody(p,[a.id]),operator)).status,403);
 assert.equal((await api(`/items/${i.id}/review-for-use`,'POST',reviewBody(p,[foreign.id]))).status,400);
 await ok(`/assets/${a.id}/classify`,'POST',{role:'DEFECT',reason:'标记合成瑕疵样本'});
 assert.equal((await api(`/items/${i.id}/review-for-use`,'POST',reviewBody(p,[a.id]))).status,409);assert.equal((await item(i.id)).approvedValid,false);
});
test('Studio cannot promote revoked, expired, AI or reference images through the shorter flow',async()=>{
 for(const change of [{rights:'REVOKED'},{validUntil:new Date(1)},{origin:'AI',role:'AI_MARKETING'},{origin:'REFERENCE',role:'REFERENCE'}]){
 const i=await sparse(),a=await upload(i.id);await db.asset.update({where:{id:a.id},data:change});const p=await studioPlan(i.id);
 assert.ok(p.assets[0].blockedReason);assert.equal((await api(`/items/${i.id}/review-for-use`,'POST',reviewBody(p,[a.id]))).status,400);assert.equal((await item(i.id)).approvedValid,false);
 }
});
test('Studio review cannot omit marked defects and does not overwrite existing authorized image evidence',async()=>{
 const i=await sparse(),a=await upload(i.id),b=await upload(i.id);await ok(`/assets/${b.id}/classify`,'POST',{role:'DEFECT',reason:'合成瑕疵图'});await assetReview(a.id,{sourceNote:'原始授权依据保留'});const p=await studioPlan(i.id);
 assert.equal((await api(`/items/${i.id}/review-for-use`,'POST',reviewBody(p,[a.id]))).status,400);
 await ok(`/items/${i.id}/review-for-use`,'POST',reviewBody(p,[a.id,b.id]));assert.equal((await db.asset.findUnique({where:{id:a.id}})).sourceNote,'原始授权依据保留');
});

function trrSample(procurementSourceId){
  const rows=[
    ["WDI571039","Diane von Furstenberg","Silk Midi Length Dress",19500],
    ["WDI581338","Diane von Furstenberg","Wool Knee-Length Dress",12500],
    ["GIO194599","Giorgio Armani","Virgin Wool Houndstooth Print Blazer",6500],
    ["WDI580085","Diane von Furstenberg","Nylon Long Dress",19500],
    ["LAN245875","Lanvin","Linen Mini Dress",13500],
    ["LAN244886","Lanvin","Silk Knee-Length Dress w/ Tags",21000],
    ["LAN245375","Lanvin","Silk Knee-Length Dress",17500],
  ];
  const lines=rows.map(([sku,brand,title,lineAmount])=>({
    lineKey:sku,sourceSku:sku,title,brandRaw:brand,categoryRaw:"Women / Clothing / Dresses",
    productUrl:`https://example.invalid/trr/${sku}`,currency:"USD",lineAmount,
    sourceCurrentPrice:null,sourceEstimatedRetail:null,sourceConditionRaw:"",sourceStatusRaw:"",
    sizeLabelRaw:"",colorRaw:"",materialRaw:"",measurements:{},measurementsEstimated:false,
    descriptionRaw:"",imageUrls:[],rawPayload:{synthetic:true},
  }));
  Object.assign(lines[0],{sourceCurrentPrice:7800,sourceEstimatedRetail:40000,sourceConditionRaw:"Excellent",sourceStatusRaw:"Sold",sizeLabelRaw:"XL",colorRaw:"Blue",materialRaw:"100% Silk; Lining 97% Polyester, 3% Spandex",measurements:{Bust:"37 in",Waist:"29 in",Hip:"29 in",Length:"44.5 in"},measurementsEstimated:true,descriptionRaw:"Synthetic TRR detail sample",imageUrls:["https://example.invalid/1.jpg","https://example.invalid/2.jpg","https://example.invalid/3.jpg"]});
  return {procurementSourceId,externalOrderNo:"R648780020",orderedAt:"2026-06-27T12:00:00.000Z",sourceStatusRaw:"Shipped",returnabilityRaw:"Not returnable",currency:"USD",subtotalAmount:110000,totalAmount:70200,paymentAmount:70200,rawPayload:{synthetic:true},lines,
    adjustments:[
      {adjustmentKey:"SHIPPING",kind:"SHIPPING",label:"Shipping",amount:6000,currency:"USD"},
      {adjustmentKey:"STORE_CREDIT",kind:"STORE_CREDIT",label:"Store Credit",amount:-7500,currency:"USD"},
      {adjustmentKey:"DISC_60",kind:"DISCOUNT",label:"60% Off Women's",amount:-11700,currency:"USD"},
      {adjustmentKey:"DISC_20",kind:"DISCOUNT",label:"20% Off Women's",amount:-3800,currency:"USD"},
      {adjustmentKey:"DISC_30",kind:"DISCOUNT",label:"30% Off Women's",amount:-17400,currency:"USD"},
      {adjustmentKey:"DISC_40",kind:"DISCOUNT",label:"40% Off Women's",amount:-5400,currency:"USD"},
    ],
    shipments:[
      {shipmentKey:"PKG-A",externalShipmentRef:"SYN-A",carrier:"Synthetic Carrier",statusRaw:"Shipped",shippedAt:"2026-06-28T12:00:00.000Z",deliveredAt:null,lineKeys:["WDI571039","WDI581338","GIO194599"],rawPayload:{synthetic:true}},
      {shipmentKey:"PKG-B",externalShipmentRef:"SYN-B",carrier:"Synthetic Carrier",statusRaw:"Shipped",shippedAt:"2026-06-28T12:00:00.000Z",deliveredAt:null,lineKeys:["WDI580085","LAN245875","LAN244886","LAN245375"],rawPayload:{synthetic:true}},
    ],returns:[]};
}

test("采购订单保留TRR原始事实，不把平台状态和价格偷换成本地库存或成本",async()=>{
  const before={items:await db.item.count(),sources:await db.source.count(),costs:await db.costEntry.count(),confirmed:await db.purchaseCostConfirmation.count()};
  const source=await ok("/procurement/sources","POST",{code:"TRR",name:"The RealReal",kind:"MARKETPLACE",defaultCurrency:"USD",notes:"合成测试来源"});
  const input=trrSample(source.id),first=await ok("/procurement/orders/import","POST",input),second=await ok("/procurement/orders/import","POST",input,admin,randomUUID());
  assert.equal(first.lineCount,7);assert.equal(second.unchanged,true);
  const order=await ok("/procurement/orders/"+first.id);
  assert.equal(order.lines.length,7);assert.equal(order.shipments.length,2);assert.equal(order.adjustments.length,6);
  assert.equal(order.lines.reduce((s,x)=>s+x.lineAmount,0),110000);
  assert.equal(order.totalAmount,70200);assert.equal(order.lines[0].lineAmount,19500);
  assert.equal(order.lines[0].sourceCurrentPrice,7800);assert.equal(order.lines[0].sourceEstimatedRetail,40000);
  assert.equal(order.lines[0].sourceConditionRaw,"Excellent");assert.equal(order.lines[0].businessDecision,"UNDECIDED");assert.equal(order.lines[0].possession,"UNKNOWN");
  assert.equal(await db.item.count(),before.items);assert.equal(await db.source.count(),before.sources);assert.equal(await db.costEntry.count(),before.costs);assert.equal(await db.purchaseCostConfirmation.count(),before.confirmed);
});
test("采购订单行只有人工确认在手且纳入经营后才能进入货源池，并自动关联TM",async()=>{
  const code="TRR"+randomUUID().replace(/-/g,"").slice(0,6).toUpperCase();
  const source=await ok("/procurement/sources","POST",{code,name:"Synthetic marketplace",kind:"MARKETPLACE",defaultCurrency:"USD"});
  const imported=await ok("/procurement/orders/import","POST",trrSample(source.id));
  let order=await ok("/procurement/orders/"+imported.id),line=order.lines.find(x=>x.sourceSku==="WDI571039");
  assert.equal((await api(`/procurement/lines/${line.id}/source-candidate`,"POST",{})).status,400);
  await ok(`/procurement/lines/${line.id}/review`,"POST",{version:line.version,businessDecision:"INCLUDE",possession:"IN_HAND",reviewNote:"合成测试：人工确认实物在手并纳入经营"});
  const candidate=await ok(`/procurement/lines/${line.id}/source-candidate`,"POST",{});
  const raw=await db.source.findUniqueOrThrow({where:{id:candidate.id}});
  assert.equal(raw.purchaseLineId,line.id);assert.equal(raw.payload.ownership,"OWN");
  assert.equal(raw.payload.sourceConditionRaw,"Excellent");assert.equal(raw.payload.sourceLineAmount,19500);
  assert.equal(raw.payload.category,"CLOTHING");assert.equal(raw.payload.sourceCategoryRaw,"Women / Clothing / Dresses");
  assert.equal(raw.payload.quotedCost,undefined);
  const itemCreated=await ok("/items","POST",{sourceId:candidate.id,title:line.title,brand:line.brandRaw,category:"CLOTHING"});
  const itemRow=await item(itemCreated.id);
  assert.equal(itemRow.facts.conditionGrade,"");
  assert.equal((await db.itemPurchaseLink.findUniqueOrThrow({where:{purchaseLineId:line.id}})).itemId,itemCreated.id);
  order=await ok("/procurement/orders/"+imported.id);
  assert.equal(order.lines.find(x=>x.id===line.id).itemLink.item.id,itemCreated.id);
});
test("人民币采购成本必须人工确认，不能从美元订单金额或平台现价自动生成",async()=>{
  const code="COST"+randomUUID().replace(/-/g,"").slice(0,6).toUpperCase();
  const source=await ok("/procurement/sources","POST",{code,name:"Cost source",kind:"MARKETPLACE",defaultCurrency:"USD"});
  const imported=await ok("/procurement/orders/import","POST",trrSample(source.id));
  const order=await ok("/procurement/orders/"+imported.id),line=order.lines.find(x=>x.sourceSku==="WDI571039");
  assert.equal(await db.purchaseCostConfirmation.count({where:{purchaseLineId:line.id}}),0);
  const costEntriesBefore=await db.costEntry.count();
  const c1=await ok(`/procurement/lines/${line.id}/cost-confirmations`,"POST",{amountCny:123456,basis:"ACTUAL_CNY_OUTLAY",note:"合成人民币支付凭证核对结果"});
  assert.equal(await db.costEntry.count(),costEntriesBefore);
  const conflict=await api(`/procurement/lines/${line.id}/cost-confirmations`,"POST",{amountCny:120000,basis:"CONFIRMED_BATCH_FX",note:"另一种算法"});
  assert.equal(conflict.status,409);
  await ok(`/procurement/cost-confirmations/${c1.id}/void`,"POST",{reason:"合成测试：发现凭证录入错误"});
  const c2=await ok(`/procurement/lines/${line.id}/cost-confirmations`,"POST",{amountCny:120000,basis:"CONFIRMED_BATCH_FX",note:"合成测试：经营者确认批次汇率后换算"});
  assert.notEqual(c1.id,c2.id);
  const active=await db.purchaseCostConfirmation.findMany({where:{purchaseLineId:line.id,voidedAt:null}});
  assert.equal(active.length,1);assert.equal(active[0].amountCny,120000);
});
test("采购来源再次导入只更新来源事实，保留人工经营判断并追加修订",async()=>{
  const code="REV"+randomUUID().replace(/-/g,"").slice(0,6).toUpperCase();
  const source=await ok("/procurement/sources","POST",{code,name:"Revision source",kind:"MARKETPLACE",defaultCurrency:"USD"});
  const original=trrSample(source.id),first=await ok("/procurement/orders/import","POST",original);
  let order=await ok("/procurement/orders/"+first.id),line=order.lines.find(x=>x.sourceSku==="WDI571039");
  await ok(`/procurement/lines/${line.id}/review`,"POST",{version:line.version,businessDecision:"INCLUDE",possession:"IN_HAND",reviewNote:"人工经营判断不能被平台刷新覆盖"});
  const changed=structuredClone(original);changed.lines[0].sourceCurrentPrice=7600;changed.lines[0].sourceStatusRaw="Sold / observed later";
  const second=await ok("/procurement/orders/import","POST",changed,admin,randomUUID());
  assert.equal(second.version,2);
  order=await ok("/procurement/orders/"+first.id);line=order.lines.find(x=>x.sourceSku==="WDI571039");
  assert.equal(line.sourceCurrentPrice,7600);assert.equal(line.businessDecision,"INCLUDE");assert.equal(line.possession,"IN_HAND");
  assert.equal(line.reviewNote,"人工经营判断不能被平台刷新覆盖");
  const revisions=await ok(`/procurement/lines/${line.id}/revisions`);
  assert.equal(revisions.length,2);assert.equal(order.revisions.length,2);
});

test("取消、RMA和平台Sold均只保留为来源事实，不自动改变本地库存",async()=>{
  const code="RET"+randomUUID().replace(/-/g,"").slice(0,6).toUpperCase();
  const source=await ok("/procurement/sources","POST",{code,name:"Return source",kind:"MARKETPLACE",defaultCurrency:"USD"});
  const itemLinksBefore=await db.item.count({where:{sourceId:{not:null}}});
  const input=trrSample(source.id);input.externalOrderNo="RMA-SYN";input.sourceStatusRaw="Canceled";input.returns=[{returnKey:"RMA785170468",externalReturnRef:"RMA785170468",statusRaw:"Opened",openedAt:"2026-07-06T12:00:00.000Z",lineKeys:["WDI571039"],rawPayload:{synthetic:true}}];
  const imported=await ok("/procurement/orders/import","POST",input),order=await ok("/procurement/orders/"+imported.id);
  assert.equal(order.sourceStatusRaw,"Canceled");assert.equal(order.returns.length,1);assert.equal(order.returns[0].lines.length,1);
  assert.equal(await db.item.count({where:{sourceId:{not:null}}}),itemLinksBefore);
  const line=order.lines.find(x=>x.sourceSku==="WDI571039");assert.equal(line.sourceStatusRaw,"Sold");assert.equal(line.businessDecision,"UNDECIDED");
});
async function machineApi(path,token,method='GET',body,key=randomUUID()){
  const headers={'X-Ingest-Token':token,'Idempotency-Key':key};
  if(body!==undefined&&!(body instanceof FormData))headers['Content-Type']='application/json';
  const r=await fetch(origin+'/api'+path,{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  return {status:r.status,data:await r.json().catch(()=>null),headers:r.headers};
}
async function machineOk(path,token,method='GET',body,key){
  const r=await machineApi(path,token,method,body,key);
  assert.ok(r.status>=200&&r.status<300,`${method} ${path} ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function distributionAgentApi(path,token,method='GET',body){
  const headers={'X-Distribution-Token':token};
  if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(origin+(path.startsWith('/api/')?path:'/api'+path),{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json().catch(()=>null),headers:r.headers};
}
async function distributionAgentOk(path,token,method='GET',body){
  const r=await distributionAgentApi(path,token,method,body);
  assert.ok(r.status>=200&&r.status<300,`${method} ${path} ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function distributionBearerApi(path,token,method='GET',body){
  const headers={Authorization:'Bearer '+token};
  if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(origin+(path.startsWith('/api/')?path:'/api'+path),{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await r.text();
  let data=null;
  try { data=JSON.parse(raw||'null'); } catch {}
  return {status:r.status,data,raw,headers:r.headers};
}
async function distributionHandoffApi(path,token,method='GET',body,key=randomUUID()){
  const headers={'X-Distribution-Token':token,'Idempotency-Key':key};
  if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(origin+'/api/distribution-agent'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json().catch(()=>null),headers:r.headers};
}
async function distributionHandoffOk(path,token,method='GET',body,key){
  const r=await distributionHandoffApi(path,token,method,body,key);
  assert.ok(r.status>=200&&r.status<300,`${method} ${path} ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function distributionSession(channelId=channel.id,label='合成分发会话'){
  return ok('/distribution/sessions','POST',{channelId,label,agentName:'synthetic-distribution-agent',expiresAt:future()});
}
async function mcpApi(token, body, extra={}){
  const r=await fetch(origin+'/api/mcp/ingest',{method:'POST',headers:{'X-Ingest-Token':token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  return {status:r.status,data:await r.json().catch(()=>null)};
}
async function mcpBearerApi(token, body, extra={}){
  const r=await fetch(origin+'/api/mcp/ingest',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  return {status:r.status,data:await r.json().catch(()=>null)};
}
async function mcpTool(token,name,args={},id=randomUUID()){
  const r=await mcpApi(token,{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.ok(r.data?.result?.content?.[0],JSON.stringify(r.data));
  return {isError:!!r.data.result.isError,value:JSON.parse(r.data.result.content[0].text)};
}
async function distributionMcpApi(token, body, extra={}){
  const r=await fetch(origin+'/api/mcp/distribution',{method:'POST',headers:{'X-Distribution-Token':token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  return {status:r.status,data:await r.json().catch(()=>null)};
}
async function distributionMcpBearerApi(token, body, extra={}){
  const r=await fetch(origin+'/api/mcp/distribution',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  return {status:r.status,data:await r.json().catch(()=>null)};
}
async function distributionMcpTool(token,name,args={},id=randomUUID()){
  const r=await distributionMcpApi(token,{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.ok(r.data?.result?.content?.[0],JSON.stringify(r.data));
  return {isError:!!r.data.result.isError,value:JSON.parse(r.data.result.content[0].text)};
}
function goldenIngestFixture(){
  return JSON.parse(readFileSync('test/fixtures/tome-ingest/trr-v1.2-golden.json','utf8'));
}
function standardManifest(profile='GENERIC_MARKETPLACE/1.0', extra={}){
  return {...extra,protocolVersion:'1.2',skillVersion:'tome-ingest/1.0',profile};
}
const genericProfileFields=[
  ['titleRaw','商品名称'],['sourceItemKey','来源货号'],['brandRaw','来源品牌'],['categoryRaw','来源品类'],['conditionRaw','来源成色'],['sourceFacts.sizeLabel','标签尺码'],['sourceFacts.productUrl','来源页面'],['sourceFacts.description','来源描述'],['sourceCurrentPrice','来源当前价'],
];
function readCandidatePath(candidate,path){
  return path.split('.').reduce((value,key)=>value&&typeof value==='object'?value[key]:undefined,candidate);
}
function hasCandidateValue(value){
  return value!==null&&value!==undefined&&value!==''&&(!Array.isArray(value)||value.length>0)&&(typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>0);
}
function standardizeGenericCandidate(candidate,key=candidate.externalKey){
  const sourceFacts=candidate.sourceFacts&&typeof candidate.sourceFacts==='object'?candidate.sourceFacts:{}, existing=sourceFacts.capture&&typeof sourceFacts.capture==='object'?sourceFacts.capture:{}, fields=Array.isArray(existing.fields)?[...existing.fields]:[];
  for(const [path,label] of genericProfileFields) if(!fields.some(field=>field.path===path)){
    const value=readCandidatePath(candidate,path);
    fields.push(hasCandidateValue(value)?{path,label,status:'CAPTURED'}:{path,label,status:'UNAVAILABLE',reason:'合成来源未提供该字段'});
  }
  const capture={...existing,capturedAt:existing.capturedAt||'2026-09-17T00:00:00.000Z',fields,images:Array.isArray(existing.images)?existing.images:[]};
  if(!capture.pageUrl&&!capture.fileEvidence) capture.pageUrl='https://example.invalid/ingest/'+encodeURIComponent(String(key));
  candidate.sourceFacts={...sourceFacts,capture};
  return candidate;
}
function incompleteAcknowledgements(rows,note){
  return Object.fromEntries(rows.map(row=>[row.id,note]));
}
function runCli(args,cwd,env){
  return new Promise((done,reject)=>{
    const child=spawn(process.execPath,[resolve('tools/tome-ingest/cli.mjs'),...args],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);
    child.stderr.on('data',chunk=>stderr+=chunk);
    child.once('error',reject);
    child.once('close',code=>done({code,stdout,stderr}));
  });
}
async function syntheticImage(name='agent.png'){
  return await sharp({create:{width:72,height:96,channels:3,background:{r:180,g:170,b:190}}}).png().toBuffer();
}
async function setupAgentTrr(label='Agent TRR'){
  const code='A'+randomUUID().replace(/-/g,'').slice(0,7).toUpperCase();
  const source=await ok('/procurement/sources','POST',{code,name:label,kind:'MARKETPLACE',defaultCurrency:'USD',notes:'合成Agent来源'});
  const session=await ok('/ingest/sessions','POST',{procurementSourceId:source.id,label:'合成桌面Agent',ttlMinutes:60});
  const orderInput=trrSample(source.id),order=await machineOk('/agent-ingest/orders',session.token,'POST',orderInput);
  const batch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'history-'+randomUUID(),agentName:'Synthetic Desktop Agent',agentVersion:'1.0',kind:'ORDER_HISTORY',rawManifest:standardManifest('GENERIC_MARKETPLACE/1.0',{synthetic:true})});
  const byKey=new Map(order.lines.map(x=>[x.lineKey,x]));
  const candidates=orderInput.lines.map(line=>({
    externalKey:`TRR:${orderInput.externalOrderNo}:${line.lineKey}`,sourceItemKey:line.sourceSku,purchaseLineId:byKey.get(line.lineKey).id,
    titleRaw:line.title,brandRaw:line.brandRaw,categoryRaw:line.categoryRaw,conditionRaw:line.sourceConditionRaw,statusRaw:line.sourceStatusRaw,currency:line.currency,
    sourceLineAmount:line.lineAmount,sourceCurrentPrice:line.sourceCurrentPrice,sourceEstimatedRetail:line.sourceEstimatedRetail,
    sourceFacts:{sizeLabel:line.sizeLabelRaw,color:line.colorRaw,material:line.materialRaw,measurements:line.measurements,descriptionRaw:line.descriptionRaw},rawPayload:{synthetic:true,sku:line.sourceSku},
  }));
  candidates.forEach(standardizeGenericCandidate);
  const imported=await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates});
  return {source,session,orderInput,order,batch,candidates,imported};
}
async function sealAgentBatch(x){
  return machineOk(`/agent-ingest/batches/${x.batch.id}/seal`,x.session.token,'POST',{});
}
function acknowledgedAgentBulkConfirm(x,status='AVAILABLE'){
  return {
    ids:x.imported.rows.map(row=>row.id),
    versions:Object.fromEntries(x.imported.rows.map(row=>[row.id,row.version])),
    possession:'IN_HAND',
    status,
    incompleteAcknowledgements:incompleteAcknowledgements(x.imported.rows,'已核对合成来源缺项'),
  };
}
test('v1.1 标准 Agent 协议校验 Skill/Profile，且服务端 Profile 必查项不能被 Manifest 降低',async()=>{
  const suffix=randomUUID().slice(0,8).toUpperCase(), before=await db.item.count();
  const source=await ok('/procurement/sources','POST',{code:'TRR-'+suffix,name:'标准协议合成来源',kind:'MARKETPLACE',defaultCurrency:'USD'});
  const session=await ok('/ingest/sessions','POST',{procurementSourceId:source.id,label:'标准协议测试',ttlMinutes:60});
  const protocol=await machineOk('/agent-ingest/protocol',session.token);
  assert.equal(protocol.version,'1.2');assert.equal(protocol.skill.id,'tome-ingest/1.0');assert.equal(protocol.profile.id,'TRR/1.0');assert.ok(protocol.profile.requiredFields.includes('sourceFacts.productUrl'));
  const skill=await fetch(origin+'/api/agent-ingest/skill',{headers:{'X-Ingest-Token':session.token}}),profile=await fetch(origin+'/api/agent-ingest/profile',{headers:{'X-Ingest-Token':session.token}});
  const skillMarkdown=await skill.text(),profileMarkdown=await profile.text();
  assert.equal(skill.status,200);assert.match(skill.headers.get('content-type'),/text\/markdown/);assert.match(skillMarkdown,/标准采集 Skill/);assert.equal(createHash('sha256').update(skillMarkdown).digest('hex'),protocol.skill.sha256);
  assert.equal(profile.status,200);assert.match(profileMarkdown,/TRR\/1\.0/);assert.equal(createHash('sha256').update(profileMarkdown).digest('hex'),protocol.profile.sha256);
  const incompatible=await machineApi('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'bad-'+suffix,agentName:'old agent',rawManifest:{protocolVersion:'2.0',skillVersion:'tome-ingest/2.0',profile:'TRR/1.0'}});
  assert.equal(incompatible.status,400);assert.equal(incompatible.data.error.code,'INGEST_PROTOCOL_INCOMPATIBLE');
  const skillMismatch=await machineApi('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'bad-skill-'+suffix,agentName:'old skill agent',rawManifest:{protocolVersion:'1.2',skillVersion:'tome-ingest/2.0',profile:'TRR/1.0'}});
  assert.equal(skillMismatch.status,400);assert.equal(skillMismatch.data.error.code,'INGEST_SKILL_INCOMPATIBLE');
  const missingMetadata=await machineApi('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'missing-'+suffix,agentName:'legacy-shaped new agent',rawManifest:{expectedCandidateKeys:['MISSING-'+suffix]}});
  assert.equal(missingMetadata.status,400);assert.equal(missingMetadata.data.error.code,'INGEST_STANDARD_MANIFEST_REQUIRED');
  const partialMetadata=await machineApi('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'partial-'+suffix,agentName:'partially standard agent',rawManifest:{protocolVersion:'1.2',skillVersion:'tome-ingest/1.0'}});
  assert.equal(partialMetadata.status,400);assert.equal(partialMetadata.data.error.code,'INGEST_STANDARD_MANIFEST_REQUIRED');
  const legacyManifest={importedBeforeStandard:true,externalReference:'legacy-'+suffix};
  const legacy=await db.ingestBatch.create({data:{sessionId:session.id,procurementSourceId:source.id,externalBatchKey:'legacy-'+suffix,agentName:'Historical adapter',agentVersion:'0.9',kind:'ORDER_HISTORY',rawManifest:legacyManifest}});
  const legacyRead=await machineOk(`/agent-ingest/batches/${legacy.id}`,session.token);
  assert.equal(legacyRead.id,legacy.id);
  const legacyRetry=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'legacy-'+suffix,agentName:'Historical adapter',agentVersion:'0.9',kind:'ORDER_HISTORY',rawManifest:legacyManifest});
  assert.equal(legacyRetry.id,legacy.id);assert.equal(legacyRetry.existing,true);
  const fixture=goldenIngestFixture();fixture.batch.externalBatchKey+='-'+suffix;
  const batch=await machineOk('/agent-ingest/batches',session.token,'POST',fixture.batch);
  await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates:fixture.candidates});
  const complete=await machineOk(`/agent-ingest/batches/${batch.id}`,session.token);
  assert.equal(complete.integrity.blockers.length,0);assert.equal((await machineOk(`/agent-ingest/batches/${batch.id}/seal`,session.token,'POST',{})).status,'SEALED');
  const weakBatch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'weak-'+suffix,agentName:'weak agent',rawManifest:{protocolVersion:'1.2',skillVersion:'tome-ingest/1.0',profile:'TRR/1.0',expectedCandidateKeys:['WEAK-'+suffix],requiredFields:['titleRaw']}});
  await machineOk(`/agent-ingest/batches/${weakBatch.id}/candidates`,session.token,'POST',{candidates:[{externalKey:'WEAK-'+suffix,titleRaw:'只报名称的合成商品',sourceFacts:{capture:{pageUrl:'https://example.invalid/weak-'+suffix,capturedAt:'2026-09-17T00:00:00.000Z',fields:[{path:'titleRaw',label:'名称',status:'CAPTURED',reason:''}],images:[]}}}]});
  const weak=await machineOk(`/agent-ingest/batches/${weakBatch.id}`,session.token);
  assert.ok(weak.integrity.blockers.some(x=>x.includes('缺少字段检查：sourceItemKey')));
  const blocked=await machineApi(`/agent-ingest/batches/${weakBatch.id}/seal`,session.token,'POST',{});
  assert.equal(blocked.status,409);assert.equal(blocked.data.error.code,'CAPTURE_INCOMPLETE');
  assert.equal(await db.item.count(),before);
});
test('v1.1 薄 MCP 只复用 IngestService，和 HTTP 写出相同候选事实',async()=>{
  const suffix=randomUUID().slice(0,8).toUpperCase();
  const httpSource=await ok('/procurement/sources','POST',{code:'TRR-H-'+suffix,name:'HTTP Golden 来源',kind:'MARKETPLACE',defaultCurrency:'USD'}),mcpSource=await ok('/procurement/sources','POST',{code:'TRR-M-'+suffix,name:'MCP Golden 来源',kind:'MARKETPLACE',defaultCurrency:'USD'});
  const httpSession=await ok('/ingest/sessions','POST',{procurementSourceId:httpSource.id,label:'HTTP Golden',ttlMinutes:60}),mcpSession=await ok('/ingest/sessions','POST',{procurementSourceId:mcpSource.id,label:'MCP Golden',ttlMinutes:60});
  const init=await mcpApi(mcpSession.token,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'Codex desktop X-header compatibility fixture',version:'1.0'}}});assert.equal(init.status,200);assert.equal(init.data.result.serverInfo.name,'tome-ingest');assert.equal(init.data.result.protocolVersion,'2025-03-26');
  const bearerInit=await mcpBearerApi(mcpSession.token,{jsonrpc:'2.0',id:11,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'WorkBuddy desktop Bearer compatibility fixture',version:'1.0'}}});assert.equal(bearerInit.status,200);assert.equal(bearerInit.data.result.serverInfo.name,'tome-ingest');
  const initialized=await mcpApi(mcpSession.token,{jsonrpc:'2.0',method:'notifications/initialized'});assert.equal(initialized.status,202);assert.equal(initialized.data,null);
  const listed=await mcpApi(mcpSession.token,[{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},{jsonrpc:'2.0',method:'notifications/initialized'}]);assert.equal(listed.status,200);assert.equal(listed.data.length,1);const names=listed.data[0].result.tools.map(x=>x.name).sort();assert.deepEqual(names,['tome_ingest_create_batch','tome_ingest_get_batch_status','tome_ingest_get_protocol','tome_ingest_import_order','tome_ingest_seal_batch','tome_ingest_upsert_candidates']);assert.ok(!names.some(x=>/confirm|item|stock|sale|cost|publish/i.test(x)));
  const bearerListed=await mcpBearerApi(mcpSession.token,{jsonrpc:'2.0',id:12,method:'tools/list',params:{}});assert.equal(bearerListed.status,200);assert.deepEqual(bearerListed.data.result.tools.map(x=>x.name).sort(),names);
  const noStream=await fetch(origin+'/api/mcp/ingest',{headers:{'X-Ingest-Token':mcpSession.token}});assert.equal(noStream.status,405);assert.equal(noStream.headers.get('allow'),'POST');
  const foreignOrigin=await mcpApi(mcpSession.token,{jsonrpc:'2.0',id:3,method:'tools/list',params:{}},{Origin:'https://example.invalid'});assert.equal(foreignOrigin.status,403);assert.equal(foreignOrigin.data.error.code,'MCP_ORIGIN_DENIED');
  const mcpProtocol=await mcpTool(mcpSession.token,'tome_ingest_get_protocol');assert.equal(mcpProtocol.isError,false);assert.equal(mcpProtocol.value.profile.id,'TRR/1.0');
  const mcpMissingMetadata=await mcpTool(mcpSession.token,'tome_ingest_create_batch',{idempotencyKey:'mcp-missing-'+suffix,batch:{externalBatchKey:'mcp-missing-'+suffix,agentName:'metadata-less agent',rawManifest:{synthetic:true}}});assert.equal(mcpMissingMetadata.isError,true);assert.equal(mcpMissingMetadata.value.code,'INGEST_STANDARD_MANIFEST_REQUIRED');
  const fixture=goldenIngestFixture(), httpBatchInput=structuredClone(fixture.batch), mcpBatchInput=structuredClone(fixture.batch);
  httpBatchInput.externalBatchKey+='-http-'+suffix;mcpBatchInput.externalBatchKey+='-mcp-'+suffix;
  const httpBatch=await machineOk('/agent-ingest/batches',httpSession.token,'POST',httpBatchInput);
  await machineOk(`/agent-ingest/batches/${httpBatch.id}/candidates`,httpSession.token,'POST',{candidates:fixture.candidates});
  const orderInput=trrSample(mcpSource.id),orderResult=await mcpTool(mcpSession.token,'tome_ingest_import_order',{idempotencyKey:'mcp-order-'+suffix,order:orderInput});assert.equal(orderResult.isError,false);assert.equal(orderResult.value.lineCount,7);
  const mcpBatch=await mcpTool(mcpSession.token,'tome_ingest_create_batch',{idempotencyKey:'mcp-batch-'+suffix,batch:mcpBatchInput});assert.equal(mcpBatch.isError,false);
  const mcpCandidates=await mcpTool(mcpSession.token,'tome_ingest_upsert_candidates',{idempotencyKey:'mcp-candidates-'+suffix,batchId:mcpBatch.value.id,candidates:fixture.candidates});assert.equal(mcpCandidates.isError,false);assert.equal(mcpCandidates.value.rows.length,1);
  const mcpStatus=await mcpTool(mcpSession.token,'tome_ingest_get_batch_status',{batchId:mcpBatch.value.id});assert.equal(mcpStatus.isError,false);assert.equal(mcpStatus.value.integrity.blockers.length,0);
  const mcpSeal=await mcpTool(mcpSession.token,'tome_ingest_seal_batch',{idempotencyKey:'mcp-seal-'+suffix,batchId:mcpBatch.value.id});assert.equal(mcpSeal.isError,false);assert.equal(mcpSeal.value.status,'SEALED');
  const [httpCandidate,mcpCandidate]=await Promise.all([db.ingestCandidate.findFirstOrThrow({where:{procurementSourceId:httpSource.id,externalKey:fixture.candidates[0].externalKey}}),db.ingestCandidate.findFirstOrThrow({where:{procurementSourceId:mcpSource.id,externalKey:fixture.candidates[0].externalKey}})]);
  assert.deepEqual({titleRaw:httpCandidate.titleRaw,brandRaw:httpCandidate.brandRaw,categoryRaw:httpCandidate.categoryRaw,conditionRaw:httpCandidate.conditionRaw,currency:httpCandidate.currency,sourceFacts:httpCandidate.sourceFacts,rawPayload:httpCandidate.rawPayload},{titleRaw:mcpCandidate.titleRaw,brandRaw:mcpCandidate.brandRaw,categoryRaw:mcpCandidate.categoryRaw,conditionRaw:mcpCandidate.conditionRaw,currency:mcpCandidate.currency,sourceFacts:mcpCandidate.sourceFacts,rawPayload:mcpCandidate.rawPayload});
});
test('v1.1 确定性 tome-ingest CLI 重启后复用本地幂等状态且不保存 Token',async()=>{
  const suffix=randomUUID().slice(0,8).toUpperCase(), dir=mkdtempSync(join(os.tmpdir(),'tome-ingest-cli-'));
  try {
    const source=await ok('/procurement/sources','POST',{code:'CLI'+suffix,name:'CLI 合成来源',kind:'MARKETPLACE',defaultCurrency:'USD'}),session=await ok('/ingest/sessions','POST',{procurementSourceId:source.id,label:'CLI 重启恢复',ttlMinutes:60});
    writeFileSync(join(dir,'batch.json'),JSON.stringify({externalBatchKey:'cli-'+suffix,agentName:'CLI fixture',kind:'ITEM_BATCH',rawManifest:{expectedCandidateKeys:['CLI:'+suffix],requiredFields:['titleRaw']}}));
    const env={TOME_INGEST_BASE_URL:origin+'/api/agent-ingest',TOME_INGEST_TOKEN:session.token};
    const first=await runCli(['batch','create','batch.json'],dir,env),second=await runCli(['batch','create','batch.json'],dir,env);
    assert.equal(first.code,0,first.stderr);assert.equal(second.code,0,second.stderr);
    const firstResult=JSON.parse(first.stdout),secondResult=JSON.parse(second.stdout);assert.equal(firstResult.id,secondResult.id);assert.equal(await db.ingestBatch.count({where:{procurementSourceId:source.id,externalBatchKey:'cli-'+suffix}}),1);
    const state=readFileSync(join(dir,'.tome-ingest-state.json'),'utf8');assert.ok(!state.includes(session.token));const parsed=JSON.parse(state),entries=Object.values(parsed.operations);assert.equal(entries.length,1);assert.match(entries[0].idempotencyKey,/^[0-9a-f-]{36}$/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('v1 Agent短期Token只能写采集层，重复抓取同一商品只追加修订不制造TM',async()=>{
  const before=await db.item.count(),x=await setupAgentTrr('Agent scope source');
  assert.equal(x.imported.rows.length,7);assert.equal(await db.item.count(),before);
  assert.equal((await machineApi('/items',x.session.token)).status,401);
  assert.equal((await machineApi('/agent-ingest/batches/'+x.batch.id,x.session.token)).status,200);
  const first=x.candidates[0],candidate=x.imported.rows[0],changed={...first,sourceCurrentPrice:7600,statusRaw:'Sold / observed later'};
  const rerun=await machineOk(`/agent-ingest/batches/${x.batch.id}/candidates`,x.session.token,'POST',{candidates:[changed]});
  assert.equal(rerun.rows[0].id,candidate.id);assert.equal(rerun.rows[0].version,2);
  assert.equal(await db.ingestCandidate.count({where:{procurementSourceId:x.source.id,externalKey:first.externalKey}}),1);
  assert.equal(await db.ingestCandidateRevision.count({where:{candidateId:candidate.id}}),2);
});
test('v1 Agent候选图片持久入库，封批后禁止继续写，重复上传不重复候选素材',async()=>{
  const x=await setupAgentTrr('Agent image source'),candidate=x.imported.rows[0],image=await syntheticImage();
  const fd=new FormData();fd.set('sourceUrl','https://example.invalid/source-image.jpg');fd.set('roleHint','PRODUCT');fd.set('file',new Blob([image],{type:'image/png'}),'agent-source.png');
  const key=randomUUID(),first=await machineApi(`/agent-ingest/candidates/${candidate.id}/assets`,x.session.token,'POST',fd,key);
  assert.equal(first.status,201);const saved=first.data;
  const fd2=new FormData();fd2.set('sourceUrl','https://example.invalid/source-image.jpg');fd2.set('roleHint','PRODUCT');fd2.set('file',new Blob([image],{type:'image/png'}),'agent-source.png');
  const replay=await machineApi(`/agent-ingest/candidates/${candidate.id}/assets`,x.session.token,'POST',fd2,key);
  assert.equal(replay.status,201);assert.equal(replay.data.id,saved.id);assert.equal(await db.ingestCandidateAsset.count({where:{candidateId:candidate.id}}),1);
  await machineOk(`/agent-ingest/batches/${x.batch.id}/seal`,x.session.token,'POST',{});
  const blocked=await machineApi(`/agent-ingest/batches/${x.batch.id}/candidates`,x.session.token,'POST',{candidates:[x.candidates[1]]});
  assert.equal(blocked.status,409);assert.equal((await machineOk(`/agent-ingest/batches/${x.batch.id}`,x.session.token)).status,'SEALED');
});
test('v1 批量确认把候选一次生成TM，来源Sold/Excellent/颜色不污染本地库存与标准字段',async()=>{
  const before=await db.item.count(),x=await setupAgentTrr('Agent confirm source'),first=x.imported.rows[0];
  const fd=new FormData(),image=await syntheticImage('candidate.png');fd.set('sourceUrl','https://example.invalid/trr-1.jpg');fd.set('roleHint','PRODUCT');fd.set('file',new Blob([image],{type:'image/png'}),'candidate.png');
  await machineOk(`/agent-ingest/candidates/${first.id}/assets`,x.session.token,'POST',fd);
  await sealAgentBatch(x);
  const result=await ok('/ingest/candidates/bulk-confirm','POST',acknowledgedAgentBulkConfirm(x));
  assert.equal(result.ok,7);assert.equal(result.failed,0);assert.equal(await db.item.count(),before+7);
  const confirmed=await db.ingestCandidate.findUniqueOrThrow({where:{id:first.id},include:{item:true,assets:{include:{asset:true}}}});
  assert.equal(confirmed.decision,'CONFIRMED');assert.equal(confirmed.item.status,'AVAILABLE');assert.equal(confirmed.item.currency,'CNY');
  const facts=confirmed.item.facts;assert.equal(facts.conditionGrade,'');assert.equal(facts.color,'');assert.equal(facts.attributes.sourceCondition,'Excellent');assert.equal(facts.attributes.sourceColor,'Blue');
  assert.equal(confirmed.assets[0].asset.role,'REFERENCE');assert.equal(confirmed.assets[0].asset.origin,'REFERENCE');assert.equal(confirmed.assets[0].asset.rights,'INTERNAL');assert.equal(confirmed.assets[0].asset.verified,false);
  assert.equal(await db.itemSourceLink.count({where:{itemId:confirmed.item.id}}),1);assert.equal((await db.itemPurchaseLink.findUniqueOrThrow({where:{purchaseLineId:confirmed.purchaseLineId}})).itemId,confirmed.item.id);
});
test('v1 未识别品牌不会阻断生成TM，标准品牌留空而原始品牌完整保存在来源证据',async()=>{
  const x=await setupAgentTrr('Agent unknown brand source'),candidate=x.imported.rows[1],changed={...x.candidates[1],brandRaw:'UNKNOWN ARCHIVE BRAND 2099'};
  const up=await machineOk(`/agent-ingest/batches/${x.batch.id}/candidates`,x.session.token,'POST',{candidates:[changed]});
  const row=await db.ingestCandidate.findUniqueOrThrow({where:{id:up.rows[0].id}});assert.ok(row.warnings.some(w=>w.includes('尚未标准化')));
  await sealAgentBatch(x);
  const result=await ok(`/ingest/candidates/${row.id}/confirm`,'POST',{version:row.version,possession:'IN_HAND',status:'AVAILABLE',acceptIncomplete:true,note:'确认实物并先入库，品牌以后标准化'});
  const itemRow=await item(result.itemId);assert.equal(itemRow.brand,'');assert.equal(itemRow.status,'AVAILABLE');
  const source=await db.source.findUniqueOrThrow({where:{id:itemRow.sourceId}});assert.equal(source.payload.brandRaw,'UNKNOWN ARCHIVE BRAND 2099');
});
test('v1 TRR成本按原价比例分摊经济支付价值并均摊每单¥200，最终人民币成本严格闭合',async()=>{
  const x=await setupAgentTrr('TRR costing source');await sealAgentBatch(x);await ok('/ingest/candidates/bulk-confirm','POST',acknowledgedAgentBulkConfirm(x));
  const source=await db.procurementSource.findUniqueOrThrow({where:{id:x.source.id}});
  await ok(`/costing/sources/${source.id}/policy`,'POST',{version:source.version,orderOverheadCny:20000,costAllocationMethod:'PROPORTIONAL_LINE_AMOUNT',storeCreditAsPayment:true,note:'TRR确认规则：每单200元平均附加成本'});
  const basis=await ok(`/costing/orders/${x.order.id}/basis`,'POST',{version:0,mode:'ACTUAL_CASH_CNY',cashPaidCny:505440,fxMicros:null,foreignEconomicTotalOverride:null,overheadCny:20000,note:'合成测试：$702实际扣款人民币5054.40',confirmed:true});
  const preview=await ok(`/costing/orders/${x.order.id}/preview`);assert.equal(preview.ready,true);assert.equal(preview.foreignEconomicTotal,77700);assert.equal(preview.effectiveFxMicros,7200000);
  assert.equal(preview.economicCny,559440);assert.equal(preview.overheadCny,20000);assert.equal(preview.totalCny,579440);assert.equal(preview.rows.length,7);
  assert.equal(preview.rows.reduce((n,r)=>n+r.purchaseCny,0),559440);assert.equal(preview.rows.reduce((n,r)=>n+r.overheadCny,0),20000);assert.equal(preview.rows.reduce((n,r)=>n+r.totalCny,0),579440);
  assert.ok(Math.max(...preview.rows.map(r=>r.overheadCny))-Math.min(...preview.rows.map(r=>r.overheadCny))<=1);
  const commit=await ok(`/costing/orders/${x.order.id}/commit`,'POST',{basisVersion:basis.version,confirmed:true});assert.equal(commit.totalCny,579440);assert.equal(commit.rows.length,7);
  const active=await db.costEntry.findMany({where:{sourceType:'PROCUREMENT_ORDER',sourceRef:{startsWith:x.order.id+':'},status:'ACTIVE'}});assert.equal(active.length,7);assert.equal(active.reduce((n,r)=>n+r.amount,0),579440);
});
test('v1 RMA或排除商品时自动成本被阻断，必须人工确认本单最终经济支付金额',async()=>{
  const x=await setupAgentTrr('TRR RMA costing');await sealAgentBatch(x);await ok('/ingest/candidates/bulk-confirm','POST',acknowledgedAgentBulkConfirm(x));
  const source=await db.procurementSource.findUniqueOrThrow({where:{id:x.source.id}});await ok(`/costing/sources/${source.id}/policy`,'POST',{version:source.version,orderOverheadCny:20000,costAllocationMethod:'PROPORTIONAL_LINE_AMOUNT',storeCreditAsPayment:true,note:'合成TRR规则'});
  const changed=structuredClone(x.orderInput);changed.returns=[{returnKey:'RMA-SYN-V1',externalReturnRef:'RMA-SYN-V1',statusRaw:'Opened',openedAt:'2026-07-06T12:00:00.000Z',lineKeys:['WDI571039'],rawPayload:{synthetic:true}}];
  await machineOk('/agent-ingest/orders',x.session.token,'POST',changed);
  let basis=await ok(`/costing/orders/${x.order.id}/basis`,'POST',{version:0,mode:'ACTUAL_CASH_CNY',cashPaidCny:505440,fxMicros:null,foreignEconomicTotalOverride:null,overheadCny:20000,note:'有RMA，先保留原扣款等待核对',confirmed:true});
  let preview=await ok(`/costing/orders/${x.order.id}/preview`);assert.equal(preview.ready,false);assert.ok(preview.blockers.some(x=>x.includes('最终经济支付金额')));
  basis=await ok(`/costing/orders/${x.order.id}/basis`,'POST',{version:basis.version,mode:'ACTUAL_CASH_CNY',cashPaidCny:505440,fxMicros:null,foreignEconomicTotalOverride:60000,overheadCny:20000,note:'人工核对RMA后确认最终经济支付为USD600',confirmed:true});
  preview=await ok(`/costing/orders/${x.order.id}/preview`);assert.equal(preview.ready,true);assert.equal(preview.foreignEconomicTotal,60000);assert.equal(preview.totalCny,452000);
});
test('v1 售出自动冻结当时人民币成本，后续采购成本重算不反改历史成交',async()=>{
  const x=await setupAgentTrr('TRR sale snapshot');await sealAgentBatch(x);await ok('/ingest/candidates/bulk-confirm','POST',acknowledgedAgentBulkConfirm(x));
  const source=await db.procurementSource.findUniqueOrThrow({where:{id:x.source.id}});await ok(`/costing/sources/${source.id}/policy`,'POST',{version:source.version,orderOverheadCny:20000,costAllocationMethod:'PROPORTIONAL_LINE_AMOUNT',storeCreditAsPayment:true,note:'合成TRR规则'});
  let basis=await ok(`/costing/orders/${x.order.id}/basis`,'POST',{version:0,mode:'ACTUAL_CASH_CNY',cashPaidCny:505440,fxMicros:null,foreignEconomicTotalOverride:null,overheadCny:20000,note:'首次成本确认',confirmed:true});
  const committed=await ok(`/costing/orders/${x.order.id}/commit`,'POST',{basisVersion:basis.version,confirmed:true}),first=committed.rows[0];
  const saleId=(await sold(first.itemId)).id,saleBefore=await db.sale.findUniqueOrThrow({where:{id:saleId}});assert.equal(saleBefore.cost,first.amount);
  basis=await ok(`/costing/orders/${x.order.id}/basis`,'POST',{version:basis.version,mode:'ACTUAL_CASH_CNY',cashPaidCny:505440,fxMicros:null,foreignEconomicTotalOverride:null,overheadCny:30000,note:'后来核对附加成本改为300元',confirmed:true});
  await ok(`/costing/orders/${x.order.id}/commit`,'POST',{basisVersion:basis.version,confirmed:true});
  const saleAfter=await db.sale.findUniqueOrThrow({where:{id:saleId}}),active=await db.costEntry.findFirstOrThrow({where:{itemId:first.itemId,sourceType:'PROCUREMENT_ORDER',status:'ACTIVE'}});
  assert.equal(saleAfter.cost,saleBefore.cost);assert.notEqual(active.amount,saleAfter.cost);assert.equal(await db.costEntry.count({where:{itemId:first.itemId,sourceType:'PROCUREMENT_ORDER',status:'VOID'}}),1);
});


test('Credit退款无RMA仍须核对，净支付只扣一次且不反改售出快照', async () => {
  const x = await setupAgentTrr('Credit refund synthetic source');
  await sealAgentBatch(x);
  await ok('/ingest/candidates/bulk-confirm', 'POST', acknowledgedAgentBulkConfirm(x));
  const changed = structuredClone(x.orderInput);
  changed.paymentAmount = 30000;
  // Updates retain stable adjustment keys; a new key would intentionally add
  // a second Credit use instead of replacing the fixture's original use.
  changed.adjustments.find(a => a.adjustmentKey === 'STORE_CREDIT').amount = -10000;
  await machineOk('/agent-ingest/orders', x.session.token, 'POST', changed);
  const input = { version: 0, mode: 'ACTUAL_CASH_CNY', cashPaidCny: 216000, fxMicros: null, foreignEconomicTotalOverride: null, overheadCny: 20000, note: '合成支付原始扣款，Credit同等计入', confirmed: true };
  let basis = await ok(`/costing/orders/${x.order.id}/basis`, 'POST', input);
  let preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.effectiveFxMicros, 7200000);
  assert.equal(preview.totalCny, 308000);
  const initial = await ok(`/costing/orders/${x.order.id}/commit`, 'POST', { basisVersion: basis.version, confirmed: true });
  const saleId = (await sold(initial.rows[0].itemId)).id;
  const saleBefore = await db.sale.findUniqueOrThrow({ where: { id: saleId } });
  changed.adjustments.push({ adjustmentKey: 'credit-refund', kind: 'STORE_CREDIT', label: '退回Credit', amount: 5000, currency: 'USD' });
  await machineOk('/agent-ingest/orders', x.session.token, 'POST', changed);
  basis = await ok(`/costing/orders/${x.order.id}/basis`, 'POST', { ...input, version: basis.version });
  preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.ready, false);
  assert.ok(preview.blockers.some(b => b.includes('最终经济支付金额')));
  const refundedLine = x.order.lines.find(l => l.lineKey === 'WDI571039').id;
  const breakdown = { cashPaid: 30000, creditUsed: 10000, cashRefunded: 0, creditRefunded: 5000, lineRefunds: [{ lineId: refundedLine, amount: 5000 }] };
  const invalid = await api(`/costing/orders/${x.order.id}/basis`, 'POST', { ...input, version: basis.version, paymentBreakdown: breakdown, foreignEconomicTotalOverride: 30000 });
  assert.equal(invalid.status, 400);
  assert.equal((await api(`/costing/orders/${x.order.id}/basis`, 'POST', { ...input, version: basis.version, paymentBreakdown: { ...breakdown, lineRefunds: [{ lineId: randomUUID(), amount: 5000 }] } })).status, 400);
  basis = await ok(`/costing/orders/${x.order.id}/basis`, 'POST', { ...input, version: basis.version, paymentBreakdown: breakdown });
  preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.ready, true);
  assert.equal(preview.foreignEconomicTotal, 35000);
  assert.equal(preview.totalCny, 272000);
  for (const row of preview.rows) {
    const before = initial.rows.find(r => r.itemId === row.itemId);
    assert.equal(row.totalCny, before.amount - (row.lineId === refundedLine ? 36000 : 0));
  }
  assert.deepEqual(preview.paymentBreakdown, breakdown);
  const snapshot = await db.purchaseOrderCostBasisRevision.findUniqueOrThrow({ where: { orderId_version: { orderId: x.order.id, version: basis.version } } });
  assert.deepEqual(snapshot.snapshot.paymentBreakdown, breakdown);
  const command = { basisVersion: basis.version, confirmed: true }, key = randomUUID();
  const committed = await ok(`/costing/orders/${x.order.id}/commit`, 'POST', command, admin, key);
  assert.deepEqual(await ok(`/costing/orders/${x.order.id}/commit`, 'POST', command, admin, key), committed);
  await ok(`/costing/orders/${x.order.id}/commit`, 'POST', command);
  const active = await db.costEntry.findMany({ where: { sourceType: 'PROCUREMENT_ORDER', sourceRef: { startsWith: x.order.id + ':' }, status: 'ACTIVE' } });
  assert.equal(active.length, 7);
  assert.equal(active.reduce((n, c) => n + c.amount, 0), 272000);
  assert.equal((await db.sale.findUniqueOrThrow({ where: { id: saleId } })).cost, saleBefore.cost);
  assert.equal((await item(initial.rows[1].itemId)).status, 'AVAILABLE');
  // A later source net amount may not silently change the confirmed FX or net cost.
  changed.paymentAmount = 25000;
  await machineOk('/agent-ingest/orders', x.session.token, 'POST', changed);
  preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.ready, false);
  assert.equal(preview.effectiveFxMicros, 7200000);
  assert.ok(preview.blockers.some(b => b.includes('确认后发生变化')));
  // Explicitly confirmed full Credit refund is zero, not missing money.
  basis = await ok(`/costing/orders/${x.order.id}/basis`, 'POST', { ...input, version: basis.version, paymentBreakdown: { ...breakdown, creditRefunded: 40000, lineRefunds: [] } });
  preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.ready, true);
  assert.equal(preview.effectiveFxMicros, 7200000);
  assert.equal(preview.foreignEconomicTotal, 0);
  assert.equal(preview.totalCny, 20000);
  assert.equal(preview.rows.reduce((n, r) => n + r.purchaseCny, 0), 0);
  basis = await ok(`/costing/orders/${x.order.id}/basis`, 'POST', { ...input, version: basis.version, paymentBreakdown: { ...breakdown, lineRefunds: [{ lineId: x.order.lines.find(l => l.lineKey === 'GIO194599').id, amount: 5000 }] } });
  preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.ready, false);
  assert.equal(preview.rows.length, 0);
  assert.ok(preview.blockers.some(b => b.includes('退款超过')));
});

test('成本的现金与确认汇率模式遵守同一Credit规则，混币种拒绝合计', async () => {
  const x = await setupAgentTrr('Credit policy parity synthetic');
  await sealAgentBatch(x);
  await ok('/ingest/candidates/bulk-confirm', 'POST', acknowledgedAgentBulkConfirm(x));
  const source = await db.procurementSource.findUniqueOrThrow({ where: { id: x.source.id } });
  await ok(`/costing/sources/${source.id}/policy`, 'POST', { version: source.version, orderOverheadCny: 20000, costAllocationMethod: 'PROPORTIONAL_LINE_AMOUNT', storeCreditAsPayment: false, note: '合成其他渠道不计Credit规则' });
  const input = { version: 0, mode: 'ACTUAL_CASH_CNY', cashPaidCny: 505440, fxMicros: null, foreignEconomicTotalOverride: null, overheadCny: 20000, note: '合成实际扣款模式一致性', confirmed: true };
  let basis = await ok(`/costing/orders/${x.order.id}/basis`, 'POST', input);
  let preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.totalCny, 525440);
  basis = await ok(`/costing/orders/${x.order.id}/basis`, 'POST', { ...input, version: basis.version, mode: 'CONFIRMED_FX', fxMicros: 7200000, cashPaidCny: null });
  preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.totalCny, 525440);
  const changed = structuredClone(x.orderInput);
  changed.adjustments[0].currency = 'EUR';
  await machineOk('/agent-ingest/orders', x.session.token, 'POST', changed);
  basis = await ok(`/costing/orders/${x.order.id}/basis`, 'POST', { ...input, version: basis.version, fxMicros: 7200000 });
  preview = await ok(`/costing/orders/${x.order.id}/preview`);
  assert.equal(preview.ready, false);
  assert.ok(preview.blockers.some(b => b.includes('不同币种')));
  const result = await api(`/costing/orders/${x.order.id}/commit`, 'POST', { basisVersion: basis.version, confirmed: true });
  assert.equal(result.status, 400);
});

test("Cost Batch：一个请求返回当前页各订单的同一成本预览", async () => {
  const x = await setupAgentTrr("Cost batch preview synthetic");
  const single = await ok(`/costing/orders/${x.order.id}/preview`);
  const batch = await ok("/costing/orders/previews", "POST", {
    orderIds: [x.order.id],
  });
  assert.deepEqual(batch.rows, [{ orderId: x.order.id, preview: single }]);
  const tooMany = await api("/costing/orders/previews", "POST", {
    orderIds: Array.from({ length: 101 }, () => randomUUID()),
  });
  assert.equal(tooMany.status, 400);
});

test('v1 经营行动中心统一投影候选、任务、询盘、成交补账和事实冲突，并按角色收口敏感事项',async()=>{
  const x=await setupAgentTrr('Action queue source');
  const taskItem=await sparse({title:'行动中心任务商品'}),inquiryItem=await sparse({title:'行动中心询盘商品'}),saleItem=await sparse({title:'行动中心成交商品'}),observationItem=await sparse({title:'行动中心冲突商品'});
  const task=await db.task.create({data:{itemId:taskItem.id,dedupeKey:'action-'+randomUUID(),kind:'RESEARCH',title:'补齐行动中心资料',status:'OPEN',assignee:'',note:''}});
  const inquiry=await ok('/inquiries','POST',{itemId:inquiryItem.id,channel:'合成微信',customerRef:'行动中心客户',notes:'等待回复',quote:null,currency:'CNY'});
  const sale=await sold(saleItem.id);
  const observation=await db.observation.create({data:{itemId:observationItem.id,kind:'SYNTHETIC_CONFLICT',payload:{synthetic:true},resolved:false}});
  const queue=await ok('/work-queue');
  assert.ok(queue.summary.total>=5);
  assert.ok(queue.rows.some(r=>r.id===`candidate:${x.imported.rows[0].id}`));
  assert.ok(queue.rows.some(r=>r.id===`task:${task.id}`));
  assert.ok(queue.rows.some(r=>r.id===`inquiry:${inquiry.id}`));
  assert.ok(queue.rows.some(r=>r.id===`sale:${sale.id}`));
  assert.ok(queue.rows.some(r=>r.id===`observation:${observation.id}`));
  for(let i=1;i<queue.rows.length;i++)assert.ok(queue.rows[i-1].priority>=queue.rows[i].priority);
  const viewerQueue=await ok('/work-queue','GET',undefined,viewer);
  assert.equal(viewerQueue.rows.some(r=>r.kind==='INQUIRY'),false);
  assert.equal(viewerQueue.rows.some(r=>r.kind==='SALE_FINANCE'),false);
  assert.equal(viewerQueue.summary.inquiries,0);
  assert.equal(viewerQueue.summary.saleFinance,0);
  const dashboard=await ok('/dashboard');
  assert.ok(dashboard.actionable>=queue.summary.total);
  assert.ok(dashboard.pendingCandidates>=7);
  assert.ok(dashboard.pendingInquiries>=1);
  assert.ok(dashboard.pendingSalesFinance>=1);
});

test("询盘下次跟进时间驱动待办，逾期优先且结束状态清空日程", async () => {
  const i = await sparse(),
    prefix = "FOLLOWUP-" + randomUUID().slice(0, 8),
    create = (customer) =>
      ok("/inquiries", "POST", {
        itemId: i.id,
        channel: prefix,
        customerRef: customer,
      });
  const overdue = await create("逾期客户");
  const missingDate = await api(`/inquiries/${overdue.id}/status`, "POST", {
    version: 1,
    state: "FOLLOWUP",
    notes: "不能没有下次跟进时间",
  });
  assert.equal(missingDate.status, 400);
  await ok(`/inquiries/${overdue.id}/status`, "POST", {
    version: 1,
    state: "FOLLOWUP",
    notes: "已经逾期",
    nextFollowUpAt: new Date(Date.now() - 3600000).toISOString(),
  });

  const upcoming = await create("近期客户"),
    upcomingAt = new Date(Date.now() + 3600000),
    futureInquiry = await create("后续客户");
  await ok(`/inquiries/${upcoming.id}/status`, "POST", {
    version: 1,
    state: "FOLLOWUP",
    notes: "近期确认",
    nextFollowUpAt: upcomingAt.toISOString(),
  });
  await ok(`/inquiries/${futureInquiry.id}/status`, "POST", {
    version: 1,
    state: "FOLLOWUP",
    notes: "后续确认",
    nextFollowUpAt: new Date(Date.now() + 48 * 3600000).toISOString(),
  });
  const open = await create("新询盘客户");
  const queue = await ok(
    "/work-queue?scope=INQUIRY&q=" + encodeURIComponent(prefix),
  );
  const rows = new Map(queue.rows.map((row) => [row.entityId, row]));
  assert.equal(rows.get(overdue.id).priority, 90);
  const shanghaiDay = (date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  assert.equal(
    rows.get(upcoming.id).priority,
    shanghaiDay(upcomingAt) === shanghaiDay(new Date()) ? 85 : 55,
  );
  assert.equal(rows.get(futureInquiry.id).priority, 55);
  assert.equal(rows.get(open.id).priority, 85);

  await ok(`/inquiries/${overdue.id}/status`, "POST", {
    version: 2,
    state: "OPEN",
    notes: "回到待处理",
  });
  assert.equal(
    (await db.inquiry.findUniqueOrThrow({ where: { id: overdue.id } }))
      .nextFollowUpAt,
    null,
  );
  await ok(`/inquiries/${overdue.id}/status`, "POST", {
    version: 3,
    state: "LOST",
    notes: "本次未成交",
  });
  const after = await ok(
    "/work-queue?scope=INQUIRY&q=" + encodeURIComponent(prefix),
  );
  assert.equal(
    after.rows.some((row) => row.entityId === overdue.id),
    false,
  );
});

test('v1.0.0-rc.3 同图候选阻止静默重复建TM，可人工关联已有TM或明确覆盖新建',async()=>{
  const first=await setupAgentTrr('Duplicate source A'),firstCandidate=first.imported.rows[0],marker=randomUUID();
  const image=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="79" height="101"><rect width="79" height="101" fill="#d8d4cc"/><text x="4" y="54" font-size="5">${marker}</text></svg>`)).png().toBuffer();
  let fd=new FormData();fd.set('sourceUrl','https://example.invalid/same-a.jpg');fd.set('roleHint','PRODUCT');fd.set('file',new Blob([image],{type:'image/png'}),'same-a.png');
  await machineOk(`/agent-ingest/candidates/${firstCandidate.id}/assets`,first.session.token,'POST',fd);
  await sealAgentBatch(first);
  const created=await ok(`/ingest/candidates/${firstCandidate.id}/confirm`,'POST',{version:firstCandidate.version,possession:'IN_HAND',status:'AVAILABLE',duplicateOverride:false,acceptIncomplete:true,note:'第一来源确认建档'});
  const firstItem=await item(created.itemId),itemCount=await db.item.count();

  const second=await setupAgentTrr('Duplicate source B'),secondCandidate=second.imported.rows[0];
  fd=new FormData();fd.set('sourceUrl','https://example.invalid/same-b.jpg');fd.set('roleHint','PRODUCT');fd.set('file',new Blob([image],{type:'image/png'}),'same-b.png');
  await machineOk(`/agent-ingest/candidates/${secondCandidate.id}/assets`,second.session.token,'POST',fd);
  await sealAgentBatch(second);
  const listed=await ok(`/ingest/candidates?sourceId=${second.source.id}&decision=PENDING&size=100`),listedRow=listed.rows.find(r=>r.id===secondCandidate.id);
  assert.equal(listedRow.possibleDuplicateCount,1);
  const matches=await ok(`/ingest/candidates/${secondCandidate.id}/matches`);
  assert.ok(matches.some(m=>m.id===firstItem.id&&m.reasons.some(reason=>reason.includes('图片'))));

  const bulk=await ok('/ingest/candidates/bulk-confirm','POST',{ids:[secondCandidate.id],versions:{[secondCandidate.id]:secondCandidate.version},possession:'IN_HAND',status:'AVAILABLE',incompleteAcknowledgements:{[secondCandidate.id]:'已核对合成来源缺项'}});
  assert.equal(bulk.ok,0);assert.equal(bulk.failed,1);assert.match(bulk.rows[0].error,/关联已有TM|另一件实物/);
  assert.equal(await db.item.count(),itemCount);
  const freshSecond=await db.ingestCandidate.findUniqueOrThrow({where:{id:secondCandidate.id}});
  const linked=await ok(`/ingest/candidates/${secondCandidate.id}/link-item`,'POST',{version:freshSecond.version,itemRef:firstItem.code,possession:'IN_HAND',note:'完全相同来源图片且人工核对为同一件实物'});
  assert.equal(linked.itemId,firstItem.id);assert.equal(await db.item.count(),itemCount);
  const afterLink=await db.ingestCandidate.findUniqueOrThrow({where:{id:secondCandidate.id}});assert.equal(afterLink.decision,'CONFIRMED');assert.equal(afterLink.itemId,firstItem.id);
  assert.equal((await db.itemPurchaseLink.findUniqueOrThrow({where:{purchaseLineId:afterLink.purchaseLineId}})).itemId,firstItem.id);
  assert.equal(await db.itemSourceLink.count({where:{itemId:firstItem.id}}),2);
  assert.equal(await db.asset.count({where:{itemId:firstItem.id,sha256:(await db.ingestCandidateAsset.findFirstOrThrow({where:{candidateId:firstCandidate.id}})).sha256}}),1);
  const unchanged=await item(firstItem.id);assert.equal(unchanged.status,firstItem.status);assert.deepEqual(unchanged.facts,firstItem.facts);

  const third=await setupAgentTrr('Duplicate source C'),thirdCandidate=third.imported.rows[0];
  fd=new FormData();fd.set('sourceUrl','https://example.invalid/same-c.jpg');fd.set('roleHint','PRODUCT');fd.set('file',new Blob([image],{type:'image/png'}),'same-c.png');
  await machineOk(`/agent-ingest/candidates/${thirdCandidate.id}/assets`,third.session.token,'POST',fd);
  await sealAgentBatch(third);
  const overridden=await ok(`/ingest/candidates/${thirdCandidate.id}/confirm`,'POST',{version:thirdCandidate.version,possession:'IN_HAND',status:'AVAILABLE',duplicateOverride:true,acceptIncomplete:true,note:'人工核对：同图但确为另一件独立实物'});
  assert.notEqual(overridden.itemId,firstItem.id);assert.equal(await db.item.count(),itemCount+1);
});

test('导入清单拒绝漏件漏原图和错误尺寸，缺项单件确认且原文件与权限保留', async () => {
  const {createHash}=require('node:crypto'), suffix=randomUUID().slice(0,8);
  const source=await ok('/procurement/sources','POST',{code:'IC'+suffix.toUpperCase(),name:'合成完整性来源',kind:'MARKETPLACE',defaultCurrency:'USD'});
  const session=await ok('/ingest/sessions','POST',{procurementSourceId:source.id,label:'完整性测试',ttlMinutes:60});
  const batch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'integrity-'+suffix,agentName:'Synthetic',rawManifest:standardManifest('GENERIC_MARKETPLACE/1.0',{expectedCandidateKeys:['ONE','TWO'],requiredFields:['titleRaw','sourceFacts.description']})});
  const png=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="2000"><rect width="1500" height="2000" fill="#988"/><text x="20" y="200">${suffix}</text></svg>`)).png().toBuffer();
  const sha=createHash('sha256').update(png).digest('hex');
  const capture={pageUrl:'https://example.invalid/one',capturedAt:'2026-09-14T00:00:00.000Z',fields:[{path:'titleRaw',label:'名称',status:'CAPTURED'},{path:'sourceFacts.description',label:'原文介绍',status:'CAPTURED'}],images:[{sourceUrl:'https://example.invalid/full.png',sha256:sha,width:500,height:700,quality:'ORIGINAL'}]};
  const first=standardizeGenericCandidate({externalKey:'ONE',titleRaw:'完整的合成衣服',currency:'USD',sourceFacts:{description:'完整原文介绍',sizeLabel:'XL',capture},rawPayload:{synthetic:true}});
  const one=(await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates:[first]})).rows[0];
  let report=(await machineOk(`/agent-ingest/batches/${batch.id}`,session.token)).integrity;
  assert.ok(report.blockers.some(x=>x.includes('缺少商品：TWO')));assert.ok(report.blockers.some(x=>x.includes('原文件尚未保存')));
  assert.equal((await machineApi(`/agent-ingest/batches/${batch.id}/seal`,session.token,'POST',{})).status,409);
  const fd=new FormData();fd.set('file',new Blob([png],{type:'image/png'}),'original.png');fd.set('sourceUrl','https://example.invalid/full.png');
  const upload=await machineOk(`/agent-ingest/candidates/${one.id}/assets`,session.token,'POST',fd);
  report=(await machineOk(`/agent-ingest/batches/${batch.id}`,session.token)).integrity;
  assert.ok(report.blockers.some(x=>x.includes('实际尺寸')));
  capture.images[0].width=1500;capture.images[0].height=2000;
  const second=standardizeGenericCandidate({externalKey:'TWO',titleRaw:'来源缺资料的合成衣服',sourceFacts:{capture:{...capture,pageUrl:'https://example.invalid/two',fields:[{path:'titleRaw',label:'名称',status:'CAPTURED'},{path:'sourceFacts.description',label:'原文介绍',status:'UNAVAILABLE',reason:'来源旧页面已下架'}],images:[{sourceUrl:'https://example.invalid/missing.png',quality:'UNAVAILABLE',reason:'来源图片已失效'}]}},rawPayload:{synthetic:true}});
  const up=await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates:[first,second]});
  assert.equal((await api(`/ingest/candidates/${one.id}/confirm`,'POST',{version:up.rows[0].version,possession:'IN_HAND',note:'合成提前确认'})).status,409);
  const sealed=await machineOk(`/agent-ingest/batches/${batch.id}/seal`,session.token,'POST',{});
  assert.equal(sealed.integrity.state,'GAPS');assert.equal(sealed.integrity.blockers.length,0);
  const raw=await fetch(origin+`/api/ingest/candidate-assets/${upload.id}/original`,{headers:{Cookie:admin.cookie}});
  assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),png);assert.match(raw.headers.get('cache-control'),/private/);
  assert.equal((await fetch(origin+`/api/ingest/candidate-assets/${upload.id}/original`)).status,401);
  const key=randomUUID(),body={ids:up.rows.map(x=>x.id),versions:Object.fromEntries(up.rows.map(x=>[x.id,x.version])),possession:'IN_HAND',status:'AVAILABLE',incompleteAcknowledgements:{[up.rows[0].id]:'已核对首件的合成来源缺项'}};
  const confirmed=await ok('/ingest/candidates/bulk-confirm','POST',body,admin,key);
  assert.equal(confirmed.ok,1);assert.equal(confirmed.failed,1);assert.match(confirmed.rows[1].error,/缺失/);
  assert.deepEqual(await ok('/ingest/candidates/bulk-confirm','POST',body,admin,key),confirmed);
  const two=up.rows[1];
  const accepted=await ok(`/ingest/candidates/${two.id}/confirm`,'POST',{version:two.version,possession:'IN_HAND',acceptIncomplete:true,note:'已核对实物，来源下架资料后补'});
  assert.equal((await item(accepted.itemId)).status,'AVAILABLE');
  const saved=await db.ingestCandidateAsset.findUniqueOrThrow({where:{id:upload.id}});
  const asset=await db.asset.findUniqueOrThrow({where:{id:saved.assetId}});
  assert.equal(asset.objectKey,saved.objectKey);assert.equal(asset.rights,'INTERNAL');assert.equal(asset.verified,false);
  const evidence=await ok(`/ingest/items/${asset.itemId}/evidence`);assert.equal(evidence[0].id,one.id);
  await db.asset.update({where:{id:asset.id},data:{role:'DOCUMENT'}});
  for(const path of ['preview','original']) {
    assert.equal((await fetch(origin+`/api/ingest/candidate-assets/${upload.id}/${path}`,{headers:{Cookie:operator.cookie}})).status,403);
    assert.equal((await fetch(origin+`/api/ingest/candidate-assets/${upload.id}/${path}`,{headers:{Cookie:admin.cookie}})).status,200);
  }
});

test('再次稀疏导入保留已采集来源和人工建议，批量确认拒绝过期版本',async()=>{
  const x=await setupAgentTrr('合成稀疏补充来源'),c=x.imported.rows[0];
  await ok(`/ingest/candidates/${c.id}/review`,'POST',{version:c.version,possession:'IN_HAND',title:'人工维护的商品名',category:'BAG',note:'合成核对'});
  const update=await machineOk(`/agent-ingest/batches/${x.batch.id}/candidates`,x.session.token,'POST',{candidates:[{externalKey:x.candidates[0].externalKey,titleRaw:'来源新名称',sourceFacts:{designer:'合成设计师'}}]});
  const current=await ok(`/ingest/candidates/${c.id}`);
  assert.equal(current.proposal.title,'人工维护的商品名');assert.equal(current.proposal.category,'BAG');
  assert.equal(current.currency,'USD');assert.equal(current.purchaseLineId,x.candidates[0].purchaseLineId);
  assert.equal(current.sourceFacts.sizeLabel,x.candidates[0].sourceFacts.sizeLabel);assert.equal(current.sourceFacts.designer,'合成设计师');
  await machineOk(`/agent-ingest/batches/${x.batch.id}/seal`,x.session.token,'POST',{});
  const blocked=await ok('/ingest/candidates/bulk-confirm','POST',{ids:[c.id],versions:{[c.id]:c.version},possession:'IN_HAND',status:'AVAILABLE'});
  assert.equal(blocked.failed,1);assert.match(blocked.rows[0].error,/修改/);
  const newer=await ok('/ingest/candidates/bulk-confirm','POST',{ids:[c.id],versions:{[c.id]:update.rows[0].version},possession:'IN_HAND',status:'AVAILABLE',incompleteAcknowledgements:{[c.id]:'已核对合成来源缺项'}});
  assert.equal(newer.ok,1);
  const i=await item(newer.rows[0].itemId);assert.equal(i.title,'人工维护的商品名');assert.equal(i.category,'BAG');
  const originalAssets=i.assets.length, originalFacts=i.facts;
  const nextBatch=await machineOk('/agent-ingest/batches',x.session.token,'POST',{externalBatchKey:'enrich-'+randomUUID(),agentName:'Synthetic enrich',rawManifest:standardManifest('GENERIC_MARKETPLACE/1.0',{synthetic:true})});
  await machineOk(`/agent-ingest/batches/${nextBatch.id}/candidates`,x.session.token,'POST',{candidates:[standardizeGenericCandidate({externalKey:x.candidates[0].externalKey,titleRaw:'再次采集名称',sourceFacts:{measurements:{newDetail:'新增来源尺寸'}}})]});
  const sourceAgain=await ok(`/ingest/candidates/${c.id}`);
  assert.equal(sourceAgain.sourceFacts.measurements.Bust,x.candidates[0].sourceFacts.measurements.Bust);
  assert.equal(sourceAgain.sourceFacts.measurements.newDetail,'新增来源尺寸');
  const fd=new FormData();fd.set('file',new Blob([await syntheticImage()],{type:'image/png'}),'later-source.png');fd.set('sourceUrl','https://example.invalid/later.png');
  await machineOk(`/agent-ingest/candidates/${c.id}/assets`,x.session.token,'POST',fd);
  const unchanged=await item(i.id);assert.equal(unchanged.title,i.title);assert.deepEqual(unchanged.facts,originalFacts);assert.equal(unchanged.assets.length,originalAssets);
  assert.equal((await ok(`/ingest/candidates/${c.id}`)).assets.length,1);

});

test('多平台异构字段与无订单门店来源共用协议，来源身份隔离且关联不覆盖TM', async () => {
  const sources=[];
  for (const kind of ['MARKETPLACE','OFFLINE']) {
    const source=await ok('/procurement/sources','POST',{code:'MS'+randomUUID().replace(/-/g,'').slice(0,10).toUpperCase(),name:'合成异构来源 '+kind,kind,defaultCurrency:kind==='MARKETPLACE'?'EUR':'CNY'});
    const session=await ok('/ingest/sessions','POST',{procurementSourceId:source.id,label:'合成独立接入器',ttlMinutes:60});
    const batch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'same-batch-key',agentName:'Synthetic Adapter',agentVersion:'2.0',kind:kind==='OFFLINE'?'OFFLINE_IMPORT':'ITEM_BATCH',rawManifest:standardManifest('GENERIC_MARKETPLACE/1.0',{adapter:{name:kind,version:'2.0',sourceSchemaVersion:'supplier-v9',mappingVersion:'reviewed-1'}})});
    const raw=kind==='MARKETPLACE'?{synthetic:true,designer:{label:'合成小众品牌'},wear:{grade:'A+',notes:['袖口轻微使用痕迹']},fabric:{panels:[{part:'body',fiber:'wool',percent:85},{part:'lining',fiber:'cotton',percent:100}]}}:{synthetic:true,品牌名称:'合成门店品牌',品相记录:{等级:'店检二级',瑕疵:'扣子缺失'},吊牌尺码:'44',票据:{编号:'SYN-PAPER-01',备注:['店内采购','无网页订单']}};
    const input={externalKey:'same-item-key',sourceItemKey:'same-sku',titleRaw:'合成无订单商品',brandRaw:kind==='MARKETPLACE'?raw.designer.label:raw.品牌名称,conditionRaw:kind==='MARKETPLACE'?raw.wear.grade:raw.品相记录.等级,statusRaw:'Sold',sourceFacts:{sizeLabel:kind==='MARKETPLACE'?'M':raw.吊牌尺码,conditionDescription:kind==='MARKETPLACE'?raw.wear.notes.join('；'):raw.品相记录.瑕疵,providerFields:raw,mappingEvidence:{brandRaw:{sourcePath:kind==='MARKETPLACE'?'designer.label':'品牌名称',rule:'直接保留原文'}}},rawPayload:raw};
    standardizeGenericCandidate(input);
    const imported=await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates:[input]});
    const row=await ok('/ingest/candidates/'+imported.rows[0].id);
    assert.equal(row.purchaseLineId,null);assert.equal(row.currency,kind==='MARKETPLACE'?'EUR':'CNY');assert.deepEqual(row.rawPayload,raw);assert.deepEqual(row.sourceFacts.providerFields,raw);
    const savedBatch=(await ok('/ingest/batches?sourceId='+source.id)).find(v=>v.id===batch.id);
    assert.deepEqual(savedBatch.rawManifest.adapter,{name:kind,version:'2.0',sourceSchemaVersion:'supplier-v9',mappingVersion:'reviewed-1'});
    sources.push({source,session,batch,input,row});
  }
  const [a,b]=sources;
  assert.notEqual(a.row.id,b.row.id);
  assert.equal((await machineApi('/agent-ingest/batches/'+a.batch.id,b.session.token)).status,404);
  await machineOk(`/agent-ingest/batches/${a.batch.id}/seal`,a.session.token,'POST',{});
  const confirmed=await ok('/ingest/candidates/'+a.row.id+'/confirm','POST',{version:a.row.version,possession:'IN_HAND',acceptIncomplete:true,note:'人工确认合成实物'});
  const first=await item(confirmed.itemId);
  await ok('/items/'+first.id,'PATCH',{version:first.version,title:'合成人工长期维护标题',facts:{condition:'合成人工验货说明'}});
  const maintained=await item(first.id);
  await ok('/ingest/candidates/'+b.row.id+'/link-item','POST',{version:b.row.version,itemRef:maintained.code,possession:'IN_HAND',note:'人工核对是同一件实物的另一份门店来源'});
  const linked=await item(first.id);
  assert.equal(linked.title,maintained.title);assert.deepEqual(linked.facts,maintained.facts);assert.equal(linked.status,'AVAILABLE');assert.equal(linked.currentCostCny,null);assert.equal(linked.currentPrice,null);
  assert.equal(await db.itemSourceLink.count({where:{itemId:first.id}}),2);
  const enriched=await machineOk(`/agent-ingest/batches/${b.batch.id}/candidates`,b.session.token,'POST',{candidates:[{...b.input,sourceFacts:{providerFields:{newLabel:{values:['后续新增参数',0,false]}}}}]});
  assert.equal(enriched.rows[0].id,b.row.id);
  const newer=await ok('/ingest/candidates/'+b.row.id);
  assert.equal(newer.currency,'CNY');
  assert.equal(newer.sourceFacts.providerFields.票据.编号,'SYN-PAPER-01');
  assert.deepEqual(newer.sourceFacts.providerFields.newLabel.values,['后续新增参数',0,false]);
  assert.deepEqual((await item(first.id)).facts,maintained.facts);
  const referenceLink=await db.itemSourceLink.findFirstOrThrow({where:{itemId:first.id,kind:'REFERENCE'}});
  assert.ok(referenceLink.sourceId);
  const aNext=await machineOk('/agent-ingest/batches',a.session.token,'POST',{externalBatchKey:'same-batch-key-enrich',agentName:'Synthetic Adapter enrich',agentVersion:'2.0',kind:'ITEM_BATCH',rawManifest:standardManifest('GENERIC_MARKETPLACE/1.0',{adapter:{name:'MARKETPLACE',version:'2.0',sourceSchemaVersion:'supplier-v9',mappingVersion:'reviewed-1'}})});
  await machineOk(`/agent-ingest/batches/${aNext.id}/candidates`,a.session.token,'POST',{candidates:[{...a.input,currency:'GBP'}]});
  await machineOk(`/agent-ingest/batches/${aNext.id}/candidates`,a.session.token,'POST',{candidates:[a.input]});
  assert.equal((await ok('/ingest/candidates/'+a.row.id)).currency,'GBP');
  assert.equal(await db.purchaseOrder.count({where:{procurementSourceId:{in:sources.map(x=>x.source.id)}}}),0);
});

test('询盘精确定位绕过列表上限但保留TEST隔离和角色权限',async()=>{
 const item=await sparse({title:'精确询盘商品'}),other=await sparse({title:'其他询盘商品'});
 const target=await ok('/inquiries','POST',{itemId:item.id,channel:'合成渠道',customerRef:'历史客户'});
 await db.inquiry.update({where:{id:target.id},data:{createdAt:new Date('2020-01-01')}});
 const ids=Array.from({length:500},()=>randomUUID());
 await db.inquiry.createMany({data:ids.map(id=>({id,itemId:other.id,channel:'合成填充',customerRef:'测试客户',notes:'',currency:'CNY'}))});
 try {
  const recent=await ok('/inquiries');assert.equal(recent.some(r=>r.id===target.id),false);
  const exact=await ok('/inquiries?id='+target.id);assert.deepEqual(exact.map(r=>r.id),[target.id]);
  const byItem=await ok('/inquiries?itemId='+item.id);assert.deepEqual(byItem.map(r=>r.id),[target.id]);
  assert.deepEqual(await ok('/inquiries?id='+target.id+'&itemId='+other.id),[]);
  const hidden=await sparse({title:'TEST询盘',dataMode:'TEST'});const hiddenInquiry=await ok('/inquiries','POST',{itemId:hidden.id,channel:'合成',customerRef:'TEST客户'});assert.deepEqual(await ok('/inquiries?id='+hiddenInquiry.id),[]);
  assert.equal((await api('/inquiries?id='+target.id,'GET',undefined,viewer)).status,403);
  const queue=await ok('/work-queue');assert.equal(queue.rows.find(r=>r.id==='inquiry:'+target.id).href,'#/inquiries?id='+target.id+'&from=tasks');
 } finally {await db.inquiry.deleteMany({where:{id:{in:ids}}});}
});

test('完整经营检索先排序筛选再分页，旧事项与紧急下架都可达', async()=>{
  const i=await sparse(), prefix='QUEUE-'+randomUUID();
  const rows=Array.from({length:105},(_,n)=>({id:randomUUID(),itemId:i.id,dedupeKey:prefix+n,kind:n===104?'DELIST':'MANUAL',title:prefix+'-'+n,createdAt:new Date(2020,0,n+1)}));
  await db.task.createMany({data:rows});
  try {
    const page=await ok('/work-queue?scope=TASK&q='+prefix+'&size=100');assert.equal(page.total,105);assert.equal(page.rows[0].entityId,rows[104].id);
    const last=await ok('/work-queue?scope=TASK&q='+prefix+'-103');assert.equal(last.total,1);assert.equal(last.rows[0].entityId,rows[103].id);
    const second=await ok('/work-queue?scope=TASK&q='+prefix+'&size=100&page=2');assert.equal(second.rows.length,5);
    const n=await ok('/inquiries','POST',{itemId:i.id,channel:prefix,customerRef:'新询盘'});
    const only=await ok('/work-queue?scope=INQUIRY&q='+prefix);assert.ok(only.rows.some(r=>r.entityId===n.id));
    const hidden=await ok('/work-queue?scope=INQUIRY&q='+prefix,'GET',undefined,viewer);assert.equal(hidden.total,0);
  } finally {await db.task.deleteMany({where:{dedupeKey:{startsWith:prefix}}});}
});

test("Launch Closure workflow scale：全局待确认商品不受首屏限制，旧 PREPARE 不进入队列", async () => {
  const prefix = "ITEM-REVIEW-" + randomUUID().slice(0, 8);
  const ids = Array.from({ length: 1000 }, () => randomUUID());
  await db.$transaction(async (tx) => {
    await tx.item.createMany({
      data: ids.map((id, index) => ({
        id,
        title: `${prefix}-${String(index + 1).padStart(4, "0")}`,
        facts: {},
        dataMode: "BUSINESS",
        status: "AVAILABLE",
      })),
    });
    await tx.cycle.createMany({
      data: ids.map((itemId) => ({ itemId, number: 1 })),
    });
  });
  try {
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) =>
        ok(`/work-queue?scope=ITEM_REVIEW&q=${encodeURIComponent(prefix)}&size=300&page=${page}`),
      ),
    );
    assert.equal(pages[0].total, ids.length);
    assert.deepEqual(pages.map((page) => page.rows.length), [300, 300, 300, 100]);
    const found = new Set(pages.flatMap((page) => page.rows.map((row) => row.entityId)));
    assert.equal(found.size, ids.length);
    assert.deepEqual([...found].sort(), [...ids].sort());
    const first = pages[0].rows[0];
    assert.equal(first.kind, "ITEM_REVIEW");
    assert.equal(first.action, "去确认");
    assert.equal(first.href, `#/items/${first.entityId}?tab=facts&returnTo=${encodeURIComponent("#/tasks?scope=ITEM_REVIEW")}`);
    const dashboard = await ok("/dashboard");
    assert.ok(dashboard.pendingItemReviews >= ids.length);
  } finally {
    await db.$transaction(async (tx) => {
      await tx.cycle.deleteMany({ where: { itemId: { in: ids } } });
      await tx.item.deleteMany({ where: { id: { in: ids } } });
    });
  }
});

test('经营账1001笔全量汇总导出和分页保持日期客户币种与精确成交一致',async()=>{
  const i=await sparse(), prefix='SALES-'+randomUUID();
  await db.cycle.createMany({data:Array.from({length:1001},(_,n)=>({itemId:i.id,number:n+2}))});
  const rows=Array.from({length:1001},(_,n)=>({id:randomUUID(),itemId:i.id,cycleNumber:n+2,channel:prefix,customerRef:'客户批次',amount:1000,cost:200,fees:100,paid:true,createdBy:admin.id,soldAt:new Date('2024-06-15T08:00:00Z')}));
  await db.sale.createMany({data:rows});
  try{
    const q='channel='+prefix+'&customer='+encodeURIComponent('客户批次')+'&dateFrom=2024-06-01&dateTo=2024-06-30';
    const page=await ok('/sales?page=1&'+q);assert.equal(page.total,1001);assert.equal(page.rows.length,50);assert.equal(page.summary.totals.CNY,700700);
    const tail=await ok('/sales?page=21&'+q);assert.equal(tail.rows.length,1);
    const exported=await ok('/sales?export=1&'+q);assert.equal(exported.rows.length,1001);assert.equal(new Set(exported.rows.map(s=>s.id)).size,1001);
    const exact=await ok('/sales?page=1&id='+rows[0].id);assert.equal(exact.total,1);assert.equal(exact.rows[0].id,rows[0].id);
    const wrong=await ok('/sales?page=1&channel='+prefix+'&dateFrom=2025-01-01');assert.equal(wrong.total,0);
    assert.equal((await api('/sales?page=1','GET',undefined,viewer)).status,403);
  }finally{await db.sale.deleteMany({where:{channel:prefix}});await db.cycle.deleteMany({where:{itemId:i.id,number:{gte:2}}});}
});

test('询盘并发写入阻断旧版本，重试保留逐次沟通历史且库存不变',async()=>{
  const i=await sparse(),before=await item(i.id);
  const n=await ok('/inquiries','POST',{itemId:i.id,channel:'合成询盘',customerRef:'并发客户',notes:'初次咨询'});
  const key=randomUUID();const input={version:1,state:'FOLLOWUP',notes:'第一次跟进',nextFollowUpAt:future()};
  await ok('/inquiries/'+n.id+'/status','POST',input,admin,key);await ok('/inquiries/'+n.id+'/status','POST',input,admin,key);
  // WON is now reserved for the atomic conversion command; retain the stale-version
  // check with an otherwise valid ordinary status transition.
  const stale=await api('/inquiries/'+n.id+'/status','POST',{version:1,state:'LOST',notes:'旧窗口的内容'});assert.equal(stale.status,409);
  await ok('/inquiries/'+n.id+'/status','POST',{version:2,state:'LOST',notes:'尺码不合'});
  const h=await ok('/inquiries/'+n.id+'/history');assert.equal(h.initial,'初次咨询');assert.equal(h.rows.length,2);assert.deepEqual(h.rows.map(x=>x.detail.notes),['第一次跟进','尺码不合']);
  assert.equal((await item(i.id)).status,before.status);assert.equal((await item(i.id)).version,before.version);
  assert.equal((await api('/inquiries/'+n.id+'/history','GET',undefined,viewer)).status,403);
});

test('渠道版本维护保护冻结快照与权限，停用后资料不可再取用且发布分离TEST',async()=>{
 const c=await ok('/channels','POST',{platform:'OTHER',name:'维护渠道 '+randomUUID(),locale:'zh-CN',titleLimit:200}), i=await ready(), ti=await ready({dataMode:'TEST'});
 const a=await listed(i.id,c),b=await listed(ti.id,c),before=await db.usePackage.findUniqueOrThrow({where:{id:a.pack}}),itemBefore=await item(i.id);
 const input={version:1,name:'合成停用渠道',locale:'en',titleLimit:150,active:false},key=randomUUID();
 assert.equal((await api('/channels/'+c.id,'POST',input,operator)).status,403);
 await ok('/channels/'+c.id,'POST',input,admin,key);await ok('/channels/'+c.id,'POST',input,admin,key);
 assert.equal((await api('/channels/'+c.id,'POST',{...input,name:'过期更新'})).status,409);
 assert.equal((await ok('/channels')).find(x=>x.id===c.id).version,2);
 assert.deepEqual(await db.usePackage.findUniqueOrThrow({where:{id:a.pack}}),before);
 assert.equal((await item(i.id)).version,itemBefore.version);assert.notEqual((await api('/packages/'+a.pack+'/usable')).status,200);
 assert.equal((await ok('/listings?page=1&itemId='+i.id)).rows[0].id,a.listing);
 assert.equal((await ok('/listings?page=1&itemId='+ti.id)).total,0);
 assert.equal((await ok('/listings?page=1&dataMode=TEST&itemId='+ti.id)).rows[0].id,b.listing);
 assert.equal((await api('/listings?page=1&dataMode=TEST','GET',undefined,operator)).status,403);
 assert.ok(await db.outbox.count({where:{itemId:i.id,kind:'CHANNEL_CHANGED'}}));
});

test('选品预检集中返回缺项且不写资料包，权限及TEST边界保留',async()=>{
 const a=await ready(),b=await sparse(),c=await sparse(),t=await ready({dataMode:'TEST'}),before=await db.usePackage.count();
 const result=await ok('/collections/preflight','POST',{itemIds:[a.id,b.id,c.id],channelId:channel.id});
 assert.equal(result.ready,false);assert.equal(result.rows.length,3);assert.equal(result.rows[0].issues.length,0);assert.ok(result.rows[1].issues.length);assert.ok(result.rows[2].issues.length);
 assert.equal(await db.usePackage.count(),before);
 assert.equal((await ok('/collections/preflight','POST',{itemIds:[t.id],channelId:channel.id})).ready,false);
 assert.equal((await api('/collections/preflight','POST',{itemIds:[a.id],channelId:channel.id},viewer)).status,403);
});

test('询盘变更使旧清理预览失效并保留沟通与正式商品',async()=>{
 const i=await sparse(),n=await ok('/inquiries','POST',{itemId:i.id,channel:'合成',customerRef:'客户',notes:'初次'}),body=await testCleanupInput(i.id);
 await ok('/inquiries/'+n.id+'/status','POST',{version:1,state:'FOLLOWUP',notes:'预览后新沟通',nextFollowUpAt:future()});
 const result=await api('/items/'+i.id+'/test-cleanup','POST',body);assert.equal(result.data.error.code,'TEST_PREVIEW_STALE');assert.equal((await item(i.id)).dataMode,'BUSINESS');assert.equal((await ok('/inquiries/'+n.id+'/history')).rows[0].detail.notes,'预览后新沟通');
});

test('归档原图保留原文件哈希，归入内部凭证后原图和预览同时限制财务权限',async()=>{
 const b=await ok('/intake/batches','POST',{name:'合成原图权限批次'}),f=await intakeUpload(b.id,'permission.png'),i=await sparse();
 const original=await fetch(origin+'/api/intake/files/'+f.id+'/original',{headers:{Cookie:admin.cookie}});assert.equal(original.status,200);
 const bytes=Buffer.from(await original.arrayBuffer()),stored=await db.intakeFile.findUniqueOrThrow({where:{id:f.id}});
 assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),stored.sha256);
 assert.equal((await api('/intake/files/'+f.id+'/original','GET',undefined,viewer)).status,403);
 await ok('/intake/batches/'+b.id+'/assign','POST',{entries:[{fileId:f.id,itemId:i.id,role:'DOCUMENT',origin:'OWN',sourceNote:'合成内部凭证归档'}]});
 for(const suffix of ['original','preview'])assert.equal((await api('/intake/files/'+f.id+'/'+suffix,'GET',undefined,operator)).status,403);
 assert.equal((await fetch(origin+'/api/intake/files/'+f.id+'/original',{headers:{Cookie:admin.cookie}})).status,200);
});

test('货源池用来源名称和原货号找到已关联TM，不把多来源关系误判为待建档',async()=>{
 const label='来源检索-'+randomUUID(),x=await setupAgentTrr(label),candidate=x.imported.rows[0];await sealAgentBatch(x);const confirmed=await ok('/ingest/candidates/'+candidate.id+'/confirm','POST',{version:candidate.version,possession:'IN_HAND',acceptIncomplete:true,note:'合成来源检索确认'});
 const byName=await ok('/supply/sources?page=1&q='+encodeURIComponent(label)+'&stage=adopted');assert.equal(byName.total,1);assert.equal(byName.rows[0].sourceLabel,label);assert.ok(byName.rows[0].items.some(i=>i.id===confirmed.itemId));
 const sku=x.candidates[0].sourceItemKey,bySku=await ok('/supply/sources?page=1&q='+sku+'&stage=adopted');assert.ok(bySku.rows.some(r=>r.items.some(i=>i.id===confirmed.itemId)&&r.originalKey===sku));
 assert.equal((await ok('/supply/sources?page=1&q='+encodeURIComponent(label)+'&stage=pending')).total,0);
});

test('商品资料库：零成本与未知分开，尺码位置来源及缺项组合在分页前过滤', async () => {
  const marker='MVP-filter-'+randomUUID();
  const a=await sparse({title:marker+' A',location:'箱A-03',facts:{sizeLabel:'XL',attributes:{sourcePlatform:'线下寄卖'}}});
  const b=await sparse({title:marker+' B',location:'箱A-03',currentPrice:128000,facts:{sizeLabel:'XL',attributes:{sourcePlatform:'其他门店'}}});
  await ok(`/items/${a.id}/costs`,'POST',{kind:'PURCHASE',amount:0,currency:'CNY',confirmed:true,note:'合成赠送货品确认零成本',occurredAt:new Date().toISOString()});
  const all=await ok('/items?q='+encodeURIComponent(marker));
  assert.equal(all.rows.find(i=>i.id===a.id).currentCostCny,0);assert.equal(all.rows.find(i=>i.id===b.id).currentCostCny,null);
  const filtered=await ok('/items?'+new URLSearchParams({q:marker,sizeLabel:'xl',location:'箱A',source:'线下',missing:'price'}));
  assert.equal(filtered.total,1);assert.equal(filtered.rows[0].id,a.id);
  assert.equal((await ok('/items?'+new URLSearchParams({q:marker,source:'其他',missing:'price'}))).total,0);
  assert.equal((await ok('/items?'+new URLSearchParams({q:marker,missing:'size'}))).total,0);
  assert.equal((await ok('/items?'+new URLSearchParams({q:marker,missing:'description'}))).total,2);
  assert.equal((await ok('/items?'+new URLSearchParams({q:marker,missing:'images'}))).total,2);
  assert.equal('currentCostCny' in (await ok('/items?q='+encodeURIComponent(marker),'GET',undefined,operator)).rows[0],false);
});

test('商品资料库：批量逐件缺项依据绑定版本且不绕过漏图或同图身份检查',async()=>{
  const x=await setupAgentTrr('MVP合成缺项来源'), c=x.imported.rows[0];
  const capture={fileEvidence:{name:'合成门店资料.json',sha256:'a'.repeat(64),row:'第1条'},capturedAt:new Date().toISOString(),fields:[{path:'titleRaw',label:'名称',status:'CAPTURED'},{path:'sourceFacts.measurements',label:'尺寸',status:'UNAVAILABLE',reason:'原记录未提供'}],images:[]};
  const changed=await machineOk(`/agent-ingest/batches/${x.batch.id}/candidates`,x.session.token,'POST',{candidates:[standardizeGenericCandidate({...x.candidates[0],sourceFacts:{...x.candidates[0].sourceFacts,capture}})]});
  const version=changed.rows[0].version;
  await machineOk(`/agent-ingest/batches/${x.batch.id}/seal`,x.session.token,'POST',{});
  const body={ids:[c.id],versions:{[c.id]:version},possession:'IN_HAND',status:'AVAILABLE'};
  assert.equal((await ok('/ingest/candidates/bulk-confirm','POST',body)).failed,1);
  assert.equal((await api('/ingest/candidates/bulk-confirm','POST',{...body,versions:undefined,incompleteAcknowledgements:{[c.id]:'已核实来源未提供'}})).status,400);
  assert.equal((await api('/ingest/candidates/bulk-confirm','POST',{...body,incompleteAcknowledgements:{[randomUUID()]:'错误对象'}})).status,400);
  const accepted={...body,incompleteAcknowledgements:{[c.id]:'已核对实物，来源未提供的尺寸后补'}}, key=randomUUID();
  const result=await ok('/ingest/candidates/bulk-confirm','POST',accepted,admin,key);
  assert.equal(result.ok,1);assert.deepEqual(await ok('/ingest/candidates/bulk-confirm','POST',accepted,admin,key),result);
  const proof=await db.audit.findFirst({where:{resourceId:c.id,action:'INGEST_CANDIDATE_CONFIRMED'}});
  assert.ok(proof);assert.equal(proof.detail.acceptIncomplete,true);assert.match(proof.detail.note,/来源未提供/);
  const missing=x.imported.rows[1];
  const nextBatch=await machineOk('/agent-ingest/batches',x.session.token,'POST',{externalBatchKey:'mvp-missing-'+randomUUID(),agentName:'Synthetic',rawManifest:standardManifest('GENERIC_MARKETPLACE/1.0',{synthetic:true})});
  const newRows=await machineOk(`/agent-ingest/batches/${nextBatch.id}/candidates`,x.session.token,'POST',{candidates:[standardizeGenericCandidate({...x.candidates[1],sourceFacts:{...x.candidates[1].sourceFacts,capture:{...capture,images:[{sourceFile:'missing.png',sha256:'b'.repeat(64),width:1500,height:2000,quality:'ORIGINAL'}]}}})]});
  const blocked=await ok('/ingest/candidates/bulk-confirm','POST',{ids:[missing.id],versions:{[missing.id]:newRows.rows[0].version},possession:'IN_HAND',incompleteAcknowledgements:{[missing.id]:'明知缺图仍试图越过检查'}});
  assert.equal(blocked.failed,1);assert.match(blocked.rows[0].error,/原文件|保存|清单/);
});

test('商品资料库：跨批次补采保留历史成员与封存检查，候选只生成同一TM',async()=>{
  const x=await setupAgentTrr('MVP合成批次历史');
  const old=await machineOk(`/agent-ingest/batches/${x.batch.id}/seal`,x.session.token,'POST',{});
  const next=await machineOk('/agent-ingest/batches',x.session.token,'POST',{externalBatchKey:'next-'+randomUUID(),agentName:'Synthetic',rawManifest:standardManifest('GENERIC_MARKETPLACE/1.0',{synthetic:true})});
  await machineOk(`/agent-ingest/batches/${next.id}/candidates`,x.session.token,'POST',{candidates:[{...x.candidates[0],titleRaw:'合成补采标题'}]});
  const priorList=await ok(`/ingest/candidates?batchId=${x.batch.id}&decision=`),nextList=await ok(`/ingest/candidates?batchId=${next.id}&decision=`);
  assert.equal(priorList.total,7);assert.equal(nextList.total,1);assert.ok(priorList.rows.some(c=>c.id===nextList.rows[0].id));
  const report=await ok(`/ingest/batches/${x.batch.id}/integrity`);assert.deepEqual(report,old.integrity);
  const records=await ok('/ingest/batch-records?q='+encodeURIComponent('MVP合成批次历史'));
  assert.equal(records.total,2);assert.equal(records.rows.find(b=>b.id===x.batch.id)._count.members,7);
  assert.equal(await db.ingestCandidate.count({where:{procurementSourceId:x.source.id}}),7);
  await assert.rejects(db.ingestBatchMember.deleteMany({where:{batchId:x.batch.id}}),/append-only/);
});

test('商品资料库：通用资料包含逐件文字和原文件，金额单位清楚且默认不含内部资料',async()=>{
  const i=await sparse({title:'MVP原图包 '+randomUUID(),currentPrice:128000,facts:{sizeLabel:'XL',descriptionZh:'合成中文文案',attributes:{privateNote:'MVP_INTERNAL_ONLY'}}});
  const png=await sharp({create:{width:1500,height:2000,channels:3,background:'#526e52'}}).png().toBuffer();
  const fd=new FormData();fd.set('itemId',i.id);fd.set('file',new Blob([png],{type:'image/png'}),'大图原件.png');fd.set('origin','SUPPLIER');fd.set('role','REFERENCE');fd.set('sourceNote','合成来源原件，内部参考');
  const asset=await ok('/assets/upload','POST',fd);
  await ok(`/items/${i.id}/costs`,'POST',{kind:'PURCHASE',amount:0,currency:'CNY',confirmed:true,note:'合成已确认零成本',occurredAt:new Date().toISOString()});
  const version=(await item(i.id)).version,key=randomUUID(),body={title:'MVP合成运营包',items:[{id:i.id,version}]};
  const bundle=await ok('/material-exports','POST',body,operator,key);
  assert.deepEqual(await ok('/material-exports','POST',body,operator,key),bundle);
  assert.equal(await db.materialExportEntry.count({where:{exportId:bundle.id}}),1);
  const response=await fetch(`${origin}/api/material-exports/${bundle.id}/download`,{headers:{Cookie:operator.cookie}});
  assert.equal(response.status,200);const files=zipFiles(Buffer.from(await response.arrayBuffer()));
  const manifest=JSON.parse(files.get('商品资料.json').toString());const row=manifest.items[0];
  assert.equal(row.priceMinor,128000);assert.equal(manifest.amountUnit,'MINOR_UNIT_100');assert.equal(row.images.length,1);
  assert.deepEqual(files.get(row.images[0].path),png);assert.equal(row.images[0].id,asset.id);
  assert.ok(files.has(`商品/${row.code}/商品资料.txt`));
  assert.match(files.get('商品清单.csv').toString(),/售价（元）/);assert.match(files.get('商品清单.csv').toString(),/"1280\.00"/);
  assert.equal(JSON.stringify(manifest).includes('MVP_INTERNAL_ONLY'),false);assert.equal('costCnyMinor' in row,false);
  assert.equal((await api('/material-exports','POST',{...body,scope:'INTERNAL'},operator)).status,403);
  const internal=await ok('/material-exports','POST',{...body,scope:'INTERNAL'});
  assert.equal((await api(`/material-exports/${internal.id}`,'GET',undefined,operator)).status,403);
  const detail=await ok(`/material-exports/${internal.id}`);assert.equal(detail.rows[0].before.costCnyMinor,0);
  assert.equal(detail.rows[0].before.facts.attributes.privateNote,'MVP_INTERNAL_ONLY');
  await assert.rejects(db.materialExport.update({where:{id:bundle.id},data:{title:'禁止改历史'}}),/append-only/);
});

test('商品资料库：补图、已售和删除改变资料包，旧包不能继续下载且清理摘要检测新依赖',async()=>{
  const i=await sparse({title:'MVP变化 '+randomUUID()}), v=(await item(i.id)).version;
  const preview=await ok(`/items/${i.id}/test-cleanup-preview`);
  const bundle=await ok('/material-exports','POST',{items:[{id:i.id,version:v}]});
  assert.notEqual((await ok(`/items/${i.id}/test-cleanup-preview`)).digest,preview.digest);
  await upload(i.id);
  assert.equal((await item(i.id)).version,v);
  const change=await ok(`/material-exports/${bundle.id}`);assert.deepEqual(change.rows[0].changes,['图片']);
  assert.equal((await fetch(`${origin}/api/material-exports/${bundle.id}/download`,{headers:{Cookie:admin.cookie}})).status,409);
  const fresh=await ok('/material-exports','POST',{items:[{id:i.id,version:v}]});
  await ok(`/items/${i.id}/sold`,'POST',{channel:'合成线下',customerRef:'合成买家',externalKey:'mvp-'+randomUUID()});
  assert.ok((await ok(`/material-exports/${fresh.id}`)).rows[0].changes.includes('库存状态'));
  // Stock transitions are independent of merchandising versions: a title edit is allowed, but cannot write stock.
  const attempt=await api(`/items/${i.id}`,'PATCH',{version:v,title:'售出后仍可补文字'},operator);assert.equal(attempt.status,200);
  assert.equal((await api(`/items/${i.id}`,'PATCH',{version:v,status:'AVAILABLE'},operator)).status,400);
  assert.equal((await item(i.id)).status,'SOLD');
  const deleted=await sparse({title:'MVP删除 '+randomUUID()}), before=await item(deleted.id), archive=await ok('/material-exports','POST',{items:[{id:deleted.id,version:before.version}]});
  await ok(`/items/${deleted.id}/trash`,'POST',{version:before.version,reason:'合成误录清理',confirmed:true});
  assert.ok((await ok(`/material-exports/${archive.id}`)).rows[0].changes.includes('已移入回收站'));
});

test('商品资料库：500件按批处理后可重试，明确版本和身份保护保持生效',async()=>{
 const suffix=randomUUID().slice(0,8), source=await ok('/procurement/sources','POST',{code:'V'+suffix.toUpperCase(),name:'MVP500合成来源',kind:'OFFLINE',defaultCurrency:'CNY'}), session=await ok('/ingest/sessions','POST',{procurementSourceId:source.id,label:'500件隔离验收',ttlMinutes:60});
 const batch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'MVP500-'+suffix,agentName:'Synthetic',rawManifest:standardManifest('GENERIC_MARKETPLACE/1.0',{synthetic:true})}), rows=[];
 for(let n=0;n<500;n+=200){const candidates=Array.from({length:Math.min(200,500-n)},(_,j)=>standardizeGenericCandidate({externalKey:suffix+':'+(n+j),titleRaw:'MVP500合成商品 '+(n+j)}));rows.push(...(await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates})).rows);}
 await machineOk(`/agent-ingest/batches/${batch.id}/seal`,session.token,'POST',{});
 const identities=new Set();
 for(let n=0;n<500;n+=100){const slice=rows.slice(n,n+100),body={ids:slice.map(c=>c.id),versions:Object.fromEntries(slice.map(c=>[c.id,c.version])),possession:'IN_HAND',incompleteAcknowledgements:incompleteAcknowledgements(slice,'已核对合成来源缺项')},key=randomUUID();const r=await ok('/ingest/candidates/bulk-confirm','POST',body,admin,key);assert.equal(r.ok,100);assert.deepEqual(await ok('/ingest/candidates/bulk-confirm','POST',body,admin,key),r);for(const c of r.rows)identities.add(c.itemId);}
 assert.equal(identities.size,500);assert.equal((await ok(`/ingest/candidates?batchId=${batch.id}&decision=PENDING`)).total,0);assert.equal((await ok(`/ingest/candidates?batchId=${batch.id}&decision=CONFIRMED&page=5`)).rows.length,100);
});

test('商品资料库：内部导出重放重新核验财务权限，测试范围与内部凭证不泄露',async()=>{
 const i=await sparse({title:'MVP权限 '+randomUUID()}), secret=await upload(i.id,{role:'DOCUMENT'});
 const b={items:[{id:i.id,version:(await item(i.id)).version}],scope:'INTERNAL'},key=randomUUID();
 const saved=await ok('/material-exports','POST',b,admin,key);
 const defaultBundle=await ok('/material-exports','POST',{items:b.items},operator), data=await ok(`/material-exports/${defaultBundle.id}`,'GET',undefined,operator);
 assert.equal(data.rows[0].before.images.some(a=>a.id===secret.id),false);
 const testItem=await sparse({title:'MVP显式TEST',dataMode:'TEST'});
 assert.equal((await api('/material-exports','POST',{items:[{id:testItem.id,version:1}]})).status,409);
 assert.equal((await machineApi('/material-exports','a'.repeat(64),'GET')).status,401);
 // A second synthetic account can lose financial authority between successful write and receipt replay.
 const password='Synthetic!'+randomUUID(),email=randomUUID()+'@tome.test';
 await ok('/auth/users','POST',{name:'合成权限回归',email,password,role:'FINANCE'});const who=await login(email,password);
 const ownKey=randomUUID(), own=await ok('/material-exports','POST',b,who,ownKey);
 await db.user.update({where:{id:who.id},data:{role:'OPERATOR'}});
 assert.equal((await api('/material-exports','POST',b,who,ownKey)).status,403);
 assert.equal((await api(`/material-exports/${own.id}`,'GET',undefined,who)).status,403);
 assert.equal((await api(`/material-exports/${saved.id}`,'GET',undefined,who)).status,403);
});

test("图片重试只持久化一次，相同命令不同图片冲突且没有新文件", async () => {
  const fs = require("node:fs/promises");
  const item = await sparse();
  const key = randomUUID();
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).png().toBuffer();
  const payload = (buffer) => {
    const fd = new FormData(); fd.set("file", new Blob([buffer]), "replay.png"); fd.set("itemId", item.id); return fd;
  };
  const before = (await fs.readdir(process.env.MEDIA_DIR)).sort();
  const first = await ok("/assets/upload", "POST", payload(image), admin, key);
  const committed = (await fs.readdir(process.env.MEDIA_DIR)).sort();
  assert.equal(committed.length - before.length, 2);
  const replay = await ok("/assets/upload", "POST", payload(image), admin, key);
  assert.deepEqual(replay, first);
  assert.deepEqual((await fs.readdir(process.env.MEDIA_DIR)).sort(), committed);
  const different = await sharp(image).negate().png().toBuffer();
  assert.equal((await api("/assets/upload", "POST", payload(different), admin, key)).data.error.code, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual((await fs.readdir(process.env.MEDIA_DIR)).sort(), committed);
});

test("图片数据库回滚及预览写盘失败均不留下半套文件", async () => {
  const fs = require("node:fs/promises");
  const before = (await fs.readdir(process.env.MEDIA_DIR)).sort();
  const item = await sparse();
  await db.$executeRawUnsafe(`CREATE FUNCTION tome_test_reject_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic asset failure'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER tome_test_reject_asset BEFORE INSERT ON "Asset" FOR EACH ROW EXECUTE FUNCTION tome_test_reject_asset()`);
  try {
    await assert.rejects(() => upload(item.id));
    assert.equal(await db.asset.count({ where: { itemId: item.id } }), 0);
    assert.deepEqual((await fs.readdir(process.env.MEDIA_DIR)).sort(), before);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER tome_test_reject_asset ON "Asset"');
    await db.$executeRawUnsafe('DROP FUNCTION tome_test_reject_asset()');
  }
  const open = fs.open;
  let injected = false;
  fs.open = async (name, ...args) => {
    const handle = await open(name, ...args);
    if (String(name).endsWith(".original.webp")) handle.writeFile = async () => {
      injected = true; throw Object.assign(new Error("Synthetic preview I/O failure"), { code: "EIO" });
    };
    return handle;
  };
  try {
    await assert.rejects(() => upload(item.id));
    assert.equal(injected, true);
    assert.equal(await db.asset.count({ where: { itemId: item.id } }), 0);
    assert.deepEqual((await fs.readdir(process.env.MEDIA_DIR)).sort(), before);
  } finally { fs.open = open; }
});

test("孤儿扫描默认只读，保留 Asset/Intake/Candidate 引用及年轻文件", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const { scanMedia } = await import("../scripts/scan-orphan-media.mjs");
  const directory = await fs.mkdtemp(path.resolve("data/scanner-test-"));
  const refs = (await Promise.all([db.asset.findMany(), db.intakeFile.findMany(), db.ingestCandidateAsset.findMany()])).flat();
  for (const row of refs) {
    await fs.writeFile(path.join(directory, row.objectKey), "synthetic referenced original");
    await fs.writeFile(path.join(directory, row.objectKey + ".webp"), "synthetic referenced preview");
  }
  const key = randomUUID() + ".original", young = randomUUID() + ".original";
  const names = [key, key + ".webp", young];
  for (const name of names) await fs.writeFile(path.join(directory, name), "synthetic orphan");
  const old = new Date(Date.now() - 2 * 86400000);
  for (const name of names.slice(0, 2)) await fs.utimes(path.join(directory, name), old, old);
  try {
    const before = await scanMedia(db, directory);
    assert.ok(before.orphanOriginals.includes(key));
    assert.equal(before.deleted.length, 0);
    // Offline maintenance is tested through the CLI separately; this operation is
    // isolated to the synthetic files created here by setting a fresh directory.
    for (const row of refs) assert.ok(!before.orphanOriginals.includes(row.objectKey));
    const applied = await scanMedia(db, directory, { apply: true });
    assert.ok(applied.deleted.includes(key));
    assert.ok(applied.deleted.includes(key + ".webp"));
    assert.ok(!applied.deleted.includes(young));
    for (const row of refs) assert.ok(!applied.deleted.includes(row.objectKey));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("登录和当前会话能力来自后端权限，角色变化撤销旧会话", async () => {
  const { capabilitiesFor, permission } = require("../dist/auth/auth");
  const roles = ["ADMIN", "REVIEWER", "OPERATOR", "FINANCE", "VIEWER"];
  const actions = capabilitiesFor("ADMIN");
  for (const role of roles) {
    const email = `cap-${randomUUID()}@tome.test`, password = "Synthetic!" + randomUUID();
    const user = await ok("/auth/users", "POST", { email, password, name: "合成权限核对", role });
    const auth = await api("/auth/login", "POST", { email, password }, null);
    assert.equal(auth.status, 201);
    assert.deepEqual([...auth.data.capabilities].sort(), actions.filter((a) => permission(role, a)).sort());
    const session = { ...auth.data.user, csrf: auth.data.csrf, cookie: auth.headers.get("set-cookie").split(";")[0] };
    const me = await ok("/auth/me", "GET", undefined, session);
    assert.deepEqual(me.capabilities, auth.data.capabilities);
    assert.equal((await api("/auth/users", "GET", undefined, session)).status, permission(role, "users") ? 200 : 403);
    await ok("/auth/user-access", "POST", { id: user.id, active: true, role: role === "VIEWER" ? "OPERATOR" : "VIEWER" });
    assert.equal((await api("/auth/me", "GET", undefined, session)).status, 401);
  }
});

test("Distribution Intent：经营目标只记录交易意图并保留同平台确认、审计与幂等", async () => {
  assert.equal(channel.businessPurpose, "TRADE");
  assert.equal(showChannel.businessPurpose, "SHOWROOM");
  const xhs = await ok("/channels", "POST", {
    name: "内容渠道 " + randomUUID().slice(0, 8),
    platform: "XHS",
    locale: "zh-CN",
    titleLimit: 80,
  });
  assert.equal(xhs.businessPurpose, "CONTENT");
  const wrongPurpose = await api("/channels", "POST", {
    name: "错误内容用途 " + randomUUID().slice(0, 8),
    platform: "XHS",
    locale: "zh-CN",
    titleLimit: 80,
    businessPurpose: "TRADE",
  });
  assert.equal(wrongPurpose.status, 400);
  assert.equal(wrongPurpose.data.error.code, "CHANNEL_PURPOSE_REQUIRED");
  const content = await ok("/channels", "POST", {
    name: "非交易内容账号 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
    businessPurpose: "CONTENT",
  });
  const i = await sparse();
  assert.deepEqual(await ok(`/items/${i.id}/distribution-targets`), []);
  const noTargetOperations = await ok(
    `/distribution/operations?channelId=${channel.id}&q=${encodeURIComponent((await item(i.id)).code)}`,
  );
  assert.equal(
    noTargetOperations.rows.some((row) => row.item.id === i.id),
    false,
  );
  const contentPrice = await api(
    `/items/${i.id}/channel-prices/${content.id}`,
    "POST",
    { amount: 100000, currency: "CNY" },
  );
  assert.equal(contentPrice.status, 400);
  assert.equal(contentPrice.data.error.code, "TRADE_CHANNEL_REQUIRED");
  const contentReadiness = await api(
    `/items/${i.id}/readiness?channelId=${content.id}&purpose=TRADE`,
  );
  assert.equal(contentReadiness.status, 400);
  assert.equal(contentReadiness.data.error.code, "TRADE_CHANNEL_REQUIRED");
  const contentPackage = await api(`/items/${i.id}/packages`, "POST", {
    channelId: content.id,
    purpose: "TRADE",
    confirmed: true,
  });
  assert.equal(contentPackage.status, 400);
  assert.equal(contentPackage.data.error.code, "TRADE_CHANNEL_REQUIRED");
  const legacyChannel = await ok("/channels", "POST", {
    name: "历史交易包渠道 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
  });
  const legacyItem = await ready();
  const legacyPackage = await pack(legacyItem.id, legacyChannel);
  await db.channel.update({
    where: { id: legacyChannel.id },
    data: { businessPurpose: "CONTENT" },
  });
  const legacyPlan = await api("/distribution/plan", "POST", {
    packageId: legacyPackage.id,
  });
  assert.equal(legacyPlan.status, 400);
  assert.equal(legacyPlan.data.error.code, "TRADE_CHANNEL_REQUIRED");
  const contentTarget = await api(
    `/items/${i.id}/distribution-targets/${content.id}`,
    "POST",
    {
      active: true,
      reason: "内容账号不能成为交易经营目标",
      duplicatePlatformConfirmed: false,
    },
  );
  assert.equal(contentTarget.status, 400);
  assert.equal(contentTarget.data.error.code, "TRADE_CHANNEL_REQUIRED");
  const closedContentTarget = await api(
    `/items/${i.id}/distribution-targets/${content.id}`,
    "POST",
    {
      active: false,
      reason: "内容账号不应留下关闭的交易目标",
      duplicatePlatformConfirmed: false,
    },
  );
  assert.equal(closedContentTarget.status, 400);
  assert.equal(closedContentTarget.data.error.code, "TRADE_CHANNEL_REQUIRED");

  const targetKey = randomUUID();
  const body = {
    active: true,
    reason: "本周由闲鱼主号经营，先记录意图再补发布资料",
    duplicatePlatformConfirmed: false,
  };
  const first = await ok(
    `/items/${i.id}/distribution-targets/${channel.id}`,
    "POST",
    body,
    admin,
    targetKey,
  );
  const replayed = await ok(
    `/items/${i.id}/distribution-targets/${channel.id}`,
    "POST",
    body,
    admin,
    targetKey,
  );
  assert.deepEqual(replayed, first);
  assert.equal(first.active, true);
  assert.equal(first.version, 1);
  assert.equal(await db.usePackage.count({ where: { itemId: i.id } }), 0);
  assert.equal(await db.distributionAttempt.count({ where: { itemId: i.id } }), 0);
  assert.equal(await db.listing.count({ where: { itemId: i.id } }), 0);
  const targets = await ok(`/items/${i.id}/distribution-targets`);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].channel.businessPurpose, "TRADE");
  assert.ok(await db.audit.findFirst({ where: { resourceId: i.id, action: "DISTRIBUTION_TARGET_CREATED" } }));
  assert.ok(await db.outbox.findFirst({ where: { itemId: i.id, kind: "DISTRIBUTION_TARGET_CHANGED" } }));
  assert.ok(await db.receipt.findFirst({ where: { actorId: admin.id, operation: "distribution.target.set", key: targetKey } }));
  const activeTargetOperations = await ok(
    `/distribution/operations?channelId=${channel.id}&q=${encodeURIComponent((await item(i.id)).code)}`,
  );
  assert.equal(
    activeTargetOperations.rows.find((row) => row.item.id === i.id).state,
    "BLOCKED",
  );

  const samePlatform = await ok("/channels", "POST", {
    name: "闲鱼第二账号 " + randomUUID().slice(0, 8),
    platform: "XIANYU",
    locale: "zh-CN",
    titleLimit: 80,
  });
  const needsConfirmation = await api(
    `/items/${i.id}/distribution-targets/${samePlatform.id}`,
    "POST",
    { active: true, reason: "备用账号也计划经营", duplicatePlatformConfirmed: false },
  );
  assert.equal(needsConfirmation.status, 409);
  assert.equal(needsConfirmation.data.error.code, "DUPLICATE_PLATFORM_TARGET_CONFIRMATION_REQUIRED");
  const second = await ok(
    `/items/${i.id}/distribution-targets/${samePlatform.id}`,
    "POST",
    { active: true, reason: "备用账号也计划经营", duplicatePlatformConfirmed: true },
  );
  assert.equal(second.active, true);
  const closed = await ok(
    `/items/${i.id}/distribution-targets/${channel.id}`,
    "POST",
    { active: false, reason: "本周停止该账号经营意图", duplicatePlatformConfirmed: false },
  );
  assert.equal(closed.active, false);
  assert.equal(closed.version, 2);
  const stored = await db.distributionTarget.findUniqueOrThrow({
    where: { itemId_channelId: { itemId: i.id, channelId: channel.id } },
  });
  assert.equal(stored.note, "本周停止该账号经营意图");
  assert.equal(stored.active, false);
  const closedTargetOperations = await ok(
    `/distribution/operations?channelId=${channel.id}&q=${encodeURIComponent((await item(i.id)).code)}`,
  );
  assert.equal(
    closedTargetOperations.rows.some((row) => row.item.id === i.id),
    false,
  );
});

test("Distribution Foundation：渠道配置、会话令牌和同包计划保持受限且不落明文", async () => {
  const overseas = await ok("/channels", "POST", {
    name: "合成海外站账号 " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    locale: "en",
    titleLimit: 120,
    defaultCurrency: "USD",
    distributionMode: "API",
    endpointUrl: "https://example.invalid/catalog",
  });
  assert.equal(overseas.defaultCurrency, "USD");
  assert.equal(overseas.distributionMode, "API");
  assert.equal(
    (
      await api("/channels", "POST", {
        name: "拒绝凭据地址",
        platform: "OTHER",
        endpointUrl: "https://example.invalid/?token=not-allowed",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("/channels", "POST", {
        name: "拒绝片段凭据",
        platform: "OTHER",
        endpointUrl: "https://example.invalid/#access_token=not-allowed",
      })
    ).status,
    400,
  );
  const i = await ready(), p = await pack(i.id);
  const first = await ok("/distribution/plan", "POST", { packageId: p.id });
  const repeated = await ok("/distribution/plan", "POST", { packageId: p.id });
  assert.equal(first.id, repeated.id);
  assert.equal(repeated.existing, true);
  assert.equal(await db.distributionAttempt.count({ where: { packageId: p.id } }), 1);
  const session = await distributionSession(channel.id, "同渠道合成会话");
  assert.match(session.token, /^[a-f0-9]{64}$/);
  const stored = await db.distributionSession.findUniqueOrThrow({ where: { id: session.id } });
  assert.equal(stored.tokenHash, createHash("sha256").update(session.token).digest("hex"));
  assert.equal(JSON.stringify(stored).includes(session.token), false);
  const receipt = await db.receipt.findFirstOrThrow({
    where: { actorId: admin.id, operation: "distribution.session.create" },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(JSON.stringify(receipt.response).includes(session.token), false);
  const direct = await fetch(origin + "/api/items", {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Distribution-Token": session.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "分发令牌越权写入" }),
  });
  assert.equal(direct.status, 401);
  const protocol = await distributionAgentOk("/distribution-agent/protocol", session.token);
  assert.equal(protocol.session.channelId, channel.id);
  const second = await ok("/channels", "POST", {
    name: "隔离账号 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
  });
  const foreign = await distributionSession(second.id, "其他账号会话");
  assert.deepEqual(await distributionAgentOk("/distribution-agent/attempts", foreign.token), []);
  assert.equal(
    (await distributionAgentApi(`/distribution-agent/attempts/${first.id}/claim`, foreign.token, "POST")).status,
    404,
  );
});

test("标准分发交付合同：冻结资料、薄 MCP、渠道隔离与人工核对保持受控", async () => {
  const firstItem = await ready();
  const defect = await upload(firstItem.id, { role: "DEFECT" });
  await assetReview(defect.id, { position: 1 });
  const firstPackage = await pack(firstItem.id);
  const first = await ok("/distribution/plan", "POST", {
    packageId: firstPackage.id,
  });
  const session = await distributionSession(channel.id, "标准交付合成会话");
  const pending = await distributionHandoffOk("/handoffs", session.token);
  assert.ok(pending.some((row) => row.recordId === first.id && row.status === "PENDING"));

  const foreignChannel = await ok("/channels", "POST", {
    name: "标准交付隔离账号 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
  });
  const foreign = await distributionSession(foreignChannel.id, "标准交付隔离会话");
  assert.deepEqual(await distributionHandoffOk("/handoffs", foreign.token), []);
  assert.equal(
    (
      await distributionHandoffApi(
        `/handoffs/${first.id}/package`,
        foreign.token,
        "POST",
        undefined,
        randomUUID(),
      )
    ).status,
    404,
  );

  const packageKey = randomUUID();
  const delivered = await distributionHandoffOk(
    `/handoffs/${first.id}/package`,
    session.token,
    "POST",
    undefined,
    packageKey,
  );
  assert.equal(delivered.recordId, first.id);
  assert.equal(delivered.action, "PUBLISH");
  assert.equal(delivered.tm, firstItem.code);
  assert.equal(delivered.channel.id, channel.id);
  assert.equal(delivered.package.price, 200000);
  assert.equal(delivered.package.currency, "CNY");
  assert.deepEqual(delivered.package.images.map((image) => image.position), [0, 1]);
  assert.ok(delivered.package.images.some((image) => image.role === "DEFECT"));
  assert.equal(
    (
      await db.distributionAttempt.findUniqueOrThrow({ where: { id: first.id } })
    ).leaseUntil,
    null,
  );
  assert.deepEqual(
    await distributionHandoffOk(
      `/handoffs/${first.id}/package`,
      session.token,
      "POST",
      undefined,
      packageKey,
    ),
    delivered,
  );
  assert.equal(
    (
      await db.distributionAttempt.findUniqueOrThrow({ where: { id: first.id } })
    ).attemptCount,
    1,
  );
  assert.equal(
    (
      await distributionAgentApi(delivered.package.images[0].download, session.token)
    ).status,
    200,
  );
  const unrelated = await ready();
  assert.equal(
    (
      await distributionAgentApi(
        `/distribution-agent/handoffs/${first.id}/assets/${unrelated.asset}`,
        session.token,
      )
    ).status,
    403,
  );

  const tools = await distributionMcpApi(session.token, {
    jsonrpc: "2.0",
    id: "distribution-tools",
    method: "tools/list",
  });
  assert.equal(tools.status, 200);
  assert.deepEqual(
    tools.data.result.tools.map((tool) => tool.name).sort(),
    [
      "tome_distribution_get_package",
      "tome_distribution_list_handoffs",
      "tome_distribution_report_attention",
      "tome_distribution_report_published",
    ],
  );
  assert.equal(
    (await distributionMcpApi(session.token, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { Origin: "https://not-tome.test" })).status,
    403,
  );
  const ownMcpHandoffs = await distributionMcpTool(
    session.token,
    "tome_distribution_list_handoffs",
  );
  assert.equal(ownMcpHandoffs.isError, false);
  assert.ok(ownMcpHandoffs.value.some((row) => row.recordId === first.id));

  const confirmedItem = await ready();
  const confirmed = await ok("/distribution/plan", "POST", {
    packageId: (await pack(confirmedItem.id)).id,
  });
  const mcpPackage = await distributionMcpTool(
    session.token,
    "tome_distribution_get_package",
    { idempotencyKey: randomUUID(), recordId: confirmed.id },
  );
  assert.equal(mcpPackage.isError, false);
  assert.equal(mcpPackage.value.recordId, confirmed.id);
  const published = await distributionMcpTool(
    session.token,
    "tome_distribution_report_published",
    {
      idempotencyKey: randomUUID(),
      recordId: confirmed.id,
      note: "合成外部执行方已按永久 TM 确认完成，APP 未返回稳定编号。",
    },
  );
  assert.equal(published.isError, false);
  assert.equal(published.value.status, "SUCCEEDED");
  assert.equal(
    await db.listing.count({ where: { itemId: confirmedItem.id, channelId: channel.id } }),
    0,
  );

  await sold(confirmedItem.id);
  const stop = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${confirmed.id}` },
  });
  const stopPackage = await distributionHandoffOk(
    `/handoffs/${stop.id}/package`,
    session.token,
    "POST",
    undefined,
    randomUUID(),
  );
  assert.equal(stopPackage.action, "DELIST");
  assert.equal(stopPackage.tm, confirmedItem.code);
  assert.equal(stopPackage.package, null);
  assert.equal(
    (
      await distributionAgentApi(
        `/distribution-agent/handoffs/${stop.id}/assets/${confirmedItem.asset}`,
        session.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await distributionHandoffOk(
        `/handoffs/${stop.id}/published`,
        session.token,
        "POST",
        { note: "已按永久 TM 确认停售完成。" },
        randomUUID(),
      )
    ).status,
    "SUCCEEDED",
  );

  const attentionItem = await ready();
  const attention = await ok("/distribution/plan", "POST", {
    packageId: (await pack(attentionItem.id)).id,
  });
  await distributionHandoffOk(
    `/handoffs/${attention.id}/package`,
    session.token,
    "POST",
    undefined,
    randomUUID(),
  );
  const needsReview = await distributionMcpTool(
    session.token,
    "tome_distribution_report_attention",
    {
      idempotencyKey: randomUUID(),
      recordId: attention.id,
      note: "外部执行后没有明确回执，需要运营人员在原记录核对。",
    },
  );
  assert.equal(needsReview.isError, false);
  assert.equal(needsReview.value.status, "UNKNOWN");
  const blockedPublish = await distributionMcpTool(
    session.token,
    "tome_distribution_report_published",
    {
      idempotencyKey: randomUUID(),
      recordId: attention.id,
      note: "外部 Agent 不能替代人工核对。",
    },
  );
  assert.equal(blockedPublish.isError, true);
  assert.equal(blockedPublish.value.code, "RECONCILIATION_REQUIRED");
  assert.equal(
    (
      await distributionHandoffApi(
        `/handoffs/${attention.id}/package`,
        session.token,
        "POST",
        undefined,
        randomUUID(),
      )
    ).data.error.code,
    "RECONCILIATION_REQUIRED",
  );

  const fakeItem = await ready();
  const fake = await ok("/distribution/plan", "POST", {
    packageId: (await pack(fakeItem.id)).id,
  });
  await distributionHandoffOk(
    `/handoffs/${fake.id}/package`,
    session.token,
    "POST",
    undefined,
    randomUUID(),
  );
  const fakeId = await distributionHandoffApi(
    `/handoffs/${fake.id}/published`,
    session.token,
    "POST",
    { note: "不能伪造远端编号。", remoteId: "MANUAL:TM000001" },
    randomUUID(),
  );
  assert.equal(fakeId.status, 400);
  assert.equal(fakeId.data.error.code, "FAKE_REMOTE_ID_DENIED");

  const delegatePassword = "Synthetic!" + randomUUID();
  const delegateUser = await ok("/auth/users", "POST", {
    name: "标准交付权限回归",
    email: randomUUID() + "@tome.test",
    password: delegatePassword,
    role: "ADMIN",
  });
  const delegate = await login(delegateUser.email, delegatePassword);
  const revokedSession = await ok(
    "/distribution/sessions",
    "POST",
    {
      channelId: channel.id,
      label: "待撤销标准交付会话",
      agentName: "synthetic-revocation-check",
      expiresAt: future(),
    },
    delegate,
  );
  await ok("/auth/user-access", "POST", {
    id: delegate.id,
    active: true,
    role: "VIEWER",
  });
  const revoked = await distributionHandoffApi("/handoffs", revokedSession.token);
  assert.equal(revoked.status, 403);
  assert.equal(revoked.data.error.code, "DISTRIBUTION_CREATOR_REVOKED");
});

test("Distribution Handoff Closure：发现合同、AnQi 回执、兼容开关与动态核对均不替代外部执行", async () => {
  const session = await distributionSession(channel.id, "Handoff Closure 闲鱼会话");
  const protocol = await distributionBearerApi(
    "/distribution-agent/protocol",
    session.token,
  );
  assert.equal(protocol.status, 200);
  assert.equal(protocol.data.protocolVersion, "1.0");
  assert.equal(protocol.data.skill.id, "tome-distribution/1.0");
  assert.equal(protocol.data.profile.id, "XIANYU/1.0");
  assert.deepEqual(protocol.data.handoff.tools, [
    "tome_distribution_list_handoffs",
    "tome_distribution_get_package",
    "tome_distribution_report_published",
    "tome_distribution_report_attention",
  ]);
  const skill = await distributionBearerApi(
    "/distribution-agent/skill",
    session.token,
  );
  const profile = await distributionBearerApi(
    "/distribution-agent/profile",
    session.token,
  );
  assert.equal(skill.status, 200);
  assert.equal(profile.status, 200);
  assert.match(skill.raw, /^# ToMeBoutique 标准分发交付 Skill/m);
  assert.match(profile.raw, /^# 闲鱼分发 Profile/m);
  assert.equal(skill.headers.get("cache-control"), "private, no-store");
  assert.equal(
    createHash("sha256").update(skill.raw).digest("hex"),
    protocol.data.skill.sha256,
  );
  assert.equal(
    createHash("sha256").update(profile.raw).digest("hex"),
    protocol.data.profile.sha256,
  );
  const initialize = await distributionMcpBearerApi(session.token, {
    jsonrpc: "2.0",
    id: "distribution-bearer-initialize",
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "Synthetic Bearer Handoff", version: "1.0" },
    },
  });
  assert.equal(initialize.status, 200);
  assert.equal(initialize.data.result.serverInfo.name, "tome-distribution");
  assert.equal(initialize.data.result.skill.sha256, protocol.data.skill.sha256);
  assert.equal(
    initialize.data.result.profile.sha256,
    protocol.data.profile.sha256,
  );

  delete process.env.DISTRIBUTION_COMPAT_RUNTIME_ENABLED;
  try {
    const disabled = await distributionAgentApi(
      "/distribution-agent/attempts",
      session.token,
    );
    assert.equal(disabled.status, 410);
    assert.equal(
      disabled.data.error.code,
      "COMPAT_DISTRIBUTION_RUNTIME_DISABLED",
    );
    assert.equal((await distributionHandoffApi("/handoffs", session.token)).status, 200);
  } finally {
    process.env.DISTRIBUTION_COMPAT_RUNTIME_ENABLED = "true";
  }
  assert.ok(
    (await distributionAgentApi("/distribution-agent/attempts", session.token))
      .status < 300,
  );

  const anqicms = await ok("/channels", "POST", {
    name: "Handoff Closure AnQi " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    locale: "en",
    titleLimit: 120,
    defaultCurrency: "USD",
    distributionMode: "API",
  });
  const anqiItem = await ready({ category: "BAG" });
  await ok(`/items/${anqiItem.id}/channel-prices/${anqicms.id}`, "POST", {
    amount: 138000,
    currency: "USD",
  });
  const anqiAttempt = await ok("/distribution/plan", "POST", {
    packageId: (await pack(anqiItem.id, anqicms)).id,
  });
  const anqiSession = await distributionSession(
    anqicms.id,
    "Handoff Closure AnQi 会话",
  );
  const anqiPackage = await distributionHandoffOk(
    `/handoffs/${anqiAttempt.id}/package`,
    anqiSession.token,
    "POST",
    undefined,
    randomUUID(),
  );
  assert.equal(anqiPackage.platformData.schema, "tome.anqicms/v1");
  assert.equal(anqiPackage.platformData.payload.protocol, "tome.anqicms.spike/v1");
  assert.equal(anqiPackage.platformData.payload.identity.tm_code, anqiItem.code);
  const missingArchive = await distributionHandoffApi(
    `/handoffs/${anqiAttempt.id}/published`,
    anqiSession.token,
    "POST",
    { note: "合成 AnQi 回执遗漏 archive ID。" },
    randomUUID(),
  );
  assert.equal(missingArchive.status, 400);
  assert.equal(missingArchive.data.error.code, "ANQICMS_ARCHIVE_ID_REQUIRED");
  assert.equal(
    (await db.distributionAttempt.findUniqueOrThrow({ where: { id: anqiAttempt.id } }))
      .state,
    "RUNNING",
  );
  const archiveId = "archive-" + randomUUID();
  const anqiPublished = await distributionHandoffOk(
    `/handoffs/${anqiAttempt.id}/published`,
    anqiSession.token,
    "POST",
    {
      note: "合成 AnQi 回执返回稳定 archive ID。",
      remoteId: archiveId,
      remoteUrl: "https://example.invalid/archive/" + archiveId,
    },
    randomUUID(),
  );
  assert.equal(anqiPublished.status, "SUCCEEDED");
  assert.equal(
    await db.listing.count({
      where: { channelId: anqicms.id, remoteId: archiveId },
    }),
    1,
  );
  await sold(anqiItem.id, { channelId: anqicms.id });
  const anqiDelist = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${anqiAttempt.id}` },
  });
  const anqiStopPackage = await distributionHandoffOk(
    `/handoffs/${anqiDelist.id}/package`,
    anqiSession.token,
    "POST",
    undefined,
    randomUUID(),
  );
  assert.equal(anqiStopPackage.package, null);
  assert.equal(anqiStopPackage.platformData.schema, "tome.anqicms/v1");
  assert.equal(anqiStopPackage.platformData.payload.operation, "STOCK_ZERO");
  assert.equal(anqiStopPackage.platformData.payload.identity.archive_id, archiveId);

  const appItem = await ready();
  const appAttempt = await ok("/distribution/plan", "POST", {
    packageId: (await pack(appItem.id)).id,
  });
  await distributionHandoffOk(
    `/handoffs/${appAttempt.id}/package`,
    session.token,
    "POST",
    undefined,
    randomUUID(),
  );
  assert.equal(
    (
      await distributionHandoffOk(
        `/handoffs/${appAttempt.id}/published`,
        session.token,
        "POST",
        { note: "合成 APP 按永久 TM 确认完成但未提供稳定远端编号。" },
        randomUUID(),
      )
    ).status,
    "SUCCEEDED",
  );
  assert.equal(
    await db.listing.count({ where: { itemId: appItem.id, channelId: channel.id } }),
    0,
  );

  const staleItem = await ready();
  const staleAttempt = await ok("/distribution/plan", "POST", {
    packageId: (await pack(staleItem.id)).id,
  });
  await distributionHandoffOk(
    `/handoffs/${staleAttempt.id}/package`,
    session.token,
    "POST",
    undefined,
    randomUUID(),
  );
  await db.distributionAttempt.update({
    where: { id: staleAttempt.id },
    data: { startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
  });
  const staleOperations = await ok(
    `/distribution/operations?attemptId=${staleAttempt.id}`,
  );
  const stale = staleOperations.rows.find((row) => row.attempt?.id === staleAttempt.id);
  assert.equal(stale.state, "ATTENTION");
  assert.equal(stale.attempt.errorCode, "HANDOFF_STALE");
  const staleStored = await db.distributionAttempt.findUniqueOrThrow({
    where: { id: staleAttempt.id },
  });
  assert.equal(staleStored.state, "RUNNING");
  assert.equal(staleStored.attemptCount, 1);

  const deadItem = await ready();
  const deadAttempt = await ok("/distribution/plan", "POST", {
    packageId: (await pack(deadItem.id)).id,
  });
  const deadSession = await distributionSession(channel.id, "失效 Handoff 会话");
  await distributionHandoffOk(
    `/handoffs/${deadAttempt.id}/package`,
    deadSession.token,
    "POST",
    undefined,
    randomUUID(),
  );
  await ok(`/distribution/sessions/${deadSession.id}/revoke`, "POST", {});
  const deadOperations = await ok(
    `/distribution/operations?attemptId=${deadAttempt.id}`,
  );
  const dead = deadOperations.rows.find((row) => row.attempt?.id === deadAttempt.id);
  assert.equal(dead.state, "ATTENTION");
  assert.equal(dead.attempt.errorCode, "HANDOFF_SESSION_DEAD");
  assert.equal(
    (await db.distributionAttempt.findUniqueOrThrow({ where: { id: deadAttempt.id } }))
      .state,
    "RUNNING",
  );
});

test("Distribution Foundation：并发领取、过期租约与失败重试只复用同一执行事实", async () => {
  const i = await ready(), p = await pack(i.id);
  const attempt = await ok("/distribution/plan", "POST", { packageId: p.id });
  const one = await distributionSession(channel.id, "并发领取一"), two = await distributionSession(channel.id, "并发领取二");
  const claimed = await Promise.all([
    distributionAgentApi(`/distribution-agent/attempts/${attempt.id}/claim`, one.token, "POST"),
    distributionAgentApi(`/distribution-agent/attempts/${attempt.id}/claim`, two.token, "POST"),
  ]);
  assert.deepEqual(claimed.map((r) => r.status).sort(), [201, 409]);
  const winner = claimed[0].status === 201 ? one : two;
  const reclaimer = winner === one ? two : one;
  await db.distributionAttempt.update({
    where: { id: attempt.id },
    data: { leaseUntil: new Date(Date.now() - 1000) },
  });
  const reclaimed = await distributionAgentOk(
    `/distribution-agent/attempts/${attempt.id}/claim`,
    reclaimer.token,
    "POST",
  );
  assert.equal(reclaimed.state, "RUNNING");
  const payload = await distributionAgentOk(
    `/distribution-agent/attempts/${attempt.id}/payload`,
    reclaimer.token,
  );
  assert.equal(payload.product.code, (await item(i.id)).code);
  assert.equal(
    (await distributionAgentApi(payload.product.images[0].download, reclaimer.token)).status,
    200,
  );
  const unrelated = await ready();
  assert.equal(
    (
      await distributionAgentApi(
        `/distribution-agent/attempts/${attempt.id}/assets/${unrelated.asset}`,
        reclaimer.token,
      )
    ).status,
    403,
  );
  await distributionAgentOk(
    `/distribution-agent/attempts/${attempt.id}/result`,
    reclaimer.token,
    "POST",
    { state: "FAILED", errorCode: "SYNTHETIC_FAILURE", errorMessage: "合成明确失败，可安全重试" },
  );
  const retried = await ok(`/distribution/attempts/${attempt.id}/retry`, "POST");
  assert.equal(retried.state, "PENDING");
  const repeated = await ok("/distribution/plan", "POST", { packageId: p.id });
  assert.equal(repeated.id, attempt.id);
  assert.equal(await db.distributionAttempt.count({ where: { packageId: p.id } }), 1);
});

test("Distribution Foundation：UNKNOWN 必须复核原 Attempt，成功可无远端ID，稳定ID才创建 Listing", async () => {
  const i = await ready(), p = await pack(i.id), session = await distributionSession();
  const unknown = await ok("/distribution/plan", "POST", { packageId: p.id });
  await distributionAgentOk(`/distribution-agent/attempts/${unknown.id}/claim`, session.token, "POST");
  await distributionAgentOk(`/distribution-agent/attempts/${unknown.id}/result`, session.token, "POST", {
    state: "UNKNOWN",
    errorCode: "RESULT_NOT_CONFIRMED",
    errorMessage: "提交后未获得明确结果，必须先通过TM核对",
  });
  assert.equal((await ok("/distribution/plan", "POST", { packageId: p.id })).id, unknown.id);
  const retry = await api(`/distribution/attempts/${unknown.id}/retry`, "POST");
  assert.equal(retry.status, 409);
  assert.equal(retry.data.error.code, "RECONCILIATION_REQUIRED");
  const reconcile = await distributionAgentOk(`/distribution-agent/attempts/${unknown.id}/claim`, session.token, "POST");
  assert.equal(reconcile.reconcile, true);
  const locator = await distributionAgentOk(`/distribution-agent/attempts/${unknown.id}/payload`, session.token);
  assert.equal(locator.reconcile, true);
  assert.match(locator.product.locator, /^标题中的 TM\d+$/);
  assert.equal(
    (await distributionAgentApi(`/distribution-agent/attempts/${unknown.id}/assets/${i.asset}`, session.token)).status,
    409,
  );
  await distributionAgentOk(`/distribution-agent/attempts/${unknown.id}/result`, session.token, "POST", {
    state: "SUCCEEDED",
    remoteId: "",
    remoteUrl: "",
    evidence: { method: "TM_SEARCH", note: "指定账号商品列表中可检索到永久TM。" },
  });
  assert.equal((await db.distributionAttempt.findUniqueOrThrow({ where: { id: unknown.id } })).state, "SUCCEEDED");
  assert.equal(await db.listing.count({ where: { itemId: i.id, channelId: channel.id } }), 0);
  const stableItem = await ready(), stablePack = await pack(stableItem.id);
  const stable = await ok("/distribution/plan", "POST", { packageId: stablePack.id });
  await distributionAgentOk(`/distribution-agent/attempts/${stable.id}/claim`, session.token, "POST");
  const remoteId = "synthetic-remote-" + randomUUID();
  await distributionAgentOk(`/distribution-agent/attempts/${stable.id}/result`, session.token, "POST", {
    state: "SUCCEEDED",
    remoteId,
    remoteUrl: "https://example.invalid/products/synthetic",
    evidence: { method: "PLATFORM_RECEIPT", note: "合成平台返回稳定商品编号。" },
  });
  const listing = await db.listing.findUniqueOrThrow({ where: { channelId_remoteId: { channelId: channel.id, remoteId } } });
  assert.equal(listing.itemId, stableItem.id);
  const collisionItem = await ready(), collisionPack = await pack(collisionItem.id);
  const collision = await ok("/distribution/plan", "POST", { packageId: collisionPack.id });
  await distributionAgentOk(`/distribution-agent/attempts/${collision.id}/claim`, session.token, "POST");
  assert.equal(
    (
      await distributionAgentApi(`/distribution-agent/attempts/${collision.id}/result`, session.token, "POST", {
        state: "SUCCEEDED",
        remoteId,
        evidence: { method: "PLATFORM_RECEIPT", note: "合成冲突编号，不得绑定另一件商品。" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("/listings", "POST", { packageId: stablePack.id, remoteId: "MANUAL:TM000001" })
    ).status,
    400,
  );
});

test("Distribution handoff：人工核对与资料指纹防止重复交付", async () => {
  const i = await ready();
  const firstPack = await pack(i.id);
  const first = await ok("/distribution/plan", "POST", {
    packageId: firstPack.id,
  });
  assert.equal(first.action, "PUBLISH");

  // A later frozen package cannot bypass an outstanding handoff for this
  // account. The operator is sent back to the original record instead.
  const whilePending = await pack(i.id);
  const blocked = await ok("/distribution/plan", "POST", {
    packageId: whilePending.id,
  });
  assert.equal(blocked.id, first.id);
  assert.equal(blocked.existing, true);

  await ok(`/distribution/attempts/${first.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: { method: "TM_SEARCH", note: "合成账号内可按永久 TM 找到商品。" },
  });
  const identical = await pack(i.id);
  const noop = await ok("/distribution/plan", "POST", {
    packageId: identical.id,
  });
  assert.equal(noop.id, first.id);
  assert.equal(noop.action, "NOOP");
  assert.equal(noop.noop, true);

  await ok(`/items/${i.id}/channel-prices/${channel.id}`, "POST", {
    amount: 201000,
    currency: "CNY",
  });
  const changed = await pack(i.id);
  const update = await ok("/distribution/plan", "POST", {
    packageId: changed.id,
  });
  assert.equal(update.action, "UPDATE");
  assert.notEqual(update.id, first.id);
  await ok(`/distribution/attempts/${update.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: { method: "TM_SEARCH", note: "合成账号内已按新资料核对。" },
  });
  const unchangedUpdate = await pack(i.id);
  const updateNoop = await ok("/distribution/plan", "POST", {
    packageId: unchangedUpdate.id,
  });
  assert.equal(updateNoop.id, update.id);
  assert.equal(updateNoop.action, "NOOP");

  // This simulates the completed stop fact that the next PR will attach to a
  // source publish generation. Planner behavior must already allow a fresh
  // handoff after a confirmed stop.
  await db.distributionAttempt.create({
    data: {
      itemId: i.id,
      channelId: channel.id,
      action: "DELIST",
      state: "SUCCEEDED",
      dedupeKey: "synthetic-stop:" + randomUUID(),
      finishedAt: new Date(Date.now() + 1000),
    },
  });
  const afterStop = await pack(i.id);
  const republish = await ok("/distribution/plan", "POST", {
    packageId: afterStop.id,
  });
  assert.equal(republish.action, "PUBLISH");
  assert.notEqual(republish.id, first.id);

  const successItem = await ready();
  const unknownSuccess = await ok("/distribution/plan", "POST", {
    packageId: (await pack(successItem.id)).id,
  });
  await ok(
    `/distribution/attempts/${unknownSuccess.id}/manual-result`,
    "POST",
    {
      state: "UNKNOWN",
      errorCode: "SYNTHETIC_UNKNOWN",
      errorMessage: "合成回执未能确认结果。",
    },
  );
  await ok(
    `/distribution/attempts/${unknownSuccess.id}/manual-result`,
    "POST",
    {
      state: "SUCCEEDED",
      evidence: {
        method: "RECONCILIATION",
        note: "人工按永久 TM 核对确认已发布。",
      },
      errorCode: "STALE_ERROR",
      errorMessage: "不应保留",
    },
  );
  const reconciledSuccess = await db.distributionAttempt.findUniqueOrThrow({
    where: { id: unknownSuccess.id },
  });
  assert.equal(reconciledSuccess.state, "SUCCEEDED");
  assert.equal(reconciledSuccess.errorCode, "");
  assert.equal(reconciledSuccess.errorMessage, "");

  const failureItem = await ready();
  const unknownFailure = await ok("/distribution/plan", "POST", {
    packageId: (await pack(failureItem.id)).id,
  });
  await ok(
    `/distribution/attempts/${unknownFailure.id}/manual-result`,
    "POST",
    {
      state: "UNKNOWN",
      errorCode: "SYNTHETIC_UNKNOWN",
      errorMessage: "合成回执未能确认结果。",
    },
  );
  await ok(
    `/distribution/attempts/${unknownFailure.id}/manual-result`,
    "POST",
    {
      state: "FAILED",
      evidence: {
        method: "RECONCILIATION",
        note: "人工按永久 TM 核对确认未发布。",
      },
      errorCode: "NOT_FOUND_AFTER_RECONCILIATION",
      errorMessage: "目标渠道中未找到该 TM。",
    },
  );
  assert.equal(
    (
      await db.distributionAttempt.findUniqueOrThrow({
        where: { id: unknownFailure.id },
      })
    ).state,
    "FAILED",
  );
  assert.equal(
    await db.audit.count({
      where: {
        action: "DISTRIBUTION_RECONCILED",
        resourceId: { in: [successItem.id, failureItem.id] },
      },
    }),
    2,
  );
});

test("Distribution stop records：不可继续出售状态绑定发布代际且恢复不自动重发", async () => {
  async function published(itemId, ch = channel) {
    const packageRow = await pack(itemId, ch);
    const attempt = await ok("/distribution/plan", "POST", {
      packageId: packageRow.id,
    });
    await ok(`/distribution/attempts/${attempt.id}/manual-result`, "POST", {
      state: "SUCCEEDED",
      evidence: {
        method: "TM_SEARCH",
        note: "合成渠道内已按永久 TM 核对资料完成。",
      },
    });
    return db.distributionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
  }
  async function stopFor(state, ownership = "OWN") {
    const i = await ready({ ownership });
    if (ownership === "SUPPLIER")
      await ok("/supply/offers", "POST", {
        itemId: i.id,
        supplierId: supplier.id,
        amount: 150000,
        currency: "CNY",
        validUntil: future(),
        canReserve: true,
      });
    const source = await published(i.id);
    if (state === "RESERVED")
      await ok(`/items/${i.id}/reserve`, "POST", {
        customerRef: "停售覆盖合成预留",
        minutes: 30,
      });
    else if (state === "SOLD") await sold(i.id);
    else
      await ok(`/items/${i.id}/state`, "POST", {
        state,
        reason: `合成停售覆盖：${state}`,
      });
    const stops = await db.distributionAttempt.findMany({
      where: { sourceAttemptId: source.id, action: "DELIST" },
    });
    assert.equal(stops.length, 1, state);
    assert.equal(stops[0].state, "PENDING", state);
    assert.equal(stops[0].dedupeKey, `delist:${source.id}`, state);
    return { item: i, source, stop: stops[0] };
  }

  for (const state of [
    "RESERVED",
    "PAUSED",
    "SOLD",
    "GIFTED",
    "SELF_USE",
    "QUARANTINED",
  ])
    await stopFor(state);
  await stopFor("SUPPLIER_SOLD", "SUPPLIER");

  const secondChannel = await ok("/channels", "POST", {
    name: "停售覆盖第二渠道 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
    defaultCurrency: "CNY",
    distributionMode: "MANUAL",
  });
  const multiChannelItem = await ready();
  const firstChannelSource = await published(multiChannelItem.id);
  const secondChannelSource = await published(multiChannelItem.id, secondChannel);
  await ok(`/items/${multiChannelItem.id}/state`, "POST", {
    state: "PAUSED",
    reason: "合成双渠道同时停售。",
  });
  const multiChannelStops = await db.distributionAttempt.findMany({
    where: {
      action: "DELIST",
      sourceAttemptId: { in: [firstChannelSource.id, secondChannelSource.id] },
    },
    select: { sourceAttemptId: true, channelId: true },
  });
  assert.deepEqual(
    multiChannelStops
      .map((row) => `${row.channelId}:${row.sourceAttemptId}`)
      .sort(),
    [
      `${channel.id}:${firstChannelSource.id}`,
      `${secondChannel.id}:${secondChannelSource.id}`,
    ].sort(),
  );

  // A historical stop remains a historical fact. The forward relation does
  // not rewrite it or create a duplicate command for the same older channel.
  const legacyItem = await ready();
  const legacySource = await published(legacyItem.id);
  const legacyStop = await db.distributionAttempt.create({
    data: {
      itemId: legacyItem.id,
      channelId: channel.id,
      action: "DELIST",
      state: "PENDING",
      dedupeKey: `legacy-delist:${legacySource.id}`,
      createdBy: admin.id,
    },
  });
  await ok(`/items/${legacyItem.id}/state`, "POST", {
    state: "PAUSED",
    reason: "合成历史停售兼容核对。",
  });
  assert.equal(
    await db.distributionAttempt.count({
      where: { action: "DELIST", sourceAttemptId: legacySource.id },
    }),
    0,
  );
  assert.equal(
    (
      await db.distributionAttempt.findUniqueOrThrow({
        where: { id: legacyStop.id },
      })
    ).sourceAttemptId,
    null,
  );

  const first = await stopFor("PAUSED");
  await ok(`/distribution/attempts/${first.stop.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: {
      method: "TM_SEARCH",
      note: "合成渠道内已确认停售。",
    },
  });
  const beforeReopen = await db.distributionAttempt.count({
    where: { itemId: first.item.id, action: { in: ["PUBLISH", "UPDATE"] } },
  });
  await ok(`/items/${first.item.id}/state`, "POST", {
    state: "AVAILABLE",
    reason: "合成复检后重新可售；不能自动重新发布。",
  });
  assert.equal(
    await db.distributionAttempt.count({
      where: { itemId: first.item.id, action: { in: ["PUBLISH", "UPDATE"] } },
    }),
    beforeReopen,
  );

  const nextPackage = await pack(first.item.id);
  const next = await ok("/distribution/plan", "POST", {
    packageId: nextPackage.id,
  });
  assert.equal(next.action, "PUBLISH");
  await ok(`/distribution/attempts/${next.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: {
      method: "TM_SEARCH",
      note: "合成渠道内已确认重新交付。",
    },
  });
  await ok(`/items/${first.item.id}/state`, "POST", {
    state: "PAUSED",
    reason: "再次暂停以核对新发布代际。",
  });
  const nextStop = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${next.id}` },
  });
  assert.equal(nextStop.sourceAttemptId, next.id);
  assert.notEqual(nextStop.id, first.stop.id);
});

test("Distribution Foundation：人工无ID结果和 Sale/Inquiry 渠道账号快照均不伪造历史", async () => {
  const i = await ready(), p = await pack(i.id);
  const attempt = await ok("/distribution/plan", "POST", { packageId: p.id });
  const manual = await ok(`/distribution/attempts/${attempt.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    remoteId: "",
    remoteUrl: "https://example.invalid/manual-check",
    evidence: { method: "MANUAL_CONFIRMATION", note: "操作者已发布，可通过标题中的永久TM复查。" },
  });
  assert.equal(manual.state, "SUCCEEDED");
  assert.equal(await db.listing.count({ where: { itemId: i.id, channelId: channel.id } }), 0);
  const inquiry = await ok("/inquiries", "POST", {
    itemId: i.id,
    channel: "不可信客户端名称",
    channelId: channel.id,
    customerRef: "合成渠道客户",
    notes: "合成询盘",
  });
  const storedInquiry = await db.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
  assert.equal(storedInquiry.channelId, channel.id);
  assert.equal(storedInquiry.channel, channel.name);
  const saleItem = await ready();
  const sale = await sold(saleItem.id, { channel: "不可信客户端名称", channelId: channel.id });
  const storedSale = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
  assert.equal(storedSale.channelId, channel.id);
  assert.equal(storedSale.channel, channel.name);
});

test("Real Operations：ChannelPrice 解析冻结到使用包，默认价不覆盖渠道价", async () => {
  const overseas = await ok("/channels", "POST", {
    name: "渠道价海外站 " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    locale: "en",
    titleLimit: 120,
    defaultCurrency: "USD",
    distributionMode: "MANUAL",
  });
  const i = await ready({ currentPrice: 200000, currency: "CNY" });
  const before = await ok(`/items/${i.id}/readiness?channelId=${overseas.id}`);
  assert.equal(before.ready, false);
  assert.ok(before.missing.some((row) => row.code === "price_currency"));
  const bulkBefore = await ok("/distribution/readiness", "POST", {
    channelId: overseas.id,
    itemIds: [i.id],
  });
  assert.equal(bulkBefore.rows[0].ready, false);
  const set = await ok(`/items/${i.id}/channel-prices/${overseas.id}`, "POST", {
    amount: 138000,
    currency: "USD",
  });
  assert.deepEqual(set.price, {
    amount: 138000,
    currency: "USD",
    source: "CHANNEL",
    version: 1,
  });
  const after = await ok(`/items/${i.id}/readiness?channelId=${overseas.id}`);
  assert.equal(after.ready, true);
  assert.equal(after.price.currency, "USD");
  const preview = await ok(
    `/items/${i.id}/package-preview?channelId=${overseas.id}`,
  );
  assert.equal(preview.price, 138000);
  assert.equal(preview.currency, "USD");
  const approved = await item(i.id);
  const draft = await ok(`/items/${i.id}/publishing-draft`, "POST", {
    channelId: overseas.id,
    purpose: "TRADE",
    version: 0,
    title: "合成渠道草稿",
    body: approved.facts.descriptionEn,
    assetIds: [i.asset],
    basisRevisionId: approved.approvedId,
    basisPrice: 138000,
    basisCurrency: "USD",
  });
  const p = await pack(i.id, overseas);
  const stored = await ok(`/packages/${p.id}`);
  assert.deepEqual(stored.snapshot.priceBasis, {
    source: "CHANNEL",
    version: 1,
  });
  const current = await item(i.id);
  await ok(`/items/${i.id}`, "PATCH", {
    version: current.version,
    currentPrice: 210000,
    currency: "CNY",
  });
  assert.equal((await api(`/packages/${p.id}/usable`)).status, 200);
  await ok(`/items/${i.id}/channel-prices/${overseas.id}`, "POST", {
    amount: 128000,
    currency: "USD",
  });
  assert.equal((await api(`/packages/${p.id}/usable`)).status, 409);
  const currentPack = await pack(i.id, overseas);
  await ok(`/items/${i.id}/channel-prices/${overseas.id}`, "POST", {
    amount: null,
  });
  assert.equal((await api(`/packages/${currentPack.id}/usable`)).status, 409);
  const restored = await ok(
    `/items/${i.id}/channel-prices/${overseas.id}`,
    "POST",
    { amount: 128000, currency: "USD" },
  );
  assert.equal(restored.price.version, 4);
  assert.equal((await api(`/packages/${currentPack.id}/usable`)).status, 409);
  const staleDraft = await api(`/items/${i.id}/packages`, "POST", {
    channelId: overseas.id,
    purpose: "TRADE",
    confirmed: true,
    draftId: draft.id,
    draftVersion: draft.version,
  });
  assert.equal(staleDraft.status, 409);
  assert.equal(staleDraft.data.error.code, "DRAFT_STALE");
  const fallback = await ready();
  const fallbackPack = await pack(fallback.id);
  assert.deepEqual(
    (await ok(`/packages/${fallbackPack.id}`)).snapshot.priceBasis,
    {
      source: "ITEM",
      version: null,
    },
  );
});

test("渠道账号币种约束、渠道价和询盘默认值不混用商品默认币种", async () => {
  const badAnQi = await api("/channels", "POST", {
    name: "拒绝错误独立站币种 " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    defaultCurrency: "CNY",
  });
  assert.equal(badAnQi.status, 400);
  assert.equal(badAnQi.data.error.code, "CHANNEL_CURRENCY_REQUIRED");
  const anqicms = await ok("/channels", "POST", {
    name: "默认美元独立站 " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    locale: "en",
  });
  assert.equal(anqicms.defaultCurrency, "USD");
  const xianyu = await ok("/channels", "POST", {
    name: "默认人民币闲鱼 " + randomUUID().slice(0, 8),
    platform: "XIANYU",
  });
  assert.equal(xianyu.defaultCurrency, "CNY");
  const vc = await ok("/channels", "POST", {
    name: "欧元 VC 账号 " + randomUUID().slice(0, 8),
    platform: "VC",
    locale: "en",
    defaultCurrency: "EUR",
  });
  assert.equal(vc.defaultCurrency, "EUR");
  const badUpdate = await api(`/channels/${anqicms.id}`, "POST", {
    version: anqicms.version,
    name: anqicms.name,
    locale: anqicms.locale,
    titleLimit: anqicms.titleLimit,
    active: true,
    defaultCurrency: "CNY",
  });
  assert.equal(badUpdate.status, 400);
  assert.equal(badUpdate.data.error.code, "CHANNEL_CURRENCY_REQUIRED");

  const itemCny = await ready({ currentPrice: 200000, currency: "CNY" });
  const wrongAnQiPrice = await api(
    `/items/${itemCny.id}/channel-prices/${anqicms.id}`,
    "POST",
    { amount: 200000, currency: "CNY" },
  );
  assert.equal(wrongAnQiPrice.status, 400);
  assert.equal(
    wrongAnQiPrice.data.error.code,
    "CHANNEL_PRICE_CURRENCY_REQUIRED",
  );
  await ok(`/items/${itemCny.id}/channel-prices/${anqicms.id}`, "POST", {
    amount: 138000,
    currency: "USD",
  });
  const defaultInquiry = await ok("/inquiries", "POST", {
    itemId: itemCny.id,
    channelId: anqicms.id,
    customerRef: "渠道价默认询盘",
  });
  const storedDefaultInquiry = await db.inquiry.findUniqueOrThrow({
    where: { id: defaultInquiry.id },
  });
  assert.equal(storedDefaultInquiry.quote, 138000);
  assert.equal(storedDefaultInquiry.currency, "USD");

  const vcBefore = await ok(
    `/items/${itemCny.id}/readiness?channelId=${vc.id}`,
  );
  assert.ok(vcBefore.missing.some((row) => row.code === "price_currency"));
  const wrongVcPrice = await api(
    `/items/${itemCny.id}/channel-prices/${vc.id}`,
    "POST",
    { amount: 138000, currency: "USD" },
  );
  assert.equal(wrongVcPrice.status, 400);
  await ok(`/items/${itemCny.id}/channel-prices/${vc.id}`, "POST", {
    amount: 126000,
    currency: "EUR",
  });
  const vcInquiry = await ok("/inquiries", "POST", {
    itemId: itemCny.id,
    channelId: vc.id,
    customerRef: "欧元渠道价默认询盘",
  });
  const storedVcInquiry = await db.inquiry.findUniqueOrThrow({
    where: { id: vcInquiry.id },
  });
  assert.equal(storedVcInquiry.quote, 126000);
  assert.equal(storedVcInquiry.currency, "EUR");

  const noFxItem = await ready({ currentPrice: 200000, currency: "CNY" });
  const noFxInquiry = await ok("/inquiries", "POST", {
    itemId: noFxItem.id,
    channelId: vc.id,
    customerRef: "没有汇率的欧元询盘",
  });
  const storedNoFxInquiry = await db.inquiry.findUniqueOrThrow({
    where: { id: noFxInquiry.id },
  });
  assert.equal(storedNoFxInquiry.quote, null);
  assert.equal(storedNoFxInquiry.currency, "EUR");
});

test("成交币种保留询盘和渠道事实，外币不自动写人民币成本", async () => {
  const anqicms = await ok("/channels", "POST", {
    name: "成交美元独立站 " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    locale: "en",
  });
  const xianyu = await ok("/channels", "POST", {
    name: "成交人民币闲鱼 " + randomUUID().slice(0, 8),
    platform: "XIANYU",
  });

  const usdInquiryItem = await ready({ currency: "CNY" });
  await activeCnyCost(usdInquiryItem.id, 12345);
  const usdInquiry = await ok("/inquiries", "POST", {
    itemId: usdInquiryItem.id,
    channelId: anqicms.id,
    customerRef: "美元询盘客户",
  });
  assert.equal(
    (await db.inquiry.findUniqueOrThrow({ where: { id: usdInquiry.id } }))
      .currency,
    "USD",
  );
  const usdInquirySale = await ok(
    `/inquiries/${usdInquiry.id}/convert`,
    "POST",
    { version: 1, note: "隔离美元询盘确认成交" },
  );
  const storedUsdInquirySale = await db.sale.findUniqueOrThrow({
    where: { id: usdInquirySale.id },
  });
  assert.equal(storedUsdInquirySale.inquiryId, usdInquiry.id);
  assert.equal(storedUsdInquirySale.currency, "USD");
  assert.equal(storedUsdInquirySale.cost, null);
  const usdInquiryAudit = await db.audit.findFirstOrThrow({
    where: { action: "SALE_RECORDED", resourceId: usdInquiryItem.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(usdInquiryAudit.detail.currency, "USD");

  const cnyInquiryItem = await ready({ currency: "CNY" });
  await activeCnyCost(cnyInquiryItem.id, 23456);
  const cnyInquiry = await ok("/inquiries", "POST", {
    itemId: cnyInquiryItem.id,
    channel: "线下人民币成交",
    customerRef: "人民币询盘客户",
    currency: "CNY",
  });
  await ok(`/inquiries/${cnyInquiry.id}/status`, "POST", {
    version: 1,
    state: "FOLLOWUP",
    notes: "约定下次确认",
    nextFollowUpAt: future(),
  });
  const cnyInquirySale = await ok(
    `/inquiries/${cnyInquiry.id}/convert`,
    "POST",
    { version: 2, note: "隔离人民币询盘确认成交" },
  );
  const [storedCnyInquiry, cnySale] = await Promise.all([
    db.inquiry.findUniqueOrThrow({ where: { id: cnyInquiry.id } }),
    db.sale.findUniqueOrThrow({ where: { id: cnyInquirySale.id } }),
  ]);
  assert.equal(storedCnyInquiry.nextFollowUpAt, null);
  assert.equal(cnySale.currency, "CNY");
  assert.equal(cnySale.cost, 23456);

  const directUsdItem = await ready({ currency: "CNY" });
  await activeCnyCost(directUsdItem.id, 34567);
  const directUsd = await sold(directUsdItem.id, {
    channelId: anqicms.id,
    customerRef: "独立站直接成交",
  });
  const directUsdSale = await db.sale.findUniqueOrThrow({
    where: { id: directUsd.id },
  });
  assert.equal(directUsdSale.currency, "USD");
  assert.equal(directUsdSale.cost, null);
  const directUsdAudit = await db.audit.findFirstOrThrow({
    where: { action: "SALE_RECORDED", resourceId: directUsdItem.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(directUsdAudit.detail.currency, "USD");

  const directCnyItem = await ready({ currency: "CNY" });
  await activeCnyCost(directCnyItem.id, 45678);
  const directCny = await sold(directCnyItem.id, {
    channelId: xianyu.id,
    customerRef: "闲鱼直接成交",
  });
  const directCnySale = await db.sale.findUniqueOrThrow({
    where: { id: directCny.id },
  });
  assert.equal(directCnySale.currency, "CNY");
  assert.equal(directCnySale.cost, 45678);

  const directUnconfiguredItem = await ready({ currency: "USD" });
  const directUnconfigured = await sold(directUnconfiguredItem.id, {
    channel: "线下美元成交",
  });
  const directUnconfiguredSale = await db.sale.findUniqueOrThrow({
    where: { id: directUnconfigured.id },
  });
  assert.equal(directUnconfiguredSale.currency, "USD");
  assert.equal(directUnconfiguredSale.cost, null);
});

test("Real Operations：Inquiry 转成交原子停售并为无 Listing 的已发布渠道计划下架", async () => {
  const i = await ready();
  const p = await pack(i.id);
  const publish = await ok("/distribution/plan", "POST", { packageId: p.id });
  await ok(`/distribution/attempts/${publish.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    remoteId: "",
    remoteUrl: "",
    evidence: {
      method: "TM_SEARCH",
      note: "合成账号内可按永久TM找到发布商品。",
    },
  });
  assert.equal(await db.listing.count({ where: { itemId: i.id } }), 0);
  const inquiry = await ok("/inquiries", "POST", {
    itemId: i.id,
    channel: "客户端不得覆盖的名称",
    channelId: channel.id,
    customerRef: "成交客户标记",
    notes: "已确认成交的合成询盘",
  });
  assert.equal(
    (
      await api(`/inquiries/${inquiry.id}/status`, "POST", {
        version: 1,
        state: "WON",
        notes: "普通状态接口不得伪造成交。",
      })
    ).status,
    400,
  );
  const converted = await ok(`/inquiries/${inquiry.id}/convert`, "POST", {
    version: 1,
    externalKey: "synthetic-convert-" + randomUUID(),
    note: "合成确认成交；金额稍后按财务补录。",
  });
  const [sale, storedInquiry, soldItem] = await Promise.all([
    db.sale.findUniqueOrThrow({ where: { id: converted.id } }),
    db.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } }),
    item(i.id),
  ]);
  assert.equal(sale.inquiryId, inquiry.id);
  assert.equal(sale.channelId, channel.id);
  assert.equal(sale.channel, channel.name);
  assert.equal(storedInquiry.state, "WON");
  assert.equal(soldItem.status, "SOLD");
  const ordinaryEdit = await api(`/inquiries/${inquiry.id}/status`, "POST", {
    version: 2,
    state: "LOST",
    notes: "不能把已转化成交改回普通状态",
  });
  assert.equal(ordinaryEdit.status, 409);
  assert.equal(ordinaryEdit.data.error.code, "INQUIRY_CONVERTED_IMMUTABLE");
  const delist = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${publish.id}` },
  });
  assert.equal(delist.action, "DELIST");
  assert.equal(delist.state, "PENDING");
  assert.equal(delist.sourceAttemptId, publish.id);
  assert.equal(
    (await api(`/inquiries/${inquiry.id}/convert`, "POST", { version: 2 }))
      .status,
    409,
  );
  const session = await distributionSession(channel.id, "成交下架合成会话");
  await distributionAgentOk(
    `/distribution-agent/attempts/${delist.id}/claim`,
    session.token,
    "POST",
  );
  const payload = await distributionAgentOk(
    `/distribution-agent/attempts/${delist.id}/payload`,
    session.token,
  );
  assert.equal(payload.action, "DELIST");
  assert.match(payload.product.locator, /^标题中的 TM\d+$/);
  await distributionAgentOk(
    `/distribution-agent/attempts/${delist.id}/result`,
    session.token,
    "POST",
    {
      state: "SUCCEEDED",
      remoteId: "",
      remoteUrl: "",
      evidence: { method: "TM_SEARCH", note: "已按永久TM定位并下架合成商品。" },
    },
  );
  assert.equal(
    (
      await db.distributionAttempt.findUniqueOrThrow({
        where: { id: delist.id },
      })
    ).state,
    "SUCCEEDED",
  );

  const reserved = await ready();
  await ok(`/items/${reserved.id}/reserve`, "POST", {
    customerRef: "另一位预留客户",
    minutes: 20,
  });
  const blockedInquiry = await ok("/inquiries", "POST", {
    itemId: reserved.id,
    channel: "线下合成",
    customerRef: "不匹配的询盘客户",
  });
  const blocked = await api(`/inquiries/${blockedInquiry.id}/convert`, "POST", {
    version: 1,
    note: "不能越过其他客户的预留",
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error.code, "RESERVATION_CONFLICT");
  assert.equal(
    await db.sale.count({ where: { inquiryId: blockedInquiry.id } }),
    0,
  );
});

test("Real Operations：售出与迟到发布成功交错时仍生成去重下架执行", async () => {
  const i = await ready();
  const p = await pack(i.id);
  const publish = await ok("/distribution/plan", "POST", { packageId: p.id });
  const session = await distributionSession(channel.id, "迟到发布成功合成会话");
  await distributionAgentOk(
    `/distribution-agent/attempts/${publish.id}/claim`,
    session.token,
    "POST",
  );
  await sold(i.id);
  const dedupeKey = `delist:${publish.id}`;
  assert.equal(
    await db.distributionAttempt.count({ where: { dedupeKey } }),
    0,
  );
  const completed = await distributionAgentOk(
    `/distribution-agent/attempts/${publish.id}/result`,
    session.token,
    "POST",
    {
      state: "SUCCEEDED",
      remoteId: "",
      remoteUrl: "",
      evidence: {
        method: "TM_SEARCH",
        note: "售出后才收到成功回执，仍可按永久TM核对发布结果。",
      },
    },
  );
  assert.equal(completed.delistAttemptIds.length, 1);
  const delist = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey },
  });
  assert.equal(delist.action, "DELIST");
  assert.equal(delist.state, "PENDING");
  assert.equal(delist.sourceAttemptId, publish.id);
});

test("Real Operations：批量批准预检保留逐件版本与证据阻断", async () => {
  const readyItem = await sparse({
    facts: {
      authentication: { status: "PASSED", evidence: "合成批准依据" },
    },
  });
  const blockedItem = await sparse({
    facts: {
      authentication: { status: "PASSED", evidence: "" },
    },
  });
  const preflight = await ok("/items/approvals/readiness", "POST", {
    items: [
      { id: readyItem.id, version: 1 },
      { id: blockedItem.id, version: 1 },
    ],
  });
  assert.equal(preflight.ready, 1);
  assert.equal(preflight.blocked, 1);
  assert.ok(
    preflight.rows
      .find((row) => row.id === blockedItem.id)
      .missing.some((row) => row.code === "authentication_evidence"),
  );
  await ok(`/items/${readyItem.id}/approve`, "POST", { version: 1 });
  assert.equal((await item(readyItem.id)).approvedValid, true);
});

test("Real Operations：工作队列优先已售下架、未知分发和客户跟进", async () => {
  const distributionItem = await ready();
  const p = await pack(distributionItem.id);
  const attempt = await ok("/distribution/plan", "POST", { packageId: p.id });
  await ok(`/distribution/attempts/${attempt.id}/manual-result`, "POST", {
    state: "UNKNOWN",
    errorCode: "SYNTHETIC_UNKNOWN",
    errorMessage: "合成结果未知，必须用永久TM复核。",
  });
  const inquiryItem = await sparse();
  const inquiry = await ok("/inquiries", "POST", {
    itemId: inquiryItem.id,
    channel: "合成客户渠道",
    customerRef: "需优先跟进的客户",
  });
  const saleItem = await sparse();
  const sale = await sold(saleItem.id);
  const delistItem = await ready();
  const delistPack = await pack(delistItem.id);
  const published = await ok("/distribution/plan", "POST", {
    packageId: delistPack.id,
  });
  await ok(`/distribution/attempts/${published.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: { method: "TM_SEARCH", note: "合成发布后可按 TM 核对。" },
  });
  await sold(delistItem.id);
  const pendingDelist = await db.distributionAttempt.findUniqueOrThrow({
    where: {
      dedupeKey: `delist:${published.id}`,
    },
  });
  assert.equal(pendingDelist.sourceAttemptId, published.id);
  const queue = await ok("/work-queue");
  // rc.5 puts every unapproved business TM in the shared queue.  A lower
  // priority financial follow-up can legitimately fall beyond the first page,
  // so verify its scoped projection instead of relying on the old small queue.
  const financeQueue = await ok("/work-queue?scope=SALE_FINANCE");
  const unknown = queue.rows.find(
    (row) => row.id === `distribution:${attempt.id}`,
  );
  const followup = queue.rows.find((row) => row.id === `inquiry:${inquiry.id}`);
  const finance = financeQueue.rows.find((row) => row.id === `sale:${sale.id}`);
  const delist = queue.rows.find(
    (row) => row.id === `distribution:${pendingDelist.id}`,
  );
  assert.equal(delist.priority, 100);
  assert.equal(unknown.priority, 95);
  assert.equal(
    unknown.href,
    `#/distribution?attemptId=${attempt.id}&from=tasks`,
  );
  assert.equal(followup.priority, 85);
  assert.equal(finance.priority, 30);
  assert.ok(queue.summary.distribution >= 1);
});

test("Distribution 经营投影：动态区分资料、交付、发布、更新、停售和异常并先筛选后分页", async () => {
  const prefix = "OP-PROJECTION-" + randomUUID().slice(0, 8);
  const named = (state) => `${prefix} ${state}`;
  const unpublished = await ready({ title: named("READY") });
  const blocked = await sparse({ title: named("BLOCKED") });
  for (const row of [unpublished, blocked])
    await ok(`/items/${row.id}/distribution-targets/${channel.id}`, "POST", {
      active: true,
      reason: "经营投影只展示已明确的交易经营目标",
      duplicatePlatformConfirmed: false,
    });

  const pendingItem = await ready({ title: named("PENDING") });
  const pending = await ok("/distribution/plan", "POST", {
    packageId: (await pack(pendingItem.id)).id,
  });

  const handedOffItem = await ready({ title: named("HANDED_OFF") });
  const handedOff = await ok("/distribution/plan", "POST", {
    packageId: (await pack(handedOffItem.id)).id,
  });
  const handoffSession = await distributionSession(
    channel.id,
    "经营投影已交付合成会话",
  );
  await distributionHandoffOk(
    `/handoffs/${handedOff.id}/package`,
    handoffSession.token,
    "POST",
  );

  const publishedItem = await ready({ title: named("PUBLISHED") });
  const published = await ok("/distribution/plan", "POST", {
    packageId: (await pack(publishedItem.id)).id,
  });
  await ok(`/distribution/attempts/${published.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    remoteId: "projection-published-" + randomUUID(),
    remoteUrl: "https://example.invalid/projection-published",
    evidence: { method: "PLATFORM_RECEIPT", note: "合成发布回执。" },
  });

  const updateItem = await ready({ title: named("NEEDS_UPDATE") });
  const updatePublished = await ok("/distribution/plan", "POST", {
    packageId: (await pack(updateItem.id)).id,
  });
  await ok(`/distribution/attempts/${updatePublished.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    remoteId: "projection-update-" + randomUUID(),
    remoteUrl: "",
    evidence: { method: "TM_SEARCH", note: "合成 TM 核对已发布。" },
  });
  const changedDraft = await saveChannelDraft(updateItem.id, channel, {
    title: named("更新后的标题"),
    body: "合成更新文案；品相仍按当前冻结事实披露。",
  });
  await ok(`/items/${updateItem.id}/packages`, "POST", {
    channelId: channel.id,
    purpose: "TRADE",
    confirmed: true,
    draftId: changedDraft.id,
    draftVersion: changedDraft.version,
  });

  const stopItem = await ready({ title: named("NEEDS_STOP") });
  const stopPublished = await ok("/distribution/plan", "POST", {
    packageId: (await pack(stopItem.id)).id,
  });
  await ok(`/distribution/attempts/${stopPublished.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    remoteId: "projection-stop-" + randomUUID(),
    remoteUrl: "",
    evidence: { method: "TM_SEARCH", note: "合成 TM 核对已发布。" },
  });
  await sold(stopItem.id);

  const attentionItem = await ready({ title: named("ATTENTION") });
  const attention = await ok("/distribution/plan", "POST", {
    packageId: (await pack(attentionItem.id)).id,
  });
  await ok(`/distribution/attempts/${attention.id}/manual-result`, "POST", {
    state: "UNKNOWN",
    remoteId: "",
    remoteUrl: "",
    errorCode: "SYNTHETIC_UNKNOWN",
    errorMessage: "合成回执没有确认结果。",
  });

  const query = new URLSearchParams({
    channelId: channel.id,
    q: prefix,
    size: "100",
  });
  const projection = await ok("/distribution/operations?" + query);
  assert.equal(projection.total, 8);
  const byTitle = new Map(projection.rows.map((row) => [row.item.title, row]));
  assert.equal(byTitle.get(named("READY")).state, "READY");
  assert.equal(byTitle.get(named("BLOCKED")).state, "BLOCKED");
  assert.equal(byTitle.get(named("PENDING")).state, "PENDING");
  assert.equal(byTitle.get(named("HANDED_OFF")).state, "HANDED_OFF");
  assert.equal(byTitle.get(named("PUBLISHED")).state, "PUBLISHED");
  assert.equal(byTitle.get(named("NEEDS_UPDATE")).state, "NEEDS_UPDATE");
  assert.equal(byTitle.get(named("NEEDS_STOP")).state, "NEEDS_STOP");
  assert.equal(byTitle.get(named("ATTENTION")).state, "ATTENTION");
  assert.equal(byTitle.get(named("PUBLISHED")).published.remoteId.length > 0, true);
  assert.equal(byTitle.get(named("PUBLISHED")).listing.remoteId.length > 0, true);
  assert.equal(byTitle.get(named("PUBLISHED")).listing.desired, "LIVE");
  assert.equal(byTitle.get(named("NEEDS_STOP")).attempt.action, "DELIST");
  assert.equal(byTitle.get(named("ATTENTION")).attempt.state, "UNKNOWN");
  const pinnedAttention = await ok(
    "/distribution/operations?attemptId=" + attention.id,
  );
  assert.equal(pinnedAttention.total, 1);
  assert.equal(pinnedAttention.rows[0].attempt.id, attention.id);
  assert.equal(pinnedAttention.rows[0].item.id, attentionItem.id);

  const firstPage = await ok(
    "/distribution/operations?" +
      new URLSearchParams({ ...Object.fromEntries(query), size: "3", page: "1" }),
  );
  const secondPage = await ok(
    "/distribution/operations?" +
      new URLSearchParams({ ...Object.fromEntries(query), size: "3", page: "2" }),
  );
  assert.equal(firstPage.total, 8);
  assert.equal(firstPage.rows.length, 3);
  assert.equal(secondPage.rows.length, 3);
  assert.equal(
    firstPage.rows.some((row) => row.id === secondPage.rows[0].id),
    false,
  );
  const reachablePage = await ok(
    "/distribution/operations?" +
      new URLSearchParams({ ...Object.fromEntries(query), size: "3", page: "999" }),
  );
  assert.equal(reachablePage.page, 3);
  assert.equal(reachablePage.rows.length, 2);
  const onlyStop = await ok(
    "/distribution/operations?" +
      new URLSearchParams({ ...Object.fromEntries(query), scope: "needs-stop" }),
  );
  assert.equal(onlyStop.total, 1);
  assert.equal(onlyStop.rows[0].item.id, stopItem.id);
  const stopState = await ok(
    "/distribution/operations?" +
      new URLSearchParams({ ...Object.fromEntries(query), state: "NEEDS_STOP" }),
  );
  assert.equal(stopState.total, 1);
  assert.equal(stopState.rows[0].id, onlyStop.rows[0].id);
  assert.equal(
    (await api(
      "/distribution/operations?" +
        new URLSearchParams({ ...Object.fromEntries(query), state: "NEEDS_STOP", scope: "needs-stop" }),
    )).status,
    400,
  );
  const onlyBrand = await ok(
    "/distribution/operations?" +
      new URLSearchParams({
        ...Object.fromEntries(query),
        brand: "TEST BRAND",
      }),
  );
  assert.ok(onlyBrand.rows.every((row) => row.item.brand === "TEST BRAND"));
  const stoppedTm = await item(stopItem.id);
  const onlyTm = await ok(
    "/distribution/operations?" +
      new URLSearchParams({
        channelId: channel.id,
        q: "TM" + String(stoppedTm.serial).padStart(6, "0"),
      }),
  );
  assert.equal(onlyTm.total, 1);
  assert.equal(onlyTm.rows[0].item.id, stopItem.id);

  const dashboard = await ok("/dashboard");
  const allAttention = await ok("/distribution/operations?scope=attention&size=1");
  assert.equal(dashboard.pendingDistribution, allAttention.total);
});

test("AnQiCMS 标准交付合同：受限会话以脱敏本地资料覆盖建页、archive ID 更新与售出保页", async () => {
  const anqicms = await ok("/channels", "POST", {
    name: "AnQiCMS 本地合同 " + randomUUID().slice(0, 8),
    platform: "ANQICMS",
    locale: "en",
    titleLimit: 120,
    defaultCurrency: "USD",
    distributionMode: "API",
    endpointUrl: "https://example.invalid/anqicms-spike",
  });
  const condition = await dictionaryOption("CONDITION", "VERY_GOOD");
  const i = await ready({
    category: "BAG",
    currentPrice: 200000,
    currency: "CNY",
    dictionary: { condition: condition.id },
    facts: {
      mainMaterial: "Leather",
      condition: "Synthetic corner wear is disclosed.",
      measurements: "20 × 12 × 8 cm",
      measurementSource: "Synthetic measurement note",
      descriptionZh: "合成中文说明，瑕疵已披露。",
      descriptionEn: "Local-only fixture. Synthetic corner wear is disclosed.",
      authentication: {
        status: "PASSED",
        evidence: "Synthetic review evidence only",
      },
      attributes: {
        year: "2022",
        collection: "Local contract set",
        styleNumber: "ANQI-SPIKE-01",
      },
    },
  });
  for (let position = 1; position <= 9; position += 1) {
    const asset = await upload(i.id, {
      role: position === 9 ? "DEFECT" : "DETAIL",
    });
    await assetReview(asset.id, { position });
  }
  await ok("/items/" + i.id + "/channel-prices/" + anqicms.id, "POST", {
    amount: 138000,
    currency: "USD",
  });
  const p = await pack(i.id, anqicms);
  const publish = await ok("/distribution/plan", "POST", { packageId: p.id });
  const session = await distributionSession(anqicms.id, "AnQiCMS 本地合同合成会话");
  await distributionAgentOk(
    "/distribution-agent/attempts/" + publish.id + "/claim",
    session.token,
    "POST",
  );
  const create = await distributionAgentOk(
    "/distribution-agent/attempts/" + publish.id + "/anqicms-spike",
    session.token,
  );
  assert.equal(create.payload.protocol, "tome.anqicms.spike/v1");
  assert.equal(create.payload.operation, "LOOKUP_THEN_CREATE");
  assert.equal(create.payload.identity.tm_code, i.code);
  assert.equal(create.payload.fields.price, "1380.00");
  assert.equal(create.payload.fields.currency, "USD");
  assert.equal(create.payload.fields.stock, 1);
  assert.equal(create.payload.fields.images.length, 9);
  assert.equal(create.payload.fields.contentImages.length, 1);
  assert.equal(create.payload.fields.contentImages[0].role, "DEFECT");
  assert.equal(create.payload.fields.custom.styleNumber, "ANQI-SPIKE-01");
  assert.equal(create.payload.fields.custom.condition_grade, "VERY_GOOD");
  assert.equal(
    create.payload.fields.custom.condition_description,
    "Synthetic corner wear is disclosed.",
  );
  assert.equal("condition" in create.payload.fields.custom, false);
  assert.equal("style_number" in create.payload.fields.custom, false);
  assert.ok(create.payload.fields.content.includes("Synthetic corner wear is disclosed."));
  assert.equal(create.payload.page.checkout, false);
  assert.equal(JSON.stringify(create.payload).includes("cost"), false);
  assert.equal(JSON.stringify(create.payload).includes("supplier"), false);
  const archiveId = "archive-" + randomUUID();
  await distributionAgentOk(
    "/distribution-agent/attempts/" + publish.id + "/result",
    session.token,
    "POST",
    {
      state: "SUCCEEDED",
      remoteId: archiveId,
      remoteUrl: "https://example.invalid/anqicms/" + archiveId,
      evidence: { method: "API_RESPONSE", note: "本地脱敏回执返回 archive ID。" },
    },
  );
  const createdListing = await db.listing.findUniqueOrThrow({
    where: { channelId_remoteId: { channelId: anqicms.id, remoteId: archiveId } },
  });
  assert.equal(createdListing.itemId, i.id);
  await ok("/items/" + i.id + "/channel-prices/" + anqicms.id, "POST", {
    amount: 139000,
    currency: "USD",
  });
  const updatePack = await pack(i.id, anqicms);
  const update = await ok("/distribution/plan", "POST", {
    packageId: updatePack.id,
  });
  assert.equal(update.action, "UPDATE");
  await distributionAgentOk(
    "/distribution-agent/attempts/" + update.id + "/claim",
    session.token,
    "POST",
  );
  const updatePayload = await distributionAgentOk(
    "/distribution-agent/attempts/" + update.id + "/anqicms-spike",
    session.token,
  );
  assert.equal(updatePayload.payload.operation, "UPDATE");
  assert.equal(updatePayload.payload.identity.archive_id, archiveId);
  await distributionAgentOk(
    "/distribution-agent/attempts/" + update.id + "/result",
    session.token,
    "POST",
    {
      state: "SUCCEEDED",
      remoteId: archiveId,
      remoteUrl: "https://example.invalid/anqicms/" + archiveId,
      evidence: { method: "API_RESPONSE", note: "本地脱敏更新保留同一 archive ID。" },
    },
  );
  await sold(i.id, { channelId: anqicms.id });
  const delist = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: "delist:" + update.id },
  });
  assert.equal(delist.sourceAttemptId, update.id);
  await distributionAgentOk(
    "/distribution-agent/attempts/" + delist.id + "/claim",
    session.token,
    "POST",
  );
  // The package's former image authorization can expire after publication.
  // A safety stock=0 operation must not reopen that historical package.
  await db.asset.update({
    where: { id: i.asset },
    data: { validUntil: new Date(Date.now() - 1000) },
  });
  const soldPayload = await distributionAgentOk(
    "/distribution-agent/attempts/" + delist.id + "/anqicms-spike",
    session.token,
  );
  assert.equal(soldPayload.payload.operation, "STOCK_ZERO");
  assert.equal(soldPayload.payload.identity.archive_id, archiveId);
  assert.equal(soldPayload.payload.fields.stock, 0);
  assert.deepEqual(soldPayload.payload.fields, { stock: 0 });
  assert.equal(soldPayload.payload.page.retain, true);
  assert.equal(soldPayload.payload.page.displayState, "SOLD");
  assert.equal(soldPayload.payload.page.checkout, false);
  await distributionAgentOk(
    "/distribution-agent/attempts/" + delist.id + "/result",
    session.token,
    "POST",
    {
      state: "SUCCEEDED",
      remoteId: archiveId,
      remoteUrl: "https://example.invalid/anqicms/" + archiveId,
      evidence: { method: "API_RESPONSE", note: "本地脱敏售出页保留，库存已置零。" },
    },
  );
  assert.equal(
    (
      await db.listing.findUniqueOrThrow({
        where: { channelId_remoteId: { channelId: anqicms.id, remoteId: archiveId } },
      })
    ).desired,
    "OFFLINE",
  );
});

test("Publication Health：无稳定远端ID的成功发布按当前经营事实判定，而非使用包TTL", async () => {
  const healthService = app.get(PublicationHealthService);
  const hasReason = (health, code) =>
    health.reasons.some((reason) => reason.code === code);
  async function publishedWithoutRemoteId(itemId, ch = channel) {
    const packageRow = await pack(itemId, ch);
    const attempt = await ok("/distribution/plan", "POST", {
      packageId: packageRow.id,
    });
    await ok(`/distribution/attempts/${attempt.id}/manual-result`, "POST", {
      state: "SUCCEEDED",
      remoteId: "",
      evidence: {
        method: "TM_SEARCH",
        note: "合成渠道中按永久 TM 确认完成，APP 未返回稳定远端编号。",
      },
    });
    return db.distributionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }
  async function healthOf(source) {
    return db.$transaction((tx) =>
      healthService.evaluatePublicationHealth(
        tx,
        source.itemId,
        source.channelId,
        source.id,
      ),
    );
  }

  const ttlItem = await ready();
  const initialTtlSource = await publishedWithoutRemoteId(ttlItem.id);
  const initialPackage = await db.usePackage.findUniqueOrThrow({
    where: { id: initialTtlSource.packageId },
  });
  // Frozen packages are append-only. A historical record can nevertheless
  // have an elapsed handoff window, so create an isolated synthetic historic
  // package/Attempt rather than mutating the published fact.
  const expiredPackage = await db.usePackage.create({
    data: {
      itemId: initialPackage.itemId,
      channelId: initialPackage.channelId,
      revisionId: initialPackage.revisionId,
      cycle: initialPackage.cycle,
      purpose: initialPackage.purpose,
      snapshot: initialPackage.snapshot,
      createdBy: admin.id,
      validUntil: new Date(1),
    },
  });
  const ttlSource = await db.distributionAttempt.create({
    data: {
      itemId: ttlItem.id,
      channelId: channel.id,
      packageId: expiredPackage.id,
      action: "UPDATE",
      state: "SUCCEEDED",
      dedupeKey: "expired-ttl-health:" + randomUUID(),
      createdBy: admin.id,
      finishedAt: new Date(Date.now() + 1000),
      evidence: {},
    },
  });
  assert.equal(ttlSource.remoteId, "");
  assert.equal(
    await db.listing.count({ where: { itemId: ttlItem.id, channelId: channel.id } }),
    0,
  );
  assert.equal((await healthOf(ttlSource)).state, "CURRENT");
  const ttlOperation = await ok(
    `/distribution/operations?channelId=${channel.id}&attemptId=${ttlSource.id}`,
  );
  assert.equal(ttlOperation.rows[0].state, "PUBLISHED");

  await ok(`/items/${ttlItem.id}/channel-prices/${channel.id}`, "POST", {
    amount: 201000,
    currency: "CNY",
  });
  const repriced = await healthOf(ttlSource);
  assert.equal(repriced.state, "NEEDS_UPDATE");
  assert.ok(hasReason(repriced, "CHANNEL_PRICE_CHANGED"));
  await db.channelPrice.update({
    where: { itemId_channelId: { itemId: ttlItem.id, channelId: channel.id } },
    data: { amount: 0, currency: "USD" },
  });
  const invalidPrice = await healthOf(ttlSource);
  assert.equal(invalidPrice.state, "MUST_STOP");
  assert.ok(hasReason(invalidPrice, "TRADE_PRICE_NON_POSITIVE"));
  assert.ok(hasReason(invalidPrice, "TRADE_PRICE_CURRENCY_INVALID"));
  await db.$transaction((tx) => worker.reconcile(tx, ttlItem.id));
  const ttlStop = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${ttlSource.id}` },
  });
  assert.equal(ttlStop.sourceAttemptId, ttlSource.id);
  assert.equal(ttlStop.state, "PENDING");

  const revisedItem = await ready();
  const revisedSource = await publishedWithoutRemoteId(revisedItem.id);
  let revised = await item(revisedItem.id);
  await ok(`/items/${revisedItem.id}`, "PATCH", {
    version: revised.version,
    facts: { descriptionZh: "合成资料批准后更新的渠道文案。" },
  });
  revised = await item(revisedItem.id);
  await ok(`/items/${revisedItem.id}/approve`, "POST", { version: revised.version });
  const revisedHealth = await healthOf(revisedSource);
  assert.equal(revisedHealth.state, "NEEDS_UPDATE");
  assert.ok(hasReason(revisedHealth, "APPROVED_REVISION_CHANGED"));

  const draftItem = await ready();
  const draftSource = await publishedWithoutRemoteId(draftItem.id);
  const draftBase = await db.item.findUniqueOrThrow({
    where: { id: draftItem.id },
    select: { approvedId: true, currentPrice: true, currency: true, facts: true },
  });
  await ok(`/items/${draftItem.id}/publishing-draft`, "POST", {
    channelId: channel.id,
    purpose: "TRADE",
    version: 0,
    title: "人工改过的合成标题",
    body: draftBase.facts.descriptionZh,
    assetIds: [draftItem.asset],
    basisRevisionId: draftBase.approvedId,
    basisPrice: draftBase.currentPrice,
    basisCurrency: draftBase.currency,
  });
  const draftHealth = await healthOf(draftSource);
  assert.equal(draftHealth.state, "NEEDS_UPDATE");
  assert.ok(hasReason(draftHealth, "CHANNEL_DRAFT_CHANGED"));

  const imageItem = await ready();
  const imageSource = await publishedWithoutRemoteId(imageItem.id);
  const addedImage = await upload(imageItem.id);
  await assetReview(addedImage.id, { position: 1 });
  const imageHealth = await healthOf(imageSource);
  assert.equal(imageHealth.state, "NEEDS_UPDATE");
  assert.ok(hasReason(imageHealth, "PUBLICATION_IMAGES_CHANGED"));

  const authenticationItem = await ready();
  const authenticationSource = await publishedWithoutRemoteId(authenticationItem.id);
  const authenticationCurrent = await db.item.findUniqueOrThrow({
    where: { id: authenticationItem.id },
    select: { facts: true },
  });
  const invalidFacts = structuredClone(authenticationCurrent.facts);
  // Keep the fixture inside the persisted facts contract. UNKNOWN is already
  // an invalid publication authentication state and will not poison the
  // later browser suite, which reads the same isolated database after this
  // integration run.
  invalidFacts.authentication = { status: "UNKNOWN", evidence: "" };
  await db.item.update({
    where: { id: authenticationItem.id },
    data: { facts: invalidFacts },
  });
  const authenticationHealth = await healthOf(authenticationSource);
  assert.equal(authenticationHealth.state, "MUST_STOP");
  assert.ok(hasReason(authenticationHealth, "AUTHENTICATION_INVALID"));

  const invalidApprovalItem = await ready();
  const invalidApprovalSource = await publishedWithoutRemoteId(invalidApprovalItem.id);
  await db.item.update({
    where: { id: invalidApprovalItem.id },
    data: { approvedValid: false },
  });
  const invalidApprovalHealth = await healthOf(invalidApprovalSource);
  assert.equal(invalidApprovalHealth.state, "MUST_STOP");
  assert.ok(hasReason(invalidApprovalHealth, "APPROVAL_INVALID"));

  const assetItem = await ready();
  const assetSource = await publishedWithoutRemoteId(assetItem.id);
  await db.asset.update({
    where: { id: assetItem.asset },
    data: { rights: "REVOKED" },
  });
  const assetHealth = await healthOf(assetSource);
  assert.equal(assetHealth.state, "MUST_STOP");
  assert.ok(hasReason(assetHealth, "PUBLICATION_ASSET_RIGHTS_INVALID"));

  const supplierItem = await ready({ ownership: "SUPPLIER" });
  const offer = await ok("/supply/offers", "POST", {
    itemId: supplierItem.id,
    supplierId: supplier.id,
    amount: 150000,
    currency: "CNY",
    validUntil: future(),
    canReserve: true,
  });
  const supplierSource = await publishedWithoutRemoteId(supplierItem.id);
  await db.offer.update({ where: { id: offer.id }, data: { validUntil: new Date(1) } });
  const supplierHealth = await healthOf(supplierSource);
  assert.equal(supplierHealth.state, "MUST_STOP");
  assert.ok(hasReason(supplierHealth, "SUPPLIER_OFFER_EXPIRED"));

  const targetItem = await ready();
  await ok(`/items/${targetItem.id}/distribution-targets/${channel.id}`, "POST", {
    active: true,
    reason: "合成健康检查经营目标",
    duplicatePlatformConfirmed: false,
  });
  const targetSource = await publishedWithoutRemoteId(targetItem.id);
  await ok(`/items/${targetItem.id}/distribution-targets/${channel.id}`, "POST", {
    active: false,
    reason: "合成健康检查关闭经营目标",
    duplicatePlatformConfirmed: false,
  });
  const targetHealth = await healthOf(targetSource);
  assert.equal(targetHealth.state, "MUST_STOP");
  assert.ok(hasReason(targetHealth, "DISTRIBUTION_TARGET_CLOSED"));
});

test("Publication stop scope：停用渠道只交付未完成停售，回收站不忽略无ID远端暴露", async () => {
  async function publishedWithoutRemoteId(itemId, ch) {
    const packageRow = await pack(itemId, ch);
    const attempt = await ok("/distribution/plan", "POST", {
      packageId: packageRow.id,
    });
    await ok(`/distribution/attempts/${attempt.id}/manual-result`, "POST", {
      state: "SUCCEEDED",
      evidence: {
        method: "TM_SEARCH",
        note: "合成渠道内按永久 TM 确认完成，未取得稳定远端编号。",
      },
    });
    return db.distributionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }

  const stoppedChannel = await ok("/channels", "POST", {
    name: "停用渠道健康检查 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
    defaultCurrency: "CNY",
    distributionMode: "MANUAL",
  });
  const stoppedItem = await ready();
  const stoppedSource = await publishedWithoutRemoteId(stoppedItem.id, stoppedChannel);
  await ok(`/channels/${stoppedChannel.id}`, "POST", {
    version: stoppedChannel.version,
    name: stoppedChannel.name,
    locale: stoppedChannel.locale,
    titleLimit: stoppedChannel.titleLimit,
    active: false,
    businessPurpose: "TRADE",
    defaultCurrency: stoppedChannel.defaultCurrency,
    distributionMode: stoppedChannel.distributionMode,
    endpointUrl: stoppedChannel.endpointUrl,
  });
  const stoppedAttempt = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${stoppedSource.id}` },
  });
  assert.equal(stoppedAttempt.sourceAttemptId, stoppedSource.id);
  const stoppedOperations = await ok(
    `/distribution/operations?channelId=${stoppedChannel.id}&attemptId=${stoppedSource.id}`,
  );
  assert.equal(stoppedOperations.rows[0].state, "NEEDS_STOP");
  const stopSession = await distributionSession(stoppedChannel.id, "仅停售交付会话");
  assert.equal(stopSession.stopOnly, true);
  const handoffs = await distributionHandoffOk("/handoffs", stopSession.token);
  assert.deepEqual(handoffs.map((row) => row.action), ["DELIST"]);
  const stopPackage = await distributionHandoffOk(
    `/handoffs/${stoppedAttempt.id}/package`,
    stopSession.token,
    "POST",
    undefined,
    randomUUID(),
  );
  assert.equal(stopPackage.action, "DELIST");
  assert.equal(stopPackage.package, null);
  await ok(`/distribution/attempts/${stoppedAttempt.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: { method: "TM_SEARCH", note: "合成渠道已确认停售。" },
  });
  const noStopSession = await api("/distribution/sessions", "POST", {
    channelId: stoppedChannel.id,
    label: "没有停售时不能建立会话",
    agentName: "synthetic-stop-only",
    expiresAt: future(),
  });
  assert.equal(noStopSession.status, 409);
  assert.equal(noStopSession.data.error.code, "CHANNEL_STOP_SESSION_UNAVAILABLE");

  const contentChannel = await ok("/channels", "POST", {
    name: "改内容用途渠道 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
    defaultCurrency: "CNY",
    distributionMode: "MANUAL",
  });
  const contentItem = await ready();
  const contentSource = await publishedWithoutRemoteId(contentItem.id, contentChannel);
  await ok(`/channels/${contentChannel.id}`, "POST", {
    version: contentChannel.version,
    name: contentChannel.name,
    locale: contentChannel.locale,
    titleLimit: contentChannel.titleLimit,
    active: true,
    businessPurpose: "CONTENT",
    defaultCurrency: contentChannel.defaultCurrency,
    distributionMode: contentChannel.distributionMode,
    endpointUrl: contentChannel.endpointUrl,
  });
  assert.equal(
    (
      await db.distributionAttempt.findUniqueOrThrow({
        where: { dedupeKey: `delist:${contentSource.id}` },
      })
    ).state,
    "PENDING",
  );

  const pendingItem = await ready();
  const pendingPackage = await pack(pendingItem.id);
  const pending = await ok("/distribution/plan", "POST", {
    packageId: pendingPackage.id,
  });
  const pendingVersion = (await item(pendingItem.id)).version;
  await ok(`/items/${pendingItem.id}/trash`, "POST", {
    version: pendingVersion,
    reason: "合成未交付发布可在本地取消",
    confirmed: true,
  });
  assert.equal(
    (await db.distributionAttempt.findUniqueOrThrow({ where: { id: pending.id } })).state,
    "CANCELLED",
  );

  const onlineItem = await ready();
  const onlineSource = await publishedWithoutRemoteId(onlineItem.id, channel);
  const onlineVersion = (await item(onlineItem.id)).version;
  const onlineTrash = await api(`/items/${onlineItem.id}/trash`, "POST", {
    version: onlineVersion,
    reason: "无稳定远端ID也不能忽略可能在线状态",
    confirmed: true,
  });
  assert.equal(onlineTrash.status, 409);
  assert.equal(onlineTrash.data.error.code, "TRASH_DISTRIBUTION_EXPOSURE");
  await db.asset.update({ where: { id: onlineItem.asset }, data: { rights: "REVOKED" } });
  await db.$transaction((tx) => worker.reconcile(tx, onlineItem.id));
  const onlineStop = await db.distributionAttempt.findUniqueOrThrow({
    where: { dedupeKey: `delist:${onlineSource.id}` },
  });
  await ok(`/distribution/attempts/${onlineStop.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: { method: "TM_SEARCH", note: "合成渠道已确认下架。" },
  });
  await ok(`/items/${onlineItem.id}/trash`, "POST", {
    version: (await item(onlineItem.id)).version,
    reason: "来源关联停售完成后可进入回收站",
    confirmed: true,
  });

  const runningItem = await ready();
  const runningPackage = await pack(runningItem.id);
  const running = await ok("/distribution/plan", "POST", {
    packageId: runningPackage.id,
  });
  const runningSession = await distributionSession(channel.id, "回收站交付中阻断");
  await distributionHandoffOk(
    `/handoffs/${running.id}/package`,
    runningSession.token,
    "POST",
    undefined,
    randomUUID(),
  );
  const runningTrash = await api(`/items/${runningItem.id}/trash`, "POST", {
    version: (await item(runningItem.id)).version,
    reason: "已交付资料仍可能被外部执行",
    confirmed: true,
  });
  assert.equal(runningTrash.status, 409);
  assert.equal(runningTrash.data.error.code, "TRASH_DISTRIBUTION_EXPOSURE");

  const unknownItem = await ready();
  const unknownPackage = await pack(unknownItem.id);
  const unknown = await ok("/distribution/plan", "POST", {
    packageId: unknownPackage.id,
  });
  await ok(`/distribution/attempts/${unknown.id}/manual-result`, "POST", {
    state: "UNKNOWN",
    errorCode: "SYNTHETIC_UNKNOWN",
    errorMessage: "合成外部结果未知，必须先核对。",
  });
  const unknownTrash = await api(`/items/${unknownItem.id}/trash`, "POST", {
    version: (await item(unknownItem.id)).version,
    reason: "结果未知时不能删除可能在线的商品",
    confirmed: true,
  });
  assert.equal(unknownTrash.status, 409);
  assert.equal(unknownTrash.data.error.code, "TRASH_DISTRIBUTION_EXPOSURE");
});


test("Distribution generation guard：关闭经营目标会取消未交付发布，旧停售未核对前不得重新发布", async () => {
  const i = await ready();
  await ok(`/items/${i.id}/distribution-targets/${channel.id}`, "POST", {
    active: true,
    reason: "合成代际保护：开始经营",
    duplicatePlatformConfirmed: false,
  });
  const p = await pack(i.id);
  const pending = await ok("/distribution/plan", "POST", { packageId: p.id });
  const closed = await ok(
    `/items/${i.id}/distribution-targets/${channel.id}`,
    "POST",
    {
      active: false,
      reason: "合成代际保护：暂停经营",
      duplicatePlatformConfirmed: false,
    },
  );
  assert.ok(closed.cancelledAttemptIds.includes(pending.id));
  assert.equal(
    (await db.distributionAttempt.findUniqueOrThrow({ where: { id: pending.id } }))
      .state,
    "CANCELLED",
  );
  const inactivePlan = await api("/distribution/plan", "POST", {
    packageId: p.id,
  });
  assert.equal(inactivePlan.status, 409);
  assert.equal(
    inactivePlan.data.error.code,
    "DISTRIBUTION_TARGET_INACTIVE",
  );

  await ok(`/items/${i.id}/distribution-targets/${channel.id}`, "POST", {
    active: true,
    reason: "合成代际保护：恢复经营",
    duplicatePlatformConfirmed: false,
  });
  const published = await ok("/distribution/plan", "POST", { packageId: p.id });
  assert.notEqual(published.id, pending.id);
  const remoteId = "generation-" + randomUUID();
  await ok(`/distribution/attempts/${published.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    remoteId,
    evidence: {
      method: "MANUAL_CONFIRMATION",
      note: "合成已确认发布，用于验证停售代际屏障。",
    },
  });

  const stopped = await ok(
    `/items/${i.id}/distribution-targets/${channel.id}`,
    "POST",
    {
      active: false,
      reason: "合成代际保护：再次关闭并计划停售",
      duplicatePlatformConfirmed: false,
    },
  );
  assert.equal(stopped.delistAttemptIds.length, 1);
  const delistId = stopped.delistAttemptIds[0];
  assert.equal(
    (
      await db.distributionAttempt.findUniqueOrThrow({
        where: { id: delistId },
      })
    ).sourceAttemptId,
    published.id,
  );

  await ok(`/items/${i.id}/distribution-targets/${channel.id}`, "POST", {
    active: true,
    reason: "合成代际保护：停售确认前重新启用",
    duplicatePlatformConfirmed: false,
  });
  const blocked = await api("/distribution/plan", "POST", { packageId: p.id });
  assert.equal(blocked.status, 409);
  assert.equal(
    blocked.data.error.code,
    "DELIST_RECONCILIATION_REQUIRED",
  );

  await ok(`/distribution/attempts/${delistId}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: {
      method: "TM_SEARCH",
      note: "合成旧代际已明确停售。",
    },
  });
  const afterStop = await ok("/distribution/plan", "POST", { packageId: p.id });
  assert.equal(afterStop.action, "PUBLISH");
  assert.notEqual(afterStop.id, published.id);
});

test("Distribution remote identity guard：UPDATE 不得把同一商品静默变成第二个远端商品", async () => {
  const i = await ready();
  const firstPackage = await pack(i.id);
  const first = await ok("/distribution/plan", "POST", {
    packageId: firstPackage.id,
  });
  const remoteId = "stable-" + randomUUID();
  await ok(`/distribution/attempts/${first.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    remoteId,
    evidence: {
      method: "PLATFORM_RECEIPT",
      note: "合成稳定远端身份。",
    },
  });

  let current = await item(i.id);
  await ok(`/items/${i.id}`, "PATCH", {
    version: current.version,
    facts: { descriptionZh: "合成资料变化，要求对原远端身份执行更新。" },
  });
  current = await item(i.id);
  await ok(`/items/${i.id}/approve`, "POST", { version: current.version });
  const secondPackage = await pack(i.id);
  const update = await ok("/distribution/plan", "POST", {
    packageId: secondPackage.id,
  });
  assert.equal(update.action, "UPDATE");

  const wrongRemoteId = "wrong-" + randomUUID();
  const wrong = await api(
    `/distribution/attempts/${update.id}/manual-result`,
    "POST",
    {
      state: "SUCCEEDED",
      remoteId: wrongRemoteId,
      evidence: {
        method: "PLATFORM_RECEIPT",
        note: "合成错误地返回了另一个远端身份。",
      },
    },
  );
  assert.equal(wrong.status, 409);
  assert.equal(wrong.data.error.code, "UPDATE_REMOTE_ID_CONFLICT");
  assert.equal(
    (await db.distributionAttempt.findUniqueOrThrow({ where: { id: update.id } }))
      .state,
    "PENDING",
  );

  await ok(`/distribution/attempts/${update.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    remoteId,
    evidence: {
      method: "PLATFORM_RECEIPT",
      note: "合成正确更新原稳定远端身份。",
    },
  });
  const live = await db.listing.findMany({
    where: {
      itemId: i.id,
      channelId: channel.id,
      desired: { not: "OFFLINE" },
    },
  });
  assert.equal(live.length, 1);
  assert.equal(live[0].remoteId, remoteId);

  current = await item(i.id);
  await ok(`/items/${i.id}`, "PATCH", {
    version: current.version,
    facts: { descriptionZh: "第二次合成资料变化，验证已知远端ID可自动继承。" },
  });
  current = await item(i.id);
  await ok(`/items/${i.id}/approve`, "POST", { version: current.version });
  const thirdPackage = await pack(i.id);
  const inheritedUpdate = await ok("/distribution/plan", "POST", {
    packageId: thirdPackage.id,
  });
  assert.equal(inheritedUpdate.action, "UPDATE");
  await ok(
    `/distribution/attempts/${inheritedUpdate.id}/manual-result`,
    "POST",
    {
      state: "SUCCEEDED",
      remoteId: "",
      evidence: {
        method: "TM_SEARCH",
        note: "合成更新完成；执行方本次未重复返回已知稳定编号。",
      },
    },
  );
  const inheritedAttempt = await db.distributionAttempt.findUniqueOrThrow({
    where: { id: inheritedUpdate.id },
  });
  assert.equal(inheritedAttempt.remoteId, remoteId);
  const inheritedLive = await db.listing.findMany({
    where: {
      itemId: i.id,
      channelId: channel.id,
      desired: { not: "OFFLINE" },
    },
  });
  assert.equal(inheritedLive.length, 1);
  assert.equal(inheritedLive[0].remoteId, remoteId);
  assert.equal(inheritedLive[0].packageId, thirdPackage.id);
});

test("Distribution target/profile guard：历史在线暴露参与同平台确认，停用空目标不污染投影，OTHER 有标准 Profile", async () => {
  const firstChannel = await ok("/channels", "POST", {
    name: "通用渠道一 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
    defaultCurrency: "CNY",
    distributionMode: "AGENT",
  });
  const secondChannel = await ok("/channels", "POST", {
    name: "通用渠道二 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
    defaultCurrency: "CNY",
    distributionMode: "AGENT",
  });
  const i = await ready();
  const p = await pack(i.id, firstChannel);
  const first = await ok("/distribution/plan", "POST", { packageId: p.id });
  await ok(`/distribution/attempts/${first.id}/manual-result`, "POST", {
    state: "SUCCEEDED",
    evidence: {
      method: "TM_SEARCH",
      note: "合成历史在线暴露，没有 DistributionTarget。",
    },
  });

  const duplicate = await api(
    `/items/${i.id}/distribution-targets/${secondChannel.id}`,
    "POST",
    {
      active: true,
      reason: "合成同平台第二账号",
      duplicatePlatformConfirmed: false,
    },
  );
  assert.equal(duplicate.status, 409);
  assert.equal(
    duplicate.data.error.code,
    "DUPLICATE_PLATFORM_TARGET_CONFIRMATION_REQUIRED",
  );

  const idle = await ready();
  await ok(
    `/items/${idle.id}/distribution-targets/${secondChannel.id}`,
    "POST",
    {
      active: true,
      reason: "合成空目标投影检查",
      duplicatePlatformConfirmed: false,
    },
  );
  const before = await ok(
    `/distribution/operations?channelId=${secondChannel.id}&q=${encodeURIComponent(idle.code)}`,
  );
  assert.ok(before.rows.some((row) => row.item.id === idle.id));
  await ok(`/channels/${secondChannel.id}`, "POST", {
    version: secondChannel.version,
    name: secondChannel.name,
    locale: secondChannel.locale,
    titleLimit: secondChannel.titleLimit,
    active: false,
    businessPurpose: secondChannel.businessPurpose,
    defaultCurrency: secondChannel.defaultCurrency,
    distributionMode: secondChannel.distributionMode,
    endpointUrl: secondChannel.endpointUrl,
  });
  const after = await ok(
    `/distribution/operations?channelId=${secondChannel.id}&q=${encodeURIComponent(idle.code)}`,
  );
  assert.equal(after.rows.some((row) => row.item.id === idle.id), false);

  const session = await distributionSession(firstChannel.id, "通用 Profile 会话");
  const protocol = await distributionAgentOk(
    "/distribution-agent/protocol",
    session.token,
  );
  assert.equal(protocol.profile.id, "GENERIC_TRADE/1.0");
  assert.equal(protocol.profile.platform, "OTHER");
});


test("Distribution legacy edge：无Target的历史 CANCELLED 同包可安全生成新记录，同平台进行中交付也要求确认", async () => {
  const i = await ready();
  const p = await pack(i.id);
  const cancelled = await ok("/distribution/plan", "POST", { packageId: p.id });
  await db.distributionAttempt.update({
    where: { id: cancelled.id },
    data: {
      state: "CANCELLED",
      errorCode: "SYNTHETIC_CANCELLED",
      errorMessage: "合成历史记录取消",
      finishedAt: new Date(),
    },
  });
  const replanned = await ok("/distribution/plan", "POST", { packageId: p.id });
  assert.notEqual(replanned.id, cancelled.id);
  assert.equal(replanned.action, "PUBLISH");
  await db.distributionAttempt.update({
    where: { id: replanned.id },
    data: {
      state: "CANCELLED",
      errorCode: "SYNTHETIC_CANCELLED_AGAIN",
      errorMessage: "合成历史记录再次取消",
      finishedAt: new Date(),
    },
  });
  const replannedAgain = await ok("/distribution/plan", "POST", {
    packageId: p.id,
  });
  assert.notEqual(replannedAgain.id, replanned.id);
  assert.equal(replannedAgain.action, "PUBLISH");

  const first = await ok("/channels", "POST", {
    name: "历史进行中同平台账号一 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
    defaultCurrency: "CNY",
  });
  const second = await ok("/channels", "POST", {
    name: "历史进行中同平台账号二 " + randomUUID().slice(0, 8),
    platform: "OTHER",
    locale: "zh-CN",
    titleLimit: 80,
    defaultCurrency: "CNY",
  });
  const other = await ready();
  const otherPackage = await pack(other.id, first);
  const pending = await ok("/distribution/plan", "POST", {
    packageId: otherPackage.id,
  });
  assert.equal(pending.state, "PENDING");
  const target = await api(
    `/items/${other.id}/distribution-targets/${second.id}`,
    "POST",
    {
      active: true,
      reason: "另一账号也准备经营",
      duplicatePlatformConfirmed: false,
    },
  );
  assert.equal(target.status, 409);
  assert.equal(
    target.data.error.code,
    "DUPLICATE_PLATFORM_TARGET_CONFIRMATION_REQUIRED",
  );
});

test("Distribution legacy stop：没有专用发布 Profile 的停用/内容渠道仍可取得 GENERIC_STOP 合同完成历史停售", async () => {
  const xhs = await ok("/channels", "POST", {
    name: "历史小红书停售 " + randomUUID().slice(0, 8),
    platform: "XHS",
    locale: "zh-CN",
    titleLimit: 80,
  });
  assert.equal(xhs.businessPurpose, "CONTENT");
  const i = await ready();
  const stop = await db.distributionAttempt.create({
    data: {
      itemId: i.id,
      channelId: xhs.id,
      packageId: null,
      action: "DELIST",
      state: "PENDING",
      dedupeKey: "legacy-xhs-stop:" + randomUUID(),
      createdBy: admin.id,
    },
  });
  const session = await distributionSession(xhs.id, "历史内容渠道仅停售会话");
  assert.equal(session.stopOnly, true);
  const protocol = await distributionAgentOk(
    "/distribution-agent/protocol",
    session.token,
  );
  assert.equal(protocol.profile.id, "GENERIC_STOP/1.0");
  const rows = await distributionHandoffOk("/handoffs", session.token);
  assert.deepEqual(rows.map((row) => row.recordId), [stop.id]);
  assert.deepEqual(rows.map((row) => row.action), ["DELIST"]);
});
