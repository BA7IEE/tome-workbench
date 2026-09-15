import { forwardRef, useImperativeHandle, useState } from "react";
import { Button } from "@arco-design/web-react";
import { can } from "../core";
import type { Item } from "../types";
export type HeaderHandle = {
  update(item: Item): void;
  busy(value: boolean): void;
};
export const ProductHeader = forwardRef<
  HeaderHandle,
  {
    item: Item;
    returnTarget: string;
    returnLabel: string;
    sourceTitle?: string;
    nextId?: string;
    finishOnSave?: boolean;
  }
>(function ProductHeader(
  { item, returnTarget, returnLabel, sourceTitle, nextId, finishOnSave },
  ref,
) {
  const [identity, setIdentity] = useState(item);
  const [busy, setBusy] = useState(false);
  useImperativeHandle(ref, () => ({ update: setIdentity, busy: setBusy }), []);
  const save = (
    intent: string,
    title: string,
    label = title,
    primary = false,
  ) => (
    <Button
      htmlType="submit"
      form="product-entry-form"
      name="intent"
      value={intent}
      type={primary ? "primary" : "default"}
      disabled={busy}
      aria-label={label}
    >
      {title}
    </Button>
  );
  return (
    <>
      <div className="studio-command-main">
        <a className="studio-back" href={returnTarget} aria-label={returnLabel}>
          ←
        </a>
        <div>
          <h1>{identity.id ? identity.title || "未命名商品" : "新建商品"}</h1>
          <p className="entry-code">
            {identity.id ? "编辑 · " : ""}
            {identity.code}
            {sourceTitle ? " · 来自 " + sourceTitle : ""}
          </p>
        </div>
      </div>
      <div className="studio-command-actions">
        <span className="entry-save-state" role="status">
          {item.id ? "已保存" : "未保存"}
        </span>
        {save(finishOnSave ? "return" : "stay", "保存", "保存商品", true)}
        {identity.id && (
          <a className="btn" href={returnTarget}>
            取消编辑
          </a>
        )}
        {save("materials", "保存并下载资料", "保存并下载资料")}
        <details className="studio-more">
          <summary className="btn subtle">更多</summary>
          <div className="studio-more-menu">
            {can("publish") && save("publish", "准备发布", "保存并准备发布")}
            {save("return", "保存并返回")}
            {nextId
              ? save("next", "保存并编辑下一件")
              : !sourceTitle && save("new", "保存并新增下一件")}
            <a href={returnTarget}>{returnLabel}</a>
            {identity.id && (
              <a data-detail-link href={`#/items/${identity.id}?tab=facts`}>
                查看详细记录
              </a>
            )}
          </div>
        </details>
      </div>
    </>
  );
});
