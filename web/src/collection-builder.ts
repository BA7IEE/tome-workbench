import {
  request,
  button,
  field,
  select,
  check,
  esc,
  money,
  me,
  can,
  reload,
  ApiError,
  toast,
} from "./core";
import { setupChannel } from "./channel-setup";
import { onPageReady, setLeaveGuard } from "./page-lifecycle";
import { lockControls } from "./form-support";
import { recordPaging } from "./record-controls";
import type { Item, Channel } from "./types";
let owner = "",
  title = "",
  channelId = "",
  issues = new Map<string, string[]>();
const selected = new Map<string, Item>();
let attempt: {
  signature: string;
  title: string;
  channelId: string;
  items: Item[];
  key: string;
  packages: Map<string, string>;
  uncertain: boolean;
} | null = null;
function account() {
  if (owner !== (me?.id || "")) {
    owner = me?.id || "";
    selected.clear();
    title = "";
    channelId = "";
    issues.clear();
    attempt = null;
  }
}
export function beginCollection(items: Item[] = []) {
  account();
  if (new Set([...selected.keys(), ...items.map((i) => i.id)]).size > 40)
    throw new Error("加上已保留的选品后超过40件，请先减少选择");
  if (items.some((i) => i.dataMode === "TEST"))
    throw new Error("客户选品只接收正式商品");
  for (const i of items) selected.set(i.id, i);
  location.hash = "/collections/new";
}
export async function collectionBuilder() {
  account();
  if (!can("publish")) return "<p>需要发布权限才能创建客户选品。</p>";
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    q = qs.get("q") || "";
  const [data, channels] = await Promise.all([
    request<{ rows: Item[]; total: number; page: number; size: number }>(
      `/items?dataMode=BUSINESS&q=${encodeURIComponent(q)}&page=${qs.get("page") || 1}`,
    ),
    request<Channel[]>("/channels"),
  ]);
  const active = channels.filter((c) => c.active);
  const replayChannel = attempt?.uncertain
    ? channels.find((c) => c.id === attempt?.channelId && !c.active)
    : undefined;
  const options = replayChannel ? [...active, replayChannel] : active;
  if (!attempt?.uncertain && !active.some((c) => c.id === channelId))
    channelId = active[0]?.id || "";
  for (const i of data.rows) if (selected.has(i.id)) selected.set(i.id, i);
  const picture = (i: Item) =>
    i.assets[0]
      ? `<img class="record-thumb" src="/api/assets/${i.assets[0].id}/preview" alt="${esc(i.title)}">`
      : "";
  const edit = (i: Item) =>
    `<a class="btn" href="#/items/${i.id}/edit?returnTo=${encodeURIComponent(location.hash)}">原地完善后返回</a>`;
  const paintSelected = () =>
    `<h2>已选 ${selected.size} / 40 件</h2>${[...selected.values()].map((i) => `<article class="selection-row">${picture(i)}<div><strong>${esc(i.code)} · ${esc(i.title)}</strong><small>${money(i.currentPrice, i.currency)} · ${i.approvedValid ? "已有确认资料" : "资料待确认"}</small>${(issues.get(i.id) || []).map((x) => `<p class="form-error">${esc(x)}</p>`).join("")}</div>${edit(i)}<button type="button" class="btn" data-remove-item="${i.id}">移除 ${esc(i.code)}</button></article>`).join("")}`;
  onPageReady("collection-builder", (root, signal) => {
    let busy = false;
    const f = root.querySelector<HTMLFormElement>("#collection-build")!,
      error = root.querySelector<HTMLElement>("[data-collection-error]")!;
    const capture = () => {
      title = String(new FormData(f).get("title") || "");
      channelId = String(new FormData(f).get("channelId") || "");
    };
    const paint = () => {
      root.querySelector("[data-selected-items]")!.innerHTML = paintSelected();
      root
        .querySelectorAll<HTMLInputElement>("[data-choose-item]")
        .forEach((b) => (b.checked = selected.has(b.dataset.chooseItem!)));
    };
    root.addEventListener(
      "input",
      () => {
        capture();
      },
      { signal },
    );
    root.addEventListener(
      "change",
      (e) => {
        capture();
        const b = e.target as HTMLInputElement;
        if (b.dataset.chooseItem) {
          if (b.checked && selected.size >= 40) {
            b.checked = false;
            error.textContent = "每批最多40件";
            return;
          }
          const i = data.rows.find((x) => x.id === b.dataset.chooseItem)!;
          if (b.checked) selected.set(i.id, i);
          else selected.delete(i.id);
          paint();
        }
      },
      { signal },
    );
    root.addEventListener(
      "click",
      (e) => {
        const b = (e.target as Element).closest<HTMLElement>(
          "[data-remove-item]",
        );
        if (b && !busy) {
          selected.delete(b.dataset.removeItem!);
          paint();
        }
      },
      { signal },
    );
    root.querySelector("#collection-search")!.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        capture();
        const d = new FormData(e.currentTarget as HTMLFormElement);
        location.hash =
          "/collections/new?q=" + encodeURIComponent(String(d.get("q") || ""));
      },
      { signal },
    );
    const preflight = async () => {
      if (!selected.size || !channelId)
        throw new Error("请先选择商品和启用的渠道");
      const p = await request<{
        ready: boolean;
        rows: { id: string; issues: string[] }[];
      }>("/collections/preflight", "POST", {
        itemIds: [...selected.keys()],
        channelId,
      });
      issues = new Map(p.rows.map((r) => [r.id, r.issues]));
      paint();
      if (!p.ready)
        throw new Error(
          "部分商品尚未就绪，原因已列在对应商品下。完善后返回重新预检，已选商品会保留。",
        );
      return p;
    };
    root.querySelector("[data-check-selection]")!.addEventListener(
      "click",
      async () => {
        if (busy) return;
        capture();
        busy = true;
        const unlock = lockControls(root);
        try {
          await preflight();
          error.textContent = "所选商品预检通过，可以确认生成。";
        } catch (e) {
          error.textContent = (e as Error).message;
        } finally {
          busy = false;
          unlock();
        }
      },
      { signal },
    );
    f.addEventListener(
      "submit",
      async (e) => {
        e.preventDefault();
        if (busy) return;
        capture();
        const confirmed = new FormData(f).has("confirmed");
        if (!confirmed) {
          error.textContent = "请先确认本次选品";
          return;
        }
        busy = true;
        const unlock = lockControls(root);
        error.textContent = "";
        try {
          const signature = JSON.stringify({
            title,
            channelId,
            ids: [...selected.keys()],
          });
          if (attempt?.uncertain && attempt.signature !== signature)
            throw new Error("上次结果待确认，请恢复原选品内容后重试");
          if (!attempt || attempt.signature !== signature)
            attempt = {
              signature,
              title,
              channelId,
              items: [...selected.values()],
              key: crypto.randomUUID(),
              packages: new Map(),
              uncertain: false,
            };
          if (!attempt.uncertain) await preflight();
          for (const i of selected.values()) {
            if (attempt.packages.has(i.id)) continue;
            const p = await request<{ id: string }>(
              `/items/${i.id}/packages`,
              "POST",
              { channelId, purpose: "CUSTOMER_CARD", confirmed: true },
              attempt.key + ":" + i.id,
            );
            attempt.packages.set(i.id, p.id);
          }
          const result = await request<{ id: string }>(
            "/collections",
            "POST",
            {
              title,
              packageIds: [...attempt.packages.values()],
              confirmed: true,
            },
            attempt.key,
          );
          attempt = null;
          selected.clear();
          title = "";
          issues.clear();
          toast("选品合集已生成");
          location.hash = "/collections/" + result.id;
        } catch (e) {
          if (attempt)
            attempt.uncertain =
              attempt.uncertain ||
              (e instanceof ApiError && (e.status === 0 || e.status >= 500));
          error.textContent = (e as Error).message;
        } finally {
          busy = false;
          unlock();
        }
      },
      { signal },
    );
    setLeaveGuard(() => !busy);
    window.addEventListener(
      "beforeunload",
      (e) => {
        if (busy || selected.size || title) {
          e.preventDefault();
          e.returnValue = "";
        }
      },
      { signal },
    );
  });
  return `<div id="collection-builder"><a href="#/collections">← 客户选品</a><div class="page-title"><div><h1>看图选品</h1><p>先选择商品，集中预检；需要补资料时可进入商品维护，返回后继续。</p></div>${button(
    "重新准备本次选品",
    () => {
      if (attempt?.uncertain)
        throw new Error("先使用原内容重试，确认上次结果后再重新准备");
      attempt = null;
      issues.clear();
      void reload();
    },
  )}${button("恢复上次提交内容", () => {
    if (!attempt) {
      toast("当前没有待恢复的提交");
      return;
    }
    title = attempt.title;
    channelId = attempt.channelId;
    selected.clear();
    for (const item of attempt.items) selected.set(item.id, item);
    void reload();
  })}${can("users") ? button("添加渠道", () => setupChannel(reload)) : ""}</div>${!active.length ? '<div class="notice warning">还没有启用渠道，请先添加渠道；当前选择会保留。</div>' : ""}<form id="collection-search" class="filters">${field("q", "搜索选品商品", q, "text", false, 'placeholder="品牌、名称或TM编号"')}<button class="btn">搜索</button></form><div class="selection-grid">${data.rows.map((i) => `<label class="selection-choice">${picture(i)}<input type="checkbox" data-choose-item="${i.id}" aria-label="选品 ${esc(i.code)}" ${selected.has(i.id) ? "checked" : ""}><span>${esc(i.code)} · ${esc(i.title)}<small>${money(i.currentPrice, i.currency)}</small></span></label>`).join("")}</div>${recordPaging("collections/new", qs, data)}<form id="collection-build">${field("title", "合集名称", title, "text", true)}${select("channelId", "语言与内容模板", Object.fromEntries(options.map((c) => [c.id, c.name + " / " + c.locale + (c.active ? "" : "（上次提交，已停用）")])), channelId)}<div data-selected-items>${paintSelected()}</div>${check("confirmed", "我已确认选择的商品，生成本次客户选品快照")}<p class="form-error" data-collection-error role="alert"></p><div class="button-row"><button type="button" class="btn" data-check-selection>预检全部商品</button><button class="btn primary" ${options.length ? "" : "disabled"}>生成选品合集</button></div></form></div>`;
}
