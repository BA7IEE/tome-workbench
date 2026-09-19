import { request, esc, money, when, viewDialog, can, button } from "./core";

export type CaptureIntegrity = {
  state: "COMPLETE" | "GAPS" | "UNVERIFIED";
  issues: string[];
  blockers: string[];
  fieldGaps?: { label: string; reason: string }[];
  imageGaps?: { label: string; reason: string }[];
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
const proposalLabels: Record<string, string> = {
  title: "商品名称",
  brand: "品牌匹配",
  category: "一级品类",
  "facts.material": "材质",
  "facts.color": "颜色",
  "facts.sizeLabel": "尺码",
  "facts.measurements": "尺寸文本",
  "facts.descriptionZh": "中文介绍",
};
const proposalMethods: Record<string, string> = {
  EXTRACTED: "原文提取",
  NORMALIZED: "规范化",
  TRANSLATED: "翻译整理",
  INFERRED: "推断",
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
function groupedGaps(gaps: { label: string; reason: string }[]) {
  const groups = new Map<string, string[]>();
  for (const gap of gaps)
    groups.set(gap.reason, [...(groups.get(gap.reason) || []), gap.label]);
  return [...groups]
    .map(
      ([reason, names]) =>
        `<li><strong>${esc(names.join("、"))}</strong><small>${esc(reason)}</small></li>`,
    )
    .join("");
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
    sourceLineNetAmount: number | null;
    sourceCurrentPrice: number | null;
    sourceEstimatedRetail: number | null;
    sourceFacts: unknown;
    proposal: unknown;
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
    images = Array.isArray(capture.images) ? capture.images.map(obj) : [],
    proposal = obj(c.proposal),
    agent = obj(proposal.agent),
    agentFields = Array.isArray(proposal.agentFields)
      ? proposal.agentFields.map(obj)
      : [];
  const fieldGaps = c.integrity.fieldGaps || [],
    imageGaps = c.integrity.imageGaps || [],
    structuredIssues = fieldGaps.length + imageGaps.length,
    storedLargest = c.assets.filter((asset) => {
      const declaration = images.find((image) => image.sha256 === asset.sha256);
      return ["ORIGINAL", "LARGEST_AVAILABLE"].includes(
        String(declaration?.quality || ""),
      );
    }).length,
    otherIssues = structuredIssues
      ? c.integrity.issues.filter(
          (issue) =>
            ![...fieldGaps, ...imageGaps].some(
              (gap) => issue === `${gap.label}：${gap.reason}`,
            ),
        )
      : c.integrity.issues;
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
  const proposalHtml = agentFields
    .map((field) => {
      const confidence = Number(field.confidence),
        evidencePaths = Array.isArray(field.evidencePaths)
          ? field.evidencePaths.map(String)
          : [],
        imageCount = Array.isArray(field.evidenceImageSha256)
          ? field.evidenceImageSha256.length
          : 0;
      return `<li><strong>${esc(proposalLabels[String(field.path)] || String(field.path))}</strong><p>${esc(readable(field.value))}</p><small>${esc(proposalMethods[String(field.method)] || String(field.method))} · 置信度 ${Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : "未标注"}${evidencePaths.length ? ` · 依据 ${esc(evidencePaths.join("、"))}` : ""}${imageCount ? ` · ${imageCount}张来源图` : ""}${field.note ? ` · ${esc(field.note)}` : ""}</small></li>`;
    })
    .join("");
  viewDialog(
    "商品来源资料",
    `<div class="source-evidence"><header><small>${esc(c.procurementSource.name)} · ${esc(c.sourceItemKey || "原货号未提供")}</small><h3>${esc(c.titleRaw)}</h3><p>${esc(integrityLabel(c.integrity))} · 已保存${c.integrity.storedImages}张${c.integrity.expectedImages === null ? "" : ` / 清单${c.integrity.expectedImages}张`}</p>${link(capture.pageUrl || facts.productUrl, "打开来源商品页面")}</header>
  ${storedLargest ? `<div class="notice"><strong>高清图已补采</strong><p>当前已保存${storedLargest}张平台可取得的最大图或原图；旧缩略图仍保留为历史来源证据，不再算作当前图片缺项。</p></div>` : ""}
  ${fieldGaps.length ? `<div class="notice warning"><strong>当前仍缺 ${fieldGaps.length} 项来源字段</strong><ul>${groupedGaps(fieldGaps)}</ul></div>` : ""}
  ${imageGaps.length ? `<div class="notice warning"><strong>当前仍有图片缺项</strong><ul>${groupedGaps(imageGaps)}</ul></div>` : ""}
  ${otherIssues.length ? `<div class="notice warning"><strong>其他需要留意</strong><ul>${otherIssues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
  ${proposalHtml ? `<div class="notice"><strong>外部Agent整理建议</strong><p>${esc(String(agent.generator || "Agent"))}${agent.model ? ` · ${esc(String(agent.model))}` : ""}${agent.generatedAt ? ` · ${esc(when(String(agent.generatedAt)))}` : ""}。以下是面向 ToMe 字段的建议，不是来源事实；人工确认候选后才会采用。</p><ul>${proposalHtml}</ul></div>` : ""}
  <div class="evidence-gallery">${gallery || "<p>尚未保存来源图片</p>"}</div>
  <dl class="evidence-facts"><div><dt>品牌原文</dt><dd>${esc(c.brandRaw || "未提供")}</dd></div><div><dt>来源品类</dt><dd>${esc(c.categoryRaw || "未提供")}</dd></div><div><dt>来源成色</dt><dd>${esc(c.conditionRaw || "未提供")}</dd></div><div><dt>来源状态</dt><dd>${esc(c.statusRaw || "未提供")}</dd></div>${factsHtml}</dl>
  ${can("supply") ? `<div class="evidence-prices"><span>订单行原价 ${esc(money(c.sourceLineAmount, c.currency))}</span><span>订单行折后金额 ${esc(money(c.sourceLineNetAmount, c.currency))}</span><span>平台当前价 ${esc(money(c.sourceCurrentPrice, c.currency))}</span><span>估计零售价 ${esc(money(c.sourceEstimatedRetail, c.currency))}</span></div>` : ""}
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
