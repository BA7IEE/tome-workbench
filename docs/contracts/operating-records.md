# rc.11 经营检索与维护协议

所有路径位于`/api`，沿用会话、CSRF、角色和写命令幂等校验。外部Agent令牌不能调用这些经营接口。自动生成路由清单见openapi.json。

- `GET /work-queue`：`scope=ALL|IMPORTANT|NEXT|TASK|CANDIDATE|OBSERVATION|INQUIRY|SALE_FINANCE`、`q`、`page>=1`、`size=1..300`。返回`rows,total,page,size,summary`；total是本次筛选条数，summary为有权查看的全部范围数量。默认size=300，操作页显式size=60。先搜索与排序后分页，不截断来源事实。
- `GET /sales`：`id,itemId,q,channel,customer,dateFrom,dateTo,pending=1,dataMode=BUSINESS|TEST,page,size`。带page返回`rows,total,page,size,summary,scope`；summary.totals按币种给出全部匹配贡献，pending/excluded/included互斥。`export=1`导出全部匹配rows；未传page/export保留旧数组格式和1000条上限。TEST仅管理员可查。
- `GET /inquiries`：同上id/itemId/q/channel/customer/dateFrom/dateTo/page/size，另有`state=OPEN|FOLLOWUP|WON|LOST`。只返回BUSINESS未删除商品；带page返回分页对象，不带保留旧500条数组格式。每行含version。需要sell权限。
- `GET /inquiries/:id/history`：返回`initial`和按版本排列的`rows[{at,detail}]`；detail含inquiryId/version/actorName/previousNotes/previousState/state/notes。读取当前有效经营对象，拒绝TEST/已删除商品及无sell权限。
- `POST /inquiries/:id/status`：`{version,state,notes}`。version为读取时版本，冲突409；notes填写本次沟通，空白保留最新摘要。保存前后内容和版本到审计，不更改库存或推断成交。
- `GET /listings`：id/itemId/q/channel/dateFrom/dateTo/page/size/dataMode，`listingState=LIVE|OFFLINE`筛选发布目标。默认BUSINESS，管理员可显式TEST；历史已删除商品的发布证据保留。带page返回分页对象，不带保留旧1000条数组格式。
- `POST /channels/:id`：`{version,name,locale,titleLimit,active}`，管理员权限。名称1..120，locale=zh-CN|en，titleLimit=16..300，active布尔；platform不可改变。冲突409，更新审计并产生渠道变化事件，不改旧资料包。
- `POST /collections/preflight`：`{itemIds: UUID[1..40],channelId}`，发布权限。只读返回`{ready,rows:[{id,code,issues}]}`，逐件检查当前批准资料/素材权利/可售状态。提交资料包与合集时仍重新验证。
- `GET /procurement/orders`新增month=YYYY-MM，按北京时间采购月份筛选，可与sourceId/q/page组合。集中成本页逐单调用现有basis/preview/commit，不增加机器直写成本权限。
- `GET /intake/files/:id/original`返回持久保存原文件，遵守编辑权限与DOCUMENT财务权限，private/no-store。预览与原文件是不同用途。

所有日期均为北京时间自然日，dateTo包含当天。版本冲突必须重新读取核对；不能换命令键重试一个结果未知的写入。批量操作使用每项固定命令键；既有业务规则不因批量而放宽。

rc.12补充：客户端选品合并上限40件；结果未知时必须保留原请求身份，恢复名称/渠道/商品集合后才可继续原幂等命令。渠道停用不改变已经完成的幂等结果，任何新写入仍按当前渠道与商品状态校验。

rc.13补充：结果未知后收到401或CSRF拒绝不能重置原操作身份。重新认证后仍用原命令键和原载荷核对。只有已明确返回成功才结束该未知请求；首次提交明确校验拒绝仍允许纠正后创建新命令。

rc.14补充：前端重置筛选不清id/itemId等导航上下文，显式查看全部才解除身份范围；两者均保留TEST类型及合法返回路径。服务端查询和权限约定不变。
