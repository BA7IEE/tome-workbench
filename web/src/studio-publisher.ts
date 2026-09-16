import { imageOrder, bindImageOrder } from "./studio-image-order";
import {
  request,
  can,
  esc,
  field,
  area,
  check,
  money,
  reauthenticate,
  ApiError,
} from "./core";
import { WriteAttempt } from "./write-attempt";
import { lockControls } from "./form-support";
import { packageButtons } from "./publishing-workspace";
import { setupChannel, platformNames } from "./channel-setup";
import { focusStudioField } from "./studio-fields";
import type { Item, Channel, Pack } from "./types";
type Photo = {
  id: string;
  originalName: string;
  role: string;
  origin: string;
  usable: boolean;
  blockedReason: string;
  sourceNote: string;
};
interface Plan {
  version: number;
  digest: string;
  approvedId: string | null;
  approvedValid: boolean;
  price: number | null;
  currency: string;
  channel: Channel;
  draft: null | {
    id: string;
    version: number;
    title: string;
    body: string;
    assetIds: string[];
    basisRevisionId: string | null;
    basisPrice: number | null;
    basisCurrency: string;
  };
  preview: { title: string; body: string; notice: string };
  assets: Photo[];
  missing: { code: string; title: string }[];
  canReview: boolean;
  outdated: boolean;
}
interface ReleaseInput {
  title: string;
  body: string;
  ids: string[];
  note: string;
  plan: Plan;
  channel: Channel;
  purpose: string;
  version: number;
  draftId: string;
  step: number;
  approvedId: string | null;
  packId?: string;
}
interface Options {
  root: HTMLElement;
  form: HTMLFormElement;
  signal: AbortSignal;
  getItem: () => Item;
  isDirty: () => boolean;
  saveItem: () => Promise<Item | undefined>;
}
/** One local editing context. This adapter composes existing commands; it never calls marketplaces. */
export class StudioPublisher {
  private host: HTMLElement;
  private item!: Item;
  private channels: Channel[] = [];
  private channelId = "";
  private use = "TRADE";
  private plan: Plan | null = null;
  private dirty = false;
  private copyEdited = false;
  private busy = false;
  private visible = false;
  private selected: string[] = [];
  private pending: ReleaseInput | null = null;
  private draftVersion = 0;
  private draftId = "";
  private generation = 0;
  private conflictDraft: Plan["draft"] = null;
  private reviewWrite = new WriteAttempt(request);
  private draftWrite = new WriteAttempt(request);
  private packageWrite = new WriteAttempt(request);
  constructor(private o: Options) {
    this.host = o.root.querySelector<HTMLElement>(".studio-publisher")!;
    o.signal.addEventListener("abort", () => {
      this.generation++;
    });
  }
  hasWork() {
    return (
      this.busy ||
      this.dirty ||
      !!this.pending ||
      this.reviewWrite.uncertain ||
      this.draftWrite.uncertain ||
      this.packageWrite.uncertain
    );
  }
  isBusy() {
    return this.busy;
  }
  awaitingResult() {
    return (
      !!this.pending ||
      this.reviewWrite.uncertain ||
      this.draftWrite.uncertain ||
      this.packageWrite.uncertain
    );
  }
  isOpen() {
    return this.visible;
  }
  invalidate() {
    if (!this.visible) return;
    const result = this.host.querySelector<HTMLElement>(
      ".studio-release-result",
    );
    if (result) result.hidden = true;
    this.host
      .querySelector<HTMLInputElement>("[name=studioConfirmed]")
      ?.removeAttribute("checked");
    const c = this.host.querySelector<HTMLInputElement>(
      "[name=studioConfirmed]",
    );
    if (c) c.checked = false;
    this.feedback("商品有变化，请点“保存并刷新核对”；当前文案保留。");
  }
  async open(item: Item, preserve = false) {
    if (this.awaitingResult()) {
      this.feedback("请先核对上次操作结果，当前内容保留。", true);
      return;
    }
    this.item = item;
    this.visible = true;
    this.host.hidden = false;
    this.o.root.classList.add("studio-publish-open");
    const previous = preserve ? this.capture() : null;
    const unlockView = lockControls(this.host);
    const g = ++this.generation;
    try {
      this.channels = (await request<Channel[]>("/channels")).filter(
        (c) => c.active,
      );
      if (this.o.signal.aborted || g !== this.generation) return;
      if (!this.channels.length) {
        if (!can("users")) {
          this.host.innerHTML =
            "<h2>准备发布</h2><p>还没有渠道，请管理员先添加实际使用的账号。商品已经保存。</p>";
          return;
        }
        this.host.innerHTML =
          '<h2>准备发布</h2><p>还没有渠道。添加一次，以后可直接选择。</p><button type="button" class="btn primary" id="studio-add-channel">添加渠道</button><button type="button" class="btn" id="studio-close">继续编辑</button>';
        this.host
          .querySelector("#studio-close")!
          .addEventListener("click", () => this.close());
        this.host
          .querySelector("#studio-add-channel")!
          .addEventListener("click", () =>
            setupChannel(async () => this.open(this.item)),
          );
        return;
      }
      this.channelId =
        this.channels.find((c) => c.id === this.channelId)?.id ||
        this.channels[0].id;
      const freshPlan = await request<Plan>(
        `/items/${item.id}/studio?channelId=${this.channelId}&purpose=${this.use}`,
      );
      if (this.o.signal.aborted || g !== this.generation) return;
      this.conflictDraft =
        previous &&
        freshPlan.draft &&
        freshPlan.draft.version !== this.draftVersion
          ? freshPlan.draft
          : null;
      this.plan = freshPlan;
      if (!this.conflictDraft) {
        this.draftVersion = this.plan.draft?.version || 0;
        this.draftId = this.plan.draft?.id || "";
      }
      this.selected =
        previous?.ids ||
        this.plan.draft?.assetIds ||
        this.plan.assets
          .filter((a) => !a.blockedReason && (this.plan!.canReview || a.usable))
          .map((a) => a.id)
          .slice(0, 40);
      if (previous && !this.copyEdited && !this.plan.draft) {
        previous.title = this.plan.preview.title;
        previous.body = this.plan.preview.body;
      }
      if (!preserve) this.copyEdited = !!this.plan.draft;
      this.render(previous);
      if (innerWidth < 900) this.host.scrollIntoView({ block: "start" });
    } catch (e) {
      this.feedback("读取发布信息失败：" + (e as Error).message, true);
      this.host.querySelector(".studio-load-retry")?.remove();
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn studio-load-retry";
      retry.textContent = "重新读取发布信息";
      retry.addEventListener("click", () => {
        void this.open(this.o.getItem(), true);
      });
      this.host.append(retry);
    } finally {
      if (g === this.generation) unlockView();
    }
  }
  private capture() {
    const f = this.host.querySelector<HTMLFormElement>("#studio-publish-form");
    if (!f) return null;
    const value = (name: string) => {
      const named = f.elements.namedItem(name);
      if (named instanceof RadioNodeList)
        return Array.from(named).find((el) => (el as HTMLInputElement | HTMLTextAreaElement).value)?.value || "";
      return (named as HTMLInputElement | HTMLTextAreaElement | null)?.value || "";
    };
    return {
      title: value("studioTitle"),
      body: value("studioBody"),
      note: value("authorizationNote"),
      ids: [...this.selected],
    };
  }
  private feedback(message: string, error = false) {
    let el = this.host.querySelector<HTMLElement>(".studio-publish-feedback");
    if (!el) {
      el = document.createElement("p");
      el.className = "studio-publish-feedback";
      el.setAttribute("role", "status");
      this.host.append(el);
    }
    el.textContent = message;
    el.classList.toggle("form-error", error);
  }
  private render(previous: ReturnType<StudioPublisher["capture"]>) {
    const p = this.plan!,
      draft = p.draft,
      title = previous?.title ?? draft?.title ?? p.preview.title,
      body = previous?.body ?? draft?.body ?? p.preview.body;
    const ownPhotoNote = "本人拍摄，已核对所选图片为本商品实拍并拥有公开使用权";
    const selectedUsesSupplierImages = () =>
      this.selected.some((id) => p.assets.find((a) => a.id === id)?.origin !== "OWN");
    const note = previous?.note || (selectedUsesSupplierImages() ? "" : ownPhotoNote);
    this.host.innerHTML = `<header class="studio-publish-head"><div><h2>准备发布</h2><small>${esc(this.item.code)} · ${money(p.price, p.currency)}</small></div><button type="button" class="btn" id="studio-close">收起</button></header><div class="studio-publish-scroll"><form id="studio-publish-form"><div class="studio-target"><label>目标账号<select name="studioChannel" aria-label="发布目标账号">${this.channels.map((c) => `<option value="${c.id}" ${c.id === this.channelId ? "selected" : ""}>${esc(platformNames[c.platform] || c.platform)} · ${esc(c.name)}</option>`).join("")}</select></label><label>使用场景<select name="studioPurpose" aria-label="使用场景"><option value="TRADE" ${this.use === "TRADE" ? "selected" : ""}>发布到平台</option><option value="CUSTOMER_CARD" ${this.use === "CUSTOMER_CARD" ? "selected" : ""}>发给客户</option></select></label></div>
   ${this.conflictDraft ? `<section class="studio-draft-conflict"><strong>渠道文案被其他人更新了</strong><p>你的编辑已保留。请先比较，不会自动覆盖对方的新内容。</p><details><summary>查看服务器文案</summary><h4>${esc(this.conflictDraft.title)}</h4><div class="copy">${esc(this.conflictDraft.body)}</div></details>${check("studioConflictAck", "已比较双方文案和选图，确认处理方式")}<button type="button" class="btn" id="studio-use-remote">使用服务器文案</button><button type="button" class="btn" id="studio-keep-local">核对后保留我的文案</button></section>` : ""}
   <div class="studio-missing" role="status">${p.missing.length ? "<strong>还需补充：</strong>" + p.missing.map((m) => `<button class="btn subtle" type="button" data-studio-fix="${m.code}">${esc(m.title)}</button>`).join("") : "<span>资料已齐，核对文案和图片即可。</span>"}</div><button type="button" class="btn" id="studio-refresh">保存商品并重新检查</button>
   ${field("studioTitle", "发布标题", title)}<small class="studio-title-count"></small>${area("studioBody", "发布正文", body, 8)}<div class="studio-copy-actions"><button class="btn subtle" type="button" id="studio-refill">恢复系统建议</button><button class="btn" type="submit">保存草稿</button></div><small>生成后仍需到对应平台发布；英文内容请人工核对。</small>
   <h3>本次选图 <span class="studio-selection-count"></span></h3><div class="studio-pick-grid">${p.assets.map((a) => `<label class="studio-pick ${a.blockedReason ? "unavailable-image" : ""}"><input type="checkbox" data-studio-photo="${a.id}" aria-label="发布选图 ${esc(a.originalName)}" ${this.selected.includes(a.id) ? "checked" : ""} ${a.blockedReason || (!p.canReview && !a.usable) ? "disabled" : ""}><img src="/api/assets/${a.id}/preview" alt="${esc(a.originalName)}"><span>${a.role === "DEFECT" ? "瑕疵 · " : ""}${esc(a.originalName)}</span>${a.blockedReason ? `<small>${esc(a.blockedReason)}</small>` : ""}</label>`).join("")}</div><div class="studio-image-order"></div>
   ${p.canReview ? `<div data-authorization-note ${selectedUsesSupplierImages() ? "" : "hidden"}>${area("authorizationNote", "供应商图片授权依据", note, 2)}</div>` : "<p>此账号无复核权限，只能使用已确认的资料和图片。</p>"}
   ${check("studioConfirmed", p.canReview ? "我已核对商品信息、瑕疵和图片，确认可用于本次发布" : "我已核对本次文案、图片和报价")}
   ${p.outdated ? '<p class="studio-hint">已保留你以前的文案。商品有变更，请核对一致后再确认。</p>' : ""}
   <p class="studio-publish-feedback" role="status" aria-live="polite"></p><div class="studio-publish-buttons"><button class="btn primary" type="button" id="studio-generate">生成发布资料</button><button class="btn" type="button" id="studio-resume" hidden>继续上次提交</button><button class="btn" type="button" id="studio-login" hidden>重新登录并保留内容</button></div></form><div class="studio-release-result"></div></div>`;
    const f = this.host.querySelector<HTMLFormElement>("form")!;
    const modify = () => {
      const result = this.host.querySelector<HTMLElement>(
        ".studio-release-result",
      );
      if (result) result.hidden = true;
      this.dirty = true;
      (f.elements.namedItem("studioConfirmed") as HTMLInputElement).checked =
        false;
      this.updateCount();
    };
    f.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).closest(".studio-image-order")) return;
      if (
        ["studioTitle", "studioBody"].includes(
          (e.target as HTMLInputElement).name,
        )
      )
        this.copyEdited = true;
      if ((e.target as HTMLInputElement).name !== "studioConfirmed") modify();
    });
    const updateAuthorization = () => {
      if (!p.canReview) return;
      const wrapper = f.querySelector<HTMLElement>("[data-authorization-note]");
      const textarea = wrapper?.querySelector<HTMLTextAreaElement>('textarea[name="authorizationNote"]');
      const needsSupplier = selectedUsesSupplierImages();
      if (wrapper) wrapper.hidden = !needsSupplier;
      if (textarea) {
        if (needsSupplier && textarea.value === ownPhotoNote) textarea.value = "";
        if (!needsSupplier) textarea.value = ownPhotoNote;
      }
    };
    f.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.studioPhoto) {
        if (t.checked && !this.selected.includes(t.dataset.studioPhoto))
          this.selected.push(t.dataset.studioPhoto);
        if (!t.checked)
          this.selected = this.selected.filter(
            (id) => id !== t.dataset.studioPhoto,
          );
        updateAuthorization();
        modify();
      }
    });
    f.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void this.saveDraft().catch((e) => this.error(e));
      }
    });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.saveDraft().catch((e) => this.error(e));
    });
    this.host.querySelector("#studio-close")!.addEventListener("click", () => {
      void this.close();
    });
    this.host
      .querySelector("#studio-refresh")!
      .addEventListener("click", () => {
        void this.refreshFromEditor();
      });
    this.host.querySelector("#studio-refill")!.addEventListener("click", () => {
      if (
        window.confirm("恢复系统建议会替换当前标题和正文，是否继续？")
      ) {
        (f.elements.namedItem("studioTitle") as HTMLInputElement).value =
          p.preview.title;
        (f.elements.namedItem("studioBody") as HTMLTextAreaElement).value =
          p.preview.body;
        modify();
        this.copyEdited = false;
      }
    });
    this.host
      .querySelector("#studio-generate")!
      .addEventListener("click", () => {
        void this.generate();
      });
    this.host.querySelector("#studio-resume")!.addEventListener("click", () => {
      void this.resume();
    });
    this.host.querySelector("#studio-login")!.addEventListener("click", () => {
      void reauthenticate()
        .then(() => this.feedback("登录已恢复，原输入保留。"))
        .catch((e) => this.error(e));
    });
    for (const b of this.host.querySelectorAll<HTMLButtonElement>(
      "[data-studio-fix]",
    ))
      b.addEventListener("click", () =>
        focusStudioField(this.o.form, b.dataset.studioFix!),
      );
    const switchTarget = async () => {
      try {
        if (this.dirty) await this.saveDraft();
        this.channelId = (
          f.elements.namedItem("studioChannel") as HTMLSelectElement
        ).value;
        this.use = (
          f.elements.namedItem("studioPurpose") as HTMLSelectElement
        ).value;
        await this.open(this.o.getItem());
      } catch (e) {
        (f.elements.namedItem("studioChannel") as HTMLSelectElement).value =
          this.channelId;
        (f.elements.namedItem("studioPurpose") as HTMLSelectElement).value =
          this.use;
        this.error(e);
      }
    };
    for (const name of ["studioChannel", "studioPurpose"])
      (f.elements.namedItem(name) as HTMLSelectElement).addEventListener(
        "change",
        () => {
          void switchTarget();
        },
      );
    bindImageOrder(this.host.querySelector<HTMLElement>(".studio-image-order")!, () => this.selected, modify, () => this.busy || !!this.pending);
    if (this.conflictDraft) {
      const resolve = (remote: boolean) => {
        if (
          !(f.elements.namedItem("studioConflictAck") as HTMLInputElement)
            .checked
        ) {
          this.feedback("请先比较并确认冲突处理。", true);
          return;
        }
        const latest = this.conflictDraft!;
        if (remote) {
          (f.elements.namedItem("studioTitle") as HTMLInputElement).value =
            latest.title;
          (f.elements.namedItem("studioBody") as HTMLTextAreaElement).value =
            latest.body;
          this.selected = [...latest.assetIds];
        }
        this.draftId = latest.id;
        this.draftVersion = latest.version;
        this.conflictDraft = null;
        this.host.querySelector(".studio-draft-conflict")?.remove();
        for (const c of this.host.querySelectorAll<HTMLInputElement>(
          "[data-studio-photo]",
        ))
          c.checked = this.selected.includes(c.dataset.studioPhoto!);
        modify();
        this.feedback("冲突已核对，当前内容尚需保存。");
      };
      this.host
        .querySelector("#studio-use-remote")!
        .addEventListener("click", () => resolve(true));
      this.host
        .querySelector("#studio-keep-local")!
        .addEventListener("click", () => resolve(false));
    }
    this.updateCount();
  }
  private updateCount() {
    const s = this.capture();
    if (!s) return;
    this.host.querySelector(".studio-title-count")!.textContent =
      `${Array.from(s.title).length} / ${this.plan!.channel.titleLimit} 字（保留完整 ${this.item.code}）`;
    this.host.querySelector(".studio-selection-count")!.textContent =
      `${this.selected.length} / 40 张`;
    this.host.querySelector(".studio-image-order")!.innerHTML = imageOrder(this.selected, this.plan!.assets);
  }
  private error(e: unknown) {
    if (e instanceof ApiError && e.code === "VERSION_CONFLICT")
      queueMicrotask(() => {
        void this.open(this.o.getItem(), true);
      });
    this.feedback((e as Error).message, true);
    const login = this.host.querySelector<HTMLButtonElement>("#studio-login");
    if (login)
      login.hidden = !(
        e instanceof ApiError &&
        (e.status === 401 || e.status === 403)
      );
  }
  async saveDraft() {
    if (this.conflictDraft) throw new Error("请先处理渠道文案冲突，再保存。");
    if (this.busy || this.pending)
      throw new Error("上次操作尚未完成，请先核对结果");
    const data = this.capture();
    if (!data || !this.plan) return;
    const unlock = lockControls(this.host);
    this.busy = true;
    try {
      const r = await this.draftWrite.run<{ id: string; version: number }>(
        `/items/${this.item.id}/publishing-draft`,
        {
          channelId: this.channelId,
          purpose: this.use,
          version: this.draftVersion,
          title: data.title,
          body: data.body,
          assetIds: data.ids,
          basisRevisionId: this.plan.approvedId,
          basisPrice: this.plan.price,
          basisCurrency: this.plan.currency,
        },
      );
      this.draftId = r.id;
      this.draftVersion = r.version;
      this.dirty = false;
      this.copyEdited = true;
      this.feedback("此渠道草稿已保存；尚未发布。");
    } finally {
      this.busy = false;
      unlock();
      if (this.draftWrite.uncertain) {
        const r = this.host.querySelector<HTMLButtonElement>("#studio-resume");
        if (r) r.hidden = false;
      }
    }
  }
  private async refreshFromEditor() {
    if (this.busy || this.pending) return;
    const unlockView = lockControls(this.host);
    this.feedback("正在保存商品并重新核对…");
    try {
      const item = await this.o.saveItem();
      if (item) {
        await this.open(item, true);
        this.feedback("商品资料已保存并重新检查，原文案保留。请重新核对确认。");
      }
    } catch (e) {
      this.error(e);
    } finally {
      unlockView();
    }
  }
  private async generate() {
    if (this.conflictDraft) {
      this.feedback("请先处理渠道文案冲突，不会覆盖别人的改动。", true);
      return;
    }
    if (this.busy) return;
    if (this.pending) {
      await this.resume();
      return;
    }
    if (this.o.isDirty()) {
      this.feedback(
        "商品有未保存修改。请点“保存并刷新核对”，无需离开本页。",
        true,
      );
      return;
    }
    if (this.draftWrite.uncertain) {
      this.feedback("上次草稿保存结果待确认，请先继续上次提交。", true);
      return;
    }
    const p = this.plan!,
      data = this.capture()!,
      f = this.host.querySelector<HTMLFormElement>("form")!;
    if (p.missing.length) {
      this.feedback("请先处理上方缺项，点击可直接定位到本页。", true);
      focusStudioField(this.o.form, p.missing[0].code);
      return;
    }
    if (!data.body.trim() || !data.title.trim()) {
      this.feedback("请填写发布标题和正文。", true);
      return;
    }
    if (!data.ids.length || data.ids.length > 40) {
      this.feedback("请选择1—40张实物图片。", true);
      return;
    }
    if (
      p.assets.some(
        (a) =>
          a.role === "DEFECT" && !a.blockedReason && !data.ids.includes(a.id),
      )
    ) {
      this.feedback("已标记的瑕疵图片必须保留，请勾选后继续。", true);
      return;
    }
    if (
      !(f.elements.namedItem("studioConfirmed") as HTMLInputElement).checked
    ) {
      this.feedback("请核对下方声明并勾选确认。", true);
      (f.elements.namedItem("studioConfirmed") as HTMLInputElement).focus();
      return;
    }
    const needsSupplierAuthorization = data.ids.some(
      (id) => p.assets.find((a) => a.id === id)?.origin !== "OWN",
    );
    if (p.canReview && needsSupplierAuthorization && data.note.trim().length < 3) {
      this.feedback("请填写供应商图片的授权依据。", true);
      f.querySelector<HTMLTextAreaElement>('[data-authorization-note] textarea')?.focus();
      return;
    }
    if (
      !p.canReview &&
      (!p.approvedValid ||
        data.ids.some((id) => !p.assets.find((a) => a.id === id)?.usable))
    ) {
      this.feedback("请有复核权限的人员在此页确认主资料及图片。", true);
      return;
    }
    this.pending = {
      ...data,
      plan: structuredClone(p),
      channel: p.channel,
      purpose: this.use,
      version: this.draftVersion,
      draftId: this.draftId,
      approvedId: p.approvedId,
      step: p.canReview ? 0 : 1,
    };
    await this.resume();
  }
  private async resume() {
    if (this.busy) return;
    const unlock = lockControls(this.o.root);
    this.busy = true;
    try {
      if (!this.pending) {
        if (this.draftWrite.uncertain) {
          const r = await this.draftWrite.retry<{
            id: string;
            version: number;
          }>();
          this.draftId = r.id;
          this.draftVersion = r.version;
          this.feedback("上次草稿已保存。新输入仍保留，修改后请再次保存。");
        }
        return;
      }
      const x = this.pending;
      if (x.step === 0) {
        this.feedback("正在确认商品与所选图片…");
        const r = await this.reviewWrite.run<{ approvedId: string }>(
          `/items/${this.item.id}/review-for-use`,
          {
            version: x.plan.version,
            digest: x.plan.digest,
            assetIds: x.ids,
            authorizationNote: x.note,
            confirmed: true,
          },
        );
        x.approvedId = r.approvedId;
        x.step = 1;
      }
      if (x.step === 1) {
        this.feedback("正在保存此渠道图文…");
        const r = await this.draftWrite.run<{ id: string; version: number }>(
          `/items/${this.item.id}/publishing-draft`,
          {
            channelId: x.channel.id,
            purpose: x.purpose,
            version: x.version,
            title: x.title,
            body: x.body,
            assetIds: x.ids,
            basisRevisionId: x.approvedId,
            basisPrice: x.plan.price,
            basisCurrency: x.plan.currency,
          },
        );
        x.draftId = r.id;
        x.version = r.version;
        this.draftId = r.id;
        this.draftVersion = r.version;
        x.step = 2;
      }
      if (x.step === 2) {
        this.feedback("正在生成可使用资料…");
        const r = await this.packageWrite.run<{ id: string }>(
          `/items/${this.item.id}/packages`,
          {
            channelId: x.channel.id,
            purpose: x.purpose,
            draftId: x.draftId,
            draftVersion: x.version,
            confirmed: true,
          },
        );
        x.packId = r.id;
        x.step = 3;
      }
      const fresh = await request<Pack>(`/packages/${x.packId}/usable`);
      fresh.channel = x.channel;
      fresh.channelId = x.channel.id;
      fresh.createdAt = new Date().toISOString();
      this.dirty = false;
      this.pending = null;
      try {
        this.plan = await request<Plan>(
          `/items/${this.item.id}/studio?channelId=${this.channelId}&purpose=${this.use}`,
        );
      } catch {
        /* Produced package remains valid; next explicit refresh rechecks live input. */
      }
      this.item.approvedId = x.approvedId;
      this.item.approvedValid = true;
      this.host.querySelector<HTMLElement>(".studio-release-result")!.hidden =
        false;
      this.host.querySelector(".studio-release-result")!.innerHTML =
        `<section class="studio-success"><h3>资料已就绪</h3><p>复制文案、下载图片后到目标平台发布，再登记结果。</p><div class="button-row">${packageButtons(
          fresh,
          async () => {
            if (this.o.signal.aborted) return;
            this.feedback(
              "已保存人工发布记录。后续售出时会生成对应渠道的停售待办。",
            );
          },
        )}</div><details><summary>查看最终文案</summary><h4>${esc(fresh.snapshot.title)}</h4><div class="copy">${esc(fresh.snapshot.body)}</div></details></section>`;
      this.feedback("已完成核对和资料生成；没有冒充平台已发布。");
      this.host
        .querySelector(".studio-release-result")!
        .scrollIntoView({ block: "nearest" });
    } catch (e) {
      this.error(e);
      if (
        !(
          this.reviewWrite.uncertain ||
          this.draftWrite.uncertain ||
          this.packageWrite.uncertain
        ) &&
        this.pending?.step !== 3
      )
        this.pending = null;
    } finally {
      this.busy = false;
      unlock();
      const resume =
        this.host.querySelector<HTMLButtonElement>("#studio-resume");
      if (resume) resume.hidden = !(this.pending || this.draftWrite.uncertain);
      for (const c of this.host.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input,select,textarea")) {
        const a =
          c instanceof HTMLInputElement && c.dataset.studioPhoto
            ? this.plan?.assets.find((a) => a.id === c.dataset.studioPhoto)
            : null;
        c.disabled =
          !!this.pending ||
          !!(a && (a.blockedReason || (!this.plan?.canReview && !a.usable)));
      }
      if (this.pending) {
        for (const c of this.host.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >("input,select,textarea"))
          c.disabled = true;
      }
    }
  }
  async close() {
    if (this.busy || this.pending) {
      this.feedback("操作结果待确认，请先继续上次提交。", true);
      return;
    }
    try {
      if (this.dirty) await this.saveDraft();
      this.visible = false;
      this.host.hidden = true;
      this.o.root.classList.remove("studio-publish-open");
    } catch (e) {
      this.error(e);
    }
  }
}
