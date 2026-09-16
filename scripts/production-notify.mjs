// PushPlus is opt-in. Never forward database records, raw diagnostics or credentials.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const allowed = [
  "ready",
  "certificate",
  "database",
  "outbox",
  "mediaDisk",
  "databaseDisk",
  "backupAge",
];
export function notification(report) {
  if (
    !report ||
    !report.checks ||
    allowed.some((key) => typeof report.checks[key] !== "boolean")
  )
    throw new Error("监控报告缺少检查结果");
  const failed = allowed.filter((key) => !report.checks[key]);
  return {
    signature: failed.join(",") || "healthy",
    title: failed.length ? "ToMeBoutique 运行告警" : "ToMeBoutique 已恢复",
    content: failed.length
      ? `未通过的检查：${failed.join("、")}。请登录服务器检查。`
      : "全部运行检查已恢复。",
    template: "txt",
    channel: "wechat",
  };
}
export async function sendNotification(message, token, transport = fetch) {
  let response;
  try {
    response = await transport("https://www.pushplus.plus/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        title: message.title,
        content: message.content,
        template: "txt",
        channel: "wechat",
      }),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    const data = await response.json();
    if (!response.ok || data.code !== 200 || typeof data.data !== "string")
      throw new Error();
    // PushPlus code=200 acknowledges enqueueing, not delivery to the user's device.
    return { accepted: true, delivered: false };
  } catch {
    throw new Error(
      "PushPlus 请求失败或结果不确定，请在 PushPlus 后台核对；不会立即重试",
    );
  }
}
async function main() {
  const args = process.argv.slice(2);
  const value = (key) =>
    args.find((arg) => arg.startsWith(key + "="))?.slice(key.length + 1);
  const reportFile = value("--report");
  if (!reportFile)
    throw new Error("需要 --report=监控报告路径；默认只预览，--send 才发送");
  const message = notification(JSON.parse(fs.readFileSync(reportFile, "utf8")));
  if (!args.includes("--send")) {
    console.log(JSON.stringify({ dryRun: true, ...message }));
    return;
  }
  const tokenFile = value("--token-file"),
    stateDir = value("--state-dir");
  if (!tokenFile || !stateDir)
    throw new Error("发送需要独立的 --token-file 和 --state-dir");
  const stat = fs.lstatSync(tokenFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error("Token 必须保存在权限 600 的普通文件中");
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  if (!token || /\s/.test(token)) throw new Error("Token 文件格式不正确");
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const directory = fs.lstatSync(stateDir);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.mode & 0o077
  )
    throw new Error("状态目录必须为权限 700 的普通目录");
  const lock = path.join(stateDir, "notify.lock"),
    stateFile = path.join(stateDir, "notify.json");
  const fd = fs.openSync(lock, "wx", 0o600);
  try {
    const previous = fs.existsSync(stateFile)
      ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
      : null;
    if (
      (!previous && message.signature === "healthy") ||
      (previous?.signature === message.signature &&
        Date.now() - previous.at < 1800000)
    ) {
      console.log(JSON.stringify({ suppressed: true, delivered: false }));
      return;
    }
    // Persist before the network request, so timeout/crash cannot immediately send duplicates.
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ signature: message.signature, at: Date.now() }),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(await sendNotification(message, token)));
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
