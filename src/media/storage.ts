import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "../common/config";
import { Fault } from "../common/errors";
import { lock, type Tx } from "../common/transaction";
import type { PrismaService } from "../database/prisma.service";
export const assetPath = (key: string) => {
  if (!/^[a-f0-9-]{36}\.original$/.test(key))
    throw new Error("Invalid storage object");
  return join(config().mediaDir, key);
};

export async function removeStoredImage(objectKey: string) {
  await Promise.all(
    [assetPath(objectKey), assetPath(objectKey) + ".webp"].map((p) =>
      unlink(p).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }),
    ),
  );
}
export async function prepareImage(file: Express.Multer.File | undefined) {
  if (!file) throw new Fault("FILE_REQUIRED", "请选择图片", 400);
  let metadata;
  try {
    metadata = await sharp(file.buffer, {
      limitInputPixels: 40000000,
      animated: false,
    }).metadata();
  } catch {
    throw new Fault("INVALID_IMAGE", "无法解码的图片", 400);
  }
  const mime: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  if (
    !mime[metadata.format || ""] ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages || 1) > 1
  )
    throw new Fault("INVALID_IMAGE", "仅允许静态 JPEG、PNG、WebP 图片", 400);
  let preview: Buffer;
  try {
    preview = await sharp(file.buffer, { limitInputPixels: 40000000 })
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new Fault("INVALID_IMAGE", "图片解码未完成，请重新导出图片", 400);
  }
  return {
    original: file.buffer,
    preview,
    metadata: {
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      mime: mime[metadata.format!],
      size: file.size,
      originalName: file.originalname
        .replace(/[\x00-\x1f\/\\]/g, "_")
        .slice(0, 150),
    },
  };
}
export type PreparedImage = Awaited<ReturnType<typeof prepareImage>>;

async function persistPreparedImage(
  prepared: PreparedImage,
  objectKey: string,
) {
  const owned: string[] = [];
  try {
    await mkdir(config().mediaDir, { recursive: true });
    for (const [name, buffer] of [
      [assetPath(objectKey), prepared.original],
      [assetPath(objectKey) + ".webp", prepared.preview],
    ] as const) {
      const handle = await open(name, "wx", 0o600);
      owned.push(name);
      try {
        await handle.writeFile(buffer);
      } finally {
        await handle.close();
      }
    }
    return { objectKey, ...prepared.metadata };
  } catch (error) {
    // Only remove paths created by this attempt; never unlink an EEXIST target.
    await Promise.all(owned.map((name) => unlink(name)));
    throw error;
  }
}

// Prepare outside the transaction, persist only inside the new-command callback.
// The per-object lock also makes compensation safe if commit acknowledgement was lost:
// wait for the writer to finish, then check all three possible reference owners.
export async function imageCommand<T>(
  db: PrismaService,
  prepared: PreparedImage,
  run: (
    persist: (
      tx: Tx,
    ) => Promise<{ objectKey: string } & PreparedImage["metadata"]>,
  ) => Promise<T>,
): Promise<T> {
  let objectKey: string | undefined;
  try {
    return await run(async (tx) => {
      if (objectKey) throw new Error("Image persistence may run only once");
      objectKey = randomUUID() + ".original";
      await lock(tx, "media:" + objectKey);
      return persistPreparedImage(prepared, objectKey);
    });
  } catch (error) {
    if (objectKey) {
      const key = objectKey;
      try {
        await db.$transaction(
          async (tx) => {
            await lock(tx, "media:" + key);
            const references = await Promise.all([
              tx.asset.count({ where: { objectKey: key } }),
              tx.intakeFile.count({ where: { objectKey: key } }),
              tx.ingestCandidateAsset.count({ where: { objectKey: key } }),
            ]);
            if (references.every((n) => n === 0)) await removeStoredImage(key);
          },
          { maxWait: 10000, timeout: 20000 },
        );
      } catch {
        // Database state cannot be proven: retain media for the maintenance scanner.
        console.error("MEDIA_COMPENSATION_DEFERRED " + key);
      }
    }
    throw error;
  }
}
