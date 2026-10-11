# AntD 动态样式 CSP nonce 修复

基线为已合并 Foundation 的 `main@cf7565a`，Ant Design 6.6.5、ProComponents 3.1.15-5、CSS-in-JS 2.1.2；保留批量菜单修复 `691f494` 和读取反馈 `89ad371`。用户已明确批准实施和隔离测试，未授权生产部署。

## 问题与变更

线上排序值与下拉箭头脱框、分页出现列表圆点，共同原因已由实际 DOM 和浏览器 security log 证实：HTTP `Content-Security-Policy` 的 `style-src 'self'` 拒绝 AntD 动态 style 标签。并非 HTML CSP meta，也不应只改分页间距掩盖样式缺失。

`src/common/style-csp.ts` 以 crypto 为每个响应生成随机 nonce，WeakMap 让 Helmet 与 HTML 渲染读取同一份值；不保留已释放的响应。共享 CSP 指令与以前一致，style-src 仅追加该响应 nonce，不加入 unsafe-inline，不改变 script-src/script-src-attr，不增加外部域名。secure 模式的 upgrade-insecure-requests 行为保留。

bootstrap 缓存固定前端模板，每份 `/` 和 `/showroom` HTML 单独替换 nonce，并设置 no-store；assets 的 immutable/max-age 不变。模板没有唯一标记时启动失败，避免 API/前端失配悄悄上线。`web/index.html` 的 meta 只用于向客户端传 nonce，ConfigProvider 将合法 nonce 传给 AntD；StyleProvider 继续保留原 layer，未增加不存在的 nonce prop。开发服务器的占位符不作为 nonce。

## 实际检查与限制

- PASS：两项本机 Node 测试，实际 Helmet/HTTP 响应验证三次 HTML 请求（含 showroom）nonce 随请求变化、header/meta 匹配、no-store、脚本策略无放宽，以及错误 nonce/缺失或重复模板标记失败。
- PASS：实际 provider.tsx 的合法/占位/非法/缺失 nonce 参数转发检查；这是 stub JSX/component 检查，不代表 AntD 已实际渲染。
- PASS：定向 helper + Helmet 类型兼容检查，改动源码/测试 ESLint、Prettier、脚本语法、Foundation admission 和 diff 空白检查。
- PASS：实际 core.request 七项无网络读取/写入/同键检查和实际 catalog-menu 九项监听器检查。此前单个 Chrome 合成 DOM 在桌面与 390px 验证了菜单内部滚动、选择保持、Escape 回焦、末项点击、页面滚动关闭与取消；不代表新的 CSP 框架回归。
- NOT_RUN：本轮真实 AntD 排序/筛选/分页、无 nonce style 被浏览器阻止及完整多选回归。一次 Browser Use CDP 调用从生产 origin 切至本机 `http://127.0.0.1:4328` 后卡在 full Chrome DevTools 授权，最终报 kernel signal 9；未循环重试，无法确认批准是否保存。恢复 turn 中该 Browser Use/CDP 工具已不可调用，没有改用其他路径控制用户 Chrome 来绕过权限。
- NOT_RUN：完整 dependency install、typecheck/build、PostgreSQL、Chromium/WebKit、audit、release/pack、新云端 CI、push/merge/deploy。Mac 不执行重负载测试，也不复用基线 CI 的指纹。

4328 合成测试服务在恢复核查时已无监听，未再次启动；没有生产记录写入。

## 回归准备与下一步

`test/style-csp.test.cjs` 已接入 test:unit。Foundation suite 在 1440/390px 下通过真实 bootstrap/header 验证 AntD 生成 style 的 nonce/sheet、Pagination 无圆点、Select 正常打开/Escape，以及无 nonce style 被拒绝和重新请求 nonce 不同。原商品排序/每页数量/跨页选择/筛选保留场景与批量滚动断言继续在既有 browser suites 中，两种浏览器范围一致。

这些浏览器断言已经准备，尚未执行，不能写成通过。推荐下一步将固定修复 head 推送至 `BA7IEE/tome-workbench` 的独立修复分支并创建 draft PR，复用现有 ci.yml 的单 worker、独立合成 PostgreSQL、Chromium/WebKit 完整 gate；不增加权限、工作流、secret、生产访问或部署。云端运行需要先获得该 push/PR 范围的明确批准。只读浏览器工具恢复也可继续现有授权测试，不应反复重开同一权限窗。
