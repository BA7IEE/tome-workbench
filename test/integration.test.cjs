/* Real HTTP + PostgreSQL tests. Only tome_test on localhost may be reset. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
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
const { PrismaClient } = require("@prisma/client");
const { createApp } = require("../dist/bootstrap");
const { passwordHash } = require("../dist/auth/auth");
const { WorkerService } = require("../dist/jobs/worker.service");
const { PublishingService } = require("../dist/publishing/publishing.service");
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
test("Preparation requirements are deduplicated across purposes and runs", async () => {
  const i = await sparse();
  for (let n = 0; n < 2; n++)
    await ok(`/items/${i.id}/prepare`, "POST", {
      channelId: channel.id,
      purpose: "TRADE",
    });
  const tasks = await db.task.findMany({ where: { itemId: i.id } });
  assert.equal(new Set(tasks.map((t) => t.dedupeKey)).size, tasks.length);
  assert.ok(tasks.some((t) => t.dedupeKey.endsWith(":images")));
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
test("Sold with incomplete finances stops inventory immediately and queues real manual work", async () => {
  const i = await ready(),
    l = await listed(i.id);
  await sold(i.id);
  assert.equal((await item(i.id)).status, "SOLD");
  let record = await db.listing.findUnique({ where: { id: l.listing } });
  assert.equal(record.desired, "OFFLINE");
  assert.equal(record.observed, "MANUAL_REPORTED_LIVE");
  await sweepAllItems();
  const task = await db.task.findFirst({
    where: { listingId: l.listing, kind: "DELIST" },
  });
  assert.ok(task);
  assert.equal(task.status, "OPEN");
  assert.equal(
    (
      await api(`/tasks/${task.id}`, "POST", {
        status: "DONE",
        assignee: "me",
        note: "fake",
      })
    ).status,
    409,
  );
  await ok(`/listings/${l.listing}/observe`, "POST", {
    state: "OFFLINE",
    note: "人工实际核对的合成回执",
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
test("Withdrawal or expiry of rights blocks packages and creates downstream work", async () => {
  const i = await ready(),
    l = await listed(i.id);
  await assetReview(i.asset, { rights: "REVOKED" });
  await sweepAllItems();
  assert.equal(
    (await db.listing.findUnique({ where: { id: l.listing } })).desired,
    "OFFLINE",
  );
  assert.ok(
    await db.task.findFirst({
      where: { listingId: l.listing, kind: "DELIST" },
    }),
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
  const fresh = new WorkerService(db, app.get(PublishingService));
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
    name: "小红书独立草稿测试",
    platform: "XHS",
    locale: "zh-CN",
    titleLimit: 80,
  });
  await saveChannelDraft(i.id, second, {
    title: "另一种讲法",
    body: "小红书内容独立保存",
  });
  const one = await ok(
      `/items/${i.id}/publishing-space?channelId=${channel.id}`,
    ),
    two = await ok(`/items/${i.id}/publishing-space?channelId=${second.id}`);
  assert.equal(one.draft.body, "只是一段未完成草稿");
  assert.equal(two.draft.body, "小红书内容独立保存");
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
  const live = await ready(),
    l = await listed(live.id);
  assert.equal(
    (await api(`/items/${live.id}/trash`, "POST", await deleteInput(live.id)))
      .data.error.code,
    "TRASH_LISTING_ACTIVE",
  );
  await ok(`/items/${live.id}/state`, "POST", {
    state: "PAUSED",
    reason: "合成下架",
  });
  assert.equal(
    (await api(`/items/${live.id}/trash`, "POST", await deleteInput(live.id)))
      .data.error.code,
    "TRASH_LISTING_ACTIVE",
  );
  await ok(`/listings/${l.listing}/observe`, "POST", {
    state: "OFFLINE",
    note: "合成下架回执",
  });
  await ok(`/items/${live.id}/trash`, "POST", await deleteInput(live.id));
  assert.ok(await db.listing.findUnique({ where: { id: l.listing } }));
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
  const frozen = await pack(i.id, showChannel);
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
async function syntheticImage(name='agent.png'){
  return await sharp({create:{width:72,height:96,channels:3,background:{r:180,g:170,b:190}}}).png().toBuffer();
}
async function setupAgentTrr(label='Agent TRR'){
  const code='A'+randomUUID().replace(/-/g,'').slice(0,7).toUpperCase();
  const source=await ok('/procurement/sources','POST',{code,name:label,kind:'MARKETPLACE',defaultCurrency:'USD',notes:'合成Agent来源'});
  const session=await ok('/ingest/sessions','POST',{procurementSourceId:source.id,label:'合成桌面Agent',ttlMinutes:60});
  const orderInput=trrSample(source.id),order=await machineOk('/agent-ingest/orders',session.token,'POST',orderInput);
  const batch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'history-'+randomUUID(),agentName:'Synthetic Desktop Agent',agentVersion:'1.0',kind:'ORDER_HISTORY',rawManifest:{synthetic:true}});
  const byKey=new Map(order.lines.map(x=>[x.lineKey,x]));
  const candidates=orderInput.lines.map(line=>({
    externalKey:`TRR:${orderInput.externalOrderNo}:${line.lineKey}`,sourceItemKey:line.sourceSku,purchaseLineId:byKey.get(line.lineKey).id,
    titleRaw:line.title,brandRaw:line.brandRaw,categoryRaw:line.categoryRaw,conditionRaw:line.sourceConditionRaw,statusRaw:line.sourceStatusRaw,currency:line.currency,
    sourceLineAmount:line.lineAmount,sourceCurrentPrice:line.sourceCurrentPrice,sourceEstimatedRetail:line.sourceEstimatedRetail,
    sourceFacts:{sizeLabel:line.sizeLabelRaw,color:line.colorRaw,material:line.materialRaw,measurements:line.measurements,descriptionRaw:line.descriptionRaw},rawPayload:{synthetic:true,sku:line.sourceSku},
  }));
  const imported=await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates});
  return {source,session,orderInput,order,batch,candidates,imported};
}
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
  const result=await ok('/ingest/candidates/bulk-confirm','POST',{ids:x.imported.rows.map(r=>r.id),possession:'IN_HAND',status:'AVAILABLE'});
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
  const result=await ok(`/ingest/candidates/${row.id}/confirm`,'POST',{version:row.version,possession:'IN_HAND',status:'AVAILABLE',note:'确认实物并先入库，品牌以后标准化'});
  const itemRow=await item(result.itemId);assert.equal(itemRow.brand,'');assert.equal(itemRow.status,'AVAILABLE');
  const source=await db.source.findUniqueOrThrow({where:{id:itemRow.sourceId}});assert.equal(source.payload.brandRaw,'UNKNOWN ARCHIVE BRAND 2099');
});
test('v1 TRR成本按原价比例分摊经济支付价值并均摊每单¥200，最终人民币成本严格闭合',async()=>{
  const x=await setupAgentTrr('TRR costing source');await ok('/ingest/candidates/bulk-confirm','POST',{ids:x.imported.rows.map(r=>r.id),possession:'IN_HAND',status:'AVAILABLE'});
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
  const x=await setupAgentTrr('TRR RMA costing');await ok('/ingest/candidates/bulk-confirm','POST',{ids:x.imported.rows.map(r=>r.id),possession:'IN_HAND',status:'AVAILABLE'});
  const source=await db.procurementSource.findUniqueOrThrow({where:{id:x.source.id}});await ok(`/costing/sources/${source.id}/policy`,'POST',{version:source.version,orderOverheadCny:20000,costAllocationMethod:'PROPORTIONAL_LINE_AMOUNT',storeCreditAsPayment:true,note:'合成TRR规则'});
  const changed=structuredClone(x.orderInput);changed.returns=[{returnKey:'RMA-SYN-V1',externalReturnRef:'RMA-SYN-V1',statusRaw:'Opened',openedAt:'2026-07-06T12:00:00.000Z',lineKeys:['WDI571039'],rawPayload:{synthetic:true}}];
  await machineOk('/agent-ingest/orders',x.session.token,'POST',changed);
  let basis=await ok(`/costing/orders/${x.order.id}/basis`,'POST',{version:0,mode:'ACTUAL_CASH_CNY',cashPaidCny:505440,fxMicros:null,foreignEconomicTotalOverride:null,overheadCny:20000,note:'有RMA，先保留原扣款等待核对',confirmed:true});
  let preview=await ok(`/costing/orders/${x.order.id}/preview`);assert.equal(preview.ready,false);assert.ok(preview.blockers.some(x=>x.includes('最终经济支付金额')));
  basis=await ok(`/costing/orders/${x.order.id}/basis`,'POST',{version:basis.version,mode:'ACTUAL_CASH_CNY',cashPaidCny:505440,fxMicros:null,foreignEconomicTotalOverride:60000,overheadCny:20000,note:'人工核对RMA后确认最终经济支付为USD600',confirmed:true});
  preview=await ok(`/costing/orders/${x.order.id}/preview`);assert.equal(preview.ready,true);assert.equal(preview.foreignEconomicTotal,60000);assert.equal(preview.totalCny,452000);
});
test('v1 售出自动冻结当时人民币成本，后续采购成本重算不反改历史成交',async()=>{
  const x=await setupAgentTrr('TRR sale snapshot');await ok('/ingest/candidates/bulk-confirm','POST',{ids:x.imported.rows.map(r=>r.id),possession:'IN_HAND',status:'AVAILABLE'});
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
  await ok('/ingest/candidates/bulk-confirm', 'POST', { ids: x.imported.rows.map(r => r.id), possession: 'IN_HAND', status: 'AVAILABLE' });
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
  await ok('/ingest/candidates/bulk-confirm', 'POST', { ids: x.imported.rows.map(r => r.id), possession: 'IN_HAND', status: 'AVAILABLE' });
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

test('v1.0.0-rc.3 同图候选阻止静默重复建TM，可人工关联已有TM或明确覆盖新建',async()=>{
  const first=await setupAgentTrr('Duplicate source A'),firstCandidate=first.imported.rows[0],marker=randomUUID();
  const image=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="79" height="101"><rect width="79" height="101" fill="#d8d4cc"/><text x="4" y="54" font-size="5">${marker}</text></svg>`)).png().toBuffer();
  let fd=new FormData();fd.set('sourceUrl','https://example.invalid/same-a.jpg');fd.set('roleHint','PRODUCT');fd.set('file',new Blob([image],{type:'image/png'}),'same-a.png');
  await machineOk(`/agent-ingest/candidates/${firstCandidate.id}/assets`,first.session.token,'POST',fd);
  const created=await ok(`/ingest/candidates/${firstCandidate.id}/confirm`,'POST',{version:firstCandidate.version,possession:'IN_HAND',status:'AVAILABLE',duplicateOverride:false,note:'第一来源确认建档'});
  const firstItem=await item(created.itemId),itemCount=await db.item.count();

  const second=await setupAgentTrr('Duplicate source B'),secondCandidate=second.imported.rows[0];
  fd=new FormData();fd.set('sourceUrl','https://example.invalid/same-b.jpg');fd.set('roleHint','PRODUCT');fd.set('file',new Blob([image],{type:'image/png'}),'same-b.png');
  await machineOk(`/agent-ingest/candidates/${secondCandidate.id}/assets`,second.session.token,'POST',fd);
  const listed=await ok(`/ingest/candidates?sourceId=${second.source.id}&decision=PENDING&size=100`),listedRow=listed.rows.find(r=>r.id===secondCandidate.id);
  assert.equal(listedRow.possibleDuplicateCount,1);
  const matches=await ok(`/ingest/candidates/${secondCandidate.id}/matches`);
  assert.ok(matches.some(m=>m.id===firstItem.id&&m.reasons.some(reason=>reason.includes('图片'))));

  const bulk=await ok('/ingest/candidates/bulk-confirm','POST',{ids:[secondCandidate.id],possession:'IN_HAND',status:'AVAILABLE'});
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
  const overridden=await ok(`/ingest/candidates/${thirdCandidate.id}/confirm`,'POST',{version:thirdCandidate.version,possession:'IN_HAND',status:'AVAILABLE',duplicateOverride:true,note:'人工核对：同图但确为另一件独立实物'});
  assert.notEqual(overridden.itemId,firstItem.id);assert.equal(await db.item.count(),itemCount+1);
});

test('导入清单拒绝漏件漏原图和错误尺寸，缺项单件确认且原文件与权限保留', async () => {
  const {createHash}=require('node:crypto'), suffix=randomUUID().slice(0,8);
  const source=await ok('/procurement/sources','POST',{code:'IC'+suffix.toUpperCase(),name:'合成完整性来源',kind:'MARKETPLACE',defaultCurrency:'USD'});
  const session=await ok('/ingest/sessions','POST',{procurementSourceId:source.id,label:'完整性测试',ttlMinutes:60});
  const batch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'integrity-'+suffix,agentName:'Synthetic',rawManifest:{expectedCandidateKeys:['ONE','TWO'],requiredFields:['titleRaw','sourceFacts.description']}});
  const png=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="2000"><rect width="1500" height="2000" fill="#988"/><text x="20" y="200">${suffix}</text></svg>`)).png().toBuffer();
  const sha=createHash('sha256').update(png).digest('hex');
  const capture={pageUrl:'https://example.invalid/one',capturedAt:'2026-09-14T00:00:00.000Z',fields:[{path:'titleRaw',label:'名称',status:'CAPTURED'},{path:'sourceFacts.description',label:'原文介绍',status:'CAPTURED'}],images:[{sourceUrl:'https://example.invalid/full.png',sha256:sha,width:500,height:700,quality:'ORIGINAL'}]};
  const first={externalKey:'ONE',titleRaw:'完整的合成衣服',currency:'USD',sourceFacts:{description:'完整原文介绍',sizeLabel:'XL',capture},rawPayload:{synthetic:true}};
  const one=(await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates:[first]})).rows[0];
  let report=(await machineOk(`/agent-ingest/batches/${batch.id}`,session.token)).integrity;
  assert.ok(report.blockers.some(x=>x.includes('缺少商品：TWO')));assert.ok(report.blockers.some(x=>x.includes('原文件尚未保存')));
  assert.equal((await machineApi(`/agent-ingest/batches/${batch.id}/seal`,session.token,'POST',{})).status,409);
  const fd=new FormData();fd.set('file',new Blob([png],{type:'image/png'}),'original.png');fd.set('sourceUrl','https://example.invalid/full.png');
  const upload=await machineOk(`/agent-ingest/candidates/${one.id}/assets`,session.token,'POST',fd);
  report=(await machineOk(`/agent-ingest/batches/${batch.id}`,session.token)).integrity;
  assert.ok(report.blockers.some(x=>x.includes('实际尺寸')));
  capture.images[0].width=1500;capture.images[0].height=2000;
  const second={externalKey:'TWO',titleRaw:'来源缺资料的合成衣服',sourceFacts:{capture:{...capture,pageUrl:'https://example.invalid/two',fields:[{path:'titleRaw',label:'名称',status:'CAPTURED'},{path:'sourceFacts.description',label:'原文介绍',status:'UNAVAILABLE',reason:'来源旧页面已下架'}],images:[{sourceUrl:'https://example.invalid/missing.png',quality:'UNAVAILABLE',reason:'来源图片已失效'}]}},rawPayload:{synthetic:true}};
  const up=await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates:[first,second]});
  assert.equal((await api(`/ingest/candidates/${one.id}/confirm`,'POST',{version:up.rows[0].version,possession:'IN_HAND',note:'合成提前确认'})).status,409);
  const sealed=await machineOk(`/agent-ingest/batches/${batch.id}/seal`,session.token,'POST',{});
  assert.equal(sealed.integrity.state,'GAPS');assert.equal(sealed.integrity.blockers.length,0);
  const raw=await fetch(origin+`/api/ingest/candidate-assets/${upload.id}/original`,{headers:{Cookie:admin.cookie}});
  assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),png);assert.match(raw.headers.get('cache-control'),/private/);
  assert.equal((await fetch(origin+`/api/ingest/candidate-assets/${upload.id}/original`)).status,401);
  const key=randomUUID(),body={ids:up.rows.map(x=>x.id),versions:Object.fromEntries(up.rows.map(x=>[x.id,x.version])),possession:'IN_HAND',status:'AVAILABLE'};
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
  const blocked=await ok('/ingest/candidates/bulk-confirm','POST',{ids:[c.id],versions:{[c.id]:c.version},possession:'IN_HAND',status:'AVAILABLE'});
  assert.equal(blocked.failed,1);assert.match(blocked.rows[0].error,/修改/);
  const newer=await ok('/ingest/candidates/bulk-confirm','POST',{ids:[c.id],versions:{[c.id]:update.rows[0].version},possession:'IN_HAND',status:'AVAILABLE'});
  assert.equal(newer.ok,1);
  const i=await item(newer.rows[0].itemId);assert.equal(i.title,'人工维护的商品名');assert.equal(i.category,'BAG');
  const originalAssets=i.assets.length, originalFacts=i.facts;
  await machineOk(`/agent-ingest/batches/${x.batch.id}/seal`,x.session.token,'POST',{});
  const nextBatch=await machineOk('/agent-ingest/batches',x.session.token,'POST',{externalBatchKey:'enrich-'+randomUUID(),agentName:'Synthetic enrich',rawManifest:{synthetic:true}});
  await machineOk(`/agent-ingest/batches/${nextBatch.id}/candidates`,x.session.token,'POST',{candidates:[{externalKey:x.candidates[0].externalKey,titleRaw:'再次采集名称',sourceFacts:{measurements:{newDetail:'新增来源尺寸'}}}]});
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
    const batch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'same-batch-key',agentName:'Synthetic Adapter',agentVersion:'2.0',kind:kind==='OFFLINE'?'OFFLINE_IMPORT':'ITEM_BATCH',rawManifest:{adapter:{name:kind,version:'2.0',sourceSchemaVersion:'supplier-v9',mappingVersion:'reviewed-1'}}});
    const raw=kind==='MARKETPLACE'?{synthetic:true,designer:{label:'合成小众品牌'},wear:{grade:'A+',notes:['袖口轻微使用痕迹']},fabric:{panels:[{part:'body',fiber:'wool',percent:85},{part:'lining',fiber:'cotton',percent:100}]}}:{synthetic:true,品牌名称:'合成门店品牌',品相记录:{等级:'店检二级',瑕疵:'扣子缺失'},吊牌尺码:'44',票据:{编号:'SYN-PAPER-01',备注:['店内采购','无网页订单']}};
    const input={externalKey:'same-item-key',sourceItemKey:'same-sku',titleRaw:'合成无订单商品',brandRaw:kind==='MARKETPLACE'?raw.designer.label:raw.品牌名称,conditionRaw:kind==='MARKETPLACE'?raw.wear.grade:raw.品相记录.等级,statusRaw:'Sold',sourceFacts:{sizeLabel:kind==='MARKETPLACE'?'M':raw.吊牌尺码,conditionDescription:kind==='MARKETPLACE'?raw.wear.notes.join('；'):raw.品相记录.瑕疵,providerFields:raw,mappingEvidence:{brandRaw:{sourcePath:kind==='MARKETPLACE'?'designer.label':'品牌名称',rule:'直接保留原文'}}},rawPayload:raw};
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
  const confirmed=await ok('/ingest/candidates/'+a.row.id+'/confirm','POST',{version:a.row.version,possession:'IN_HAND',note:'人工确认合成实物'});
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
  await machineOk(`/agent-ingest/batches/${a.batch.id}/candidates`,a.session.token,'POST',{candidates:[{...a.input,currency:'GBP'}]});
  await machineOk(`/agent-ingest/batches/${a.batch.id}/candidates`,a.session.token,'POST',{candidates:[a.input]});
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
  const key=randomUUID();const input={version:1,state:'FOLLOWUP',notes:'第一次跟进'};
  await ok('/inquiries/'+n.id+'/status','POST',input,admin,key);await ok('/inquiries/'+n.id+'/status','POST',input,admin,key);
  const stale=await api('/inquiries/'+n.id+'/status','POST',{version:1,state:'WON',notes:'旧窗口的内容'});assert.equal(stale.status,409);
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
 await ok('/inquiries/'+n.id+'/status','POST',{version:1,state:'FOLLOWUP',notes:'预览后新沟通'});
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
 const label='来源检索-'+randomUUID(),x=await setupAgentTrr(label),candidate=x.imported.rows[0],confirmed=await ok('/ingest/candidates/'+candidate.id+'/confirm','POST',{version:candidate.version,possession:'IN_HAND',note:'合成来源检索确认'});
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
  const changed=await machineOk(`/agent-ingest/batches/${x.batch.id}/candidates`,x.session.token,'POST',{candidates:[{...x.candidates[0],sourceFacts:{capture}}]});
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
  const nextBatch=await machineOk('/agent-ingest/batches',x.session.token,'POST',{externalBatchKey:'mvp-missing-'+randomUUID(),agentName:'Synthetic'});
  const newRows=await machineOk(`/agent-ingest/batches/${nextBatch.id}/candidates`,x.session.token,'POST',{candidates:[{...x.candidates[1],sourceFacts:{capture:{...capture,images:[{sourceFile:'missing.png',sha256:'b'.repeat(64),width:1500,height:2000,quality:'ORIGINAL'}]}}}]});
  const blocked=await ok('/ingest/candidates/bulk-confirm','POST',{ids:[missing.id],versions:{[missing.id]:newRows.rows[0].version},possession:'IN_HAND',incompleteAcknowledgements:{[missing.id]:'明知缺图仍试图越过检查'}});
  assert.equal(blocked.failed,1);assert.match(blocked.rows[0].error,/原文件|保存|清单/);
});

test('商品资料库：跨批次补采保留历史成员与封存检查，候选只生成同一TM',async()=>{
  const x=await setupAgentTrr('MVP合成批次历史');
  const old=await machineOk(`/agent-ingest/batches/${x.batch.id}/seal`,x.session.token,'POST',{});
  const next=await machineOk('/agent-ingest/batches',x.session.token,'POST',{externalBatchKey:'next-'+randomUUID(),agentName:'Synthetic'});
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
 const batch=await machineOk('/agent-ingest/batches',session.token,'POST',{externalBatchKey:'MVP500-'+suffix,agentName:'Synthetic'}), rows=[];
 for(let n=0;n<500;n+=200){const candidates=Array.from({length:Math.min(200,500-n)},(_,j)=>({externalKey:suffix+':'+(n+j),titleRaw:'MVP500合成商品 '+(n+j)}));rows.push(...(await machineOk(`/agent-ingest/batches/${batch.id}/candidates`,session.token,'POST',{candidates})).rows);}
 await machineOk(`/agent-ingest/batches/${batch.id}/seal`,session.token,'POST',{});
 const identities=new Set();
 for(let n=0;n<500;n+=100){const slice=rows.slice(n,n+100),body={ids:slice.map(c=>c.id),versions:Object.fromEntries(slice.map(c=>[c.id,c.version])),possession:'IN_HAND'},key=randomUUID();const r=await ok('/ingest/candidates/bulk-confirm','POST',body,admin,key);assert.equal(r.ok,100);assert.deepEqual(await ok('/ingest/candidates/bulk-confirm','POST',body,admin,key),r);for(const c of r.rows)identities.add(c.itemId);}
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
