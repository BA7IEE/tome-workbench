import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createGateway } from "../scripts/gateway.mjs";
import runtimeLock from "../scripts/runtime-lock.cjs";
import guard from "../scripts/db-test-guard.cjs";
const root = process.cwd(),
  url = new URL(process.env.DATABASE_URL);
url.pathname = "/tome_test";
guard.guardDatabase(url.toString());
process.env.DATABASE_URL = url.toString();
process.env.APP_ENV = "test";
process.env.COOKIE_SECURE = "false";
process.env.EXTERNAL_EFFECTS_ENABLED = "false";
const db = new PrismaClient(),
  children = new Set(),
  report = {
    kind: "isolated-real-process-fault-tests",
    externalActionsExecuted: 0,
    checks: {},
  };
let gateway, apiA, apiB, base, session;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {}
    await delay(120);
  }
  throw new Error("Condition did not become true within " + ms + "ms");
}
function child(file, args = [], env = {}, cwd = root) {
  const c = spawn(process.execPath, [path.resolve(root, file), ...args], {
    cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      APP_ORIGIN: base || "http://127.0.0.1:4320",
      MEDIA_DIR: path.join(root, "data/test-media"),
      WORKER_LEASE_SECONDS: "2",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(c);
  c.diagnostics = "";
  for (const s of [c.stdout, c.stderr])
    s.on("data", (b) => {
      c.diagnostics = (c.diagnostics + b.toString()).slice(-4000);
    });
  return c;
}
async function stop(c, signal = "SIGTERM") {
  if (!children.has(c))
    throw new Error("Only this test's child may be signaled");
  if (c.exitCode !== null || c.signalCode !== null) return;
  c.kill(signal);
  try {
    await until(() => c.exitCode !== null || c.signalCode !== null, 12000);
  } catch {
    c.kill("SIGKILL");
    await until(() => c.exitCode !== null || c.signalCode !== null, 5000);
  }
}
async function ipc(c, phase) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Child IPC timeout: " + phase + " " + c.diagnostics));
    }, 12000);
    c.on("message", (m) => {
      if (m.phase === phase) {
        clearTimeout(timeout);
        resolve(m);
      }
    });
    c.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Child exited before " + phase + ": " + c.diagnostics));
    });
  });
}
async function ready(p) {
  return until(async () => {
    const r = await fetch(`http://127.0.0.1:${p}/api/system/ready`, {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  });
}
before(async () => {
  await db.$connect();
  assert.ok(await db.user.count(), "Run the synthetic integration suite first");
});
after(async () => {
  let clean = true;
  for (const c of children)
    try {
      await stop(c);
    } catch {
      clean = false;
    }
  try {
    await gateway?.close();
  } catch {
    clean = false;
  }
  await db.$disconnect();
  const expected = [
    "replicas",
    "apiCrash",
    "maintenance",
    "workerCrash",
    "dependencyLoss",
    "startupFailure",
    "noWriteRetry",
    "autoRestart",
  ];
  report.cleanupPassed = clean;
  report.passed =
    clean && expected.every((k) => report.checks[k]?.passed === true);
  report.at = new Date().toISOString();
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(
    "reports/high-availability.json",
    JSON.stringify(report, null, 2),
  );
  assert.ok(clean, "Owned child cleanup failed");
});
async function call(p, method = "GET", body, key = randomUUID()) {
  return fetch(base + "/api" + p, {
    method,
    headers: {
      Origin: base,
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}
test("Two real API processes share sessions and deduplicate concurrent writes", async () => {
  const pa = await port(),
    pb = await port(),
    gp = await port();
  base = `http://127.0.0.1:${gp}`;
  apiA = child("dist/main.js", [], { PORT: String(pa) });
  apiB = child("dist/main.js", [], { PORT: String(pb) });
  await Promise.all([ready(pa), ready(pb)]);
  gateway = await createGateway({
    port: gp,
    targets: [`http://127.0.0.1:${pa}`, `http://127.0.0.1:${pb}`],
  });
  const fixture = JSON.parse(
    fs.readFileSync("data/browser-fixture.json", "utf8"),
  );
  const login = await call("/auth/login", "POST", {
    email: "admin@tome.test",
    password: fixture.password,
  });
  assert.equal(login.status, 201);
  const data = await login.json();
  session = {
    csrf: data.csrf,
    cookie: login.headers.get("set-cookie").split(";")[0],
  };
  const seen = new Set();
  for (let n = 0; n < 8; n++) {
    const r = await call("/auth/me");
    assert.equal(r.status, 200);
    seen.add(r.headers.get("x-tome-instance"));
    await r.json();
  }
  assert.equal(seen.size, 2);
  const key = randomUUID(),
    title = "HA shared command " + randomUUID();
  const writes = await Promise.all(
    Array.from({ length: 16 }, async () => {
      const r = await call("/items", "POST", { title }, key);
      assert.equal(r.status, 201);
      return r.json();
    }),
  );
  assert.equal(new Set(writes.map((r) => r.id)).size, 1);
  assert.equal(await db.item.count({ where: { title } }), 1);
  const beats = await db.runtimeHeartbeat.findMany({
    where: { pid: { in: [apiA.pid, apiB.pid] }, state: "RUNNING" },
  });
  assert.equal(beats.length, 2);
  report.checks.replicas = {
    passed: true,
    apiProcesses: 2,
    repeatedWrites: 16,
    physicalItemsCreated: 1,
  };
});
test("Killing one owned API process leaves the other serving authenticated traffic", async () => {
  const started = Date.now();
  await stop(apiA, "SIGKILL");
  await until(async () => {
    const r = await fetch(base + "/__tome/ready");
    return r.ok && (await r.json()).healthy === 1;
  }, 10000);
  for (let n = 0; n < 12; n++) {
    const r = await call("/auth/me");
    assert.equal(r.status, 200);
    await r.json();
  }
  report.checks.apiCrash = {
    passed: true,
    observedFailoverMs: Date.now() - started,
    successfulReadsAfterFailover: 12,
  };
  await gateway.close();
  gateway = undefined;
  await stop(apiB);
});
test("Database maintenance gates work across working directories and reject new runtimes", async () => {
  const cwd = path.join(root, "data", "ha-other-cwd-" + randomUUID());
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const holder = child("scripts/ha-child.mjs", ["hold"], {}, cwd);
  await ipc(holder, "HELD");
  await assert.rejects(
    runtimeLock.maintenance(),
    /Stop this database API and Worker/,
  );
  await stop(holder);
  const unlock = await runtimeLock.maintenance();
  try {
    const denied = child("scripts/ha-child.mjs", ["hold"]);
    await until(() => denied.exitCode !== null || denied.signalCode !== null);
    assert.notEqual(denied.exitCode, 0);
    assert.match(denied.diagnostics, /Database maintenance in progress/);
  } finally {
    await unlock();
  }
  report.checks.maintenance = {
    passed: true,
    crossDirectoryLock: true,
    newRuntimeDenied: true,
  };
});
test("A real SIGKILL after durable claim is recovered by replacement workers", async () => {
  const i = await db.$transaction(async (tx) => {
    const r = await tx.item.create({
      data: { title: "HA synthetic crash item", facts: {} },
    });
    await tx.cycle.create({ data: { itemId: r.id, number: 1 } });
    await tx.itemRevision.create({
      data: {
        itemId: r.id,
        version: 1,
        snapshot: {
          title: r.title,
          brand: "",
          category: r.category,
          facts: {},
        },
      },
    });
    return r;
  });
  const job = await db.outbox.create({
    data: {
      itemId: i.id,
      kind: "HA_REAL_CRASH",
      payload: {},
      createdAt: new Date(0),
      nextAt: new Date(0),
    },
  });
  const doomed = child("scripts/ha-child.mjs", ["claim"]),
    claimed = await ipc(doomed, "CLAIMED");
  assert.equal(claimed.job.id, job.id);
  await stop(doomed, "SIGKILL");
  const started = Date.now(),
    a = child("dist/worker.js"),
    b = child("dist/worker.js");
  await until(async () => {
    const r = await db.outbox.findUnique({ where: { id: job.id } });
    return r.status === "DONE";
  }, 20000);
  const done = await db.outbox.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(done.attempts, 2);
  assert.equal(done.leaseToken, null);
  report.checks.workerCrash = {
    passed: true,
    testLeaseSeconds: 2,
    observedRecoveryMs: Date.now() - started,
    attempts: done.attempts,
    replacementWorkers: 2,
  };
  await stop(a);
  await stop(b);
});
test("Loss of the owned database transport makes an API fail closed without stopping PostgreSQL", async () => {
  const sockets = new Set();
  const transport = net.createServer((down) => {
    const up = net.connect({
      host: url.hostname,
      port: Number(url.port || 5432),
    });
    sockets.add(down);
    sockets.add(up);
    down.pipe(up);
    up.pipe(down);
    down.on("error", () => up.destroy());
    up.on("error", () => down.destroy());
    down.on("close", () => {
      sockets.delete(down);
      up.destroy();
    });
    up.on("close", () => {
      sockets.delete(up);
      down.destroy();
    });
  });
  await new Promise((r) => transport.listen(0, "127.0.0.1", r));
  const proxied = new URL(url);
  proxied.port = String(transport.address().port);
  const p = await port();
  const c = child("dist/main.js", [], {
    DATABASE_URL: proxied.toString(),
    PORT: String(p),
  });
  try {
    await ready(p);
    assert.ok(sockets.size >= 2);
    const started = Date.now();
    for (const s of sockets) s.destroy();
    await new Promise((r) => transport.close(r));
    await until(() => c.exitCode !== null || c.signalCode !== null, 10000);
    assert.notEqual(c.exitCode, 0);
    await db.$queryRaw`SELECT 1`;
    report.checks.dependencyLoss = {
      passed: true,
      observedExitMs: Date.now() - started,
      postgresServerNotStopped: true,
    };
  } finally {
    for (const s of sockets) s.destroy();
    if (transport.listening) await new Promise((r) => transport.close(r));
    await stop(c);
  }
});
test("Occupied listen ports fail startup cleanly without orphaning the runtime lease", async () => {
  const occupied = net.createServer();
  await new Promise((r) => occupied.listen(0, "127.0.0.1", r));
  const p = occupied.address().port,
    c = child("dist/main.js", [], { PORT: String(p) });
  try {
    await until(() => c.exitCode !== null || c.signalCode !== null, 10000);
    assert.notEqual(c.exitCode, 0);
    const held = await db.runtimeHeartbeat.findMany({
      where: { pid: c.pid, state: "RUNNING" },
    });
    assert.equal(held.length, 0);
    report.checks.startupFailure = { passed: true, cleanExit: true };
  } finally {
    await new Promise((r) => occupied.close(r));
    await stop(c);
  }
});
test("Gateway does not replay a write after a backend loses its response", async () => {
  const http = await import("node:http"),
    counts = [0, 0],
    servers = [];
  let g;
  try {
    for (let n = 0; n < 2; n++) {
      const s = http.createServer((req, res) => {
        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"status":"ready"}');
          return;
        }
        req.resume();
        req.on("end", () => {
          counts[n]++;
          req.socket.destroy();
        });
      });
      await new Promise((r) => s.listen(0, "127.0.0.1", r));
      servers.push(s);
    }
    const p = await port();
    g = await createGateway({
      port: p,
      targets: servers.map((s) => `http://127.0.0.1:${s.address().port}`),
    });
    const r = await fetch(`http://127.0.0.1:${p}/write`, {
      method: "POST",
      body: "synthetic-command",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(r.status, 503);
    await r.text();
    await delay(200);
    assert.equal(counts[0] + counts[1], 1);
    report.checks.noWriteRetry = {
      passed: true,
      backendExecutions: 1,
      responseLost: true,
    };
  } finally {
    await g?.close();
    for (const s of servers) {
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
  }
});
test("The real supervisor automatically replaces its failed API and worker children", async () => {
  const { execFileSync } = await import("node:child_process"),
    cwd = path.join(root, "data", "ha-supervisor-" + randomUUID());
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const gp = await port(),
    origin = `http://127.0.0.1:${gp}`,
    c = child(
      "scripts/cluster.mjs",
      [],
      { PORT: String(gp), APP_ORIGIN: origin },
      cwd,
    ),
    file = path.join(cwd, "data/cluster-status.json");
  const state = () => JSON.parse(fs.readFileSync(file, "utf8"));
  const available = async () => {
    const r = await fetch(origin + "/__tome/ready", {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok && (await r.json()).healthy === 2;
  };
  try {
    await until(available, 30000);
    const measurements = {};
    for (const name of ["api-1", "worker-1"]) {
      const old = state().components.find((s) => s.name === name);
      assert.ok(Number.isInteger(old.pid));
      // Read-only ancestry validation: never signal a PID outside this test's supervisor tree.
      const actualParent = Number(
        execFileSync("ps", ["-p", String(old.pid), "-o", "ppid="], {
          encoding: "utf8",
        }).trim(),
      );
      assert.equal(actualParent, c.pid);
      const started = Date.now();
      process.kill(old.pid, "SIGKILL");
      await until(() => {
        const now = state().components.find((s) => s.name === name);
        return now.pid && now.pid !== old.pid && now.starts > old.starts;
      }, 15000);
      const now = state().components.find((s) => s.name === name);
      await until(
        async () =>
          !!(await db.runtimeHeartbeat.findFirst({
            where: { pid: now.pid, state: "RUNNING" },
          })),
        15000,
      );
      await until(available, 15000);
      measurements[name] = Date.now() - started;
    }
    await stop(c);
    assert.ok(state().components.every((s) => s.pid === null));
    report.checks.autoRestart = {
      passed: true,
      observedReplacementMs: measurements,
      allOwnedChildrenStopped: true,
    };
  } finally {
    await stop(c);
  }
});
