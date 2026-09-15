import { readWork, saveWork } from "./work-storage";
import {
  showSourceEvidence,
  integrityLabel,
  type CaptureIntegrity,
} from "./source-evidence";
import {
  request,
  can,
  esc,
  money,
  when,
  button,
  form,
  field,
  select,
  area,
  note,
  text,
  toast,
  viewDialog,
  copyText,
  check,
  reload,
  me,
  dialog,
} from "./core";
import { onPageReady } from "./page-lifecycle";
import { categories } from "./types";

type Source = { id: string; code: string; name: string; active: boolean };
type Session = {
  id: string;
  label: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  procurementSource: Source;
  _count: { batches: number };
};
type CandidateAsset = {
  id: string;
  originalName: string;
  sourceUrl: string;
  roleHint: string;
};
type Candidate = {
  id: string;
  version: number;
  titleRaw: string;
  brandRaw: string;
  categoryRaw: string;
  conditionRaw: string;
  statusRaw: string;
  currency: string;
  sourceLineAmount: number | null;
  sourceCurrentPrice: number | null;
  sourceEstimatedRetail: number | null;
  warnings: string[];
  decision: "PENDING" | "CONFIRMED" | "EXCLUDED";
  possession: "UNKNOWN" | "IN_HAND" | "NOT_IN_HAND";
  proposal: unknown;
  createdAt: string;
  sourceItemKey: string;
  procurementSource: Source;
  batch: { id: string; agentName: string; externalBatchKey: string };
  item?: { id: string; serial: number; title: string } | null;
  assets: CandidateAsset[];
  possibleDuplicateCount: number;
  integrity: CaptureIntegrity;
};
type CandidateResult = {
  total: number;
  page: number;
  size: number;
  rows: Candidate[];
};
type CandidateMatch = {
  id: string;
  serial: number;
  code: string;
  title: string;
  brand: string;
  status: string;
  reasons: string[];
};
const decisionNames: Record<string, string> = {
  PENDING: "待确认",
  CONFIRMED: "已归入TM",
  EXCLUDED: "已排除",
};
const proposalOf = (candidate: Candidate) =>
  candidate.proposal &&
  typeof candidate.proposal === "object" &&
  !Array.isArray(candidate.proposal)
    ? (candidate.proposal as Record<string, unknown>)
    : {};
const tm = (serial: number) => `TM${String(serial).padStart(6, "0")}`;
const categoryName = (value: unknown) =>
  categories[String(value)] || String(value || "待确认");
const candidatePhoto = (candidate: Candidate) =>
  candidate.assets[0]
    ? `<img src="/api/ingest/candidate-assets/${candidate.assets[0].id}/preview" alt="${esc(candidate.titleRaw)}" loading="lazy">`
    : `<div class="candidate-no-photo"><span>暂无来源图片</span></div>`;
function candidateEdit(candidate: Candidate, after: () => Promise<void>) {
  const proposal = proposalOf(candidate);
  form(
    "调整待确认商品",
    note("只调整准备生成TM时使用的本地字段；来源原始数据不会被覆盖。") +
      field(
        "title",
        "商品名称",
        proposal.title || candidate.titleRaw,
        "text",
        true,
      ) +
      select(
        "category",
        "一级品类",
        categories,
        String(proposal.category || "OTHER"),
      ) +
      area("note", "本次调整说明", "", 2),
    (d, key) =>
      request(
        `/ingest/candidates/${candidate.id}/review`,
        "POST",
        {
          version: candidate.version,
          possession: candidate.possession,
          decision: candidate.decision === "EXCLUDED" ? "EXCLUDED" : "PENDING",
          title: text(d, "title"),
          category: text(d, "category"),
          note: text(d, "note"),
        },
        key,
      ),
    "保存调整",
    after,
  );
}
async function candidateDetails(candidate: Candidate) {
  await showSourceEvidence(candidate.id);
}
let selectionScope = "";
const candidateSelection = new Map<string, Candidate>();
function rememberSelection(scope: string) {
  const next = (me?.id || "") + ":" + scope;
  if (selectionScope !== next) candidateSelection.clear();
  selectionScope = next;
  return candidateSelection;
}
function createAgentSession(sources: Source[]) {
  if (!sources.length) {
    toast("请先在采购历史中建立一个来源，例如 TRR", true);
    return;
  }
  const options = Object.fromEntries(
    sources.filter((x) => x.active).map((x) => [x.id, `${x.name} · ${x.code}`]),
  );
  form(
    "创建Agent导入会话",
    note(
      "Token只显示一次。它只能写采集候选，不能创建TM、改库存、记成交或改成本规则。",
    ) +
      select("procurementSourceId", "数据来源", options) +
      field("label", "会话名称", "历史订单采集", "text", true) +
      select(
        "ttlMinutes",
        "有效时间",
        { "60": "1小时", "120": "2小时", "360": "6小时", "720": "12小时" },
        "120",
      ),
    async (d, key) => {
      const result = await request<{
        id: string;
        token: string;
        expiresAt: string;
        source: Source;
      }>(
        "/ingest/sessions",
        "POST",
        {
          procurementSourceId: text(d, "procurementSourceId"),
          label: text(d, "label"),
          ttlMinutes: Number(text(d, "ttlMinutes")),
        },
        key,
      );
      const endpoint = `${location.origin}/api/agent-ingest`;
      const prompt = `把以下信息作为本次 ToMeBoutique 导入会话使用。\nBase URL: ${endpoint}\nX-Ingest-Token: ${result.token}\n来源: ${result.source.name} (${result.source.code})\n\n先GET /protocol读取约定。创建批次时提交expectedCandidateKeys和requiredFields清单；逐件提交sourceFacts.capture字段/图片检查清单，再上传原图文件。只采集来源事实，不要自行判断本地库存、成色或人民币成本。读取批次完整性报告，补齐漏项后再封闭；网页未提供的资料要注明原因，不能宣称全部收齐。`;
      setTimeout(
        () =>
          viewDialog(
            "Agent接入信息 · 仅显示一次",
            `<p>有效期至 ${esc(when(result.expiresAt))}</p><div class="agent-token"><code>${esc(result.token)}</code></div>${button(
              "复制给Agent",
              async () => {
                await copyText(prompt);
                toast("已复制Agent接入说明");
              },
              "primary",
            )}<details><summary>查看接入边界</summary><p>Agent只能调用 /api/agent-ingest 下的接口；正式商品、库存、成交、成本与发布均由后台人工确认。</p></details>`,
          ),
        0,
      );
      return { nextStep: true };
    },
    "创建会话",
  );
}
async function agentAccess(sources: Source[]) {
  const sessions = await request<Session[]>("/ingest/sessions");
  const active = sessions.filter(
    (x) => !x.revokedAt && new Date(x.expiresAt) > new Date(),
  );
  const rows = active
    .map(
      (s) =>
        `<tr><td><strong>${esc(s.label)}</strong><small>${esc(s.procurementSource.name)}</small></td><td>${esc(when(s.expiresAt))}</td><td>${esc(when(s.lastUsedAt))}</td><td>${s._count.batches}个批次</td><td>${button(
          "撤销",
          async () => {
            await request(`/ingest/sessions/${s.id}/revoke`, "POST", {
              reason: "经营人员手动撤销Agent导入会话",
            });
            toast("Agent导入会话已撤销");
            await agentAccess(sources);
          },
          "danger",
        )}</td></tr>`,
    )
    .join("");
  viewDialog(
    "Agent接入",
    `<div class="button-row">${button("＋ 创建导入会话", () => createAgentSession(sources), "primary")}</div>
     <p>Codex、WorkBuddy或其他桌面Agent都使用同一协议。Token不等于后台账号。</p>
     ${rows ? `<div class="table-wrap"><table><thead><tr><th>会话</th><th>到期</th><th>最近使用</th><th>批次</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><p>当前没有有效Agent导入会话</p></div>'}`,
  );
}
type BulkResult = {
  ok: number;
  failed: number;
  rows: { id: string; ok: boolean; error?: string; code?: string }[];
};
type PendingBulk = {
  key: string;
  exclude: boolean;
  selected: Candidate[];
  body: {
    ids: string[];
    versions: Record<string, number>;
    reason?: string;
    possession?: string;
    status?: string;
    incompleteAcknowledgements?: Record<string, string>;
  };
  completed: Record<string, BulkResult>;
};
async function runBulk(plan: PendingBulk, storage: string) {
  await saveWork(storage, plan);
  for (let start = 0; start < plan.body.ids.length; start += 100) {
    if (plan.completed[start]) continue;
    const ids = plan.body.ids.slice(start, start + 100),
      body = {
        ...plan.body,
        ids,
        versions: Object.fromEntries(
          ids.map((id) => [id, plan.body.versions[id]]),
        ),
        ...(plan.body.incompleteAcknowledgements
          ? {
              incompleteAcknowledgements: Object.fromEntries(
                ids
                  .filter((id) => plan.body.incompleteAcknowledgements?.[id])
                  .map((id) => [id, plan.body.incompleteAcknowledgements![id]]),
              ),
            }
          : {}),
      };
    const result = await request<BulkResult>(
      `/ingest/candidates/${plan.exclude ? "bulk-exclude" : "bulk-confirm"}`,
      "POST",
      body,
      `${plan.key}.${start}`,
    );
    plan.completed[start] = result;
    await saveWork(storage, plan);
  }
  const rows = Object.values(plan.completed).flatMap((r) => r.rows);
  for (const row of rows) if (row.ok) candidateSelection.delete(row.id);
  return {
    rows,
    ok: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => !r.ok).length,
  };
}
async function finishBulk(
  plan: PendingBulk,
  storage: string,
  after: () => Promise<void>,
) {
  const rows = Object.values(plan.completed).flatMap((r) => r.rows),
    failed = rows.filter((r) => !r.ok);
  await saveWork(storage, undefined);
  await after();
  if (failed.length)
    viewDialog(
      "批量处理结果",
      `<p>${rows.length - failed.length}件成功，${failed.length}件需要处理。请核对失败原因后重新选择；成功记录已保存。</p><ul>${failed.map((r) => `<li><strong>${esc(plan.selected.find((c) => c.id === r.id)?.titleRaw || "商品")}</strong><p>${esc(r.error)}</p>${button("核对该件", () => showSourceEvidence(r.id))}</li>`).join("")}</ul>`,
    );
}
function resumeBulk(
  plan: PendingBulk,
  storage: string,
  after: () => Promise<void>,
) {
  form(
    "继续上次批量处理",
    note(
      `共${plan.selected.length}件，已收到${Object.values(plan.completed).reduce((n, r) => n + r.rows.length, 0)}件处理结果。保留上次已确认的内容，继续原提交。`,
    ),
    () => runBulk(plan, storage),
    "继续处理",
    () => finishBulk(plan, storage, after),
  );
  dialog.querySelector("footer")!.insertAdjacentHTML(
    "afterbegin",
    button("结束本次尝试", async () => {
      if (
        !confirm(
          "已完成的商品和服务器记录会保留。结束后请核对本批实际结果再重新选择，确认结束？",
        )
      )
        return;
      await saveWork(storage, undefined);
      dialog.close();
      await after();
    }),
  );
}
function reviewCandidateSelection() {
  const rows = [...candidateSelection.values()],
    bySource = new Map<string, number>();
  for (const candidate of rows)
    bySource.set(
      candidate.procurementSource.name,
      (bySource.get(candidate.procurementSource.name) || 0) + 1,
    );
  const duplicates = rows.filter((x) => x.possibleDuplicateCount > 0).length,
    gaps = rows.filter((x) => x.integrity?.state === "GAPS").length,
    warnings = rows.filter((x) => x.warnings.length).length;
  viewDialog(
    `已选候选 · ${rows.length}件`,
    `<div class="candidate-selection-summary"><p><strong>来源</strong></p>${[
      ...bySource.entries(),
    ]
      .map(([name, count]) => `<p>${esc(name)} · ${count}件</p>`)
      .join(
        "",
      )}<p><strong>需要特别核对</strong></p><p>疑似重复 ${duplicates}件 · 来源有缺项 ${gaps}件 · 其他系统提示 ${warnings}件</p></div><details><summary>查看全部已选商品</summary><ol>${rows
      .map(
        (candidate) =>
          `<li>${esc(candidate.procurementSource.name)} · ${esc(candidate.brandRaw || "品牌待确认")} · ${esc(candidate.titleRaw)}</li>`,
      )
      .join("")}</ol></details>`,
  );
}
async function bulkAction(
  ids: string[],
  after: () => Promise<void>,
  exclude = false,
) {
  const storage = `candidate-bulk:${me!.id}`,
    pending = await readWork<PendingBulk>(storage);
  if (pending) return resumeBulk(pending, storage, after);
  const selected = ids.map((id) => candidateSelection.get(id)!).filter(Boolean),
    versions = Object.fromEntries(selected.map((c) => [c.id, c.version]));
  const gaps = selected.filter(
    (c) => c.integrity.state === "GAPS" && !c.integrity.blockers.length,
  );
  let plan: PendingBulk | undefined;
  form(
    exclude ? `批量排除 · ${ids.length}件` : `批量生成TM · ${ids.length}件`,
    note(
      exclude
        ? "排除不删除来源资料。"
        : "确认实物在手并纳入经营后生成永久TM。是否立即可售需要另行确认，默认先待整理；逐件保留结果，中断后可继续。",
    ) +
      (exclude
        ? area("reason", "排除原因", "", 3)
        : select(
            "status",
            "生成TM后的状态",
            {
              PAUSED: "待整理 / 待复核（推荐）",
              AVAILABLE: "已完成核对，直接可售",
            },
            "PAUSED",
          ) +
          check("confirmed", "我已确认所选商品为实际持有并应纳入经营") +
          (gaps.length
            ? `<section class="bulk-gap-review"><h3>${gaps.length} 件有来源缺项</h3>${gaps.map((c) => `<p><strong>${esc(c.titleRaw)}</strong><small>${c.integrity.issues.map(esc).join("；")}</small></p>`).join("")}${check("acceptGaps", "我已核对上述缺项，允许先建档并保留逐件说明")}${area("gapNote", "本批缺项处理依据", "", 2)}</section>`
            : "")),
    async (d, key) => {
      if (!exclude && !d.has("confirmed"))
        throw new Error("请先确认实物和经营去向");
      const gapNote = text(d, "gapNote").trim();
      if (d.has("acceptGaps") && gapNote.length < 3)
        throw new Error("请填写缺项核对依据，至少3个字");
      const next: PendingBulk = {
        key,
        exclude,
        selected,
        completed: {},
        body: {
          ids,
          versions,
          ...(exclude
            ? { reason: text(d, "reason") }
            : {
                possession: "IN_HAND",
                status: text(d, "status") || "PAUSED",
                ...(d.has("acceptGaps")
                  ? {
                      incompleteAcknowledgements: Object.fromEntries(
                        gaps.map((c) => [
                          c.id,
                          (
                            gapNote +
                            "；来源缺项：" +
                            c.integrity.issues.join("；")
                          ).slice(0, 2000),
                        ]),
                      ),
                    }
                  : {}),
              }),
        },
      };
      if (plan && JSON.stringify(plan.body) !== JSON.stringify(next.body))
        throw new Error(
          "上次批量处理仍需核对。请关闭后继续上次处理，或结束该次尝试，再修改内容。",
        );
      plan ??= next;
      return runBulk(plan, storage);
    },
    exclude ? "确认排除" : "确认生成TM",
    () => finishBulk(plan!, storage, after),
  );
}
function bulkConfirm(ids: string[], after: () => Promise<void>) {
  return bulkAction(ids, after);
}
function bulkExclude(ids: string[], after: () => Promise<void>) {
  return bulkAction(ids, after, true);
}
async function candidateLink(candidate: Candidate, after: () => Promise<void>) {
  const matches = await request<CandidateMatch[]>(
    `/ingest/candidates/${candidate.id}/matches`,
  );
  const suggested = matches.length
      ? `<div class="candidate-match-list"><strong>系统发现可能的已有TM</strong>${matches
          .map(
            (m, index) =>
              `<label class="candidate-match-choice"><input type="radio" name="matchedItemRef" value="${esc(m.code)}" ${index === 0 ? "checked" : ""}><span><b>${esc(m.code)} · ${esc(m.brand || "品牌待补")} · ${esc(m.title)}</b><small>${m.reasons.map(esc).join("；")}</small></span></label>`,
          )
          .join("")}</div>`
      : note(
          "当前没有找到强匹配；如果你已知这就是某件已有商品，可直接填写TM编号。",
        ),
    fallback = field(
      "itemRef",
      matches.length ? "搜索其他TM编号（可选）" : "已有TM编号",
      "",
      "text",
      !matches.length,
      'placeholder="例如 TM000123"',
    );
  form(
    "关联已有TM",
    note(
      "此操作不会修改已有TM的库存、成色、售价或已维护资料，只把这条来源证据归入同一件实物。",
    ) +
      suggested +
      fallback +
      select(
        "possession",
        "本来源对应实物状态",
        { IN_HAND: "已确认实物在手", NOT_IN_HAND: "不以本来源判断在手" },
        "IN_HAND",
      ) +
      area(
        "note",
        "关联依据",
        matches.length ? matches[0].reasons.join("；") : "",
        3,
      ) +
      check("confirmed", "我已核对，确认这是同一件实物，不新建第二个TM"),
    (d, key) => {
      if (!d.has("confirmed")) throw new Error("请先确认这是同一件实物");
      const itemRef =
        text(d, "itemRef").trim() || text(d, "matchedItemRef").trim();
      if (!itemRef) throw new Error("请选择匹配商品或填写TM编号");
      return request(
        `/ingest/candidates/${candidate.id}/link-item`,
        "POST",
        {
          version: candidate.version,
          itemRef,
          possession: text(d, "possession"),
          note: text(d, "note"),
        },
        key,
      );
    },
    "确认关联",
    async () => {
      candidateSelection.delete(candidate.id);
      await after();
    },
  );
}
function candidateConfirmNew(candidate: Candidate, after: () => Promise<void>) {
  const duplicate = candidate.possibleDuplicateCount > 0;
  const incomplete = candidate.integrity?.state === "GAPS";
  form(
    "确认生成新TM",
    note(
      duplicate
        ? `系统发现来源图片与 ${candidate.possibleDuplicateCount} 件已有TM完全相同。只有确认是另一件实物时才应继续新建。`
        : "确认该候选对应一件新的实际经营实物，系统将生成永久TM编号。",
    ) +
      check("confirmed", "我已确认实物在手并应纳入经营") +
      select(
        "status",
        "生成TM后的状态",
        {
          PAUSED: "待整理 / 待复核（推荐）",
          AVAILABLE: "已完成核对，直接可售",
        },
        "PAUSED",
      ) +
      (incomplete
        ? note(candidate.integrity.issues.join("；")) +
          check("acceptIncomplete", "我已核对来源缺项，接受先建档后补充")
        : "") +
      (duplicate
        ? check(
            "duplicateOverride",
            "我已核对：虽然图片相同，但这是另一件独立实物",
          )
        : "") +
      area(
        "note",
        "确认说明",
        duplicate ? "已人工核对同图但不是同一件实物" : "单件确认导入",
        2,
      ),
    (d, key) => {
      if (!d.has("confirmed")) throw new Error("请先确认实物和经营去向");
      if (duplicate && !d.has("duplicateOverride"))
        throw new Error("请先核对重复提示；同一件实物应使用“关联已有TM”");
      return request(
        `/ingest/candidates/${candidate.id}/confirm`,
        "POST",
        {
          version: candidate.version,
          possession: "IN_HAND",
          status: text(d, "status") || "PAUSED",
          duplicateOverride: d.has("duplicateOverride"),
          acceptIncomplete: d.has("acceptIncomplete"),
          note: text(d, "note"),
        },
        key,
      );
    },
    "确认生成新TM",
    async () => {
      candidateSelection.delete(candidate.id);
      await after();
    },
  );
}
function candidateProcess(candidate: Candidate, after: () => Promise<void>) {
  const duplicate = candidate.possibleDuplicateCount > 0;
  viewDialog(
    duplicate ? "核对疑似重复商品" : "单件处理",
    note(
      duplicate
        ? `系统发现 ${candidate.possibleDuplicateCount} 件已有TM与本候选来源图完全相同。先判断是不是同一件实物，再决定关联还是新建。`
        : "批量确认是主流程。这里只处理需要单独判断的候选，例如关联已有TM、单件新建或调整本地字段。",
    ) +
      `<div class="candidate-process-actions">${button(
        duplicate ? "核对并关联已有TM" : "关联已有TM",
        () => candidateLink(candidate, after),
        duplicate ? "primary" : "",
      )}${button("确认这是另一件并新建TM", () => candidateConfirmNew(candidate, after))}${button(
        "调整本地字段",
        () => candidateEdit(candidate, after),
        "subtle",
      )}${button("查看来源事实", () => candidateDetails(candidate), "subtle")}</div>`,
  );
}
function candidateActions(candidate: Candidate, after: () => Promise<void>) {
  if (candidate.item)
    return `<a class="btn" href="#/items/${candidate.item.id}?returnTo=${encodeURIComponent(location.hash)}">查看 ${esc(tm(candidate.item.serial))}</a>`;
  if (candidate.decision === "EXCLUDED")
    return button("重新核对", () => candidateEdit(candidate, after));
  const duplicate = candidate.possibleDuplicateCount > 0;
  return button(
    duplicate ? "核对重复" : "单件处理",
    () => candidateProcess(candidate, after),
    duplicate ? "primary" : "subtle",
  );
}
function selectableCandidate(candidate: Candidate) {
  const decision =
    new URLSearchParams(location.hash.split("?")[1] || "").get("decision") ??
    "PENDING";
  return (
    can("edit") && decision === "PENDING" && candidate.decision === "PENDING"
  );
}
function candidateCard(candidate: Candidate, after: () => Promise<void>) {
  const proposal = proposalOf(candidate),
    title = String(proposal.title || candidate.titleRaw),
    brand = String(proposal.brandLabel || candidate.brandRaw || "品牌待确认"),
    category = categoryName(proposal.category),
    warningParts = [
      ...(candidate.possibleDuplicateCount > 0
        ? [`发现 ${candidate.possibleDuplicateCount} 件疑似同一实物的已有TM`]
        : []),
      ...candidate.warnings,
      ...(candidate.integrity?.issues || []),
    ],
    warning = warningParts.length
      ? `<div class="candidate-warning">${warningParts.map((x) => `<span>${esc(x)}</span>`).join("")}</div>`
      : "";
  return `<article class="candidate-card" data-candidate="${candidate.id}">
    <label class="candidate-pick" ${selectableCandidate(candidate) ? "" : "hidden"}><input type="checkbox" data-pick="${candidate.id}" ${selectableCandidate(candidate) ? "" : "disabled"} aria-label="选择 ${esc(title)}"></label>
    <div class="candidate-photo">${button("查看图片与资料", () => candidateDetails(candidate), "candidate-evidence-open")}${candidatePhoto(candidate)}<span>${esc(candidate.procurementSource.name)}</span></div>
    <div class="candidate-info"><span class="status-pill">${esc(decisionNames[candidate.decision] || "待确认")}</span><small>${esc(candidate.sourceItemKey || candidate.batch.agentName)} · ${esc(integrityLabel(candidate.integrity))} · ${candidate.assets.length}张</small><h3>${esc(brand)} · ${esc(title)}</h3><p>${esc(category)}${candidate.conditionRaw ? ` · 来源成色 ${esc(candidate.conditionRaw)}` : ""}${candidate.statusRaw ? ` · 来源状态 ${esc(candidate.statusRaw)}` : ""}</p>${candidate.decision === "CONFIRMED" && warning ? `<details class="candidate-history-note"><summary>导入时提示</summary>${warning}</details>` : warning}</div>
    <div class="candidate-prices"><span>订单行 ${esc(money(candidate.sourceLineAmount, candidate.currency))}</span><span>平台现价 ${esc(money(candidate.sourceCurrentPrice, candidate.currency))}</span></div>
    <div class="candidate-actions">${candidateActions(candidate, after)}</div>
  </article>`;
}
function candidateTable(candidates: Candidate[], after: () => Promise<void>) {
  return `<div class="table-wrap candidate-table"><table><thead><tr><th>选择</th><th>商品</th><th>来源事实</th><th>价格</th><th>系统提示</th><th></th></tr></thead><tbody>${candidates
    .map((candidate) => {
      const proposal = proposalOf(candidate),
        title = String(proposal.title || candidate.titleRaw),
        brand = String(
          proposal.brandLabel || candidate.brandRaw || "品牌待确认",
        );
      return `<tr><td><input ${selectableCandidate(candidate) ? "" : "hidden"} type="checkbox" data-pick="${candidate.id}" ${selectableCandidate(candidate) ? "" : "disabled"} aria-label="选择 ${esc(title)}"></td><td><div class="table-product"><div class="candidate-thumb">${candidatePhoto(candidate)}</div>${button("查看资料", () => candidateDetails(candidate), "subtle")}<div><strong>${esc(brand)} · ${esc(title)}</strong><small>${esc(candidate.sourceItemKey || "无原货号")} · ${esc(candidate.procurementSource.name)}</small></div></div></td><td>${esc(candidate.conditionRaw || "来源成色未记录")}<small>${esc(candidate.statusRaw || "来源状态未记录")}</small></td><td>${esc(money(candidate.sourceLineAmount, candidate.currency))}<small>平台现价 ${esc(money(candidate.sourceCurrentPrice, candidate.currency))}</small></td><td>${candidate.decision === "CONFIRMED" ? "<small>导入时提示，以TM维护资料为准</small>" : ""}${candidate.possibleDuplicateCount > 0 ? `<small class="warn-text">发现 ${candidate.possibleDuplicateCount} 件疑似已有TM</small>` : ""}${candidate.warnings.length ? candidate.warnings.map((x) => `<small class="warn-text">${esc(x)}</small>`).join("") : candidate.possibleDuplicateCount > 0 ? "" : "无"}</td><td><span class="status-pill">${esc(decisionNames[candidate.decision] || "待确认")}</span><div class="button-row compact">${candidateActions(candidate, after)}</div></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
export async function candidatesPage() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""),
    q = qs.get("q") || "",
    decision = qs.get("decision") ?? "PENDING",
    sourceId = qs.get("sourceId") || "",
    batchId = qs.get("batchId") || "",
    view = qs.get("view") || "cards",
    page = Math.max(1, Number(qs.get("page") || 1));
  const params = new URLSearchParams({
    q,
    decision,
    sourceId,
    batchId,
    page: String(page),
    size: "100",
  });
  const [data, sources] = await Promise.all([
    request<CandidateResult>(`/ingest/candidates?${params}`),
    request<Source[]>("/procurement/sources"),
  ]);
  const root = "candidates-" + crypto.randomUUID(),
    selected = rememberSelection(
      JSON.stringify({ q, decision, sourceId, batchId }),
    );
  const sourceOptions = {
    "": "全部来源",
    ...Object.fromEntries(sources.map((x) => [x.id, x.name])),
  };
  const decisionOptions = {
    PENDING: "待确认",
    CONFIRMED: "已归入TM",
    EXCLUDED: "已排除",
    "": "全部",
  };
  const refresh = async () => {
    if (page > 1) {
      const next = new URLSearchParams(qs);
      next.delete("page");
      history.replaceState(null, "", "#/candidates?" + next);
    }
    await reload();
  };
  const scopedHref = (status = decision) => {
    const next = new URLSearchParams({ view, decision: status });
    if (batchId) next.set("batchId", batchId);
    const back = qs.get("returnTo");
    if (back && /^#\/imports(?:\?|$)/.test(back)) next.set("returnTo", back);
    return "#/candidates?" + esc(next.toString());
  };
  const body = !data.rows.length
    ? `<div class="empty panel"><h2>${q || sourceId ? "没有符合条件的商品" : decision === "PENDING" ? "当前没有待确认商品" : "当前没有这类商品"}</h2><p>${q || sourceId ? "试试更换关键词、来源或状态。" : "已确认的商品可以直接在商品库继续维护；新导入的资料会出现在这里。"}</p><div class="button-row">${q || sourceId ? `<a class="btn" href="${scopedHref()}">清除筛选</a>` : ""}<a class="btn" href="#/items">进入商品库</a>${decision === "PENDING" ? `<a class="btn" href="${scopedHref("CONFIRMED")}">查看已归入TM</a>` : ""}</div></div>`
    : view === "table"
      ? candidateTable(data.rows, refresh)
      : `<div class="candidate-grid">${data.rows.map((x) => candidateCard(x, refresh)).join("")}</div>`;
  const start = data.total ? (data.page - 1) * data.size + 1 : 0,
    end = Math.min(data.total, data.page * data.size);
  const returnTo = qs.get("returnTo") || "";
  const importReturn = /^#\/imports(?:\?|$)/.test(returnTo)
    ? returnTo
    : "#/imports";
  const recoveryKey = `candidate-bulk:${me!.id}`;
  const pending = await readWork<PendingBulk>(recoveryKey);
  const html = `<div id="${root}" class="candidate-page">
    <a class="btn subtle" href="${esc(importReturn)}">← 返回导入记录</a>
    ${pending ? `<div class="panel recovery-notice"><strong>上次批量处理尚未核对完成 · ${pending.selected.length} 件</strong>${button("继续上次处理", () => resumeBulk(pending, recoveryKey, refresh), "primary")}</div>` : ""}
    <div class="page-title"><div><h1>${decision === "PENDING" ? "待确认商品" : batchId ? "本批商品" : "导入商品记录"}</h1><p>${batchId ? "仅显示本批次商品；再次导入后的最新资料仍需核对。" : "外部工具导入后先到这里，批量核对后归入商品库。"}</p></div><div class="button-row">${can("supply") ? button("导入检查", () => importChecks(sourceId)) + button("Agent接入", () => agentAccess(sources)) : ""}<a class="btn" href="#/procurement">采购历史</a></div></div>
    <div class="candidate-metrics"><div><span>当前结果</span><strong>${data.total}</strong><small>${esc(decisionNames[decision] || "全部")}</small></div><div><span>本页</span><strong>${data.rows.length}</strong><small>${start}—${end}</small></div><div><span>处理方式</span><strong>批量优先</strong><small>异常件再单独调整</small></div></div>
    <form id="candidate-filter" class="admin-filter-form"><label class="search-field"><span>搜索候选</span><input name="q" value="${esc(q)}" placeholder="品牌、名称、原货号"></label>${select("sourceId", "来源", sourceOptions, sourceId)}${select("decision", "状态", decisionOptions, decision)}<button class="btn primary">筛选</button><a class="btn" href="${scopedHref()}">重置</a></form>
    <div class="candidate-viewbar"><label ${decision === "PENDING" && can("edit") ? "" : "hidden"}><input type="checkbox" id="select-candidate-page"> 选择本页</label><div><a class="btn ${view === "cards" ? "primary" : ""}" href="#/candidates?${new URLSearchParams({ ...Object.fromEntries(qs), view: "cards" })}">图片模式</a><a class="btn ${view === "table" ? "primary" : ""}" href="#/candidates?${new URLSearchParams({ ...Object.fromEntries(qs), view: "table" })}">表格模式</a></div></div>
    ${decision === "CONFIRMED" ? '<p class="note">这些商品已归入TM。后续文案、成色和库存请进入对应商品维护，下方保留导入时的来源记录。</p>' : ""}<div id="candidate-bulk" class="bulk-toolbar" hidden></div>${body}
    <div class="pagination"><span>共${data.total}件 · 每页100件</span>${page > 1 ? `<a class="btn" href="#/candidates?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page - 1) })}">上一页</a>` : ""}${page * data.size < data.total ? `<a class="btn" href="#/candidates?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page + 1) })}">下一页</a>` : ""}</div>
  </div>`;
  onPageReady(root, (el, signal) => {
    if (qs.get("access") === "1" && can("supply"))
      void agentAccess(sources).catch((e) => toast(e.message, true));
    const toolbar = el.querySelector<HTMLElement>("#candidate-bulk")!,
      boxes = () =>
        Array.from(
          el.querySelectorAll<HTMLInputElement>("[data-pick]:not(:disabled)"),
        ),
      pageSelect = el.querySelector<HTMLInputElement>(
        "#select-candidate-page",
      )!;
    const paint = () => {
      for (const box of boxes()) box.checked = selected.has(box.dataset.pick!);
      const checked = boxes().filter((x) => x.checked).length;
      pageSelect.disabled = boxes().length === 0;
      pageSelect.checked = boxes().length > 0 && checked === boxes().length;
      pageSelect.indeterminate = checked > 0 && checked < boxes().length;
      toolbar.hidden = selected.size === 0;
      if (!selected.size) return;
      toolbar.innerHTML = `<span>已选 ${selected.size} 件 · 可跨页选择</span>${button("查看已选", reviewCandidateSelection)}${decision === "PENDING" && can("edit") ? button("批量生成TM", () => bulkConfirm([...selected.keys()], refresh), "primary") + button("批量排除", () => bulkExclude([...selected.keys()], refresh), "danger") : ""}${button(
        "取消选择",
        () => {
          selected.clear();
          paint();
        },
      )}`;
    };
    el.addEventListener(
      "change",
      (event) => {
        const target = event.target as HTMLInputElement;
        if (target.dataset.pick) {
          if (target.checked) {
            if (selected.size >= 1000) {
              target.checked = false;
              toast("每次最多选择1000件", true);
              return;
            }
            selected.set(
              target.dataset.pick,
              data.rows.find((c) => c.id === target.dataset.pick)!,
            );
          } else selected.delete(target.dataset.pick);
          paint();
        }
      },
      { signal },
    );
    pageSelect.addEventListener(
      "change",
      () => {
        for (const box of boxes()) {
          if (pageSelect.checked) {
            if (!selected.has(box.dataset.pick!) && selected.size >= 1000) {
              toast("每次最多选择1000件", true);
              break;
            }
            if (!selected.has(box.dataset.pick!))
              selected.set(
                box.dataset.pick!,
                data.rows.find((c) => c.id === box.dataset.pick)!,
              );
          } else selected.delete(box.dataset.pick!);
        }
        paint();
      },
      { signal },
    );
    el.querySelector<HTMLFormElement>("#candidate-filter")!.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const d = new FormData(event.currentTarget as HTMLFormElement),
          next = new URLSearchParams();
        const values = {
          q: text(d, "q"),
          sourceId: text(d, "sourceId"),
          batchId,
          decision: text(d, "decision"),
          returnTo: /^#\/imports(?:\?|$)/.test(returnTo) ? returnTo : "",
        };
        for (const [key, value] of Object.entries(values))
          if (key === "decision" ? value !== "PENDING" : !!value)
            next.set(key, value);
        if (view !== "cards") next.set("view", view);
        const hash = "#/candidates" + (next.toString() ? "?" + next : "");
        if (location.hash === hash) void reload();
        else location.hash = hash;
      },
      { signal },
    );
    paint();
  });
  return html;
}

async function importChecks(sourceId: string) {
  const batches = await request<
    {
      id: string;
      externalBatchKey: string;
      status: string;
      _count: { candidates: number };
    }[]
  >(
    `/ingest/batches${sourceId ? "?sourceId=" + encodeURIComponent(sourceId) : ""}`,
  );
  viewDialog(
    "导入检查",
    `<p>最近100个批次；检查以外部工具提交的预期商品与图片清单为依据。</p>${
      batches
        .map(
          (b) =>
            `<article class="import-check-row"><strong>${esc(b.externalBatchKey)}</strong><span>${b._count.candidates}件 · ${b.status === "SEALED" ? "已封存" : "接收中"}</span>${button(
              "查看检查结果",
              async () => {
                const r = await request<{
                  state: string;
                  expectedCount: number | null;
                  receivedCount: number;
                  blockers: string[];
                  rows: ({ id: string; title: string } & CaptureIntegrity)[];
                }>(`/ingest/batches/${b.id}/integrity`);
                viewDialog(
                  "批次完整性检查",
                  `<p>预期${r.expectedCount ?? "未声明"}件 / 已收到${r.receivedCount}件</p>${r.blockers.length ? `<ul>${r.blockers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${r.rows.map((c) => `<article class="import-check-row"><strong>${esc(c.title)}</strong><span>${esc(integrityLabel(c))} · 已存${c.storedImages}张 / 预期${c.expectedImages ?? "未声明"}张</span>${button("查看图片与资料", () => showSourceEvidence(c.id))}</article>`).join("")}`,
                );
              },
            )}</article>`,
        )
        .join("") || "<p>尚无导入批次</p>"
    }`,
  );
}
