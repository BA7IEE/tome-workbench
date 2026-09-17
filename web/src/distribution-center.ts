import {
  area,
  button,
  esc,
  field,
  form,
  note,
  request,
  select,
  section,
  table,
  text,
  when,
} from "./core";

type Attempt = {
  id: string;
  itemId: string;
  channelId: string;
  action: string;
  state: string;
  remoteId: string;
  remoteUrl: string;
  errorCode: string;
  errorMessage: string;
  createdAt: string;
  finishedAt: string | null;
  channel: { id: string; name: string; platform: string };
  item: { id: string; serial: number; title: string; status: string };
};

type Summary = {
  channel: { id: string; name: string; platform: string; active: boolean };
  counts: Record<string, number>;
  needsStop: number;
};

const count = (counts: Record<string, number>, state: string) =>
  counts[state] || 0;

const handoffStates: Record<string, string> = {
  PENDING: "待交付",
  RUNNING: "已交付",
  SUCCEEDED: "已确认完成",
  FAILED: "需要处理",
  UNKNOWN: "需要核对",
  CANCELLED: "已取消",
};

const actionLabels: Record<string, string> = {
  PUBLISH: "发布资料",
  UPDATE: "更新资料",
  DELIST: "停售资料",
};

function recordManualResult(attempt: Attempt) {
  const reconciliation = attempt.state === "UNKNOWN";
  form(
    `${attempt.item.title} · 登记分发结果`,
    note(
      reconciliation
        ? "请先在目标渠道按永久 TM 核对。核对后只更新这一条分发记录，不会重新发布。"
        : "这里只记录外部 Agent、脚本或人工已完成的结果；系统不会从这里调用外部平台。",
    ) +
      select(
        "state",
        "结果",
        reconciliation
          ? { SUCCEEDED: "已确认完成", FAILED: "确认未完成" }
          : {
              SUCCEEDED: "已确认完成",
              FAILED: "需要处理",
              UNKNOWN: "需要核对",
            },
        "SUCCEEDED",
      ) +
      field("remoteId", "稳定远端编号（APP 未提供可留空）", attempt.remoteId) +
      field("remoteUrl", "稳定链接（可留空）", attempt.remoteUrl) +
      select(
        "method",
        "核对方式",
        {
          TM_SEARCH: "按 TM 搜索核对",
          PLATFORM_RECEIPT: "平台成功回执",
          API_RESPONSE: "API 响应",
          MANUAL_CONFIRMATION: "人工确认",
          RECONCILIATION: "结果未知后的核对",
        },
        reconciliation ? "RECONCILIATION" : "MANUAL_CONFIRMATION",
      ) +
      area("note", reconciliation ? "核对依据" : "依据 / 失败说明", "", 3) +
      field("errorCode", "失败代码（失败或未知时必填）", attempt.errorCode) +
      area(
        "errorMessage",
        "失败详情（失败或未知时必填）",
        attempt.errorMessage,
        2,
      ),
    (d, key) => {
      const state = text(d, "state");
      const noteText = text(d, "note");
      if (!noteText)
        throw new Error(
          reconciliation ? "请填写核对依据" : "请填写实际结果依据或失败说明",
        );
      const errorCode = text(d, "errorCode");
      const errorMessage = text(d, "errorMessage");
      if (
        ["FAILED", "UNKNOWN"].includes(state) &&
        (!errorCode || !errorMessage)
      )
        throw new Error("失败或结果未知时须填写失败代码和详情");
      return request(
        `/distribution/attempts/${attempt.id}/manual-result`,
        "POST",
        {
          state,
          remoteId: text(d, "remoteId"),
          remoteUrl: text(d, "remoteUrl"),
          evidence: { method: text(d, "method"), note: noteText },
          errorCode,
          errorMessage,
        },
        key,
      );
    },
    reconciliation ? "确认核对结果" : "登记分发结果",
  );
}

export async function distributionCenter() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const state = qs.get("state") || "";
  const attemptId = qs.get("attemptId") || "";
  const [summary, attempts] = await Promise.all([
    request<Summary[]>("/distribution/summary"),
    request<Attempt[]>(
      "/distribution/attempts?" +
        new URLSearchParams({ ...(state ? { state } : {}), take: "100" }),
    ),
  ]);
  const visible = attemptId
    ? attempts.filter((attempt) => attempt.id === attemptId)
    : attempts;
  return (
    section(
      "商品分发",
      note(
        "这里准备冻结资料并记录交付、回传和停售状态。外部 Agent、脚本或人工负责平台操作；系统不保存第三方凭据，也不会直接调用平台。APP 没有稳定 ID 时，仍可按标题中的永久 TM 核对。",
      ) +
        `<div class="distribution-summary">${summary
          .map(
            (row) =>
              `<article class="panel"><h3>${esc(row.channel.name)}</h3><p>${esc(row.channel.platform)} · ${row.channel.active ? "已启用" : "已停用"}</p><dl><div><dt>待交付</dt><dd>${count(row.counts, "PENDING")}</dd></div><div><dt>已交付</dt><dd>${count(row.counts, "RUNNING")}</dd></div><div><dt>已确认完成</dt><dd>${count(row.counts, "SUCCEEDED")}</dd></div><div><dt>需要处理</dt><dd>${count(row.counts, "FAILED")}</dd></div><div><dt>需要核对</dt><dd>${count(row.counts, "UNKNOWN")}</dd></div><div><dt>需要停售</dt><dd>${row.needsStop}</dd></div></dl></article>`,
          )
          .join("")}</div>`,
    ) +
    section(
      attemptId ? "指定分发记录" : "分发记录",
      table(
        ["商品 / 渠道", "资料动作", "经营状态", "回传结果", "操作"],
        visible.map((attempt) => [
          `<a href="#/items/${attempt.item.id}?tab=use">TM${String(attempt.item.serial).padStart(6, "0")} ${esc(attempt.item.title)}</a><small>${esc(attempt.channel.name)}</small>`,
          esc(actionLabels[attempt.action] || attempt.action),
          `${esc(handoffStates[attempt.state] || attempt.state)}<small>${when(attempt.finishedAt || attempt.createdAt)}</small>`,
          attempt.remoteId
            ? `${esc(attempt.remoteId)}${attempt.remoteUrl ? `<small>${esc(attempt.remoteUrl)}</small>` : ""}`
            : attempt.errorCode
              ? `${esc(attempt.errorCode)}<small>${esc(attempt.errorMessage)}</small>`
              : "尚无稳定远端编号回传",
          attempt.state === "FAILED"
            ? button("重新交付原记录", () =>
                request(
                  `/distribution/attempts/${attempt.id}/retry`,
                  "POST",
                  {},
                ),
              )
            : ["PENDING", "RUNNING", "UNKNOWN"].includes(attempt.state)
              ? button(
                  attempt.state === "UNKNOWN" ? "核对结果" : "登记结果",
                  () => recordManualResult(attempt),
                )
              : "已记录",
        ]),
      ) + (!visible.length ? "<p>当前筛选下没有分发记录。</p>" : ""),
    )
  );
}
