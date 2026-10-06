import type { ReactNode } from "react";
import { StyleProvider } from "@ant-design/cssinjs";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { antDesignTokenSeed, designTokens } from "./tokens";

/** One brand provider for every real page root, including lifecycle-owned islands. */
export function ToMeProvider({ children }: { children: ReactNode }) {
  return (
    <StyleProvider layer>
      <ConfigProvider
        locale={{
          ...zhCN,
          Pagination: { ...zhCN.Pagination, items_per_page: "件/页" },
        }}
        virtual={false}
        getPopupContainer={(trigger) =>
          trigger?.closest<HTMLDialogElement>("dialog") || document.body
        }
        button={{ autoInsertSpace: false }}
        theme={{
          token: {
            ...antDesignTokenSeed,
            colorTextDisabled: designTokens.textSecondary,
          },
          components: {
            Table: {
              headerBg: designTokens.canvas,
              rowSelectedBg: designTokens.selected,
            },
            Tag: {
              defaultColor: designTokens.textSecondary,
              defaultBg: designTokens.canvas,
            },
            Card: { headerBg: designTokens.surface },
          },
        }}
      >
        <App className="tome-ant-root">{children}</App>
      </ConfigProvider>
    </StyleProvider>
  );
}
