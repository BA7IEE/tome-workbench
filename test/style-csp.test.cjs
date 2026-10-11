const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const vm = require("node:vm");
const helmet = require("helmet");
const {
  contentSecurityPolicy,
  createStyleNonce,
  renderStyleNonce,
  styleNonceForResponse,
} = require("../dist/common/style-csp");
const template = readFileSync("web/index.html", "utf8");

test("pinned Pro token registration forwards scoped nonce and fails closed on upstream changes", async () => {
  const { patchProTokenNonce } = await import("../scripts/pro-csp-compat.mjs");
  const source = `useCacheToken(theme, tokens, {
        override: finalToken,
        cssVar: { key: 'pro' }
  });`;
  for (const csp of [{ nonce: createStyleNonce() }, undefined]) {
    let registered;
    vm.runInNewContext(patchProTokenNonce(source, "3.1.15-5"), {
      theme: {},
      tokens: [],
      finalToken: {},
      restConfig: { csp },
      useCacheToken: (_theme, _tokens, options) => {
        registered = options;
      },
    });
    assert.equal(registered.nonce, csp?.nonce);
    assert.equal(registered.cssVar.key, "pro");
  }
  assert.throws(() => patchProTokenNonce(source, "future-version"));
  assert.throws(() =>
    patchProTokenNonce("changed upstream source", "3.1.15-5"),
  );
  assert.throws(() => patchProTokenNonce(source + source, "3.1.15-5"));
});

test("style nonce is random per response, shared with its header, and template fails closed", () => {
  const first = {},
    second = {};
  assert.equal(styleNonceForResponse(first), styleNonceForResponse(first));
  assert.notEqual(styleNonceForResponse(first), styleNonceForResponse(second));
  assert.match(createStyleNonce(), /^[A-Za-z0-9_-]{32}$/);
  assert.throws(() => renderStyleNonce(template, 'bad"nonce'));
  assert.throws(() => renderStyleNonce("<head></head>", createStyleNonce()));
  assert.throws(() =>
    renderStyleNonce(template + template, createStyleNonce()),
  );
});

test("real Helmet HTML response uses a fresh matching nonce and unchanged script protection", async () => {
  const protection = helmet({
    contentSecurityPolicy: contentSecurityPolicy(false),
  });
  const server = createServer((request, response) =>
    protection(request, response, () => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(renderStyleNonce(template, styleNonceForResponse(response)));
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const nonces = [];
    for (const path of ["/", "/", "/showroom"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200);
      const policy = response.headers.get("content-security-policy");
      const html = await response.text();
      const nonce = html.match(
        /name="tome-style-nonce" content="([A-Za-z0-9_-]{32})"/,
      )[1];
      assert.ok(policy.includes(`style-src 'self' 'nonce-${nonce}'`));
      assert.ok(policy.includes("script-src 'self';"));
      assert.ok(policy.includes("script-src-attr 'none'"));
      assert.ok(!policy.includes("unsafe-inline"));
      assert.equal(response.headers.get("cache-control"), "no-store");
      nonces.push(nonce);
    }
    assert.equal(new Set(nonces).size, nonces.length);
    assert.deepEqual(
      contentSecurityPolicy(true).directives.upgradeInsecureRequests,
      [],
    );
    assert.equal(
      contentSecurityPolicy(false).directives.upgradeInsecureRequests,
      null,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
