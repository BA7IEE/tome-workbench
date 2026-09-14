import { createRequire } from "node:module";
const runtime = (
  createRequire(__filename)("../scripts/runtime-lock.cjs") as {
    runtime: (kind: string) => Promise<() => Promise<void>>;
  }
).runtime;
import "reflect-metadata";
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { passwordHash } from "./auth/auth";
import { config } from "./common/config";
import { factsSchema } from "./common/domain";
import { json } from "./common/transaction";
async function main() {
  config();
  const db = new PrismaClient();
  await db.$connect();
  const release = await runtime("cli");
  const mode = process.argv[2];
  try {
    if (mode === "admin") {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const email = (await rl.question("管理员登录邮箱："))
        .trim()
        .toLowerCase();
      const name = (await rl.question("显示姓名：")).trim();
      rl.close();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name)
        throw new Error("邮箱或姓名无效");
      if (await db.user.findUnique({ where: { email } }))
        throw new Error("该账户已存在；初始化不会覆盖密码");
      const password = randomBytes(18).toString("base64url");
      const credentials = resolve("data/first-admin.txt");
      if (existsSync(credentials))
        throw new Error(
          "data/first-admin.txt已存在，请先妥善保管并移走旧凭据文件再初始化",
        );
      const user = await db.user.create({
        data: {
          email,
          name,
          passwordHash: passwordHash(password),
          role: "ADMIN",
        },
      });
      mkdirSync("data", { recursive: true });
      writeFileSync(
        credentials,
        `ToMeBoutique 初始管理员\n登录：${email}\n初始密码：${password}\n地址：${config().origin}\n登录后立即在设置中修改密码，并删除此文件。\n`,
        { mode: 0o600, flag: "wx" },
      );
      chmodSync(credentials, 0o600);
      console.log(
        `已创建管理员 ${user.name}。凭据保存在 data/first-admin.txt（权限600），未输出到日志。`,
      );
    } else if (mode === "demo") {
      if (
        process.env.APP_ENV !== "development" ||
        process.env.TOME_ALLOW_DEMO !== "YES"
      )
        throw new Error(
          "仅development且显式设置TOME_ALLOW_DEMO=YES时允许写入合成样本",
        );
      if (await db.item.count())
        throw new Error("仅允许在没有商品的独立开发库写入样本，不覆盖现有商品");
      await db.$transaction(async (tx) => {
        for (const x of [
          {
            title: "【合成样本】资料未齐的中古外套",
            ownership: "OWN",
            category: "CLOTHING",
            location: "测试货架 A",
          },
          {
            title: "【合成样本】供应商持有的包袋",
            ownership: "SUPPLIER",
            category: "BAG",
            location: "测试供应商手中",
          },
        ]) {
          const facts = factsSchema.parse({
            descriptionZh: "仅用于验证操作流程，不是真实商品，不得对外经营。",
          });
          const i = await tx.item.create({
            data: { ...x, brand: "演示品牌", facts: json(facts) },
          });
          await tx.cycle.create({ data: { itemId: i.id, number: 1 } });
          await tx.itemRevision.create({
            data: {
              itemId: i.id,
              version: 1,
              snapshot: json({
                title: i.title,
                brand: i.brand,
                category: i.category,
                facts,
              }),
            },
          });
        }
        await tx.channel.createMany({
          data: [
            {
              name: "测试闲鱼账号（规则待确认）",
              platform: "XIANYU",
              locale: "zh-CN",
              titleLimit: 60,
            },
            {
              name: "测试英文展厅",
              platform: "SHOWROOM",
              locale: "en",
              titleLimit: 100,
            },
          ],
        });
      });
      console.log(
        "已创建2件清楚标记的合成样本；未创建公开图片、交易或展厅发布。",
      );
    } else
      throw new Error(
        "使用：npm run setup:admin 或 TOME_ALLOW_DEMO=YES npm run demo:seed",
      );
  } finally {
    await db.$disconnect();
    await release();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "初始化失败");
  process.exitCode = 1;
});
