import { Prisma } from "@prisma/client";
import { z } from "zod";
import { permission, type Role } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { safeText } from "../common/domain";

const querySchema = z
  .object({
    scope: z
      .enum([
        "ALL",
        "IMPORTANT",
        "NEXT",
        "TASK",
        "CANDIDATE",
        "OBSERVATION",
        "DISTRIBUTION",
        "INQUIRY",
        "SALE_FINANCE",
      ])
      .default("ALL"),
    q: safeText(150).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(300).default(300),
  })
  .strict();
type Row = {
  id: string;
  entityId: string;
  kind: string;
  priority: number;
  title: string;
  detail: string;
  createdAt: string;
  item: { id: string; serial: number; title: string } | null;
  task: { kind: string; assignee: string; note: string } | null;
  sourceId: string | null;
  focus: string | null;
  href?: string;
  action?: string;
};
/** One SQL snapshot: scope/search/order precede pagination. No writable queue table. */
export async function readWorkQueue(
  db: PrismaService,
  role: Role,
  raw: unknown,
) {
  const q = querySchema.parse(raw),
    sell = permission(role, "sell"),
    publish = permission(role, "publish"),
    finance = permission(role, "finance");
  const [result] = await db.$queryRaw<
    { rows: Row[]; total: number; summary: Record<string, number> }[]
  >(Prisma.sql`
    WITH all_rows AS (
      SELECT 'candidate:' || c.id::text AS id, c.id AS "entityId", 'CANDIDATE' AS kind, 60 AS priority,
        '候选商品待确认' AS title, concat_ws(' · ', p.name, nullif(c."brandRaw", ''), c."titleRaw") AS detail,
        c."createdAt", NULL::jsonb AS item, NULL::jsonb AS task, c."procurementSourceId"::text AS "sourceId",
        coalesce(nullif(c."sourceItemKey", ''), c."titleRaw") AS focus
      FROM "IngestCandidate" c JOIN "ProcurementSource" p ON p.id=c."procurementSourceId" WHERE c.decision='PENDING'
      UNION ALL
      SELECT 'task:' || t.id::text, t.id, 'TASK', CASE WHEN t.kind='DELIST' THEN 100 ELSE 50 END,
        t.title, 'TM' || lpad(i.serial::text, greatest(6,length(i.serial::text)), '0') || ' · ' || i.title, t."createdAt",
        jsonb_build_object('id',i.id,'serial',i.serial,'title',i.title), jsonb_build_object('kind',t.kind,'assignee',t.assignee,'note',t.note), NULL, NULL
      FROM "Task" t JOIN "Item" i ON i.id=t."itemId" WHERE t.status='OPEN' AND i."dataMode"='BUSINESS' AND i."deletedAt" IS NULL
      UNION ALL
      SELECT 'observation:' || o.id::text, o.id, 'OBSERVATION', 90, '商品事实存在冲突待核对',
        'TM' || lpad(i.serial::text, greatest(6,length(i.serial::text)), '0') || ' · ' || i.title, o."createdAt",
        jsonb_build_object('id',i.id,'serial',i.serial,'title',i.title), NULL, NULL, NULL
      FROM "Observation" o JOIN "Item" i ON i.id=o."itemId" WHERE NOT o.resolved AND i."dataMode"='BUSINESS' AND i."deletedAt" IS NULL
      UNION ALL
      SELECT 'distribution:' || d.id::text, d.id, 'DISTRIBUTION', CASE WHEN d.action='DELIST' THEN 100 WHEN d.state='UNKNOWN' THEN 95 ELSE 70 END,
        CASE WHEN d.action='DELIST' THEN '商品已不宜继续出售，渠道仍待停售' WHEN d.state='UNKNOWN' THEN '分发记录需要核对，须按TM核对' ELSE '分发记录需要处理' END,
        concat_ws(' · ', 'TM' || lpad(i.serial::text, greatest(6,length(i.serial::text)), '0'), i.title, c.name, d.action, nullif(d."errorCode", '')), d."createdAt",
        jsonb_build_object('id',i.id,'serial',i.serial,'title',i.title), NULL, NULL, NULL
      FROM "DistributionAttempt" d JOIN "Item" i ON i.id=d."itemId" JOIN "Channel" c ON c.id=d."channelId"
      WHERE ${publish} AND (
        (d.action='DELIST' AND d.state IN ('PENDING','RUNNING','UNKNOWN','FAILED'))
        OR (d.action<>'DELIST' AND d.state IN ('UNKNOWN','FAILED'))
      ) AND i."dataMode"='BUSINESS' AND i."deletedAt" IS NULL
      UNION ALL
      SELECT 'inquiry:' || n.id::text, n.id, 'INQUIRY', 85,
        CASE WHEN n.state='FOLLOWUP' THEN '客户询盘跟进中' ELSE '新询盘待跟进' END,
        concat_ws(' · ', 'TM' || lpad(i.serial::text, greatest(6,length(i.serial::text)), '0'), i.title, n.channel, n."customerRef"), n."updatedAt",
        jsonb_build_object('id',i.id,'serial',i.serial,'title',i.title), NULL, NULL, NULL
      FROM "Inquiry" n JOIN "Item" i ON i.id=n."itemId" WHERE ${sell} AND n.state IN ('OPEN','FOLLOWUP') AND i."dataMode"='BUSINESS' AND i."deletedAt" IS NULL
      UNION ALL
      SELECT 'sale:' || s.id::text, s.id, 'SALE_FINANCE', 30, '成交记录待补收支',
        concat_ws(' · ', 'TM' || lpad(i.serial::text, greatest(6,length(i.serial::text)), '0'), i.title,
          '缺 ' || concat_ws('、', CASE WHEN s.amount IS NULL THEN '成交额' END, CASE WHEN s.cost IS NULL THEN '成本' END, CASE WHEN s.fees IS NULL THEN '费用' END, CASE WHEN NOT s.paid THEN '到账确认' END)), s."soldAt",
        jsonb_build_object('id',i.id,'serial',i.serial,'title',i.title), NULL, NULL, NULL
      FROM "Sale" s JOIN "Item" i ON i.id=s."itemId" WHERE ${finance} AND (s.amount IS NULL OR s.cost IS NULL OR s.fees IS NULL OR NOT s.paid) AND i."dataMode"='BUSINESS' AND i."deletedAt" IS NULL
    ), filtered AS (
      SELECT * FROM all_rows WHERE (${q.scope}='ALL' OR (${q.scope}='IMPORTANT' AND priority>=70) OR (${q.scope}='NEXT' AND priority<80) OR kind=${q.scope})
        AND strpos(lower(title || ' ' || detail), lower(${q.q}))>0
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY priority DESC, "createdAt", id LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}
    ) SELECT coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.priority DESC,p."createdAt",p.id) FROM page_rows p),'[]'::jsonb) AS rows,
      (SELECT count(*)::int FROM filtered) AS total,
      (SELECT jsonb_build_object('total',count(*),'candidates',count(*) FILTER(WHERE kind='CANDIDATE'),'tasks',count(*) FILTER(WHERE kind='TASK'),
        'observations',count(*) FILTER(WHERE kind='OBSERVATION'),'distribution',count(*) FILTER(WHERE kind='DISTRIBUTION'),'inquiries',count(*) FILTER(WHERE kind='INQUIRY'),'saleFinance',count(*) FILTER(WHERE kind='SALE_FINANCE')) FROM all_rows) AS summary
  `);
  for (const row of result.rows) {
    const item = row.item;
    if (row.kind === "CANDIDATE") {
      row.href = `#/candidates?sourceId=${row.sourceId}&q=${encodeURIComponent(row.focus || "")}`;
      row.action = "去确认";
    }
    if (row.kind === "TASK") {
      row.href = `#/items/${item!.id}?tab=${row.task?.kind === "DELIST" ? "use" : "facts"}`;
      row.action = row.task?.kind === "DELIST" ? "去下架" : "去处理";
    }
    if (row.kind === "OBSERVATION") {
      row.href = `#/items/${item!.id}`;
      row.action = "去核对";
    }
    if (row.kind === "DISTRIBUTION") {
      row.href = `#/distribution?attemptId=${row.entityId}&from=tasks`;
      row.action = "去处理";
    }
    if (row.kind === "INQUIRY") {
      row.href = `#/inquiries?id=${row.entityId}&from=tasks`;
      row.action = "去跟进";
    }
    if (row.kind === "SALE_FINANCE") {
      row.href = `#/sales?id=${row.entityId}&from=tasks`;
      row.action = "去补账";
    }
  }
  return { ...result, page: q.page, size: q.size };
}
