# ToMeBoutique 开发契约

修改前阅读 README.md、docs/CURRENT-RELEASE.md、docs/CURRENT-ARCHITECTURE.md、docs/CURRENT-BUSINESS-RULES.md、docs/ARCHITECTURE.md、docs/AC_MATRIX.md 及相关模块。部署工具修改另读 docs/PRODUCTION.md。历史仅查 docs/releases/ 和 docs/archive/，不把历史阶段状态当当前指令。

## 不可违反的边界

- TM Item 是经营事实中心，平台/采购/Agent 是来源证据；机器身份仅走通用 ingest。人工确认才能建 TM，多来源走 ItemSourceLink。来源状态、成色和金额不得自动变成本地库存、标准字典或成本。
- 不连接 SRVF、生产或其他应用的库、Bucket、Key，不用真实经营数据做夹具。自动测试仅可重置独立 tome_test。localhost Compose 合成演练独立隔离，不是公网部署或真实 UAT。
- 已发布 migration、冻结发布/素材/账期快照不可改。仅新增 forward migration；不可删除封印或自行重封历史来过门禁。
- 库存和财务保留 item lock、financial-journal 锁、DB 约束和版本检查。业务、审计、Receipt、Outbox 同事务。重放前重验角色/Session；同 key 不同载荷冲突。
- 未知金额 NULL，不能用 0 补空、跨币种合计、反改成交成本快照或自行解释真实协议。财务缺项不阻断快速停售；库存观察不制造收入。
- 原图不覆盖，授权/用途/复核独立。来源图不自动有 PUBLIC 权利；下载资料不等于第三方发布。TEST/删除隔离和当前依赖摘要不能放松。
- 外部副作用、真实支付/退款/分账、抓取、消息、联网 AI、自动发布默认 OFF。源码、日志、测试、ZIP 不含真实凭据、会话和个人资料。
- UI 继续保留 rc.15–19 与 UX 1.0.2 当前行为及领域控制器。ui08.css 是唯一样式入口；不恢复六份退役 CSS。React 表示层不能绕过权限、版本、恢复和证据。

## 一次一个垂直切片

先说明目标、模块、不变量、最小验收；不混入无关重构或依赖升级。变更测试必须解释旧期望为何不再正确，不能为了错误实现改断言；重命名同步 AC 映射。

1. `node scripts/prepare-test.mjs`（只读配置，不输出连接凭据；不要并发重置同一库）。
2. `npm run typecheck && npm run lint && npm run build`。
3. `npm run verify:release`：脚本语法、单元、真实 PostgreSQL 集成、Chromium、WebKit、HA、恢复、Harness selftest/check 全部通过，源码指纹不变。
4. `npm audit --audit-level=high`，更新当前文档、AC、runbook、验证报告。
5. `npm run pack`，核对 ZIP 不含 .env、data、node_modules、凭据、sessions 或备份。

两浏览器范围和用例数相同，所有既有领域套件保留；retries=0、skipped=0、flaky=0。禁止跳 UI 登录、注入 Cookie、force-click 禁用控件、刷新掩盖旧渲染、扩大整例超时或模拟成功响应替代真实服务。登录前置等待真实响应并断言；诊断不得记录输入/正文/Cookie/CSRF。保留真实写入后丢回执和同键恢复、原文件字节、并发编辑、手机/键盘测试。

如实区分源码检查、合成运行、人工 UAT 和公网部署；失败或未做不得写成通过。源码变化后不得复用旧验证指纹。合并 main 和部署仍需报告已验证 PR head 后取得用户最终确认。

登录页在挂载时同步设置初始焦点，不用延迟原生 autofocus；测试以 DOM 焦点和字段相等布尔值核对，不输出凭据。商品文字与待上传图片全部完成后才显示总体已保存。
