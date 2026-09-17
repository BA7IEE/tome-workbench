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
import { onPageReady } from "./page-lifecycle";
import { recordPaging } from "./record-controls";

type Attempt = {
  id: string;
  action: string;
  state: string;
  sourceAttemptId: string | null;
  remoteId: string;
  remoteUrl: string;
  errorCode: string;
  errorMessage: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type Operation = {
  id: string;
  state: string;
  item: { id: string; serial: number; title: string; brand: string; status: string };
  channel: { id: string; name: string; platform: string; active: boolean };
  attempt: Attempt | null;
  published: Attempt | null;
  listing: {
    id: string;
    remoteId: string;
    url: string;
    desired: string;
    observed: string;
    observedAt: string;
  } | null;
  missing: { code: string; title: string }[];
  health: {
    state: "CURRENT" | "NEEDS_UPDATE" | "MUST_STOP";
    reasons: { code: string; title: string }[];
  } | null;
  updatedAt: string;
};

type Operations = {
  rows: Operation[];
  total: number;
  page: number;
  size: number;
  summary: {
    total: number;
    states: Record<string, number>;
    channels: {
      channel: { id: string; name: string; platform: string; active: boolean };
      counts: Record<string, number>;
    }[];
  };
};

type Channel = { id: string; name: string; platform: string; active: boolean };

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

const operationStates: Record<string, string> = {
  READY: "未发布",
  BLOCKED: "缺资料",
  PENDING: "待交付",
  HANDED_OFF: "已交付",
  PUBLISHED: "已发布",
  NEEDS_UPDATE: "待更新",
  ATTENTION: "异常",
  NEEDS_STOP: "需停售",
  CANCELLED: "已取消",
};

const actionLabels: Record<string, string> = {
  PUBLISH: "发布资料",
  UPDATE: "更新资料",
  DELIST: "停售资料",
};

function recordManualResult(attempt: Attempt, title: string) {
  const reconciliation = attempt.state === "UNKNOWN";
  form(
    `${title} · 登记分发结果`,
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

function operationLabel(row: Operation) {
  if (
    row.state === "ATTENTION" &&
    row.attempt?.errorCode.startsWith("HANDOFF_")
  )
    return "交付需核对";
  if (row.state === "ATTENTION" && row.attempt)
    return handoffStates[row.attempt.state] || operationStates[row.state];
  return operationStates[row.state] || row.state;
}

function operationAction(row: Operation) {
  const attempt = row.attempt;
  if (attempt?.state === "FAILED")
    return button("重新交付原记录", () =>
      request(`/distribution/attempts/${attempt.id}/retry`, "POST", {}),
    );
  if (attempt && ["PENDING", "RUNNING", "UNKNOWN"].includes(attempt.state))
    return button(
      attempt.state === "UNKNOWN" ? "核对结果" : "登记结果",
      () => recordManualResult(attempt, row.item.title),
    );
  if (["READY", "BLOCKED", "NEEDS_UPDATE"].includes(row.state))
    return `<a class="btn" href="#/items/${row.item.id}?tab=use">维护资料</a>`;
  return row.state === "NEEDS_STOP"
    ? "等待外部执行方回填停售结果"
    : "已记录";
}

function resultSummary(row: Operation) {
  if (
    row.health?.reasons.length &&
    ["NEEDS_STOP", "NEEDS_UPDATE"].includes(row.state)
  )
    return row.health.reasons.map((reason) => esc(reason.title)).join("；");
  const attempt = row.attempt || row.published;
  if (!attempt)
    return row.missing.length
      ? row.missing.map((entry) => esc(entry.title)).join("；")
      : "尚未生成冻结资料";
  if (attempt.remoteId)
    return `${esc(attempt.remoteId)}${attempt.remoteUrl ? `<small>${esc(attempt.remoteUrl)}</small>` : ""}`;
  if (row.listing?.remoteId)
    return `${esc(row.listing.remoteId)}<small>${esc(row.listing.desired === "LIVE" ? "已知稳定远端身份" : "历史稳定远端身份")}</small>`;
  if (attempt.errorCode)
    return `${esc(attempt.errorCode)}<small>${esc(attempt.errorMessage)}</small>`;
  return attempt.state === "SUCCEEDED"
    ? "已确认完成；无稳定远端编号，按永久 TM 核对"
    : "尚无稳定远端编号回传";
}

function summaryCard(
  channel: Operations["summary"]["channels"][number],
  scope: string,
  label: string,
  state: string,
) {
  return `<a href="#/distribution?scope=${scope}&channelId=${channel.channel.id}"><dt>${label}</dt><dd>${count(channel.counts, state)}</dd></a>`;
}

export async function distributionCenter() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    attemptId = qs.get("attemptId") || "",
    rawState = qs.get("state") || "",
    legacyScope =
      rawState === "UNKNOWN" || rawState === "FAILED"
        ? "attention"
        : rawState === "PENDING"
          ? "pending"
          : rawState === "RUNNING"
            ? "handed-off"
            : rawState === "SUCCEEDED"
              ? "published"
              : "",
    scope = qs.get("scope") || legacyScope || "all",
    channelId = qs.get("channelId") || "",
    q = qs.get("q") || "",
    brand = qs.get("brand") || "",
    page = Math.max(1, Number(qs.get("page") || 1)),
    size = [25, 50, 100].includes(Number(qs.get("size")))
      ? Number(qs.get("size"))
      : 50;
  const params = new URLSearchParams({
    scope,
    page: String(page),
    size: String(size),
    ...(channelId ? { channelId } : {}),
    ...(q ? { q } : {}),
    ...(brand ? { brand } : {}),
    ...(attemptId ? { attemptId } : {}),
  });
  const [operations, channels] = await Promise.all([
    request<Operations>("/distribution/operations?" + params),
    request<Channel[]>("/channels"),
  ]);
  onPageReady("distribution-filter", (el, signal) => {
    el.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget as HTMLFormElement),
          next = new URLSearchParams(),
          nextScope = text(formData, "scope"),
          nextChannelId = text(formData, "channelId"),
          nextQ = text(formData, "q").trim(),
          nextBrand = text(formData, "brand").trim(),
          nextSize = text(formData, "size");
        if (nextScope !== "all") next.set("scope", nextScope);
        if (nextChannelId) next.set("channelId", nextChannelId);
        if (nextQ) next.set("q", nextQ);
        if (nextBrand) next.set("brand", nextBrand);
        if (nextSize !== "50") next.set("size", nextSize);
        location.hash = "/distribution" + (next.toString() ? "?" + next : "");
      },
      { signal },
    );
  });
  const scopeOptions = {
    all: "全部经营状态",
    unpublished: "未发布（含待交付）",
    ready: "未发布",
    blocked: "缺资料",
    pending: "待交付",
    "handed-off": "已交付",
    published: "已发布",
    "needs-update": "待更新",
    attention: "异常 / 需要核对",
    "needs-stop": "需停售",
    cancelled: "已取消",
  };
  const channelOptions = {
    "": "全部渠道账号",
    ...Object.fromEntries(
      channels.map((channel) => [
        channel.id,
        `${channel.name} · ${channel.platform}${channel.active ? "" : "（已停用）"}`,
      ]),
    ),
  };
  return (
    section(
      "商品分发",
      note(
        "这里从商品、资料就绪度、冻结使用包和分发记录实时汇总经营状态。外部 Agent、脚本或人工负责平台操作；系统不保存第三方凭据，也不会直接调用平台。APP 没有稳定 ID 时，仍可按标题中的永久 TM 核对。",
      ) +
        `<div class="distribution-summary">${operations.summary.channels
          .map(
            (channel) =>
              `<article class="panel"><h3>${esc(channel.channel.name)}</h3><p>${esc(channel.channel.platform)} · ${channel.channel.active ? "已启用" : "已停用"}</p><dl>${summaryCard(channel, "ready", "未发布", "READY")}${summaryCard(channel, "blocked", "缺资料", "BLOCKED")}${summaryCard(channel, "pending", "待交付", "PENDING")}${summaryCard(channel, "handed-off", "已交付", "HANDED_OFF")}${summaryCard(channel, "published", "已发布", "PUBLISHED")}${summaryCard(channel, "needs-update", "待更新", "NEEDS_UPDATE")}${summaryCard(channel, "attention", "异常", "ATTENTION")}${summaryCard(channel, "needs-stop", "需停售", "NEEDS_STOP")}</dl></article>`,
          )
          .join("")}</div>`,
    ) +
    `<form id="distribution-filter" class="admin-filter-form">${select("scope", "经营状态", scopeOptions, scope)}${select("channelId", "渠道账号", channelOptions, channelId)}${field("brand", "品牌", brand, "text", false, 'placeholder="按品牌筛选"')}${field("q", "搜索 TM / 商品", q, "text", false, 'placeholder="TM、名称或品牌"')}${select("size", "每页", { "25": "25 条", "50": "50 条", "100": "100 条" }, String(size))}<button class="btn primary">筛选</button><a class="btn" href="#/distribution">重置</a></form>` +
    section(
      attemptId ? "指定分发记录" : `经营投影 · ${operations.total}项`,
      table(
        ["商品 / 渠道", "资料动作", "经营状态", "回传 / 缺项", "操作"],
        operations.rows.map((row) => {
          const record = row.attempt || row.published;
          return [
            `<a href="#/items/${row.item.id}?tab=use">TM${String(row.item.serial).padStart(6, "0")} ${esc(row.item.title)}</a><small>${esc(row.channel.name)} · ${esc(row.item.brand || "品牌待补")}</small>`,
            record
              ? `${esc(actionLabels[record.action] || record.action)}${record.action === "DELIST" && record.sourceAttemptId ? "<small>对应已确认的发布资料</small>" : ""}`
              : "尚未生成交付资料",
            `${esc(operationLabel(row))}<small>${record ? handoffStates[record.state] || record.state : when(row.updatedAt)}</small>`,
            resultSummary(row),
            operationAction(row),
          ];
        }),
      ) +
        (!operations.rows.length
          ? "<p>当前筛选下没有经营分发事项。</p>"
          : "") +
        (attemptId ? "" : recordPaging("distribution", qs, operations)),
    )
  );
}
