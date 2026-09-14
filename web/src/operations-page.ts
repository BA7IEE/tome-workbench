import {
  request,
  button,
  note,
  esc,
  table,
  section,
  when,
  reload,
} from "./core";
const warningLabels: Record<string, string> = {
  NO_HEALTHY_WORKER: "后台处理服务当前没有健康实例",
  FAILED_JOBS: "存在失败任务需要处理",
};
const queueLabels: Record<string, string> = {
  PENDING: "等待执行",
  WORKING: "正在执行",
  DONE: "已完成",
  FAILED: "失败待处理",
};
const instanceLabels: Record<string, string> = {
  api: "接口服务",
  worker: "后台处理服务",
};
interface Status {
  at: string;
  instances: {
    id: string;
    kind: string;
    pid: number;
    state: string;
    lastSeen: string;
    healthy: boolean;
  }[];
  failedJobs: number;
  manualDelistingTasks: number;
  oldestPendingSeconds: number;
  warnings: string[];
  process: {
    requests: number;
    inFlight: number;
    serverErrors: number;
    last512P95Ms: number | null;
  };
  queue: { status: string; _count: { _all: number } }[];
}
export async function operationsPage() {
  const s = await request<Status>("/operations/status");
  return section(
    "运行健康与故障恢复",
    note(
      "单机部署不等于基础设施高可用。心跳、任务状态来自当前数据库。多进程可接管不等于跨机房高可用；数据库、磁盘和主机冗余需独立部署验证。",
    ) +
      `<div class="stat-grid"><article><span>失败任务</span><strong>${s.failedJobs}</strong></article><article><span>最老待处理任务</span><strong>${s.oldestPendingSeconds}s</strong></article><article><span>人工停售待办</span><strong>${s.manualDelistingTasks}</strong></article><article><span>近期接口响应</span><strong>${s.process.last512P95Ms ?? "—"}ms</strong></article></div>` +
      note(
        s.warnings.length
          ? "需要关注：" +
              s.warnings
                .map((w) => warningLabels[w] || "系统运行需要检查")
                .join("；")
          : "当前未发现上述告警条件。",
      ) +
      table(
        ["实例", "类别", "心跳状态", "最近心跳"],
        s.instances
          .filter((i) => i.state === "RUNNING")
          .map((i, index) => [
            `${esc(instanceLabels[i.kind] || "服务")} ${index + 1}<small>${esc(i.id.slice(0, 8))}</small>`,
            esc(instanceLabels[i.kind] || i.kind),
            i.healthy ? "正常" : i.state === "RUNNING" ? "心跳过期" : "已停止",
            when(i.lastSeen),
          ]),
      ) +
      `<details><summary>已停止的历史实例 · ${s.instances.filter((i) => i.state !== "RUNNING").length} 个</summary>${table(
        ["类别", "最近心跳"],
        s.instances
          .filter((i) => i.state !== "RUNNING")
          .map((i) => [
            esc(instanceLabels[i.kind] || i.kind),
            when(i.lastSeen),
          ]),
      )}</details>` +
      table(
        ["队列状态", "数量"],
        s.queue.map((q) => [
          esc(queueLabels[q.status] || "其他状态"),
          String(q._count._all),
        ]),
      ) +
      `<p><a class="btn" href="#/jobs">处理失败任务</a> <a class="btn" href="#/tasks">处理停售待办</a></p><small>检查时间 ${when(s.at)}；本次运行已处理${s.process.requests}次请求，其中${s.process.serverErrors}次出现服务端错误。</small>`,
    button("刷新检查", reload),
  );
}
