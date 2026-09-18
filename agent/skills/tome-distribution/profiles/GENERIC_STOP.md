# 通用停售交付 Profile

版本：`GENERIC_STOP/1.0`。仅用于已停用、退出交易用途或没有专用发布 Profile 的历史渠道完成 **DELIST** 收尾。

- 本 Profile 只处理系统已经列出的 `DELIST` 交付，不允许 PUBLISH 或 UPDATE。
- 只使用 ToMe 提供的永久 TM、Channel 身份和已有稳定远端身份（如果存在）定位历史商品。
- 无法确认远端商品已停售时必须回填 `ATTENTION`；不得猜测成功，也不得重新发布。
- 不要求重新取得已经过期的发布图片、价格或文案。
- 不记录或回传账号密码、Cookie、Token、验证码、设备信息、点击坐标或页面步骤。
