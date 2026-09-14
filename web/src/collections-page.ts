import { collectionBuilder, beginCollection } from "./collection-builder";
import { setupChannel } from "./channel-setup";
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
  downloadJson,
  select,
  check,
} from "./core";
interface Entry {
  itemId: string;
  packageId: string;
  status: string;
  snapshot: { code: string; title: string; body: string } | null;
}
interface Collection {
  id: string;
  title: string;
  createdAt: string;
  entries: Entry[];
  _count?: { entries: number };
}
export async function collectionsPage(id?: string): Promise<string> {
  if (id === "new") return collectionBuilder();
  if (!id) {
    const rows = await request<Collection[]>("/collections");
    const create = async () => {
      const channels =
        await request<
          { id: string; name: string; locale: string; active: boolean }[]
        >("/channels");
      const choices = Object.fromEntries(
        channels
          .filter((c) => c.active)
          .map((c) => [c.id, c.name + " / " + c.locale]),
      );
      if (!Object.keys(choices).length) {
        if (can("users")) {
          setupChannel(create);
          return;
        }
        throw new Error("请管理员先添加启用的渠道，之后可继续选品。");
      }
      form(
        "创建选品合集",
        note(
          "输入商品TM编号即可，不需要查找内部ID。只取用已批准且仍有效的资料；不会替你发布到外部平台。",
        ) +
          field("title", "合集名称", "", "text", true) +
          select("channelId", "语言与内容模板", choices) +
          area("codes", "商品编号（每行一个，如 TM000001）", "", 5) +
          check("confirmed", "我已确认选择的商品，生成本次客户选品快照"),
        async (d, k) => {
          if (!d.has("confirmed")) throw new Error("请先确认本次选品。");
          const codes = text(d, "codes")
            .toUpperCase()
            .split(/\s+/)
            .filter(Boolean);
          if (
            codes.length < 1 ||
            codes.length > 40 ||
            new Set(codes).size !== codes.length ||
            codes.some((c) => !/^TM\d{6,}$/.test(c))
          )
            throw new Error("请填写1至40个不重复的完整TM编号。");
          const selected: { id: string; code: string }[] = [];
          for (const code of codes) {
            const found = await request<{
              rows: { id: string; code: string }[];
            }>("/items?q=" + encodeURIComponent(code));
            const i = found.rows.find((i) => i.code === code);
            if (!i) throw new Error("未找到商品：" + code);
            selected.push(i);
          }
          const preview = await request<{
            ready: boolean;
            rows: { id: string; issues: string[] }[];
          }>("/collections/preflight", "POST", {
            itemIds: selected.map((i) => i.id),
            channelId: text(d, "channelId"),
          });
          if (!preview.ready)
            throw new Error(
              preview.rows
                .filter((r) => r.issues.length)
                .map(
                  (r) =>
                    (selected.find((i) => i.id === r.id)?.code || "") +
                    "：" +
                    r.issues.join("；"),
                )
                .join("\n"),
            );
          const packageIds: string[] = [];
          for (const [index, i] of selected.entries()) {
            const p = await request<{ id: string }>(
              `/items/${i.id}/packages`,
              "POST",
              {
                channelId: text(d, "channelId"),
                purpose: "CUSTOMER_CARD",
                confirmed: true,
              },
              k + ":package:" + index,
            );
            packageIds.push(p.id);
          }
          return request(
            "/collections",
            "POST",
            { title: text(d, "title"), packageIds, confirmed: true },
            k,
          );
        },
        "生成选品合集",
      );
    };
    return section(
      "商品选品合集",
      note(
        "一件商品售出或资料失效，只停止该件的再次取用，其余有效商品仍可导出。",
      ) +
        table(
          ["合集", "商品数量", "创建时间"],
          rows.map((r) => [
            `<a href="#/collections/${r.id}">${esc(r.title)}</a>`,
            String(r._count?.entries || 0),
            when(r.createdAt),
          ]),
        ),
      can("publish")
        ? button("看图创建合集", () => beginCollection(), "primary") +
            button("创建合集", create)
        : "",
    );
  }
  const c = await request<Collection>(`/collections/${id}`);
  return (
    `<a href="#/collections">← 返回合集</a>` +
    section(
      c.title,
      note(
        "重新读取及导出时逐件检查状态。已下载或已发给客户的旧文件无法远程收回，请在成交前再次确认库存。",
      ) +
        table(
          ["商品", "当前可用性", "冻结内容"],
          c.entries.map((e) => [
            e.snapshot
              ? esc(e.snapshot.code)
              : `<a href="#/items/${e.itemId}">查看内部商品</a>`,
            e.status === "USABLE" ? "可使用" : "停止取用",
            e.snapshot
              ? esc(e.snapshot.title) +
                `<small>${esc(e.snapshot.body.slice(0, 160))}</small>`
              : "当前失效，不再输出旧内容",
          ]),
        ),
      can("publish")
        ? button("下载有效商品资料包", async () => {
            const r = await fetch(`/api/collections/${id}/download`);
            if (!r.ok) {
              const e = await r.json();
              throw new Error(e.error?.message || "合集不可导出");
            }
            const u = URL.createObjectURL(await r.blob()),
              a = document.createElement("a");
            a.href = u;
            a.download = "兔泥巴选品合集.zip";
            a.click();
            setTimeout(() => URL.revokeObjectURL(u), 1000);
          }) +
            button("导出当前核对清单", () => downloadJson("选品清单.json", c))
        : "",
    )
  );
}
