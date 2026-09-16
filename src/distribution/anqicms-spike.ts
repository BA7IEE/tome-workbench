import { z } from "zod";
import { Fault } from "../common/errors";
import { safeText } from "../common/domain";

// This module deliberately has no HTTP client, endpoint, credential, or
// side-effect. It freezes the local/deidentified Spike contract that a later
// deterministic connector may implement after a real API UAT is approved.
export const anqicmsSpikeProtocol = "tome.anqicms.spike/v1";

const tmCode = z.string().regex(/^TM\d{6,}$/);
const itemStatus = z.enum([
  "AVAILABLE",
  "PAUSED",
  "RESERVED",
  "SOLD",
  "SUPPLIER_SOLD",
  "GIFTED",
  "SELF_USE",
  "QUARANTINED",
]);
const asset = z
  .object({
    id: safeText(200).min(1),
    role: z.enum(["PRODUCT", "DETAIL", "DEFECT"]),
    position: z.number().int().min(0),
    download: safeText(2000).min(1),
  })
  .strict();

const payloadInput = z
  .object({
    action: z.enum(["PUBLISH", "UPDATE", "DELIST"]),
    item: z
      .object({
        tmCode,
        title: safeText(500).min(1),
        body: safeText(16000).min(1),
        price: z.number().int().min(0),
        currency: z.literal("USD"),
        status: itemStatus,
        brand: safeText(100).min(1),
        category: safeText(100).min(1),
        condition: safeText(3000).min(1),
        size: safeText(100).default(""),
        color: safeText(100).default(""),
        material: safeText(300).default(""),
        measurements: safeText(1500).default(""),
        year: safeText(100).default(""),
        collection: safeText(200).default(""),
        styleNumber: safeText(200).default(""),
      })
      .strict(),
    images: z.array(asset).max(40),
    listing: z
      .object({
        archiveId: safeText(300).min(1),
        url: z.union([z.literal(""), z.string().url().max(2000)]).default(""),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

const receiptInput = z
  .object({
    archive_id: z.union([safeText(300).min(1), z.number().int().safe()]),
    url: z.union([z.literal(""), z.string().url().max(2000)]).default(""),
  })
  .passthrough();

export type AnqicmsSpikeInput = z.infer<typeof payloadInput>;

function sensitive(value: string) {
  return /(?:bearer\s+\S+|(?:token|password|secret|cookie|authorization|api[_-]?key|access[_-]?(?:token|key)|credential|session)\s*[:=]\s*\S+)/i.test(
    value,
  );
}

function archiveId(raw: string) {
  const value = raw.trim();
  if (
    !value ||
    /^MANUAL:/i.test(value) ||
    /^TM\d+$/i.test(value) ||
    sensitive(value)
  )
    throw new Fault(
      "ANQICMS_ARCHIVE_ID_INVALID",
      "AnQiCMS archive ID 必须是稳定远端身份，不能使用 TM、手工占位或凭据文本",
      400,
    );
  return value;
}

function checkedUrl(value: string) {
  if (!value) return "";
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Fault("ANQICMS_URL_INVALID", "AnQiCMS 页面链接必须是 HTTP/HTTPS", 400);
  if (
    parsed.username ||
    parsed.password ||
    sensitive(value) ||
    [...parsed.searchParams.keys()].some((key) =>
      /(?:token|secret|signature|password|api[_-]?key|access[_-]?(?:token|key)|credential|cookie|session|auth)/i.test(
        key,
      ),
    )
  )
    throw new Fault(
      "ANQICMS_URL_INVALID",
      "AnQiCMS 页面链接不得包含访问凭据",
      400,
    );
  return value;
}

function usd(amount: number) {
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

function excerpt(value: string, length = 160) {
  return Array.from(value.replace(/\s+/g, " ").trim())
    .slice(0, length)
    .join("");
}

function sortedImages(rows: AnqicmsSpikeInput["images"]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id))
      throw new Fault("ANQICMS_IMAGE_DUPLICATE", "Spike 图片不能重复", 400);
    seen.add(row.id);
  }
  return [...rows].sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );
}

function disclosure(body: string, condition: string) {
  return body.includes(condition)
    ? body
    : `${body}\n\nCondition / disclosed defects: ${condition}`;
}

/**
 * Produce a deterministic local contract payload only. It is intentionally
 * not an AnQiCMS HTTP request and never reads configuration or credentials.
 */
export function buildAnqicmsSpikePayload(raw: unknown) {
  const input = payloadInput.parse(raw);
  const stable = input.listing
    ? {
        archiveId: archiveId(input.listing.archiveId),
        url: checkedUrl(input.listing.url),
      }
    : null;

  if (input.action === "DELIST") {
    if (!stable)
      throw new Fault(
        "ANQICMS_ARCHIVE_ID_REQUIRED",
        "AnQiCMS 售出库存同步必须已有 archive ID，不能按标题猜测页面",
        409,
      );
    return {
      protocol: anqicmsSpikeProtocol,
      sourceAction: input.action,
      operation: "STOCK_ZERO" as const,
      identity: { tm_code: input.item.tmCode, archive_id: stable.archiveId },
      fields: { stock: 0 },
      page: {
        retain: true,
        displayState: input.item.status === "SOLD" ? "SOLD" : "UNAVAILABLE",
        checkout: false,
        inquiryOnly: true,
      },
      remoteUrl: stable.url,
    };
  }

  if (input.item.status !== "AVAILABLE")
    throw new Fault(
      "ANQICMS_ITEM_NOT_AVAILABLE",
      "只有 AVAILABLE 商品可以生成 AnQiCMS 发布或更新资料",
      409,
    );
  const images = sortedImages(input.images);
  if (!images.length)
    throw new Fault(
      "ANQICMS_IMAGE_REQUIRED",
      "AnQiCMS 发布 Spike 至少需要一张已授权图片",
      400,
    );
  const content = disclosure(input.item.body, input.item.condition);
  const gallery = images.slice(0, 9);
  const bodyImages = images.slice(9);
  return {
    protocol: anqicmsSpikeProtocol,
    sourceAction: input.action,
    operation: stable ? ("UPDATE" as const) : ("LOOKUP_THEN_CREATE" as const),
    identity: {
      tm_code: input.item.tmCode,
      ...(stable ? { archive_id: stable.archiveId } : {}),
    },
    ...(stable
      ? {}
      : { lookup: { field: "tm_code" as const, value: input.item.tmCode } }),
    fields: {
      title: input.item.title,
      content,
      price: usd(input.item.price),
      currency: "USD" as const,
      stock: 1,
      images: gallery,
      contentImages: bodyImages,
      category: input.item.category,
      keywords: [input.item.brand, input.item.category].filter(Boolean),
      description: excerpt(content),
      url_token: input.item.tmCode.toLowerCase(),
      custom: {
        tm_code: input.item.tmCode,
        brand: input.item.brand,
        condition: input.item.condition,
        size: input.item.size,
        color: input.item.color,
        material: input.item.material,
        measurements: input.item.measurements,
        year: input.item.year,
        collection: input.item.collection,
        style_number: input.item.styleNumber,
      },
    },
    page: { retain: true, displayState: "LIVE" as const, checkout: false, inquiryOnly: true },
    ...(stable ? { remoteUrl: stable.url } : {}),
  };
}

/**
 * Freeze how a later connector must turn a verified AnQiCMS receipt into the
 * existing DistributionAttempt result contract. It neither sends nor stores it.
 */
export function normalizeAnqicmsReceipt(raw: unknown, code: string) {
  const receipt = receiptInput.parse(raw);
  const tmCodeValue = tmCode.parse(code);
  const remoteId = archiveId(String(receipt.archive_id));
  return {
    state: "SUCCEEDED" as const,
    remoteId,
    remoteUrl: checkedUrl(receipt.url),
    evidence: {
      method: "API_RESPONSE" as const,
      note: "AnQiCMS 回执已返回稳定 archive ID；后续更新与售出同步使用该 ID。",
      locator: `tm_code=${tmCodeValue}`,
    },
  };
}
