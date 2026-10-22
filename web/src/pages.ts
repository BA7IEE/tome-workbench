import {
  recordFilters,
  recordParams,
  recordPaging,
  recordContext,
} from "./record-controls";
import { viewDialog, dialog, ApiError } from "./core";
import { editChannel, platformNames, setupChannel } from "./channel-setup";
import { onPageReady } from "./page-lifecycle";
import { logsPage } from "./logs-page";
import { chooseInquiryItem } from "./inquiry-form";
import {
  request,
  reload,
  can,
  me,
  esc,
  money,
  when,
  code,
  button,
  field,
  area,
  select,
  check,
  text,
  iso,
  form,
  empty,
  note,
  table,
  section,
  itemLink,
  observed,
} from "./core";
import { states } from "./types";
import type { Listing, Inquiry, Channel, User } from "./types";
interface WorkQueueRow {
  id: string;
  entityId: string;
  kind:
    | "CANDIDATE"
    | "TASK"
    | "OBSERVATION"
    | "DISTRIBUTION"
    | "INQUIRY"
    | "ITEM_REVIEW";
  priority: number;
  title: string;
  detail: string;
  href: string;
  action: string;
  createdAt: string;
  item?: { id: string; serial: number; title: string };
  task?: { kind: string; assignee: string; note: string };
}
interface WorkQueue {
  total: number;
  page: number;
  size: number;
  summary: {
    total: number;
    candidates: number;
    tasks: number;
    itemReviews: number;
    observations: number;
    distribution: number;
    inquiries: number;
  };
  rows: WorkQueueRow[];
}
const workKindNames: Record<WorkQueueRow["kind"], string> = {
  CANDIDATE: "商品待确认",
  TASK: "商品任务",
  OBSERVATION: "事实核对",
  DISTRIBUTION: "上架处理",
  INQUIRY: "客户跟进",
  ITEM_REVIEW: "商品资料确认",
};
function taskControl(row: WorkQueueRow) {
  if (row.kind !== "TASK" || !row.task || !can("edit")) return "";
  const delist = row.task.kind === "DELIST";
  return button(delist ? "分派 / 备注" : "分派 / 记录", () =>
    form(
      delist ? "更新渠道下架任务" : "更新商品任务",
      (delist
        ? note(
            "实际下架必须先到对应商品/渠道完成并登记回执；这里不能直接把下架任务勾成已完成。",
          )
        : "") +
        field("assignee", "负责人", row.task!.assignee) +
        (delist
          ? ""
          : select(
              "status",
              "状态",
              { OPEN: "待处理", DONE: "人工完成" },
              "OPEN",
            )) +
        area("note", "工作记录", row.task!.note),
      (d, k) =>
        request(
          `/tasks/${row.entityId}`,
          "POST",
          {
            status: delist ? "OPEN" : text(d, "status"),
            assignee: text(d, "assignee"),
            note: text(d, "note"),
          },
          k,
        ),
    ),
  );
}
export async function tasksPage() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    scope = qs.get("scope") || "IMPORTANT",
    q = (qs.get("q") || "").trim();
  const page = Math.max(1, Number(qs.get("page") || 1));
  const queue = await request<WorkQueue>(
    "/work-queue?" +
      new URLSearchParams({ scope, q, page: String(page), size: "60" }),
  );
  const s = queue.summary;
  const visible = queue.rows;
  onPageReady("work-queue-filter", (el, signal) => {
    el.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const d = new FormData(event.currentTarget as HTMLFormElement),
          next = new URLSearchParams(),
          nextScope = String(d.get("scope") || "IMPORTANT"),
          nextQ = String(d.get("q") || "").trim();
        if (nextScope !== "IMPORTANT") next.set("scope", nextScope);
        if (nextQ) next.set("q", nextQ);
        location.hash = "/tasks" + (next.toString() ? "?" + next : "");
      },
      { signal },
    );
  });
  const scopeOptions = {
    IMPORTANT: "先处理：立即 / 优先",
    ALL: "全部事项",
    TASK: "商品任务",
    CANDIDATE: "待确认商品",
    ITEM_REVIEW: "待确认商品资料",
    DISTRIBUTION: "分发异常",
    INQUIRY: "客户跟进",
      OBSERVATION: "事实核对",
  };
  return (
    `<div class="page-title"><div><h1>待处理事项</h1><p>点一项直接处理对应记录。同一商品可以有多项；来源入库与商品资料确认分别处理。</p></div><div class="button-row"><a class="btn" href="#/candidates">待确认商品</a><a class="btn" href="#/items">商品库</a></div></div>` +
    `<form id="work-queue-filter" class="admin-filter-form">${select("scope", "查看范围", scopeOptions, scope)}${field("q", "搜索事项 / 商品", q)}<button class="btn primary">筛选</button><a class="btn" href="#/tasks">重置</a></form>` +
    section(
      `按优先级处理 · ${queue.total}项`,
      note(
        `渠道下架和事实冲突优先于常规资料维护；同一优先级内先处理等待更久的事项。`,
      ) +
        `<div class="work-queue-table">${
          !visible.length
            ? `<div class="empty"><h2>${q ? "没有匹配的待办" : scope === "IMPORTANT" ? "当前没有需要优先处理的事项" : "当前范围内没有待办"}</h2><p>${s.total ? "可切换到全部事项，或继续维护商品资料。" : "新增询盘、商品任务等会自动汇总到这里。"}</p><div class="button-row"><a class="btn" href="#/tasks?scope=ALL">查看全部事项</a><a class="btn" href="#/items">维护商品</a></div></div>`
            : table(
                ["优先级", "事项", "业务对象", "进入处理", "记录"],
                visible.map((row) => [
                  row.priority >= 90
                    ? "立即"
                    : row.priority >= 70
                      ? "优先"
                      : "常规",
                  `${esc(workKindNames[row.kind])}<small>${esc(row.title)}</small>`,
                  `${esc(row.detail)}<small>${when(row.createdAt)}</small>`,
                  `<a class="btn ${row.priority >= 90 ? "primary" : ""}" href="${esc(row.href)}">${esc(row.action)}</a>`,
                  taskControl(row),
                ]),
              )
        }</div>` +
        recordPaging("tasks", qs, queue),
    )
  );
}
export async function listingsPage() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const result = await request<{
    rows: Listing[];
    total: number;
    page: number;
    size: number;
  }>("/listings?" + recordParams(qs));
  const listings = result.rows;
  return (
    section(
      "远端身份记录",
      recordFilters("listings", qs, "listings") +
        recordContext(qs, "listings") +
        note(
          "这里只保留已取得稳定远端ID的身份记录。实际发布、待更新、异常和需停售状态请到“渠道上架”查看；平台发布和下架仍由外部操作者实际执行。",
        ) +
        table(
          ["商品", "渠道", "平台商品ID", "应有状态", "实际状态", "操作"],
          listings.map((l) => [
            itemLink(l.itemId, code(l.item!.serial) + " " + l.item!.title),
            esc(l.channel.name),
            esc(l.remoteId),
            esc(states[l.desired]),
            `${esc(states[l.observed] || l.observed)}<small>${when(l.observedAt)}</small>`,
            can("publish") ? button("登记已下架", () => observed(l.id)) : "",
          ]),
        ),
    ) +
    recordPaging("listings", qs, result) +
    (!listings.length
      ? '<p><a class="btn" href="#/items">从商品准备上架</a></p>'
      : "")
  );
}
export async function inquiriesPage() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const result = await request<{
    rows: Inquiry[];
    total: number;
    page: number;
    size: number;
  }>("/inquiries?" + recordParams(qs));
  const rows = result.rows;
  const context =
    recordFilters("inquiries", qs, "inquiries") +
    recordContext(qs, "inquiries");
  return (
    section(
      "询盘与跟进",
      note(
        "需要时按TM号记录客户沟通；不影响正常入库、编辑或卖货。确认成交后会同步停售库存，并保留各渠道的下架待处理记录。",
      ) +
        button("记录询盘", () => chooseInquiryItem(reload), "primary") +
        context +
        table(
          ["商品", "渠道 / 客户", "报价", "记录", "状态", "下次跟进", "操作"],
          rows.map((i) => [
            itemLink(i.item.id, code(i.item.serial) + " " + i.item.title),
            `${esc(i.channel)}<small>${esc(i.customerRef)}</small>`,
            money(i.quote, i.currency),
            esc(i.notes) + button("沟通历史", () => inquiryHistory(i.id)),
            esc(states[i.state] || i.state),
            i.state === "FOLLOWUP" ? when(i.nextFollowUpAt) : "—",
            i.state === "WON"
              ? "已转化成交"
              : button("更新跟进", () => followInquiry(i)) +
                (i.state === "LOST"
                  ? ""
                  : button("确认成交", () => convertInquiry(i), "primary")),
          ]),
        ),
    ) +
    recordPaging("inquiries", qs, result) +
    (!rows.length ? note("暂时没有客户跟进记录。") : "")
  );
}
async function historyHtml(id: string) {
  const h = await request<{
    initial: string;
    rows: {
      at: string;
      detail: {
        notes: string;
        state: string;
        actorName?: string;
        nextFollowUpAt?: string | null;
      };
    }[];
  }>(`/inquiries/${id}/history`);
  return (
    `<p>初次记录：${esc(h.initial || "未填写")}</p>` +
    h.rows
      .map(
        (r) =>
          `<article><small>${when(r.at)} · ${esc(r.detail.actorName || "历史记录")} · ${esc(states[r.detail.state] || r.detail.state)}${r.detail.nextFollowUpAt ? " · 下次跟进 " + when(r.detail.nextFollowUpAt) : ""}</small><p>${esc(r.detail.notes || "仅更新进度")}</p></article>`,
      )
      .join("")
  );
}
async function inquiryHistory(id: string) {
  viewDialog("沟通历史", await historyHtml(id));
}
async function followInquiry(i: Inquiry) {
  let version = i.version,
    changed = false;
  const history = await historyHtml(i.id);
  form(
    "更新询盘",
    select(
      "state",
      "进度",
      { OPEN: "待跟进", FOLLOWUP: "跟进中", LOST: "未成交" },
      i.state,
    ) +
      field(
        "nextFollowUpAt",
        "下次跟进时间",
        localDateTime(i.nextFollowUpAt),
        "datetime-local",
      ) +
      note("选择“跟进中”时必须填写下次跟进时间；每次沟通独立保留。") +
      area("notes", "沟通记录 / 流失原因", "") +
      `<div data-inquiry-conflict></div><details><summary>沟通历史</summary>${history}</details>`,
    async (d, k) => {
      if (changed && !d.has("acceptLatest"))
        throw new Error("请先核对最新记录并勾选确认，你的输入已保留。");
      try {
        const state = text(d, "state");
        const nextFollowUpAt = text(d, "nextFollowUpAt");
        if (state === "FOLLOWUP" && !nextFollowUpAt)
          throw new Error("请选择下次跟进时间");
        return await request(
          `/inquiries/${i.id}/status`,
          "POST",
          {
            version,
            state,
            notes: text(d, "notes"),
            nextFollowUpAt:
              state === "FOLLOWUP" ? iso(d.get("nextFollowUpAt")) : null,
          },
          k,
        );
      } catch (e) {
        if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
          const latest = await request<Inquiry[]>(`/inquiries?id=${i.id}`);
          version = latest[0].version;
          changed = true;
          dialog.querySelector<HTMLSelectElement>('[name="state"]')!.value =
            latest[0].state;
          dialog.querySelector<HTMLInputElement>(
            '[name="nextFollowUpAt"]',
          )!.value = localDateTime(latest[0].nextFollowUpAt);
          dialog.querySelector("[data-inquiry-conflict]")!.innerHTML =
            `<div class="notice warning"><strong>最新进度：${esc(states[latest[0].state] || latest[0].state)}</strong>${await historyHtml(i.id)}${check("acceptLatest", "已核对最新沟通，保留本次输入继续提交")}</div>`;
        }
        throw e;
      }
    },
    "保存",
  );
}
function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function convertInquiry(i: Inquiry) {
  form(
    "确认询盘成交",
    note(
      "将锁定商品、创建成交记录、把商品停售并将本询盘标为已转化。只记录实际成交与库存，不需要记账；此操作不会收款。",
    ) +
      field("externalKey", "外部订单唯一键（可留空）") +
      area("note", "成交说明", "", 3),
    (d, key) =>
      request(
        `/inquiries/${i.id}/convert`,
        "POST",
        {
          version: i.version,
          ...(text(d, "externalKey")
            ? { externalKey: text(d, "externalKey") }
            : {}),
          note: text(d, "note"),
        },
        key,
      ),
    "确认成交并停售",
  );
}
const roleLabels: Record<string, string> = {
  ADMIN: "管理员",
  REVIEWER: "专业复核",
  OPERATOR: "日常运营",
  FINANCE: "经营财务",
  VIEWER: "只读",
};
export async function settingsPage() {
  const currentSection = new URLSearchParams(location.hash.split("?")[1] || "").get("section");
  const channels = currentSection === "channels" ? await request<Channel[]>("/channels") : [];
  const users = currentSection === "users" && can("users") ? await request<User[]>("/auth/users") : [];
  let html = section(
    "个人账户",
    `<p>${esc(me?.name)} · ${esc(me?.email)} · ${esc(states[me?.role || ""] || "内部账户")}</p>`,
    button("修改自己的密码", () =>
      form(
        "修改密码",
        field("current", "原密码", "", "password", true) +
          field(
            "next",
            "新密码（至少12位）",
            "",
            "password",
            true,
            'minlength="12"',
          ),
        (d, k) =>
          request(
            "/auth/password",
            "POST",
            { current: text(d, "current"), next: text(d, "next") },
            k,
          ),
        "修改并退出",
        async () => {
          location.reload();
        },
      ),
    ),
  );
  const channelSettings = section(
    "渠道账号",
    note(
      "标题上限是本项目的操作配置，不代表已经核实该平台最新规则。全渠道使用同一个TM号。自有展厅指本系统提供的商品展示页面。",
    ) +
      table(
        ["账号", "平台", "语言", "默认币种", "标题字符上限", "状态", "操作"],
        channels.map((c) => [
          esc(c.name),
          esc(platformNames[c.platform] || "其他渠道"),
          esc(c.locale === "en" ? "英文" : "中文"),
          esc(c.defaultCurrency),
          String(c.titleLimit),
          c.active ? "启用" : "已停用",
          can("users") ? button("修改 / 停用", () => editChannel(c)) : "",
        ]),
      ),
    can("users") ? button("＋ 创建渠道", () => setupChannel()) : "",
  );
  const userSettings = can("users") ? section(
      "用户与权限",
      table(
        ["姓名", "登录名", "角色", "状态", "操作"],
        users.map((u) => [
          esc(u.name),
          esc(u.email),
          esc(roleLabels[u.role] || "内部角色"),
          u.active ? "启用" : "停用",
          u.id === me?.id
            ? "当前账户"
            : button("权限 / 停用", () =>
                form(
                  "调整账户权限",
                  select(
                    "role",
                    "角色",
                    {
                      ADMIN: "管理员",
                      REVIEWER: "专业复核",
                      OPERATOR: "日常运营",
                      FINANCE: "经营财务",
                      VIEWER: "只读",
                    },
                    u.role,
                  ) + check("active", "启用账户", u.active),
                  (d, k) =>
                    request(
                      "/auth/user-access",
                      "POST",
                      {
                        id: u.id,
                        role: text(d, "role"),
                        active: d.has("active"),
                      },
                      k,
                    ),
                ),
              ),
        ]),
      ),
      button("＋ 创建用户", () =>
        form(
          "创建内部用户",
          field("name", "姓名", "", "text", true) +
            field("email", "登录邮箱", "", "email", true) +
            field(
              "password",
              "初始密码（至少12位）",
              "",
              "password",
              true,
              'minlength="12"',
            ) +
            select(
              "role",
              "角色",
              {
                OPERATOR: "日常运营",
                REVIEWER: "专业复核",
                FINANCE: "经营财务",
                VIEWER: "只读",
                ADMIN: "管理员",
              },
              "OPERATOR",
            ),
          (d, k) =>
            request(
              "/auth/users",
              "POST",
              {
                name: text(d, "name"),
                email: text(d, "email"),
                password: text(d, "password"),
                role: text(d, "role"),
              },
              k,
            ),
        ),
      ),
    ) : "";
  html += section(
    "系统能力",
    note(
      "联网AI、第三方自动发布、支付及最终结算目前未启用。已有AI文案仍需人工确认；私有原图和经营资料不会公开展示。",
    ) +
      `<details class="technical-details"><summary>技术维护</summary><div class="button-row"><a class="btn" href="/api/system/openapi" target="_blank" rel="noopener">API接口说明</a>${can("users") ? '<a class="btn" href="#/jobs">后台任务</a>' : ""}${can("audit") ? '<a class="btn" href="#/audit">操作记录</a>' : ""}</div></details>`,
  );
  if (currentSection === "channels") return '<a class="btn" href="#/settings">返回设置</a>' + channelSettings;
  if (currentSection === "users" && can("users")) return '<a class="btn" href="#/settings">返回设置</a>' + userSettings;
  return html + '<div class="button-row"><a class="btn" href="#/settings?section=channels">渠道账号设置</a>' +
    (can("users") ? '<a class="btn" href="#/settings?section=users">账户与权限设置</a>' : '') + '</div>';
}
export async function jobsPage() {
  return logsPage(true);
}
export async function auditPage() {
  return logsPage(false);
}
export async function showroomPage() {
  const rows = await request<
    {
      id: string;
      code: string;
      title: string;
      body: string;
      price: number | null;
      currency: string;
      assets: { id: string }[];
    }[]
  >("/showroom");
  return `<div class="showroom"><header><a href="/">ToMeBoutique <span>兔泥巴</span></a><small>CURATED PRE-OWNED · 商品展厅</small></header><div class="showroom-intro"><div class="eyebrow">SELECTED, WITH A STORY.</div><h1>被认真挑选，值得再次珍藏。</h1><p>以下为明确批准且仍有效的商品资料。此页仅供展示，不提供在线支付。</p></div><div class="showroom-grid">${rows.map((r) => `<article>${r.assets[0] ? `<img src="/api/showroom/${r.id}/image/${r.assets[0].id}" alt="${esc(r.title)}">` : ""}<div class="eyebrow">${esc(r.code)}</div><h2>${esc(r.title)}</h2><strong>${money(r.price, r.currency)}</strong><details><summary>查看商品说明</summary><div class="copy">${esc(r.body)}</div></details></article>`).join("")}</div>${rows.length ? "" : empty("暂时没有已批准且仍有效的展厅商品")}<footer>ToMeBoutique · 本页不构成库存锁定或交付承诺。</footer></div>`;
}
