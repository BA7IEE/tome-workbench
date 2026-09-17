import { recordSale, canRecordSale } from "./sale-form";
import { itemActivity } from "./item-activity";
import { safeReturn } from "./record-controls";
import { productOverview } from "./product-overview";
import { productHref } from "./product-navigation";
import {
  sourceFieldNote,
  catalogBrand,
  catalogCondition,
} from "./item-source-facts";
import { recordInquiry } from "./inquiry-form";
import { cleanupTestData } from "./test-data";
import { uploadImages } from "./media-uploader";
import { deleteProduct, deletedNotice } from "./recycle-bin";
import { catalogContext } from "./catalog-context";
import { editProduct } from "./product-editor";
import { mediaPanel } from "./media-panel";
import { publishingWorkspace } from "./publishing-workspace";
import { attributeNames } from "./editor-fields";
import { extensionsPanel } from "./extensions-page";
import {
  request,
  can,
  esc,
  money,
  when,
  button,
  field,
  area,
  select,
  check,
  currencies,
  text,
  cents,
  iso,
  dateFuture,
  form,
  viewDialog,
  empty,
  note,
  table,
  section,
  badge,
  observed,
  reload,
} from "./core";
import { categories, states } from "./types";
import type { Item, Channel, Supplier, Source } from "./types";
export function createItem(source?: Source) {
  location.hash =
    "/items/new" + (source ? "?source=" + encodeURIComponent(source.id) : "");
}

async function readiness(i: Item, channels: Channel[]) {
  if (!channels.length) throw new Error("请管理员先在设置中创建渠道账号");
  form(
    "按用途检查准备工作",
    select(
      "channelId",
      "目标渠道",
      Object.fromEntries(channels.map((c) => [c.id, c.name])),
    ) +
      select(
        "purpose",
        "用途",
        {
          TRADE: "交易发布",
          CUSTOMER_CARD: "客户资料卡",
          SHOWROOM: "展厅展示",
        },
        "TRADE",
      ),
    async (d, k) => {
      const c = text(d, "channelId"),
        p = text(d, "purpose");
      const r = await request<{
        missing: { title: string }[];
        approved: boolean;
        ready: boolean;
      }>(`/items/${i.id}/readiness?channelId=${c}&purpose=${p}`);
      await request(
        `/items/${i.id}/prepare`,
        "POST",
        { channelId: c, purpose: p },
        k,
      );
      setTimeout(
        () =>
          viewDialog(
            "用途检查结果",
            r.ready
              ? note("资料已满足，且有批准版本。下一步可以生成使用包。")
              : note("只为缺失的结果创建共享任务，不强制重新拍摄或测量。") +
                  `<ul>${r.missing.map((x) => `<li>${esc(x.title)}</li>`).join("")}${!r.approved ? "<li>当前资料尚未批准</li>" : ""}</ul>`,
          ),
        150,
      );
    },
    "检查并生成缺项任务",
  );
}
async function channelPricePanel(i: Item, channels: Channel[]) {
  const rows = await request<
    {
      channelId: string;
      amount: number;
      currency: string;
      version: number;
      channel: { id: string; name: string; platform: string; locale: string };
    }[]
  >(`/items/${i.id}/channel-prices`);
  const overrides = new Map(rows.map((row) => [row.channelId, row]));
  return section(
    "各渠道报价",
    note(
      "当前商品报价是未设置渠道价时的 fallback。渠道价只影响该账号的 Readiness、草稿与冻结使用包；不会自动换汇或覆盖其他渠道。",
    ) +
      table(
        ["渠道账号", "有效报价", "来源", "操作"],
        channels.map((channel) => {
          const override = overrides.get(channel.id);
          const amount = override?.amount ?? i.currentPrice;
          const currency = override?.currency ?? i.currency;
          return [
            `${esc(channel.name)}<small>${esc(channel.platform)}</small>`,
            money(amount, currency),
            override ? `渠道价 v${override.version}` : "商品默认报价",
            can("edit")
              ? button("设置", () =>
                  form(
                    `${channel.name} 渠道价`,
                    field(
                      "amount",
                      "明确金额",
                      amount === null ? "" : amount / 100,
                      "text",
                      true,
                      'inputmode="decimal"',
                    ) +
                      select("currency", "币种", currencies, currency) +
                      check("confirmed", "我已核对该渠道的实际报价"),
                    (d, key) => {
                      if (!d.has("confirmed")) throw new Error("请先核对报价");
                      const value = cents(d.get("amount"));
                      if (value === null) throw new Error("请填写明确金额");
                      return request(
                        `/items/${i.id}/channel-prices/${channel.id}`,
                        "POST",
                        { amount: value, currency: text(d, "currency") },
                        key,
                      );
                    },
                    "保存渠道价",
                  ),
                ) +
                (override
                  ? button("改用默认报价", () =>
                      form(
                        `${channel.name} 改用商品默认报价`,
                        note(
                          "这会移除本渠道的价格覆盖；已有使用包会在下次使用时重新校验。",
                        ) + check("confirmed", "确认改用商品默认报价"),
                        (d, key) => {
                          if (!d.has("confirmed")) throw new Error("请先确认");
                          return request(
                            `/items/${i.id}/channel-prices/${channel.id}`,
                            "POST",
                            { amount: null },
                            key,
                          );
                        },
                        "确认改用默认报价",
                      ),
                    )
                  : "")
              : "",
          ];
        }),
      ),
  );
}
function stockAction(i: Item, state: string) {
  form(
    states[state] || state,
    area("reason", "原因 / 实物确认说明", "", 3),
    (d, k) =>
      request(
        `/items/${i.id}/state`,
        "POST",
        { state, reason: text(d, "reason") },
        k,
      ),
    "确认",
  );
}
function suggestions(i: Item) {
  form(
    "导入AI / 人工候选文案",
    note(
      "建议绑定当前商品资料版本。人工接受后仅写入草稿，不自动批准或发布。联网付费AI连接器尚未启用。",
    ) +
      select("locale", "语言", { "zh-CN": "中文", en: "英文" }, "zh-CN") +
      field("source", "来源 / 模型名称", "MANUAL_IMPORT", "text", true) +
      area("text", "候选文案", "", 12),
    (d, k) =>
      request(
        `/items/${i.id}/suggestions`,
        "POST",
        {
          version: i.version,
          locale: text(d, "locale"),
          source: text(d, "source"),
          text: text(d, "text"),
        },
        k,
      ),
  );
}
export async function detailPage(id: string) {
  const query = new URLSearchParams(location.hash.split("?")[1] || "");
  if (!query.has("tab")) {
    const item = await request<Item>(`/items/${id}`);
    return item.deletedAt ? deletedNotice(item) : productOverview(item);
  }
  const [i, channels] = await Promise.all([
    request<Item>(`/items/${id}`),
    request<Channel[]>("/channels"),
  ]);
  if (i.deletedAt) return deletedNotice(i);
  const tab =
    new URLSearchParams(location.hash.split("?")[1] || "").get("tab") ||
    "facts";
  const tabs = [
    ["facts", "商品资料"],
    ["assets", "素材"],
    ["use", "发布资料"],
    ["supply", "货源与实物"],
    ...(can("finance") ? [["costs", "成本明细"]] : []),
    ["history", "版本与记录"],
  ];
  let header = `<nav class="breadcrumb"><a href="${esc(catalogContext().listHash)}">商品列表</a><span>/</span><span>商品详情</span></nav><div class="item-header"><div><div class="eyebrow">${esc(i.code)} · ${esc(categories[i.category])}</div><h1>${esc(i.title)}</h1><p>${esc(catalogBrand(i))} · ${i.ownership === "OWN" ? "自有库存" : "供应商持有"} · ${esc(i.location || "位置待补")}</p></div><div class="item-status">${badge(states[i.status] || i.status)}<strong>${money(i.currentPrice, i.currency)}</strong><small>${i.approvedValid ? "已有确认资料" : "资料待核对"} · 内部编号不随渠道变化</small></div></div>`;
  const ops = [
    button("经营记录", () => itemActivity(i)),
    can("users") ? button("清理测试数据", () => cleanupTestData(i)) : "",
    can("edit") ? button("上传商品图片", () => uploadImages(i)) : "",
    can("delete") ? button("删除商品", () => deleteProduct(i), "danger") : "",
    can("edit") ? button("编辑商品", () => editProduct(i), "primary") : "",
    can("publish")
      ? `<a class="btn" href="#/items/${i.id}?tab=use">准备发布</a>`
      : "",
    can("edit")
      ? button("用途检查", () => readiness(i, channels), "subtle")
      : "",
    can("sell") ? button("记录询盘", () => recordInquiry(i)) : "",
    can("sell") && canRecordSale(i)
      ? button("我方已售出", () => recordSale(i), "danger")
      : "",
  ];
  const back = safeReturn(
    new URLSearchParams(location.hash.split("?")[1] || "").get("returnTo"),
  );
  if (back)
    header += `<p><a class="btn" href="${esc(back)}">返回商品工作区</a></p>`;
  const overview =
    back.split("?")[0] === `#/items/${id}` &&
    !new URLSearchParams(back.split("?")[1] || "").has("tab")
      ? back
      : productHref(id, back);
  header += `<div class="button-row">${ops.join("")}</div><nav class="tabs"><a href="${esc(overview)}">商品概览</a>${tabs.map(([key, label]) => `<a class="${key === tab ? "active" : ""}" href="#/items/${i.id}?${esc(new URLSearchParams({ tab: key, ...(back ? { returnTo: back } : {}) }).toString())}">${label}</a>`).join("")}</nav>`;
  let content = "";
  if (tab === "facts") {
    const f = i.facts;
    content = section(
      "基础与品相",
      `<dl class="details">${[
        ["品牌", catalogBrand(i)],
        ["成色", catalogCondition(i)],
        ["主要材质", f.mainMaterial],
        ["材质成分 / 细节", f.material],
        ["颜色", f.color],
        ["标签尺码", f.sizeLabel],
        ["实测尺寸", f.measurements],
        ["尺寸来源", f.measurementSource],
        ["瑕疵与使用痕迹", f.condition],
        [
          "复核状态",
          (
            {
              UNKNOWN: "待复核",
              PASSED: "已通过",
              FAILED: "存疑 / 未通过",
            } as Record<string, string>
          )[f.authentication.status] || f.authentication.status,
        ],
        ["复核依据", f.authentication.evidence],
      ]
        .map(
          ([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "待补充")}</dd></div>`,
        )
        .join("")}</dl>`,
      can("review")
        ? button("批准当前资料", () => {
            form(
              "批准当前资料",
              note(
                `批准草稿 v${i.version}，后续发布将使用这个版本。不会自动生成平台发布记录。`,
              ),
              (d, k) => {
                void d;
                return request(
                  `/items/${id}/approve`,
                  "POST",
                  { version: i.version },
                  k,
                );
              },
              "确认批准",
            );
          })
        : "",
    );
    content +=
      section(
        "中文介绍",
        `<div class="copy">${esc(f.descriptionZh || "待补充")}</div>`,
      ) +
      section(
        "英文介绍",
        `<div class="copy">${esc(f.descriptionEn || "待补充")}</div>`,
      );
    content += section(
      "研究与扩展资料",
      table(
        ["主张", "依据", "状态"],
        f.research.map((r) => [
          esc(r.claim),
          esc(r.evidence),
          r.confirmed ? "已确认" : "候选",
        ]),
      ) +
        `<dl class="details">${Object.entries(f.attributes)
          .map(
            ([k, v]) =>
              `<div><dt>${esc(f.attributeLabels?.[k] || attributeNames[k] || k)}</dt><dd>${esc(typeof v === "boolean" ? (v ? "是" : "否") : v)}</dd></div>`,
          )
          .join("")}</dl>`,
    );
    content += section(
      "候选文案",
      i.suggestions.length
        ? i.suggestions
            .map(
              (s) =>
                `<article class="list-entry"><strong>${esc(s.locale)} · ${esc(s.source)} · 输入v${s.inputVersion}</strong><div class="copy excerpt">${esc(s.text)}</div><span>${esc(s.status)}</span> ${
                  can("edit") && s.status === "PENDING"
                    ? button("人工接受到草稿", async () => {
                        await request(`/suggestions/${s.id}/apply`, "POST", {});
                        await reload();
                      })
                    : ""
                }</article>`,
            )
            .join("")
        : empty("还没有候选文案"),
      can("edit") ? button("导入候选", () => suggestions(i)) : "",
    );
  }
  if (tab === "assets") content = mediaPanel(i);
  if (tab === "use") {
    content =
      (await channelPricePanel(i, channels)) +
      (await publishingWorkspace(i, channels));
    content += section(
      "各渠道的发布与停售记录",
      table(
        ["渠道", "目标状态", "最近实际观察", "操作"],
        i.listings.map((l) => [
          esc(l.channel.name),
          esc(states[l.desired] || l.desired),
          esc(states[l.observed] || l.observed) +
            `<small>${when(l.observedAt)}</small>`,
          can("publish") ? button("回填下架", () => observed(l.id)) : "",
        ]),
      ),
    );
  }
  if (tab === "supply") {
    const stockButtons = can("sell")
      ? button("暂停推广", () => stockAction(i, "PAUSED")) +
        (i.status === "AVAILABLE"
          ? button("隔离待复检", () => stockAction(i, "QUARANTINED"))
          : "") +
        (["PAUSED", "QUARANTINED"].includes(i.status) && can("review")
          ? button("复检后恢复可售", () => stockAction(i, "AVAILABLE"))
          : "") +
        button("赠出", () => stockAction(i, "GIFTED")) +
        button("自留", () => stockAction(i, "SELF_USE")) +
        (i.ownership === "SUPPLIER"
          ? button("供货方已售", () => stockAction(i, "SUPPLIER_SOLD"))
          : "")
      : "";
    content = section(
      "库存控制",
      note(
        "库存安全动作先执行；渠道实际下架由回执证明。解除预留后保持暂停，不会自动重新上架。",
      ) +
        `<div class="button-row">${stockButtons}</div>` +
        table(
          ["有效预留", "到期"],
          i.reservations.map((r) => [esc(r.customerRef), when(r.expiresAt)]),
        ),
      can("sell")
        ? button("预留给客户", () =>
            form(
              "预留商品",
              field("customerRef", "客户内部标记", "", "text", true) +
                field(
                  "minutes",
                  "有效分钟数",
                  120,
                  "number",
                  true,
                  'min="5" max="10080"',
                ),
              (d, k) =>
                request(
                  `/items/${id}/reserve`,
                  "POST",
                  {
                    customerRef: text(d, "customerRef"),
                    minutes: Number(text(d, "minutes")),
                  },
                  k,
                ),
            ),
          ) +
            button("解除预留", async () => {
              await request(`/items/${id}/release`, "POST", {});
              await reload();
            })
        : "",
    );
    content += section(
      "位置与交接",
      note("现位置：" + (i.location || "尚未记录")) +
        table(
          ["从", "到", "时间", "交接依据"],
          i.movements.map((m) => [
            esc(m.from),
            esc(m.to),
            when(m.occurredAt),
            esc(m.evidence),
          ]),
        ),
      can("edit")
        ? button("记录交接", () =>
            form(
              "记录实物流转",
              field("to", "移交后位置 / 保管人", "", "text", true) +
                area("evidence", "签收或交接依据"),
              (d, k) =>
                request(
                  `/items/${id}/move`,
                  "POST",
                  {
                    version: i.version,
                    to: text(d, "to"),
                    evidence: text(d, "evidence"),
                  },
                  k,
                ),
            ),
          )
        : "",
    );
    if (can("supply"))
      content += section(
        "供应商报价与有货确认",
        table(
          ["供应商", "报价", "有效期", "状态", "操作"],
          i.offers.map((o) => [
            esc(o.supplier.name),
            money(o.amount, o.currency),
            when(o.validUntil),
            `${esc(o.status)}<small>${o.canReserve ? "支持锁货" : "未承诺锁货"}</small>`,
            button("撤回此报价", async () => {
              await request(`/supply/offers/${o.id}/withdraw`, "POST", {});
              await reload();
            }),
          ]),
        ),
        button("＋ 新增供货确认", async () => {
          const suppliers = await request<Supplier[]>("/supply/suppliers");
          if (!suppliers.length) throw new Error("先到货源管理新增供应商");
          form(
            "供货确认",
            select(
              "supplierId",
              "供应商",
              Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
            ) +
              field("supplierCode", "供应商货号") +
              field(
                "amount",
                "供货报价",
                "",
                "text",
                false,
                'inputmode="decimal"',
              ) +
              select("currency", "币种", currencies, "CNY") +
              field(
                "validUntil",
                "有货确认有效至",
                dateFuture(2),
                "datetime-local",
                true,
              ) +
              check("canReserve", "供应商已承诺可锁货（不能仅凭有图片勾选）") +
              area("notes", "确认方式、交付条件与备注"),
            (d, k) =>
              request(
                "/supply/offers",
                "POST",
                {
                  itemId: id,
                  supplierId: text(d, "supplierId"),
                  supplierCode: text(d, "supplierCode"),
                  amount: cents(d.get("amount")),
                  currency: text(d, "currency"),
                  validUntil: iso(d.get("validUntil")),
                  canReserve: d.has("canReserve"),
                  notes: text(d, "notes"),
                },
                k,
              ),
          );
        }),
      );
    if (can("finance"))
      content += section(
        "交易级合作例外",
        note(
          "商品默认合作。此处记录少量提前确定的朋友交易意向，不把整件商品永久排除。真实季度结算另行确认。",
        ) +
          table(
            ["对象", "原因", "状态", "截止"],
            i.intents.map((x) => [
              esc(x.customerRef),
              esc(x.reason),
              esc(x.status),
              when(x.expiresAt),
            ]),
          ),
        button("提前登记例外意向", () =>
          form(
            "记录交易级例外",
            field(
              "customerRef",
              "客户内部标记（成交时必须匹配）",
              "",
              "text",
              true,
            ) +
              area("reason", "例外原因与约定依据") +
              field(
                "expiresAt",
                "意向有效至",
                dateFuture(),
                "datetime-local",
                true,
              ) +
              check("pause", "同时暂停推广", true),
            (d, k) =>
              request(
                `/items/${id}/intents`,
                "POST",
                {
                  customerRef: text(d, "customerRef"),
                  reason: text(d, "reason"),
                  expiresAt: iso(d.get("expiresAt")),
                  pause: d.has("pause"),
                },
                k,
              ),
          ),
        ),
      );
  }
  if (tab === "costs" && can("finance")) {
    const rows = await request<
      {
        id: string;
        kind: string;
        amount: number;
        currency: string;
        confirmed: boolean;
        status: string;
        note: string;
        occurredAt: string;
      }[]
    >(`/items/${id}/costs`);
    const kinds = {
      PURCHASE: "取得 / 采购",
      INBOUND_SHIPPING: "入库运输",
      AUTHENTICATION: "鉴定",
      PREPARATION: "整备",
      OTHER: "其他",
    };
    content = section(
      "商品成本明细",
      note(
        "记录估算和已确认费用，保留作废历史。此处是成本依据，成交账仍需独立核对本次成本与费用；不会把供应商报价直接当成实际成本。",
      ) +
        table(
          ["项目", "金额", "确认 / 状态", "发生日期", "说明", "操作"],
          rows.map((c) => [
            esc(kinds[c.kind as keyof typeof kinds] || c.kind),
            money(c.amount, c.currency),
            `${c.confirmed ? "已确认" : "估算"} · ${esc(c.status)}`,
            when(c.occurredAt),
            esc(c.note),
            c.status === "ACTIVE"
              ? button("作废", () =>
                  form("保留记录并作废", area("reason", "作废理由"), (d, k) =>
                    request(
                      `/costs/${c.id}/void`,
                      "POST",
                      { reason: text(d, "reason") },
                      k,
                    ),
                  ),
                )
              : "",
          ]),
        ),
      button(
        "＋ 记录成本",
        () =>
          form(
            "记录商品成本",
            select("kind", "成本项目", kinds) +
              field("amount", "金额", "", "text", true) +
              select("currency", "币种", currencies, i.currency) +
              check("confirmed", "已依据原始凭据确认（未勾选为估算）") +
              field(
                "occurredAt",
                "发生日期",
                dateFuture(0),
                "datetime-local",
                true,
              ) +
              area("note", "凭据、构成与说明"),
            (d, k) =>
              request(
                `/items/${id}/costs`,
                "POST",
                {
                  kind: text(d, "kind"),
                  amount: cents(d.get("amount")),
                  currency: text(d, "currency"),
                  confirmed: d.has("confirmed"),
                  occurredAt: iso(d.get("occurredAt")),
                  note: text(d, "note"),
                },
                k,
              ),
          ),
        "primary",
      ),
    );
  }
  if (tab === "history") {
    content =
      section(
        "版本历史",
        table(
          ["版本", "保存时间", "批准时间", "查看"],
          i.revisions.map((r) => [
            `v${r.version}`,
            when(r.createdAt),
            when(r.approvedAt),
            button("查看快照", () =>
              viewDialog(
                `v${r.version}`,
                `<pre>${esc(JSON.stringify(r.snapshot, null, 2))}</pre>`,
              ),
            ),
          ]),
        ),
      ) +
      section(
        "冲突观察",
        table(
          ["类型", "事实", "处理"],
          i.observations.map((o) => [
            esc(o.kind),
            `<pre>${esc(JSON.stringify(o.payload, null, 2))}</pre>`,
            o.resolved
              ? "已核对"
              : can("users")
                ? button("记录核对结论", () =>
                    form(
                      "核对冲突",
                      note("只标记已核对并保留依据，不自动修改库存或财务。") +
                        area("reason", "核对结论"),
                      (d, k) =>
                        request(
                          `/observations/${o.id}/resolve`,
                          "POST",
                          { reason: text(d, "reason") },
                          k,
                        ),
                    ),
                  )
                : "待管理员核对",
          ]),
        ),
      );
  }
  if (tab === "facts") content = sourceFieldNote(i, "condition") + content;
  return header + content + (tab === "facts" ? await extensionsPanel(id) : "");
}
