import { request, esc, money, when, viewDialog, can, button } from "./core";

export type CaptureIntegrity = {
  state: "COMPLETE" | "GAPS" | "UNVERIFIED";
  issues: string[];
  blockers: string[];
  expectedImages: number | null;
  storedImages: number;
};
export function integrityLabel(i?: CaptureIntegrity) {
  return i?.state === "COMPLETE"
    ? "清单已核对"
    : i?.state === "GAPS"
      ? "资料有缺项"
      : "完整性未核验";
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const labels: Record<string, string> = {
  description: "商品描述",
  descriptionRaw: "原文描述",
  descriptionEn: "英文描述",
  descriptionZh: "中文描述",
  sizeLabel: "标签尺码",
  size: "尺码",
  color: "颜色",
  colorRaw: "颜色原文",
  material: "材质",
  materialRaw: "材质原文",
  measurements: "尺寸参数",
  measurementsEstimated: "尺寸是否估测",
  productUrl: "商品页面",
  url: "来源页面",
  designer: "设计师",
  year: "年份",
  season: "季节",
  care: "养护说明",
  attributes: "其他参数",
  accessories: "随附物品",
};
function readable(v: unknown): string {
  if (v == null || v === "") return "未提供";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (Array.isArray(v)) return v.map(readable).join("；");
  if (typeof v === "object")
    return Object.entries(obj(v))
      .map(([k, x]) => `${labels[k] || k}：${readable(x)}`)
      .join("\n");
  return String(v);
}
function link(url: unknown, label: string) {
  return typeof url === "string" && /^https?:\/\//i.test(url)
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`
    : "";
}
export async function showSourceEvidence(id: string) {
  const c = await request<{
    titleRaw: string;
    sourceItemKey: string;
    brandRaw: string;
    categoryRaw: string;
    conditionRaw: string;
    statusRaw: string;
    currency: string;
    sourceLineAmount: number | null;
    sourceCurrentPrice: number | null;
    sourceEstimatedRetail: number | null;
    sourceFacts: unknown;
    rawPayload: unknown;
    procurementSource: { name: string };
    assets: {
      id: string;
      sourceUrl: string;
      originalName: string;
      sha256: string;
      size: number;
    }[];
    integrity: CaptureIntegrity;
    revisions: unknown[];
  }>(`/ingest/candidates/${id}`);
  const facts = obj(c.sourceFacts),
    capture = obj(facts.capture),
    images = Array.isArray(capture.images) ? capture.images.map(obj) : [];
  const gallery = c.assets
    .map((a, n) => {
      const declaration = images.find((i) => i.sha256 === a.sha256),
        quality = declaration
          ? (
              {
                ORIGINAL: "原图",
                LARGEST_AVAILABLE: "平台可取得的最大图",
                THUMBNAIL: "缩略图",
              } as Record<string, string>
            )[String(declaration.quality)]
          : "分辨率来源未核验";
      return `<figure><a href="/api/ingest/candidate-assets/${a.id}/original" target="_blank" rel="noopener"><img src="/api/ingest/candidate-assets/${a.id}/original" alt="${esc(c.titleRaw)} · 来源图${n + 1}" loading="lazy"></a><figcaption>第${n + 1}张 · ${esc(quality)}${declaration?.width ? ` · ${esc(declaration.width)} × ${esc(declaration.height)}` : ""} · ${(a.size / 1024).toFixed(0)} KB<br><a href="/api/ingest/candidate-assets/${a.id}/original" target="_blank" rel="noopener">查看原文件</a> ${link(a.sourceUrl, "来源图片地址")}</figcaption></figure>`;
    })
    .join("");
  const fieldNames = new Map(
    (Array.isArray(capture.fields) ? capture.fields.map(obj) : []).map((f) => [
      String(f.path).replace(/^sourceFacts\./, ""),
      String(f.label),
    ]),
  );
  const factsHtml = Object.entries(facts)
    .filter(([k]) => k !== "capture")
    .map(
      ([k, v]) =>
        `<div><dt>${esc(fieldNames.get(k) || labels[k] || k)}</dt><dd>${esc(readable(v))}</dd></div>`,
    )
    .join("");
  viewDialog(
    "商品来源资料",
    `<div class="source-evidence"><header><small>${esc(c.procurementSource.name)} · ${esc(c.sourceItemKey || "原货号未提供")}</small><h3>${esc(c.titleRaw)}</h3><p>${esc(integrityLabel(c.integrity))} · 已保存${c.integrity.storedImages}张${c.integrity.expectedImages === null ? "" : ` / 清单${c.integrity.expectedImages}张`}</p>${link(capture.pageUrl || facts.productUrl, "打开来源商品页面")}</header>
  ${c.integrity.issues.length ? `<div class="notice warning"><strong>需要留意</strong><ul>${c.integrity.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
  <div class="evidence-gallery">${gallery || "<p>尚未保存来源图片</p>"}</div>
  <dl class="evidence-facts"><div><dt>品牌原文</dt><dd>${esc(c.brandRaw || "未提供")}</dd></div><div><dt>来源品类</dt><dd>${esc(c.categoryRaw || "未提供")}</dd></div><div><dt>来源成色</dt><dd>${esc(c.conditionRaw || "未提供")}</dd></div><div><dt>来源状态</dt><dd>${esc(c.statusRaw || "未提供")}</dd></div>${factsHtml}</dl>
  ${can("supply") ? `<div class="evidence-prices"><span>订单行金额 ${esc(money(c.sourceLineAmount, c.currency))}</span><span>平台当前价 ${esc(money(c.sourceCurrentPrice, c.currency))}</span><span>估计零售价 ${esc(money(c.sourceEstimatedRetail, c.currency))}</span></div>` : ""}
  ${capture.capturedAt ? `<small>来源采集时间：${esc(when(String(capture.capturedAt)))}</small>` : ""}<p>图片保存在中台；来源清单核对不等于独立证明网页没有遗漏。资料缺失与是否可售分别管理。</p>
  <details><summary>查看原始证据与修订</summary><small>${c.revisions.length}个最近修订；来源数据不会覆盖人工维护的商品内容。</small><pre class="json-view">${esc(JSON.stringify(c.rawPayload, null, 2))}</pre><pre class="json-view">${esc(JSON.stringify(capture, null, 2))}</pre></details></div>`,
  );
}
export async function itemEvidenceLinks(itemId: string) {
  const rows = await request<
    { id: string; sourceItemKey: string; procurementSource: { name: string } }[]
  >(`/ingest/items/${itemId}/evidence`);
  return rows;
}

export async function showItemEvidence(itemId: string) {
  const rows = await itemEvidenceLinks(itemId);
  if (rows.length === 1) return showSourceEvidence(rows[0].id);
  viewDialog(
    "全部来源资料",
    rows.length
      ? rows
          .map(
            (r) =>
              `<p>${button(`${r.procurementSource.name} · ${r.sourceItemKey || "来源记录"}`, () => showSourceEvidence(r.id))}</p>`,
          )
          .join("")
      : "<p>这件商品尚无Agent导入的来源记录。手工资料和素材保留在当前商品中。</p>",
  );
}
