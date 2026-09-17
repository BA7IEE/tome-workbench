import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON 中不能包含非有限数字");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  throw new Error("采集输入必须是可序列化 JSON");
}

export function fingerprint(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`无法读取 JSON 文件：${path}`);
  }
}

function compatibleProtocol(version) {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(String(version || ""));
  return !!match && Number(match[1]) === 1 && Number(match[2]) >= 2;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export class IngestClient {
  constructor({ baseUrl, token }) {
    if (!baseUrl || !token)
      throw new Error("需要设置 TOME_INGEST_BASE_URL 和 TOME_INGEST_TOKEN");
    try {
      this.baseUrl = new URL(baseUrl).toString().replace(/\/$/, "");
    } catch {
      throw new Error("TOME_INGEST_BASE_URL 必须是 HTTP(S) 地址");
    }
    if (!/^https?:\/\//.test(this.baseUrl))
      throw new Error("TOME_INGEST_BASE_URL 只允许 HTTP(S) 地址");
    this.token = token;
    this.origin = new URL(this.baseUrl).origin;
  }

  endpoint(path) {
    const url = new URL(path, `${this.baseUrl}/`);
    if (url.origin !== this.origin)
      throw new Error("服务端协议不能将采集客户端跳转到其他来源");
    return url;
  }

  async request(path, { method = "GET", body, key, form } = {}) {
    const headers = { "X-Ingest-Token": this.token };
    if (key) headers["Idempotency-Key"] = key;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(this.endpoint(path), {
        method,
        headers,
        body: form || (body === undefined ? undefined : JSON.stringify(body)),
      });
    } catch {
      throw new Error("请求结果未知；请使用同一操作和原幂等键重试");
    }
    const text = await response.text();
    let data = null;
    if (text)
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`服务器返回了无法识别的响应（HTTP ${response.status}）`);
      }
    if (!response.ok)
      throw new Error(
        data?.error?.message || `服务器拒绝请求（HTTP ${response.status}）`,
      );
    return { data, headers: response.headers };
  }

  async markdown(path) {
    let response;
    try {
      response = await fetch(this.endpoint(path), {
        headers: { "X-Ingest-Token": this.token },
      });
    } catch {
      throw new Error("读取标准文档失败；请检查网络后重试");
    }
    const markdown = await response.text();
    if (!response.ok)
      throw new Error(`读取标准文档失败（HTTP ${response.status}）`);
    if (!response.headers.get("content-type")?.includes("text/markdown"))
      throw new Error("服务端返回的标准文档类型不正确");
    return markdown;
  }

  async bootstrap() {
    const protocol = (await this.request("protocol")).data;
    if (!compatibleProtocol(protocol?.version))
      throw new Error("服务端协议主版本或标准版本不兼容；已停止写入");
    if (
      !protocol?.skill?.url ||
      !protocol?.skill?.sha256 ||
      !protocol?.profile?.url ||
      !protocol?.profile?.sha256 ||
      !protocol?.profile?.id
    )
      throw new Error("服务端缺少受校验的 Skill/Profile 描述；已停止写入");
    const [skill, profile] = await Promise.all([
      this.markdown(protocol.skill.url),
      this.markdown(protocol.profile.url),
    ]);
    if (sha256(skill) !== protocol.skill.sha256)
      throw new Error("Skill 校验值不一致；已停止写入");
    if (sha256(profile) !== protocol.profile.sha256)
      throw new Error("来源 Profile 校验值不一致；已停止写入");
    return protocol;
  }
}

export function standardBatchInput(input, protocol) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("批次文件必须是 JSON 对象");
  const rawManifest = input.rawManifest || {};
  if (
    !rawManifest ||
    typeof rawManifest !== "object" ||
    Array.isArray(rawManifest)
  )
    throw new Error("rawManifest 必须是 JSON 对象");
  const required = {
    protocolVersion: protocol.version,
    skillVersion: protocol.skill.id || `${protocol.skill.name}/${protocol.skill.version}`,
    profile: protocol.profile.id,
  };
  for (const [key, value] of Object.entries(required))
    if (rawManifest[key] !== undefined && rawManifest[key] !== value)
      throw new Error(`批次文件中的 ${key} 与服务器当前标准不一致`);
  return { ...input, rawManifest: { ...rawManifest, ...required } };
}
