import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const DISTRIBUTION_PROTOCOL_VERSION = "1.0";
export const DISTRIBUTION_SKILL_NAME = "tome-distribution";
export const DISTRIBUTION_SKILL_VERSION = "1.0";
export const DISTRIBUTION_SKILL_ID = `${DISTRIBUTION_SKILL_NAME}/${DISTRIBUTION_SKILL_VERSION}`;

export type DistributionProfile = {
  id: string;
  name: string;
  platform: string;
  file: string;
};

export const GENERIC_STOP_PROFILE: DistributionProfile = {
  id: "GENERIC_STOP/1.0",
  name: "Generic stop-only channel",
  platform: "*",
  file: "GENERIC_STOP.md",
};

const profiles: readonly DistributionProfile[] = [
  {
    id: "ANQICMS/1.0",
    name: "AnQiCMS",
    platform: "ANQICMS",
    file: "ANQICMS.md",
  },
  {
    id: "XIANYU/1.0",
    name: "闲鱼",
    platform: "XIANYU",
    file: "XIANYU.md",
  },
  {
    id: "VC/1.0",
    name: "Vestiaire",
    platform: "VC",
    file: "VC.md",
  },
  {
    id: "GRAILED/1.0",
    name: "Grailed",
    platform: "GRAILED",
    file: "GRAILED.md",
  },
  {
    id: "CAROUSELL/1.0",
    name: "Carousell",
    platform: "CAROUSELL",
    file: "CAROUSELL.md",
  },
  {
    id: "GENERIC_TRADE/1.0",
    name: "Generic trade channel",
    platform: "OTHER",
    file: "GENERIC.md",
  },
];

function profileDirectory() {
  return resolve(process.cwd(), "agent", "skills", DISTRIBUTION_SKILL_NAME);
}

function checksum(markdown: string) {
  return createHash("sha256").update(markdown).digest("hex");
}

export function profileForPlatform(platform: string) {
  return profiles.find(
    (profile) => profile.platform === platform.trim().toUpperCase(),
  );
}

export async function readDistributionSkillDocument() {
  const markdown = await readFile(resolve(profileDirectory(), "SKILL.md"), "utf8");
  return { markdown, sha256: checksum(markdown) };
}

export async function readDistributionProfileDocument(profile: DistributionProfile) {
  const markdown = await readFile(
    resolve(profileDirectory(), "profiles", profile.file),
    "utf8",
  );
  return { markdown, sha256: checksum(markdown) };
}
