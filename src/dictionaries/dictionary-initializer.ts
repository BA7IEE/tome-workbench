import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { lock } from "../common/transaction";
import { initialDictionaryValues } from "./initial-values";
import { termsOf } from "./dictionary-rules";
// Initializes missing built-in choices once. Never resets or rewrites administrator changes or item data.
@Injectable()
export class DictionaryInitializer implements OnModuleInit {
  constructor(private db: PrismaService) {}
  async onModuleInit() {
    await this.db.$transaction(
      async (tx) => {
        await lock(tx, "dictionary:catalog");
        for (const input of initialDictionaryValues) {
          const existing = await tx.dictionaryEntry.findUnique({
            where: { kind_code: { kind: input.kind, code: input.code } },
          });
          if (existing) continue;
          const terms = termsOf(input);
          const conflict = await tx.dictionaryTerm.findFirst({
            where: { kind: input.kind, normalized: { in: terms } },
          });
          if (conflict)
            throw new Error(
              "内置字典与已有名称冲突，需要管理员核对：" + input.label,
            );
          const entry = await tx.dictionaryEntry.create({ data: input });
          await tx.dictionaryTerm.createMany({
            data: terms.map((normalized) => ({
              kind: input.kind,
              normalized,
              entryId: entry.id,
            })),
          });
        }
      },
      { maxWait: 15000, timeout: 20000 },
    );
  }
}
