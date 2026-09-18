import { Fault } from "../common/errors";

const sensitiveKeys = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "session",
  "sessionid",
  "apikey",
  "authkey",
  "signature",
]);

const sensitiveUrlKeys = new Set([
  ...sensitiveKeys,
  "sig",
  "xamzsignature",
  "xgoogsignature",
  "signedtoken",
]);

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sensitiveText(value: string) {
  return /(?:bearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:token|password|passwd|secret|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|session|signature)\s*[:=]\s*\S+)/i.test(
    value,
  );
}

function inspectUrl(value: string, path: string) {
  if (!/^https?:\/\//i.test(value)) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (url.username || url.password)
    throw new Fault(
      "INGEST_SENSITIVE_DATA_DENIED",
      `${path}不得包含URL登录信息`,
      400,
    );
  for (const key of url.searchParams.keys())
    if (sensitiveUrlKeys.has(normalizedKey(key)))
      throw new Fault(
        "INGEST_SENSITIVE_DATA_DENIED",
        `${path}不得持久化带访问签名、Token、Cookie或密钥的URL；请去掉敏感查询参数后提交来源地址`,
        400,
      );
  const hash = url.hash.replace(/^#/, "");
  if (
    hash &&
    [...new URLSearchParams(hash).keys()].some((key) =>
      sensitiveUrlKeys.has(normalizedKey(key)),
    )
  )
    throw new Fault(
      "INGEST_SENSITIVE_DATA_DENIED",
      `${path}不得在URL片段中包含访问凭据`,
      400,
    );
}

/**
 * Machine ingest accepts broad source JSON on purpose, but broad evidence must
 * never become a credential vault. Reject obvious credential keys and signed
 * URLs before any Receipt, Candidate, Source or PurchaseOrder row can persist
 * them. Agents may still download a signed source asset externally and upload
 * the bytes; only the credential-bearing URL/query itself is forbidden here.
 */
export function assertNoSensitiveIngestData(
  value: unknown,
  path = "采集资料",
): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (sensitiveText(value))
      throw new Fault(
        "INGEST_SENSITIVE_DATA_DENIED",
        `${path}不得包含Token、Cookie、密码、密钥或授权头`,
        400,
      );
    inspectUrl(value, path);
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSensitiveIngestData(entry, `${path}[${index}]`),
    );
    return;
  }
  for (const [key, entry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (sensitiveKeys.has(normalizedKey(key)))
      throw new Fault(
        "INGEST_SENSITIVE_DATA_DENIED",
        `${path}.${key}属于敏感凭据字段，不能进入经营数据库`,
        400,
      );
    assertNoSensitiveIngestData(entry, `${path}.${key}`);
  }
}
