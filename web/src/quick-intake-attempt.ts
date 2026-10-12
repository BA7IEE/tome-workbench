import { WriteAttempt } from "./write-attempt";
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

/** Creation identity survives later field/file/intent changes in this window. */
export class QuickIntakeAttempt {
  private create: WriteAttempt;
  private update: WriteAttempt;
  private confirmed: IntakeInput | null = null;
  private version = 1;
  identity: IntakeIdentity | null = null;
  constructor(send: Send) {
    this.create = new WriteAttempt(send);
    this.update = new WriteAttempt(send);
  }
  async save(input: IntakeInput): Promise<IntakeIdentity> {
    if (!this.identity) {
      this.identity = await this.create.run<IntakeIdentity>("/items", input);
      this.confirmed = structuredClone(input);
      // Own quick intake has no sourceId and always creates a fresh Item at
      // version 1. Receipt replay returns that same creation identity.
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
      const result = await this.update.run<{ version: number }>(
        `/items/${this.identity.id}`,
        patch,
        "PATCH",
      );
      this.version = result.version;
      this.confirmed = structuredClone(input);
    }
    return this.identity;
  }
}
