// Browser-local recovery records are scoped by account. Server permissions and
// original command keys are still checked on every resumed write.
let database: Promise<IDBDatabase> | undefined;
// Persist bytes instead of browser File handles; those handles are not durable
// in every WebKit context. Keep name/type/time for identical multipart retries.
async function encode(
  value: unknown,
  blobs = new Map<Blob, unknown>(),
): Promise<unknown> {
  if (value instanceof Blob) {
    if (!blobs.has(value))
      blobs.set(value, {
        tomeRecoveryFile: true,
        bytes: await value.arrayBuffer(),
        name: value instanceof File ? value.name : "blob",
        type: value.type,
        lastModified: value instanceof File ? value.lastModified : 0,
      });
    return blobs.get(value);
  }
  if (Array.isArray(value))
    return Promise.all(value.map((v) => encode(v, blobs)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([k, v]) => [
          k,
          await encode(v, blobs),
        ]),
      ),
    );
  return value;
}
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (
      v.tomeRecoveryFile === true &&
      v.bytes instanceof ArrayBuffer &&
      typeof v.name === "string" &&
      typeof v.type === "string" &&
      typeof v.lastModified === "number"
    )
      return new File([v.bytes], v.name, {
        type: v.type,
        lastModified: v.lastModified,
      });
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, decode(v)]),
    );
  }
  return value;
}
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("tome-work-recovery", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("work");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      database = undefined;
      reject(new Error("无法保存恢复进度，请检查浏览器存储空间后重试"));
    };
  }));
}
export async function readWork<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction("work", "readonly").objectStore("work").get(key);
    r.onsuccess = () => resolve(decode(r.result) as T | undefined);
    r.onerror = () => reject(new Error("恢复进度读取失败，请重试"));
  });
}
export async function saveWork(key: string, value: unknown) {
  const encoded = await encode(value);
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("work", "readwrite"),
      store = tx.objectStore("work");
    if (value === undefined) store.delete(key);
    else store.put(encoded, key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        new Error(
          "恢复进度保存失败，请检查浏览器存储空间后重试；已保存的服务器记录不会撤销",
        ),
      );
  });
}
