import fs from "node:fs";
import { releaseVersion } from "./release-version.mjs";
const version = releaseVersion();
import path from "node:path";
import { randomBytes } from "node:crypto";
const arg = (name, fallback) =>
  process.argv.find((x) => x.startsWith(name + "="))?.slice(name.length + 1) ||
  fallback;
const test = process.argv.includes("--rehearsal");
const domain = arg("--domain", test ? "localhost" : "");
if (!/^[a-zA-Z0-9.-]+$/.test(domain) || (!test && !domain.includes(".")))
  throw new Error(
    "Supply --domain=your-domain.example; use --rehearsal only for localhost",
  );
if (!test && /localhost|example\.(com|org)|\.invalid$/.test(domain))
  throw new Error("Use an actual production domain");

const deploymentMode = arg(
  "--deployment-mode",
  "INTERNAL_CADDY",
).toUpperCase();
if (!["INTERNAL_CADDY", "EXTERNAL_REVERSE_PROXY"].includes(deploymentMode))
  throw new Error(
    "deployment mode must be INTERNAL_CADDY or EXTERNAL_REVERSE_PROXY",
  );
if (test && deploymentMode !== "INTERNAL_CADDY")
  throw new Error("Synthetic rehearsal only supports INTERNAL_CADDY");
if (
  deploymentMode === "EXTERNAL_REVERSE_PROXY" &&
  process.argv.includes("--public")
)
  throw new Error(
    "--public is only valid for INTERNAL_CADDY; external proxy APIs stay loopback-only",
  );

const providerArg = arg(
  "--reverse-proxy-provider",
  deploymentMode === "EXTERNAL_REVERSE_PROXY" ? "GENERIC" : "",
);
const reverseProxyProvider = providerArg.toUpperCase();
if (
  deploymentMode === "EXTERNAL_REVERSE_PROXY" &&
  !/^[A-Z0-9_-]{2,32}$/.test(reverseProxyProvider)
)
  throw new Error("Invalid reverse proxy provider");
if (deploymentMode === "INTERNAL_CADDY" && providerArg)
  throw new Error(
    "--reverse-proxy-provider is only valid for EXTERNAL_REVERSE_PROXY",
  );

const dir = path.resolve(arg("--dir", "data/production"));
const httpsPort = Number(arg("--https-port", test ? "45443" : "443")),
  httpPort = Number(arg("--http-port", test ? "45080" : "80")),
  apiAPort = Number(arg("--api-a-port", "14318")),
  apiBPort = Number(arg("--api-b-port", "14319"));
if (
  [httpsPort, httpPort].some(
    (p) => !Number.isInteger(p) || p < 1 || p > 65535,
  ) ||
  httpsPort === httpPort
)
  throw new Error("Invalid proxy ports");
if (
  [apiAPort, apiBPort].some(
    (p) => !Number.isInteger(p) || p < 1024 || p > 65535,
  ) ||
  apiAPort === apiBPort
)
  throw new Error("Invalid API loopback ports");
if (fs.existsSync(dir))
  throw new Error(
    "Configuration already exists; passwords are never overwritten",
  );
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(dir, "backups"), { mode: 0o700 });
const owner = randomBytes(32).toString("hex"),
  app = randomBytes(32).toString("hex");
const save = (name, text) =>
  fs.writeFileSync(path.join(dir, name), text, { mode: 0o600, flag: "wx" });
const origin = `https://${domain}${httpsPort === 443 ? "" : ":" + httpsPort}`;
const common = `APP_ENV=production\nHOST=0.0.0.0\nPORT=4318\nAPP_ORIGIN=${origin}\nCOOKIE_SECURE=true\nMEDIA_DIR=/app/data/media\nEXTERNAL_EFFECTS_ENABLED=false\nAI_ENABLED=false\n`;
const runtimeURL = `postgresql://tome_app:${app}@postgres:5432/tome_production?schema=public&connection_limit=5&pool_timeout=5`;
const ownerURL = `postgresql://tome_owner:${owner}@postgres:5432/tome_production?schema=public`;
const publicBind =
  deploymentMode === "INTERNAL_CADDY" &&
  process.argv.includes("--public") &&
  !test;
save("owner-password.txt", owner);
save("app-password.txt", app);
save("api.env", common + `DATABASE_URL=${runtimeURL}\n`);
save(
  "migration.env",
  common + `DATABASE_URL=${runtimeURL}\nMIGRATION_DATABASE_URL=${ownerURL}\n`,
);
save(
  "proxy.env",
  `APP_DOMAIN=${domain}\nCADDY_TLS_DIRECTIVE=${test ? "tls internal" : ""}\n`,
);
save(
  "compose.env",
  `TOME_CONFIG_DIR=${dir}\nTOME_IMAGE_TAG=${version}\nTOME_DEPLOYMENT_MODE=${deploymentMode}\nTOME_API_BIND=127.0.0.1\nTOME_API_A_PORT=${apiAPort}\nTOME_API_B_PORT=${apiBPort}\nTOME_BIND=${publicBind ? "0.0.0.0" : "127.0.0.1"}\nTOME_HTTPS_PORT=${httpsPort}\nTOME_HTTP_PORT=${httpPort}\n`,
);
save(
  "configuration.json",
  JSON.stringify(
    {
      appVersion: version,
      domain,
      origin,
      rehearsal: test,
      deploymentMode,
      reverseProxyProvider:
        deploymentMode === "EXTERNAL_REVERSE_PROXY"
          ? reverseProxyProvider
          : null,
      publicBind,
      apiLoopback: {
        bind: "127.0.0.1",
        apiAPort,
        apiBPort,
      },
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  "Created isolated deployment configuration. Secrets were not printed. Path: " +
    dir,
);
