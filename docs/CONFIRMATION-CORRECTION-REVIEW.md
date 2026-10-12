# 误确认补偿第一片：证据与状态转换合同

实施仅限管理员只读 GET /api/ingest/candidates/:id/confirmation-correction-preview 与已确认来源卡片的“核对误确认条件”。RepeatableRead 中读取同一快照，不写 Receipt、经营状态、来源决定或成本。响应 mode=REVIEW_ONLY、executionAvailable=false 永远固定，当前满足条件也不能执行撤销。

新建证据要求唯一原 ingest.candidate.confirm Receipt 的 candidateId、itemId、TM、existing=false 和有效版本相符。后来的 existing=true 回执、link-item 回执、创建时间、标题不能作替代。Item 主来源与唯一来源链接、候选与采购行必须一致；共享或复用、TEST、回收站、受保护库存及后续周期拒绝。

逐项核对成交/退款、成本、预留、库存观察、询盘、保管移动、远端身份/目标/交付、草稿、资料包/导出、报价、异常/待办/建议、豁免、渠道价、别名，以及整单成本依据、其他行成本、成本确认历史和采购退货。历史依赖也保守阻断。任何检查缺失拒绝，不向普通运营泄露财务内容。当前 digest 只用于对比核对快照，不是写入授权。

纯状态转换合同明确 Item 软退出、候选 EXCLUDED、采购行 EXCLUDE 同事务，原编号、File 与 itemId 历史锚点保留；组合恢复回到同一 TM、CONFIRMED/INCLUDE，PAUSED、批准失效且不自动发布。实际写命令、专用纠错表与 forward migration、旧恢复/成本入口守卫、锁协议及断线/并发/恢复验收尚未实施，所以没有撤销/恢复写按钮，也不能宣称 B 已可用。

新增纯合同五项（每个经营依赖与未完成检查逐项失败关闭）、真实 PostgreSQL/HTTP 原回执/只读不变/权限/共享与整单成本测试，以及两浏览器相同入口零写入测试。完整通过只认本片固定 CI head，不以普通 UX PR 的旧报告替代。Mac 不启动数据库或重构建。
