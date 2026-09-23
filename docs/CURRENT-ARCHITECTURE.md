# 当前架构

单工作空间模块化单体：NestJS API、独立 PostgreSQL Worker、PostgreSQL 16、文件系统原图与派生预览，同源 Vite/TypeScript + React/Arco 前端。AppModule 目前集中注册控制器与服务；尚未拆成完整 Nest 领域模块，不宣称已完成模块化改造。

| 模块 | 当前事实归属 | 约束 |
|---|---|---|
| auth | User、Session、LoginThrottle、DistributionSession | 服务端实时授权，Cookie/Origin/CSRF；分发 Token 仅限受控 Agent 面 |
| supply / procurement | 来源、供货、采购、物流、退款来源记录 | 不拥有本地库存；追加来源修订 |
| ingest | Session、Batch、Candidate、候选原图、版本化 Skill/Profile | `/api/agent-ingest` 是最终合同；机器身份不能直接写 TM、库存、成交、成本或发布 |
| catalog | Item(TM)、Cycle、Revision、Movement、MaterialExport | 唯一商品事实；版本冲突和冻结资料 |
| dictionaries | 标准 ID、别名、停用状态 | 来源原文不自动成为标准字典 |
| media | Asset、IntakeFile | 原图不可覆盖，授权独立 |
| costing / trading | 成本依据、成交、预留、带下次跟进时间的询盘、调整、账期 | 未知金额 NULL、按币种；成交成本冻结 |
| publishing / distribution | Channel（含 businessPurpose）、DistributionTarget、ChannelPrice、Draft、UsePackage、DistributionAttempt、Listing、PublicationHealth、Collection、AnQiCMS 标准交付合同 | Target 仅表达当前交易经营意图；成功资料无论是否有 Listing 都按当前安全事实复核；默认路径交付冻结资料并记录经营状态；合同只读本地投影，不含 Connector |
| jobs | Outbox、Task | PG 租约、重试、失败持久化；无外部副作用 |
| operations | work-queue、运行健康、审计视图 | 只读投影，不复制第二套可写经营事实 |

核心命令通过 Commands 事务写入业务、Audit、Receipt 和 Outbox；重放前重验权限。库存采用 item advisory lock 和数据库约束。多个财务命令另用全局 `financial-journal` 锁：当前安全策略，未来并发增加可能产生等待；只有实际监控证明瓶颈后才细分，当前不调整。

## 前端

React/Arco 负责商品库和商品字段表示层，现有领域控制器继续负责写入、权限、版本和断线恢复。其余页面仍有原生 DOM，未做全量重写。根组件与页面生命周期绑定，ControllerSlot 保持 DOM 归属清晰。

main.ts 仅导入 ui08.css，层顺序 arco-base/workbench/arco/product。六份旧样式和 legacy 层已移除。品牌为搜索组合框，成色/颜色/材质为原生 select；选择更新不能擦除正在输入的筛选。

浏览入口只读，明确编辑后保存/取消返回同商品及原目录/批次上下文。IndexedDB 保存同账号、同浏览器的原文件和未完成命令键；不是跨设备同步。原图查看使用鉴权端点，不写元数据。

## 部署与资源边界

Caddy → api-a/api-b → 单个 PostgreSQL；worker-a/worker-b 与 API 共享 tome_media。Docker 非 root、只读根目录、最小数据库权限，迁移另用维护账户。属于单机进程冗余；主机、数据库、媒体卷和 Caddy 数据仍是单点。

UploadBudget 是**每进程同时 2 个**图片处理预算。两个 API 合计最多约 4 个；不是全局信号量。20MB / 40M pixel 是输入限制，768MB/container 是否足够仍需当前镜像实测；不得把配置上限当内存峰值证据。没有 Redis 或跨进程图片 semaphore。

应用版本由 package.json 读取；配置生成、OCI label 与 preflight 对齐。生产备份、恢复和上线条件见 [PRODUCTION](PRODUCTION.md)。历史演练不能替代新源码或实际主机验收。

详细业务不变量见 [CURRENT-BUSINESS-RULES](CURRENT-BUSINESS-RULES.md)，阶段演进见 [历史架构](archive/ARCHITECTURE-through-1.0.1-rc.1.md)。

## 渠道用途、经营目标、币种与发布安全

`Channel.businessPurpose` 是账号层经营用途：`TRADE` 才能承载交易资料、交易报价和 `DistributionTarget`；XHS 固定 `CONTENT`，SHOWROOM 固定 `SHOWROOM`，不能通过 UI 或 API 改成交易渠道。`DistributionTarget` 是 Item×Channel 的可关闭经营意图，保留创建/更新人、版本和原因；它不镜像 Item 库存、不回填历史 Listing/Attempt、不创建 Package 或任何外部动作。启用同平台第二个 Target 前必须明确确认，避免误把同平台多账号经营当作默认行为。

`Channel.defaultCurrency` 是 Channel 账号层的默认币种。`fixedChannelCurrency` 对 AnQiCMS/闲鱼分别强制 USD/CNY，其他平台返回账号默认值；Channel 创建、编辑、ChannelPrice 写入和发布 Readiness 共用这一要求。`resolveChannelPrice` 仍只解析 ChannelPrice 或 Item 回退价，不做 FX；回退价币种不等于目标账号时只能作为待补信息，不能复制金额。询盘创建在已配置账号下默认同币种有效渠道价；没有该价时金额 NULL、币种仍为目标账号。询盘转成交使用已记录的 `Inquiry.currency`，直接成交使用已配置账号的有效/要求币种或未配置账号的 Item 币种；仅 CNY Sale 自动冻结 CNY 成本，外币 Sale 不写入 CNY 成本。`Inquiry.nextFollowUpAt` 是 FOLLOWUP 的必填日程事实，工作队列按上海自然日计算逾期、今日与未来优先级。外币账期在没有 FX basis 时只能预览，确认返回 `FOREIGN_SETTLEMENT_FX_BASIS_REQUIRED`；没有 FX 引擎、自动换汇或历史 Sale 改写。

`ProcurementSource.defaultCurrency` 是来源层的候选缺省值，不是订单、成本或库存事实。采购来源管理通过 `Commands` 在来源锁下以版本、`Idempotency-Key` 和原因正式更新它，并把前后值写入 Audit；机器导入在创建新候选且未给出币种时才读取该值。已存在候选保留自身币种，已封存批次、订单、TM、库存、成本、成交与账期快照不被该元数据命令改写。

`PublicationHealthService` 不把 `Listing` 或 UsePackage TTL 当成唯一远端事实：当前成功 PUBLISH/UPDATE（包括 APP `remoteId` 为空）都会复核库存、Target、Channel、供应商 Offer、批准/鉴定、发布图片权利及正数且币种正确的交易价。安全但资料变化时输出待更新；不安全时 Worker/Sweep 只在本地创建来源关联 DELIST，不调用平台。停用或退出 TRADE 的渠道立即取消尚未交付的 PUBLISH/UPDATE，并且只可为未完成 DELIST 建立 stop-only 会话；回收站同样以这些暴露事实保护商品。

渠道 Readiness 与经营待办同样是读取投影：只对激活 Target 与历史真实 Exposure 配对计算 `missing[]`，不为 Item × Channel 建立持久 `PREPARE` Task；历史 Task 只作为历史事实保留。分发读取面先取这些配对、再批量加载健康判断，避免笛卡尔积和按行 N+1。未批准的正式 TM 由全局工作队列分页，批量成本预览一次最多读取 100 个订单且复用原成本计算；两者都不绕过领域命令、锁、Audit 或 Receipt。

## 验证环境

品牌治理读取面由 ingest 在可重复读事务中按来源品牌与 Agent 建议分组，并只查现有 BRAND DictionaryTerm。字典创建和别名维护仍归 dictionaries；候选品牌绑定由 ingest 独立命令在字典目录锁和候选锁下复核版本，只写候选 proposal、当前提示、Audit 与 Receipt，不复用会改采购行的 `reviewCandidate`。机器重导保留人工批准的品牌，来源变化另提示复核；来源证据与历史修订不被覆盖。

正式 Release CI 固定 Node 22.22.3、Ubuntu 24.04 与 deploy/images.json 相同 PostgreSQL digest。compatibility.yml 为手工触发的独立非阻断任务，使用 Node 22 / PG16 最新补丁；其结果不替代发布指纹或 release gate。发布汇总同时拒绝双浏览器通过数量不等、flaky、skip 和非零 retry。

2026-09-16 本地 Docker 合成压力验收：两 API 同时共 4 张图片，每张原文件 20MiB / 40M pixels，全部 HTTP 201；超过文件上限为 413，超过像素上限为 400。最新镜像重复演练的 cgroup memory.peak 分别 240529408 / 260296704 bytes，均低于 768MiB，无 OOM。结果见 reports/upload-budget.json；这只证明该合成负载在本地 ARM 容器的表现，腾讯云实际机型仍需部署前复核，不是全局并发上限或长期吞吐保证。

UX 1.0.2：collection-draft 只负责账号范围的浏览器草稿持久化，collection-builder 继续调用现有预检、Package 和 Collection 命令；studio-image-order 只重排发布选图，studio-publisher 保持真实写入及版本恢复；batch-actions 由上游明确传递已确认状态。未添加服务端草稿表、外部发布或新角色权限。

Agent Ingest Standard v1.3：机器会话先取得协议、校验 `tome-ingest/1.3` Skill 与当前来源 Profile 的 SHA-256，再经 HTTP、薄 MCP 或 `tome-ingest` CLI 调用同一 `IngestService`。新机器 Batch 必须带 protocolVersion、Skill 与服务端 Profile；服务先查同键历史事实，仅已有同清单批次可保留旧合同。新建 TRR Profile 为 `TRR/1.4`，既有批次仍按 `TRR/1.3`，通用市场 Profile 为 `GENERIC_MARKETPLACE/1.2`。候选的 `sourceFacts` 是来源事实和完整性依据；可选 `agentProposal` 是字段级整理建议，只有人工确认候选才用于生成 TM。稀疏更新的省略值和普通 `null` 继续保留已有来源事实；受限 `sourceCorrection` 只允许在同次 capture 记录 `UNAVAILABLE + 来源侧原因` 后清空目录内的受污染来源字段，或按 SHA-256 撤下尚未关联 TM 的错误候选图片、作废旧建议。撤下记录保留原文件、原因、修订与 Audit，但从当前图册、完整性、重复判断和确认素材中排除；已关联 TM 的图片拒绝机器撤下，已确认候选的来源纠错只同步 Source payload/revision，不改 TM。TRR Profile 把订单行原价、逐件折后金额与平台当前价分开采集；通用市场 Profile 不强加 TRR 语义。服务端必查字段会和 Agent 自报字段取并集，且不读取 `agentProposal` 补齐缺项；MCP 可使用 `X-Ingest-Token` 或同一 Token 的 Bearer 头，但只提供协议、批次、订单、候选和封批工具，图片仍走原 multipart 接口。CLI 状态文件仅保存 fingerprint、幂等键、服务器 ID 和状态，不能保存 Token。候选当前完整性从最新清单及当前有效文件计算；正确页面或原图无法取得时继续显示来源缺项，不能用错图、推断或放大图补造。

rc.12 将新建 TRR Profile 前移为 `TRR/1.4`，并保留 `TRR/1.3` 的 Profile 注册与历史 Markdown，供既有批次按原字段清单读取、重放和解释封存证据。`TRR/1.4` 只在该批次的候选来源事实层验证 `foreignSize`、`sizeEstimated` 与 `order.{orderDateRaw,orderedAt,datePrecision}`：品牌/标签原始尺码没有直接来源证据就必须带原因标为 `UNAVAILABLE`；购买日期只能是无时分秒的 DAY/MONTH/YEAR 文本。`order` 内既有的支付、调整、Credit、订单行和来源状态等来源字段不是日期合同的一部分，前向回填日期时原样保留；三项日期字段仍独立严格校验。Agent Proposal 目录不含这些路径。服务以批次 manifest 的 Profile 决定校验，不能让已存在 1.3 批次被当前 Profile 反向加字段；候选详情在 React 表示层把展示尺码、原始尺码、估算标记和购买日期分栏呈现，未新增数据库列、TM、库存、成本或外部动作。

采购模型用 `PurchaseLine.sourceLineNetAmount` 和 `IngestCandidate.sourceLineNetAmount` 保存逐件折后金额。成本服务同时保留原价比例和折后金额比例两种显式来源规则，新建的 `TRR`、`TRR-...`、`TRR_...` 来源默认选择折后金额；既有来源不由 migration 静默改规则。规则版本变化会使已确认订单依据失效，必须重新确认；成本仍只在人工确认支付、Credit/退款和汇率依据后写入 TM。

Distribution Foundation 与 Real Operations：后台用户先从有效 UsePackage 准备一条 DistributionAttempt；该记录在 PostgreSQL 事务中同时产生 Audit、Receipt、Outbox。系统以冻结资料指纹和既有成功/停售事实自动决定 PUBLISH、UPDATE 或 NOOP，尚未处理的交付只会回到原记录。默认 UI 仅展示待交付、已交付、已确认完成、需要处理、需要核对、已取消等经营状态；`UNKNOWN` 必须在原记录附依据核对为成功或失败。默认机器入口是 `tome-distribution/1.0` Skill、受限 Handoff HTTP 和四工具 `/api/mcp/distribution`：机器先从 protocol 发现并校验当前 Channel 的 Skill/Profile SHA-256，X 头和 Bearer 共用同一 Token；它按 Channel 交付有效冻结包、把取包记为已交付、回填最小完成/待核对结果，并在每次机器写入及 Receipt 重放重新核验会话和创建者发布权限；它没有平台 Runtime 的领取、心跳、续租、调度或浏览器工具。`planStopDistribution` 在同一 Item 锁事务中处理 AVAILABLE 到所有不可售状态的变化：每个渠道的 DELIST 都用 `sourceAttemptId` 绑定当前成功 PUBLISH/UPDATE，并以源代际去重；恢复 AVAILABLE 不会创建 PUBLISH/UPDATE。`PublicationHealthService` 对有无 stable Listing 的成功资料代际重验当前经营安全；UsePackage 七天 TTL 只决定新交付，不能单独让已发布记录待更新。分发会话、Token 哈希、按 Channel 隔离的领取和短租约仍保留为兼容的高级接口，但默认配置关闭。`SUCCEEDED + remoteId` 才 upsert Listing；没有远端 ID 的 APP 发布仍可确认完成，不以假 ID 补齐；AnQiCMS 的 PUBLISH/UPDATE 必须回传稳定 archive ID。`resolveChannelPrice` 统一选择启用的 ChannelPrice 或 Item 回退价，草稿与包快照记录来源/版本；报价变化、清除再恢复都会使旧包失效。Inquiry 的成交转化在 financial-journal 与 Item 锁内创建 Sale、停售、标 WON 并计划 DELIST；没有 Listing 的 APP 成功 Attempt 同样参与下架计划。AnQiCMS 标准交付合同将冻结包映射为 USD、`styleNumber` 和分开的成色等级/说明，并在标准取包内作为 `platformData` 返回；无 archive ID 时按 tm_code 保护性查找，稳定 archive ID 才会进入 Listing。售出时只读取 TM、当前状态、Channel 和 Listing.archive ID 输出 stock=0、保留 SOLD 页面，不重验历史图片或使用包。标准 Handoff 超时或会话死亡只读投影为 ATTENTION，不自动重发或改写 Attempt。它没有 HTTP 客户端、配置读取或外部写入。

经营页不以 Attempt 条数代替业务答案。`GET /api/distribution/operations` 在读取时只组合激活 Target 和历史真实 Exposure 的当前 Item、Readiness、UsePackage、Attempt 和 Listing：输出 READY、BLOCKED、PENDING、HANDED_OFF、PUBLISHED、NEEDS_UPDATE、ATTENTION、NEEDS_STOP 或兼容的 CANCELLED，并附已发布资料的健康原因，不落库第二套渠道库存事实。渠道、状态、品牌和 TM/商品搜索在服务端排序和分页之前完成；Dashboard 的分发异常调用同一 `scope=attention` 投影。该读取面不申请凭据、不调平台、不创建 Package、Attempt、Listing 或任务。
