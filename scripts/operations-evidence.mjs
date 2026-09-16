import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export const humanChecks = [
  "businessUat",
  "offHostBackupVerified",
  "recoveryDrillReviewed",
  "domainAndFirewallReviewed",
  "alertRecipientConfirmed",
];
export function pendingApprovals(dir, approval, now = Date.now()) {
  return humanChecks.filter((key) => {
    const evidence = approval.evidence?.[key];
    if (
      approval[key] !== true ||
      !evidence ||
      typeof evidence.file !== "string" ||
      !/^[a-f0-9]{64}$/.test(evidence.sha256 || "")
    )
      return true;
    const at = Date.parse(evidence.reviewedAt);
    if (!Number.isFinite(at) || at > now) return true;
    const root = fs.realpathSync(dir),
      file = path.resolve(root, evidence.file);
    if (!file.startsWith(root + path.sep)) return true;
    try {
      // realpath also rejects symlinked parent directories escaping the config root.
      if (fs.realpathSync(file) !== file || !fs.statSync(file).isFile())
        return true;
      const data = fs.readFileSync(file);
      return (
        !data.length ||
        createHash("sha256").update(data).digest("hex") !== evidence.sha256
      );
    } catch {
      return true;
    }
  });
}
