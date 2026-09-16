import {
  request,
  can,
  esc,
  when,
  button,
  field,
  area,
  select,
  check,
  form,
  viewDialog,
  note,
  section,
  reload,
  iso,
} from "./core";
import type { Item, Asset } from "./types";
import { uploadImages } from "./media-uploader";
import { onPageReady } from "./page-lifecycle";
import { confirmedBatchActions as batchActions } from "./batch-actions";
export const mediaRoles: Record<string, string> = {
  PRODUCT: "商品实拍",
  DETAIL: "细节",
  DEFECT: "瑕疵",
  REFERENCE: "研究参考",
  DOCUMENT: "内部凭证",
  AI_MARKETING: "AI营销图",
};
const origins: Record<string, string> = {
  OWN: "自己拍摄",
  SUPPLIER: "供应商资料",
  REFERENCE: "研究参考",
  AI: "AI生成",
};
export function inspectImage(a: Asset) {
  viewDialog(
    a.originalName,
    `<img class="lightbox-image" src="/api/assets/${a.id}/preview" alt="${esc(a.originalName)}"><p>${esc(mediaRoles[a.role])} · ${esc(origins[a.origin])} · ${a.verified ? "已核验" : "待核验"}</p><p>${esc(a.sourceNote)}</p><a class="btn" href="/api/assets/${a.id}/original">下载原始文件</a>`,
  );
}
export function reviewImage(a: Asset) {
  form(
    "素材复核",
    select(
      "rights",
      "使用权",
      { INTERNAL: "仅内部", PUBLIC: "有权公开用于当前商品", REVOKED: "撤回" },
      a.rights,
    ) +
      check("verified", "已核对图片与实物一致", a.verified) +
      field(
        "validUntil",
        "授权截止（留空表示无固定截止）",
        a.validUntil
          ? new Date(
              new Date(a.validUntil).getTime() -
                new Date(a.validUntil).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)
          : "",
        "datetime-local",
      ) +
      area("sourceNote", "依据与权利说明", a.sourceNote),
    (d, k) =>
      request(
        `/assets/${a.id}/review`,
        "POST",
        {
          rights: String(d.get("rights")),
          verified: d.has("verified"),
          position: a.position,
          validUntil: d.get("validUntil") ? iso(d.get("validUntil")) : null,
          sourceNote: String(d.get("sourceNote")),
        },
        k,
      ),
  );
}
export function mediaPanel(i: Item) {
  const root = "media-" + crypto.randomUUID(),
    active = i.assets.filter((a) => !a.archived),
    archived = i.assets.filter((a) => a.archived),
    normal = active.filter((a) => a.role !== "DOCUMENT");
  const selected = new Set<string>();
  const move = async (a: Asset, index: number) => {
    const next = normal.map((v) => v.id);
    next.splice(next.indexOf(a.id), 1);
    next.splice(Math.max(0, index), 0, a.id);
    await request(`/items/${i.id}/image-order`, "POST", {
      expectedOrder: normal.map((v) => v.id),
      assetIds: next,
    });
    await reload();
  };
  const archive = (a: Asset) =>
    form(
      a.archived ? "恢复图片" : "移入存档",
      note(
        a.archived
          ? "恢复后回到内部待复核，不能直接公开使用。"
          : "原件和历史记录保留；所有仍引用此图的发布资料会停止取用。",
      ) +
        area(
          "reason",
          "原因",
          a.archived ? "重新采用这张图片" : "不再作为当前商品展示素材",
          2,
        ),
      (d, k) =>
        request(
          `/assets/${a.id}/archive`,
          "POST",
          { archived: !a.archived, reason: String(d.get("reason")) },
          k,
        ),
    );
  const classify = (a: Asset) =>
    form(
      "调整图片用途",
      note("调整后需重新复核；参考图、AI图不能改成实物图片。") +
        select(
          "role",
          "图片用途",
          Object.fromEntries(
            Object.entries(mediaRoles).filter(
              ([key]) => key !== "DOCUMENT" || can("finance"),
            ),
          ),
          a.role,
        ) +
        area("reason", "调整原因", "", 2),
      (d, k) =>
        request(
          `/assets/${a.id}/classify`,
          "POST",
          { role: String(d.get("role")), reason: String(d.get("reason")) },
          k,
        ),
    );
  const currentPublic = (a: Asset) =>
    !a.archived &&
    a.verified &&
    a.rights === "PUBLIC" &&
    (!a.validUntil || new Date(a.validUntil) > new Date());
  const imageState = (a: Asset) =>
    a.archived
      ? "已存档"
      : a.rights === "REVOKED"
        ? "授权已撤回"
        : a.validUntil && new Date(a.validUntil) <= new Date()
          ? "授权已过期"
          : !a.verified
            ? "待核验"
            : a.rights === "PUBLIC"
              ? "已核验 · 可公开使用"
              : "已核验 · 仅内部";
  const card = (a: Asset) =>
    `<article class="photo-card ${a.archived ? "archived" : ""}"><div class="photo-stage">${!a.archived ? `<label class="photo-check"><input type="checkbox" data-select-image="${a.id}" aria-label="选择 ${esc(a.originalName)}"></label>` : ""}<button type="button" class="photo-open" data-inspect="${a.id}"><img src="/api/assets/${a.id}/preview" alt="${esc(a.originalName)}" loading="lazy"></button>${a.id === active.find((v) => ["PRODUCT", "DETAIL"].includes(v.role))?.id && !a.archived ? '<span class="cover-label">列表封面</span>' : ""}</div><div class="photo-meta"><strong title="${esc(a.originalName)}">${esc(a.originalName)}</strong><span>${esc(mediaRoles[a.role])} · ${esc(origins[a.origin])}</span><span class="status-pill ${currentPublic(a) ? "good" : "muted"}">${imageState(a)}</span><small>${a.validUntil ? "授权至 " + when(a.validUntil) : ""}</small><div class="photo-actions">${can("review") && !a.archived ? button("复核", () => reviewImage(a)) : ""}${can("edit") && !a.archived && a.role !== "DOCUMENT" ? (["PRODUCT", "DETAIL"].includes(a.role) ? button("封面", () => move(a, 0)) : "") + button("前移", () => move(a, normal.indexOf(a) - 1)) + button("用途", () => classify(a)) : ""}${can("edit") ? button(a.archived ? "恢复" : "存档", () => archive(a)) : ""}</div></div></article>`;
  onPageReady(root, (el) => {
    const toolbar = el.querySelector<HTMLElement>(".selection-tools")!;
    const paint = () => {
      toolbar.innerHTML =
        `<span>已选 ${selected.size} 张</span>` +
        (can("review") && selected.size
          ? button("批量复核所选图片", () => {
              const rows = active.filter((a) => selected.has(a.id));
              if (
                rows.some(
                  (a) => !["PRODUCT", "DETAIL", "DEFECT"].includes(a.role),
                )
              )
                throw new Error(
                  "请只选择商品、细节和瑕疵实拍；参考资料和凭证需分别处理。",
                );
              form(
                "复核 " + rows.length + " 张实拍",
                `<div class="mini-photos">${rows.map((a) => `<img src="/api/assets/${a.id}/preview" alt="${esc(a.originalName)}">`).join("")}</div>` +
                  check("verified", "以上每张图片均已与实物核对一致") +
                  check("rights", "以上每张图片均有权用于本商品公开展示") +
                  area("sourceNote", "统一依据与授权说明", "", 3),
                async (d) => {
                  if (!d.has("verified") || !d.has("rights"))
                    throw new Error("需要逐张核对并确认使用权");
                  const sourceNote = String(d.get("sourceNote") || "").trim();
                  if (!sourceNote) throw new Error("请填写可追溯的依据");
                  setTimeout(
                    () =>
                      batchActions(
                        "图片复核结果",
                        rows.map((a) => ({
                          label: a.originalName,
                          run: (key: string) =>
                            request(
                              `/assets/${a.id}/review`,
                              "POST",
                              {
                                rights: "PUBLIC",
                                verified: true,
                                sourceNote,
                                validUntil: a.validUntil,
                                position: a.position,
                              },
                              key,
                            ),
                        })),
                      ),
                    0,
                  );
                  return { nextStep: true };
                },
                "确认并执行",
              );
            })
          : "");
    };
    el.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      if (target.dataset.selectImage) {
        if (target.checked) selected.add(target.dataset.selectImage);
        else selected.delete(target.dataset.selectImage);
        paint();
      }
    });
    el.addEventListener("click", (e) => {
      const t = (e.target as Element).closest<HTMLElement>("[data-inspect]");
      if (t) {
        const a = i.assets.find((a) => a.id === t.dataset.inspect);
        if (a) inspectImage(a);
      }
    });
    paint();
  });
  return (
    `<div id="${root}">` +
    section(
      "商品图片",
      note(
        "点图片看大图；多选图片可以集中复核。第一张实拍用于商品列表封面，存档不会删除原文件。",
      ) +
        `<div class="selection-tools"></div><div class="photo-grid">${active.map(card).join("")}</div>` +
        (!active.length
          ? '<div class="empty"><h3>先把现有图片放进来</h3><p>不要求重新拍摄；供应商资料也可以上传，随后核对来源和使用权。</p></div>'
          : ""),
      can("edit")
        ? button("＋ 上传图片", () => uploadImages(i), "primary")
        : "",
    ) +
    (archived.length
      ? `<details class="panel"><summary>已存档的图片 · ${archived.length}张</summary><div class="photo-grid">${archived.map(card).join("")}</div></details>`
      : "") +
    `</div>`
  );
}
