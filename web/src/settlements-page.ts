import { states } from "./types";
import {
  request,
  button,
  form,
  field,
  select,
  text,
  check,
  note,
  esc,
  table,
  section,
  when,
  money,
  can,
  downloadJson,
  iso,
  currencies,
  cents,
} from "./core";
interface Rule {
  id: string;
  name: string;
  agreementRef: string;
  basisPoints: number;
  status: string;
  effectiveFrom: string;
  effectiveTo: string;
}
interface Snapshot {
  summary: {
    profit: number;
    partnerShare: number;
    operatorShare: number;
    included: number;
    excluded: number;
    pending: number;
  };
  delta: { profit: number; partnerShare: number; operatorShare: number };
  issues: string[];
  lines: {
    saleId: string;
    amount: number | null;
    cost: number | null;
    fees: number | null;
    cooperation: string;
  }[];
}
interface Statement {
  lineReferences?: {
    saleId: string;
    code: string;
    title: string;
    dataMode: string;
  }[];
  isolatedTestLines?: number;
  id: string;
  currency: string;
  status: string;
  digest: string;
  ruleId: string;
  rule: Rule;
  periodStart: string;
  periodEnd: string;
  baseId: string | null;
  snapshot: Snapshot;
  createdAt: string;
}
export async function settlementsPage(id?: string): Promise<string> {
  if (id) {
    const s = await request<Statement>("/settlements/" + id),
      x = s.snapshot;
    const confirm = () =>
      form(
        "确认内部对账快照",
        note(
          "仅确认系统里的计算结果；不会付款，也不代替双方对协议和成本的确认。任何输入变化都将要求重新生成。",
        ) + check("confirmed", "已核对本期间全部交易、成本、例外与实际约定"),
        (d, k) => {
          if (d.get("confirmed") !== "on") throw new Error("请先核对并勾选");
          return request(
            `/settlements/${id}/confirm`,
            "POST",
            { digest: s.digest, confirmed: true },
            k,
          );
        },
        "确认并保留不可变快照",
      );
    return (
      `<p><a href="#/settlements">← 对账记录</a></p>` +
      (s.isolatedTestLines
        ? `<div class="notice warning">本快照包含${s.isolatedTestLines}笔后来隔离的测试成交。历史金额保持原样，请生成更正快照核对差额。</div>`
        : "") +
      section(
        "内部对账快照",
        note(
          `${states[s.status] || s.status} · ${s.currency} · ${when(s.periodStart)} 至 ${when(s.periodEnd)}（结束时间不含）`,
        ) +
          table(
            ["项目", "金额"],
            [
              ["本期当前贡献", money(x.summary.profit, s.currency)],
              ["合作方份额", money(x.summary.partnerShare, s.currency)],
              ["经营方份额", money(x.summary.operatorShare, s.currency)],
              [
                "相对上次确认的份额变化",
                money(x.delta.partnerShare, s.currency),
              ],
            ],
          ) +
          note(
            `计入${x.summary.included}笔，排除${x.summary.excluded}笔，待补${x.summary.pending}笔。${x.issues.length ? "待处理：" + x.issues.join("；") : "当前未发现这些阻断项。"}`,
          ) +
          table(
            ["成交商品", "收入", "取得成本", "直接费用", "范围"],
            x.lines.map((l) => [
              (() => {
                const ref = s.lineReferences?.find(
                  (r) => r.saleId === l.saleId,
                );
                return ref
                  ? `<a href="#/sales?id=${l.saleId}&dataMode=${ref.dataMode}">${esc(ref.code)} · ${esc(ref.title)}</a>`
                  : `<a href="#/sales?id=${l.saleId}">查看这笔成交</a>`;
              })(),
              money(l.amount, s.currency),
              money(l.cost, s.currency),
              money(l.fees, s.currency),
              esc(states[l.cooperation] || l.cooperation),
            ]),
          ),
        button("导出快照", () => downloadJson("对账快照-" + id + ".json", s)) +
          (s.status === "DRAFT"
            ? button("确认此快照", confirm, "primary")
            : ""),
      )
    );
  }
  const [rules, statements] = await Promise.all([
    request<Rule[]>("/settlements/rules"),
    request<Statement[]>("/settlements"),
  ]);
  const createRule = () =>
    form(
      "登记合作计算规则",
      note(
        "只登记明确约定的比例与依据。系统不预填比例，也不认定某份协议有效。按币种单独计算，负贡献保留负值。",
      ) +
        field("name", "规则名称", "", "text", true) +
        field("agreementRef", "明确的协议/规则版本引用", "", "text", true) +
        field(
          "basisPoints",
          "合作方比例（%）",
          "",
          "number",
          true,
          'min="0" max="100" step="0.01"',
        ) +
        field("start", "协议生效时间", "", "datetime-local", true) +
        field("end", "协议截止时间", "", "datetime-local", true),
      (d, k) =>
        request(
          "/settlements/rules",
          "POST",
          {
            name: text(d, "name"),
            agreementRef: text(d, "agreementRef"),
            basisPoints: cents(d.get("basisPoints")),
            effectiveFrom: iso(d.get("start")),
            effectiveTo: iso(d.get("end")),
          },
          k,
        ),
    );
  const preview = () =>
    form(
      "生成对账预览",
      note("请选择已明确启用的规则。更正须关联最新已确认快照，不覆盖历史。") +
        select(
          "ruleId",
          "规则",
          Object.fromEntries(
            rules
              .filter((r) => r.status === "ACTIVE")
              .map((r) => [r.id, r.name]),
          ),
        ) +
        select("currency", "币种", currencies, "CNY") +
        field("start", "期间开始（含）", "", "datetime-local", true) +
        field("end", "期间结束（不含）", "", "datetime-local", true) +
        select("baseId", "更正哪份已确认对账", {
          "": "首次对账，不是更正",
          ...Object.fromEntries(
            statements
              .filter((s) => s.status === "CONFIRMED")
              .map((s) => [
                s.id,
                `${s.currency} · ${when(s.periodStart)} 至 ${when(s.periodEnd)} · 确认版本 ${s.id.slice(0, 6)}`,
              ]),
          ),
        }),
      async (d, k) => {
        const result = await request<{ id: string }>(
          "/settlements/preview",
          "POST",
          {
            ruleId: text(d, "ruleId"),
            currency: text(d, "currency"),
            periodStart: iso(d.get("start")),
            periodEnd: iso(d.get("end")),
            ...(text(d, "baseId") ? { baseId: text(d, "baseId") } : {}),
          },
          k,
        );
        location.hash = "/settlements/" + result.id;
        return result;
      },
      "生成预览",
    );
  const activate = (r: Rule) =>
    form(
      "启用已确认的规则",
      note(
        `${r.name}：合作方比例${r.basisPoints / 100}%。只有双方实际约定一致才启用。`,
      ) +
        field("agreementRef", "再次输入协议或规则编号", "", "text", true) +
        check("confirmed", "已确认上述依据和适用范围"),
      (d, k) => {
        if (d.get("confirmed") !== "on") throw new Error("请先确认适用依据");
        return request(
          `/settlements/rules/${r.id}/activate`,
          "POST",
          { confirmed: true, agreementRef: text(d, "agreementRef") },
          k,
        );
      },
      "启用已核对规则",
    );
  return (
    section(
      "内部对账与更正",
      note(
        "只生成、确认内部计算快照，不执行付款。汇率、跨期退货和协议尾单等复杂情形必须人工按约定核对；不能仅凭本页认定法律应付款。",
      ) +
        table(
          ["期间", "币种", "状态", "创建时间", "打开"],
          statements.map((s) => [
            `${when(s.periodStart)} — ${when(s.periodEnd)}`,
            esc(s.currency),
            esc(states[s.status] || s.status),
            when(s.createdAt),
            `<a href="#/settlements/${s.id}">查看快照</a>`,
          ]),
        ),
      rules.some((r) => r.status === "ACTIVE")
        ? button("生成核对快照", preview, "primary")
        : '<p class="notice">尚无已启用的规则，请先建立规则草稿，再由有权限的人员核对启用。</p><button class="btn" disabled>生成核对快照</button>' +
            (can("users") ? button("先建立规则草稿", createRule) : ""),
    ) +
    section(
      "计算规则版本",
      table(
        ["名称", "依据", "比例", "状态", "操作"],
        rules.map((r) => [
          esc(r.name),
          esc(r.agreementRef),
          `${r.basisPoints / 100}%`,
          esc(states[r.status] || r.status),
          can("users") && r.status === "DRAFT"
            ? button("确认启用", () => activate(r))
            : "—",
        ]),
      ),
      can("users") ? button("新建规则草稿", createRule) : "",
    )
  );
}
