import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
const arg = (n, d) =>
  process.argv.find((x) => x.startsWith(n + "="))?.slice(n.length + 1) || d;
const dir = path.resolve(arg("--config-dir", "data/production")),
  project = arg("--project", "tome-production");
if (!/^tome-[a-z0-9-]+$/.test(project))
  throw new Error("Invalid Compose project");
const cfg = JSON.parse(
  fs.readFileSync(path.join(dir, "configuration.json"), "utf8"),
);
const compose = [
  "compose",
  "-p",
  project,
  "-f",
  "compose.production.yaml",
  "--env-file",
  path.join(dir, "compose.env"),
];
const checks = [];
const check = (id, pass, detail) =>
  checks.push({ id, pass: !!pass, ...(detail ? { detail } : {}) });
check("https-origin", cfg.origin.startsWith("https://"));
execFileSync("docker", [...compose, "config", "--quiet"], { stdio: "pipe" });
const services = [
  "api-a",
  "api-b",
  "worker-a",
  "worker-b",
  "postgres",
  "proxy",
];
for (const name of services) {
  const id = execFileSync("docker", [...compose, "ps", "-q", name], {
    encoding: "utf8",
  }).trim();
  if (!id) {
    check(name + "-running", false);
    continue;
  }
  const x = JSON.parse(
    execFileSync("docker", ["inspect", id], { encoding: "utf8" }),
  )[0];
  check(
    name + "-running",
    x.State.Running &&
      (name === "proxy" || x.State.Health?.Status === "healthy"),
  );
  if (name.startsWith("api") || name.startsWith("worker"))
    check(
      name + "-hardened",
      x.Config.User === "node" &&
        x.HostConfig.ReadonlyRootfs &&
        x.HostConfig.CapDrop?.includes("ALL"),
    );
  if (name !== "proxy")
    check(
      name + "-not-public",
      !Object.values(x.HostConfig.PortBindings || {}).some((x) => x?.length),
    );
}
const ca = arg("--ca", "");
const status = await new Promise((resolve) => {
  const r = https.get(
    cfg.origin + "/api/system/ready",
    { ...(ca ? { ca: fs.readFileSync(ca) } : {}), timeout: 5000 },
    (res) => {
      res.resume();
      resolve(res.statusCode);
    },
  );
  r.on("error", () => resolve(0));
  r.on("timeout", () => r.destroy());
});
check("tls-and-live-readiness", status === 200);
const softwareReady = checks.every((c) => c.pass);
let approval = {};
if (fs.existsSync(path.join(dir, "operations-approval.json")))
  approval = JSON.parse(
    fs.readFileSync(path.join(dir, "operations-approval.json"), "utf8"),
  );
const humanChecks = [
  "businessUat",
  "offHostBackupVerified",
  "recoveryDrillReviewed",
  "domainAndFirewallReviewed",
  "alertRecipientConfirmed",
];
const pending = humanChecks.filter((k) => approval[k] !== true);
const publicReady =
  softwareReady && !cfg.rehearsal && cfg.publicBind && pending.length === 0;
const report = {
  at: new Date().toISOString(),
  project,
  softwareReady,
  publicReady,
  rehearsal: cfg.rehearsal,
  checks,
  pendingHumanChecks: pending,
  infrastructureFailoverVerified: false,
  decision: publicReady
    ? "GO_WITH_RECORDED_APPROVAL"
    : softwareReady && cfg.rehearsal
      ? "REHEARSAL_PASS_NOT_PUBLIC_GO"
      : "NO_GO",
};
fs.mkdirSync("reports", { recursive: true });
fs.writeFileSync(
  "reports/production-preflight.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (
  !publicReady &&
  !(
    cfg.rehearsal &&
    softwareReady &&
    process.argv.includes("--allow-rehearsal")
  )
)
  process.exitCode = 1;
