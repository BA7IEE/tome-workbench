// One logical write keeps one idempotency key until its outcome is known.
// A network error cannot be treated as proof that the server rolled back.
type Send = <T>(
  path: string,
  method: string,
  body: unknown,
  key: string,
) => Promise<T>;
type Attempt = {
  method: string;
  path: string;
  body: unknown;
  signature: string;
  key: string;
};
export class WriteAttempt {
  private attempt: Attempt | null = null;
  uncertain = false;
  constructor(private send: Send) {}
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
