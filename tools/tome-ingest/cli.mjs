#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  IngestClient,
  fingerprint,
  readJsonFile,
  standardBatchInput,
} from "./client.mjs";
import { beginOperation, completeOperation, statePath } from "./state.mjs";

const usage = `用法：
  tome-ingest protocol
  tome-ingest batch create batch.json
  tome-ingest order import order.json
  tome-ingest candidates upsert <batch-id> candidates.json
  tome-ingest asset upload <candidate-id> image.jpg --source-url "https://…"
  tome-ingest batch status <batch-id>
  tome-ingest batch seal <batch-id>`;

function output(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function need(value, name) {
  if (!value) throw new Error(`缺少 ${name}\n\n${usage}`);
  return value;
}

function client() {
  return new IngestClient({
    baseUrl: process.env.TOME_INGEST_BASE_URL,
    token: process.env.TOME_INGEST_TOKEN,
  });
}

async function write({ operation, input, send, serverId, status = "COMPLETE" }) {
  const path = statePath(),
    { entry } = await beginOperation({
      path,
      operation,
      fingerprint: fingerprint(input),
    });
  const result = await send(entry.idempotencyKey);
  await completeOperation({
    path,
    operation,
    serverId: serverId(result),
    status: status(result),
  });
  output(result);
}

function parseAssetOptions(values) {
  const sourceIndex = values.indexOf("--source-url");
  if (sourceIndex < 0 || !values[sourceIndex + 1])
    throw new Error("上传图片必须提供 --source-url");
  const roleIndex = values.indexOf("--role-hint"),
    roleHint = roleIndex < 0 ? "PRODUCT" : values[roleIndex + 1];
  if (!roleHint) throw new Error("--role-hint 需要一个值");
  const known = new Set([sourceIndex, sourceIndex + 1]);
  if (roleIndex >= 0) known.add(roleIndex), known.add(roleIndex + 1);
  if (values.some((_, index) => !known.has(index)))
    throw new Error("图片上传参数不正确");
  return { sourceUrl: values[sourceIndex + 1], roleHint };
}

async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(usage + "\n");
    return;
  }
  const api = client();
  if (argv[0] === "protocol") {
    output(await api.bootstrap());
    return;
  }
  const protocol = await api.bootstrap(),
    [group, action, ...args] = argv;
  if (group === "batch" && action === "create") {
    const input = standardBatchInput(
      await readJsonFile(need(args[0], "batch.json")),
      protocol,
    );
    await write({
      operation: `batch:create:${need(input.externalBatchKey, "externalBatchKey")}`,
      input,
      send: async (key) =>
        (await api.request("batches", { method: "POST", body: input, key })).data,
      serverId: (result) => result.id,
      status: (result) => result.status || "COMPLETE",
    });
    return;
  }
  if (group === "order" && action === "import") {
    const input = await readJsonFile(need(args[0], "order.json"));
    await write({
      operation: `order:import:${fingerprint(input)}`,
      input,
      send: async (key) =>
        (await api.request("orders", { method: "POST", body: input, key })).data,
      serverId: (result) => result.id,
    });
    return;
  }
  if (group === "candidates" && action === "upsert") {
    const batchId = need(args[0], "batch-id"),
      raw = await readJsonFile(need(args[1], "candidates.json")),
      input = Array.isArray(raw) ? { candidates: raw } : raw;
    if (!Array.isArray(input?.candidates))
      throw new Error("candidates.json 必须是 candidates 数组或含 candidates 的对象");
    await write({
      operation: `candidates:upsert:${batchId}:${fingerprint(input)}`,
      input: { batchId, ...input },
      send: async (key) =>
        (
          await api.request(`batches/${batchId}/candidates`, {
            method: "POST",
            body: input,
            key,
          })
        ).data,
      serverId: (result) => result.batchId,
    });
    return;
  }
  if (group === "asset" && action === "upload") {
    const candidateId = need(args[0], "candidate-id"),
      imagePath = resolve(need(args[1], "image file")),
      options = parseAssetOptions(args.slice(2)),
      bytes = await readFile(imagePath),
      fileSha256 = createHash("sha256").update(bytes).digest("hex"),
      input = { candidateId, fileSha256, ...options },
      form = new FormData();
    form.set("sourceUrl", options.sourceUrl);
    form.set("roleHint", options.roleHint);
    form.set(
      "file",
      new Blob([bytes], { type: "application/octet-stream" }),
      basename(imagePath),
    );
    await write({
      operation: `asset:upload:${candidateId}:${fingerprint(input)}`,
      input,
      send: async (key) =>
        (
          await api.request(`candidates/${candidateId}/assets`, {
            method: "POST",
            key,
            form,
          })
        ).data,
      serverId: (result) => result.id,
    });
    return;
  }
  if (group === "batch" && action === "status") {
    const batchId = need(args[0], "batch-id");
    output((await api.request(`batches/${batchId}`)).data);
    return;
  }
  if (group === "batch" && action === "seal") {
    const batchId = need(args[0], "batch-id"),
      input = { batchId };
    await write({
      operation: `batch:seal:${batchId}`,
      input,
      send: async (key) =>
        (
          await api.request(`batches/${batchId}/seal`, {
            method: "POST",
            body: {},
            key,
          })
        ).data,
      serverId: (result) => result.id,
      status: (result) => result.status || "COMPLETE",
    });
    return;
  }
  throw new Error(`未知命令\n\n${usage}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "采集命令失败"}\n`);
  process.exitCode = 1;
});
