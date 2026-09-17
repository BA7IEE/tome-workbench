# 蓝图 v1.1.1 · 当前实现覆盖矩阵

**状态不是测试通过数。**“内部覆盖”表示本版有对应核心路径；“部分”明确限制；“后续”不作为交付完成。具体测试日志以docs/VALIDATION.md和reports为准。正式业务UAT尚未由经营者完成。

| AC | 本版边界 | 蓝图场景 | 说明 |
|---|---|---|---|
| AC01 | 内部覆盖 | 只有照片和来源先保存 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC02 | 内部覆盖 | 并发创建与重试 | 事务幂等与PG序列；追加并发创建测试。 |
| AC03 | 内部覆盖 | 从TM999999继续发号 | TM扩位规则单测；PG发号由序列保证。 |
| AC04 | 部分 | 同件商品多平台发布 | 同一Item在多个Channel记录；不另建库存。 |
| AC05 | 部分 | 标题长度不足或平台限制 | Unicode标题限长+完整TM；未实现按平台特殊规则审核的外部例外映射。 |
| AC06 | 部分 | 同款不同件、同图疑似重复 | 精确图片SHA、同来源货号/采购关联可提示已有TM；人工可把候选归入已有TM，或明确确认“同图但另一件实物”后新建。仍无感知哈希/视觉相似检索及成熟合并拆分工作台。 |
| AC07 | 内部覆盖 | 再次导入供应商旧资料 | 原始来源修订；正式Item人工内容不会被重导入覆盖。 |
| AC08 | 内部覆盖 | 多次补尺寸和研究资料 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC09 | 内部覆盖 | 两人同时改同一字段 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC10 | 内部覆盖 | 供应商资料已齐、实物不过手 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC11 | 内部覆盖 | 自有衣服缺图缺尺寸 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC12 | 内部覆盖 | 一个用途缺英文，另一个已满足 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC13 | 内部覆盖 | 某研究要求不适用 | 有依据的尺寸不适用决定、撤销及历史；不能豁免真实性/图片/库存。 |
| AC14 | 内部覆盖 | 将拍摄任务标为完成但图不合格 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC15 | 内部覆盖 | 尝试跳过非豁免真实性要求 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC16 | 内部覆盖 | 不同渠道共同需要一份尺寸 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC17 | 内部覆盖 | 批量拍摄与混杂上传 | 批次上传、编号建议、人工确认归属、并发绑定保护；未归属图不产生库存。 |
| AC18 | 内部覆盖 | 改价或纠正材质 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC19 | 部分 | 原图生成多用途版本 | 原件保留；手工发布包可导出JPG，选择及顺序保存在冻结包中。AI营销、多种裁剪配方仍未开发。 |
| AC20 | 内部覆盖 | 使用包和对外文件导出 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC21 | 部分 | 人工修改文案后重生成 | 已增加按商品/渠道/用途保存的可编辑草稿、版本冲突和人工核对更新；自动三方合并仍未实现。 |
| AC22 | 内部覆盖 | 只复制/下载，没有回执 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC23 | 内部覆盖 | 多件商品合集，一件售出 | 使用TM号生成多件选品合集，逐件动态过滤，售出一件不停止其他有效商品。 |
| AC24 | 内部覆盖 | 货源池一次导入300件，仅选择50件 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC25 | 内部覆盖 | 正式商品在经营方微信或线下成交 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC26 | 内部覆盖 | 提前记录符合规则的朋友交易 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC27 | 内部覆盖 | 朋友最终没买、普通客户购买 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC28 | 内部覆盖 | 赠与或自留 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC29 | 内部覆盖 | 供应商自行卖出同一实物 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC30 | 部分 | 单个SupplyOffer撤回、另一供货仍有效 | 多个Offer可评价；暂无完整单供货撤回控制台。 |
| AC31 | 内部覆盖 | 已知卖掉但财务数据暂缺 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC32 | 内部覆盖 | 原因不明的缺货消息 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC33 | 内部覆盖 | 已有我方订单但供应商另卖他人 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC34 | 内部覆盖 | 重复点击我方售出 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC35 | 内部覆盖 | 出售后部分渠道只能手工处理 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC36 | 部分 | 原有客户成交后才补标 | 管理员有依据补判单笔；未激活7日窗口或自动协议规则。 |
| AC37 | 内部覆盖 | 被有效排除的朋友成交 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC38 | 后续 | 一张订单部分商品排除 | 一物一笔Sale；没有多行订单或公共费用自动分摊。 |
| AC39 | 部分 | 平台净打款已扣佣金 | 手动核对总收入/实际费用；不自动导入净打款或渠道费单。 |
| AC40 | 内部覆盖 | 已售未到账、退款争议未结束 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC41 | 部分 | 季度确认后改价、汇率或规则 | 单币种不可变对账快照与后续差额更正已实现；汇率账和法定财务结算未实现。 |
| AC42 | 内部覆盖 | 退货后再售 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC43 | 后续 | 补录既有项目客户复购交易 | 不自动推定既有客户复购适用规则；需后续真实协议建模。 |
| AC44 | 部分 | 货物在供应商、拍摄人和客户间交接 | 有实际保管移动及依据；暂无计划调拨/签收链/借还全流程。 |
| AC45 | 部分 | 两个操作者或渠道同时预留，或与售出/赠与竞争 | 内部库存/预留/售出锁与唯一约束已测；不代表第三方不会同时售出。 |
| AC46 | 部分 | 售出后旧内容/发布任务迟到 | 内部包失效、旧事件不重新上架；没有第三方状态写入。 |
| AC47 | 后续 | 远端创建成功但响应超时 | 无真实外部创建接口，不能称已验收。 |
| AC48 | 部分 | Worker崩溃、重复/乱序Webhook | 真实SIGKILL抢占恢复、双Worker、过期令牌拒绝与有界失败已验证；第三方Webhook尚未接入。 |
| AC49 | 后续 | 独立站缓存旧库存、未收到Webhook | 展厅只读且动态过滤；没有checkout、支付和异站缓存对账。 |
| AC50 | 内部覆盖 | 图片授权撤回 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC51 | 内部覆盖 | 关闭AI或模型任务过期 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC52 | 部分 | 越权查询、导出、扫码、后台任务 | 角色、private图片、候选、导出接口均授权；暂无二维码/多工作区分发。 |
| AC53 | 部分 | 备份恢复与发号恢复 | 本地离线备份恢复核对实际 Prisma 模型清单和素材哈希，当前源码结果见 VALIDATION；未实现正式Compose异地自动备份/多可用区灾备。 |
| AC54 | 部分 | 季度对账完整性核验 | 内部对账检查待补收支、相关冲突、已售无Sale记录；不能自动证明外部平台交易未漏报。 |
| AC55 | 内部覆盖 | 正常建档、历史迁移和关联已有商品 | 正式Item和Cycle原子建立；没有成熟历史经营周期迁移工具。 |
| AC56 | 内部覆盖 | 主编号与旧别名交叉冲突 | 旧编号归属唯一、不能占用TM数字空间、支持检索；永久编号不回收。 |
| AC57 | 内部覆盖 | 修改草稿但尚未批准 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC58 | 内部覆盖 | 确认版本期间他人更改输入 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC59 | 内部覆盖 | 无人编辑但授权/供货/报价自然过期 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC60 | 内部覆盖 | 三用途同需尺寸、商品价格改变 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC61 | 内部覆盖 | 售出时例外无效或财务/规则资料缺失 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC62 | 内部覆盖 | 售出补录与现有预留/订单冲突 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC63 | 部分 | 人工先记售出，再导入同笔平台订单 | 外部唯一键可关联同笔，模糊第二笔进入Observation；没有平台订单批量导入连接器。 |
| AC64 | 内部覆盖 | 相同幂等键不同内容、已撤销权限重放 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC65 | 内部覆盖 | 全额退款完好退回后再售 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC66 | 内部覆盖 | 部分退款但不退货、或退款未收回实物 | 部分退款保留成本与库存保护；毁损/缺件复杂退回不自动入账。 |
| AC67 | 内部覆盖 | 确认季度预览时费用/例外被修改或重复确认 | 确认时复算摘要并序列化相关财务命令，拒绝过期预览、重复期间和错误更正基础。 |
| AC68 | 部分 | 未激活真实协议规则或例外窗口仍开放 | 规则须明确激活；未激活不能确认。真实协议例外窗口和尾单仍须业务单独确认。 |
| AC69 | 后续 | 同Listing退货再售后收到旧订单回调 | 无外部订单回调。 |
| AC70 | 后续 | 源事件100晚于101提交 | 无外部增量游标变更流。 |
| AC71 | 内部覆盖 | 开发启动或恢复含待发送Outbox的备份 | 对应实现见模块说明；对应自动化场景见test/unit.test.cjs及test/integration.test.cjs。 |
| AC72 | 部分 | 来自不同工作区或不同Item的关联组合 | Item-Cycle、Item-ApprovedRevision有复合锚点；不是全模型多租户隔离。 |
| AC73 | 部分 | 独立站展示＋人工外部渠道＋基础AI草稿路径 | 内部展厅＋人工外部渠道＋手工AI候选＋选品合集；没有外部电商结账和付费模型调用。 |
| AC74 | 后续 | 合作结束后新交易、原订单退款与尾单 | 合作终止/尾单/历史退款的正式协议规则未落地。 |

## 尚待业务人员验收
真实库存批次、真实鉴定/授权、朋友例外规则、采购成本口径及实际平台发布流程需要经营者用样本确认。当前自动化使用合成数据，不能替代该确认。

## 持续交付要求
新增功能应补测试再将对应行从“后续/部分”改为覆盖；不得只改这张表。任何依赖真实账号、交易、费用、协议签署件的步骤没有证据就保留待确认。

## 生产验收不等于蓝图全覆盖

模型清单以 prisma/schema.prisma 与当前恢复报告为准；没有声明所有74项已通过。真实外部平台、联网AI、订单多行/公共费分摊、物流签收、多工作空间、汇率与最终合作终止规则保留后续范围。Linux生产模式容器运行、HTTPS、最小权限、故障恢复证据见本版VALIDATION。

## 0.4 补充验收映射（不是74项全部实现声明）
AC01/08/10/11：整页录货允许不完整资料，同页保存图片；供应商包袋复用来源资料，无强制重拍或量测。AC02/09/64：建档及图片回执丢失后的重试、并发资料差异合并保留输入和待上传图片。AC17/24：批量入口保留，跨页选择100件以内可连续使用同一个编辑表单；筛选变化清空选择，避免误选。
`test/browser/operations.spec.cjs` 包含完整手工录货→图片复核→渠道资料→下载→登记发布→我方售出旅程，并核对实际库存与停售目标；不会向真实第三方发布。全部测试及实际运行证据以本版本 summary.json 为准。
数据库结构沿用0.3（39个模型），本轮没有新迁移。原有生产部署与外部集成限制不因界面更新而消失。

## 误录清理增补
新增可恢复的单件删除、批量删除与回收站；不自动清空用户数据，不绕过成交、成本、预留或渠道下架要求。对应 test/integration.test.cjs 和 test/browser/workbench.spec.cjs 的回收站测试。

## 本次增补：删除与恢复
新增回收站不作为新的蓝图验收编号，也不代表其他未完成项完成。单件/批量清理和恢复见docs/DELETE-AND-RESTORE.md；8条集成场景保护交易、库存与编号，浏览器覆盖取消、删除、批量选择和恢复。结果以本版运行摘要为准。

## 0.5新增验收：标准字典与可读日志
本轮不改变上表未覆盖业务的状态。字典选项的类型、别名唯一性、权限、停用、历史快照和筛选见integration新增测试；录货中选择、新增、搜索和中文日志见browser/dictionaries.spec.cjs。成色采用VC口径，不宣称所有平台共用。
该模块新增3个数据库模型。恢复模型数以本版实际recovery报告为准，旧版本38/39模型数字为历史描述。没有进行真实库存旧值归一迁移。

## 0.6 operator-workspace acceptance (separate from long-term AC completion)
The existing 74-row implementation boundary is unchanged by moving controls. `test/browser/studio.spec.cjs` adds one-page own/supplier workflows, incomplete-save, explicit review, in-place missing-field correction, cross-channel preservation, concurrent draft handling, image/metadata response-loss recovery, actual file chooser and local listing/sold receipts. `test/integration.test.cjs` verifies the shorter review path still preserves authority, image-rights, foreign-image and version invariants. Actual pass/fail evidence is generated by verify:release, not inferred from this document.

## 0.7 interaction acceptance
0.7 does not claim new blueprint capability. It changes how existing capabilities are reached: catalog-first navigation, direct product editing, two primary product actions, contextual inventory/menu actions, compact default filters, and preserved advanced screens. `test/browser/ux2.spec.cjs` is a required dual-browser gate; all previous business assertions remain active.


## 0.8 visual-system acceptance
0.8 does not change the 74 long-term blueprint acceptance rows. It makes the existing operator capabilities visually coherent and adds a dual-browser UI structure gate: one final visual owner, business-order mobile product layout, non-overlapping desktop publishing, restrained catalog status/action density, and mobile reachability of all top-level business sections. All previous functional and recovery tests remain active.

## 0.9 interaction acceptance
0.9 does not add a new long-term blueprint capability. It tightens operator interaction: one control per business value, searchable brand with stable ID, fixed-select condition/color/material, explicit unselected-text errors, persistent filter display, business-language field names and conditional supplier-image authorization.

`test/browser/ux09.spec.cjs` and `test/browser/ux09-audit.spec.cjs` are required dual-browser gates. Existing dictionary, product, publishing, inventory, finance, permissions, recovery and failure-journey assertions remain active; UI simplification may not bypass them.

## 0.10 高频经营操作验收
快速录货与快速修改是操作层加速器，不改变蓝图中的商品、素材、库存、发布和财务边界。`test/browser/ux10.spec.cjs`验证首次字段范围、连续录货、图片幂等上传/移除、键盘操作、手机几何、保存后完善、快速修改以及并发冲突阻断，并须同时进入 Chromium 与 WebKit。
完整商品工作区的原有回归仍独立执行，确保快速路径没有通过删除底层校验换取更少点击。


## 0.11 多来源采购归集验收
0.11新增采购来源事实层，不改变商品库存和成交真相源。TRR结构合成样本验证7个订单行、2个包裹、折扣/运费/抵用额、平台状态/RMA、订单行金额/平台现价/估计零售价分离、人工经营判断和人民币成本确认。
`test/integration.test.cjs`保护“来源状态不改库存、来源价格不自动变成本、来源成色不自动映射、再次导入保留人工判断”；`test/browser/procurement.spec.cjs`同时进入Chromium与WebKit，覆盖两步导入预览、逐件核对、货源候选、人民币成本和手机布局。

## v1.0 商品中心补充验收
- 外部 Agent 使用短期 ingest token，不能直接写 Item/Sale/Inventory/Cost。
- 候选商品在人工确认前不得创建正式 TM；来源状态和成色不得静默映射为本地库存/标准成色。
- 待确认页面必须真实支持100件一页，并在第101件时分页；Chromium和WebKit同时执行。
- 同一TM支持多个来源；旧 sourceId 仅兼容并迁移回填到 ItemSourceLink。
- TRR成本按确认规则和订单依据生成TM人民币成本；RMA/排除时要求人工确认最终经济支付金额。
- 售出时冻结成本快照，后续采购成本重算不改变历史Sale.cost。
## 1.0.0-rc.2经营行动投影验收
本轮不把任何“部分/后续”长期蓝图场景冒充为已完成。新增`/api/work-queue`只统一现有业务动作入口：候选、Task、Observation、Inquiry、Sale仍使用原模型和原写入规则。集成测试验证五类事项汇总、优先级顺序、BUSINESS隔离和角色可见性；Chromium/WebKit验证经营待办可回到精确候选处理页。

## 1.0.0-rc.5 Credit退款与成本依据
新增验收映射：`test/unit.test.cjs`的“现金与Credit支付退款同值，净额只扣一次且允许全额退回”；`test/integration.test.cjs`的“Credit退款无RMA仍须核对，净支付只扣一次且不反改售出快照”和“成本的现金与确认汇率模式遵守同一Credit规则，混币种拒绝合计”；`test/browser/v1-item-center.spec.cjs`的“Credit退款明细校验后一次算净额，重开保留明细与固定汇率”。后者在Chromium/WebKit同时执行。
范围包含四项明细、逐件退款归属、零净额、固定原汇率、来源变化后的重确认、幂等写入、原成交成本快照。未包含月度汇率采集、跨页成本批量确认、自留件分摊及真实TRR全量导入；这些仍不得标记通过。当前运行结果以对应版本验证报告为准。

## 1.0.0-rc.6 外部资料接收与集中核对
本轮覆盖外部提交清单核对、原文件读取与权限、完整来源资料展示、跨页批量确认和失败恢复；不包含内置采集器、自动月汇率、公开素材授权或真实平台全量验证。
- `test/unit.test.cjs`：“采集检查区分来源缺项、漏传文件和未核验，不能用空字段冒充完整”。
- `test/integration.test.cjs`：“导入清单拒绝漏件漏原图和错误尺寸，缺项单件确认且原文件与权限保留”；“再次稀疏导入保留已采集来源和人工建议，批量确认拒绝过期版本”。后者也验证已确认商品继续补来源图不修改Item素材/人工事实。
- `test/browser/v1-item-center.spec.cjs`在Chromium/WebKit执行：“跨页选择101件分段确认，真实写入回执丢失后重试不重复建档”；“来源图册直接查看全部原图与参数，建档后原地查看不丢人工草稿”；“批量部分失败显示逐件原因，成功移除而失败保留供重新核对”。保留原100件分页及同图身份防重用例。
“清单已核对”只说明与外部工具声明一致；未提交清单不能称资料已收齐，原网页是否漏报需外部采集者及经营者核验。最终结果以rc.6当前指纹验证报告为准。

## 1.0.0-rc.7 真实导入暴露的内部识图缺口
扩展test/browser/v1-item-center.spec.cjs的“来源图册直接查看全部原图与参数，建档后原地查看不丢人工草稿”，核对普通商品库图片数量、实际图片加载与REFERENCE/INTERNAL/未核验保持不变；新增“单件建档清除该件批量勾选并保留其他候选”。两浏览器都执行。真实订单、个人凭据、原图与人工确认记录只在本机data私有目录，不加入自动化或发布包。人民币成本尚缺实际汇率依据，不能以图文建档验收替代全部经营验收。

## 1.0.0-rc.8 source fields in daily work
Browser gate `来源品牌成色与品相在商品常用位置可见，人工等级优先且不伪造字典` in test/browser/v1-item-center.spec.cjs runs in Chromium and WebKit. It confirms unknown source brand remains visible without creating a dictionary entry; catalog table/cards and editor show source condition/details; local grade stays blank until explicitly selected, then takes display precedence while source evidence remains. Escaping, mobile note width and preservation of manually maintained inspection notes are checked. Real business data repair is private operational evidence, not an automated fixture.

Multi-source PostgreSQL gate: `多平台异构字段与无订单门店来源共用协议，来源身份隔离且关联不覆盖TM` (test/integration.test.cjs) covers EUR marketplace vs CNY offline feed, unrelated raw schemas/arrays, source defaults, identical external keys isolated by source, cross-token denial, source-link preservation of Item, and sparse enrichment of unknown fields. It is a synthetic protocol test, not proof that a second real platform collector exists.

上述异构案例还验证无采购订单的来源以REFERENCE关系关联既有TM、显式非默认币种优先以及后续漏传保持既有币种。

## 1.0.0-rc.9 日常UI操作细节
在test/browser/ui08.spec.cjs的Chromium/WebKit门禁新增：
- “列表末行菜单不被裁切，外部点击与Escape收起并可实际修改”：实际命中测试、键盘回焦、普通PATCH保存。
- “商品重置保留测试范围和图片视图，空状态可恢复且选择可见”：TEST范围不切回BUSINESS、选择清空、空列表禁选、视图状态可访问。
- “快速修改完整页入口保护未保存输入，来源等级仍待人工选择”：取消离开保留输入，明确放弃后无服务端写入。
- “手机批量操作随滚动可达，菜单和快速修改不溢出”：390px双列、真实滚动后取消批量选择、实际打开/关闭窗口。
- “候选全部筛选包含已排除，空结果有恢复入口，手机筛选不溢出”：真实导入/排除、全部状态查询、表格切换保留全部、空状态恢复。
- “空待办给出继续操作入口，手机资料弹窗标题与关闭按钮可用”：进入全部事项、弹窗按钮几何和实际点击。
继续保留现有所有业务用例；本轮没有弱化失败/权限/响应丢失断言。新增用例定位到完整编辑表单，排除已关闭弹窗中保留的隐藏输入；候选状态缺失通过新增可见标记修复。最终是否通过以本版本当前指纹summary.json为准。真实商品只用于只读视觉检查，不作为合成回归数据。

## 1.0.0-rc.10 操作路径衔接
新增test/browser/ui08.spec.cjs双浏览器门禁：
- “商品工作区原地记录询盘，真实写入回执中断后重试不丢商品草稿”：真实POST成功后丢回执，同键重试只留一条询盘，商品草稿/版本/库存不变，未知报价仍NULL。
- “从经营待办直接跟进指定询盘，完成后返回待办且不改变库存”：两个客户询盘精确定位一条、更新实际记录、返回后完成项移除。
- “已确认候选不再提供无效勾选，维护商品后返回原候选筛选”：真实封存候选、历史提示可展开、TM维护与返回来源/关键词/状态/视图。
- “最终样式负责侧栏宽度与弹窗间距，不被旧样式覆盖”：实际几何与弹窗点击；继续保留旧触摸、发布与字段验证用例。
新增PostgreSQL用例“询盘精确定位绕过列表上限但保留TEST隔离和角色权限”：500条合成记录外的旧询盘仍可精确读取，联合筛选、TEST与只读角色隔离、待办href一致。合成填充记录仅在tome_test内创建和清理。
测试从GET商品读取比较基线，因为创建接口仅返回身份回执；未改变旧断言以接受错误行为。最终运行结果以rc.10的summary.json为准，合成路径验证不等于所有真实经营场景已验收。

## 1.0.0-rc.11 全系统审查闭环
此前rc.5“跨页成本批量确认未包含”的边界在本版扩展为人工明确确认、逐订单独立事务的批量操作；自动汇率、真实平台全量采集仍未实现。未把蓝图未来能力统一改成通过。
新增PostgreSQL映射：完整经营检索105条、经营账1001笔完整合计导出、询盘并发及追加历史、渠道版本/冻结快照/TEST隔离、只读选品预检、询盘变更使清理预览失效。全部使用tome_test合成资料。
新增`test/browser/system-review.spec.cjs`同时进入Chromium与WebKit：批量定价真实回执丢失重试；询盘冲突保留输入并核对历史；商品经营记录草稿和具体成交；20件选品两件缺项与往返；合集实际写入后响应丢失；渠道修改停用与移动布局；同月两单成本与退款异常及响应丢失；31单采购第二页往返TM。
这轮新增迁移只为Inquiry和Channel加正整数version，已复核旧迁移未变并追加seal。原有库存、媒体、发布、账务、同图候选及恢复门禁全部保留。最终通过数及失败结果由本版verify:release生成，不以文档替代运行证据。
追加“归档原图保留原文件哈希，归入内部凭证后原图和预览同时限制财务权限”的PostgreSQL验证；两浏览器追加“图片归档按商品名称选择，保留来源输入且原图与中文批次状态可用”。批量定价验证桌面弹窗宽度，选品验证手机整页无横向溢出。首次全量运行发现WebKit选品页溢出20px，定位为长渠道选项的WebKit原生下拉装饰溢出，限制控件外观与宽度，并整理手机标题布局，原阈值保持不变，重新执行完整验证。

来源检索补充PostgreSQL用例“货源池用来源名称和原货号找到已关联TM，不把多来源关系误判为待建档”，验证来源名/原货号筛选及已接手状态。

## rc.12 选品边界回归

`test/browser/system-review.spec.cjs`在Chromium与WebKit继续执行「看图选品真实创建后丢失回执，重试只生成一个合集和资料包」：扩展为改名后连续误重试、渠道停用、恢复原提交仍只生成一次。新增「分次加入选品按合并后的数量限制，超限不改变已有选择」：41件合成商品分次加入，超过40拒绝且原选择不丢失。结果以本版完整验证报告为准，不替代真实对客发布验收。

## rc.13 登录恢复与幂等组合回归

`test/browser/interaction.spec.cjs`新增「回执丢失后登录失效」四项真实点击用例，两种浏览器均执行：建档原请求登录失效后改名不重复建档；询盘重复提交阻断；完整录货及图片弹窗上传保留原图哈希、来源与请求号。先实际写入，再对JSON截断响应、对上传丢弃首次成功通知，然后真实注销会话、重新登录，不伪造成功回执。既有首次明确拒绝后纠正来源用例不变。修复前建档和询盘用例均复现失败，记录位于本机data/system-review-rc13；最终结果见本版本validation报告。

## rc.14 记录范围与返回回归

`test/browser/system-review.spec.cjs`在两种浏览器新增成交、询盘、发布三类重置与查看全部路径，断言商品范围、TEST范围、返回地址及回到原编辑器；新增待办进入单条询盘重置后只显示该客户，并返回原待办关键词与范围。使用tome_test合成资料。原权限、分页、记录历史和库存回归保留。最终结果见本版validation报告。


## 1.0.0-rc.15 商品资料库 MVP 追加映射

本段更新日常入口，以用户已确认的三入口和保存后下载为准；旧发布、销售等业务断言保留，仅通过新入口操作。具体通过数、失败修复和源码指纹以本版验证报告为准。

| 场景 | 自动化与边界 |
|---|---|
| 三入口手机操作、按尺码/位置/来源/缺项找货 | product-library.spec.cjs「商品资料库按尺码位置来源及缺项找货，手机三入口可实际切换」；integration 商品资料库筛选与零成本 |
| 本批核对与明确缺项集中确认 | product-library.spec.cjs 批次缺项场景；integration 批量缺项及500件分段重试；完整性和身份阻断沿用 v1-item-center |
| 重导后旧批次记录 | integration「商品资料库：跨批次补采保留历史成员与封存检查，候选只生成同一TM」；追加成员不可变、封批证据不重写；升级前丢失的历史不补造 |
| 原图字节、清楚的金额单位、内部权限 | integration 商品资料库 ZIP 与权限重放场景；product-library.spec.cjs 实际文件选择/下载，核对1500×2000原图字节和1280.00元 |
| 断线且关闭页面后的恢复 | product-library.spec.cjs 批量实际写入丢回执、原图实际上传断线、商品页保存并整理丢回执三个场景；同浏览器/账号恢复，无跨设备草稿声明 |
| 改价/已售/补图/删除后的旧资料 | integration 商品资料库变化与清理摘要场景；浏览器补图后查看变化；图片变化不能只靠 Item.updatedAt |
| 原业务从新入口继续 | ui08 三主入口后从设置打开销售和资源；studio 用真实「更多」进入发布；ux2「新建商品首屏提供保存和下载资料，发布从更多进入」替代原主发布按钮外观断言，保留完整业务检查 |
| 两人同时维护、售出与后补账 | 保留既有 integration / studio / ux2 / interaction 版本、库存、财务和丢回执回归；新集成用例确认售出后可补标题，但普通 PATCH 不能恢复库存 |

原测试调整依据：导航及主按钮来自已确认的 MVP 需求；售出不递增商品文案版本，因此不能要求合法标题补充必定冲突，库存命令与普通字段编辑仍隔离。新权限测试对普通只读 GET 使用机器 token，明确断言未登录拒绝；写入 POST 还会先受 Origin 保护，不能混淆两种拒绝原因。测试仍使用合成数据和真实隔离 PG，不使用个人订单作自动化夹具。

完整首轮发现两条旧入口断言：字典筛选测试在图片首页返回后真实点击「列表」再检查表格；system-review 保留同件第二笔成交/未保存草稿检查，经设置中的维护工具进入待办。仅调整入口，字段、数量、记录与库存断言不变。

## 1.0.0-rc.16 商品工作区 Arco 展示层

| 验收面 | 边界 | 证据入口 |
|---|---|---|
| 商品库与完整编辑 | React + Arco 控件和卡片，日常字段、图片主次分区，手机保持业务顺序；不宣称全站改写 | ui08.spec.cjs、ux2.spec.cjs、ux10.spec.cjs |
| 选择与筛选共存 | 勾选、半选、批量菜单不擦除待提交搜索或已选品牌；Escape 关闭与回焦 | arco-workspace.spec.cjs、interaction.spec.cjs |
| 弹层和批量操作 | 真实 Arco 行菜单在表格外，仍可命中、关闭、快速修改和删除；批量操作从明确菜单进入 | ui08.spec.cjs、workbench.spec.cjs、dictionaries.spec.cjs、system-review.spec.cjs |
| 字段重建与数据保护 | 并发修改后显示差异，保留本次草稿与原图，人工合并后仍需主动保存 | arco-workspace.spec.cjs、operations.spec.cjs、studio.spec.cjs |
| 原图与断线恢复 | 上传、材料导出保持真实原文件字节和请求键；页面关闭再开恢复 | product-library.spec.cjs |

以上所有浏览器套件仍在 Chromium 和 WebKit 执行。实际通过状态见 docs/VALIDATION.md；合成测试不代表经营者试用或公网部署验收。

## 1.0.0-rc.17 商品库排序与分页

arco-workspace.spec.cjs 增加 1440px、390px 两条真实交互：31 件合成商品的顺序反转、第二页、切换 60 件/页回第一页；相同筛选保留选择，已输入筛选在切视图时生效，未选中的品牌阻止变化且保留输入。桌面检查搜索按钮与输入框底边和高度一致，手机检查控件可操作且页面不横向溢出。operations.spec.cjs 的跨页维护改为点击 Arco 的可访问分页入口，仍检验两件 TM 和逐件修改内容，未缩减断言。既有全部套件继续在两种浏览器运行。

## 1.0.0-rc.18 全系统遗留界面清理

| 边界 | 实现与最小验收 | 运行证据入口 |
|---|---|---|
| 单一样式入口 | main.ts 只导入 ui08.css，六份旧文件不再存在，旧 CSS 导入会触发守卫失败 | ui08.spec.cjs 原视觉所有者用例；harness single-visual-owner 与故障注入自测 |
| 全系统主题与布局 | 1440px、390px 各检查 25 个登录后路由，以及登录、展厅；背景、主题和横向溢出，采购边框、间距可见 | arco-workspace.spec.cjs 两条「全系统页面沿用同一主题且采购样式和原生控件不再受旧规则影响」 |
| 筛选、手机与输入焦点 | 导入/货源输入和按钮等高，货源手机页头操作在标题下，设置表格列宽可读，原生登录输入焦点为蓝色 | 同上，两种浏览器均执行 |
| 日常操作与原有保护 | 列表/图片选中态清晰，未选品牌仍阻止应用；货源手工录货直接打开 QuickIntake，关闭返回当前页 | 同上；原字典、商品、库存、素材、恢复等全部行为套件保留 |

原快速修改测试用 TM 具名菜单等待目标商品，避免 hash 导航事件尚未执行时误匹配上一页全部菜单；原草稿保护、来源成色和数据库版本断言不变。新逐页检查等待旧页面卸载再验收目标页面，没有使用刷新掩盖渲染问题。删除失效 CSS 的存在性要求由实际入口守卫替代，studio.spec.cjs/ux2.spec.cjs 及其业务控制器仍在完整验证内。实测结果以 docs/VALIDATION.md 为准。


## 1.0.0-rc.19 浏览、维护和完成路径

本轮不增加长期蓝图业务能力。product-library.spec.cjs 在 Chromium/WebKit 新增：列表查看/相邻浏览/取消零写入/显式保存往返；1440px 与 390px 的真正原图、缩放与原文件字节；已完成批次及重置范围；单件录货结束及下载失败不重复整理；暂停真实写入后丢回执同键恢复且无销售；只读角色无成本、编辑和库存命令入口。
原资料下载测试改为在「生成并下载」前等候真实文件，并保留 ZIP 原图字节、金额单位和补图变化检查。ui08 与 system-review 的候选/采购往返改为先查看、明确编辑、保存回详情再返回来源，仍验证实际文案写入和精确来源条件。旧的直接编辑与手动二次点击下载不是该场景的新期望，领域约束和恢复断言不变。实际结果以本版验证报告为准，未执行前不标记通过。

完整回归衔接：dictionaries/workbench 的详情删除从「更多」进入，仍核对模拟成交隔离、确认删除、原保护与恢复；interaction 的双击保存继续验证请求中字段禁用、单次 PATCH，并在返回详情后同时核对展示内容与实际持久化材质。保存后停留编辑器的旧断言由用户确认的新流程替代，不能只删除该验证。


## 1.0.1-rc.1 UX 与 rc.19 整合

- rc.15–19 既有验收条目继续执行；仅首页默认位置、导航数量和已改为配置选择的渠道控件断言更新。手机用例“商品资料库按尺码位置来源及缺项找货，手机日常入口可实际切换”替代原“三入口”名称，仍检查找货、导入切换与无横向溢出，并扩展工作台/销售可达。
- ux101.spec.cjs 原三项：无 hash 进入工作台；无效图片在建 TM 前阻断；运营可看成交事实且不能读取财务 API。第三项增加从成交链接只读查看商品并返回原查询。
- ux101.spec.cjs 新增“只读详情直接预留和解除，真实写入丢回执后同键重试且不自动恢复可售”：核对唯一预留、每次原命令键、PAUSED 与复核后 AVAILABLE；不通过刷新掩盖渲染问题。
- product-library.spec.cjs 的来源缺项与批量关页恢复检查默认 PAUSED。v1-item-center.spec.cjs 的七件导入明确选 AVAILABLE 并逐件核对状态；同图身份测试仍保留，匹配项改为点击单选控件。
- Harness browser-suite-parity 比较完整文件范围，自测缺失 UX WebKit 文件或跳过 UX 用例应失败。浏览器测试不得删减、skip、放宽业务结果或强制点击。
- 11 个历史 migration、Prisma Schema、迁移封印必须与 bfffa5c 保持一致；相对 main 仅包含已交付 product_materials 迁移。最终运行数量与证据见 docs/VALIDATION.md，不把目标或待执行检查列为通过。

- Linux CI 登录前置：login.cjs 在真实登录 HTTP 201 和用户/CSRF 结构确认后执行原 UI 断言；保持整例 45 秒与 retries=0。ux101.spec.cjs「登录真实响应延迟时先等确定回执，保留页面断言且只提交一次」真实写入后延迟 5.5 秒，核对按钮禁用、唯一提交、工作台与会话。诊断不记录账户输入、Cookie、CSRF 或响应正文。

## 商品成色保存回执回归修正

v1-item-center.spec.cjs 保留「来源品牌成色与品相在商品常用位置可见，人工等级优先且不伪造字典」名称和全部领域断言，扩展真实 PATCH 已提交但回执暂缓的场景。核对后台成色、保存按钮禁用、保存中状态、真实点击取消被保护、单次 PATCH，再释放真实回执；确认已保存且按钮可用后返回列表。原测试仅等数据库值即跳转，未满足 UI 完成前提，可能被正确的离开保护拦住；不延长超时、不重试、不刷新、不删除断言。Chromium/WebKit 同范围执行。

## 登录稳定化：焦点与真实提交

公共 fillLogin 在输入前确认挂载后的邮箱焦点，并以布尔断言核对两个输入均落在正确字段（不打印凭据）；各业务场景仍走真实 UI 和 HTTP 登录，不注入会话。登录页同步设置初始焦点，移除 WebKit 可能延迟抢焦点的原生 autofocus。保留 ux101 的真实响应延迟 5.5 秒且只提交一次回归，两浏览器范围不变。

保存完成提示补充：operations「两人改同一件」在真实图片上传 HTTP 201 后暂缓 XHR 成功事件，断言仍禁用保存且不提前显示全部已保存；释放事件后再验证两个字段及唯一图片。保留原断言，增加对可见完成状态的约束。

## 1.0.1-rc.2 稳定化增量（验收结果以当前 VALIDATION 为准）

| 要求 | 实现 / 真实验证入口 | 边界 |
| --- | --- | --- |
| 单一版本来源与当前文档一致性 | production-config/preflight、release-version、check-current-docs；production-tools.test.mjs | 不同 API/worker/config 版本必须拒绝 |
| 文件补偿与重放 | integration：图片重试、数据库回滚、预览写盘失败、孤儿扫描；product-library：原图实际上传后断线 | 默认扫描不删除，维护删除需独占锁；不覆盖原图 |
| 服务端能力唯一来源 | integration：登录和当前会话能力；ux101：各角色界面使用服务端能力 | 服务端仍重新鉴权；角色改变使旧 Session 失效 |
| 一致性备份与恢复 | verify-production-tools.mjs，production-backup/restore，operations-evidence 单测 | 仅 localhost 合成演练；真实异机副本/人工复核未完成 |
| 图片处理资源预算 | verify-upload-budget.mjs | 4 并发 20MiB / 40M 像素合成测量，非公网容量承诺 |
| PushPlus 显式启用 | production-notify.mjs 与 production-tools.test.mjs | 默认预览；真实通知送达未验收 |

媒体丢回执回归说明：新增真实文件数量断言后，发现旧 product-library 用例在 WebKit 的 route.fetch 转发 multipart 失败时仍伪造 201，因此没有证明首次真实写入。现改为原生 XHR 保留真实 multipart，在实际 HTTP 201 后丢弃回执交付；断言首写恰好新增 original/preview 两文件、关页恢复后相同命令键、一个 Asset、原字节 SHA 和文件数量不再增加。不是放宽失败期望。

## UX 1.0.2 独立增量

- 选品草稿：同账号同浏览器保存商品 ID、名称、渠道、时间；待确认写入只额外保存命令键、包 ID 和原选择 ID，不持久化商品/成本/CSRF。重新打开重读服务器商品。system-review 的关页草稿和真实丢回执用例覆盖恢复及原命令重放。
- 生成选品始终检查当前事实；“检查当前选择”是可选辅助。原“预检全部商品”文字已被该交互取代，失败仍逐件显示并阻止新包生成。
- 批量表单的最终“确认并执行”后立即执行；取消第二次“开始执行”点击，原逐项结果、幂等 key、失败重试断言保留。未经过参数确认的货源接手仍显式“确认执行”。对应 dictionaries/interaction/operations/system-review/workbench 期望按此更新。
- 图片排序由 studio-image-order 负责表示和交互；拖动、上/下移及指定位置共用同一移动逻辑，手机无需 hover；只改变选图顺序，不写原图元数据，瑕疵选图规则不变。studio 的新排序用例验证真实草稿请求及原素材不变。
- 商品详情和编辑共用 studioStock；按库存状态呈现主要动作，暂停商品仍可从更多登记实际售出，未知财务不阻断。

## v1.1 Agent Ingest Standard v1.2

本增量只标准化机器采集入口，不把长期蓝图中的外部发布、远端回执、独立站交易或自动库存同步改成“已覆盖”。`/api/agent-ingest` 仍是候选层唯一合同：服务端提供带 SHA-256 的 Skill 和按来源选择的 Profile，Profile 必查字段与 Agent Manifest 额外字段一起参与真实封批检查。MCP 的六个工具与 CLI 都复用相同 `IngestService`，不暴露确认候选、TM、库存、成交、成本或发布；图片仍经 multipart 保留原文件验证。

`test/integration.test.cjs` 新增标准协议/Profile 降级拒绝、HTTP 与 MCP 黄金夹具等价、CLI 重启重用幂等状态且无 Token 的真实 PostgreSQL 场景。它们使用 `tome_test` 合成来源，不证明任何第三方网页、账号或真实订单已经接入。

### v1.2 新机器 Batch 强制化

`test/integration.test.cjs` 继续用真实隔离 PostgreSQL 验证：新 HTTP 和 MCP Batch
缺少 protocolVersion/skillVersion/profile 时都返回 400；历史数据库中已存在、同来源同批次键
且同清单的旧 Batch 仍可读取和幂等重试；Profile 服务端必查字段依旧与 Agent 声明取并集。
MCP 回归分别用 `X-Ingest-Token` 与同一 Token 的 Bearer 头完成 initialize/tools/list/工具调用，
覆盖 Codex、WorkBuddy 一类桌面 MCP 客户端的两种认证接法，但只使用合成 `tome_test` 资料，
不宣称已经连接或验收任何外部 Agent 应用。

## v1.1 Distribution Foundation

本增量把既有分发表收敛为标准资料交付与轻量经营记录，不把真实平台发布、独立站、自动库存同步或渠道定价解析写成“已覆盖”。`DistributionAttempt` 保留 PUBLISH/UPDATE/DELIST 和内部状态，但默认 UI 显示待交付、已交付、已确认完成、需要处理、需要核对、已取消；Token/领取/租约只保留为高级兼容接口。`Listing` 仅在稳定远端 ID 已知时建立。APP 渠道成功但无 ID 时依赖标题中的永久 TM 复核，禁止 `MANUAL:TM...` 伪造 ID。

`test/integration.test.cjs` 的 Distribution Foundation 场景使用 `tome_test` 合成包，覆盖 Token 仅存哈希且不能访问正常写接口、渠道隔离、FAILED 复用原记录、UNKNOWN 在原记录附依据人工核对、成功核对会清除过期错误、稳定 ID 冲突拒绝、无 ID 成功不创建 Listing，以及冻结资料指纹驱动的 PUBLISH/UPDATE/NOOP 与停售后重新交付。`test/browser/operations.spec.cjs` 在 Chromium/WebKit 用真实登录、真实图片上传和点击覆盖分发中心的交付语义与 UNKNOWN→FAILED 原记录核对。它们不证明任何真实账号、页面、远端 archive ID、渠道价格生效或经营成交。

ChannelPrice、Sale/Inquiry 的可空 `channelId` 和 `Sale.inquiryId` 在本基础上由后续 Real Operations 接入；本节只证明资料交付记录与受限高级接口。历史 migration 保持封印，新 migration 单独校验。

## v1.1 标准分发交付合同

`agent/skills/tome-distribution` 为 ANQICMS、XIANYU、VC、GRAILED、CAROUSELL 给出边界 Profile；它只要求外部执行方原样使用 Channel、永久 TM、冻结标题/正文/价币种和有序图片，不规定登录、验证码、selector、浏览器、ADB 或平台 API。Handoff HTTP 与 `/api/mcp/distribution` 仅提供 list/get-package/report-published/report-attention。取包才将 PENDING 记为已交付，图片下载受当前 Channel 会话和冻结包约束；回传会在 Audit/Receipt/Outbox 事务内再次核验会话与创建者发布权限。

`test/integration.test.cjs` 的“标准分发交付合同”使用隔离 `tome_test` 覆盖渠道隔离、冻结价格和 DEFECT 图片顺序、无租约交付、图片范围、四个 MCP 工具、Origin 拒绝、无 remoteId 成功、source-linked DELIST 的 identity-only 交付、`ATTENTION → UNKNOWN` 的人工核对阻断、伪 `MANUAL:` ID 拒绝和创建者降权后的 Token 拒绝。它不执行平台发布，不包含任何真实账号、Cookie、验证码、archive ID 或外部经营 UAT。

## v1.1 来源关联的停售记录

`202609170015_distribution_source_attempt` 只新增可空自关联 `sourceAttemptId` 和索引，不改写历史 Attempt 或 migration。`planStopDistribution` 在既有 Item 锁、Receipt、Audit、Outbox 事务内覆盖 AVAILABLE 到 RESERVED、PAUSED、SOLD、GIFTED、SELF_USE、SUPPLIER_SOLD、QUARANTINED；对每个当前周期已确认发布的渠道，用 `delist:<sourceAttemptId>` 建立一条需要停售记录。历史无关联 DELIST 保持原事实并防重；恢复 AVAILABLE 不产生 PUBLISH/UPDATE，迟到成功回执在商品已不可售时补建同一来源关联记录。

`test/integration.test.cjs` 的 `Distribution stop records` 场景逐项覆盖七种不可售状态、双渠道、历史无关联记录兼容、恢复不自动重新交付及再次发布后的独立停售；`test/browser/operations.spec.cjs` 在真实登录、图片上传、资料交付、售出点击链中核对 DELIST 指向对应 PUBLISH。它们只验证隔离 `tome_test` 的经营记录与 UI 行为，不证明任何外部平台已经停售。

## v1.1 Real Operations

本增量把渠道报价、询盘成交和下架计划接入已有领域命令，不重写 Item、Sale、成本、库存、UsePackage、图片权利或 Agent 边界。`202609170013_real_operations_price_basis` 只给草稿增加有效价来源/版本；`202609170014_channel_price_revision_continuity` 以禁用覆盖保留版本连续性，避免清除再恢复相同金额时误复用旧使用包。两项都是独立前向 migration。

`resolveChannelPrice` 统一在启用 ChannelPrice 与 Item 默认价间选择。Readiness、预览、PublishingDraft、UsePackage 创建和有效包复核都使用该结果；AnQiCMS 以 USD、闲鱼以 CNY 作为最低交易资料币种要求，不自动换汇。批量批准先只读预检，实际批准逐件复用原 `POST /items/:id/approve`，批量渠道价与分发计划同样逐件保留幂等、item lock、Audit、Receipt 和失败结果。

`POST /api/inquiries/:id/convert` 锁定 Item 后检查版本、可售性、预留和既有 Sale，在同一事务创建 Sale、停售、标记 WON、写审计/事件并为已成功分发渠道创建去重 DELIST Attempt。若发布租约先领取、成功回执后到，回执落库也补建同一去重 DELIST Attempt。普通状态接口拒绝 WON 及已转化记录的后续改写。没有 Listing 的 APP 成功发布同样按永久 TM 创建下架执行记录；待办将待下架、UNKNOWN、询盘、FAILED 和财务补录按 100/95/85/70/30 显示。

`test/integration.test.cjs` 使用隔离 `tome_test` 覆盖 USD 覆盖价、默认价不覆盖渠道价、清除/恢复后旧包仍 stale、Inquiry→Sale→SOLD 原子性、预留冲突、无 Listing 下架、批量批准预检和队列优先级。`test/browser/operations.spec.cjs` 用真实登录和点击覆盖确认成交、停售和分发中心显示；两个浏览器范围仍由当前文档守卫锁定。它们不证明真实账号、平台页面、AnQiCMS archive ID、支付或外部发布。

### 渠道价与询盘币种交互补充

`test/integration.test.cjs` 的“渠道账号币种约束、渠道价和询盘默认值不混用商品默认币种”覆盖 AnQiCMS/闲鱼固定币种、其他账号默认币种、创建/编辑/写价后端拒绝、跨币种不复制金额及询盘 NULL/有效价默认。`test/browser/operations.spec.cjs` 在 Chromium/WebKit 以真实点击覆盖批量渠道切换时币种与金额模板同步、设置页固定平台默认币种，以及询盘表单带出有效渠道价。它们只使用 `tome_test` 合成商品，不证明汇率、真实报价、真实平台或财务结算。

## v1.1 AnQiCMS 本地标准交付合同

本增量不实现真实 Connector。受限兼容读取面可以为 AnQiCMS Attempt 生成 `tome.anqicms.spike/v1` 本地资料投影：新建先按 `tm_code` 保护性查找，已有稳定 archive ID 时更新同一页面；前 9 张公开核验实物图进入 Gallery，其余图片保留为正文图片清单，成色等级与瑕疵说明分开且不能丢失。`styleNumber` 是唯一新写入/输出键，旧 `style_number` 仅兼容读取。售出后的 DELIST 是 identity-only `STOCK_ZERO`，只需 TM、当前状态、Channel 和 archive ID，要求库存为 0、页面保留、SOLD、无 Checkout，不重验历史图片或使用包。

`test/fixtures/anqicms-spike/deidentified-20.json` 与单元测试覆盖 20 件脱敏夹具、全部库存状态、USD、图片分流、SEO 字段、styleNumber 兼容规范化、成色双字段、archive ID 规范化和伪 ID 拒绝；隔离集成测试覆盖真实 UsePackage、DistributionSession、Listing 更新，以及历史图片授权失效后仍能输出售出保页合同。它们不连接 AnQiCMS、不验证真实 endpoint/认证/图片上传/Sitemap/页面 URL，也不构成真实 20 件 UAT。具体字段、禁止字段和进入真实 UAT 的门槛见 [ANQICMS-CONTRACT](integrations/ANQICMS-CONTRACT.md)。
