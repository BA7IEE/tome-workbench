import {
  request,
  button,
  form,
  field,
  area,
  text,
  select,
  note,
  esc,
  table,
  section,
  when,
  itemLink,
  dialog,
} from "./core";
interface IntakeFile {
  id: string;
  originalName: string;
  hint: string;
  state: string;
  asset: { itemId: string } | null;
}
interface Batch {
  id: string;
  name: string;
  state: string;
  createdAt: string;
  _count?: { files: number };
  files: IntakeFile[];
}
export async function resolveCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^TM\d{6,}$/.test(code)) throw new Error("请输入完整TM编号");
  const result = await request<{ rows: { id: string; code: string }[] }>(
    "/items?q=" + encodeURIComponent(code),
  );
  const found = result.rows.find((i) => i.code === code);
  if (!found) throw new Error("找不到商品：" + code);
  return found.id;
}
export async function intakePage(id?: string): Promise<string> {
  if (!id) {
    const rows = await request<Batch[]>("/intake/batches");
    return section(
      "批量素材归档",
      note(
        "先按批次上传，再确认属于哪件商品；文件名里的TM号只作建议，不自动绑定，也不自动通过授权复核。",
      ) +
        table(
          ["批次", "文件数", "状态", "创建时间"],
          rows.map((r) => [
            `<a href="#/intake/${r.id}">${esc(r.name)}</a>`,
            String(r._count?.files || 0),
            r.state === "OPEN"
              ? "进行中"
              : r.state === "CLOSED"
                ? "已关闭"
                : esc(r.state),
            when(r.createdAt),
          ]),
        ),
      button(
        "创建批次",
        () =>
          form(
            "创建批次",
            field("name", "批次名称", "", "text", true),
            (d, k) =>
              request("/intake/batches", "POST", { name: text(d, "name") }, k),
          ),
        "primary",
      ),
    );
  }
  const b = await request<Batch>("/intake/batches/" + id);
  const upload = () =>
    form(
      "上传一批图片",
      note("每张最大20MB，最多100张。逐张上传可重试；只有实际成功才会入库。") +
        field(
          "files",
          "选择图片",
          "",
          "file",
          true,
          'accept="image/jpeg,image/png,image/webp" multiple',
        ),
      async (d, k) => {
        const files = d.getAll("files") as File[];
        if (files.length > 100) throw new Error("单次最多100张");
        for (const [index, file] of files.entries()) {
          const data = new FormData();
          data.set("file", file);
          await request(
            `/intake/batches/${id}/upload`,
            "POST",
            data,
            `${k}:${index}`,
          );
        }
      },
      "上传到待归属池",
    );
  const assign = (files: IntakeFile[]) =>
    form(
      "确认素材归属",
      note(
        files
          .map((f) => `${f.originalName} → ${f.hint || "请填编号"}`)
          .join("；"),
      ) +
        (files.length === 1
          ? field("code", "商品TM号", files[0].hint, "text", true) +
            field("findItem", "按名称或编号找商品") +
            button("查找商品", async () => {
              const q =
                dialog.querySelector<HTMLInputElement>(
                  "[name=findItem]",
                )!.value;
              const result = await request<{
                rows: {
                  id: string;
                  code: string;
                  title: string;
                  assets: { id: string }[];
                }[];
              }>("/items?q=" + encodeURIComponent(q));
              dialog.querySelector("[data-intake-matches]")!.innerHTML =
                result.rows
                  .map(
                    (i) =>
                      `<p>${i.assets[0] ? `<img class="record-thumb" src="/api/assets/${i.assets[0].id}/preview" alt="${esc(i.title)}">` : ""}${button(
                        i.code + " · " + i.title,
                        () => {
                          dialog.querySelector<HTMLInputElement>(
                            "[name=code]",
                          )!.value = i.code;
                          dialog.querySelector(
                            "[data-intake-matches]",
                          )!.innerHTML =
                            `已选择 ${esc(i.code)} · ${esc(i.title)}`;
                        },
                      )}</p>`,
                  )
                  .join("") || "没有匹配商品";
            }) +
            '<div class="full" data-intake-matches></div>'
          : note(
              "此操作仅处理本次显示的最多25张建议；请确认编号与实物一致。",
            )) +
        select(
          "origin",
          "资料来源",
          { OWN: "自己拍摄", SUPPLIER: "供应商授权资料" },
          "OWN",
        ) +
        area("sourceNote", "本次归档依据及来源", "", 2),
      async (d, k) => {
        const entries = [];
        for (const f of files)
          entries.push({
            fileId: f.id,
            itemId: await resolveCode(
              files.length === 1 ? text(d, "code") : f.hint,
            ),
            origin: text(d, "origin"),
            role: "PRODUCT",
            sourceNote: text(d, "sourceNote"),
          });
        return request(`/intake/batches/${id}/assign`, "POST", { entries }, k);
      },
      "确认归档",
    );
  const candidates = b.files
    .filter((f) => f.state === "UNASSIGNED" && f.hint)
    .slice(0, 25);
  const controls =
    b.state === "OPEN"
      ? button("批量上传图片", upload, "primary") +
        (candidates.length
          ? button("批量确认编号建议", () => assign(candidates))
          : "") +
        button("关闭批次", () =>
          form(
            "确认关闭批次",
            note("全部图片须已归档或记录不采用原因；关闭后不能继续追加图片。"),
            (_d, k) => request(`/intake/batches/${id}/close`, "POST", {}, k),
          ),
        )
      : "";
  return (
    `<p><a href="#/intake">← 所有素材批次</a></p>` +
    section(
      b.name,
      `<p data-batch-state="${esc(b.state)}">批次状态：${b.state === "CLOSED" ? "已关闭" : "进行中"}</p>` +
        note(
          "归档成功不等于实拍与授权已复核；系统保留原件，商品页仍须独立审核。",
        ) +
        table(
          ["图片", "原文件名 / 编号建议", "状态", "处理"],
          b.files.map((f) => [
            `<a href="/api/intake/files/${f.id}/original" target="_blank" rel="noopener" aria-label="查看原图 ${esc(f.originalName)}"><img width="70" height="70" class="intake-preview" src="/api/intake/files/${f.id}/preview" alt="待归档素材"></a>`,
            esc(f.originalName) +
              `<small>${esc(f.hint || "未识别编号")}</small>`,
            esc(
              (
                {
                  ASSIGNED: "已归档",
                  UNASSIGNED: "待归档",
                  IGNORED: "暂不采用",
                } as Record<string, string>
              )[f.state] || f.state,
            ),
            f.asset
              ? itemLink(f.asset.itemId, "查看商品")
              : f.state === "UNASSIGNED"
                ? button("确认归属", () => assign([f])) +
                  button("暂不采用", () =>
                    form(
                      "记录忽略原因",
                      area("reason", "原因", "", 2),
                      (d, k) =>
                        request(
                          `/intake/files/${f.id}/ignore`,
                          "POST",
                          { reason: text(d, "reason") },
                          k,
                        ),
                    ),
                  )
                : "—",
          ]),
        ),
      controls,
    )
  );
}
