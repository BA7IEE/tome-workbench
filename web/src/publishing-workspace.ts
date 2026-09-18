import { WriteAttempt } from "./write-attempt";
import {
  copyText,
  ApiError,
  reauthenticate,
  request,
  can,
  esc,
  money,
  when,
  button,
  field,
  area,
  check,
  form,
  viewDialog,
  note,
  section,
  reload,
  toast,
  downloadPack,
} from "./core";
import type { Item, Channel, Pack } from "./types";
import { onPageReady, setLeaveGuard } from "./page-lifecycle";
import { setupChannel, platformNames } from "./channel-setup";
interface Draft {
  id: string;
  version: number;
  title: string;
  body: string;
  assetIds: string[];
  basisRevisionId: string | null;
  basisPrice: number | null;
  basisCurrency: string;
  updatedAt: string;
}
interface Space {
  item: {
    id: string;
    code: string;
    title: string;
    status: string;
    version: number;
    approvedId: string | null;
    approvedValid: boolean;
    price: number | null;
    currency: string;
  };
  channel: Channel;
  draft: Draft | null;
  suggested: { title: string; body: string; notice: string } | null;
  assets: { id: string; role: string; originalName: string; usable: boolean }[];
  outdated: boolean;
}
interface Usable {
  id: string;
  channelId: string;
  purpose: string;
  snapshot: Pack["snapshot"];
  validUntil: string;
}
interface DistributionTarget {
  id: string;
  channelId: string;
  active: boolean;
  channel: {
    id: string;
    name: string;
    platform: string;
    active: boolean;
    businessPurpose: string;
  };
}
async function checked(p: Pack) {
  return request<Usable>(`/packages/${p.id}/usable`);
}
export function recordPublication(p: Pack, after?: () => Promise<void>) {
  form(
    p.channel.platform === "SHOWROOM" ? "发布到自有展厅" : "记录已完成的发布",
    note(
      p.channel.platform === "SHOWROOM"
        ? "将这份已确认资料展示到本系统展厅。"
        : p.channel.platform === "ANQICMS"
          ? "请先实际完成 AnQiCMS 发布或更新，再登记真实 archive ID；系统不会接受空 ID 或手工占位。"
          : "请先实际完成平台发布，再登记结果；没有稳定平台ID时，系统会保留发布 Attempt，不会伪造 Listing。",
    ) +
      field("url", "平台商品链接（可稍后补充）", "", "url") +
      field(
        "remoteId",
        p.channel.platform === "ANQICMS"
          ? "AnQiCMS archive ID（必填）"
          : "稳定平台商品ID（可留空）",
        p.channel.platform === "SHOWROOM" ? p.id : "",
        "text",
        p.channel.platform === "ANQICMS",
      ) +
      area(
        "evidenceNote",
        "实际发布或核对依据",
        p.channel.platform === "SHOWROOM"
          ? "本系统展厅已展示该使用包。"
          : `已在对应账号完成发布，可通过标题中的 ${p.snapshot.code} 核对。`,
        3,
      ),
    async (d, k) => {
      await checked(p);
      if (
        p.channel.platform === "ANQICMS" &&
        !String(d.get("remoteId") || "").trim()
      )
        throw new Error("AnQiCMS 发布或更新成功必须填写真实 archive ID");
      const attempt = await request<{
        id: string;
        action?: string;
        noop?: boolean;
      }>("/distribution/plan", "POST", { packageId: p.id }, k);
      if (attempt.noop || attempt.action === "NOOP") {
        toast("资料与已确认完成版本一致，已保留原分发记录");
        return attempt;
      }
      return request(
        `/distribution/attempts/${attempt.id}/manual-result`,
        "POST",
        {
          state: "SUCCEEDED",
          remoteId: String(d.get("remoteId") || ""),
          remoteUrl: String(d.get("url") || ""),
          evidence: {
            method: "MANUAL_CONFIRMATION",
            note: String(d.get("evidenceNote") || ""),
          },
        },
        `${k}:manual`,
      );
    },
    p.channel.platform === "SHOWROOM" ? "确认展示" : "记录发布结果",
    after,
  );
}
export function packageButtons(
  p: Pack,
  afterReceipt?: () => Promise<void>,
  allowPublication = true,
) {
  return (
    button("复制标题", async () => {
      const fresh = await checked(p);
      if (await copyText(fresh.snapshot.title)) toast("标题已复制");
    }) +
    button("复制正文", async () => {
      const fresh = await checked(p);
      if (await copyText(fresh.snapshot.body)) toast("正文已复制");
    }) +
    button("下载JPG图片与文案", () => downloadPack(p.id)) +
    (p.purpose !== "CUSTOMER_CARD" && allowPublication
      ? button(
          p.channel.platform === "SHOWROOM" ? "展示到自有展厅" : "登记已发布",
          () => recordPublication(p, afterReceipt),
        )
      : "")
  );
}
export async function publishingWorkspace(i: Item, channels: Channel[]) {
  if (!can("publish"))
    return section(
      "渠道资料",
      note("此账号可以查看商品。生成发布资料需要发布权限，请联系管理员。"),
    );
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    use = qs.get("purpose") || "TRADE",
    available = channels.filter(
      (channel) =>
        channel.active &&
        (use !== "TRADE" || channel.businessPurpose === "TRADE"),
    );
  if (!available.length)
    return section(
      use === "TRADE" ? "先添加交易用途渠道" : "先添加你要使用的渠道",
      note(
        use === "TRADE"
          ? "交易发布只可使用交易用途账号；小红书等内容渠道和自有展厅不进入交易分发。"
          : "例如闲鱼主号、小红书店铺、VC英文账号。每个渠道独立维护文案，不重复录入商品事实。",
      ),
      can("users") ? button("＋ 添加常用渠道", setupChannel, "primary") : "",
    );
  const channel =
    available.find((c) => c.id === qs.get("channel")) || available[0];
  const [space, readiness, targets] = await Promise.all([
    request<Space>(
      `/items/${i.id}/publishing-space?channelId=${channel.id}&purpose=${use}`,
    ),
    request<{
      missing: { code: string; title: string }[];
      approved: boolean;
      ready: boolean;
    }>(`/items/${i.id}/readiness?channelId=${channel.id}&purpose=${use}`),
    use === "TRADE"
      ? request<DistributionTarget[]>(`/items/${i.id}/distribution-targets`)
      : Promise.resolve<DistributionTarget[]>([]),
  ]);
  const activeTarget =
      use !== "TRADE" ||
      targets.some(
        (target) => target.channelId === channel.id && target.active,
      ),
    duplicatePlatformTarget = targets.some(
      (target) =>
        target.active &&
        target.channelId !== channel.id &&
        target.channel.platform === channel.platform,
    ),
    root = "publish-" + crypto.randomUUID(),
    draft = space.draft;
  let selected = draft
      ? [...draft.assetIds]
      : space.assets
          .filter((a) => a.usable)
          .map((a) => a.id)
          .slice(0, 40),
    version = draft?.version || 0,
    draftId = draft?.id || "",
    basis = {
      basisRevisionId: draft ? draft.basisRevisionId : space.item.approvedId,
      basisPrice: draft ? draft.basisPrice : space.item.price,
      basisCurrency: draft ? draft.basisCurrency : space.item.currency,
    },
    dirty = false;
  const title = draft ? draft.title : space.suggested?.title || i.title,
    body = draft?.body ?? space.suggested?.body ?? "";
  onPageReady(root, (el, signal) => {
    const formEl = el.querySelector<HTMLFormElement>("#channel-draft")!,
      titleEl = formEl.elements.namedItem("title") as HTMLInputElement,
      bodyEl = formEl.elements.namedItem("body") as HTMLTextAreaElement,
      status = el.querySelector<HTMLElement>(".draft-state")!;
    let busy = false;
    const draftAttempt = new WriteAttempt(request),
      publishAttempt = new WriteAttempt(request);
    const feedback = el.querySelector<HTMLElement>(".publish-feedback")!;
    const recoverButton =
      el.querySelector<HTMLButtonElement>("#recover-write")!;
    const loginButton = el.querySelector<HTMLButtonElement>("#recover-login")!;
    const showStatus = (message: string, error = false) => {
      status.textContent = message;
      feedback.textContent = message;
      feedback.classList.toggle("form-error", error);
      recoverButton.hidden = !(
        draftAttempt.uncertain || publishAttempt.uncertain
      );
    };
    const showError = (error: unknown) => {
      showStatus((error as Error).message, true);
      loginButton.hidden = !(
        error instanceof ApiError &&
        (error.status === 401 || error.code === "ACCOUNT_REVOKED")
      );
    };
    const painted = () => {
      el.querySelector(".copy-preview h3")!.textContent = titleEl.value;
      el.querySelector(".copy-preview .copy")!.textContent = bodyEl.value;
      el.querySelector(".title-count")!.textContent =
        `${Array.from(titleEl.value).length} / ${channel.titleLimit} 字（确认时保留完整 ${i.code}）`;
      el.querySelector(".selected-images")!.innerHTML = selected
        .map((id, n) => {
          const a = space.assets.find((a) => a.id === id);
          return `<div><img src="/api/assets/${id}/preview" alt="${esc(a?.originalName || "原选图片")}"><span>${n + 1} · ${esc(a?.originalName || "已移出当前图片列表")}</span><button type="button" class="btn subtle" data-image-up="${id}" ${n === 0 ? "disabled" : ""}>前移</button><button type="button" class="btn subtle" data-image-remove="${id}">移除</button></div>`;
        })
        .join("");
    };
    const modified = () => {
      dirty = true;
      (formEl.elements.namedItem("confirmed") as HTMLInputElement).checked =
        false;
      showStatus("有修改尚未保存，请在修改完成后重新核对确认");
      painted();
    };
    const originallyDisabled = new WeakMap<Element, boolean>();
    const locked = (value: boolean) => {
      busy = value;
      for (const control of el.querySelectorAll<
        | HTMLInputElement
        | HTMLButtonElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      >("input,button,select,textarea")) {
        if (value) {
          originallyDisabled.set(control, control.disabled);
          control.disabled = true;
        } else control.disabled = originallyDisabled.get(control) || false;
      }
    };
    const save = async () => {
      if (!dirty && draftId && !draftAttempt.uncertain)
        return { id: draftId, version };
      const result = await draftAttempt.run<{ id: string; version: number }>(
        `/items/${i.id}/publishing-draft`,
        {
          channelId: channel.id,
          purpose: use,
          version,
          title: titleEl.value,
          body: bodyEl.value,
          assetIds: [...selected],
          ...basis,
        },
      );
      draftId = result.id;
      version = result.version;
      dirty = false;
      showStatus("草稿已保存 · " + new Date().toLocaleTimeString("zh-CN"));
      try {
        const latest = await request<{
          missing: { code: string; title: string }[];
        }>(`/items/${i.id}/readiness?channelId=${channel.id}&purpose=${use}`);
        const panel = el.querySelector("#publication-requirements");
        if (panel)
          panel.innerHTML =
            "<h3>还需要处理</h3>" +
            (latest.missing.length
              ? "<ul>" +
                latest.missing.map((m) => `<li>${esc(m.title)}</li>`).join("") +
                "</ul>"
              : "<p>已保存资料的基础要求已满足，仍需核对本次选图与文案。</p>");
      } catch {
        /* The draft was saved. Keep the last known checklist if its read failed. */
      }
      return result;
    };
    formEl.addEventListener(
      "input",
      (e) => {
        const t = e.target as HTMLInputElement;
        if (t.name !== "confirmed" && !t.dataset.draftImage) modified();
      },
      { signal },
    );
    formEl.addEventListener(
      "submit",
      async (e) => {
        e.preventDefault();
        if (busy) return;
        locked(true);
        try {
          await save();
          toast("此渠道草稿已保存，不会修改其他渠道");
        } catch (error) {
          showError(error);
        } finally {
          locked(false);
        }
      },
      { signal },
    );
    el.addEventListener(
      "click",
      (e) => {
        const target = (e.target as Element).closest<HTMLElement>(
          "[data-image-up],[data-image-remove]",
        );
        if (!target || busy) return;
        const id = target.dataset.imageUp || target.dataset.imageRemove!,
          index = selected.indexOf(id);
        if (target.dataset.imageUp && index > 0)
          [selected[index - 1], selected[index]] = [
            selected[index],
            selected[index - 1],
          ];
        else if (target.dataset.imageRemove)
          selected = selected.filter((v) => v !== id);
        for (const box of el.querySelectorAll<HTMLInputElement>(
          "[data-draft-image]",
        ))
          box.checked = selected.includes(box.dataset.draftImage!);
        modified();
      },
      { signal },
    );
    el.addEventListener(
      "change",
      (e) => {
        const t = e.target as HTMLInputElement;
        if (t.dataset.draftImage) {
          const id = t.dataset.draftImage;
          if (t.checked && !selected.includes(id)) selected.push(id);
          if (!t.checked) selected = selected.filter((v) => v !== id);
          modified();
        }
      },
      { signal },
    );
    const rebuild = async () => {
      const fresh = await request<Space>(
        `/items/${i.id}/publishing-space?channelId=${channel.id}&purpose=${use}`,
      );
      if (!fresh.suggested)
        throw new Error("请先确认商品主资料，再生成文案底稿");
      viewDialog(
        "比较最新资料与当前文案",
        `<div class="compare-grid"><section><h3>当前编辑内容</h3><div class="copy">${esc(bodyEl.value)}</div></section><section><h3>最新资料排版</h3><div class="copy">${esc(fresh.suggested.body)}</div></section></div>` +
          button("采用最新底稿", () => {
            titleEl.value = fresh.suggested!.title;
            bodyEl.value = fresh.suggested!.body;
            basis = {
              basisRevisionId: fresh.item.approvedId,
              basisPrice: fresh.item.price,
              basisCurrency: fresh.item.currency,
            };
            modified();
            document.querySelector<HTMLDialogElement>("#dialog")!.close();
          }) +
          button("已逐段核对，保留我的文字", () => {
            if (!window.confirm("确认当前文案与最新商品资料、品相和报价一致？"))
              return;
            basis = {
              basisRevisionId: fresh.item.approvedId,
              basisPrice: fresh.item.price,
              basisCurrency: fresh.item.currency,
            };
            modified();
            document.querySelector<HTMLDialogElement>("#dialog")!.close();
          }),
      );
    };
    el.querySelector("#refresh-copy")!.addEventListener(
      "click",
      () => {
        void rebuild().catch((e) => toast(e.message, true));
      },
      { signal },
    );
    el.querySelector("#confirm-copy")!.addEventListener(
      "click",
      async () => {
        if (busy) return;
        if (
          !(formEl.elements.namedItem("confirmed") as HTMLInputElement).checked
        ) {
          showStatus("请先核对图片、品相和文案，并勾选确认", true);
          (formEl.elements.namedItem("confirmed") as HTMLInputElement).focus();
          return;
        }
        locked(true);
        try {
          await save();
          await publishAttempt.run(`/items/${i.id}/packages`, {
            channelId: channel.id,
            purpose: use,
            draftId,
            draftVersion: version,
            confirmed: true,
          });
          dirty = false;
          setLeaveGuard(null);
          await reload();
          toast("发布资料已生成；还没有记为平台已发布");
        } catch (error) {
          showError(error);
        } finally {
          locked(false);
        }
      },
      { signal },
    );
    el.querySelector<HTMLSelectElement>("#use-channel")!.addEventListener(
      "change",
      (e) => {
        const value = (e.target as HTMLSelectElement).value;
        location.hash = `/items/${i.id}?tab=use&channel=${value}&purpose=${use}`;
      },
      { signal },
    );
    el.querySelector<HTMLSelectElement>("#use-purpose")!.addEventListener(
      "change",
      (e) => {
        location.hash = `/items/${i.id}?tab=use&channel=${channel.id}&purpose=${(e.target as HTMLSelectElement).value}`;
      },
      { signal },
    );
    window.addEventListener(
      "navigation-cancelled",
      () => {
        (el.querySelector("#use-channel") as HTMLSelectElement).value =
          channel.id;
        (el.querySelector("#use-purpose") as HTMLSelectElement).value = use;
      },
      { signal },
    );
    setLeaveGuard(() => {
      if (busy) {
        showStatus("正在提交，请等待结果后再切换页面", true);
        return false;
      }
      return (
        !(dirty || draftAttempt.uncertain || publishAttempt.uncertain) ||
        window.confirm("当前还有未保存或待核对的提交，确定离开吗？")
      );
    });
    window.addEventListener(
      "beforeunload",
      (e) => {
        if (
          dirty ||
          busy ||
          draftAttempt.uncertain ||
          publishAttempt.uncertain
        ) {
          e.preventDefault();
          e.returnValue = "";
        }
      },
      { signal },
    );
    formEl.addEventListener(
      "keydown",
      (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
          e.preventDefault();
          formEl.requestSubmit();
        }
      },
      { signal },
    );
    recoverButton.addEventListener(
      "click",
      async () => {
        if (busy) return;
        locked(true);
        try {
          if (draftAttempt.uncertain) {
            const r = await draftAttempt.retry<{
              id: string;
              version: number;
            }>();
            draftId = r.id;
            version = r.version;
            showStatus(
              "上次草稿已核对成功，当前编辑内容仍然保留；有新修改时请再保存。",
            );
          } else if (publishAttempt.uncertain) {
            await publishAttempt.retry();
            if (dirty)
              showStatus("上次发布资料已生成，当前未保存的修改仍保留在此处。");
            else {
              setLeaveGuard(null);
              await reload();
              toast("上次发布资料已核对成功，没有重复生成");
            }
          }
        } catch (error) {
          showError(error);
        } finally {
          locked(false);
        }
      },
      { signal },
    );
    loginButton.addEventListener(
      "click",
      async () => {
        try {
          await reauthenticate();
          loginButton.hidden = true;
          showStatus("登录已恢复，输入内容已保留，请再次提交。");
        } catch (e) {
          showError(e);
        }
      },
      { signal },
    );
    const targetButton =
      el.querySelector<HTMLButtonElement>("#activate-distribution-target");
    targetButton?.addEventListener(
      "click",
      async () => {
        if (
          duplicatePlatformTarget &&
          !window.confirm(
            `这件商品已在另一个 ${platformNames[channel.platform] || channel.platform} 账号经营。确认还要同时加入「${channel.name}」？`,
          )
        )
          return;
        if (busy) return;
        locked(true);
        try {
          await request(
            `/items/${i.id}/distribution-targets/${channel.id}`,
            "POST",
            {
              active: true,
              reason: "商品渠道资料页明确加入分发渠道",
              duplicatePlatformConfirmed: duplicatePlatformTarget,
            },
            crypto.randomUUID(),
          );
          toast("已加入此分发渠道");
          await reload();
        } catch (error) {
          locked(false);
          showError(error);
        }
      },
      { signal },
    );
    painted();
  });
  const missingLinks: Record<string, string> = {
    images: "assets",
    supply: "supply",
    availability: "supply",
  };
  const alerts =
    (use === "TRADE" && !activeTarget
      ? `<div class="notice warning">这件商品尚未明确加入「${esc(channel.name)}」经营。可以先准备草稿和冻结资料，但新的发布/更新交付必须先明确经营意图。 <button type="button" class="btn" id="activate-distribution-target">加入此分发渠道</button></div>`
      : "") +
    (!space.item.approvedValid
      ? `<div class="notice warning">主资料尚未确认。可以先保存此处草稿，<a href="#/items/${i.id}?tab=facts">返回核对主资料</a>后再生成发布资料。</div>`
      : "") +
    (space.outdated
      ? `<div class="notice warning">商品资料或报价已经变化。已保留你的文案，请点击“比较最新资料”核对后再使用。</div>`
      : "");
  const history = i.packages.filter(
    (p) => p.channelId === channel.id && p.purpose === use,
  );
  return (
    `<div id="${root}" class="publishing-workspace"><div class="publish-heading"><div><h2>准备渠道发布</h2><p>先选账号，再编辑文案和图片；保存草稿不等于已经发布。</p></div>${can("users") ? '<a class="btn" href="#/settings">管理渠道账号</a>' : ""}</div><div class="channel-controls"><label>目标账号<select id="use-channel" aria-label="目标账号">${available.map((c) => `<option value="${c.id}" ${c.id === channel.id ? "selected" : ""}>${esc(platformNames[c.platform] || c.platform)} · ${esc(c.name)}</option>`).join("")}</select></label><label>使用方式<select id="use-purpose" aria-label="使用方式">${Object.entries(
      {
        TRADE: "平台商品发布",
        CUSTOMER_CARD: "发给客户的商品卡",
        SHOWROOM: "自有展厅展示",
      },
    )
      .map(
        ([v, l]) =>
          `<option value="${v}" ${use === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></label><strong>${money(space.item.price, space.item.currency)}</strong></div>${alerts}
 <div class="publishing-columns"><form id="channel-draft" class="panel"><div class="panel-head"><h3>文案与选图</h3><span class="draft-state" role="status">${draft ? "已保存 · " + when(draft.updatedAt) : "尚未保存"}</span></div>${field("title", "此渠道标题", title)}<small class="title-count"></small>${area("body", "此渠道正文", body, 12)}${space.suggested?.notice ? note(space.suggested.notice) : ""}<div class="button-row"><button type="button" class="btn" id="refresh-copy">比较最新资料</button><button type="submit" class="btn primary">保存渠道草稿</button></div><h3>选择这次使用的图片</h3><p>已核验的瑕疵图片必须保留；灰色图片尚未满足使用条件，<a class="text-link" href="#/items/${i.id}?tab=assets">前往素材页核验或处理授权</a>。已核验的图片可以点击整张图选取。</p><div class="choose-images">${space.assets.map((a) => `<label class="${a.usable ? "" : "unavailable-image"}"><input aria-label="选择图片 ${esc(a.originalName)}" type="checkbox" data-draft-image="${a.id}" ${selected.includes(a.id) ? "checked" : ""} ${!a.usable && !selected.includes(a.id) ? "disabled" : ""}><img src="/api/assets/${a.id}/preview" alt="${esc(a.originalName)}"><span>${esc(a.originalName)}${a.role === "DEFECT" ? " · 瑕疵" : ""}${a.usable ? "" : " · 待复核"}</span></label>`).join("")}</div><div class="selected-images"></div>${check("confirmed", "已核对本次文案、图片、品相及报价，确认可以使用")}<p class="publish-feedback" role="status" aria-live="polite"></p><div class="button-row"><button type="button" class="btn" id="recover-write" hidden>核对上次提交</button><button type="button" class="btn" id="recover-login" hidden>重新登录并保留输入</button></div><button type="button" class="btn primary wide" id="confirm-copy">生成可复制的发布资料</button><p class="note">草稿可随时保存；生成资料后还需要实际发布并登记结果。</p></form>
 <aside class="publish-aside"><section class="panel copy-preview"><h3></h3><div class="copy"></div><p>${money(space.item.price, space.item.currency)}</p></section><section class="panel" id="publication-requirements"><h3>还需要处理</h3>${readiness.missing.length ? `<ul>${readiness.missing.map((m) => `<li><a href="#/items/${i.id}?tab=${missingLinks[m.code] || "facts"}">${esc(m.title)}</a></li>`).join("")}</ul>` : "<p>商品基础要求已满足。请核对本次文案与选图。</p>"}</section></aside></div>` +
    section(
      "已经确认的发布资料",
      history.length
        ? history
            .map(
              (p) =>
                `<article class="release-card"><div><h3>${esc(p.snapshot.title)}</h3><small>${when(p.createdAt)} · 使用前重新核验有效性</small></div><div class="button-row">${packageButtons(
                  p,
                  undefined,
                  use !== "TRADE" || activeTarget,
                )}</div></article>`,
            )
            .join("")
        : note(
            "还没有确认过的资料。上面的渠道草稿保存后，可继续补充，不会丢失。",
          ),
    ) +
    `</div>`
  );
}
