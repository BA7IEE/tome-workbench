import { useEffect, useState, type AriaAttributes } from "react";
import { ConfigProvider, Pagination } from "@arco-design/web-react";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";

const locale = {
  ...zhCN,
  Pagination: {
    ...zhCN.Pagination,
    countPerPage: "件/页",
    pageSize: "每页数量",
  },
};
const selectLabel: AriaAttributes = { "aria-label": "每页数量" };

export function CatalogPagination({
  total,
  page,
  size,
  onChange,
}: {
  total: number;
  page: number;
  size: number;
  onChange(page: number, size: number): void;
}) {
  const [compact, setCompact] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const change = () => setCompact(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return (
    <nav className="catalog-pagination" aria-label="商品分页">
      <ConfigProvider locale={locale}>
        <Pagination
          current={page}
          pageSize={size}
          total={total}
          sizeOptions={[30, 60, 100]}
          sizeCanChange
          simple={compact}
          showJumper={false}
          bufferSize={1}
          showTotal={(count, range) =>
            count
              ? `显示 ${range[0]}–${Math.min(range[1], count)} 件`
              : "暂无商品"
          }
          selectProps={{ ...selectLabel, size: "default" }}
          onChange={onChange}
        />
      </ConfigProvider>
    </nav>
  );
}
