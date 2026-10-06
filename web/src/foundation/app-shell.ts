import { button, esc } from "../core";
import { pageNames, primaryNavigation } from "../admin-navigation";
import type { User } from "../types";

// Stage one DOM adapter: domain-owned content stays outside React reconciliation.
// Replace this adapter with AntD/ProLayout only after dependency/runtime gates.
let collapsed = false;
let shellScope: AbortController | null = null;
const roleLabels: Record<string, string> = {
  ADMIN: "管理员",
  REVIEWER: "复核人员",
  OPERATOR: "运营人员",
  FINANCE: "经营财务",
  VIEWER: "只读账户",
};
const iconPaths: Record<string, string> = {
  collapse: "M15 5l-7 7 7 7",
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  items: "M4 5h16v15H4z M8 5V3h8v2 M4 10h16",
  imports: "M12 3v12 m-4-4 4 4 4-4 M4 16v5h16v-5",
  distribution: "M12 4v7 M5 20v-5h14v5 M12 11v9 M8 4h8",
  sales: "M3 6h18 M5 6v15h14V6 M8 6V3h8v3 M9 11h6",
  settings: "M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4",
};
function icon(key: string) {
  return `<svg class="foundation-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${iconPaths[key] || iconPaths.settings}"/></svg>`;
}
export interface AppShellOptions {
  page: string;
  user: User;
  version: string;
  onLogout: () => Promise<void>;
}
export function mountAppShell(host: HTMLElement, options: AppShellOptions) {
  shellScope?.abort();
  shellScope = new AbortController();
  const { page, user, version, onLogout } = options;
  const title = pageNames[page] || "经营工作台";
  const nav = primaryNavigation(page)
    .map(
      ({ path, label, active }) =>
        `<a href="#/${esc(path)}" aria-label="${esc(label)}" title="${esc(label)}" class="${active ? "active" : ""}" ${active ? 'aria-current="page"' : ""}>${icon(path.split("?")[0])}<span class="foundation-nav-label">${esc(label)}</span></a>`,
    )
    .join("");
  host.innerHTML = `<div class="shell foundation-shell" data-collapsed="${collapsed}">
    <a class="foundation-skip" href="#content">跳到页面内容</a>
    <aside id="foundation-sidebar" class="admin-sidebar">
      <a href="#/dashboard" class="wordmark" aria-label="ToMeBoutique 工作台"><b class="foundation-brand-short" aria-hidden="true">TM</b><span class="foundation-brand-full">ToMeBoutique<small>兔泥巴 · 经营工作台</small></span></a>
      <nav aria-label="主导航"><div class="library-navigation">${nav}</div></nav>
      <div class="sidebar-bottom"><strong title="${esc(user.name)}">${esc(user.name)}</strong><small>${esc(roleLabels[user.role] || "内部账户")}</small></div>
    </aside>
    <div class="workspace"><header class="topbar">
      <div class="foundation-location"><button class="btn subtle foundation-collapse" type="button" aria-controls="foundation-sidebar" aria-expanded="${!collapsed}" aria-label="${collapsed ? "展开" : "折叠"}导航">${icon("collapse")}</button><span>${esc(title)}</span></div>
      <div class="foundation-account"><span class="foundation-role">${esc(roleLabels[user.role] || "内部账户")}</span><a href="/showroom" target="_blank" rel="noopener">查看展厅 ↗</a><span class="environment">${esc(version)}</span>${button("退出登录", onLogout, "subtle foundation-logout")}</div>
    </header><main id="content" class="foundation-page-container" tabindex="-1" aria-label="${esc(title)}"><div class="loading" role="status">正在读取数据…</div></main>
    <footer class="app-footer">ToMeBoutique / 事实只维护一次，使用各有记录。</footer></div></div>`;
  const shell = host.querySelector<HTMLElement>(".foundation-shell")!;
  const toggle = host.querySelector<HTMLButtonElement>(".foundation-collapse")!;
  toggle.addEventListener(
    "click",
    () => {
      collapsed = !collapsed;
      shell.dataset.collapsed = String(collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"}导航`);
    },
    { signal: shellScope.signal },
  );
  // A hash anchor would trigger the business router; focus content explicitly.
  host.querySelector(".foundation-skip")!.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      host.querySelector<HTMLElement>("#content")!.focus();
    },
    { signal: shellScope.signal },
  );
}

export function pageReadError(message: string, retry: () => Promise<void>) {
  return `<section class="panel foundation-page-error" role="alert"><h2>没有完成读取</h2><p class="form-error">${esc(message)}</p>${button("重新读取", retry)}</section>`;
}
