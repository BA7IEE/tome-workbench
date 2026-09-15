import { dialog, esc, viewDialog } from "./core";
import type { Asset } from "./types";

export const productImages = (assets: Asset[]) =>
  assets.filter((a) => !a.archived && a.role !== "DOCUMENT");

/** Viewing originals uses the authenticated media endpoint; it never changes rights or bytes. */
export function showProductImages(assets: Asset[], firstId: string) {
  const list = productImages(assets);
  if (!list.length) return;
  let index = Math.max(
    0,
    list.findIndex((a) => a.id === firstId),
  );
  let url = "",
    generation = 0;
  const scope = new AbortController();
  viewDialog("查看商品图片", '<div class="product-image-viewer"></div>');
  const root = dialog.querySelector<HTMLElement>(".product-image-viewer")!;
  dialog.classList.add("product-image-dialog");
  const release = () => {
    if (url) URL.revokeObjectURL(url);
    url = "";
  };
  const paint = () => {
    generation++;
    release();
    const a = list[index];
    root.innerHTML = `<div class="image-viewer-toolbar"><button type="button" class="btn" data-image-prev ${index === 0 ? "disabled" : ""}>上一张</button><span role="status">${index + 1} / ${list.length}</span><button type="button" class="btn" data-image-next ${index === list.length - 1 ? "disabled" : ""}>下一张</button><button type="button" class="btn" data-image-original>查看原图</button><button type="button" class="btn" data-image-zoom aria-pressed="false">放大</button><a class="btn" href="/api/assets/${a.id}/original" download="${esc(a.originalName)}">下载原图</a></div><div class="image-viewer-stage"><img src="/api/assets/${a.id}/preview" alt="${esc(a.originalName)}"></div><p class="image-viewer-name">${esc(a.originalName)}</p><p class="form-error" role="alert"></p>`;
    root.querySelector("img")!.addEventListener(
      "error",
      () => {
        root.querySelector(".form-error")!.textContent =
          "图片读取失败，可以重试查看原图或下载原文件。";
      },
      { signal: scope.signal },
    );
  };
  const move = (delta: number) => {
    if (index + delta < 0 || index + delta >= list.length) return;
    index += delta;
    paint();
    root.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  };
  root.addEventListener(
    "click",
    async (event) => {
      const target = (event.target as Element).closest<HTMLElement>("button");
      if (!target) return;
      if (target.hasAttribute("data-image-prev")) move(-1);
      else if (target.hasAttribute("data-image-next")) move(1);
      else if (target.hasAttribute("data-image-zoom")) {
        const enlarged = root
          .querySelector(".image-viewer-stage")!
          .classList.toggle("enlarged");
        target.textContent = enlarged ? "适应窗口" : "放大";
        target.setAttribute("aria-pressed", String(enlarged));
      } else if (target.hasAttribute("data-image-original")) {
        const current = ++generation;
        (target as HTMLButtonElement).disabled = true;
        target.textContent = "正在读取原图…";
        try {
          const r = await fetch(`/api/assets/${list[index].id}/original`, {
            signal: scope.signal,
          });
          if (!r.ok) throw new Error("原图读取失败，请检查登录状态后重试。");
          const blob = await r.blob();
          if (
            current !== generation ||
            !root.isConnected ||
            scope.signal.aborted
          )
            return;
          release();
          url = URL.createObjectURL(blob);
          root.querySelector("img")!.src = url;
          root.querySelector(".form-error")!.textContent = "";
          target.textContent = "正在查看原图";
        } catch (e) {
          if (
            current !== generation ||
            !root.isConnected ||
            scope.signal.aborted
          )
            return;
          root.querySelector(".form-error")!.textContent = (e as Error).message;
          target.textContent = "重试原图";
          (target as HTMLButtonElement).disabled = false;
        }
      }
    },
    { signal: scope.signal },
  );
  dialog.addEventListener(
    "keydown",
    (event) => {
      if (!root.isConnected) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }
    },
    { signal: scope.signal },
  );
  dialog.addEventListener(
    "close",
    () => {
      scope.abort();
      release();
      dialog.classList.remove("product-image-dialog");
    },
    { once: true },
  );
  paint();
}
