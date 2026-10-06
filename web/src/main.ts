import { saveRoutePosition, restoreRoutePosition } from "./route-context";
import { importsPage } from "./imports-page";
import { candidatesPage } from "./candidates-page";
import { procurementPage } from "./procurement-page";
import { dictionariesPage } from "./dictionaries-page";
import { recycleBinPage } from "./recycle-bin";
declare const __APP_VERSION__: string;
import { pageNames, extraNavigation } from "./admin-navigation";
import {
  disposeAppShell,
  mountAppShell,
  pageReadError,
} from "./foundation/app-shell";
import { applyDesignTokens } from "./foundation/tokens";
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
  toast,
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
  disposeAppShell();
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
  mountAppShell(app, {
    page,
    user: me!,
    version: __APP_VERSION__,
    onLogout: async () => {
      await request("/auth/logout", "POST", {});
      location.reload();
    },
  });
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
        `<div class="page-title"><div><h1>更多</h1><p>账户与常用配置；采购、供应商、对账、字典、运行状态和审计都在这里。</p></div></div><details class="panel library-tools"><summary>其他业务记录与维护工具</summary>${extraNavigation(page)}</details>` +
        (await settingsPage());
    else if (page === "jobs" && can("users")) html = await jobsPage();
    else if (page === "audit" && can("audit")) html = await auditPage();
    else html = await dailyWork();
  } catch (error) {
    html = pageReadError((error as Error).message, () => render());
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
applyDesignTokens();
render().catch((e) => {
  app.textContent = "启动失败：" + e.message;
});

import "./ui08.css";
