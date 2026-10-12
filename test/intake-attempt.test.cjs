const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto").webcrypto;
function loadFrontend(file, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(
    source,
    {
      exports,
      structuredClone,
      crypto,
      require: (name) => {
        if (!(name in imports))
          throw new Error("Unexpected runtime import: " + name);
        return imports[name];
      },
    },
    { filename: file },
  );
  return exports;
}
const writes = loadFrontend("web/src/write-attempt.ts");
const { QuickIntakeAttempt } = loadFrontend("web/src/quick-intake-attempt.ts", {
  "./write-attempt": writes,
});
const input = () => ({
  title: "Synthetic intake",
  brand: "",
  dictionary: {},
  category: "BAG",
  currentPrice: null,
  currency: "CNY",
  ownership: "OWN",
  facts: { conditionGrade: "" },
});
const fault = (status) =>
  Object.assign(new Error("synthetic failure"), { status });

test("known intake identity never creates again and field changes use its original version", async () => {
  const calls = [];
  let version = 1;
  const attempt = new QuickIntakeAttempt(async (path, method, body, key) => {
    calls.push({ path, method, body, key });
    return method === "POST"
      ? { id: "synthetic-item", code: "TM000001" }
      : { version: ++version };
  });
  const draft = input();
  await attempt.save(draft);
  draft.title = "Corrected after upload rejection";
  await attempt.save(draft);
  await attempt.save(draft);
  draft.currentPrice = 10000;
  await attempt.save(draft);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(calls[1].path, "/items/synthetic-item");
  assert.equal(calls[1].body.version, 1);
  assert.equal(calls[1].body.title, draft.title);
  assert.equal(calls[2].body.version, 2);
  assert.equal(attempt.identity.id, "synthetic-item");
});

test("lost creation receipt keeps its exact key and refuses changed creation facts", async () => {
  const calls = [];
  const attempt = new QuickIntakeAttempt(async (path, method, body, key) => {
    calls.push({ path, method, body, key });
    if (calls.length === 1) throw fault(0);
    return { id: "synthetic-item", code: "TM000002" };
  });
  await assert.rejects(attempt.save(input()));
  await assert.rejects(
    attempt.save({ ...input(), title: "different" }),
    /上次提交结果待确认/,
  );
  assert.equal(calls.length, 1);
  await attempt.save(input());
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(JSON.stringify(calls[0].body), JSON.stringify(calls[1].body));
});

test("lost update receipt retries the old version and advances only after its receipt", async () => {
  const calls = [];
  let lost = true;
  const attempt = new QuickIntakeAttempt(async (path, method, body, key) => {
    calls.push({ path, method, body, key });
    if (method === "POST") return { id: "synthetic-item", code: "TM000003" };
    if (lost) {
      lost = false;
      throw fault(0);
    }
    return { version: 2 };
  });
  await attempt.save(input());
  const changed = { ...input(), title: "Changed" };
  await assert.rejects(attempt.save(changed));
  await assert.rejects(
    attempt.save({ ...changed, title: "Different uncertain payload" }),
    /上次提交结果待确认/,
  );
  await attempt.save(changed);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].key, calls[2].key);
  assert.equal(calls[1].body.version, 1);
  assert.equal(calls[2].body.version, 1);
});

test("concurrent modification does not adopt a newer version or create a replacement item", async () => {
  const calls = [];
  const attempt = new QuickIntakeAttempt(async (path, method, body) => {
    calls.push({ path, method, body });
    if (method === "POST") return { id: "synthetic-item", code: "TM000004" };
    throw fault(409);
  });
  await attempt.save(input());
  const changed = { ...input(), title: "Changed" };
  await assert.rejects(attempt.save(changed));
  await assert.rejects(attempt.save(changed));
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(calls[2].body.version, 1);
  assert.equal(attempt.identity.id, "synthetic-item");
});

const { applyQuickDraft } = loadFrontend("web/src/quick-draft-transfer.ts");
test("draft transfer keeps untouched server facts and compares only operator changes against the old version", () => {
  const latest = {
    id: "synthetic-item",
    version: 2,
    title: "Server title",
    brand: "",
    category: "BAG",
    currency: "CNY",
    currentPrice: 60000,
    dictionary: {},
    facts: { conditionGrade: "", material: "New server material" },
  };
  const draft = {
    owner: "synthetic-owner",
    itemId: latest.id,
    base: {
      ...latest,
      version: 1,
      title: "Original title",
      currentPrice: 50000,
      conditionGrade: "",
    },
    fields: {
      title: "My title",
      category: "BAG",
      currency: "CNY",
      price: "500",
      dict_brand: "",
      dict_condition: "",
      brandText: "",
      conditionText: "",
    },
  };
  const result = applyQuickDraft(latest, draft);
  assert.equal(result.base.version, 1);
  assert.equal(result.base.title, "Original title");
  assert.equal(result.fields.title, "My title");
  assert.equal(result.base.currentPrice, 60000);
  assert.equal(result.base.facts.material, "New server material");
  assert.equal(result.fields.price, undefined);
});
test("unselected brand text transfers as text, never as a dictionary identity", () => {
  const latest = {
    id: "synthetic-item",
    version: 2,
    title: "Title",
    brand: "Server brand",
    category: "BAG",
    currency: "CNY",
    currentPrice: null,
    dictionary: { brand: "server-brand" },
    facts: { conditionGrade: "" },
  };
  const draft = {
    owner: "synthetic-owner",
    itemId: latest.id,
    base: {
      ...latest,
      version: 1,
      brand: "Original brand",
      dictionary: { brand: "original-brand" },
      conditionGrade: "",
    },
    fields: {
      title: "Title",
      category: "BAG",
      currency: "CNY",
      price: "",
      dict_brand: "",
      dict_condition: "",
      brandText: "Unselected input",
      conditionText: "",
    },
  };
  const result = applyQuickDraft(latest, draft);
  assert.equal(result.fields.dict_brand, "");
  assert.equal(result.fields.brandText, "Unselected input");
  assert.equal(result.base.dictionary.brand, "original-brand");
});
