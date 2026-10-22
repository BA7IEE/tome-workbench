import { recordSale, canRecordSale } from "./sale-form";
import { receiveStockReturn } from "./stock-return";
import {
  request,
  can,
  esc,
  button,
  form,
  field,
  select,
  area,
  check,
  text,
  dialog,
  onDialogClosed,
} from "./core";
import { states, type Item, type Supplier } from "./types";
export function studioStock(
  root: HTMLElement,
  get: () => Item,
  changed: () => void,
) {
  const refresh = async () => {
    const latest = await request<Item>(`/items/${get().id}`);
    get().status = latest.status;
    get().offers = latest.offers;
    get().reservations = latest.reservations;
    paint();
    changed();
  };
  const sold = () => recordSale(get(), refresh);
  const reserve = () =>
    form(
      "预留给客户",
      field("customerRef", "客户内部标记", "", "text", true) +
        field(
          "minutes",
          "预留时长（分钟）",
          120,
          "number",
          true,
          'min="5" max="10080"',
        ),
      async (d, key) => {
        const minutes = Number(text(d, "minutes"));
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080)
          throw new Error("预留时长需为5—10080分钟");
        const result = await request(
          `/items/${get().id}/reserve`,
          "POST",
          {
            customerRef: text(d, "customerRef"),
            minutes,
          },
          key,
        );
        return result;
      },
      "确认预留",
      refresh,
    );
  const release = () =>
    form(
      "解除客户预留",
      `<p>解除 ${esc(get().code)} 的预留后，商品保持暂停。重新销售前需复核并恢复可售。</p>`,
      (_d, key) => request(`/items/${get().id}/release`, "POST", {}, key),
      "确认解除",
      refresh,
    );
  const reopen = () =>
    form(
      "恢复可售",
      area("reason", "实物、库存与品相复核依据", "", 2) +
        check("checked", "已重新核对库存，确认可以销售"),
      (d, k) => {
        if (!d.has("checked")) throw new Error("请先核对实际库存");
        return request(
          `/items/${get().id}/state`,
          "POST",
          { state: "AVAILABLE", reason: text(d, "reason") },
          k,
        );
      },
      "确认恢复",
      refresh,
    );
  const supply = async () => {
    const suppliers = await request<Supplier[]>("/supply/suppliers");
    let id =
      get().offers.find((o) => o.status === "CONFIRMED")?.supplier?.id ||
      suppliers[0]?.id;
    if (!suppliers.length) {
      let saved = "";
      form(
        "新增供货方",
        field("name", "供货方名称", "", "text", true),
        async (d, k) => {
          const r = await request<{ id: string }>(
            "/supply/suppliers",
            "POST",
            { name: text(d, "name") },
            k,
          );
          saved = r.id;
          return r;
        },
        "保存供货方",
        async () => {
          id = saved;
          await supply();
        },
      );
      return;
    }
    form(
      "确认这件商品仍可供货",
      select(
        "supplierId",
        "供货方",
        Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
        id,
      ) +
        field(
          "hours",
          "此次确认有效小时数",
          24,
          "number",
          true,
          'min="1" max="168"',
        ) +
        area("note", "确认依据", "", 2) +
        check("confirmed", "已向供货方确认该商品当前有货"),
      (d, k) => {
        if (!d.has("confirmed")) throw new Error("请先向供货方确认实际库存");
        const hours = Number(d.get("hours"));
        if (!Number.isInteger(hours) || hours < 1 || hours > 168)
          throw new Error("有效期需为1—168小时");
        return request(
          "/supply/offers",
          "POST",
          {
            itemId: get().id,
            supplierId: text(d, "supplierId"),
            validUntil: new Date(Date.now() + hours * 3600000).toISOString(),
            canReserve: false,
            notes: text(d, "note"),
          },
          k,
        );
      },
      "保存供货确认",
      refresh,
    );
  };
  function paint() {
    const i = get(),
      host = root.querySelector<HTMLElement>("[data-stock-controls]");
    if (host) {
      host.classList.add("button-row");
      const changeStock = () => {
        const choices: Record<string, string> = {};
        if (i.status === "AVAILABLE") choices.RESERVED = "预留给客户";
        if (i.status === "RESERVED") choices.RELEASE = "解除客户预留";
        if (["AVAILABLE", "RESERVED"].includes(i.status)) choices.PAUSED = "暂停售卖";
        if (["PAUSED", "QUARANTINED"].includes(i.status) && can("review")) choices.AVAILABLE = "核对后恢复可售";
        if (["AVAILABLE", "PAUSED"].includes(i.status)) {
          choices.QUARANTINED = "待复检，暂不销售";
          choices.GIFTED = "已赠出";
          choices.SELF_USE = "自留";
          if (i.ownership === "SUPPLIER") choices.SUPPLIER_SOLD = "供货方已售";
        }
        form("更改库存状态",
          select("state", "实际库存情况", choices) +
          area("reason", "原因或依据", "", 2),
          async (data, key) => {
            const state = text(data, "state");
            if (!choices[state]) throw new Error("请选择当前可用的库存操作");
            if (["RESERVED", "RELEASE", "AVAILABLE"].includes(state)) {
              setTimeout(() => state === "RESERVED" ? reserve() : state === "RELEASE" ? release() : reopen(), 0);
              return { nextStep: true };
            }
            return request("/items/" + i.id + "/state", "POST",
              { state, reason: text(data, "reason") }, key);
          }, "确认库存情况", refresh);
        const scope = new AbortController();
        onDialogClosed(() => scope.abort());
        const selector = dialog.querySelector<HTMLSelectElement>('[name="state"]')!;
        const sync = () => {
          const next = ["RESERVED", "RELEASE", "AVAILABLE"].includes(selector.value);
          dialog.querySelector('[name="reason"]')!.closest("label")!.hidden = next;
          dialog.querySelector('button[type="submit"]')!.textContent = next ? "下一步" : "确认库存情况";
        };
        selector.addEventListener("change", sync, { signal: scope.signal });
        sync();
      };
      const canChange = can("sell") && (["AVAILABLE", "RESERVED", "PAUSED"].includes(i.status) ||
        (i.status === "QUARANTINED" && can("review")));
      host.innerHTML = i.id
        ? '<span class="studio-stock-badge">' + esc(states[i.status] || i.status) + '</span>' +
          (can("sell") && canRecordSale(i) && ["AVAILABLE", "RESERVED", "PAUSED"].includes(i.status)
            ? button("标记售出", sold, "primary") : "") +
          (canChange ? button("更改库存状态", changeStock) : "") +
          (i.status === "SOLD" && can("sell")
            ? '<a class="btn" href="#/sales?itemId=' + i.id + '">查看成交记录</a>' : "") +
          (i.status === "SOLD" && can("finance")
            ? button("确认实物退回", () => receiveStockReturn({ itemId: i.id, cycle: i.cycle, dataMode: i.dataMode }, refresh))
            : i.status === "SOLD" && can("sell") ? '<small>实物退回或误标售出，请管理员确认回收；复检后才能再次销售。</small>' : "")
        : "";
      const summary = root.querySelector(".studio-operating-options > summary");
      if (summary)
        summary.textContent = `库存与来源 · ${states[i.status] || i.status}${i.dataMode === "TEST" ? " · 测试" : ""}`;
      const options = root.querySelector<HTMLDetailsElement>(
        ".studio-operating-options",
      );
      if (options) options.hidden = !i.id;
    }
    const source = root.querySelector<HTMLElement>(
      "[data-section=supply] .studio-optional-body",
    );
    if (source) {
      source.querySelector("[data-studio-supply]")?.remove();
      if (i.id && i.ownership === "SUPPLIER") {
        const el = document.createElement("div");
        el.dataset.studioSupply = "";
        el.innerHTML =
          "<p>供货方持有；不要求先寄到我们手中。</p>" +
          (can("supply")
            ? button("确认当前供货", supply)
            : "<p>请有货源权限的人员确认供货状态。</p>");
        source.prepend(el);
      }
    }
  }
  paint();
  return { paint };
}
