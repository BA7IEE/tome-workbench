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
      rowKey="id"
      dataSource={data}
      columns={
        columns.map((column, index) => ({
          ...column,
          key: `record-${index}`,
          search: false,
          render: (_, row) => column.render(undefined, row),
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
