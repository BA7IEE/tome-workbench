// One logical write keeps one idempotency key until its outcome is known.
// A network error cannot be treated as proof that the server rolled back.
type Send = <T>(
  path: string,
  method: string,
  body: unknown,
  key: string,
) => Promise<T>;
export type WriteSnapshot = {
  method: string;
  path: string;
  body: unknown;
  signature: string;
  key: string;
};
export class WriteAttempt {
  private attempt: WriteSnapshot | null = null;
  uncertain = false;
  constructor(
    private send: Send,
    private beforeSend?: (snapshot: WriteSnapshot) => Promise<void>,
  ) {}
  get snapshot() {
    return this.attempt ? structuredClone(this.attempt) : null;
  }
  restore(snapshot: WriteSnapshot, uncertain = true) {
    if (
      this.attempt ||
      !/^[A-Za-z0-9_.:-]{12,128}$/.test(snapshot.key) ||
      snapshot.signature !==
        snapshot.method + snapshot.path + this.signature(snapshot.body)
    )
      throw new Error("恢复提交身份不一致，请先核对原记录");
    this.attempt = structuredClone(snapshot);
    this.uncertain = uncertain;
  }
  private signature(value: unknown): string {
    if (Array.isArray(value))
      return "[" + value.map((v) => this.signature(v)).join(",") + "]";
    if (value && typeof value === "object")
      return (
        "{" +
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => JSON.stringify(k) + ":" + this.signature(v))
          .join(",") +
        "}"
      );
    return JSON.stringify(value);
  }
  async run<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const signature = method + path + this.signature(body);
    if (this.attempt && this.attempt.signature !== signature && this.uncertain)
      throw new Error(
        "上次提交结果待确认。请先点击“核对上次提交”，当前编辑内容会保留。",
      );
    if (!this.attempt || this.attempt.signature !== signature)
      this.attempt = {
        path,
        method,
        body: structuredClone(body),
        signature,
        key: crypto.randomUUID(),
      };
    return this.execute<T>();
  }
  async retry<T>(): Promise<T> {
    if (!this.attempt) throw new Error("没有待核对的提交");
    return this.execute<T>();
  }
  private async execute<T>(): Promise<T> {
    const attempt = this.attempt!;
    // A recovery-storage failure happens before the network write, rather than
    // being mislabeled as a lost server receipt.
    await this.beforeSend?.(structuredClone(attempt));
    try {
      const result = await this.send<T>(
        attempt.path,
        attempt.method,
        attempt.body,
        attempt.key,
      );
      this.attempt = null;
      this.uncertain = false;
      return result;
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.uncertain =
        this.uncertain ||
        status === 0 ||
        (typeof status === "number" && status >= 500);
      throw error;
    }
  }
}
