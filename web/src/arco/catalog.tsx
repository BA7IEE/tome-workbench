import { useState, useEffect, useRef, useMemo } from "react";
import {
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Select,
  Table,
  Tag,
} from "@arco-design/web-react";
import { can, money, reload, toast, when } from "../core";
import {
  catalogContext,
  catalogFilterScope,
  rememberList,
  selectItem,
  saveListScroll,
} from "../catalog-context";
import { catalogBrand, catalogCondition } from "../item-source-facts";
import {
  dictionaryFilterField,
  readDictionarySelections,
} from "../dictionary-picker";
import { materialHistory } from "../materials";
import { quickIntake } from "../quick-intake";
import { quickEdit } from "../quick-edit";
import { deleteProduct } from "../recycle-bin";
import { catalogActions, type CatalogAction } from "../catalog-actions";
import { categories, states, type Item } from "../types";
import { ControllerSlot } from "./runtime";
import { TextField, SelectField, SelectionBox } from "./fields";
import { CatalogPagination } from "./catalog-pagination";

function Action({ action }: { action: CatalogAction }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type={action.primary ? "primary" : "default"}
      status={action.danger ? "danger" : "default"}
      loading={pending}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        try {
          await action.run();
        } catch (e) {
          toast((e as Error).message, true);
        } finally {
          setPending(false);
        }
      }}
    >
      {action.label}
    </Button>
  );
}
function RowMenu({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  const run = (action: () => unknown) => {
    setOpen(false);
    return action();
  };
  return (
    <Dropdown
      trigger="click"
      position="br"
      popupVisible={open}
      onVisibleChange={setOpen}
      getPopupContainer={() => document.body}
      triggerProps={{ autoAlignPopupWidth: false }}
      droplist={
        <div
          className="catalog-dropdown-actions arco-workspace"
          aria-label={`${item.code} 操作菜单`}
        >
          {can("edit") && (
            <Action
              action={{
                label: "快速修改",
                run: () => run(() => quickEdit(item, reload)),
              }}
            />
          )}
          {can("publish") && (
            <Button
              type="text"
              href={`#/items/${item.id}/edit?publish=1`}
              onClick={() => setOpen(false)}
            >
              准备发布
            </Button>
          )}
          {can("delete") && (
            <Action
              action={{
                label: "删除商品",
                danger: true,
                run: () => run(() => deleteProduct(item)),
              }}
            />
          )}
        </div>
      }
    >
      <Button
        ref={trigger}
        className="catalog-row-menu"
        type="text"
        aria-label={`${item.code} 更多操作`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        •••
      </Button>
    </Dropdown>
  );
}
const itemLink = (i: Item) => `#/items/${i.id}/${can("edit") ? "edit" : ""}`;
function Photo({ item }: { item: Item }) {
  return item.assets[0] ? (
    <img
      src={`/api/assets/${item.assets[0].id}/preview`}
      alt={item.title}
      loading="lazy"
    />
  ) : (
    <div className="product-no-image">
      <span>还没有图片</span>
    </div>
  );
}
function Status({ item: i }: { item: Item }) {
  return (
    <div className="tag-row">
      {i.dataMode === "TEST" && <Tag color="purple">测试</Tag>}
      <Tag color={i.status === "AVAILABLE" ? "green" : undefined}>
        {states[i.status]}
      </Tag>
      {!i.approvedValid && <Tag>待核资料</Tag>}
    </div>
  );
}
const quote = (i: Item) =>
  i.currentPrice == null ? "尚未报价" : money(i.currentPrice, i.currency);
function Price({ item: i }: { item: Item }) {
  return (
    <div className="catalog-price">
      <strong>{quote(i)}</strong>
      {i.currentCostCny !== undefined && (
        <small>成本 {money(i.currentCostCny, "CNY")}</small>
      )}
    </div>
  );
}
export function Catalog({
  data,
  qs,
  scope,
}: {
  data: { rows: Item[]; total: number; page: number; size: number };
  qs: URLSearchParams;
  scope: string;
}) {
  const [, update] = useState(0);
  const searchForm = useRef<HTMLFormElement>(null);
  const selected = catalogContext().selected;
  const { page, size } = data;
  const view = qs.get("view") || "table";
  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(qs);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    rememberList("#/items?" + next, scope, 0);
    if (location.hash === "#/items?" + next) void reload();
    else location.hash = "/items?" + next;
  };
  const resetFilters = () => {
    selected.clear();
    go(
      Object.fromEntries(
        [
          "q",
          "status",
          "category",
          "ownership",
          "review",
          "listing",
          "brandId",
          "conditionId",
          "colorId",
          "materialId",
          "sizeLabel",
          "location",
          "source",
          "missing",
          "page",
        ].map((k) => [k, ""]),
      ),
    );
  };
  const pick = (items: Item[], checked: boolean) => {
    try {
      for (const item of items) selectItem(item, checked);
    } catch (e) {
      toast((e as Error).message, true);
    }
    update((n) => n + 1);
  };
  const pickControl = (i: Item) => (
    <SelectionBox
      checked={selected.has(i.id)}
      onChange={(checked) => pick([i], checked)}
      label={`选择 ${i.code}`}
      pick={i.id}
    />
  );
  const applyFilters = (presentation: Record<string, string> = {}) => {
    const f = searchForm.current!,
      d = new FormData(f);
    try {
      const chosen = readDictionarySelections(f).dictionary;
      const changes = Object.fromEntries(
        [
          "dataMode",
          "q",
          "status",
          "category",
          "ownership",
          "review",
          "listing",
          "sizeLabel",
          "location",
          "source",
          "missing",
        ].map((k) => [k, String(d.get(k) || "")]),
      );
      const filters = {
        ...changes,
        brandId: chosen.brand || "",
        conditionId: chosen.condition || "",
        colorId: chosen.color || "",
        materialId: chosen.material || "",
      };
      const changed =
        catalogFilterScope(new URLSearchParams(filters)) !== scope;
      go({
        ...filters,
        ...presentation,
        page: changed ? "" : presentation.page || "",
      });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const statusChoices = Object.fromEntries(
    [
      "AVAILABLE",
      "PAUSED",
      "RESERVED",
      "SOLD",
      "SUPPLIER_SOLD",
      "GIFTED",
      "SELF_USE",
      "QUARANTINED",
    ].map((k) => [k, states[k]]),
  );
  const pageSelected = data.rows.filter((i) => selected.has(i.id)).length;
  const hasMore = [
    "ownership",
    "review",
    "listing",
    "brandId",
    "conditionId",
    "colorId",
    "materialId",
    "sizeLabel",
    "location",
    "source",
    "missing",
  ].some((k) => qs.get(k));
  const [expanded, setExpanded] = useState(hasMore);
  const dictionaryMarkup = useMemo(
    () =>
      (["BRAND", "CONDITION", "COLOR", "MATERIAL"] as const).map((kind) => ({
        kind,
        html: dictionaryFilterField(
          kind,
          qs.get(
            {
              BRAND: "brandId",
              CONDITION: "conditionId",
              COLOR: "colorId",
              MATERIAL: "materialId",
            }[kind],
          ) || undefined,
        ),
      })),
    [qs],
  );
  const actions = catalogActions(() => Array.from(selected.values()));
  return (
    <div
      onClick={(e) => {
        if ((e.target as Element).closest('a[href^="#/items/"]'))
          saveListScroll();
      }}
    >
      <div className="page-title">
        <div>
          <h1>商品</h1>
          {can("users") && (
            <nav className="catalog-scope-tabs" aria-label="商品数据范围">
              <a
                className={qs.get("dataMode") !== "TEST" ? "active" : ""}
                href="#/items?dataMode=BUSINESS"
              >
                正式商品
              </a>
              <a
                className={qs.get("dataMode") === "TEST" ? "active" : ""}
                href="#/items?dataMode=TEST"
              >
                测试商品
              </a>
            </nav>
          )}
        </div>
        <div className="button-row">
          {can("edit") && (
            <Action
              action={{
                label: "＋ 快速录货",
                primary: true,
                run: () => quickIntake(reload),
              }}
            />
          )}
          <Action action={{ label: "资料包与变化", run: materialHistory }} />
          {(can("edit") || can("supply") || can("delete")) && (
            <details className="page-actions-menu">
              <summary className="btn">更多</summary>
              <div>
                {can("edit") && <a href="#/items/new">完整建档</a>}
                {can("supply") && <a href="#/sources">从货源导入</a>}
                {can("delete") && <a href="#/trash">回收站</a>}
              </div>
            </details>
          )}
        </div>
      </div>
      <Card className="catalog-filter-card">
        <form
          ref={searchForm}
          id="catalog-search"
          className="catalog-filters admin-filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <input
            type="hidden"
            name="dataMode"
            value={qs.get("dataMode") || "BUSINESS"}
          />
          <label className="search-field">
            <span>搜索商品</span>
            <Input
              name="q"
              aria-label="搜索商品"
              placeholder="编号、旧编号、品牌或名称"
              defaultValue={qs.get("q") || ""}
            />
          </label>
          <SelectField
            name="status"
            label="库存状态"
            ariaLabel="商品状态"
            choices={{ "": "全部库存状态", ...statusChoices }}
            value={qs.get("status") || ""}
          />
          <SelectField
            name="category"
            label="商品品类"
            ariaLabel="筛选品类"
            choices={{ "": "全部品类", ...categories }}
            value={qs.get("category") || ""}
          />
          <div className="filter-actions">
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
            <Button onClick={resetFilters}>重置</Button>
            <Button
              type="text"
              aria-expanded={expanded}
              aria-controls="catalog-extra-filters"
              onClick={() => setExpanded(!expanded)}
            >
              <span>更多筛选</span>{" "}
              <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
            </Button>
          </div>
          <div
            id="catalog-extra-filters"
            className="extra-filters"
            hidden={!expanded}
          >
            <div className="library-find-grid">
              <TextField
                name="sizeLabel"
                label="尺码"
                value={qs.get("sizeLabel") || ""}
              />
              <TextField
                name="location"
                label="实物位置"
                value={qs.get("location") || ""}
              />
              <TextField
                name="source"
                label="来源名称"
                value={qs.get("source") || ""}
              />
              <SelectField
                name="missing"
                label="待补资料"
                choices={{
                  "": "全部资料",
                  images: "缺图片",
                  price: "缺售价",
                  size: "缺尺码",
                  description: "缺中文介绍",
                }}
                value={qs.get("missing") || ""}
              />
            </div>
            <div className="dictionary-filter-grid">
              {dictionaryMarkup.map(({ kind, html }) => (
                <ControllerSlot key={kind} html={html} />
              ))}
            </div>
            <div className="form-grid">
              <SelectField
                name="ownership"
                label="实物持有"
                choices={{
                  "": "全部实物持有",
                  OWN: "我方持有",
                  SUPPLIER: "供应商持有",
                }}
                value={qs.get("ownership") || ""}
              />
              <SelectField
                name="review"
                label="资料状态"
                choices={{
                  "": "全部资料状态",
                  pending: "待确认",
                  approved: "已有确认版本",
                }}
                value={qs.get("review") || ""}
              />
              <SelectField
                name="listing"
                label="发布记录"
                choices={{
                  "": "全部发布记录",
                  none: "暂无发布记录",
                  recorded: "有发布记录",
                }}
                value={qs.get("listing") || ""}
              />
            </div>
          </div>
        </form>
      </Card>
      <div className="catalog-results-toolbar">
        <div className="catalog-count">
          <SelectionBox
            label="选择本页"
            id="select-page"
            checked={data.rows.length > 0 && pageSelected === data.rows.length}
            mixed={pageSelected > 0 && pageSelected < data.rows.length}
            disabled={!data.rows.length}
            onChange={(checked) => pick(data.rows, checked)}
          >
            选择本页
          </SelectionBox>
          <span>
            共 {data.total} 件 · 第 {page} /{" "}
            {Math.max(1, Math.ceil(data.total / size))} 页
          </span>
        </div>
        <div className="catalog-display-controls">
          <div className="catalog-order">
            <span>排序</span>
            <Select
              aria-label="排序"
              value={qs.get("sort") || "newest"}
              options={[
                { value: "newest", label: "最新录入" },
                { value: "oldest", label: "最早录入" },
                { value: "updated", label: "最近更新" },
              ]}
              onChange={(value) => applyFilters({ sort: value })}
            />
          </div>
          <Button.Group className="view-switch">
            <Button
              type={view === "table" ? "secondary" : "default"}
              aria-pressed={view === "table"}
              onClick={() =>
                applyFilters({ view: "table", page: String(page) })
              }
            >
              列表
            </Button>
            <Button
              type={view === "grid" ? "secondary" : "default"}
              aria-pressed={view === "grid"}
              onClick={() => applyFilters({ view: "grid", page: String(page) })}
            >
              图片
            </Button>
          </Button.Group>
        </div>
      </div>
      <div id="bulk-toolbar" className="bulk-toolbar" hidden={!selected.size}>
        <div className="bulk-heading">
          <strong>已选 {selected.size} 件</strong>
          <small>跨页保留，最多100件</small>
          <Button
            type="text"
            onClick={() => {
              selected.clear();
              update((n) => n + 1);
            }}
          >
            取消选择
          </Button>
        </div>
        <div className="bulk-primary">
          {actions.slice(0, 3).map((a) => (
            <Action key={a.label} action={a} />
          ))}
          <details className="bulk-more">
            <summary className="btn">批量操作</summary>
            <div>
              {actions.slice(3).map((a) => (
                <Action key={a.label} action={a} />
              ))}
            </div>
          </details>
        </div>
      </div>
      {!data.rows.length ? (
        <div className="empty panel">
          <Empty
            description={
              <>
                <h2>没有找到商品</h2>
                <p>可以清除筛选条件，或从快速录货开始。</p>
              </>
            }
          />
          <Button onClick={resetFilters}>清除筛选</Button>
        </div>
      ) : view === "grid" ? (
        <div className="product-grid">
          {data.rows.map((i) => (
            <article
              className={`product-card${selected.has(i.id) ? " is-selected" : ""}`}
              key={i.id}
            >
              <div className="product-visual">
                <div className="product-check">{pickControl(i)}</div>
                <a href={itemLink(i)}>
                  <Photo item={i} />
                </a>
                <span className="product-number">{i.code}</span>
              </div>
              <div className="product-card-info">
                <div className="product-card-head">
                  <small>
                    {catalogBrand(i)} · {categories[i.category]}
                  </small>
                  <RowMenu item={i} />
                </div>
                <a className="product-name" href={itemLink(i)}>
                  {i.title}
                </a>
                <Status item={i} />
                <p className="product-reference-summary">
                  {catalogCondition(i)}
                  {i.facts.sizeLabel ? ` · 尺码 ${i.facts.sizeLabel}` : ""}
                </p>
                <div className="product-bottom">
                  <Price item={i} />
                  <span>
                    {i.ownership === "OWN" ? "我方持有" : "供应商持有"}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <Table<Item>
            rowKey="id"
            data={data.rows}
            pagination={false}
            border={false}
            scroll={{ x: 1240 }}
            rowClassName={(i) => (selected.has(i.id) ? "is-selected" : "")}
            columns={[
              { title: "选择", width: 58, render: (_, i) => pickControl(i) },
              {
                title: "商品",
                width: 320,
                render: (_, i) => (
                  <div className="table-product">
                    <a href={itemLink(i)} className="table-picture">
                      <Photo item={i} />
                    </a>
                    <div>
                      <a href={itemLink(i)}>{i.title}</a>
                      <small>
                        {i.code} · {catalogBrand(i)}
                      </small>
                    </div>
                  </div>
                ),
              },
              {
                title: "状态",
                width: 132,
                render: (_, i) => <Status item={i} />,
              },
              {
                title: "成色 / 尺码",
                width: 160,
                render: (_, i) => (
                  <>
                    {catalogCondition(i)}
                    <small>{i.facts.sizeLabel}</small>
                  </>
                ),
              },
              {
                title: "报价",
                width: 140,
                render: (_, i) => <Price item={i} />,
              },
              {
                title: "实物位置",
                width: 110,
                render: (_, i) => (
                  <>
                    {i.ownership === "OWN" ? "我方持有" : "供应商持有"}
                    <small>{i.location || "位置待补"}</small>
                  </>
                ),
              },
              {
                title: "图片 / 发布记录",
                width: 150,
                render: (_, i) => (
                  <>
                    {i._count?.assets ?? i.assets.length} 张图片
                    <small>{i._count?.listings || 0} 条发布记录</small>
                    <small>{i.updatedAt ? when(i.updatedAt) : ""}</small>
                  </>
                ),
              },
              {
                title: "操作",
                width: 64,
                fixed: "right",
                render: (_, i) => <RowMenu item={i} />,
              },
            ]}
          />
        </div>
      )}
      <CatalogPagination
        total={data.total}
        page={page}
        size={size}
        onChange={(nextPage, nextSize) =>
          applyFilters({ page: String(nextPage), size: String(nextSize) })
        }
      />
    </div>
  );
}
