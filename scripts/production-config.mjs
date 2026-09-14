import fs from "node:fs";
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
const dir = path.resolve(arg("--dir", "data/production"));
const httpsPort = Number(arg("--https-port", test ? "45443" : "443")),
  httpPort = Number(arg("--http-port", test ? "45080" : "80"));
if (
  [httpsPort, httpPort].some(
    (p) => !Number.isInteger(p) || p < 1 || p > 65535,
  ) ||
  httpsPort === httpPort
)
  throw new Error("Invalid ports");
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
  `TOME_CONFIG_DIR=${dir}\nTOME_IMAGE_TAG=0.4.0-rc.1\nTOME_BIND=${process.argv.includes("--public") && !test ? "0.0.0.0" : "127.0.0.1"}\nTOME_HTTPS_PORT=${httpsPort}\nTOME_HTTP_PORT=${httpPort}\n`,
);
save(
  "configuration.json",
  JSON.stringify(
    {
      domain,
      origin,
      rehearsal: test,
      publicBind: !test && process.argv.includes("--public"),
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
