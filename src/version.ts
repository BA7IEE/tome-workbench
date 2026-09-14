import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// One source of truth for source runs, built Node processes and Docker images.
const manifest: { version?: unknown } = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf8"),
);
if (
  typeof manifest.version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(manifest.version)
)
  throw new Error("Invalid delivered application version");
export const APP_VERSION: string = manifest.version;
