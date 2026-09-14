import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createGateway } from "./gateway.mjs";
const project = fileURLToPath(new URL("../", import.meta.url)),
  cwd = process.cwd(),
  port = Number(process.env.PORT || 4318),
  nonce = randomUUID();
const runDir = path.join(cwd, "data/run"),
  lockFile = path.join(runDir, "cluster.lock.json"),
  stateFile = path.join(cwd, "data/cluster-status.json");
fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
if (fs.existsSync(lockFile)) {
  const old = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  let live = true;
  try {
    process.kill(old.pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") live = false;
    else throw e;
  }
  if (live)
    throw new Error(
      "A supervisor is already running; use the existing workbench",
    );
  fs.unlinkSync(lockFile);
}
fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, nonce }), {
  flag: "wx",
  mode: 0o600,
});
let stopping = false,
  gateway,
  crashMonitor;
const states = [],
  owned = new Set(),
  startedAt = new Date().toISOString();
function state() {
  const tmp = stateFile + "." + nonce + ".tmp";
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        supervisorPid: process.pid,
        startedAt,
        port,
        stopping,
        infrastructureHA: false,
        components: states.map((s) => ({
          name: s.name,
          pid: s.child?.pid || null,
          port: s.port,
          starts: s.starts,
          status: s.status,
          lastExit: s.lastExit || null,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  fs.renameSync(tmp, stateFile);
}
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
function launch(s) {
  if (stopping) return;
  s.starts++;
  s.status = "STARTING";
  s.started = Date.now();
  const c = spawn(process.execPath, [path.join(project, "dist", s.file)], {
    cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(s.port || port),
      APP_ORIGIN: process.env.APP_ORIGIN || `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  s.child = c;
  owned.add(c);
  state();
  c.stdout.on("data", (b) => process.stdout.write(`[${s.name}] ${b}`));
  c.stderr.on("data", (b) => process.stderr.write(`[${s.name}] ${b}`));
  let handled = false;
  const failed = (code, signal) => {
    if (handled) return;
    handled = true;
    s.child = null;
    s.lastExit = { code, signal, at: new Date().toISOString() };
    s.status = stopping ? "STOPPED" : "BACKOFF";
    if (Date.now() - s.started > 60000) s.failures = 0;
    if (!stopping) {
      s.failures++;
      if (s.failures >= 8) {
        s.status = "HALTED";
        console.error(
          `${s.name}: repeated startup failures; human inspection required`,
        );
      } else {
        s.timer = setTimeout(
          () => launch(s),
          Math.min(15000, 1000 * 2 ** Math.min(4, s.failures - 1)) +
            Math.floor(Math.random() * 200),
        );
      }
    }
    state();
  };
  c.once("spawn", () => {
    s.status = "PROCESS_RUNNING";
    state();
  });
  c.once("error", (e) => failed(null, e.code));
  c.once("exit", failed);
}
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(crashMonitor);
  for (const s of states) clearTimeout(s.timer);
  state();
  const hard = setTimeout(() => {
    for (const c of owned)
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  }, 35000);
  hard.unref();
  try {
    await gateway?.close();
    for (const c of owned)
      if (c.exitCode === null && c.signalCode === null) c.kill("SIGTERM");
    await Promise.all(
      [...owned].map((c) =>
        c.exitCode !== null || c.signalCode !== null
          ? Promise.resolve()
          : new Promise((r) => c.once("exit", r)),
      ),
    );
  } finally {
    clearTimeout(hard);
    state();
    if (
      fs.existsSync(lockFile) &&
      JSON.parse(fs.readFileSync(lockFile, "utf8")).nonce === nonce
    )
      fs.unlinkSync(lockFile);
    process.disconnect?.();
  }
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("disconnect", () => void stop());
try {
  for (const file of ["dist/main.js", "dist/worker.js", "dist/web/index.html"])
    if (!fs.existsSync(path.join(project, file)))
      throw new Error("Build the application first: " + file);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid gateway port");
  const ports = [await freePort(), await freePort()];
  if (new Set([...ports, port]).size !== 3)
    throw new Error("Port allocation collision; restart safely");
  for (let n = 0; n < 2; n++)
    states.push({
      name: "api-" + (n + 1),
      file: "main.js",
      port: ports[n],
      starts: 0,
      failures: 0,
    });
  for (let n = 0; n < 2; n++)
    states.push({
      name: "worker-" + (n + 1),
      file: "worker.js",
      starts: 0,
      failures: 0,
    });
  for (const s of states) launch(s);
  gateway = await createGateway({
    port,
    targets: ports.map((p) => `http://127.0.0.1:${p}`),
  });
  crashMonitor = setInterval(state, 2000);
  crashMonitor.unref();
  const end = Date.now() + 30000;
  while (!stopping && !gateway.peers.some((p) => p.healthy) && Date.now() < end)
    await new Promise((r) => setTimeout(r, 200));
  if (!stopping && !gateway.peers.some((p) => p.healthy))
    throw new Error("No API became ready within 30 seconds");
  if (!stopping)
    console.log(
      `兔泥巴：http://127.0.0.1:${port}；2个API、2个Worker，进程自动重启。单机、数据库和磁盘仍需部署级冗余。`,
    );
} catch (e) {
  console.error("Cluster startup failed:", e.message);
  await stop();
  process.exitCode = 1;
}
