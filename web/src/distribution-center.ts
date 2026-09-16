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
import { states } from "./types";

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
  attemptCount: number;
  leaseUntil: string | null;
  createdAt: string;
  finishedAt: string | null;
  channel: { id: string; name: string; platform: string };
  item: { id: string; serial: number; title: string; status: string };
};

type Summary = {
  channel: { id: string; name: string; platform: string; active: boolean };
  counts: Record<string, number>;
};

const count = (counts: Record<string, number>, state: string) =>
  counts[state] || 0;

function recordManualResult(attempt: Attempt) {
  form(
    `${attempt.item.title} · 登记执行结果`,
    note(
      attempt.state === "UNKNOWN"
        ? "请先进入该账号，用标题中的永久 TM 核对。确认前不可重新发布。"
        : "只记录已经实际发生的执行结果；不会从此处调用外部平台。",
    ) +
      select(
        "state",
        "结果",
        { SUCCEEDED: "已确认成功", FAILED: "明确失败", UNKNOWN: "结果未知" },
        attempt.state === "UNKNOWN" ? "SUCCEEDED" : "SUCCEEDED",
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
        attempt.state === "UNKNOWN" ? "RECONCILIATION" : "MANUAL_CONFIRMATION",
      ) +
      area("note", "依据 / 失败说明", "", 3) +
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
      if (!noteText) throw new Error("请填写实际执行依据或失败说明");
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
    "登记实际结果",
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
        "这里记录发布、更新、下架的执行事实。稳定 remoteId 才会形成 Listing；APP 没有 ID 时，按标题中的永久 TM 核对。不会保存第三方账号凭据或直接调用平台。",
      ) +
        `<div class="distribution-summary">${summary
          .map(
            (row) =>
              `<article class="panel"><h3>${esc(row.channel.name)}</h3><p>${esc(row.channel.platform)} · ${row.channel.active ? "已启用" : "已停用"}</p><dl><div><dt>待处理</dt><dd>${count(row.counts, "PENDING")}</dd></div><div><dt>执行中</dt><dd>${count(row.counts, "RUNNING")}</dd></div><div><dt>失败</dt><dd>${count(row.counts, "FAILED")}</dd></div><div><dt>未知</dt><dd>${count(row.counts, "UNKNOWN")}</dd></div></dl></article>`,
          )
          .join("")}</div>`,
    ) +
    section(
      attemptId ? "指定执行记录" : "执行记录",
      table(
        ["商品 / 渠道", "动作", "状态", "实际结果", "操作"],
        visible.map((attempt) => [
          `<a href="#/items/${attempt.item.id}?tab=use">TM${String(attempt.item.serial).padStart(6, "0")} ${esc(attempt.item.title)}</a><small>${esc(attempt.channel.name)}</small>`,
          esc(attempt.action),
          `${esc(states[attempt.state] || attempt.state)}<small>第 ${attempt.attemptCount} 次 · ${when(attempt.finishedAt || attempt.createdAt)}</small>`,
          attempt.remoteId
            ? `${esc(attempt.remoteId)}${attempt.remoteUrl ? `<small>${esc(attempt.remoteUrl)}</small>` : ""}`
            : attempt.errorCode
              ? `${esc(attempt.errorCode)}<small>${esc(attempt.errorMessage)}</small>`
              : "尚无稳定远端编号",
          attempt.state === "FAILED"
            ? button("重新计划原记录", () =>
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
      ) + (!visible.length ? "<p>当前筛选下没有分发执行记录。</p>" : ""),
    )
  );
}
