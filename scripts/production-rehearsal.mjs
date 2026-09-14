// Runs only against the explicitly isolated localhost rehearsal, never a real deployment.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import sharp from "sharp";
const dir = path.resolve("data/production-rc2-test"),
  project = "tome-release-test-rc2";
const cfg = JSON.parse(
  fs.readFileSync(path.join(dir, "configuration.json"), "utf8"),
);
if (
  !cfg.rehearsal ||
  cfg.domain !== "localhost" ||
  !cfg.origin.startsWith("https://localhost:")
)
  throw new Error("Local synthetic rehearsal required");
const compose = [
  "compose",
  "-p",
  project,
  "-f",
  "compose.production.yaml",
  "--env-file",
  path.join(dir, "compose.env"),
];
const run = (args, options = {}) =>
  execFileSync("docker", [...compose, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });
const ca = run([
  "exec",
  "-T",
  "proxy",
  "cat",
  "/data/caddy/pki/authorities/local/root.crt",
]);
fs.writeFileSync(path.join(dir, "rehearsal-ca.crt"), ca, { mode: 0o600 });
const credential = run([
  "exec",
  "-T",
  "api-a",
  "cat",
  "/app/data/first-admin.txt",
]);
const password = credential.match(/初始密码：([^\r\n]+)/)?.[1];
if (!password || !credential.includes("rehearsal@tome.test"))
  throw new Error(
    "Synthetic account must be created by the standard admin CLI first",
  );
const checks = {};
const status = await new Promise((resolve, reject) => {
  const r = https.get(
    cfg.origin + "/api/system/ready",
    { ca, family: 4, timeout: 5000 },
    (res) => {
      res.resume();
      resolve(res.statusCode);
    },
  );
  r.on("error", reject);
  r.on("timeout", () => r.destroy());
});
if (status !== 200) throw new Error("Trusted local TLS readiness failed");
checks.tlsCertificateVerified = true;
const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  baseURL: cfg.origin,
}); // localhost only; trust was independently checked above.
const page = await context.newPage();
try {
  await page.goto("/");
  await page.getByLabel("登录邮箱").fill("rehearsal@tome.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.locator(".sidebar-bottom strong").waitFor();
  const cookie = (await context.cookies()).find(
    (c) => c.name === "__Host-tome_session",
  );
  if (
    !cookie?.secure ||
    !cookie.httpOnly ||
    cookie.sameSite !== "Strict" ||
    cookie.path !== "/"
  )
    throw new Error("Production session cookie contract failed");
  checks.secureLogin = true;
  await page.goto("/#/items");
  await page.getByRole("button", { name: "＋ 新建商品" }).click();
  await page
    .getByLabel("商品名称", { exact: true })
    .fill("生产部署合成样本 " + randomUUID().slice(0, 8));
  await page.getByLabel("品牌", { exact: true }).fill("SYNTHETIC");
  await page.locator("#dialog button[type=submit]").click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  await page.waitForURL(/items\/[a-f0-9-]{36}/);
  const itemId = page.url().match(/items\/([a-f0-9-]{36})/)?.[1];
  if (!itemId) throw new Error("New physical item navigation failed");
  checks.itemCreation = true;
  await page.getByRole("link", { name: "素材", exact: true }).click();
  await page.getByRole("button", { name: "＋ 上传图片" }).click();
  const buffer = await sharp({
    create: { width: 100, height: 120, channels: 3, background: "#ddd" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("选择图片").setInputFiles({
    name: "production-synthetic.png",
    mimeType: "image/png",
    buffer,
  });
  await page.getByLabel("来源与授权说明").fill("仅供隔离部署演练的合成图片");
  await page.locator("#dialog button[type=submit]").click();
  await page.locator("#dialog").waitFor({ state: "hidden" });
  const item = await (await page.request.get("/api/items/" + itemId)).json();
  const asset = item.assets.find(
    (a) => a.originalName === "production-synthetic.png",
  );
  if (!asset) throw new Error("Uploaded asset missing");
  const original = await page.request.get(
    "/api/assets/" + asset.id + "/original",
  );
  if (original.status() !== 200 || !(await original.body()).equals(buffer))
    throw new Error("Original did not round trip exactly");
  checks.originalImageRoundTrip = true;
  const role = JSON.parse(
    run([
      "exec",
      "-T",
      "api-a",
      "node",
      "--input-type=module",
      "-e",
      `import {Client} from 'pg';const d=new Client({connectionString:process.env.DATABASE_URL});try{await d.connect();const r=await d.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user');console.log(JSON.stringify(r.rows[0]));}finally{await d.end();}`,
    ]),
  );
  if (Object.values(role).some(Boolean))
    throw new Error("Runtime role is privileged");
  checks.leastPrivilegeDatabase = true;
  const blocked = spawnSync(
    "docker",
    [
      ...compose,
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "-e",
      "TOME_DEPLOY_APPROVED=YES",
      "migration",
      "scripts/migrate-safe.mjs",
      "--production",
      "--initial-empty",
    ],
    { encoding: "utf8", timeout: 20000 },
  );
  if (
    blocked.status === 0 ||
    !(blocked.stderr + blocked.stdout).includes(
      "Stop this database API and Worker",
    )
  )
    throw new Error("Live migration was not stopped by the database-wide gate");
  checks.liveMigrationBlocked = true;
  const statusOf = (service) =>
    JSON.parse(
      execFileSync("docker", ["inspect", run(["ps", "-q", service]).trim()], {
        encoding: "utf8",
      }),
    )[0];
  async function healthy(service, previous) {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const x = statusOf(service);
      if (x.RestartCount > previous && x.State.Health?.Status === "healthy")
        return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Container did not recover: " + service);
  }
  for (const service of ["api-a", "worker-a"]) {
    const before = statusOf(service),
      kind = service.startsWith("api") ? "api" : "worker";
    if (before.Config.Labels["com.docker.compose.project"] !== project)
      throw new Error("Container ownership mismatch");
    const started = Date.now();
    run([
      "exec",
      "-T",
      service,
      "node",
      "--input-type=module",
      "-e",
      `import fs from 'node:fs';const dir=process.env.RUNTIME_DIR;const f=fs.readdirSync(dir).find(n=>n.includes('-${kind}-'));if(!f)throw new Error('No owned runtime marker');const r=JSON.parse(fs.readFileSync(dir+'/'+f));const command=fs.readFileSync('/proc/'+r.pid+'/cmdline','utf8');if(r.kind!=='${kind}'||r.pid<2||!command.includes('dist/${kind === "api" ? "main" : "worker"}.js'))throw new Error('Runtime ownership check failed');process.kill(r.pid,'SIGKILL');`,
    ]);
    await healthy(service, before.RestartCount);
    checks[service + "Recovery"] = {
      passed: true,
      observedMs: Date.now() - started,
    };
  }
  const latencies = [];
  let reads = 0;
  const loadStart = Date.now();
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let n = 0; n < 16; n++) {
        const begin = performance.now();
        const r = await page.request.get("/api/items");
        if (r.status() !== 200)
          throw new Error("Bounded authenticated read workload failed");
        await r.body();
        latencies.push(performance.now() - begin);
        reads++;
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  checks.boundedConcurrentReads = {
    passed: true,
    count: reads,
    concurrency: 8,
    elapsedMs: Date.now() - loadStart,
    p95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
    scope: "Small synthetic dataset; not a sustained load or SLA certification",
  };
  const me = await page.request.get("/api/auth/me");
  if (me.status() !== 200)
    throw new Error("Session did not survive replica restart");
  checks.sessionAfterRestart = true;
  await page.goto("/#/operations");
  await page.getByRole("heading", { name: "运行健康与故障恢复" }).waitFor();
  fs.mkdirSync("reports/screenshots", { recursive: true });
  await page.screenshot({
    path: "reports/screenshots/production.png",
    fullPage: true,
  });
  const report = {
    at: new Date().toISOString(),
    kind: "linux-containers-production-mode-local-tls",
    passed: true,
    checks,
    publicDeployment: false,
    publicCertificateVerified: false,
    externalActionsExecuted: 0,
  };
  fs.writeFileSync(
    "reports/production-rehearsal.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  fs.writeFileSync(
    "reports/production-rehearsal.json",
    JSON.stringify(
      { at: new Date().toISOString(), passed: false, checks, error: e.message },
      null,
      2,
    ),
  );
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
