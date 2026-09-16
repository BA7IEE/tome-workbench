export interface CollectionDraft {
  itemIds: string[];
  title: string;
  channelId: string;
  updatedAt: string;
  attempt: null | {
    signature: string;
    title: string;
    channelId: string;
    itemIds: string[];
    key: string;
    packages: [string, string][];
    uncertain: boolean;
  };
}
const key = (owner: string) => "tome:collection-draft:" + owner;
export function readCollectionDraft(owner: string): CollectionDraft | null {
  const raw = localStorage.getItem(key(owner));
  if (!raw) return null;
  const value = JSON.parse(raw) as CollectionDraft;
  const ids = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.length <= 40 &&
    v.every((id) => typeof id === "string" && /^[a-zA-Z0-9-]+$/.test(id));
  if (
    !ids(value.itemIds) ||
    typeof value.title !== "string" ||
    typeof value.channelId !== "string"
  )
    throw new Error("选品草稿损坏，请先保留浏览器数据并联系管理员");
  if (
    value.attempt &&
    (!ids(value.attempt.itemIds) ||
      typeof value.attempt.key !== "string" ||
      typeof value.attempt.signature !== "string" ||
      !Array.isArray(value.attempt.packages) ||
      value.attempt.packages.some(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some((id) => typeof id !== "string"),
      ))
  )
    throw new Error("选品提交恢复记录损坏，不能重新生成");
  return value;
}
export function writeCollectionDraft(owner: string, draft: CollectionDraft) {
  if (!owner) throw new Error("请先登录");
  try {
    localStorage.setItem(key(owner), JSON.stringify(draft));
  } catch {
    throw new Error("无法保存浏览器选品草稿，请检查存储空间后重试");
  }
}
