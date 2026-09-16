import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const statePath = (cwd = process.cwd()) =>
  resolve(cwd, ".tome-ingest-state.json");

function emptyState() {
  return { version: 1, operations: {} };
}

async function load(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      value?.version !== 1 ||
      !value.operations ||
      typeof value.operations !== "object" ||
      Array.isArray(value.operations)
    )
      throw new Error("state shape");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw new Error("本地采集状态文件无效；请先人工核对服务器批次，再修复该文件");
  }
}

async function save(path, state) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function beginOperation({ path = statePath(), operation, fingerprint }) {
  const state = await load(path),
    old = state.operations[operation];
  if (old) {
    if (old.fingerprint !== fingerprint)
      throw new Error("同一采集操作的输入已变化；请改用新的操作标识或先核对服务器状态");
    return { path, entry: old };
  }
  const entry = {
    fingerprint,
    idempotencyKey: randomUUID(),
    serverId: null,
    status: "PENDING",
    updatedAt: new Date().toISOString(),
  };
  state.operations[operation] = entry;
  await save(path, state);
  return { path, entry };
}

export async function completeOperation({ path, operation, serverId, status }) {
  const state = await load(path),
    entry = state.operations[operation];
  if (!entry) throw new Error("找不到本地采集操作状态");
  state.operations[operation] = {
    ...entry,
    ...(serverId ? { serverId } : {}),
    status,
    updatedAt: new Date().toISOString(),
  };
  await save(path, state);
  return state.operations[operation];
}
