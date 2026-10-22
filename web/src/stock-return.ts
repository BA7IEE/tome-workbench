import { request, form, area, check, note, text } from "./core";
import type { Sale } from "./types";

/** Uses the existing return permission. It never records payment or refund amounts. */
export async function receiveStockReturn(
  target: { saleId?: string; itemId?: string; cycle?: number; dataMode?: string },
  after?: () => Promise<void>,
) {
  const query = new URLSearchParams({ page: "1", size: "100",
    ...(target.saleId ? { id: target.saleId } : { itemId: target.itemId! }),
    ...(target.dataMode === "TEST" ? { dataMode: "TEST" } : {}) });
  const result = await request<{ rows: (Sale & { cycleNumber: number })[] }>("/sales?" + query);
  const sale = result.rows.find(row => !row.returned && !row.inventoryReturnedAt && (target.cycle == null || row.cycleNumber === target.cycle));
  if (!sale) throw new Error("未找到本次尚未回收的成交记录，请核对商品与成交记录");
  const unrecorded = sale.amount === null;
  form("确认实物退回",
    note("核对原商品、附件和实际持有情况。也可用于误标售出但实物仍在的更正。完成后进入待复检，不直接可售，不自动重新上架。") +
    note(unrecorded
      ? "未记账成交只确认实物回收，所有未知金额继续留空；不会代记收款或退款。"
      : "此笔已有账务记录，仍须满足原全额退款约束；这里不修改任何金额。") +
    area("evidence", "实物身份、附件、品相及退回或误标依据", "", 3) +
    check("intact", "已核对同件实物与附件，确认目前完整收回或仍由我方持有"),
    (data, key) => {
      if (!data.has("intact")) throw new Error("请先核对同件实物与附件");
      const evidence = text(data, "evidence").trim();
      if (!evidence) throw new Error("请填写退回或误标依据");
      return request("/sales/" + sale.id + (unrecorded ? "/receive-unrecorded-return" : "/return"),
        "POST", { ...(unrecorded ? { version: sale.version } : {}), intact: true, evidence }, key);
    }, "确认回收，进入待复检", after);
}
