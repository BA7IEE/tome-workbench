import { forwardRef, useImperativeHandle, useState } from "react";
import { Button } from "../foundation/components";
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
      aria-describedby={primary ? "entry-save-destination" : undefined}
      className={primary ? "studio-main-save" : undefined}
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
        <small className="studio-save-identity">{identity.code}</small>
        <span className="entry-save-state" role="status">
          {item.id ? "已保存" : "未保存"}
        </span>
        <span id="entry-save-destination" className="visually-hidden">
          {finishOnSave
            ? "保存后返回本件商品详情"
            : "保存后留在当前件，可继续编辑"}
        </span>
        <span id="entry-cancel-scope" className="visually-hidden">
          只放弃未保存资料和待上传图片；已生效的图片及经营操作保留
        </span>
        {save(
          finishOnSave ? "return" : "stay",
          finishOnSave ? "保存并返回详情" : "保存当前件",
          "保存商品",
          true,
        )}
        {identity.id && (
          <a
            className="btn studio-cancel"
            href={returnTarget}
            aria-describedby="entry-cancel-scope"
          >
            取消编辑
          </a>
        )}
        {save("materials", "保存并下载资料", "保存并下载资料")}
        <details className="studio-more">
          <summary className="btn subtle">更多</summary>
          <div className="studio-more-menu">
            <div className="studio-mobile-extra">
              {save("materials", "保存并下载资料", "保存并下载资料")}
            </div>
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
