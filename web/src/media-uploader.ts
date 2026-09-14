import { onDialogClosed } from "./core";
import {
  viewDialog,
  ApiError,
  dialog,
  field,
  select,
  area,
  can,
  esc,
  reload,
  reauthenticate,
  uploadWithProgress,
} from "./core";
import type { Item } from "./types";
export function uploadImages(item: Item) {
  type Job = {
    file: File;
    key: string;
    url: string;
    state: string;
    progress: number;
    error: string;
    data?: FormData;
    uncertain?: boolean;
  };
  const jobs: Job[] = [];
  let running = false,
    hasSuccess = false;
  const roles = {
    PRODUCT: "商品实拍",
    DETAIL: "细节",
    DEFECT: "瑕疵",
    REFERENCE: "研究参考",
    AI_MARKETING: "AI营销图",
    ...(can("finance") ? { DOCUMENT: "内部凭证" } : {}),
  };
  viewDialog(
    "上传图片 · " + item.code,
    `<div class="upload-drop" tabindex="0">${field("files", "选择图片", "", "file", false, 'multiple accept="image/jpeg,image/png,image/webp"')}<p>可多选、拖入，或粘贴剪贴板图片。每张不超过20MB。</p></div><div class="form-grid">${select("role", "用途", roles, "PRODUCT")}${select("origin", "来源", { OWN: "自己拍摄", SUPPLIER: "供应商提供", REFERENCE: "参考资料", AI: "AI营销图" }, "OWN")}${area("sourceNote", "来源与授权说明", "", 2)}</div><div id="upload-queue"></div><div class="button-row"><button id="upload-start" class="btn primary" disabled>开始上传</button><button type="button" class="btn" id="upload-login" hidden>重新登录并保留输入</button><span id="upload-summary" role="status"></span></div>`,
  );
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!,
    drop = dialog.querySelector<HTMLElement>(".upload-drop")!,
    start = dialog.querySelector<HTMLButtonElement>("#upload-start")!,
    login = dialog.querySelector<HTMLButtonElement>("#upload-login")!;
  const paint = () => {
    dialog.querySelector("#upload-queue")!.innerHTML = jobs
      .map(
        (j, n) =>
          `<div class="upload-job"><img src="${j.url}" alt="待上传图片"><div><strong>${esc(j.file.name)}</strong><small>${(j.file.size / 1024 / 1024).toFixed(1)} MB · ${esc(j.state)}</small><progress value="${j.progress}" max="100"></progress><small class="form-error">${esc(j.error)}</small></div><button class="btn subtle" data-remove-upload="${n}" ${running || j.state === "已保存" ? "disabled" : ""}>移除</button></div>`,
      )
      .join("");
    dialog.querySelector("#upload-summary")!.textContent =
      `已保存 ${jobs.filter((j) => j.state === "已保存").length} / ${jobs.length}`;
    start.disabled =
      running || jobs.length === 0 || jobs.every((j) => j.state === "已保存");
  };
  login.addEventListener("click", async () => {
    if (running) return;
    running = true;
    paint();
    try {
      await reauthenticate();
      login.hidden = true;
    } catch {
      // Closing the login dialog keeps the original queue and recovery action.
    } finally {
      running = false;
      paint();
    }
  });
  const add = (files: File[]) => {
    for (const file of files) {
      if (jobs.length >= 100) break;
      const bad =
        file.size > 20 * 1024 * 1024 ||
        !/[.](jpe?g|png|webp)$/i.test(file.name);
      jobs.push({
        file,
        key: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        state: bad ? "不支持" : "待上传",
        progress: 0,
        error: bad ? "请选择20MB以内的JPEG、PNG或WebP" : "",
      });
    }
    paint();
  };
  input.addEventListener("change", () => add([...(input.files || [])]));
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    if (!running) add([...(e.dataTransfer?.files || [])]);
  });
  const paste = (e: ClipboardEvent) => {
    if (!running && e.clipboardData?.files.length) {
      e.preventDefault();
      add([...e.clipboardData.files]);
    }
  };
  dialog.addEventListener("paste", paste);
  dialog.querySelector("#upload-queue")!.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>(
      "[data-remove-upload]",
    );
    if (!b || running) return;
    const n = Number(b.dataset.removeUpload);
    URL.revokeObjectURL(jobs[n].url);
    jobs.splice(n, 1);
    paint();
  });
  start.addEventListener("click", async () => {
    if (running) return;
    running = true;
    dialog.querySelector<HTMLButtonElement>(".close")!.disabled = true;
    for (const el of dialog.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input,select,textarea"))
      el.disabled = true;
    try {
      for (const j of jobs) {
        if (j.state === "已保存" || j.state === "不支持") continue;
        if (!j.data) {
          const d = new FormData();
          d.set("file", j.file);
          d.set("itemId", item.id);
          for (const key of ["role", "origin", "sourceNote"])
            d.set(
              key,
              (dialog.querySelector(`[name="${key}"]`) as HTMLInputElement)
                .value,
            );
          j.data = d;
        }
        j.state = "上传中";
        j.error = "";
        paint();
        try {
          await uploadWithProgress("/assets/upload", j.data, j.key, (p) => {
            j.progress = p;
            j.state = p === 100 ? "正在保存原件" : "上传中";
            paint();
          });
          j.state = "已保存";
          j.uncertain = false;
          hasSuccess = true;
        } catch (e) {
          const uncertain =
            j.uncertain ||
            (e instanceof ApiError &&
              (e.status === 0 ||
                e.status >= 500 ||
                e.code === "IDEMPOTENCY_CONFLICT"));
          j.uncertain = uncertain;
          j.state = uncertain ? "结果待确认" : "未保存";
          j.error =
            (e as Error).message +
            (uncertain
              ? " 请重试核对原提交，不会采用后来修改的来源字段。"
              : " 可以修正上方来源或用途后再提交。");
          if (!uncertain) {
            j.data = undefined;
            j.key = crypto.randomUUID();
          }
          if (
            e instanceof ApiError &&
            (e.status === 401 ||
              e.code === "ACCOUNT_REVOKED" ||
              e.code === "CSRF_INVALID")
          ) {
            login.hidden = false;
            break;
          }
        }
        paint();
      }
    } finally {
      running = false;
      dialog.querySelector<HTMLButtonElement>(".close")!.disabled = false;
      for (const el of dialog.querySelectorAll<
        HTMLInputElement | HTMLSelectElement
      >("input,select,textarea"))
        el.disabled = false;
      start.textContent = "重试未完成图片";
      paint();
    }
  });
  dialog.oncancel = (e) => {
    if (
      running ||
      (jobs.some((j) => j.state !== "已保存") &&
        !window.confirm(
          "还有未完成的上传。关闭不会撤销服务器已收到的操作，确定关闭？",
        ))
    )
      e.preventDefault();
  };
  onDialogClosed(() => {
    for (const j of jobs) URL.revokeObjectURL(j.url);
    dialog.removeEventListener("paste", paste);
    if (hasSuccess) void reload();
  });
}
