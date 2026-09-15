import { exportMaterials } from "./materials";
import { safeReturn } from "./record-controls";
import { showItemEvidence } from "./source-evidence";
import { studioStock } from "./studio-stock";
import { placeStudioSections } from "./studio-fields";
import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { mountView } from "./arco/runtime";
import { ProductFields } from "./arco/product-fields";
import { ProductHeader, type HeaderHandle } from "./arco/product-header";
import { StudioPublisher } from "./studio-publisher";
import { studioGallery, bindStudioMedia } from "./studio-media";
import { deletedNotice } from "./recycle-bin";
import {
  request,
  can,
  esc,
  field,
  select,
  check,
  button,
  toast,
  ApiError,
  reauthenticate,
  reload,
} from "./core";
import type { Item, Source } from "./types";
import { sourceValues } from "./source-fields";
import { readProduct, changedProduct, bindProductRows } from "./product-fields";
import { onPageReady, setLeaveGuard } from "./page-lifecycle";
import { bindFormValidation, lockControls } from "./form-support";
import { WriteAttempt } from "./write-attempt";
import { ProductUploadQueue } from "./product-upload-queue";
import { catalogContext, clearEditQueue } from "./catalog-context";
function blank(): Item {
  return {
    id: "",
    code: "保存后自动生成",
    serial: 0,
    title: "",
    brand: "",
    category: "CLOTHING",
    ownership: "OWN",
    location: "",
    status: "AVAILABLE",
    version: 0,
    cycle: 1,
    facts: {
      material: "",
      color: "",
      sizeLabel: "",
      measurements: "",
      measurementSource: "",
      condition: "",
      descriptionZh: "",
      descriptionEn: "",
      authentication: { status: "UNKNOWN", evidence: "" },
      research: [],
      attributes: {},
      attributeLabels: {},
    },
    approvedId: null,
    approvedValid: false,
    currentPrice: null,
    currency: "CNY",
    assets: [],
    offers: [],
    packages: [],
    listings: [],
    tasks: [],
    intents: [],
    revisions: [],
    observations: [],
    reservations: [],
    suggestions: [],
    movements: [],
  };
}
const labels: Record<string, string> = {
  dictionary: "标准选项",
  title: "名称",
  brand: "品牌",
  category: "品类",
  currentPrice: "报价",
  currency: "币种",
  material: "材质成分 / 细节",
  condition: "瑕疵与使用痕迹",
  descriptionZh: "中文介绍",
  descriptionEn: "英文介绍",
  measurements: "尺寸",
  research: "研究依据",
  attributes: "扩展资料",
  attributeLabels: "扩展字段名称",
  authentication: "鉴定依据",
  sizeLabel: "尺码",
  color: "颜色",
  measurementSource: "尺寸来源",
};
function readable(value: unknown): string {
  if (value == null) return "未填";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(readable).join("；");
  return Object.entries(value)
    .map(([k, v]) => `${labels[k] || k}：${readable(v)}`)
    .join("；");
}
export async function productEntry(id?: string) {
  if (!can("edit"))
    return '<section class="panel"><h2>需要商品编辑权限</h2><p>请使用有权限的账号。</p></section>';
  let base = id ? await request<Item>(`/items/${id}`) : blank();
  if (base.deletedAt) return deletedNotice(base);
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    sourceId = qs.get("source");
  let source: Source | null = null;
  if (!id && sourceId) {
    source = await request<Source>(
      `/supply/sources/${encodeURIComponent(sourceId)}`,
    );
    const v = sourceValues(source);
    base = { ...base, ...v, facts: { ...base.facts, ...v.facts } };
  }
  if (source?.items.length)
    return `<section class="panel"><h2>这条货源已经建档</h2><p>不会再次创建同一件商品。请打开已有档案继续维护。</p><a class="btn primary" href="#/items/${source.items[0].id}/edit">打开已有商品</a></section>`;
  const root = "entry-" + crypto.randomUUID(),
    files = new ProductUploadQueue();
  if (id) await files.restore(id);
  const origin = safeReturn(qs.get("returnTo"));
  const fromCandidates = /^#\/candidates(?:\?|$)/.test(origin);
  const returnTarget = () => {
    if (origin) return origin;
    const last = catalogContext().listHash || "#/items";
    return base.dataMode === "TEST" &&
      new URLSearchParams(last.split("?")[1] || "").get("dataMode") !== "TEST"
      ? "#/items?dataMode=TEST"
      : last;
  };
  const returnLabel = fromCandidates
    ? "返回候选列表"
    : origin.startsWith("#/procurement")
      ? "返回采购记录"
      : origin.startsWith("#/collections")
        ? "返回客户选品"
        : "返回商品列表";
  const context = catalogContext(),
    index = context.queue.indexOf(id || ""),
    nextId = index >= 0 ? context.queue[index + 1] : undefined;
  const knownPhotos = base.assets.filter(
    (a) => !a.archived && a.role !== "DOCUMENT",
  );
  const provenance = id
    ? `<dl class="entry-summary"><dt>商品编号</dt><dd>${esc(base.code)}</dd><dt>实物持有</dt><dd>${base.ownership === "OWN" ? "自有库存" : "供应商持有"}</dd><dt>当前位置</dt><dd>${esc(base.location || "未填写")}</dd></dl><a class="btn" href="#/items/${id}?tab=supply">查看货源与交接</a>`
    : `<div class="form-grid">${select("ownership", "实物持有", { OWN: "自有库存", SUPPLIER: "供应商持有" }, base.ownership)}${field("location", "存放/保管位置", base.location)}</div>`;
  const html = `<div id="${root}" class="product-entry-page studio-workspace arco-workspace"><nav class="breadcrumb" aria-label="当前位置"><a href="${esc(returnTarget())}">${fromCandidates ? "待确认商品" : origin.startsWith("#/procurement") ? "采购历史" : origin.startsWith("#/collections") ? "客户选品" : "商品"}</a><span>/</span><span>${id ? esc(base.code) : "新建"}</span></nav>
  <header class="studio-commandbar"></header>
  ${
    index >= 0
      ? `<div class="editing-queue">连续编辑：第 ${index + 1} / ${context.queue.length} 件${button(
          "结束连续编辑",
          () => {
            clearEditQueue();
            location.hash = context.listHash;
          },
        )}</div>`
      : ""
  }
  <div class="studio-operating-bar"><div class="studio-stock-controls" data-stock-controls></div>${id ? `<div class="item-source-access">${button("查看全部来源资料", () => showItemEvidence(id), "subtle")}</div>` : ""}</div>
  <form class="product-entry-form" id="product-entry-form"><p class="studio-intro">先录货，随时补充。保存不会自动发布。</p><div class="entry-conflicts" hidden></div>
  <section class="panel entry-source"><h2>货源与实物</h2>${provenance}${!id && can("users") ? select("dataMode", "记录类型", { BUSINESS: "正式经营商品", TEST: "测试数据（不计入经营统计）" }, "BUSINESS") : base.dataMode === "TEST" ? '<p class="notice warning">测试商品：不计入正式统计，不展示到公开展厅。</p>' : ""}</section><div class="entry-fields"></div>
  <section class="entry-existing-media" ${knownPhotos.length ? "" : "hidden"}>${studioGallery(base.assets, base.id)}</section>
  ${files.markup(base.ownership === "SUPPLIER" ? "SUPPLIER" : "OWN")}
  ${can("review") ? `<section class="panel entry-review">${check("approveOnSave", "我已核对本次商品资料，保存时同时确认供后续发布使用")}<small>不勾选也能保存。图片授权、供货状态和渠道文案仍按实际情况检查。</small></section>` : ""}
  <div class="studio-save-feedback"><p class="form-error" role="alert" tabindex="-1"></p><button type="button" class="btn" id="entry-retry" hidden>核对上次提交</button><button type="button" class="btn" id="entry-login" hidden>重新登录并保留输入</button></div></form><aside class="studio-publisher" aria-label="本商品发布工作区" hidden></aside></div>`;
  onPageReady(root, (el, signal) => {
    const header = createRef<HeaderHandle>();
    mountView(
      el.querySelector<HTMLElement>(".studio-commandbar")!,
      signal,
    )(
      createElement(ProductHeader, {
        ref: header,
        item: base,
        returnTarget: returnTarget(),
        returnLabel,
        sourceTitle: source?.title,
        nextId,
      }),
    );
    const renderFields = mountView(
      el.querySelector<HTMLElement>(".entry-fields")!,
      signal,
    );
    let fieldsRevision = 0;
    const displayFields = (item: Item) =>
      renderFields(
        createElement(ProductFields, { item, key: fieldsRevision++ }),
      );
    displayFields(base);
    const f = el.querySelector<HTMLFormElement>("#product-entry-form")!,
      err = f.querySelector<HTMLElement>(".studio-save-feedback .form-error")!,
      status = el.querySelector<HTMLElement>(".entry-save-state")!;
    const retry = f.querySelector<HTMLButtonElement>("#entry-retry")!,
      login = f.querySelector<HTMLButtonElement>("#entry-login")!;
    let dirty = false,
      busy = false,
      sent: Item | null = null,
      conflictLatest: Item | null = null;
    const write = new WriteAttempt(request),
      approval = new WriteAttempt(request);
    const mark = () => {
      dirty = true;
      status.textContent = "未保存";
      publisher?.invalidate();
      const c = f.elements.namedItem(
        "approveOnSave",
      ) as HTMLInputElement | null;
      if (c) c.checked = false;
    };
    bindFormValidation(f, err, signal);
    bindProductRows(f, signal);
    files.bind(f, signal, mark);
    f.addEventListener(
      "input",
      (e) => {
        if ((e.target as HTMLInputElement).name !== "approveOnSave") mark();
      },
      { signal },
    );
    f.addEventListener(
      "change",
      (e) => {
        if ((e.target as HTMLInputElement).name !== "approveOnSave") mark();
      },
      { signal },
    );
    placeStudioSections(f);
    const publisher = new StudioPublisher({
      root: el,
      form: f,
      signal,
      getItem: () => base,
      isDirty: () => dirty || files.pending,
      saveItem: () => saveEntry("quiet"),
    });
    const gallery = bindStudioMedia(
      el,
      signal,
      () => base,
      () => publisher.invalidate(),
    );
    const stock = studioStock(
      el,
      () => base,
      () => {
        publisher.invalidate();
        if (publisher.isOpen()) void publisher.open(base, true);
      },
    );
    const replaceUrl = () => {
      if (base.id && !id) {
        history.replaceState(null, "", `#/items/${base.id}/edit`);
        window.dispatchEvent(new Event("route-replaced"));
      }
    };
    const adopt = (result: {
      id: string;
      code?: string;
      version?: number;
      existing?: boolean;
    }) => {
      if (!sent) throw new Error("没有对应的保存内容");
      if (result.existing)
        throw new Error(
          "该货源已经由其他操作建档，请返回货源列表打开已有商品；本次没有覆盖资料或上传图片",
        );
      base = {
        ...sent,
        id: result.id,
        code: result.code || base.code,
        version: result.version || (base.id ? base.version : 1),
      };
      dirty = false;
      flushSync(() => header.current!.update(base));
      status.textContent = "已保存";
      replaceUrl();
      el.querySelector(".breadcrumb span:last-child")!.textContent =
        base.code || "商品";
    };
    const displayError = (error: unknown) => {
      err.textContent = (error as Error).message;
      err.scrollIntoView({ block: "nearest" });
      retry.hidden = !(write.uncertain || approval.uncertain);
      login.hidden = !(
        error instanceof ApiError &&
        (error.status === 401 || error.code === "CSRF_INVALID")
      );
    };
    const conflict = async () => {
      if (!base.id || !sent) return;
      conflictLatest = await request<Item>(`/items/${base.id}`);
      const patch = changedProduct(base, sent),
        rows: [string, unknown, unknown][] = [];
      for (const [k, v] of Object.entries(patch)) {
        if (k === "version") continue;
        if (k === "facts") {
          for (const [fk, fv] of Object.entries(patch.facts || {}))
            rows.push([
              labels[fk] || fk,
              (conflictLatest.facts as unknown as Record<string, unknown>)[fk],
              fv,
            ]);
        } else
          rows.push([
            labels[k] || k,
            (conflictLatest as unknown as Record<string, unknown>)[k],
            v,
          ]);
      }
      const box = f.querySelector<HTMLElement>(".entry-conflicts")!;
      box.hidden = false;
      box.innerHTML = `<h2>资料刚被更新，请核对后再保存</h2><p>你的输入没有丢失。未修改的字段将使用服务器的新值。</p><table><thead><tr><th>字段</th><th>服务器当前值</th><th>你的改动</th></tr></thead><tbody>${rows.map(([label, a, b]) => `<tr><td>${esc(label)}</td><td>${esc(readable(a))}</td><td>${esc(readable(b))}</td></tr>`).join("")}</tbody></table>${check("entryConflictAck", "我已核对差异，保留下面输入的改动")}<button type="button" class="btn" id="entry-merge">合并后继续编辑</button>`;
      box.querySelector("#entry-merge")!.addEventListener(
        "click",
        () => {
          if (
            !(f.elements.namedItem("entryConflictAck") as HTMLInputElement)
              .checked
          ) {
            err.textContent = "请先核对并勾选确认";
            return;
          }
          const current = readProduct(f, new FormData(f), base),
            p = changedProduct(base, current),
            latest = conflictLatest!;
          const merged = {
            ...latest,
            ...p,
            version: latest.version,
            facts: { ...latest.facts, ...p.facts },
            dictionary: { ...latest.dictionary, ...p.dictionary },
          };
          base = latest;
          const sourceSection = f.querySelector("[data-section=supply]"),
            reviewSection = f.querySelector(
              ".entry-review, .studio-inline-review",
            );
          sourceSection?.remove();
          reviewSection?.remove();
          const photoQueue = f.querySelector(".entry-photos")!,
            existingGallery = f.querySelector(".entry-existing-media");
          // These nodes own selected File objects and upload receipts. Keep them when fields are rebased.
          photoQueue.remove();
          existingGallery?.remove();
          const fieldContainer = f.querySelector(".entry-fields")!;
          displayFields(merged);
          bindProductRows(f, signal);
          fieldContainer.querySelector("[data-media-slot]")!.append(photoQueue);
          if (existingGallery) {
            const drop =
              photoQueue.querySelector(".entry-drop") ||
              existingGallery.querySelector(".entry-drop");
            drop?.remove();
            photoQueue.append(existingGallery);
            if (drop) photoQueue.append(drop);
          }
          if (sourceSection)
            fieldContainer
              .querySelector("[data-source-slot]")!
              .append(sourceSection);
          if (reviewSection)
            fieldContainer
              .querySelector("[data-review-slot]")!
              .append(reviewSection);
          placeStudioSections(f);
          gallery.paint();
          stock.paint();
          attachDimensions();
          box.hidden = true;
          box.innerHTML = "";
          dirty = true;
          err.textContent = "已合并，尚未保存。请检查后点击保存商品。";
        },
        { signal },
      );
      box.scrollIntoView({ block: "start" });
    };
    async function saveEntry(mode = "stay"): Promise<Item | undefined> {
      if (busy || publisher.isBusy() || gallery.busy()) return;
      if (publisher.awaitingResult()) {
        err.textContent = "发布操作结果待确认，请先在右侧继续上次提交。";
        return;
      }
      if (gallery.uncertain()) {
        err.textContent = "请先核对图片操作结果，再保存商品。";
        return;
      }
      if (!f.reportValidity()) return;
      const data = new FormData(f);
      flushSync(() => header.current!.busy(true));
      const unlock = lockControls(el);
      busy = true;
      err.textContent = "";
      status.textContent = "保存中…";
      try {
        // Keep the input associated with the original receipt until its outcome is known.
        if (write.uncertain || approval.uncertain)
          throw new Error(
            "上次提交结果待确认，请先点击“核对上次提交”。当前输入会保留。",
          );
        const next = readProduct(f, data, base);
        sent = { ...next };
        if (!base.id) {
          sent.dataMode = data.get("dataMode") === "TEST" ? "TEST" : "BUSINESS";
          sent.ownership = String(data.get("ownership") || "OWN");
          sent.location = String(data.get("location") || "");
          const input = {
            dataMode: String(data.get("dataMode") || "BUSINESS"),
            title: sent.title,
            brand: sent.brand,
            dictionary: sent.dictionary,
            category: sent.category,
            ownership: sent.ownership,
            location: sent.location,
            facts: sent.facts,
            currentPrice: sent.currentPrice,
            currency: sent.currency,
            ...(source ? { sourceId: source.id } : {}),
          };
          adopt(
            await write.run<{ id: string; code: string; existing?: boolean }>(
              "/items",
              input,
            ),
          );
        } else {
          const patch = changedProduct(base, next);
          if (Object.keys(patch).length > 1)
            adopt(
              await write.run<{ id: string; version: number }>(
                `/items/${base.id}`,
                patch,
                "PATCH",
              ),
            );
        }
        await files.save(
          base.id,
          String(data.get("entryImageOrigin") || "OWN"),
        );
        if (data.has("approveOnSave"))
          await approval.run(`/items/${base.id}/approve`, {
            version: base.version,
          });
        dirty = false;
        base = await request<Item>(`/items/${base.id}`);
        files.clearCompleted();
        gallery.paint();
        stock.paint();
        status.textContent = "已保存";
        if (mode === "quiet") return base;
        const more = el.querySelector<HTMLDetailsElement>(".studio-more");
        if (more) more.open = false;
        if (mode === "materials") {
          await exportMaterials([base]);
          return base;
        }
        if (mode === "publish") {
          await publisher.open(base, publisher.isOpen());
          return base;
        }
        if (mode === "stay") {
          publisher.invalidate();
          return base;
        }
        if (publisher.isOpen() && publisher.hasWork())
          await publisher.saveDraft();
        setLeaveGuard(null);
        const target =
          mode === "return"
            ? returnTarget()
            : mode === "next" && nextId
              ? `#/items/${nextId}/edit`
              : mode === "new"
                ? "#/items/new"
                : `#/items/${base.id}/edit`;
        if (location.hash === target) {
          const y = window.scrollY;
          await reload();
          window.scrollTo(0, y);
        } else location.hash = target;
        toast(
          mode === "new" ? "上一件已保存，可以继续录入下一件" : "商品已保存",
        );
      } catch (error) {
        displayError(error);
        if (error instanceof ApiError && error.code === "VERSION_CONFLICT")
          await conflict().catch(displayError);
      } finally {
        busy = false;
        unlock();
        flushSync(() => header.current?.busy(false));
        for (const name of ["ownership", "location", "dataMode"]) {
          const control = f.elements.namedItem(name) as HTMLInputElement | null;
          if (control && base.id) control.disabled = true;
        }
      }
    }
    f.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        void saveEntry(
          (event.submitter as HTMLButtonElement | null)?.value || "stay",
        );
      },
      { signal },
    );
    retry.addEventListener(
      "click",
      async () => {
        if (busy) return;
        busy = true;
        flushSync(() => header.current!.busy(true));
        const unlock = lockControls(el);
        try {
          if (write.uncertain)
            adopt(
              await write.retry<{
                id: string;
                code?: string;
                version?: number;
              }>(),
            );
          else if (approval.uncertain) await approval.retry();
          retry.hidden = true;
          dirty = true;
          err.textContent =
            "上次提交已核对。输入仍保留，可检查后继续保存或上传。";
        } catch (error) {
          displayError(error);
        } finally {
          busy = false;
          unlock();
          flushSync(() => header.current?.busy(false));
        }
      },
      { signal },
    );
    login.addEventListener(
      "click",
      async () => {
        try {
          await reauthenticate();
          login.hidden = true;
          err.textContent = "登录已恢复，请继续保存。";
        } catch (error) {
          displayError(error);
        }
      },
      { signal },
    );
    setLeaveGuard(() => {
      if (busy || publisher.isBusy() || gallery.busy()) {
        toast("正在保存，请稍候");
        return false;
      }
      return (
        !(
          dirty ||
          files.pending ||
          write.uncertain ||
          approval.uncertain ||
          publisher.hasWork() ||
          gallery.uncertain()
        ) ||
        window.confirm(
          "还有未保存内容或未完成图片。确认离开？已保存的商品不会被删除。",
        )
      );
    });
    window.addEventListener(
      "beforeunload",
      (event) => {
        if (
          dirty ||
          busy ||
          publisher.hasWork() ||
          gallery.uncertain() ||
          files.pending ||
          write.uncertain ||
          approval.uncertain
        ) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      { signal },
    );
    f.addEventListener(
      "keydown",
      (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          f.requestSubmit();
        }
      },
      { signal },
    );
    attachDimensions();
    if (qs.get("publish") === "1" && base.id) void publisher.open(base);
    function attachDimensions() {
      const category = f.elements.namedItem("category") as HTMLSelectElement;
      const help = document.createElement("small");
      help.className = "dimension-help";
      f.querySelector('[name="measurements"]')!.closest("label")!.append(help);
      const updateHelp = () => {
        help.textContent =
          category.value === "CLOTHING"
            ? "例如肩宽、胸围、衣长。已有可靠尺寸可直接填写，不要求重新测量。"
            : category.value === "BAG"
              ? "例如宽×高×深、肩带长度；可以使用经过核对的供应商资料。"
              : category.value === "SHOES"
                ? "例如标注鞋码、鞋内长；按这件商品的实际情况填写。"
                : "按品类记录需要的尺寸；确实不适用时可在商品资料中登记依据。";
      };
      category.addEventListener("change", updateHelp, { signal });
      updateHelp();
    }
  });
  return html;
}
