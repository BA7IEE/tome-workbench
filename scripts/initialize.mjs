import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
if (fs.existsSync(".env")) {
  console.log(".env已存在，未覆盖。");
  process.exit(0);
}
const password = randomBytes(24).toString("hex");
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync(
  ".env",
  `APP_ENV=development\nHOST=127.0.0.1\nPORT=4318\nAPP_ORIGIN=http://127.0.0.1:4318\nDATABASE_URL=postgresql://tome:${password}@127.0.0.1:55438/tome_dev?schema=public\nMEDIA_DIR=./data/media\nCOOKIE_SECURE=false\nEXTERNAL_EFFECTS_ENABLED=false\nAI_ENABLED=false\n`,
  { mode: 0o600, flag: "wx" },
);
fs.writeFileSync(
  "data/postgres.env",
  `POSTGRES_USER=tome\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=tome_dev\n`,
  { mode: 0o600, flag: "wx" },
);
console.log("已创建独立随机配置；未输出任何凭据。目录：" + resolve("."));
