import {
  check,
  currencies,
  dialog,
  field,
  form,
  note,
  request,
  select,
  text,
} from "./core";
import type { Channel } from "./types";
export const platformNames: Record<string, string> = {
  XIANYU: "闲鱼",
  XHS: "小红书",
  VC: "Vestiaire Collective",
  CAROUSELL: "Carousell",
  SHOWROOM: "自有展厅",
  ANQICMS: "AnQiCMS 独立站",
  GRAILED: "Grailed",
  OTHER: "其他渠道",
};
function fixedCurrency(platform: string) {
  if (platform === "ANQICMS") return "USD";
  if (platform === "XIANYU") return "CNY";
  return "";
}
function setCurrencyChoices(
  selectElement: HTMLSelectElement,
  value: string,
  locked: boolean,
) {
  selectElement.replaceChildren(
    ...Object.entries(
      locked
        ? { [value]: (currencies as Record<string, string>)[value] || value }
        : currencies,
    ).map(
      ([code, label]) => new Option(label, code, false, code === value),
    ),
  );
  selectElement.value = value;
}
function bindPlatformCurrency() {
  const platform = dialog.querySelector<HTMLSelectElement>('[name="platform"]');
  const currency = dialog.querySelector<HTMLSelectElement>(
    '[name="defaultCurrency"]',
  );
  if (!platform || !currency) return;
  const sync = () => {
    const fixed = fixedCurrency(platform.value);
    setCurrencyChoices(currency, fixed || currency.value || "CNY", !!fixed);
  };
  platform.addEventListener("change", sync);
  sync();
}
function bindFixedCurrency(channel: Channel) {
  const currency = dialog.querySelector<HTMLSelectElement>(
    '[name="defaultCurrency"]',
  );
  const fixed = fixedCurrency(channel.platform);
  if (currency && fixed) setCurrencyChoices(currency, fixed, true);
}
export function setupChannel(after?: () => Promise<void>) {
  form(
    "添加常用渠道",
    note(
      "这里记录实际账号、内容规格和非敏感站点地址，不会注册账号、自动登录平台或保存密码/Token。",
    ) +
      select("platform", "平台", platformNames, "XIANYU") +
      field("name", "账号名称", "", "text", true) +
      select("locale", "内容语言", { "zh-CN": "中文", en: "英文" }, "zh-CN") +
      select("defaultCurrency", "渠道默认币种", currencies, "CNY") +
      select(
        "distributionMode",
        "分发方式",
        {
          MANUAL: "人工登记",
          AGENT: "受限 Agent 执行",
          API: "API（尚未连接）",
          SCRIPT: "脚本（尚未连接）",
        },
        "MANUAL",
      ) +
      field(
        "endpointUrl",
        "站点地址（可留空，不填账号或密钥）",
        "",
        "url",
      ) +
      field(
        "titleLimit",
        "标题字数上限（包含商品编号）",
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
          platform: text(d, "platform"),
          name: text(d, "name"),
          locale: text(d, "locale"),
          titleLimit: Number(text(d, "titleLimit")),
          defaultCurrency:
            fixedCurrency(text(d, "platform")) || text(d, "defaultCurrency"),
          distributionMode: text(d, "distributionMode"),
          endpointUrl: text(d, "endpointUrl"),
        },
        k,
      ),
    "保存渠道",
    after,
  );
  bindPlatformCurrency();
}

export function editChannel(c: Channel) {
  form(
    "维护渠道",
    note(
      "修改用于后续资料制作；历史发布快照保留原样。停用后不能再取用该渠道资料，实际平台下架仍须登记。",
    ) +
      field("name", "账号显示名称", c.name, "text", true) +
      select("locale", "内容语言", { "zh-CN": "中文", en: "英文" }, c.locale) +
      select("defaultCurrency", "渠道默认币种", currencies, c.defaultCurrency) +
      select(
        "distributionMode",
        "分发方式",
        {
          MANUAL: "人工登记",
          AGENT: "受限 Agent 执行",
          API: "API（尚未连接）",
          SCRIPT: "脚本（尚未连接）",
        },
        c.distributionMode,
      ) +
      field(
        "endpointUrl",
        "站点地址（可留空，不填账号或密钥）",
        c.endpointUrl,
        "url",
      ) +
      field(
        "titleLimit",
        "标题字符上限",
        c.titleLimit,
        "number",
        true,
        'min="16" max="300"',
      ) +
      check("active", "启用渠道", c.active),
    (d, k) =>
      request(
        `/channels/${c.id}`,
        "POST",
        {
          version: c.version,
          name: text(d, "name"),
          locale: text(d, "locale"),
          titleLimit: Number(d.get("titleLimit")),
          active: d.has("active"),
          defaultCurrency:
            fixedCurrency(c.platform) || text(d, "defaultCurrency"),
          distributionMode: text(d, "distributionMode"),
          endpointUrl: text(d, "endpointUrl"),
        },
        k,
      ),
    "保存渠道设置",
  );
  bindFixedCurrency(c);
}
