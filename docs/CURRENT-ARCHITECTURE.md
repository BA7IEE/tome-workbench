# 当前架构

单工作空间模块化单体：NestJS API、独立 PostgreSQL Worker、PostgreSQL 16、文件系统原图与派生预览，同源 Vite/TypeScript + React/Arco 前端。AppModule 目前集中注册控制器与服务；尚未拆成完整 Nest 领域模块，不宣称已完成模块化改造。

| 模块 | 当前事实归属 | 约束 |
|---|---|---|
| auth | User、Session、LoginThrottle | 服务端实时授权，Cookie/Origin/CSRF |
| supply / procurement | 来源、供货、采购、物流、退款来源记录 | 不拥有本地库存；追加来源修订 |
| ingest | Session、Batch、Candidate、候选原图 | 人工确认边界；机器身份不能直接写 TM |
| catalog | Item(TM)、Cycle、Revision、Movement、MaterialExport | 唯一商品事实；版本冲突和冻结资料 |
| dictionaries | 标准 ID、别名、停用状态 | 来源原文不自动成为标准字典 |
| media | Asset、IntakeFile | 原图不可覆盖，授权独立 |
| costing / trading | 成本依据、成交、预留、询盘、调整、账期 | 未知金额 NULL、按币种；成交成本冻结 |
| publishing | Channel、Draft、UsePackage、Listing、Collection | 草稿可改、快照不可改；本地下载不等于远端发布 |
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
