import {
  request,
  field,
  select,
  area,
  form,
  dialog,
  note,
  text,
  esc,
  table,
  currencies,
} from "./core";
import type { Supplier } from "./types";
import { categories } from "./types";
import { parseTable } from "./source-fields";
export function singleSource(suppliers: Supplier[]) {
  const generated = "MANUAL:" + crypto.randomUUID();
  form(
    "记录一件货源",
    note(
      "先保存原始信息，接手建档后才分配TM编号。供货报价不自动当作采购成本。",
    ) +
      field("title", "商品名称", "", "text", true) +
      field("supplierCode", "原货号（没有可留空）") +
      select("supplierId", "供货方", {
        "": "自有 / 未指定",
        ...Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
      }) +
      field("brand", "品牌") +
      select("category", "品类", categories, "OTHER") +
      field(
        "quotedCost",
        "供货报价（可留空）",
        "",
        "text",
        false,
        'inputmode="decimal"',
      ) +
      select("currency", "币种", currencies, "CNY") +
      field("sourceUrl", "原始商品链接（可留空）", "", "url") +
      area("notes", "商品信息或聊天记录摘录", "", 6),
    async (d, k) => {
      const supplierId = text(d, "supplierId"),
        ref = text(d, "supplierCode");
      return request(
        "/supply/sources/import",
        "POST",
        [
          {
            sourceKey: ref ? (supplierId || "OWN") + ":" + ref : generated,
            title: text(d, "title"),
            ...(supplierId ? { supplierId } : {}),
            payload: {
              supplierCode: ref,
              brand: text(d, "brand"),
              category: text(d, "category"),
              quotedCost: text(d, "quotedCost"),
              currency: text(d, "currency"),
              sourceUrl: text(d, "sourceUrl"),
              notes: text(d, "notes"),
            },
          },
        ],
        k,
      );
    },
  );
}
const actionNames: Record<string, string> = {
  CREATE: "新货源",
  UNCHANGED: "内容相同，不重复写入",
  NEW_REVISION: "保留新修订",
  DUPLICATE_IN_BATCH: "同批编号重复，请修正",
};
export function importSources(suppliers: Supplier[]) {
  form(
    "导入表格 · 先预览",
    note(
      "可以从Excel复制整块表格（包含列名），或选择UTF-8的CSV/TSV文件。至少包含商品名称和原货号；支持中文列名。每批最多300条。",
    ) +
      select("supplierId", "统一指定供货方", {
        "": "自有 / 未指定",
        ...Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
      }) +
      field(
        "prefix",
        "来源名称（同一来源重复导入时保持一致）",
        "闲鱼库存",
        "text",
        true,
      ) +
      field(
        "file",
        "选择表格文件",
        "",
        "file",
        false,
        'accept=".csv,.tsv,.txt"',
      ) +
      area("raw", "粘贴表格内容", "原货号\t商品名称\t品牌\t品类\t备注\n", 10),
    async (d) => {
      const raw = text(d, "raw");
      if (new Blob([raw]).size > 800000)
        throw new Error("本批文本过大，请拆成更小的批次");
      const supplierId = text(d, "supplierId"),
        prefix = text(d, "prefix").trim();
      if (!prefix) throw new Error("请填写稳定的来源名称");
      const parsed = parseTable(raw),
        rows = parsed.map((p, n) => {
          const ref =
              p.sourceKey ||
              p.来源键 ||
              p.原货号 ||
              p.货号 ||
              p.编号 ||
              p.supplierCode,
            title = p.title || p.商品名称 || p.名称 || p.标题;
          if (!ref?.trim() || !title?.trim())
            throw new Error(`第${n + 2}行缺少原货号或商品名称`);
          return {
            sourceKey:
              p.sourceKey ||
              p.来源键 ||
              `${supplierId || prefix}:${ref.trim()}`,
            title: title.trim(),
            ...(supplierId ? { supplierId } : {}),
            payload: p,
          };
        });
      const preview = await request<
        { sourceKey: string; title: string; action: string }[]
      >("/supply/sources/preview", "POST", rows);
      setTimeout(
        () =>
          form(
            "核对后导入货源",
            note(`本批${rows.length}条，只写入货源池，不覆盖已经维护的商品。`) +
              table(
                ["原始编号", "商品", "处理"],
                preview.map((p) => [
                  esc(p.sourceKey),
                  esc(p.title),
                  esc(actionNames[p.action] || p.action),
                ]),
              ),
            async (_d, k) => {
              if (preview.some((p) => p.action === "DUPLICATE_IN_BATCH"))
                throw new Error("存在同批重复编号，请返回修正");
              return request("/supply/sources/import", "POST", rows, k);
            },
            "确认导入",
          ),
        0,
      );
      return { nextStep: true };
    },
    "生成预览",
  );
  const file = dialog.querySelector<HTMLInputElement>('[name="file"]')!;
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    const error = dialog.querySelector<HTMLElement>(".form-error")!;
    try {
      if (f.size > 800000) throw new Error("文件过大，请拆分成300行以内的表格");
      const content = await f.text();
      if (content.includes("\uFFFD"))
        throw new Error("文件编码无法正常识别，请直接从Excel复制表格并粘贴");
      (dialog.querySelector('[name="raw"]') as HTMLTextAreaElement).value =
        content;
    } catch (e) {
      error.textContent = (e as Error).message;
    }
  });
}
