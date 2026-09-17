# Grailed 分发 Profile

版本：`GRAILED/1.0`。仅适用于 `channel.platform = GRAILED` 的标准交付记录。

- 按冻结资料的标题、正文、价格、币种和图片顺序交付；渠道默认币种以 Channel 配置为准。
- 不得因外部站点字段偏好改写成色、尺寸、材质或瑕疵；缺少可证明资料时回填 `ATTENTION`。
- `remoteId` 只可回传真实稳定身份；未知时留空，不制造本地格式的占位编号。
- 登录、验证码、浏览器或 APP 自动化、外部 API 调用均不在本 Profile 范围。
