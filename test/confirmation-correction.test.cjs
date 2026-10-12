const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  correctionContract,
} = require("../dist/ingest/confirmation-correction");
const dependencyKeys = [
  "sales",
  "costEntries",
  "reservations",
  "observations",
  "inquiries",
  "movements",
  "listings",
  "distributionTargets",
  "distributionAttempts",
  "publishingDrafts",
  "packages",
  "materialExports",
  "offers",
  "intents",
  "tasks",
  "suggestions",
  "waivers",
  "channelPrices",
  "aliases",
  "collectionEntries",
  "purchaseConfirmations",
  "orderCostBasis",
  "orderItemCosts",
  "purchaseReturns",
];
function evidence() {
  return {
    candidate: {
      id: "candidate",
      version: 2,
      decision: "CONFIRMED",
      itemId: "item",
      sourceId: "source",
      purchaseLineId: null,
    },
    item: {
      id: "item",
      version: 1,
      serial: 1,
      sourceId: "source",
      deleted: false,
      dataMode: "BUSINESS",
      status: "PAUSED",
      cycle: 1,
    },
    receipts: [
      {
        id: "original",
        operation: "ingest.candidate.confirm",
        response: {
          id: "candidate",
          itemId: "item",
          code: "TM000001",
          version: 2,
          existing: false,
        },
      },
    ],
    singleSource: true,
    singleCandidate: true,
    singlePurchase: true,
    purchaseLine: null,
    dependencies: Object.fromEntries(dependencyKeys.map((key) => [key, 0])),
  };
}
test("review-only correction keeps original identity and proposes joint paused restore without permitting execution", () => {
  const e = evidence(),
    before = structuredClone(e),
    r = correctionContract(e);
  assert.equal(r.candidateEligible, true);
  assert.equal(r.executionAvailable, false);
  assert.equal(r.mode, "REVIEW_ONLY");
  assert.equal(r.originalConfirmationReceiptId, "original");
  assert.equal(r.proposedTransition.item.preserveSerial, true);
  assert.equal(r.proposedTransition.item.preserveOriginalFiles, true);
  assert.equal(r.proposedTransition.candidate.preserveItemId, true);
  assert.equal(r.proposedTransition.restore.sameItem, true);
  assert.equal(r.proposedTransition.restore.status, "PAUSED");
  assert.equal(r.proposedTransition.restore.approvedValid, false);
  assert.equal(r.proposedTransition.restore.automaticallyPublish, false);
  assert.deepEqual(e, before);
});
test("existing, missing, mismatched or duplicate creation proof cannot authorize correction", () => {
  for (const mutate of [
    (e) => {
      e.receipts = [];
    },
    (e) => {
      e.receipts[0].operation = "ingest.candidate.linkItem";
    },
    (e) => {
      e.receipts[0].response.existing = true;
    },
    (e) => {
      e.receipts[0].response.itemId = "other";
    },
    (e) => {
      e.receipts[0].response.code = "TM000002";
    },
    (e) => {
      e.receipts.push(structuredClone(e.receipts[0]));
    },
  ]) {
    const e = evidence();
    mutate(e);
    const r = correctionContract(e);
    assert.equal(r.candidateEligible, false);
    assert.equal(r.proposedTransition, null);
    assert.ok(r.blockers.some((b) => b.code === "CREATION_PROOF_MISSING"));
  }
});
test("every downstream or whole-order financial dependency and an incomplete check fail closed", () => {
  for (const key of dependencyKeys)
    for (const value of [1, undefined, -1, NaN]) {
      const e = evidence();
      e.dependencies[key] = value;
      const r = correctionContract(e);
      assert.equal(r.candidateEligible, false, key);
      assert.equal(r.proposedTransition, null, key);
      assert.equal(r.executionAvailable, false);
    }
});
test("shared links, changed purchase decisions and protected lifecycle cannot be planned", () => {
  for (const mutate of [
    (e) => {
      e.singleSource = false;
    },
    (e) => {
      e.singleCandidate = false;
    },
    (e) => {
      e.singlePurchase = false;
    },
    (e) => {
      e.item.sourceId = "other";
    },
    (e) => {
      e.item.cycle = 2;
    },
    (e) => {
      e.item.status = "SOLD";
    },
    (e) => {
      e.item.deleted = true;
    },
    (e) => {
      e.item.dataMode = "TEST";
    },
    (e) => {
      e.candidate.purchaseLineId = "line";
      e.purchaseLine = {
        id: "line",
        version: 2,
        decision: "EXCLUDE",
        orderId: "order",
        orderVersion: 1,
      };
    },
  ]) {
    const e = evidence();
    mutate(e);
    const r = correctionContract(e);
    assert.equal(r.candidateEligible, false);
    assert.equal(r.proposedTransition, null);
  }
});
test("versions and dependency changes invalidate the read-only review digest", () => {
  const e = evidence(),
    old = correctionContract(e);
  e.item.version++;
  assert.notEqual(correctionContract(e).digest, old.digest);
  e.dependencies.sales++;
  assert.notEqual(correctionContract(e).digest, old.digest);
});
