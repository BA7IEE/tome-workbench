import { spawn } from "node:child_process";
const role = process.argv[2] || "api";
if (!["api", "worker"].includes(role))
  throw new Error("Unknown container role");
const child = spawn(
  process.execPath,
  [role === "api" ? "dist/main.js" : "dist/worker.js"],
  { stdio: ["inherit", "inherit", "inherit", "ipc"], env: process.env },
);
let stopping = false,
  probing = false,
  failures = 0,
  probe,
  deadline;
const started = Date.now();
function stop(code) {
  if (stopping) return;
  stopping = true;
  clearInterval(watchdog);
  probe?.kill("SIGTERM");
  process.exitCode = code;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    deadline = setTimeout(() => child.kill("SIGKILL"), 20000);
    deadline.unref();
  }
}
const watchdog = setInterval(() => {
  if (stopping || probing || Date.now() - started < 45000) return;
  probing = true;
  probe = spawn(process.execPath, ["scripts/probe.mjs", role], {
    stdio: "ignore",
    env: process.env,
  });
  const limit = setTimeout(() => probe?.kill("SIGKILL"), 4000);
  probe.once("error", () => {
    failures++;
  });
  probe.once("exit", (code) => {
    clearTimeout(limit);
    probing = false;
    failures = code === 0 ? 0 : failures + 1;
    if (failures >= 3) {
      console.error("WATCHDOG_NOT_READY: restarting unhealthy container");
      stop(1);
    }
  });
}, 5000);
child.once("error", () => stop(1));
child.once("exit", (code, signal) => {
  clearInterval(watchdog);
  clearTimeout(deadline);
  probe?.kill("SIGTERM");
  if (!stopping) process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stop(0));
