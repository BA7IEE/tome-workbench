import { form, field, select, note, text, request, check } from "./core";
import type { Channel } from "./types";
export const platformNames: Record<string, string> = {
  XIANYU: "闲鱼",
  XHS: "小红书",
  VC: "Vestiaire Collective",
  CAROUSELL: "Carousell",
  SHOWROOM: "自有展厅",
  OTHER: "其他渠道",
};
export function setupChannel(after?: () => Promise<void>) {
  form(
    "添加常用渠道",
    note(
      "这里记录你实际使用的账号和内容规格，不会注册账号或自动登录平台。标题上限按实际平台要求填写。",
    ) +
      select("platform", "平台", platformNames, "XIANYU") +
      field("name", "账号名称", "", "text", true) +
      select("locale", "内容语言", { "zh-CN": "中文", en: "英文" }, "zh-CN") +
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
        },
        k,
      ),
    "保存渠道",
    after,
  );
}

export function editChannel(c: Channel) {
  form(
    "维护渠道",
    note(
      "修改用于后续资料制作；历史发布快照保留原样。停用后不能再取用该渠道资料，实际平台下架仍须登记。",
    ) +
      field("name", "账号显示名称", c.name, "text", true) +
      select("locale", "内容语言", { "zh-CN": "中文", en: "英文" }, c.locale) +
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
        },
        k,
      ),
    "保存渠道设置",
  );
}
