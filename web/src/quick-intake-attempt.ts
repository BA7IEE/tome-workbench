import { WriteAttempt, type WriteSnapshot } from "./write-attempt";
import type { DictionarySelection } from "./dictionary-editor";

export type IntakeInput = {
  title: string;
  brand: string;
  dictionary: DictionarySelection;
  category: string;
  currentPrice: number | null;
  currency: string;
  ownership: "OWN";
  facts: { conditionGrade: string };
};
export type IntakeIdentity = { id: string; code: string };
type Send = ConstructorParameters<typeof WriteAttempt>[0];
const inputFields = [
  "title",
  "brand",
  "dictionary",
  "category",
  "currentPrice",
  "currency",
  "ownership",
  "facts",
];
function validInput(value: unknown): value is IntakeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as IntakeInput;
  return (
    Object.keys(input).every((key) => inputFields.includes(key)) &&
    typeof input.title === "string" &&
    input.title.length <= 300 &&
    typeof input.brand === "string" &&
    input.brand.length <= 100 &&
    ["CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"].includes(
      input.category,
    ) &&
    ["CNY", "USD", "EUR", "HKD", "GBP", "SGD"].includes(input.currency) &&
    input.ownership === "OWN" &&
    (input.currentPrice === null ||
      (Number.isSafeInteger(input.currentPrice) &&
        input.currentPrice >= 0 &&
        input.currentPrice <= 2000000000)) &&
    !!input.facts &&
    typeof input.facts.conditionGrade === "string" &&
    Object.keys(input.facts).every((key) => key === "conditionGrade") &&
    !!input.dictionary &&
    Object.entries(input.dictionary).every(
      ([key, id]) =>
        ["brand", "condition", "color", "material"].includes(key) &&
        (id === null || typeof id === "string"),
    )
  );
}
export type IntakeRecovery = {
  schema: 1;
  identity: IntakeIdentity | null;
  version: number;
  confirmed: IntakeInput | null;
  sentCreate: IntakeInput | null;
  sentUpdate: IntakeInput | null;
  createAttempt: WriteSnapshot | null;
  updateAttempt: WriteSnapshot | null;
  createUncertain: boolean;
  updateUncertain: boolean;
};

/** Creation identity survives later field/file/intent changes in this window. */
export class QuickIntakeAttempt {
  private create: WriteAttempt;
  private update: WriteAttempt;
  private confirmed: IntakeInput | null = null;
  private version = 1;
  private sentCreate: IntakeInput | null = null;
  private sentUpdate: IntakeInput | null = null;
  identity: IntakeIdentity | null = null;
  constructor(
    send: Send,
    private persist?: (record: IntakeRecovery) => Promise<void>,
    recovery?: IntakeRecovery,
  ) {
    this.create = new WriteAttempt(send, async (snapshot) => {
      await this.persist?.({
        ...this.record(),
        createAttempt: snapshot,
        createUncertain: true,
      });
    });
    this.update = new WriteAttempt(send, async (snapshot) => {
      await this.persist?.({
        ...this.record(),
        updateAttempt: snapshot,
        updateUncertain: true,
      });
    });
    if (recovery) {
      if (
        recovery.schema !== 1 ||
        !Number.isInteger(recovery.version) ||
        recovery.version < 1 ||
        (recovery.identity && !validInput(recovery.confirmed)) ||
        (recovery.createAttempt &&
          (!validInput(recovery.sentCreate) ||
            JSON.stringify(recovery.createAttempt.body) !==
              JSON.stringify(recovery.sentCreate))) ||
        (recovery.updateAttempt && !validInput(recovery.sentUpdate)) ||
        (recovery.identity && !/^[a-f0-9-]{36}$/i.test(recovery.identity.id)) ||
        (recovery.createAttempt &&
          (recovery.createAttempt.method !== "POST" ||
            recovery.createAttempt.path !== "/items")) ||
        (recovery.updateAttempt &&
          (!recovery.identity ||
            recovery.updateAttempt.method !== "PATCH" ||
            recovery.updateAttempt.path !== `/items/${recovery.identity.id}`))
      )
        throw new Error("录货恢复记录无效，请先核对商品，不要重新建档");
      this.identity = recovery.identity;
      this.version = recovery.version;
      this.confirmed = recovery.confirmed;
      this.sentCreate = recovery.sentCreate;
      this.sentUpdate = recovery.sentUpdate;
      if (recovery.createAttempt)
        this.create.restore(
          recovery.createAttempt,
          recovery.createUncertain !== false,
        );
      if (recovery.updateAttempt)
        this.update.restore(
          recovery.updateAttempt,
          recovery.updateUncertain !== false,
        );
    }
  }
  private record(): IntakeRecovery {
    return {
      schema: 1,
      identity: this.identity,
      version: this.version,
      confirmed: this.confirmed,
      sentCreate: this.sentCreate,
      sentUpdate: this.sentUpdate,
      createAttempt: this.create.snapshot,
      updateAttempt: this.update.snapshot,
      createUncertain: this.create.uncertain,
      updateUncertain: this.update.uncertain,
    };
  }
  get recoveredInput() {
    return this.sentUpdate || this.confirmed || this.sentCreate;
  }
  get uncertain() {
    return this.create.uncertain || this.update.uncertain;
  }
  async reconcile() {
    if (this.create.uncertain) {
      this.identity = await this.create.retry<IntakeIdentity>();
      this.confirmed = structuredClone(this.sentCreate!);
    } else if (this.update.uncertain) {
      const result = await this.update.retry<{ version: number }>();
      this.version = result.version;
      this.confirmed = structuredClone(this.sentUpdate!);
    }
    await this.persist?.(this.record());
    return this.identity;
  }
  async save(input: IntakeInput): Promise<IntakeIdentity> {
    if (!validInput(input))
      throw new Error("请核对录货字段、名称长度、币种与非负金额后再保存");
    if (!this.identity) {
      if (!this.create.uncertain) this.sentCreate = structuredClone(input);
      try {
        this.identity = await this.create.run<IntakeIdentity>("/items", input);
      } catch (error) {
        await this.persist?.(this.record()).catch(() => undefined);
        throw error;
      }
      this.confirmed = structuredClone(input);
      // Own quick intake has no sourceId and always creates a fresh Item at
      // version 1. Receipt replay returns that same creation identity.
      await this.persist?.(this.record());
      return this.identity;
    }
    const patch: Record<string, unknown> = { version: this.version };
    for (const field of [
      "title",
      "brand",
      "dictionary",
      "category",
      "currentPrice",
      "currency",
      "facts",
    ] as const)
      if (
        JSON.stringify(input[field]) !== JSON.stringify(this.confirmed![field])
      )
        patch[field] = input[field];
    if (Object.keys(patch).length > 1) {
      if (!this.update.uncertain) this.sentUpdate = structuredClone(input);
      let result: { version: number };
      try {
        result = await this.update.run<{ version: number }>(
          `/items/${this.identity.id}`,
          patch,
          "PATCH",
        );
      } catch (error) {
        await this.persist?.(this.record()).catch(() => undefined);
        throw error;
      }
      this.version = result.version;
      this.confirmed = structuredClone(input);
      this.sentUpdate = null;
      await this.persist?.(this.record());
    }
    return this.identity;
  }
}
