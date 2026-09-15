import { recordSale, canRecordSale } from "./sale-form";
import { itemActivity } from "./item-activity";
import { recordInquiry } from "./inquiry-form";
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
      const direct: string[] = [];
      if (can("sell")) {
        direct.push(button("记录询盘", () => recordInquiry(i, async () => {})));
        if (i.status === "AVAILABLE") direct.push(button("预留", reserve));
        if (
          canRecordSale(i) &&
          ["AVAILABLE", "RESERVED", "PAUSED"].includes(i.status)
        )
          direct.push(button("登记售出", sold, "primary"));
        if (i.status === "RESERVED") direct.push(button("解除预留", release));
        if (["PAUSED", "QUARANTINED"].includes(i.status) && can("review"))
          direct.push(button("恢复可售", reopen));
      }
      if (i.status === "SOLD" && can("sell"))
        direct.push(
          `<a class="btn primary" href="#/sales?itemId=${i.id}&returnTo=${encodeURIComponent(location.hash)}">查看成交</a>`,
        );
      host.innerHTML = i.id
        ? `<span class="studio-stock-badge">${esc(states[i.status] || i.status)}${i.dataMode === "TEST" ? " · 测试" : ""}</span>` +
          direct.join("") +
          button("经营记录", () => itemActivity(i)) +
          `<details class="studio-stock-menu"><summary class="btn subtle">更多操作</summary><div class="studio-stock-menu-list">` +
          (can("sell")
            ? (canRecordSale(i) &&
              !["AVAILABLE", "RESERVED", "PAUSED"].includes(i.status)
                ? button("登记售出", sold)
                : "") +
              (["AVAILABLE", "RESERVED"].includes(i.status)
                ? button("暂停推广", () =>
                    form(
                      "暂停这件商品推广",
                      `<p>确认暂停 ${esc(i.code)} · ${esc(i.title)}？已发布的渠道仍需实际下架并登记回执。</p>` +
                        area("reason", "暂停原因", "暂时停止推广", 2),
                      (d, k) =>
                        request(
                          `/items/${i.id}/state`,
                          "POST",
                          {
                            state: "PAUSED",
                            reason: text(d, "reason"),
                          },
                          k,
                        ),
                      "确认暂停",
                      refresh,
                    ),
                  )
                : "")
            : "") +
          `<a href="#/items/${i.id}?tab=supply&returnTo=${encodeURIComponent(location.hash)}">其他库存与交接操作</a></div></details>`
        : "";
      if (!can("sell")) host?.querySelector(".studio-stock-menu")?.remove();
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
