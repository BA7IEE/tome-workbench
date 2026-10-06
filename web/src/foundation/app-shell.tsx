import { memo, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { button, esc, toast } from "../core";
import { pageNames, primaryNavigation } from "../admin-navigation";
import type { User } from "../types";
import { Button } from "./components";
import { ToMeProvider } from "./provider";

let collapsed = false;
let shellRoot: Root | null = null;
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

function Icon({ name }: { name: string }) {
  return (
    <svg
      className="foundation-nav-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={iconPaths[name] || iconPaths.settings} />
    </svg>
  );
}
// React never reconciles the controller-owned descendants, including on collapse.
const PageContent = memo(function PageContent({ title }: { title: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    ref.current!.innerHTML =
      '<div class="loading" role="status">正在读取数据…</div>';
  }, []);
  return (
    <main
      ref={ref}
      id="content"
      className="foundation-page-container"
      tabIndex={-1}
      aria-label={title}
    />
  );
});
export interface AppShellOptions {
  page: string;
  user: User;
  version: string;
  onLogout: () => Promise<void>;
}
function AppShell({ page, user, version, onLogout }: AppShellOptions) {
  const [compact, setCompact] = useState(collapsed);
  const [loggingOut, setLoggingOut] = useState(false);
  const title = pageNames[page] || "经营工作台";
  return (
    <div className="shell foundation-shell" data-collapsed={String(compact)}>
      <a
        className="foundation-skip"
        href="#content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("content")!.focus();
        }}
      >
        跳到页面内容
      </a>
      <aside id="foundation-sidebar" className="admin-sidebar">
        <a
          href="#/dashboard"
          className="wordmark"
          aria-label="ToMeBoutique 工作台"
        >
          <b className="foundation-brand-short" aria-hidden="true">
            TM
          </b>
          <span className="foundation-brand-full">
            ToMeBoutique<small>兔泥巴 · 经营工作台</small>
          </span>
        </a>
        <nav aria-label="主导航">
          <div className="library-navigation">
            {primaryNavigation(page).map(({ path, label, active }) => (
              <a
                key={path}
                href={`#/${path}`}
                aria-label={label}
                title={label}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={path.split("?")[0]} />
                <span className="foundation-nav-label">{label}</span>
              </a>
            ))}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <strong title={user.name}>{user.name}</strong>
          <small>{roleLabels[user.role] || "内部账户"}</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="foundation-location">
            <Button
              className="foundation-collapse"
              aria-controls="foundation-sidebar"
              aria-expanded={!compact}
              aria-label={`${compact ? "展开" : "折叠"}导航`}
              onClick={() => {
                collapsed = !compact;
                setCompact(collapsed);
              }}
            >
              <Icon name="collapse" />
            </Button>
            <span>{title}</span>
          </div>
          <div className="foundation-account">
            <span className="foundation-role">
              {roleLabels[user.role] || "内部账户"}
            </span>
            <a href="/showroom" target="_blank" rel="noopener">
              查看展厅 ↗
            </a>
            <span className="environment">{version}</span>
            <Button
              className="foundation-logout"
              disabled={loggingOut}
              onClick={async () => {
                if (loggingOut) return;
                setLoggingOut(true);
                try {
                  await onLogout();
                } catch (error) {
                  toast((error as Error).message, true);
                } finally {
                  setLoggingOut(false);
                }
              }}
            >
              退出登录
            </Button>
          </div>
        </header>
        <PageContent title={title} />
        <footer className="app-footer">
          ToMeBoutique / 事实只维护一次，使用各有记录。
        </footer>
      </div>
    </div>
  );
}
export function disposeAppShell() {
  shellRoot?.unmount();
  shellRoot = null;
}
export function mountAppShell(host: HTMLElement, options: AppShellOptions) {
  disposeAppShell();
  shellRoot = createRoot(host);
  flushSync(() =>
    shellRoot!.render(
      <ToMeProvider>
        <AppShell {...options} />
      </ToMeProvider>,
    ),
  );
}
export function pageReadError(message: string, retry: () => Promise<void>) {
  return `<section class="panel foundation-page-error" role="alert"><h2>没有完成读取</h2><p class="form-error">${esc(message)}</p>${button("重新读取", retry)}</section>`;
}
