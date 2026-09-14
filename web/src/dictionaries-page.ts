import { request, can, esc, button, section, table, note } from "./core";
import { onPageReady } from "./page-lifecycle";
import {
  editDictionary,
  dictionaryNames,
  optionText,
  type DictionaryKind,
  type DictionaryEntry,
} from "./dictionary-editor";
export async function dictionariesPage() {
  if (!can("dictionary"))
    return section(
      "字典管理",
      note("此账号可在商品中使用选项，维护字典需要管理员权限。"),
    );
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    kind = (
      Object.hasOwn(dictionaryNames, qs.get("kind") || "")
        ? qs.get("kind")
        : "BRAND"
    ) as DictionaryKind,
    q = qs.get("q") || "",
    page = Number(qs.get("page") || 1),
    root = "dictionary-" + crypto.randomUUID();
  const data = await request<{
    rows: DictionaryEntry[];
    total: number;
    page: number;
    size: number;
  }>(
    `/dictionaries?kind=${kind}&all=1&q=${encodeURIComponent(q)}&page=${page}`,
  );
  const go = (changes: Record<string, string>) => {
    const n = new URLSearchParams(qs);
    Object.entries(changes).forEach(([k, v]) =>
      v ? n.set(k, v) : n.delete(k),
    );
    location.hash = "/dictionaries?" + n;
  };
  onPageReady(root, (el, signal) =>
    el.querySelector("form")!.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        go({
          q: String(
            new FormData(e.currentTarget as HTMLFormElement).get("q") || "",
          ),
          page: "",
        });
      },
      { signal },
    ),
  );
  const standard =
    kind === "CONDITION"
      ? `<div class="notice"><strong>成色口径：Vestiaire Collective 五级</strong><p>未使用有标签、未使用、非常好、良好、一般。等级和具体瑕疵分开；其他平台不自动按同名等级换算。</p></div>`
      : "";
  return (
    `<div id="${root}"><div class="page-title"><div><h1>字典管理</h1><p>在这里维护一次，商品录入、筛选和发布资料共同使用。</p></div>${kind !== "CONDITION" ? button("新增" + dictionaryNames[kind], () => editDictionary(kind), "primary") : ""}</div><nav class="tabs">${Object.entries(
      dictionaryNames,
    )
      .map(
        ([k, l]) =>
          `<a class="${kind === k ? "active" : ""}" href="#/dictionaries?kind=${k}">${l}</a>`,
      )
      .join("")}</nav>${standard}` +
    section(
      dictionaryNames[kind],
      `<form class="filters"><input name="q" aria-label="搜索字典" placeholder="名称、英文名、别名" value="${esc(q)}"><button class="btn primary">搜索</button><span>共${data.total}项</span></form>` +
        table(
          ["标准名称", "别名", "说明", "状态", "关联商品", "操作"],
          data.rows.map((e) => [
            `<strong>${esc(optionText(e))}</strong>`,
            esc(e.aliases.join("、") || "—"),
            esc(e.description || "—"),
            e.active ? "启用" : "停用",
            String(e._count?.selections || 0),
            button("编辑", () => editDictionary(kind, e)),
          ]),
        ),
    ) +
    `<div class="pagination"><span>第${data.page}页</span>${data.page > 1 ? button("上一页", () => go({ page: String(data.page - 1) })) : ""}${data.page * data.size < data.total ? button("下一页", () => go({ page: String(data.page + 1) })) : ""}</div></div>`
  );
}
