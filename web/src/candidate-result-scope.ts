/** Page clamping and presentation changes must not hide this filter's receipts. */
export function candidateResultScope(hash: string) {
  const query = new URLSearchParams(hash.split("?")[1] || "");
  return JSON.stringify({
    q: query.get("q") || "",
    decision: query.get("decision") ?? "PENDING",
    sourceId: query.get("sourceId") || "",
    batchId: query.get("batchId") || "",
  });
}
