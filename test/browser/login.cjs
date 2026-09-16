const { expect, test } = require("@playwright/test");
const fs = require("node:fs");

// Login is an HTTP precondition. Keep each journey's original UI assertions,
// but run them after the real response instead of spending their 5s on the request.
async function submitLogin(page) {
  const started = Date.now();
  const record = {
    test: test.info().title,
    startedAt: new Date(started).toISOString(),
    browser: page.context().browser().browserType().name(),
    status: null,
    responseMs: null,
    passed: false,
  };
  const isLogin = (request) =>
    new URL(request.url()).pathname === "/api/auth/login" &&
    request.method() === "POST";
  Object.assign(record, {
    urlBeforeClick: new URL(page.url()).origin + new URL(page.url()).pathname,
    requestObserved: false,
    responseObserved: false,
    responseStatus: null,
    requestAt: null,
    pageErrors: 0,
  });
  const onRequest = (request) => {
    if (!isLogin(request)) return;
    record.requestObserved = true;
    record.requestAt = new Date().toISOString();
  };
  const onResponse = (response) => {
    if (!isLogin(response.request())) return;
    record.responseObserved = true;
    record.responseStatus = response.status();
  };
  const onFailed = (request) => {
    if (isLogin(request)) record.requestFailed = true;
  };
  // pageerror has no request association; count only, never copy its message.
  const onError = () => record.pageErrors++;
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  page.on("pageerror", onError);
  try {
    const button = page.getByRole("button", { name: "进入工作台" });
    record.formPresent = (await page.locator("#login-form").count()) === 1;
    record.buttonVisible = await button.isVisible();
    record.buttonEnabled = await button.isEnabled();
    await page.evaluate(() => {
      window.__loginDiagnostics = { clicks: 0, submits: 0, invalid: 0 };
      const form = document.querySelector("#login-form");
      form?.addEventListener("click", () => window.__loginDiagnostics.clicks++);
      form?.addEventListener(
        "submit",
        () => window.__loginDiagnostics.submits++,
      );
      form?.addEventListener(
        "invalid",
        () => window.__loginDiagnostics.invalid++,
        true,
      );
    });
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/auth/login") &&
          r.request().method() === "POST",
        { timeout: 30000 },
      ),
      page.getByRole("button", { name: "进入工作台" }).click(),
    ]);
    record.status = response.status();
    record.responseMs = Date.now() - started;
    expect(response.status(), "真实登录 HTTP 响应（创建会话）").toBe(201);
    const body = await response.json();
    expect(typeof body.user?.id).toBe("string");
    expect(typeof body.csrf).toBe("string");
    record.passed = true;
  } catch (error) {
    record.pageState = await page
      .evaluate(() => ({
        formPresent: !!document.querySelector("#login-form"),
        errorPresent: !!document.querySelector("#login-form .form-error")
          ?.textContent,
        events: window.__loginDiagnostics,
        emailValid: document.querySelector('[name="email"]')?.validity.valid,
        passwordValid:
          document.querySelector('[name="password"]')?.validity.valid,
      }))
      .catch(() => null);
    record.readyStatus = await fetch("http://127.0.0.1:4320/api/system/ready", {
      signal: AbortSignal.timeout(3000),
    })
      .then((r) => r.status)
      .catch(() => null);
    // ready=200 includes the application's real SELECT 1 probe.
    try {
      const { pid } = JSON.parse(
        fs.readFileSync("reports/browser-server.json", "utf8"),
      );
      process.kill(pid, 0);
      record.serverAlive = true;
    } catch {
      record.serverAlive = false;
    }
    throw error;
  } finally {
    record.pageClosed = page.isClosed();
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
    page.off("pageerror", onError);
    record.elapsedMs = Date.now() - started;
    if (!record.passed)
      console.error("LOGIN_DIAGNOSTIC " + JSON.stringify(record));
    // No input values, cookies, CSRF tokens or response bodies in diagnostics.
    fs.mkdirSync("reports", { recursive: true });
    fs.appendFileSync(
      "reports/browser-login.jsonl",
      JSON.stringify(record) + "\n",
    );
  }
}
async function fillLogin(page, email, password) {
  const emailField = page.getByLabel("登录邮箱");
  const passwordField = page.getByLabel("密码", { exact: true });
  // Native autofocus is asynchronous in WebKit. Wait for its initial focus
  // before fill() moves focus, otherwise the password can enter the email input.
  await expect(emailField).toBeFocused();
  await emailField.fill(email);
  await passwordField.fill(password);
  // Compare booleans so even assertion failures never print credentials.
  expect(
    (await emailField.inputValue()) === email,
    "邮箱输入落在正确字段",
  ).toBe(true);
  expect(
    (await passwordField.inputValue()) === password,
    "密码输入落在正确字段",
  ).toBe(true);
}
module.exports = { submitLogin, fillLogin };
