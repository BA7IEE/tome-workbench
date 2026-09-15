import { request, esc, can, toast } from "./core";
import { showProductImages } from "./product-images";
import { WriteAttempt } from "./write-attempt";
import type { Item, Asset } from "./types";
export function studioGallery(assets: Asset[], itemId = "") {
  const list = assets.filter((a) => !a.archived && a.role !== "DOCUMENT");
  return `<h2>已保存图片 · ${list.length} 张</h2>${can("edit") ? '<p class="note">设封面、标瑕疵和移除会立即保存；取消文字编辑不会撤销这些图片操作。新上传图片随商品保存。</p>' : ""}<div class="studio-gallery">${list.map((a, n) => `<article class="studio-photo" data-asset="${a.id}"><button type="button" class="studio-zoom" data-photo-view="${a.id}" aria-label="查看图片 ${esc(a.originalName)}"><img src="/api/assets/${a.id}/preview" alt="${esc(a.originalName)}" loading="lazy"></button><span>${n === 0 ? "封面 · " : ""}${({ PRODUCT: "实拍", DETAIL: "细节", DEFECT: "瑕疵", REFERENCE: "参考", AI_MARKETING: "AI素材" } as Record<string, string>)[a.role] || "图片"}</span>${can("edit") ? `<div class="studio-photo-tools"><button type="button" data-photo-first="${a.id}" ${n === 0 ? "disabled" : ""}>设封面</button><button type="button" data-photo-defect="${a.id}" ${a.role === "DEFECT" ? "disabled" : ""}>标瑕疵</button><button type="button" data-photo-remove="${a.id}">移除</button></div>` : ""}</article>`).join("")}</div>${itemId ? `<a class="studio-media-records" href="#/items/${itemId}?tab=assets">更多素材操作</a>` : ""}<p class="studio-media-error form-error" role="alert"></p><button type="button" class="btn" data-photo-retry hidden>核对图片操作</button>`;
}
export function bindStudioMedia(
  root: HTMLElement,
  signal: AbortSignal,
  get: () => Item,
  changed: () => void,
) {
  const attempt = new WriteAttempt(request);
  let busy = false,
    lastError = "",
    refreshPending = false;
  const paint = () => {
    const el = root.querySelector<HTMLElement>(".entry-existing-media");
    if (el) {
      const drop = root.querySelector<HTMLElement>(".entry-drop");
      drop?.remove();
      el.innerHTML = studioGallery(get().assets, get().id);
      const empty =
        get().assets.filter((a) => !a.archived && a.role !== "DOCUMENT")
          .length === 0;
      el.hidden = empty;
      if (drop) {
        if (empty) el.after(drop);
        else el.querySelector(".studio-gallery")!.append(drop);
      }
      if (busy || attempt.uncertain || refreshPending)
        for (const b of el.querySelectorAll<HTMLButtonElement>(
          ".studio-photo-tools button",
        ))
          b.disabled = true;
      el.querySelector(".studio-media-error")!.textContent = lastError;
      el.querySelector<HTMLButtonElement>("[data-photo-retry]")!.hidden = !(
        attempt.uncertain || refreshPending
      );
      if (lastError) el.hidden = false;
    }
  };
  const refresh = async () => {
    const latest = await request<Item>(`/items/${get().id}`);
    get().assets = latest.assets;
    refreshPending = false;
    lastError = "";
    paint();
    changed();
  };
  const fail = (e: unknown) => {
    lastError = (e as Error).message;
    paint();
  };
  root.addEventListener(
    "click",
    async (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>(
        "[data-photo-view],[data-photo-first],[data-photo-defect],[data-photo-remove],[data-photo-retry]",
      );
      if (!btn) return;
      e.preventDefault();
      const item = get(),
        id =
          btn.dataset.photoView ||
          btn.dataset.photoFirst ||
          btn.dataset.photoDefect ||
          btn.dataset.photoRemove;
      if (btn.dataset.photoView) {
        showProductImages(item.assets, id!);
        return;
      }
      if (busy) return;
      busy = true;
      lastError = "";
      for (const b of root.querySelectorAll<HTMLButtonElement>(
        ".studio-photo-tools button",
      ))
        b.disabled = true;
      try {
        if (attempt.uncertain) {
          await attempt.retry();
          refreshPending = true;
          await refresh();
          return;
        }
        if (btn.hasAttribute("data-photo-retry")) {
          if (refreshPending) await refresh();
          return;
        }
        const a = item.assets.find((a) => a.id === id);
        if (!a) throw new Error("图片已变化，请重新读取");
        if (btn.dataset.photoRemove) {
          if (
            !window.confirm(
              "从当前商品展示中移除这张图片？原件保留，可在素材记录中恢复。",
            )
          )
            return;
          await attempt.run(`/assets/${id}/archive`, {
            archived: true,
            reason: "商品工作区移除展示图片",
          });
        } else if (btn.dataset.photoDefect) {
          await attempt.run(`/assets/${id}/classify`, {
            role: "DEFECT",
            reason: "经营者在商品工作区标记为瑕疵实拍",
          });
        } else {
          const all = item.assets
            .filter((a) => !a.archived && a.role !== "DOCUMENT")
            .map((a) => a.id);
          await attempt.run(`/items/${item.id}/image-order`, {
            expectedOrder: all,
            assetIds: [id, ...all.filter((a) => a !== id)],
          });
        }
        refreshPending = true;
        await refresh();
        toast("图片已更新，原件保留");
      } catch (error) {
        fail(error);
      } finally {
        busy = false;
        paint();
      }
    },
    { signal },
  );
  paint();
  return {
    paint,
    busy: () => busy,
    uncertain: () => attempt.uncertain || refreshPending,
  };
}
