import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Fault } from "../common/errors";
import { record } from "./ingest-integrity";

export const INGEST_PROTOCOL_VERSION = "1.2";
export const INGEST_SKILL_NAME = "tome-ingest";
export const INGEST_SKILL_VERSION = "1.2";
export const INGEST_SKILL_ID = `${INGEST_SKILL_NAME}/${INGEST_SKILL_VERSION}`;

export type IngestProfile = {
  id: string;
  name: string;
  file: string;
  requiredFields: string[];
};

const genericMarketplace: IngestProfile = {
  id: "GENERIC_MARKETPLACE/1.2",
  name: "通用市场来源",
  file: "GENERIC_MARKETPLACE.md",
  requiredFields: [
    "titleRaw",
    "sourceItemKey",
    "brandRaw",
    "categoryRaw",
    "conditionRaw",
    "sourceFacts.sizeLabel",
    "sourceFacts.productUrl",
    "sourceFacts.description",
    "sourceCurrentPrice",
  ],
};

const trr13: IngestProfile = {
  // Keep this registry entry and its document immutable for batches that were
  // already created under 1.3. `profileForSourceCode` below intentionally
  // selects 1.4 for new sessions instead.
  id: "TRR/1.3",
  name: "The RealReal",
  file: "TRR-1.3.md",
  requiredFields: [
    "titleRaw",
    "sourceItemKey",
    "brandRaw",
    "categoryRaw",
    "conditionRaw",
    "sourceFacts.sizeLabel",
    "sourceFacts.color",
    "sourceFacts.material",
    "sourceFacts.measurements",
    "sourceFacts.productUrl",
    "sourceFacts.description",
    "sourceLineAmount",
    "sourceLineNetAmount",
    "sourceCurrentPrice",
    "sourceEstimatedRetail",
  ],
};

const trr14: IngestProfile = {
  id: "TRR/1.4",
  name: "The RealReal",
  file: "TRR.md",
  requiredFields: [
    ...trr13.requiredFields,
    "sourceFacts.foreignSize",
    "sourceFacts.sizeEstimated",
    "sourceFacts.order.orderDateRaw",
    "sourceFacts.order.orderedAt",
    "sourceFacts.order.datePrecision",
  ],
};

const profiles = [genericMarketplace, trr13, trr14] as const;

function parseVersion(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || "0"),
  };
}

function profileDirectory() {
  return resolve(process.cwd(), "agent", "skills", INGEST_SKILL_NAME);
}

function checksum(markdown: string) {
  return createHash("sha256").update(markdown).digest("hex");
}

export function profileForSourceCode(code: string): IngestProfile {
  const normalized = code.trim().toUpperCase();
  return normalized === "TRR" || /^TRR[_-]/.test(normalized)
    ? trr14
    : genericMarketplace;
}

export function profileById(id: unknown): IngestProfile | undefined {
  return profiles.find((profile) => profile.id === id);
}

export function standardManifest(manifest: unknown) {
  const value = record(manifest);
  return (
    value.protocolVersion !== undefined ||
    value.skillVersion !== undefined ||
    value.profile !== undefined
  );
}

export function assertStandardManifest(
  manifest: unknown,
  sourceProfile: IngestProfile,
) {
  if (!standardManifest(manifest)) return undefined;
  const value = record(manifest),
    protocol = parseVersion(value.protocolVersion);
  if (
    !protocol ||
    protocol.major !== 1 ||
    protocol.minor < 2
  )
    throw new Fault(
      "INGEST_PROTOCOL_INCOMPATIBLE",
      `标准采集仅接受协议 ${INGEST_PROTOCOL_VERSION} 的兼容版本`,
      400,
    );
  if (value.skillVersion !== INGEST_SKILL_ID)
    throw new Fault(
      "INGEST_SKILL_INCOMPATIBLE",
      `当前协议要求 Skill ${INGEST_SKILL_ID}`,
      400,
    );
  if (value.profile !== sourceProfile.id)
    throw new Fault(
      "INGEST_PROFILE_MISMATCH",
      `当前来源必须使用 Profile ${sourceProfile.id}`,
      400,
    );
  return sourceProfile;
}

/**
 * New machine-created batches must identify the exact protocol, Skill and
 * server-selected Profile they used.  `assertStandardManifest` intentionally
 * remains able to describe historical rows that predate v1.2; callers that
 * create a new row must use this stricter entry point instead.
 */
export function assertNewMachineBatchManifest(
  manifest: unknown,
  sourceProfile: IngestProfile,
) {
  const value = record(manifest);
  if (
    typeof value.protocolVersion !== "string" ||
    typeof value.skillVersion !== "string" ||
    typeof value.profile !== "string"
  )
    throw new Fault(
      "INGEST_STANDARD_MANIFEST_REQUIRED",
      "新机器批次必须提交 protocolVersion、skillVersion 和 profile",
      400,
    );
  return assertStandardManifest(manifest, sourceProfile);
}

export function effectiveRequiredFields(manifest: unknown) {
  const value = record(manifest),
    declared = Array.isArray(value.requiredFields)
      ? value.requiredFields.filter((field): field is string => typeof field === "string")
      : [],
    profile = standardManifest(value) ? profileById(value.profile) : undefined;
  return [...new Set([...(profile?.requiredFields || []), ...declared])];
}

export async function readSkillDocument() {
  const markdown = await readFile(resolve(profileDirectory(), "SKILL.md"), "utf8");
  return { markdown, sha256: checksum(markdown) };
}

export async function readProfileDocument(profile: IngestProfile) {
  const markdown = await readFile(
    resolve(profileDirectory(), "profiles", profile.file),
    "utf8",
  );
  return { markdown, sha256: checksum(markdown) };
}
