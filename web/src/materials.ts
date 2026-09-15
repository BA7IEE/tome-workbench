import {
  button,
  can,
  check,
  dialog,
  esc,
  field,
  form,
  me,
  note,
  request,
  select,
  toast,
  viewDialog,
  when,
} from "./core";
import type { Item } from "./types";
import { readWork, saveWork } from "./work-storage";
type Bundle = {
  id: string;
  title: string;
  createdAt: string;
  scope: string;
  dataMode: string;
  rows: {
    id: string;
    code: string;
    title: string;
    changes: string[];
    current: { id: string; version: number } | null;
  }[];
};
type Attempt = {
  key: string;
  body: {
    title: string;
    scope: string;
    dataMode: string;
    items: { id: string; version: number }[];
  };
  id?: string;
};
async function download(id: string) {
  const r = await fetch(`/api/material-exports/${id}/download`);
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(
      data.error?.message || data.message || "资料下载没有完成，请重试",
    );
  }
  const url = URL.createObjectURL(await r.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = `ToMe-商品资料-${id.slice(0, 8)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function materialDetails(id: string) {
  const b = await request<Bundle>(`/material-exports/${id}`);
  const changed = b.rows.filter((r) => r.changes.length);
  viewDialog(
    b.title,
    note(
      `整理于 ${when(b.createdAt)} · ${b.rows.length} 件 · ${changed.length} 件有变化。资料整理记录不代表平台已发布。`,
    ) +
      `<div class="material-changes">${b.rows.map((r) => `<article><div>${r.current ? `<a href="#/items/${r.id}/edit">${esc(r.code)} · ${esc(r.title)}</a>` : esc(r.code + " " + r.title)}<small>${r.changes.length ? "已变化：" + r.changes.map(esc).join("、") : "与整理时一致"}</small></div></article>`).join("")}</div><div class="button-row">` +
      (!changed.length
        ? button("下载原图资料包", () => download(id), "primary")
        : button(
            "按当前资料重新整理",
            () =>
              exportMaterials(
                b.rows
                  .filter((r) => r.current)
                  .map(
                    (r) =>
                      ({
                        ...r.current!,
                        dataMode: b.dataMode,
                        title: r.title,
                      }) as Item,
                  ),
              ),
            "primary",
          )) +
      "</div>",
  );
}
export async function materialHistory() {
  let page = 1;
  const dataMode =
    new URLSearchParams(location.hash.split("?")[1] || "").get("dataMode") ===
    "TEST"
      ? "TEST"
      : "BUSINESS";
  const paint = async () => {
    const data = await request<{
      total: number;
      rows: {
        id: string;
        title: string;
        createdAt: string;
        scope: string;
        _count: { entries: number };
      }[];
    }>(`/material-exports?page=${page}&dataMode=${dataMode}`);
    viewDialog(
      "资料包与变化",
      note("查看之前整理过的商品，核对之后的已售、改价和补图。") +
        (data.rows
          .map(
            (b) =>
              `<article class="import-check-row"><strong>${esc(b.title)}</strong><span>${b._count.entries}件 · ${when(b.createdAt)} · ${b.scope === "INTERNAL" ? "内部完整" : "运营参考"}</span>${button("查看变化 / 下载", () => materialDetails(b.id))}</article>`,
          )
          .join("") || "<p>尚未整理资料包。从商品库勾选商品后下载。</p>") +
        `<div class="pagination">${
          page > 1
            ? button("上一页", async () => {
                page--;
                await paint();
              })
            : ""
        }${
          page * 30 < data.total
            ? button("下一页", async () => {
                page++;
                await paint();
              })
            : ""
        }</div>`,
    );
  };
  await paint();
}
export async function exportMaterials(items: Item[]) {
  if (!items.length) throw new Error("请选择商品");
  const storage = `materials:${me!.id}`;
  let attempt = await readWork<Attempt>(storage);
  if (attempt) return resumeMaterialExport(storage, attempt);
  form(
    "下载商品资料",
    note(
      `已选 ${items.length} 件。包含商品文字、中文表格、JSON 和按 TM 整理的原图。`,
    ) +
      field(
        "title",
        "本批资料名称",
        "商品资料 " + new Date().toLocaleDateString("zh-CN"),
        "text",
        true,
      ) +
      select("scope", "资料范围", {
        OPERATIONS: "运营参考资料（不含成本及内部备注）",
        ...(can("finance")
          ? { INTERNAL: "内部完整资料（含成本及来源原文）" }
          : {}),
      }) +
      check(
        "usage",
        "我知道来源参考图需另行核对外部使用权限，下载不代表已经发布",
      ),
    async (d, key) => {
      if (!d.has("usage")) throw new Error("请确认资料使用范围");
      const body = {
        title: String(d.get("title")),
        scope: String(d.get("scope")),
        dataMode: items[0].dataMode || "BUSINESS",
        items: items.map((i) => ({ id: i.id, version: i.version })),
      };
      if (attempt && JSON.stringify(attempt.body) !== JSON.stringify(body))
        throw new Error(
          "上次整理仍需核对。请关闭后重新打开下载，继续原提交或结束该次尝试，再修改内容。",
        );
      attempt ??= { key, body };
      await saveWork(storage, attempt);
      const result = await request<{ id: string }>(
        "/material-exports",
        "POST",
        attempt.body,
        attempt.key,
      );
      attempt.id = result.id;
      await saveWork(storage, undefined);
      return result;
    },
    "整理资料包",
    async () => {
      await materialDetails(attempt!.id!);
    },
  );
}
async function resumeMaterialExport(storage: string, attempt: Attempt) {
  form(
    "继续整理上次资料",
    note(
      `${attempt.body.title} · ${attempt.body.items.length} 件。继续使用原提交，避免重复整理。`,
    ),
    async () => {
      const result = await request<{ id: string }>(
        "/material-exports",
        "POST",
        attempt.body,
        attempt.key,
      );
      await saveWork(storage, undefined);
      attempt.id = result.id;
      return result;
    },
    "继续原提交",
    () => materialDetails(attempt.id!),
  );
  dialog.querySelector("footer")!.insertAdjacentHTML(
    "afterbegin",
    button("结束本次尝试", async () => {
      if (
        !confirm(
          "已完成的服务器记录会保留，可在资料包记录里查看。结束本次尝试？",
        )
      )
        return;
      await saveWork(storage, undefined);
      dialog.close();
      toast("已结束，可重新选择商品整理资料");
    }),
  );
}
