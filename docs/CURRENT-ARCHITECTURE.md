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
| costing / trading | 成本依据、成交、预留、询盘、调整、账期 | 未知金额 NULL、按币种；成交成本冻结 |
| publishing / distribution | Channel、ChannelPrice、Draft、UsePackage、DistributionAttempt、Listing、Collection、AnQiCMS Spike 合同 | Attempt 是执行事实；稳定远端 ID 才有 Listing；Spike 只读本地合同，不含 Connector |
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

## 验证环境

正式 Release CI 固定 Node 22.22.3、Ubuntu 24.04 与 deploy/images.json 相同 PostgreSQL digest。compatibility.yml 为手工触发的独立非阻断任务，使用 Node 22 / PG16 最新补丁；其结果不替代发布指纹或 release gate。发布汇总同时拒绝双浏览器通过数量不等、flaky、skip 和非零 retry。

2026-09-16 本地 Docker 合成压力验收：两 API 同时共 4 张图片，每张原文件 20MiB / 40M pixels，全部 HTTP 201；超过文件上限为 413，超过像素上限为 400。最新镜像重复演练的 cgroup memory.peak 分别 240529408 / 260296704 bytes，均低于 768MiB，无 OOM。结果见 reports/upload-budget.json；这只证明该合成负载在本地 ARM 容器的表现，腾讯云实际机型仍需部署前复核，不是全局并发上限或长期吞吐保证。

UX 1.0.2：collection-draft 只负责账号范围的浏览器草稿持久化，collection-builder 继续调用现有预检、Package 和 Collection 命令；studio-image-order 只重排发布选图，studio-publisher 保持真实写入及版本恢复；batch-actions 由上游明确传递已确认状态。未添加服务端草稿表、外部发布或新角色权限。

Agent Ingest Standard v1.2：机器会话先取得协议、校验 Skill 与当前来源 Profile 的 SHA-256，再经 HTTP、薄 MCP 或 `tome-ingest` CLI 调用同一 `IngestService`。TRR 与通用市场 Profile 的服务端必查字段会和 Agent 自报字段取并集；历史未带标准元数据的批次仍按其旧合同读取。MCP 只提供协议、批次、订单、候选和封批工具，图片仍走原 multipart 接口。CLI 状态文件仅保存 fingerprint、幂等键、服务器 ID 和状态，不能保存 Token。

Distribution Foundation 与 Real Operations：后台用户先从有效 UsePackage 计划 DistributionAttempt；该 Attempt 在 PostgreSQL 事务中同时产生 Audit、Receipt、Outbox。分发会话只保存 Token 哈希，按 Channel 隔离，领取采用数据库锁和短租约。Agent 只能读取自己 Channel 内、已领取且未过期 Attempt 的当前包和包内原图；结果未知只能领取原 Attempt，以永久 TM 做核对，不能另建发布记录。`SUCCEEDED + remoteId` 才 upsert Listing；没有远端 ID 的 APP 发布仍是成功 Attempt，不以假 ID 补齐。`resolveChannelPrice` 统一选择启用的 ChannelPrice 或 Item 回退价，草稿与包快照记录来源/版本；报价变化、清除再恢复都会使旧包失效。Inquiry 的成交转化在 financial-journal 与 Item 锁内创建 Sale、停售、标 WON 并计划 DELIST；没有 Listing 的 APP 成功 Attempt 同样参与下架计划。AnQiCMS Spike 只在受限会话中读取冻结包并输出本地字段合同：无 archive ID 时按 tm_code 保护性查找，稳定 archive ID 才会进入 Listing；售出时输出 stock=0、保留 SOLD 页面。它没有 HTTP 客户端、配置读取或外部写入。
