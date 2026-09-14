import http from "node:http";
/** Local same-origin gateway. It does not turn a single host or disk into HA infrastructure. */
export async function createGateway({ port, host = "127.0.0.1", targets }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !targets.length)
    throw new Error("Invalid gateway configuration");
  const peers = targets.map((raw) => {
    const url = new URL(raw);
    if (
      url.protocol !== "http:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Backends must be explicit HTTP origins without credentials",
      );
    return { url, healthy: false, checkedAt: 0, checking: false };
  });
  let closing = false,
    next = 0;
  async function probe(p) {
    if (p.checking || closing) return;
    p.checking = true;
    try {
      const r = await fetch(new URL("/api/system/ready", p.url), {
        signal: AbortSignal.timeout(1200),
      });
      await r.arrayBuffer();
      p.healthy = r.ok;
    } catch {
      p.healthy = false;
    } finally {
      p.checkedAt = Date.now();
      p.checking = false;
    }
  }
  await Promise.all(peers.map(probe));
  const timer = setInterval(() => {
    for (const p of peers) void probe(p);
  }, 1000);
  timer.unref();
  const healthy = () =>
    peers.filter((p) => p.healthy && Date.now() - p.checkedAt < 4000);
  const server = http.createServer({ maxHeaderSize: 16384 }, (req, res) => {
    if (closing) {
      res.writeHead(503, { Connection: "close" });
      res.end("Gateway draining");
      return;
    }
    if (req.method === "GET" && req.url === "/__tome/ready") {
      const n = healthy().length;
      res.writeHead(n ? 200 : 503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          status: n ? "ready" : "unavailable",
          healthy: n,
          configured: peers.length,
          degraded: n < peers.length,
          hostRedundancy: false,
        }),
      );
      return;
    }
    const live = healthy();
    if (!live.length) {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Retry-After": "2",
      });
      res.end(
        JSON.stringify({
          error: {
            code: "NO_READY_API",
            message: "服务暂时不可用，请稍后使用同一请求重试",
          },
        }),
      );
      return;
    }
    const peer = live[next++ % live.length],
      headers = { ...req.headers, host: peer.url.host };
    for (const h of [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ])
      delete headers[h];
    const upstream = http.request(
      {
        hostname: peer.url.hostname,
        port: peer.url.port,
        method: req.method,
        path: req.url,
        headers,
        timeout: 35000,
      },
      (response) => {
        if (res.destroyed) {
          response.destroy();
          return;
        }
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
        response.on("error", () => res.destroy());
      },
    );
    // Never retry mutating requests: a lost response is not proof the write failed.
    upstream.on("timeout", () =>
      upstream.destroy(new Error("Upstream timeout")),
    );
    upstream.on("error", () => {
      peer.healthy = false;
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(503, {
          "Content-Type": "application/json",
          "Retry-After": "2",
        });
        res.end(
          JSON.stringify({
            error: {
              code: "API_TEMPORARILY_UNAVAILABLE",
              message: "响应中断；请核对结果或用原幂等键重试",
            },
          }),
        );
      } else if (!res.destroyed) res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (e) {
    closing = true;
    clearInterval(timer);
    throw e;
  }
  return {
    server,
    peers,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      await new Promise((resolve) => {
        const hard = setTimeout(() => server.closeAllConnections(), 20000);
        hard.unref();
        server.close(() => {
          clearTimeout(hard);
          resolve();
        });
        server.closeIdleConnections();
      });
    },
  };
}
