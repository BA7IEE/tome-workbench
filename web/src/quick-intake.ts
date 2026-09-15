import {
  can,
  cents,
  currencies,
  dialog,
  esc,
  field,
  form,
  request,
  select,
  text,
  uploadWithProgress,
} from "./core";
import {
  dictionaryField,
  bindDictionaryFields,
  readDictionarySelections,
} from "./dictionary-picker";
import { categories } from "./types";

type Created = { id: string; code: string; existing?: boolean };
const fingerprint = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
const validImage = (file: File) =>
  ["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
  /\.(jpe?g|png|webp)$/i.test(file.name);

export function quickIntake(
  afterSaved?: () => Promise<void> | void,
  lastSaved?: { id: string; code: string; title: string },
) {
  if (!can("edit")) return;
  let formEl: HTMLFormElement | null = null;
  let statusEl: HTMLElement | null = null;
  let lastItem: Created | null = null;
  let afterMode = "next",
    savedTitle = "";
  const uploadKeys = new Map<string, string>();
  const fields = `<input type="hidden" name="after" value="next">
    <section class="quick-intake-core">
      ${field("title", "商品名称", "", "text", true, 'placeholder="例如：Dior 羊毛短外套"')}
      ${dictionaryField("BRAND", undefined, "", "")}
      ${select("category", "品类", categories, "CLOTHING")}
      <div class="quick-intake-price">${field("price", "对外报价", "", "text", false, 'inputmode="decimal" placeholder="可留空"')}${select("currency", "币种", currencies, "CNY")}</div>
      ${dictionaryField("CONDITION", undefined, "", "")}
    </section>`;
  const photos = `<section class="quick-intake-photos"><div class="quick-intake-photo-head"><strong>商品图片</strong>${select("origin", "图片来源", { OWN: "自己拍摄", SUPPLIER: "供应商提供" }, "OWN")}</div>
    <label class="quick-intake-drop"><input type="file" name="photos" aria-label="商品图片" accept="image/jpeg,image/png,image/webp" multiple><span>＋ 添加图片</span><small>最多100张；单张20MB以内；JPG / PNG / WebP</small></label><div class="quick-intake-previews"></div><p class="quick-intake-upload-status" role="status" aria-live="polite"></p></section>`;
  form(
    "快速录货",
    `${lastSaved ? `<p class="quick-intake-last">上一件 <a href="#/items/${lastSaved.id}/edit">${esc(lastSaved.code)} · ${esc(lastSaved.title)}</a> 已保存</p>` : ""}<p class="quick-intake-note">先把货记下来。尺寸、材质、鉴定、英文和发布资料以后再补。</p>${photos}${fields}<button type="button" class="btn quick-intake-edit" data-after="edit">保存并完善</button>`,
    async (d, key) => {
      if (!formEl) throw new Error("录货窗口尚未准备完成");
      const files = d
        .getAll("photos")
        .filter((x): x is File => x instanceof File && x.size > 0);
      if (files.length > 100) throw new Error("每件商品最多上传100张图片");
      const invalid = files.filter(
        (file) => !validImage(file) || file.size > 20 * 1024 * 1024,
      );
      if (invalid.length)
        throw new Error(
          `请先处理不符合要求的图片：${invalid
            .slice(0, 3)
            .map((f) => f.name)
            .join("、")}${invalid.length > 3 ? ` 等${invalid.length}张` : ""}。TM尚未创建。`,
        );
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
      if (statusEl) statusEl.textContent = "正在创建商品档案…";
      const item = await request<Created>("/items", "POST", body, key);
      lastItem = item;
      const origin = text(d, "origin") || "OWN";
      if (statusEl)
        statusEl.textContent = files.length
          ? `${item.code} 已创建，正在上传 0 / ${files.length} 张。商品已经保存，请勿重复录货。`
          : `${item.code} 已创建。`;
      for (let n = 0; n < files.length; n++) {
        const file = files[n];
        const input = new FormData();
        input.set("itemId", item.id);
        input.set("file", file);
        input.set("role", "PRODUCT");
        input.set("origin", origin);
        input.set(
          "sourceNote",
          origin === "SUPPLIER"
            ? "快速录货上传的供应商图片，待核对授权"
            : "快速录货上传的自有实拍，待核对实物",
        );
        const fp = fingerprint(file),
          uploadKey = uploadKeys.get(fp) || crypto.randomUUID();
        uploadKeys.set(fp, uploadKey);
        try {
          await uploadWithProgress(
            "/assets/upload",
            input,
            uploadKey,
            (progress) => {
              if (statusEl)
                statusEl.textContent = `${item.code} 已创建 · 第 ${n + 1} / ${files.length} 张 ${progress}% · 请勿重复录货`;
            },
          );
        } catch (error) {
          if (statusEl)
            statusEl.textContent = `${item.code} 已创建，图片上传停在 ${n} / ${files.length} 张。可保留当前窗口重试。`;
          throw new Error(
            `${item.code} 已经创建成功，但图片上传未全部完成：${(error as Error).message}。不要重新录货；修复后在当前窗口重试会继续使用原请求。`,
          );
        }
        if (statusEl)
          statusEl.textContent = `${item.code} 已创建 · 已上传 ${n + 1} / ${files.length} 张`;
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
  statusEl = formEl.querySelector<HTMLElement>(".quick-intake-upload-status");
  const scope = new AbortController();
  dialog.addEventListener("close", () => scope.abort(), { once: true });
  bindDictionaryFields(formEl, scope.signal);
  const editButton = formEl.querySelector<HTMLButtonElement>("[data-after=edit]")!,
    footer = formEl.querySelector("footer")!,
    primary = footer.querySelector<HTMLButtonElement>("button[type=submit]")!;
  footer.insertBefore(editButton, primary);
  const hidden = formEl.elements.namedItem("after") as HTMLInputElement;
  formEl
    .querySelector("[data-after=edit]")
    ?.addEventListener(
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
    if (current.length > 100 && statusEl)
      statusEl.textContent = `最多保留100张图片，另外 ${current.length - 100} 张未加入。`;
    replaceFiles(current.slice(0, 100));
  };
  const paint = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    preview.innerHTML = fileList()
      .map((f, n) => {
        const u = URL.createObjectURL(f);
        urls.push(u);
        const issue = !validImage(f)
          ? "格式不支持"
          : f.size > 20 * 1024 * 1024
            ? "超过20MB"
            : "";
        return `<figure class="${issue ? "has-error" : ""}"><img src="${u}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}${issue ? `<small>${esc(issue)}</small>` : ""}</figcaption><button type="button" aria-label="移除图片 ${esc(f.name)}" data-remove-quick="${n}">×</button></figure>`;
      })
      .join("");
  };
  input.addEventListener(
    "change",
    () => {
      const files = fileList();
      if (files.length > 100) {
        if (statusEl)
          statusEl.textContent = `最多100张图片，另外 ${files.length - 100} 张未加入。`;
        replaceFiles(files.slice(0, 100));
        return;
      }
      paint();
    },
    { signal: scope.signal },
  );
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
  dialog.classList.add("quick-intake-dialog");
  dialog.addEventListener(
    "close",
    () => dialog.classList.remove("quick-intake-dialog"),
    { once: true },
  );
}
