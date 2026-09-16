export interface SessionResponse {
  user: User;
  csrf: string;
  capabilities: string[];
}
export type Obj = Record<string, unknown>;
export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  active?: boolean;
  capabilities?: string[];
}
export interface Facts {
  mainMaterial?: string;
  conditionGrade?: string;
  conditionGradeEn?: string;
  material: string;
  color: string;
  sizeLabel: string;
  measurements: string;
  measurementSource: string;
  condition: string;
  descriptionZh: string;
  descriptionEn: string;
  authentication: { status: string; evidence: string };
  research: { claim: string; evidence: string; confirmed: boolean }[];
  attributeLabels: Record<string, string>;
  attributes: Record<string, string | number | boolean>;
}
export interface Asset {
  archived: boolean;
  id: string;
  role: string;
  origin: string;
  rights: string;
  verified: boolean;
  originalName: string;
  sourceNote: string;
  position: number;
  validUntil: string | null;
}
export interface Channel {
  version: number;
  id: string;
  name: string;
  platform: string;
  locale: string;
  titleLimit: number;
  active: boolean;
}
export interface Pack {
  id: string;
  channelId: string;
  channel: Channel;
  purpose: string;
  validUntil: string;
  createdAt: string;
  snapshot: {
    code: string;
    title: string;
    body: string;
    price: number | null;
    currency: string;
    assets: { id: string }[];
  };
}
export interface Listing {
  id: string;
  itemId: string;
  channel: Channel;
  remoteId: string;
  url: string;
  desired: string;
  observed: string;
  observedAt: string;
  packageId: string;
  item?: { id: string; title: string; serial: number; status: string };
}
export interface Task {
  id: string;
  kind: string;
  title: string;
  status: string;
  assignee: string;
  note: string;
  listing?: Listing | null;
  item: { id: string; serial: number; title: string };
}
export interface Offer {
  id: string;
  amount: number | null;
  currency: string;
  status: string;
  validUntil: string;
  canReserve: boolean;
  notes: string;
  supplier: { id: string; name: string };
}
export interface Intent {
  id: string;
  customerRef: string;
  reason: string;
  status: string;
  expiresAt: string;
}
export interface Item {
  dataMode?: "BUSINESS" | "TEST";
  dictionary?: import("./dictionary-editor").DictionarySelection;
  dictionarySelections?: {
    kind: string;
    entryId: string;
    label: string;
    labelEn: string;
    entryVersion: number;
  }[];
  deletedAt?: string | null;
  deletionReason?: string;
  updatedAt?: string;
  _count?: { assets?: number; listings?: number };
  id: string;
  code: string;
  serial: number;
  title: string;
  brand: string;
  category: string;
  ownership: string;
  location: string;
  status: string;
  version: number;
  cycle: number;
  facts: Facts;
  approvedId: string | null;
  approvedValid: boolean;
  currentPrice: number | null;
  currentCostCny?: number | null;
  currency: string;
  assets: Asset[];
  offers: Offer[];
  packages: Pack[];
  listings: Listing[];
  tasks: Task[];
  intents: Intent[];
  revisions: {
    id: string;
    version: number;
    approvedAt: string | null;
    createdAt: string;
    snapshot: unknown;
  }[];
  observations: {
    id: string;
    kind: string;
    payload: unknown;
    resolved: boolean;
  }[];
  reservations: { id: string; customerRef: string; expiresAt: string }[];
  suggestions: {
    id: string;
    locale: string;
    text: string;
    inputVersion: number;
    status: string;
    source: string;
  }[];
  movements: {
    id: string;
    from: string;
    to: string;
    occurredAt: string;
    evidence: string;
  }[];
}
export interface Supplier {
  id: string;
  name: string;
  contact: string;
  notes: string;
}
export interface Source {
  sourceLabel?: string;
  originalKey?: string;
  previewUrl?: string | null;
  id: string;
  sourceKey: string;
  title: string;
  version: number;
  payload: unknown;
  supplier: Supplier | null;
  items: { id: string; serial: number }[];
}
export interface Sale {
  id: string;
  itemId: string;
  code: string;
  item: { serial: number; title: string };
  version: number;
  channel: string;
  customerRef: string;
  cooperation: string;
  amount: number | null;
  cost: number | null;
  fees: number | null;
  currency: string;
  refunded: number;
  returned: boolean;
  paid: boolean;
  note: string;
  soldAt: string;
  contribution: { state: string; value: number | null };
}
export interface Inquiry {
  version: number;
  id: string;
  item: { id: string; serial: number; title: string };
  channel: string;
  customerRef: string;
  notes: string;
  quote: number | null;
  currency: string;
  state: string;
}
export const categories: Record<string, string> = {
  CLOTHING: "服装",
  BAG: "包袋",
  SHOES: "鞋履",
  ACCESSORY: "配饰",
  OTHER: "其他",
};
export const states: Record<string, string> = {
  ACTIVE: "已启用",
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
  WITHDRAWN: "已撤回",
  VOID: "已作废",
  APPLIED: "已应用",
  ADMIN: "管理员",
  REVIEWER: "复核人员",
  OPERATOR: "运营人员",
  FINANCE: "财务人员",
  VIEWER: "只读人员",
  AVAILABLE: "可售",
  PAUSED: "已暂停",
  RESERVED: "已预留",
  SOLD: "我方已售",
  SUPPLIER_SOLD: "供货方已售",
  GIFTED: "已赠出",
  SELF_USE: "自留",
  QUARANTINED: "退回待复检",
  OPEN: "待处理",
  DONE: "已完成",
  SATISFIED: "资料已满足",
  EXCLUDED: "例外排除",
  INCLUDED: "默认合作",
  PENDING_REVIEW: "待核对",
  PENDING: "待处理",
  WORKING: "执行中",
  FAILED: "失败待处理",
  LIVE: "保持在线",
  OFFLINE: "要求下架",
  MANUAL_REPORTED_LIVE: "人工报告已发布",
  MANUAL_REPORTED_OFFLINE: "人工报告已下架",
  VERIFIED_OFFLINE: "已核验下架",
  SYSTEM_LIVE: "展厅已显示",
  SYSTEM_OFFLINE: "展厅已隐藏",
  FOLLOWUP: "跟进中",
  WON: "已转化（需另记成交）",
  LOST: "未成交",
};
