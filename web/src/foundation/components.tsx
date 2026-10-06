/** Business modules consume this boundary, never vendor imports. */
export {
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Pagination,
  Select,
} from "antd";
export { ProForm, ProDescriptions, ProTable } from "@ant-design/pro-components";

import { Tag as AntTag, type TagProps } from "antd";
import { designTokens } from "./tokens";
/** Preset vendor palettes do not define business status or text contrast. */
export function Tag({ color, style, ...props }: TagProps) {
  const palette =
    color === "green"
      ? { color: designTokens.successText, background: designTokens.successBg }
      : color === "red"
        ? { color: designTokens.errorText, background: designTokens.errorBg }
        : color === "orange"
          ? {
              color: designTokens.warningText,
              background: designTokens.warningBg,
            }
          : {
              color: designTokens.textSecondary,
              background: designTokens.canvas,
            };
  return (
    <AntTag
      {...props}
      style={{ ...palette, borderColor: designTokens.border, ...style }}
    />
  );
}
