import { request, can, formWithExit, button, field, select, area, check, note, esc, text, cents, currencies, dialog, onDialogClosed } from "./core";
import { beginEditQueue, saveListScroll } from "./catalog-context";
import { dictionaryField, bindDictionaryFields, readDictionarySelections } from "./dictionary-picker";
import { dictionaryKeys, dictionaryNames, type DictionaryKind, type DictionarySelection } from "./dictionary-editor";
import { confirmedBatchActions, type BatchAction } from "./batch-actions";
import type { Channel, Item } from "./types";

const kinds: DictionaryKind[] = ["BRAND", "CONDITION", "COLOR", "MATERIAL"];
const currencyFor = (channel: Channel) => channel.platform === "ANQICMS" ? "USD" :
  channel.platform === "XIANYU" ? "CNY" : channel.defaultCurrency;

export async function bulkEdit(items: Item[]) {
  if (!items.length || items.length > 100) throw new Error("请选择1—100件商品");
  const channels = can("publish") ? (await request<Channel[]>("/channels"))
    .filter(c => c.active && c.businessPurpose === "TRADE") : [];
  const priceRows = items.map(item => '<tr><td><strong>' + esc(item.code) +
    "</strong><small>" + esc(item.title) + "</small></td><td>" +
    field("price_" + item.id, "售价 " + item.code, item.currentPrice == null ? "" : item.currentPrice / 100,
      "text", false, 'inputmode="decimal"') + "</td><td>" +
    select("currency_" + item.id, "币种 " + item.code, currencies, item.currency) + "</td></tr>").join("");
  const exit = formWithExit("批量编辑商品",
    note("只修改本次选择的内容，逐件保存结果；库存、资料批准和实际上架分别处理。") +
    button("逐件编辑完整资料", () => {
      if (!exit.close()) return;
      beginEditQueue(items.map(item => item.id));
      saveListScroll();
      location.hash = "/items/" + items[0].id + "/edit";
    }) +
    select("editKind", "要修改什么", {
      PRICE: "售价", ATTRIBUTES: "商品资料",
      LOCATION: "位置或暂停售卖", ...(can("publish") && channels.length ? { CHANNEL: "准备上架到渠道" } : {}),
    }, "PRICE") +
    '<section class="full" data-edit-section="PRICE">' +
    select("priceChannel", "报价适用范围", { "": "商品默认报价", ...Object.fromEntries(channels.map(c => [c.id, c.name])) }) +
    '<div class="table-wrap bulk-edit-prices"><table data-foundation-records><thead><tr><th>商品</th><th>售价</th><th>币种</th></tr></thead><tbody>' +
    priceRows + "</tbody></table></div><p class=\"note\" data-price-hint>留空表示暂不报价，不会用零补空。</p></section>" +
    '<section class="full" data-edit-section="ATTRIBUTES" hidden>' +
    kinds.map(kind => '<section>' + check("change_" + dictionaryKeys[kind], "修改" + dictionaryNames[kind]) +
      dictionaryField(kind, undefined) + "</section>").join("") +
    check("allowClear", "确认清空已勾选但没有选值的字段（默认不允许清空）") + "</section>" +
    '<section class="full" data-edit-section="LOCATION" hidden>' +
    field("to", "新位置或保管人（不改可留空）") + check("pause", "将所选商品暂停售卖") +
    area("reason", "位置或库存变更依据", "", 2) + "</section>" +
    '<section class="full" data-edit-section="CHANNEL" hidden>' +
    select("channelId", "上架渠道", Object.fromEntries(channels.map(c => [c.id, c.name]))) +
    check("duplicatePlatformConfirmed", "同平台已有其他账号时，仍同时在本账号销售") +
    '<div data-publish-preview role="status"></div><p class="note">确认后列入该渠道的上架清单；缺项在真正准备上架时处理，不会自动发布。</p></section>' +
    check("confirmed", "我确认以上修改适用于所选商品"),
    async data => {
      if (!data.has("confirmed")) throw new Error("请先核对本次修改");
      const mode = text(data, "editKind");
      let actions: BatchAction[] = [];
      if (mode === "PRICE") {
        const channel = channels.find(c => c.id === text(data, "priceChannel"));
        actions = items.flatMap(item => {
          const amount = cents(data.get("price_" + item.id));
          const currency = channel ? currencyFor(channel) : text(data, "currency_" + item.id);
          if (channel && (amount == null || amount <= 0)) throw new Error(item.code + " 的渠道报价须大于零，请填写金额");
          if (!channel && amount === item.currentPrice && currency === item.currency) return [];
          return [{
            label: item.code + " " + item.title,
            run: (key: string) => channel
              ? request("/items/" + item.id + "/channel-prices/" + channel.id, "POST", { amount, currency }, key)
              : request("/items/" + item.id, "PATCH", { version: item.version, currentPrice: amount, currency }, key),
          }];
        });
      } else if (mode === "ATTRIBUTES") {
        const values = readDictionarySelections(dialog.querySelector("form")!).dictionary;
        const dictionary: DictionarySelection = {};
        for (const kind of kinds) {
          const key = dictionaryKeys[kind];
          if (!data.has("change_" + key)) continue;
          if (!values[key] && !data.has("allowClear")) throw new Error("请选择" + dictionaryNames[kind] + "，清空需要明确确认");
          dictionary[key] = values[key] || null;
        }
        if (!Object.keys(dictionary).length) throw new Error("请勾选要修改的字段");
        actions = items.map(item => ({
          label: item.code + " " + item.title,
          run: key => request("/items/" + item.id, "PATCH", { version: item.version, dictionary }, key),
        }));
      } else if (mode === "LOCATION") {
        const to = text(data, "to").trim(), reason = text(data, "reason").trim();
        if ((!to && !data.has("pause")) || !reason) throw new Error("请选择变更并填写依据");
        actions = items.map(item => ({
          label: item.code + " " + item.title,
          run: async key => {
            if (to) await request("/items/" + item.id + "/move", "POST", { version: item.version, to, evidence: reason }, key + ".move");
            if (data.has("pause")) return request("/items/" + item.id + "/state", "POST", { state: "PAUSED", reason }, key + ".pause");
          },
        }));
      } else if (mode === "CHANNEL") {
        const channelId = text(data, "channelId");
        if (!channels.some(c => c.id === channelId)) throw new Error("请选择可用的上架渠道");
        actions = items.map(item => ({
          label: item.code + " " + item.title,
          run: key => request("/items/" + item.id + "/distribution-targets/" + channelId, "POST", {
            active: true, reason: "用户在批量编辑中明确选择准备上架",
            duplicatePlatformConfirmed: data.has("duplicatePlatformConfirmed"),
          }, key),
        }));
      }
      if (!actions.length) throw new Error("尚未修改任何内容");
      setTimeout(() => {
        confirmedBatchActions(mode === "CHANNEL" ? "上架准备结果" : "批量编辑结果", actions);
        if (mode === "CHANNEL") dialog.querySelector(".button-row")?.insertAdjacentHTML("beforeend",
          '<a class="btn" href="#/distribution?channelId=' + esc(text(data, "channelId")) + '">去渠道完成上架</a>');
      }, 0);
      return { nextStep: true };
    }, "确认保存",
  );
  const scope = new AbortController();
  const formElement = dialog.querySelector("form")!;
  onDialogClosed(() => {
    scope.abort();
    if (!dialog.open) formElement.remove();
  });
  bindDictionaryFields(formElement, scope.signal);
  const mode = formElement.querySelector<HTMLSelectElement>('[name="editKind"]')!;
  const priceChannel = formElement.querySelector<HTMLSelectElement>('[name="priceChannel"]')!;
  const channelSelect = formElement.querySelector<HTMLSelectElement>('[name="channelId"]')!;
  let generation = 0;
  const preview = async () => {
    const current = ++generation;
    const host = formElement.querySelector<HTMLElement>("[data-publish-preview]")!;
    host.textContent = "正在检查所选商品的上架资料…";
    try {
      const result = await request<{ rows: { itemId: string; approved: boolean; missing: { title: string }[] }[] }>(
        "/distribution/readiness", "POST", { itemIds: items.map(i => i.id), channelId: channelSelect.value, purpose: "TRADE" });
      if (scope.signal.aborted || current !== generation) return;
      host.innerHTML = "<ul>" + result.rows.map(row => "<li>" + esc(items.find(i => i.id === row.itemId)?.code) + "：" +
        esc([...row.missing.map(m => m.title), ...(!row.approved ? ["商品资料待确认"] : [])].join("；") || "基础资料已满足") + "</li>").join("") + "</ul>";
    } catch (error) {
      if (!scope.signal.aborted && current === generation) host.textContent = "预检未完成：" + (error as Error).message;
    }
  };
  mode.addEventListener("change", () => {
    for (const section of formElement.querySelectorAll<HTMLElement>("[data-edit-section]"))
      section.hidden = section.dataset.editSection !== mode.value;
    if (mode.value === "CHANNEL") void preview();
  }, { signal: scope.signal });
  channelSelect.addEventListener("change", () => void preview(), { signal: scope.signal });
  priceChannel.addEventListener("change", () => {
    const channel = channels.find(c => c.id === priceChannel.value);
    for (const item of items) {
      const currency = channel ? currencyFor(channel) : item.currency;
      const amount = formElement.querySelector<HTMLInputElement>('[name="price_' + item.id + '"]')!;
      amount.value = item.currentPrice == null || item.currency !== currency ? "" : String(item.currentPrice / 100);
      const selector = formElement.querySelector<HTMLSelectElement>('[name="currency_' + item.id + '"]')!;
      selector.disabled = !!channel;
      if (channel) selector.replaceChildren(new Option(currency, currency));
      else selector.replaceChildren(...Object.entries(currencies).map(([key, label]) => new Option(label, key)));
      selector.value = currency;
    }
    formElement.querySelector("[data-price-hint]")!.textContent = channel
      ? "仅带入同币种的商品默认报价；请逐件确认渠道金额，不自动换汇。"
      : "留空表示暂不报价，不会用零补空。";
  }, { signal: scope.signal });
}
