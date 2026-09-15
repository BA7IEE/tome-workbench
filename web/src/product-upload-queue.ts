import { ApiError, esc, select, uploadWithProgress, me } from "./core";
import { readWork, saveWork } from "./work-storage";
type ImageJob = {
  file: File;
  preview: string;
  key: string;
  state: string;
  error: string;
  progress: number;
  input?: FormData;
  uncertain?: boolean;
};
/** Files stay in this page until the operator saves; the item is never recreated on upload retry. */
export class ProductUploadQueue {
  private owner = me?.id || "";
  private itemId = "";
  private storageKey() {
    return `images:${this.owner}:${this.itemId}`;
  }
  async restore(itemId: string) {
    this.itemId = itemId;
    const saved = await readWork<
      (Omit<ImageJob, "preview" | "input"> & {
        input?: [string, FormDataEntryValue][];
      })[]
    >(this.storageKey());
    this.jobs = (saved || []).map((j) => ({
      ...j,
      state: j.state === "上传中" ? "结果待确认" : j.state,
      uncertain: j.uncertain || j.state === "上传中",
      preview: URL.createObjectURL(j.file),
      input: j.input
        ? j.input.reduce((f, [k, v]) => {
            f.append(k, v);
            return f;
          }, new FormData())
        : undefined,
    }));
  }
  private persist() {
    if (!this.itemId || !this.owner) return Promise.resolve();
    const pending = this.jobs
      .filter((j) => j.state !== "已保存")
      .map((j) => ({
        file: j.file,
        key: j.key,
        state: j.state,
        error: j.error,
        progress: j.progress,
        uncertain: j.uncertain,
        input: j.input ? [...j.input.entries()] : undefined,
      }));
    return saveWork(this.storageKey(), pending.length ? pending : undefined);
  }
  private jobs: ImageJob[] = [];
  private root: HTMLElement | null = null;
  private running = false;
  get pending() {
    return this.jobs.some((j) => j.state !== "已保存");
  }
  clearCompleted() {
    for (const j of this.jobs.filter((j) => j.state === "已保存"))
      URL.revokeObjectURL(j.preview);
    this.jobs = this.jobs.filter((j) => j.state !== "已保存");
    this.paint();
  }
  get hasFiles() {
    return this.jobs.length > 0;
  }
  markup(origin = "OWN") {
    return `<section class="panel entry-photos"><h2>商品图片</h2><p class="note">拖入图片或点击上传；保存时一起处理。</p>${select("entryImageOrigin", "本批图片来源", { OWN: "自己拍摄", SUPPLIER: "供应商提供" }, origin)}<label class="field studio-file-input"><span>选择商品图片</span><input type="file" name="entryPhotos" accept="image/jpeg,image/png,image/webp" multiple></label><div class="entry-drop" role="button" tabindex="0" aria-label="点击或拖入商品图片"><strong>＋ 添加图片</strong><span>点击选择，或拖到这里</span><small>JPG / PNG / WebP · 每张20MB以内</small></div><div class="entry-file-list"></div><p class="entry-file-error form-error" role="alert"></p><p class="entry-file-summary" role="status"></p></section>`;
  }
  bind(el: HTMLElement, signal: AbortSignal, changed: () => void) {
    this.root = el;
    const input = el.querySelector<HTMLInputElement>('[name="entryPhotos"]')!;
    const add = (files: File[]) => {
      if (this.running) return;
      let total = this.jobs.reduce((s, j) => s + j.file.size, 0);
      for (const file of files) {
        if (this.jobs.length >= 100 || total + file.size > 200 * 1024 * 1024) {
          this.error("本次最多100张、合计200MB，请先保存后分批添加");
          break;
        }
        if (
          !/\.(jpe?g|png|webp)$/i.test(file.name) ||
          file.size > 20 * 1024 * 1024
        ) {
          this.error(`${file.name}：请选择20MB以内的JPG、PNG或WebP`);
          continue;
        }
        if (
          this.jobs.some(
            (j) =>
              j.file.name === file.name &&
              j.file.size === file.size &&
              j.file.lastModified === file.lastModified,
          )
        )
          continue;
        total += file.size;
        this.jobs.push({
          file,
          preview: URL.createObjectURL(file),
          key: crypto.randomUUID(),
          state: "等待保存",
          error: "",
          progress: 0,
        });
      }
      input.value = "";
      this.paint();
      changed();
    };
    input.addEventListener("change", () => add(Array.from(input.files || [])), {
      signal,
    });
    const drop = el.querySelector<HTMLElement>(".entry-drop")!;
    drop.addEventListener("click", () => input.click(), { signal });
    drop.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          input.click();
        }
      },
      { signal },
    );
    el.addEventListener(
      "paste",
      (e) => {
        const images = Array.from(e.clipboardData?.files || []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (images.length) {
          e.preventDefault();
          add(images);
        }
      },
      { signal },
    );
    drop.addEventListener(
      "dragover",
      (e) => {
        e.preventDefault();
      },
      { signal },
    );
    drop.addEventListener(
      "drop",
      (e) => {
        e.preventDefault();
        add(Array.from(e.dataTransfer?.files || []));
      },
      { signal },
    );
    el.addEventListener(
      "click",
      (e) => {
        const button = (e.target as Element).closest<HTMLElement>(
          "[data-remove-entry-file]",
        );
        if (!button || this.running) return;
        const n = Number(button.dataset.removeEntryFile),
          job = this.jobs[n];
        if (!job || job.state === "已保存") return;
        if (
          job.state === "结果待确认" &&
          !window.confirm(
            "此图片可能已保存，移除不会撤销服务器操作。确认先从队列移除？",
          )
        )
          return;
        URL.revokeObjectURL(job.preview);
        this.jobs.splice(n, 1);
        void this.persist().catch((e) => this.error(e.message));
        this.paint();
        changed();
      },
      { signal },
    );
    signal.addEventListener(
      "abort",
      () => {
        for (const j of this.jobs) URL.revokeObjectURL(j.preview);
      },
      { once: true },
    );
    this.paint();
  }
  private error(text: string) {
    const el = this.root?.querySelector(".entry-file-error");
    if (el) el.textContent = text;
  }
  private paint() {
    if (!this.root?.isConnected) return;
    this.root.querySelector(".entry-file-list")!.innerHTML = this.jobs
      .map(
        (j, n) =>
          `<article class="entry-file"><img src="${j.preview}" alt="${esc(j.file.name)}"><div><strong>${esc(j.file.name)}</strong><small>${esc(j.state)}${j.progress ? " · " + j.progress + "%" : ""}</small><span class="form-error">${esc(j.error)}</span></div><button type="button" class="btn subtle" data-remove-entry-file="${n}" ${this.running || j.state === "已保存" ? "disabled" : ""}>移除</button></article>`,
      )
      .join("");
    this.root.querySelector(".entry-file-summary")!.textContent = this.jobs
      .length
      ? `图片已保存 ${this.jobs.filter((j) => j.state === "已保存").length} / ${this.jobs.length}`
      : "";
  }
  async save(itemId: string, origin: string) {
    this.itemId = itemId;
    let authError: ApiError | undefined;
    this.running = true;
    this.error("");
    this.paint();
    try {
      for (const j of this.jobs) {
        if (j.state === "已保存") continue;
        if (!j.input) {
          j.input = new FormData();
          j.input.set("itemId", itemId);
          j.input.set("file", j.file);
          j.input.set("role", "PRODUCT");
          j.input.set("origin", origin);
          j.input.set(
            "sourceNote",
            origin === "SUPPLIER"
              ? "录入时提供的供应商图片，待核对授权"
              : "录入时上传的图片，待核对实物及授权",
          );
        }
        j.state = "上传中";
        j.error = "";
        this.paint();
        // Persist the exact file, origin and command key before a write can occur.
        await this.persist();
        try {
          await uploadWithProgress("/assets/upload", j.input, j.key, (p) => {
            j.progress = p;
            this.paint();
          });
          j.state = "已保存";
          j.uncertain = false;
        } catch (e) {
          const uncertain =
            j.uncertain ||
            (e instanceof ApiError && (e.status === 0 || e.status >= 500));
          j.uncertain = uncertain;
          j.state = uncertain ? "结果待确认" : "上传失败";
          j.error = (e as Error).message;
          if (!uncertain) {
            j.input = undefined;
            j.key = crypto.randomUUID();
          }
          if (
            e instanceof ApiError &&
            (e.status === 401 ||
              e.code === "ACCOUNT_REVOKED" ||
              e.code === "CSRF_INVALID")
          ) {
            authError = e;
            await this.persist();
            break;
          }
        }
        await this.persist();
        this.paint();
      }
    } finally {
      this.running = false;
      this.paint();
    }
    if (authError) throw authError;
    if (this.pending)
      throw new Error(
        "商品档案已保存，仍有图片未完成。可在本页重试，或稍后用同一浏览器打开该商品继续，不会重复创建商品。",
      );
  }
}
