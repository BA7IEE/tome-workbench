import { createElement } from "react";
import { mountView } from "./arco/runtime";
import { QuickFields } from "./arco/quick-fields";
import { readWork, saveWork } from "./work-storage";
import {
  can,
  cents,
  dialog,
  esc,
  form,
  request,
  select,
  text,
  uploadWithProgress,
  me,
} from "./core";
import {
  bindDictionaryFields,
  readDictionarySelections,
} from "./dictionary-picker";

type Created = { id: string; code: string; existing?: boolean };
const fingerprint = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function quickIntake(
  afterSaved?: () => Promise<void> | void,
  lastSaved?: { id: string; code: string; title: string },
) {
  if (!can("edit")) return;
  const owner = me!.id;
  let formEl: HTMLFormElement | null = null;
  let lastItem: Created | null = null;
  let afterMode = "next",
    savedTitle = "";
  const uploadKeys = new Map<string, string>();
  const fields =
    '<input type="hidden" name="after" value="next"><section class="quick-intake-core"></section>';
  const photos = `<section class="quick-intake-photos"><div class="quick-intake-photo-head"><strong>商品图片</strong>${select("origin", "图片来源", { OWN: "自己拍摄", SUPPLIER: "供应商提供" }, "OWN")}</div>
    <label class="quick-intake-drop"><input type="file" name="photos" aria-label="商品图片" accept="image/jpeg,image/png,image/webp" multiple><span>＋ 添加图片</span><small>可一次选择多张；JPG / PNG / WebP</small></label><div class="quick-intake-previews"></div></section>`;
  form(
    "快速录货",
    `${lastSaved ? `<p class="quick-intake-last">上一件 <a href="#/items/${lastSaved.id}/edit">${esc(lastSaved.code)} · ${esc(lastSaved.title)}</a> 已保存</p>` : ""}<p class="quick-intake-note">先把货记下来。尺寸、材质、鉴定、英文和发布资料以后再补。</p>${photos}${fields}<button type="button" class="btn quick-intake-edit" data-after="edit">保存并完善</button>`,
    async (d, key) => {
      if (!formEl) throw new Error("录货窗口尚未准备完成");
      const picked = readDictionarySelections(formEl);
      afterMode = text(d, "after") || "next";
      savedTitle = text(d, "title");
      const body = {
        title: text(d, "title"),
        brand: picked.labels.brand || "",
        dictionary: picked.dictionary,
        category: text(d, "category"),
        currentPrice: cents(d.get("price")),
        currency: text(d, "currency"),
        facts: { conditionGrade: picked.labels.condition || "" },
      };
      const item = await request<Created>("/items", "POST", body, key);
      lastItem = item;
      const files = d
        .getAll("photos")
        .filter((x): x is File => x instanceof File && x.size > 0);
      const origin = text(d, "origin") || "OWN";
      type PendingImage = {
        file: File;
        key: string;
        state: string;
        error: string;
        progress: number;
        input: [string, FormDataEntryValue][];
        uncertain?: boolean;
      };
      const storage = `images:${owner}:${item.id}`;
      let pending = await readWork<PendingImage[]>(storage);
      if (!pending)
        pending = files.map((file) => {
          if (
            !/\.(jpe?g|png|webp)$/i.test(file.name) ||
            file.size > 20 * 1024 * 1024
          )
            throw new Error(`${file.name}：请选择20MB以内的JPG、PNG或WebP`);
          const fp = fingerprint(file),
            uploadKey = uploadKeys.get(fp) || crypto.randomUUID();
          uploadKeys.set(fp, uploadKey);
          return {
            file,
            key: uploadKey,
            state: "等待保存",
            error: "",
            progress: 0,
            input: [
              ["itemId", item.id],
              ["file", file],
              ["role", "PRODUCT"],
              ["origin", origin],
              [
                "sourceNote",
                origin === "SUPPLIER"
                  ? "快速录货上传的供应商图片，待核对授权"
                  : "快速录货上传的自有实拍，待核对实物",
              ],
            ],
          };
        });
      for (const job of [...pending]) {
        job.state = "上传中";
        await saveWork(storage, pending);
        const input = job.input.reduce((f, [k, v]) => {
          f.append(k, v);
          return f;
        }, new FormData());
        try {
          await uploadWithProgress("/assets/upload", input, job.key, () => {});
        } catch (error) {
          if (!formEl.querySelector(".quick-recovery"))
            formEl
              .querySelector(".quick-intake-note")!
              .insertAdjacentHTML(
                "afterend",
                `<p class="quick-recovery">档案 ${esc(item.code)} 已保存。图片可重试，或稍后打开该商品继续上传。</p>`,
              );
          throw error;
        }
        pending = pending.filter((j) => j.key !== job.key);
        await saveWork(storage, pending.length ? pending : undefined);
      }
      return item;
    },
    "保存并下一件",
    async () => {
      const saved = lastItem;
      if (!saved) return;
      await afterSaved?.();
      if (afterMode === "edit") {
        location.hash = `/items/${saved.id}/edit`;
        return;
      }
      setTimeout(
        () =>
          quickIntake(afterSaved, {
            id: saved.id,
            code: saved.code,
            title: savedTitle,
          }),
        0,
      );
    },
  );

  formEl = dialog.querySelector<HTMLFormElement>("form")!;
  const scope = new AbortController();
  dialog.addEventListener("close", () => scope.abort(), { once: true });
  mountView(
    formEl.querySelector<HTMLElement>(".quick-intake-core")!,
    scope.signal,
  )(createElement(QuickFields));
  bindDictionaryFields(formEl, scope.signal);
  const editButton = formEl.querySelector<HTMLButtonElement>(
    '[data-after="edit"]',
  )!;
  const footer = formEl.querySelector("footer")!,
    primary = footer.querySelector<HTMLButtonElement>("button[type=submit]")!;
  footer.insertBefore(editButton, primary);
  const hidden = formEl.elements.namedItem("after") as HTMLInputElement;
  formEl.querySelector('[data-after="edit"]')?.addEventListener(
    "click",
    () => {
      hidden.value = "edit";
      formEl!.requestSubmit(
        formEl!.querySelector<HTMLButtonElement>("button[type=submit]")!,
      );
    },
    { signal: scope.signal },
  );
  const input = formEl.elements.namedItem("photos") as HTMLInputElement,
    preview = formEl.querySelector<HTMLElement>(".quick-intake-previews")!,
    drop = formEl.querySelector<HTMLElement>(".quick-intake-drop")!;
  let urls: string[] = [];
  const fileList = () => [...(input.files || [])];
  const replaceFiles = (files: File[]) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const addFiles = (files: File[]) => {
    const current = fileList(),
      seen = new Set(current.map((f) => fingerprint(f)));
    for (const f of files)
      if (!seen.has(fingerprint(f))) {
        current.push(f);
        seen.add(fingerprint(f));
      }
    replaceFiles(current.slice(0, 100));
  };
  const paint = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    preview.innerHTML = fileList()
      .map((f, n) => {
        const u = URL.createObjectURL(f);
        urls.push(u);
        return `<figure><img src="${u}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption><button type="button" aria-label="移除图片 ${esc(f.name)}" data-remove-quick="${n}">×</button></figure>`;
      })
      .join("");
  };
  input.addEventListener("change", paint, { signal: scope.signal });
  drop.addEventListener("dragover", (e) => e.preventDefault(), {
    signal: scope.signal,
  });
  drop.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      addFiles([...(e.dataTransfer?.files || [])]);
    },
    { signal: scope.signal },
  );
  formEl.addEventListener(
    "paste",
    (e) => {
      const images = [...(e.clipboardData?.files || [])].filter((f) =>
        f.type.startsWith("image/"),
      );
      if (images.length) {
        e.preventDefault();
        addFiles(images);
      }
    },
    { signal: scope.signal },
  );
  preview.addEventListener(
    "click",
    (e) => {
      const b = (e.target as Element).closest<HTMLElement>(
        "[data-remove-quick]",
      );
      if (!b) return;
      const files = fileList();
      files.splice(Number(b.dataset.removeQuick), 1);
      replaceFiles(files);
    },
    { signal: scope.signal },
  );
  scope.signal.addEventListener(
    "abort",
    () => {
      for (const u of urls) URL.revokeObjectURL(u);
    },
    { once: true },
  );
  (formEl.elements.namedItem("title") as HTMLInputElement).focus();
  formEl.addEventListener(
    "keydown",
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        hidden.value = e.shiftKey ? "edit" : "next";
        formEl!.requestSubmit(primary);
      }
    },
    { signal: scope.signal },
  );
  dialog.classList.add("quick-intake-dialog", "arco-workspace");
  dialog.addEventListener(
    "close",
    () => dialog.classList.remove("quick-intake-dialog", "arco-workspace"),
    { once: true },
  );
}
