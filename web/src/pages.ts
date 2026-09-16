import {
  recordFilters,
  recordParams,
  recordPaging,
  recordContext,
} from "./record-controls";
import { viewDialog, dialog, ApiError } from "./core";
import { editChannel } from "./channel-setup";
import { platformNames } from "./channel-setup";
import { onPageReady } from "./page-lifecycle";
import { logsPage } from "./logs-page";
import {
  request,
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
  currencies,
  text,
  cents,
  form,
  empty,
  note,
  table,
  section,
  itemLink,
  downloadJson,
  observed,
} from "./core";
import { states } from "./types";
import type { Listing, Sale, Inquiry, Channel, User } from "./types";
interface WorkQueueRow {
  id: string;
  entityId: string;
  kind:
    | "CANDIDATE"
    | "TASK"
    | "OBSERVATION"
    | "DISTRIBUTION"
    | "INQUIRY"
    | "SALE_FINANCE";
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
    observations: number;
    distribution: number;
    inquiries: number;
    saleFinance: number;
  };
  rows: WorkQueueRow[];
}
const workKindNames: Record<WorkQueueRow["kind"], string> = {
  CANDIDATE: "商品待确认",
  TASK: "商品任务",
  OBSERVATION: "事实核对",
  DISTRIBUTION: "分发执行",
  INQUIRY: "客户跟进",
  SALE_FINANCE: "成交补账",
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
  const metrics = [
    ["全部待处理", s.total, "按业务风险和时效统一排序"],
    ["商品待确认", s.candidates, "Agent采集后等待人工生成TM"],
    ["分发异常", s.distribution, "结果未知优先按 TM 核对，再处理明确失败"],
    ["客户跟进", s.inquiries, "新询盘与跟进中询盘"],
    ["成交补账", s.saleFinance, "缺成交额、成本、费用或到账确认"],
    ["事实冲突", s.observations, "库存或经营事实需要人工核对"],
  ];
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
    DISTRIBUTION: "分发异常",
    INQUIRY: "客户跟进",
    SALE_FINANCE: "成交补账",
    OBSERVATION: "事实核对",
  };
  return (
    `<div class="page-title"><div><h1>经营待办</h1><p>系统从真实业务记录中汇总“下一步要做什么”；默认只展示真正需要先处理的事项，常规候选可进入待确认商品批量处理。</p></div><div class="button-row"><a class="btn" href="#/candidates">待确认商品</a><a class="btn" href="#/items">商品库</a></div></div>` +
    `<div class="metrics compact">${metrics
      .map(
        ([label, value, sub]) =>
          `<article class="metric"><span>${esc(label)}</span><strong>${value}</strong><small>${esc(sub)}</small></article>`,
      )
      .join("")}</div>` +
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
      "渠道发布记录",
      recordFilters("listings", qs, "listings") +
        recordContext(qs, "listings") +
        note(
          "平台发布和下架仍由操作人员实际执行。这里记录平台商品ID、系统希望的状态和你最后确认的实际状态；下载资料不会自动记成已发布。",
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
      ? '<p><a class="btn" href="#/items">从商品准备发布</a></p>'
      : "")
  );
}
function editFinance(s: Sale) {
  form(
    "补齐成交收支 · " + s.code,
    note(
      "金额以本次交易币种记账。留空表示未知，不等于0。取得成本需要根据采购/供货凭据确认；不自动套用最新供应商报价。",
    ) +
      field("amount", "成交总额", s.amount == null ? "" : s.amount / 100) +
      field("cost", "本次取得成本", s.cost == null ? "" : s.cost / 100) +
      field("fees", "本次直接费用合计", s.fees == null ? "" : s.fees / 100) +
      select("currency", "交易币种", currencies, s.currency) +
      check("paid", "已核对实际到账", s.paid) +
      area("note", "核对凭据、费用构成与备注", s.note),
    (d, k) =>
      request(
        `/sales/${s.id}/finance`,
        "POST",
        {
          version: s.version,
          amount: cents(d.get("amount")),
          cost: cents(d.get("cost")),
          fees: cents(d.get("fees")),
          currency: text(d, "currency"),
          paid: d.has("paid"),
          note: text(d, "note"),
        },
        k,
      ),
  );
}
export async function salesPage() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    dataMode = qs.get("dataMode") === "TEST" ? "TEST" : "BUSINESS";
  const result = await request<{
    rows: Sale[];
    total: number;
    page: number;
    size: number;
    summary: {
      totals: Record<string, number>;
      pending: number;
      excluded: number;
    };
  }>("/sales?" + recordParams(qs));
  const sales = result.rows,
    { totals, pending, excluded } = result.summary;
  const summary = `<div class="metrics compact">${Object.entries(totals)
    .map(
      ([c, n]) =>
        `<article class="metric"><span>${esc(c)} 已核对合作贡献</span><strong class="amount">${money(n, c)}</strong></article>`,
    )
    .join(
      "",
    )}<article class="metric"><span>待补或待核对</span><strong>${pending}</strong></article><article class="metric"><span>不计入合作</span><strong>${excluded}</strong></article></div>`;
  return (
    recordFilters("sales", qs, "sales") +
    recordContext(qs, "sales") +
    (dataMode === "TEST"
      ? note(
          "以下仅为测试记录，保留历史金额供检查，不计入正式合作对账。商品已归档时不能继续补款或退款。",
        )
      : "") +
    section(
      "经营账",
      note(
        "此页不是最终季度结算，不自动打款。不同币种分开显示；缺少金额、成本、费用或到账确认的记录不计入合计。全额退款并完好回收后原销售成本冲回，再售重新应用。",
      ) +
        summary +
        table(
          [
            "商品 / 时间",
            "渠道与客户",
            "成交 / 退款",
            "成本 / 费用",
            "合作归属 / 项目贡献",
            "操作",
          ],
          sales.map((s) => [
            `${itemLink(s.itemId, s.code + " " + s.item.title)}<small>${when(s.soldAt)}</small>`,
            `${esc(s.channel)}<small>${esc(s.customerRef)}</small>`,
            `${money(s.amount, s.currency)}<small>已退 ${money(s.refunded, s.currency)} · ${s.paid ? "到账已确认" : "到账待确认"}</small>`,
            `${money(s.cost, s.currency)}<small>直接费用 ${money(s.fees, s.currency)}</small>`,
            `${esc(states[s.cooperation] || s.cooperation)}<small>${s.contribution.value === null ? "不计入合计" : money(s.contribution.value, s.currency)}${s.returned ? " · 已回收" : ""}</small>`,
            `<div class="sale-actions">${button("补收支", () => editFinance(s))}<details class="catalog-row-menu sale-row-menu"><summary class="btn subtle">更多</summary><div>${
              can("users")
                ? button("核对合作归属", () =>
                    form(
                      "记录人工合作归属判定",
                      note(
                        "默认纳入；仅对有明确约定依据的交易调整。会记录修改前后状态、原因与规则来源，不代表已经完成季度结算。",
                      ) +
                        select(
                          "cooperation",
                          "本次交易",
                          { INCLUDED: "计入合作", EXCLUDED: "不计入合作" },
                          s.cooperation === "EXCLUDED"
                            ? "EXCLUDED"
                            : "INCLUDED",
                        ) +
                        field(
                          "ruleReference",
                          "实际采用的协议 / 约定依据",
                          "",
                          "text",
                          true,
                        ) +
                        area("reason", "核对理由") +
                        check("confirmed", "已核对适用范围和事实"),
                      (d, k) => {
                        if (!d.has("confirmed"))
                          throw new Error("请先确认核对结果");
                        return request(
                          `/sales/${s.id}/classify`,
                          "POST",
                          {
                            version: s.version,
                            cooperation: text(d, "cooperation"),
                            ruleReference: text(d, "ruleReference"),
                            reason: text(d, "reason"),
                            confirmed: true,
                          },
                          k,
                        );
                      },
                    ),
                  )
                : ""
            }${button("记录退款", () => form("记录退款", note("只登记已经发生的退款，不实际调用支付平台。累计金额不能超过成交额。") + field("amount", "本次退款金额", "", "text", true) + area("reason", "退款原因与凭据"), (d, k) => request(`/sales/${s.id}/refund`, "POST", { amount: cents(d.get("amount")), reason: text(d, "reason") }, k)))}${
              !s.returned
                ? button("确认完好退回", () =>
                    form(
                      "确认全额退款并完好收回",
                      note(
                        "本版仅对“已全额退款、同件商品完整回收”自动恢复成本。确认后进入待复检，不自动可售。",
                      ) +
                        area("evidence", "实物身份、附件、品相与签收依据") +
                        check("intact", "确认是原商品，实物及附件完整回收"),
                      (d, k) => {
                        if (!d.has("intact"))
                          throw new Error("未确认完整回收，不能执行此操作");
                        return request(
                          `/sales/${s.id}/return`,
                          "POST",
                          { intact: true, evidence: text(d, "evidence") },
                          k,
                        );
                      },
                    ),
                  )
                : '<span class="sale-returned">已回收</span>'
            }</div></details></div>`,
          ]),
        ),
      button("导出当前页", () => downloadJson("经营账_当前页.json", sales)) +
        button("导出全部匹配记录", async () => {
          const p = recordParams(qs);
          p.set("export", "1");
          const all = await request<{
            rows: Sale[];
            total: number;
            summary: unknown;
          }>("/sales?" + p);
          downloadJson("经营账_全部匹配记录.json", {
            filters: Object.fromEntries(p),
            ...all,
          });
        }),
    ) +
    recordPaging("sales", qs, result) +
    (!sales.length
      ? '<p><a class="btn" href="#/items">从商品登记售出</a></p>'
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
        "在商品工作区点击“记录询盘”即可登记。确认成交会原子写入 Sale、停售商品并生成已分发渠道的下架执行记录；不是单纯改一个状态。",
      ) +
        context +
        table(
          ["商品", "渠道 / 客户", "报价", "记录", "状态", "操作"],
          rows.map((i) => [
            itemLink(i.item.id, code(i.item.serial) + " " + i.item.title),
            `${esc(i.channel)}<small>${esc(i.customerRef)}</small>`,
            money(i.quote, i.currency),
            esc(i.notes) + button("沟通历史", () => inquiryHistory(i.id)),
            esc(states[i.state] || i.state),
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
    (!rows.length
      ? '<p><a class="btn" href="#/items">从商品记录询盘</a></p>'
      : "")
  );
}
async function historyHtml(id: string) {
  const h = await request<{
    initial: string;
    rows: {
      at: string;
      detail: { notes: string; state: string; actorName?: string };
    }[];
  }>(`/inquiries/${id}/history`);
  return (
    `<p>初次记录：${esc(h.initial || "未填写")}</p>` +
    h.rows
      .map(
        (r) =>
          `<article><small>${when(r.at)} · ${esc(r.detail.actorName || "历史记录")} · ${esc(states[r.detail.state] || r.detail.state)}</small><p>${esc(r.detail.notes || "仅更新进度")}</p></article>`,
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
      note("每次跟进独立保留，下面填写本次新增内容。") +
      area("notes", "沟通记录 / 流失原因", "") +
      `<div data-inquiry-conflict></div><details><summary>沟通历史</summary>${history}</details>`,
    async (d, k) => {
      if (changed && !d.has("acceptLatest"))
        throw new Error("请先核对最新记录并勾选确认，你的输入已保留。");
      try {
        return await request(
          `/inquiries/${i.id}/status`,
          "POST",
          { version, state: text(d, "state"), notes: text(d, "notes") },
          k,
        );
      } catch (e) {
        if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
          const latest = await request<Inquiry[]>(`/inquiries?id=${i.id}`);
          version = latest[0].version;
          changed = true;
          dialog.querySelector("[data-inquiry-conflict]")!.innerHTML =
            `<div class="notice warning"><strong>最新进度：${esc(states[latest[0].state] || latest[0].state)}</strong>${await historyHtml(i.id)}${check("acceptLatest", "已核对最新沟通，保留本次输入继续提交")}</div>`;
        }
        throw e;
      }
    },
    "保存",
  );
}
function convertInquiry(i: Inquiry) {
  form(
    "确认询盘成交",
    note(
      "将锁定商品、创建成交记录、把商品停售并将本询盘标为已转化。成交金额、成本和费用仍按既有成交记录补充；此操作不会收款。",
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
  const channels = await request<Channel[]>("/channels");
  const users = can("users") ? await request<User[]>("/auth/users") : [];
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
  html += section(
    "渠道账号",
    note(
      "标题上限是本项目的操作配置，不代表已经核实该平台最新规则。全渠道使用同一个TM号。自有展厅指本系统提供的商品展示页面。",
    ) +
      table(
        ["账号", "平台", "语言", "标题字符上限", "状态", "操作"],
        channels.map((c) => [
          esc(c.name),
          esc(platformNames[c.platform] || "其他渠道"),
          esc(c.locale === "en" ? "英文" : "中文"),
          String(c.titleLimit),
          c.active ? "启用" : "已停用",
          can("users") ? button("修改 / 停用", () => editChannel(c)) : "",
        ]),
      ),
    can("users")
      ? button("＋ 创建渠道", () =>
          form(
            "创建渠道账号",
            field("name", "账号显示名称", "", "text", true) +
              select(
                "platform",
                "平台",
                {
                  XIANYU: "闲鱼",
                  XHS: "小红书",
                  VC: "Vestiaire Collective",
                  CAROUSELL: "Carousell",
                  SHOWROOM: "自有展厅",
                  OTHER: "其他",
                },
                "XIANYU",
              ) +
              select(
                "locale",
                "内容语言",
                { "zh-CN": "中文", en: "英文" },
                "zh-CN",
              ) +
              field(
                "titleLimit",
                "标题字符上限（请按实际规则填写）",
                80,
                "number",
                true,
                'min="16" max="300"',
              ),
            (d, k) =>
              request(
                "/channels",
                "POST",
                {
                  name: text(d, "name"),
                  platform: text(d, "platform"),
                  locale: text(d, "locale"),
                  titleLimit: Number(text(d, "titleLimit")),
                },
                k,
              ),
          ),
        )
      : "",
  );
  if (can("users"))
    html += section(
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
    );
  html += section(
    "系统能力",
    note(
      "联网AI、第三方自动发布、支付及最终结算目前未启用。已有AI文案仍需人工确认；私有原图和经营资料不会公开展示。",
    ) +
      `<details class="technical-details"><summary>技术维护</summary><div class="button-row"><a class="btn" href="/api/system/openapi" target="_blank" rel="noopener">API接口说明</a>${can("users") ? '<a class="btn" href="#/jobs">后台任务</a>' : ""}${can("audit") ? '<a class="btn" href="#/audit">操作记录</a>' : ""}</div></details>`,
  );
  return html;
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
