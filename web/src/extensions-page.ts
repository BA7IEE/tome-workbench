import {
  request,
  button,
  form,
  field,
  area,
  text,
  note,
  esc,
  table,
  section,
  when,
  can,
  reload,
} from "./core";
interface Info {
  id: string;
  category: string;
  aliases: { code: string; source: string }[];
  waivers: {
    id: string;
    code: string;
    status: string;
    category: string;
    reason: string;
    createdAt: string;
  }[];
}
export async function extensionsPanel(id: string) {
  const i = await request<Info>("/items/" + id);
  const addAlias = () =>
    form(
      "关联旧编号",
      note("TM数字编号空间不可用作旧别名。别名不能转给其他商品。") +
        field("code", "旧编号", "", "text", true) +
        field("source", "来源，例如原闲鱼货号", "", "text", true),
      (d, k) =>
        request(
          `/items/${id}/aliases`,
          "POST",
          { code: text(d, "code"), source: text(d, "source") },
          k,
        ),
    );
  const waive = () =>
    form(
      "记录声明尺寸不适用",
      note(
        "仅限尺寸这一项。图片真实性、授权、供货和可售条件不能豁免；品类改变后原决定不再适用。",
      ) + area("reason", "为什么该件商品不适用尺寸要求？", "", 3),
      (d, k) =>
        request(
          `/items/${id}/waivers`,
          "POST",
          { code: "measurements", reason: text(d, "reason") },
          k,
        ),
      "记录声明",
    );
  return section(
    "旧编号与要求适用性",
    table(
      ["旧编号", "来源"],
      i.aliases.map((a) => [esc(a.code), esc(a.source)]),
    ) +
      table(
        ["不适用项", "品类", "依据", "时间", "操作"],
        i.waivers.map((w) => [
          esc(w.code) + (w.status === "REVOKED" ? "（已撤回）" : "（有效）"),
          esc(w.category),
          esc(w.reason),
          when(w.createdAt),
          can("review") && w.status === "ACTIVE"
            ? button("撤回不适用", async () => {
                await request(
                  `/items/${id}/waivers/${w.id}/revoke`,
                  "POST",
                  {},
                );
                await reload();
              })
            : "—",
        ]),
      ),
    (can("edit") ? button("关联旧编号", addAlias) : "") +
      (can("review") ? button("声明尺寸不适用", waive) : ""),
  );
}
