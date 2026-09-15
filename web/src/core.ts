import { bindFormValidation, lockControls } from "./form-support";
import type { User, Obj } from "./types";
export let me: User | null = null;
let csrf = "";
let lastUser: User | null = null;
let dialogScope = new AbortController();
function newDialogScope() {
  dialogScope.abort();
  dialogScope = new AbortController();
  return dialogScope;
}
export function onDialogClosed(fn: () => void) {
  const scope = dialogScope;
  const closed = () => {
    // WebKit may dispatch the previous dialog's queued close after a new step opens.
    // Do not consume this step's listener until it is actually closed.
    if (dialog.open || scope.signal.aborted) return;
    dialog.removeEventListener("close", closed);
    fn();
  };
  dialog.addEventListener("close", closed, { signal: scope.signal });
}
export const app = document.querySelector<HTMLDivElement>("#app")!;
export const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
export const actions = new Map<string, () => void | Promise<void>>();
let refresh: () => Promise<void> = async () => {};
export const setRefresh = (f: () => Promise<void>) => (refresh = f);
export const reload = () => refresh();
export function setSession(u: User, c: string) {
  me = u;
  lastUser = u;
  csrf = c;
}
export function can(action: string) {
  const grants: Record<string, string[]> = {
    ADMIN: [
      "dictionary",
      "read",
      "edit",
      "delete",
      "review",
      "publish",
      "sell",
      "finance",
      "supply",
      "users",
      "audit",
      "export",
    ],
    REVIEWER: ["read", "edit", "delete", "review", "publish", "sell"],
    OPERATOR: ["read", "edit", "delete", "publish", "sell"],
    FINANCE: ["read", "finance", "supply", "sell", "audit", "export"],
    VIEWER: ["read"],
  };
  return !!me && grants[me.role]?.includes(action);
}
export function esc(s: unknown) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export const code = (n: number) => `TM${String(n).padStart(6, "0")}`;
export function money(n: number | null | undefined, c = "CNY") {
  return n == null
    ? "待补"
    : `${c} ${(n / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const when = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";
export function cents(s: FormDataEntryValue | null) {
  if (s === null || String(s).trim() === "") return null;
  const value = String(s).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("金额须非负，最多2位小数");
  const [a, b = ""] = value.split("."),
    n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 2000000000)
    throw new Error("金额超出允许范围");
  return n;
}
export const dateFuture = (days = 7) =>
  new Date(
    Date.now() + days * 86400000 - new Date().getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
export function iso(s: FormDataEntryValue | null) {
  const v = new Date(String(s));
  if (!Number.isFinite(v.getTime())) throw new Error("日期不正确");
  return v.toISOString();
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, error = false) {
  const el = document.querySelector<HTMLElement>("#toast")!;
  el.textContent = text;
  el.className = error ? "visible error" : "visible";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 4500);
}
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key: string = crypto.randomUUID(),
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["X-CSRF-Token"] = csrf;
    headers["Idempotency-Key"] = key;
  }
  const data =
    body instanceof FormData
      ? body
      : body === undefined
        ? undefined
        : JSON.stringify(body);
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const r = await fetch("/api" + path, {
    method,
    headers,
    body: data,
    credentials: "same-origin",
    signal: AbortSignal.timeout(45000),
  }).catch(() => {
    throw new ApiError(
      "网络中断，提交结果可能未确认。请保留当前内容重试。",
      "NETWORK_UNCERTAIN",
      0,
    );
  });
  const json = await r.json().catch(() => {
    throw new ApiError(
      "响应未完整收到，请核对结果后使用原请求重试。",
      "RESPONSE_UNCERTAIN",
      0,
    );
  });
  if (!r.ok) {
    if (r.status === 401 && path !== "/auth/login") {
      me = null;
      // Keep the current form and unsaved fields visible for same-account reauthentication.
    }
    throw new ApiError(
      json.error?.message || json.message || `请求失败 ${r.status}`,
      json.error?.code || "HTTP_ERROR",
      r.status,
      json.error?.requestId,
    );
  }
  return json as T;
}
export function button(
  label: string,
  fn: () => void | Promise<void>,
  kind = "",
) {
  const id = crypto.randomUUID();
  actions.set(id, fn);
  return `<button type="button" class="btn ${kind}" data-action="${id}">${esc(label)}</button>`;
}
export function badge(value: string) {
  return `<span class="badge ${/SOLD|FAILED|QUARANTINED|PENDING_REVIEW/.test(value) ? "warn" : /AVAILABLE|SATISFIED|SYSTEM_LIVE/.test(value) ? "good" : ""}">${esc(value)}</span>`;
}
export function field(
  name: string,
  label: string,
  value: unknown = "",
  type = "text",
  required = false,
  extra = "",
) {
  const labelId = "field-label-" + crypto.randomUUID();
  return `<label class="field"><span><span id="${labelId}">${esc(label)}</span>${required ? '<i aria-hidden="true" class="required-mark"> *</i>' : ""}</span><input aria-label="${esc(label)}" aria-labelledby="${labelId}" name="${esc(name)}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${extra} ${type === "password" ? 'autocomplete="new-password"' : ""}></label>`;
}
export function area(
  name: string,
  label: string,
  value: unknown = "",
  rows = 4,
) {
  const labelId = "area-label-" + crypto.randomUUID();
  return `<label class="field full"><span id="${labelId}">${esc(label)}</span><textarea aria-labelledby="${labelId}" name="${esc(name)}" rows="${rows}">${esc(value)}</textarea></label>`;
}
export function select(
  name: string,
  label: string,
  choices: Record<string, string>,
  value = "",
) {
  const labelId = "select-label-" + crypto.randomUUID();
  return `<label class="field"><span id="${labelId}">${esc(label)}</span><select name="${esc(name)}" aria-labelledby="${labelId}">${Object.entries(
    choices,
  )
    .map(
      ([v, l]) =>
        `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`,
    )
    .join("")}</select></label>`;
}
export const check = (name: string, label: string, on = false) =>
  `<label class="check full"><input type="checkbox" name="${esc(name)}" ${on ? "checked" : ""}><span>${esc(label)}</span></label>`;
export const currencies = {
  CNY: "人民币 CNY",
  USD: "美元 USD",
  EUR: "欧元 EUR",
  HKD: "港币 HKD",
  GBP: "英镑 GBP",
  SGD: "新币 SGD",
};
export const text = (d: FormData, k: string) => String(d.get(k) || "");
export const itemLink = (id: string, title: string) =>
  `<a class="itemlink" href="#/items/${esc(id)}">${esc(title)}</a>`;
export function form(
  title: string,
  html: string,
  save: (d: FormData, key: string) => Promise<unknown>,
  label = "保存",
  after?: () => Promise<void>,
) {
  const scope = newDialogScope();
  let key = crypto.randomUUID(),
    dirty = false,
    busy = false,
    lastBody = "",
    uncertain = false;
  dialog.innerHTML = `<form><header><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="close" aria-label="关闭">×</button></header><div class="form-grid">${html}</div><div class="form-feedback"><p class="form-error" role="alert" tabindex="-1"></p><button type="button" class="btn reauthenticate" hidden>重新登录并保留输入</button></div><footer><button type="button" class="btn close">取消</button><button class="btn primary" type="submit">${esc(label)}</button></footer></form>`;
  const el = dialog.querySelector("form")!,
    err = el.querySelector<HTMLElement>(".form-error")!;
  const loginButton = el.querySelector<HTMLButtonElement>(".reauthenticate")!;
  bindFormValidation(el, err, scope.signal);
  el.addEventListener(
    "input",
    () => {
      dirty = true;
    },
    { signal: scope.signal },
  );
  el.addEventListener(
    "change",
    () => {
      dirty = true;
    },
    { signal: scope.signal },
  );
  const mayClose = () =>
    !busy &&
    (!(dirty || uncertain) ||
      window.confirm(
        uncertain
          ? "上次提交的结果尚未确认。关闭不会撤销服务器操作，确认关闭？"
          : "还有未保存的修改，确定放弃吗？",
      ));
  dialog.oncancel = (e) => {
    if (!mayClose()) e.preventDefault();
  };
  el.querySelectorAll(".close").forEach((b) =>
    b.addEventListener(
      "click",
      () => {
        if (mayClose()) dialog.close();
      },
      { signal: scope.signal },
    ),
  );
  loginButton.addEventListener(
    "click",
    async () => {
      try {
        await reauthenticate();
        err.textContent = "登录已恢复，内容已保留。请再次提交。";
        loginButton.hidden = true;
      } catch (e) {
        err.textContent = (e as Error).message;
      }
    },
    { signal: scope.signal },
  );
  window.addEventListener(
    "beforeunload",
    (e) => {
      if (dialog.open && (dirty || busy || uncertain)) {
        e.preventDefault();
        e.returnValue = "";
      }
    },
    { signal: scope.signal },
  );
  el.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      if (busy || scope.signal.aborted) return;
      const data = new FormData(el); // Disabled controls are excluded, so capture before locking.
      const btn = el.querySelector<HTMLButtonElement>("button[type=submit]")!;
      const unlock = lockControls(el);
      busy = true;
      btn.textContent = "正在提交…";
      err.textContent = "";
      loginButton.hidden = true;
      let result: unknown;
      try {
        const signature = JSON.stringify(
          [...data.entries()].map(([k, v]) => [
            k,
            v instanceof File ? [v.name, v.size, v.lastModified] : v,
          ]),
        );
        if (lastBody && lastBody !== signature) {
          if (uncertain)
            throw new Error(
              "上次提交结果待确认。请保留原提交内容重试，或先核对记录，避免重复操作。",
            );
          key = crypto.randomUUID();
        }
        lastBody = signature;
        result = await save(data, key);
        dirty = false;
        uncertain = false;
      } catch (error) {
        if (error instanceof ApiError)
          uncertain = uncertain || error.status === 0 || error.status >= 500;
        if (!scope.signal.aborted) {
          err.textContent = (error as Error).message;
          loginButton.hidden = !(
            error instanceof ApiError &&
            (error.status === 401 ||
              error.code === "ACCOUNT_REVOKED" ||
              error.code === "CSRF_INVALID")
          );
          err.focus({ preventScroll: true });
          err.scrollIntoView({ block: "nearest" });
        }
        return;
      } finally {
        busy = false;
        unlock();
        btn.textContent = label;
      }
      if (scope.signal.aborted) return; // An error handler may have replaced the dialog with a conflict resolver.
      const continuation =
        typeof result === "object" && result !== null && "nextStep" in result;
      if (
        typeof result === "object" &&
        result !== null &&
        "conflict" in result &&
        (result as Obj).conflict
      )
        toast("已保护库存并保留冲突记录，请管理员核对", true);
      else if (!continuation) toast("已保存");
      dialog.close();
      if (continuation) return; // Do not wipe the action handlers of the next step by refreshing its parent.
      try {
        if (after) await after();
        else await refresh();
      } catch {
        toast(
          "提交已成功，但页面刷新失败。请重新读取页面，不要重复新建。",
          true,
        );
      }
    },
    { signal: scope.signal },
  );
  if (!dialog.open) dialog.showModal();
}
export function viewDialog(title: string, html: string) {
  newDialogScope();
  dialog.oncancel = null;
  dialog.innerHTML = `<header><h2 id="dialog-title">${esc(title)}</h2><button class="btn close" type="button">关闭</button></header><div class="dialog-content">${html}</div>`;
  dialog
    .querySelector(".close")!
    .addEventListener("click", () => dialog.close());
  if (!dialog.open) dialog.showModal();
}
export const empty = (message = "暂无记录") =>
  `<div class="empty"><span>◇</span><p>${esc(message)}</p></div>`;
export const note = (s: string) => `<p class="note">${esc(s)}</p>`;
export function table(heads: string[], rows: string[][]) {
  return rows.length
    ? `<div class="table-wrap"><table class="record-table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : empty();
}
export function section(title: string, body: string, controls = "") {
  return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2><div class="button-row">${controls}</div></div>${body}</section>`;
}
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadPack(id: string) {
  const r = await fetch(`/api/packages/${id}/download`);
  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.error?.message || e.message || "资料包不可用");
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `商品资料包-${id.slice(0, 8)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function observed(id: string) {
  form(
    "回填渠道下架记录",
    note(
      "请先实际完成下架，再记录你观察到的结果。系统保留人工来源，不声称平台自动确认。",
    ) + area("note", "实际操作、核对方式与结果", "", 3),
    (d, k) =>
      request(
        `/listings/${id}/observe`,
        "POST",
        { state: "OFFLINE", note: text(d, "note") },
        k,
      ),
    "记录回执",
  );
}
document.addEventListener("click", async (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>(
    "[data-action]",
  );
  if (!button) return;
  const action = actions.get(button.dataset.action!);
  if (!action) return;
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    button.disabled = false;
  }
});

export function uploadWithProgress<T>(
  path: string,
  data: FormData,
  key: string,
  progress: (value: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api" + path);
    xhr.timeout = 90000;
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.setRequestHeader("Idempotency-Key", key);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = xhr.ontimeout = () =>
      reject(
        new ApiError(
          "连接中断，结果待确认；重试会使用原请求号。",
          "NETWORK_UNCERTAIN",
          0,
        ),
      );
    xhr.onload = () => {
      let result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new ApiError(
            "未取得有效上传回执，请保留此窗口重试。",
            "INVALID_RECEIPT",
            0,
          ),
        );
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result as T);
      else
        reject(
          new ApiError(
            result.error?.message || "上传失败",
            result.error?.code || "UPLOAD_FAILED",
            xhr.status,
          ),
        );
    };
    xhr.send(data);
  });
}

export async function copyText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    viewDialog(
      "复制内容",
      `<p>浏览器未允许自动复制。下面已选中内容，可按 ⌘C / Ctrl+C；手机可长按复制。</p><textarea id="manual-copy" class="copy-fallback" readonly rows="12" aria-label="待复制内容"></textarea>`,
    );
    const field = dialog.querySelector<HTMLTextAreaElement>("#manual-copy")!;
    field.value = value;
    field.focus();
    field.select();
    return false;
  }
}

// Reauthentication uses a separate dialog; the original form is never destroyed.
export function reauthenticate(): Promise<void> {
  const expected = lastUser;
  if (!expected) return Promise.reject(new Error("请先登录工作台"));
  const modal = document.createElement("dialog");
  modal.className = "reauth-dialog";
  modal.setAttribute("aria-label", "恢复登录");
  modal.innerHTML = `<form><h2>恢复登录</h2><p>当前未保存内容会保留，请使用原账号验证。</p>${field("email", "登录邮箱", expected.email, "email", true, "readonly")}${field("password", "密码", "", "password", true)}<p class="form-error" role="alert"></p><div class="button-row"><button type="button" class="btn close">返回编辑</button><button type="submit" class="btn primary">恢复登录</button></div></form>`;
  document.body.append(modal);
  modal.showModal();
  return new Promise((resolve, reject) => {
    let complete = false,
      busy = false;
    const close = () => {
      if (!busy) modal.close();
    };
    modal.querySelector(".close")!.addEventListener("click", close);
    modal.addEventListener("cancel", (event) => {
      if (busy) event.preventDefault();
    });
    modal.addEventListener(
      "close",
      () => {
        modal.remove();
        if (!complete) reject(new Error("尚未恢复登录，输入内容仍然保留"));
      },
      { once: true },
    );
    modal.querySelector("form")!.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const data = new FormData(event.currentTarget as HTMLFormElement),
        unlock = lockControls(modal);
      try {
        const result = await request<{ user: User; csrf: string }>(
          "/auth/login",
          "POST",
          {
            email: expected.email,
            password: String(data.get("password") || ""),
          },
        );
        if (result.user.id !== expected.id)
          throw new Error("账号不一致，未提交编辑内容");
        setSession(result.user, result.csrf);
        complete = true;
        resolve();
        modal.close();
      } catch (error) {
        modal.querySelector(".form-error")!.textContent = (
          error as Error
        ).message;
      } finally {
        busy = false;
        unlock();
      }
    });
  });
}
