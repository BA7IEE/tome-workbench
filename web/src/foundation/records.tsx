import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactNode } from "react";
import {
  ProDescriptions,
  ProTable,
  type ProColumns,
} from "@ant-design/pro-components";
import { ToMeProvider } from "./provider";

/** Local data only: request, filters, sort, paging and selection stay domain-owned. */
export function RecordTable<T extends { id: string }>({
  data,
  columns,
  rowClassName,
}: {
  data: T[];
  columns: {
    title: string;
    width: number;
    fixed?: "right";
    render: (value: unknown, row: T) => ReactNode;
  }[];
  rowClassName: (row: T) => string;
  rowKey?: string;
  pagination?: false;
  border?: false;
  scroll?: { x: number };
}) {
  return (
    <ProTable<T>
      className="foundation-catalog-records"
      rowKey="id"
      dataSource={data}
      columns={
        columns.map((column, index) => ({
          ...column,
          key: `record-${index}`,
          search: false,
          onCell: () =>
            column.fixed === "right"
              ? { className: "foundation-record-action" }
              : {},
          onHeaderCell: () =>
            column.fixed === "right"
              ? { className: "foundation-record-action" }
              : {},
          render: (_value: ReactNode, row: T) => column.render(undefined, row),
        })) as ProColumns<T>[]
      }
      rowClassName={rowClassName}
      pagination={false}
      search={false}
      options={false}
      toolBarRender={false}
      cardProps={false}
      scroll={{ x: 1240 }}
      size="small"
      locale={{ emptyText: "没有找到记录" }}
    />
  );
}

/** Read-only facts; no fetcher, editing, transformation or permission inference. */
export function mountDescriptions(
  host: HTMLElement,
  rows: [string, unknown][],
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <ToMeProvider>
        <ProDescriptions
          column={{ xs: 1, sm: 2, md: 2 }}
          size="small"
          dataSource={{}}
          columns={rows.map(([title, value], index) => ({
            title,
            key: `fact-${index}`,
            render: () => String(value || "未填写"),
          }))}
        />
      </ToMeProvider>,
    ),
  );
  signal.addEventListener("abort", () => root.unmount(), { once: true });
}

/** Bridge existing presentation-only cells; never read or infer domain facts. */
export function mountRecordTables(container: HTMLElement, signal: AbortSignal) {
  if (signal.aborted) return;
  for (const table of container.querySelectorAll<HTMLTableElement>(
    "table[data-foundation-records]",
  )) {
    const heads = [...table.querySelectorAll("thead th")].map(
      (head) => head.textContent || "",
    );
    const rows = [...table.querySelectorAll("tbody tr")].map((row, index) => ({
      key: `display-${index}`,
      attributes: Object.fromEntries(
        [...row.attributes]
          .filter(
            ({ name }) =>
              name.startsWith("data-") ||
              name.startsWith("aria-") ||
              name === "id" ||
              name === "class",
          )
          .map(({ name, value }) => [
            name === "class" ? "className" : name,
            value,
          ]),
      ),
      cells: [...row.querySelectorAll("td")].map((cell) => cell.innerHTML),
    }));
    // Irregular/custom tables remain native instead of silently losing cells.
    if (!heads.length || rows.some((row) => row.cells.length !== heads.length))
      continue;
    const host = document.createElement("div");
    host.className = "record-table foundation-records";
    table.replaceWith(host);
    const root = createRoot(host);
    flushSync(() =>
      root.render(
        <ToMeProvider>
          <ProTable<(typeof rows)[number]>
            rowKey="key"
            dataSource={rows}
            onRow={(row) => row.attributes}
            columns={heads.map((title, column) => ({
              title,
              key: `display-column-${column}`,
              search: false,
              render: (_value, row) => (
                <div
                  className="foundation-record-cell"
                  dangerouslySetInnerHTML={{ __html: row.cells[column] }}
                />
              ),
            }))}
            pagination={false}
            search={false}
            options={false}
            toolBarRender={false}
            cardProps={false}
            size="small"
          />
        </ToMeProvider>,
      ),
    );
    signal.addEventListener("abort", () => root.unmount(), { once: true });
  }
}

/** Read-only definition lists already escaped by the existing domain renderer. */
export function mountReadOnlyDetails(
  container: HTMLElement,
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  for (const list of container.querySelectorAll<HTMLDListElement>(
    "dl.details",
  )) {
    if (list.querySelector("input, select, textarea, button")) continue;
    const rows = [...list.querySelectorAll(":scope > div")].map((row) => ({
      title: row.querySelector("dt")?.textContent || "",
      html: row.querySelector("dd")?.innerHTML || "",
    }));
    if (!rows.length || rows.some((row) => !row.title)) continue;
    const host = document.createElement("div");
    host.className = "details foundation-descriptions";
    list.replaceWith(host);
    const root = createRoot(host);
    flushSync(() =>
      root.render(
        <ToMeProvider>
          <ProDescriptions
            column={{ xs: 1, sm: 2, md: 2 }}
            size="small"
            dataSource={{}}
            columns={rows.map(({ title, html }, index) => ({
              title,
              key: `description-${index}`,
              render: () => <div dangerouslySetInnerHTML={{ __html: html }} />,
            }))}
          />
        </ToMeProvider>,
      ),
    );
    signal.addEventListener("abort", () => root.unmount(), { once: true });
  }
}
