import { saveRoutePosition, restoreRoutePosition } from "./route-context";
import { importsPage } from "./imports-page";
import { candidatesPage } from "./candidates-page";
import { procurementPage } from "./procurement-page";
import { dictionariesPage } from "./dictionaries-page";
import { recycleBinPage } from "./recycle-bin";
declare const __APP_VERSION__: string;
import { navigation, pageNames, extraNavigation } from "./admin-navigation";
import { productEntry } from "./product-entry";
import { catalogScreen } from "./catalog-screen";
import { distributionCenter } from "./distribution-center";
import { sourcesScreen } from "./sources-screen";
import { dailyWork } from "./daily-work";
import { salesFactsPage } from "./sales-facts-page";
import { runPageHooks, canLeavePage, disposePage } from "./page-lifecycle";
import {
  app,
  actions,
  me,
  setSession,
  setRefresh,
  request,
  can,
  esc,
  toast,
  button,
} from "./core";
import type { SessionResponse } from "./types";
import { detailPage } from "./items";
import {
  tasksPage,
  listingsPage,
  salesPage,
  inquiriesPage,
  settingsPage,
  jobsPage,
  auditPage,
  showroomPage,
} from "./pages";
import { intakePage } from "./intake-page";
import { collectionsPage } from "./collections-page";
import { settlementsPage } from "./settlements-page";
import { operationsPage } from "./operations-page";
let generation = 0;
let renderedHash = "";
async function login() {
  app.innerHTML = `<div class="login-page"><div class="login-brand"><div class="wordmark">ToMeBoutique<span>兔泥巴</span></div><div><div class="eyebrow">PRODUCT & OPERATIONS</div><h1>一件商品，<br>一份清晰的档案。</h1><p>让事实、素材与每一次使用，都留在同一个地方。</p></div><small>内部经营工作台 / ${__APP_VERSION__}</small></div><main class="login-card"><h2>登录工作台</h2><p>使用管理员为你开通的内部账户。</p><form id="login-form"><label class="field"><span>登录邮箱</span><input type="email" name="email" autocomplete="username" required></label><label class="field"><span>密码</span><input type="password" name="password" autocomplete="current-password" required></label><p class="form-error" role="alert"></p><button type="submit" class="btn primary">进入工作台 →</button></form><small>如需开通账户或重置密码，请联系管理员。</small></main></div>`;
  app.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement,
      b = form.querySelector<HTMLButtonElement>("button")!;
    b.disabled = true;
    try {
      const d = new FormData(form),
        s = await request<SessionResponse>("/auth/login", "POST", {
          email: String(d.get("email")),
          password: String(d.get("password")),
        });
      setSession(s.user, s.csrf, s.capabilities);
      await render();
    } catch (error) {
      form.querySelector(".form-error")!.textContent = (error as Error).message;
    } finally {
      b.disabled = false;
    }
  });
  // Focus during mounting; native asynchronous autofocus can steal focus
  // from the password field after the operator has started typing (WebKit).
  app.querySelector<HTMLInputElement>('[name="email"]')!.focus();
}
async function render() {
  const g = ++generation;
  disposePage();
  actions.clear();
  if (location.pathname === "/showroom") {
    app.innerHTML = await showroomPage();
    return;
  }
  if (!me) {
    try {
      const s = await request<SessionResponse>("/auth/me");
      setSession(s.user, s.csrf, s.capabilities);
    } catch {
      await login();
      return;
    }
  }
  if (!location.hash || location.hash === "#/") {
    history.replaceState(null, "", "#/dashboard");
  }
  const path = location.hash.replace(/^#\/?/, "").split("?")[0],
    parts = path.split("/"),
    page = parts[0] || "dashboard";
  app.innerHTML = `<div class="shell"><aside class="admin-sidebar"><a href="#/dashboard" class="wordmark">ToMeBoutique<span>兔泥巴 · 经营工作台</span></a><nav aria-label="主导航">${navigation(page)}</nav><div class="sidebar-bottom"><strong>${esc(me?.name)}</strong><small>${esc(({ ADMIN: "管理员", REVIEWER: "复核人员", OPERATOR: "运营人员", FINANCE: "经营财务", VIEWER: "只读账户" } as Record<string, string>)[me?.role || ""] || "内部账户")}</small>${button(
    "退出登录",
    async () => {
      await request("/auth/logout", "POST", {});
      location.reload();
    },
    "subtle",
  )}</div></aside><div class="workspace"><header class="topbar"><span>经营工作台</span><div>${button(
    "退出登录",
    async () => {
      await request("/auth/logout", "POST", {});
      location.reload();
    },
    "subtle mobile-logout",
  )}<a href="/showroom" target="_blank" rel="noopener">查看展厅 ↗</a><span class="environment">${__APP_VERSION__}</span></div></header><main id="content"><div class="loading">正在读取数据…</div></main><footer class="app-footer">ToMeBoutique / 事实只维护一次，使用各有记录。</footer></div></div>`;
  let html = "";
  try {
    if (page === "trash") html = await recycleBinPage();
    else if (page === "items")
      html =
        parts[1] === "new"
          ? await productEntry()
          : parts[2] === "edit"
            ? await productEntry(parts[1])
            : parts[1]
              ? await detailPage(parts[1])
              : await catalogScreen();
    else if (page === "imports") html = await importsPage();
    else if (page === "candidates") html = await candidatesPage();
    else if (page === "dictionaries") html = await dictionariesPage();
    else if (page === "procurement" && can("supply"))
      html = await procurementPage(parts[1]);
    else if (page === "sources" && can("supply")) html = await sourcesScreen();
    else if (page === "intake" && can("edit"))
      html = await intakePage(parts[1]);
    else if (page === "collections" && can("read"))
      html = await collectionsPage(parts[1]);
    else if (page === "settlements" && can("finance"))
      html = await settlementsPage(parts[1]);
    else if (page === "operations" && can("users"))
      html = await operationsPage();
    else if (page === "tasks") html = await tasksPage();
    else if (page === "distribution" && can("publish"))
      html = await distributionCenter();
    else if (page === "listings") html = await listingsPage();
    else if (page === "sales" && can("sell"))
      html = can("finance") ? await salesPage() : await salesFactsPage();
    else if (page === "inquiries" && can("sell")) html = await inquiriesPage();
    else if (page === "settings")
      html =
        `<div class="page-title"><div><h1>设置</h1><p>账户与常用配置；其他业务记录可在下方查看。</p></div></div><details class="panel library-tools"><summary>其他业务记录与维护工具</summary>${extraNavigation(page)}</details>` +
        (await settingsPage());
    else if (page === "jobs" && can("users")) html = await jobsPage();
    else if (page === "audit" && can("audit")) html = await auditPage();
    else html = await dailyWork();
  } catch (error) {
    html = `<section class="panel"><h2>没有完成读取</h2><p class="form-error">${esc((error as Error).message)}</p>${button("重新读取", () => render())}</section>`;
  }
  if (g === generation) {
    document.querySelector("#content")!.innerHTML = html;
    if (renderedHash !== location.hash) window.scrollTo(0, 0);
    renderedHash = location.hash;
    runPageHooks();
    restoreRoutePosition(location.hash);
    document.title = `${pageNames[page] || "兔泥巴"} · ToMeBoutique`;
  }
}
setRefresh(render);
let previousHash = location.hash,
  reverting = false;
window.addEventListener("route-replaced", () => {
  previousHash = location.hash;
});
window.addEventListener("hashchange", () => {
  if (reverting) {
    reverting = false;
    return;
  }
  if (!canLeavePage()) {
    reverting = true;
    location.hash = previousHash;
    window.dispatchEvent(new Event("navigation-cancelled"));
    return;
  }
  saveRoutePosition(previousHash);
  previousHash = location.hash;
  render().catch((e) => toast(e.message, true));
});
render().catch((e) => {
  app.textContent = "启动失败：" + e.message;
});

import "./ui08.css";
