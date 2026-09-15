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
  try {
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
        visibleError:
          document
            .querySelector("#login-form .form-error")
            ?.textContent?.slice(0, 200) || "",
      }))
      .catch(() => null);
    throw error;
  } finally {
    record.elapsedMs = Date.now() - started;
    // No input values, cookies, CSRF tokens or response bodies in diagnostics.
    fs.mkdirSync("reports", { recursive: true });
    fs.appendFileSync(
      "reports/browser-login.jsonl",
      JSON.stringify(record) + "\n",
    );
  }
}
module.exports = { submitLogin };
