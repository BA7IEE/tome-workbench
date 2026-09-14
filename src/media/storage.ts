import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "../common/config";
import { Fault } from "../common/errors";
export const assetPath = (key: string) => {
  if (!/^[a-f0-9-]{36}\.original$/.test(key))
    throw new Error("Invalid storage object");
  return join(config().mediaDir, key);
};

export async function removeStoredImage(objectKey: string) {
  await Promise.all(
    [assetPath(objectKey), assetPath(objectKey) + ".webp"].map((p) =>
      unlink(p).catch(() => undefined),
    ),
  );
}
export async function storeImage(file: Express.Multer.File | undefined) {
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
  const objectKey = randomUUID() + ".original";
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
  await mkdir(config().mediaDir, { recursive: true });
  await writeFile(assetPath(objectKey), file.buffer, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(assetPath(objectKey) + ".webp", preview, {
    flag: "wx",
    mode: 0o600,
  });
  return {
    objectKey,
    sha256: createHash("sha256").update(file.buffer).digest("hex"),
    mime: mime[metadata.format!],
    size: file.size,
    originalName: file.originalname
      .replace(/[\x00-\x1f\/\\]/g, "_")
      .slice(0, 150),
  };
}
