import { useEffect, useState } from "react";
import { Pagination } from "../foundation/components";

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
      <Pagination
        current={page}
        pageSize={size}
        total={total}
        pageSizeOptions={[30, 60, 100]}
        showSizeChanger={{ "aria-label": "每页数量" }}
        simple={compact}
        showQuickJumper={false}
        showLessItems
        showTotal={(count, range) =>
          count
            ? `显示 ${range[0]}–${Math.min(range[1], count)} 件`
            : "暂无商品"
        }
        itemRender={(_page, type, original) => {
          if (type !== "prev" && type !== "next") return original;
          const previous = type === "prev";
          return (
            <button
              type="button"
              className="ant-pagination-item-link"
              aria-label={previous ? "上一页" : "下一页"}
              disabled={previous ? page <= 1 : page >= Math.ceil(total / size)}
            >
              <span aria-hidden="true">{previous ? "←" : "→"}</span>
            </button>
          );
        }}
        onChange={onChange}
      />
    </nav>
  );
}
