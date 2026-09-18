import { z } from "zod";
import { Fault } from "../common/errors";
import { safeText } from "../common/domain";

// This module deliberately has no HTTP client, endpoint, credential, or
// side-effect. It freezes the local/deidentified handoff contract that a later
// external Agent may use after a real API UAT is separately approved.
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

const listingInput = z
  .object({
    archiveId: safeText(300).min(1),
    url: z.union([z.literal(""), z.string().url().max(2000)]).default(""),
  })
  .strict()
  .nullable()
  .default(null);

const publicationInput = z
  .object({
    action: z.enum(["PUBLISH", "UPDATE"]),
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
        // `conditionGrade` is a controlled dictionary code (for example
        // VERY_GOOD); the free-text disclosure remains a separate fact.
        conditionGrade: safeText(100).default(""),
        conditionDescription: safeText(3000).min(1),
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
    listing: listingInput,
  })
  .strict();

// A safety stop has a deliberately smaller contract than a publication.  It
// must never make old image rights, price, text or package validity a reason
// to leave a sold item purchasable.
const takedownInput = z
  .object({
    action: z.literal("DELIST"),
    item: z
      .object({
        tmCode,
        status: itemStatus,
      })
      .strict(),
    listing: listingInput,
  })
  .strict();

const receiptInput = z
  .object({
    archive_id: z.union([safeText(300).min(1), z.number().int().safe()]),
    url: z.union([z.literal(""), z.string().url().max(2000)]).default(""),
  })
  .passthrough();

export type AnqicmsSpikeInput = z.infer<typeof publicationInput>;
export type AnqicmsTakedownProjectionInput = z.infer<typeof takedownInput>;

function sensitive(value: string) {
  return /(?:bearer\s+\S+|(?:token|password|secret|cookie|authorization|api[_-]?key|access[_-]?(?:token|key)|credential|session)\s*[:=]\s*\S+)/i.test(
    value,
  );
}

export function validateAnqicmsArchiveId(raw: string) {
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
      throw new Fault("ANQICMS_IMAGE_DUPLICATE", "AnQiCMS 合同图片不能重复", 400);
    seen.add(row.id);
  }
  return [...rows].sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );
}

function disclosure(body: string, conditionDescription: string) {
  return body.includes(conditionDescription)
    ? body
    : `${body}\n\nCondition / disclosed defects: ${conditionDescription}`;
}

/**
 * Produce the identity-only safety-stop contract.  This is intentionally
 * separate from publication payload creation: a stock=0 operation needs only
 * the stable remote identity and current inventory fact.
 */
export function buildAnqicmsTakedownProjection(raw: unknown) {
  const input = takedownInput.parse(raw);
  const stable = input.listing
    ? {
        archiveId: validateAnqicmsArchiveId(input.listing.archiveId),
        url: checkedUrl(input.listing.url),
      }
    : null;
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

/**
 * Produce a deterministic local contract payload only. It is intentionally
 * not an AnQiCMS HTTP request and never reads configuration or credentials.
 */
export function buildAnqicmsSpikePayload(raw: unknown) {
  const action = z
    .object({ action: z.unknown() })
    .passthrough()
    .safeParse(raw);
  if (action.success && action.data.action === "DELIST")
    return buildAnqicmsTakedownProjection(raw);
  const input = publicationInput.parse(raw);
  const stable = input.listing
    ? {
        archiveId: validateAnqicmsArchiveId(input.listing.archiveId),
        url: checkedUrl(input.listing.url),
      }
    : null;

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
      "AnQiCMS 发布合同至少需要一张已授权图片",
      400,
    );
  const content = disclosure(input.item.body, input.item.conditionDescription);
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
        condition_grade: input.item.conditionGrade,
        condition_description: input.item.conditionDescription,
        size: input.item.size,
        color: input.item.color,
        material: input.item.material,
        measurements: input.item.measurements,
        year: input.item.year,
        collection: input.item.collection,
        styleNumber: input.item.styleNumber,
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
  const remoteId = validateAnqicmsArchiveId(String(receipt.archive_id));
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
