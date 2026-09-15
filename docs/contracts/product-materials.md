# 商品资料包接口（1.0.0-rc.15）

资料包是内部交接快照，不是公开发布包。普通用户使用同源 Cookie、CSRF 和 Idempotency-Key；机器采集 token 不授予此接口权限。接口列在 OpenAPI，完整输入约束以 materials.controller.ts 的 Zod 为准。

## 创建与查询

- POST /api/material-exports：title（最多160字）、scope（OPERATIONS 默认 / INTERNAL）、dataMode（BUSINESS 默认 / TEST）、items（1至100个去重的 id/version）。检查当前角色、各商品版本与数据范围。INTERNAL 需要 finance；相同键和输入返回原结果，重放前仍核验权限。返回 id、count。
- GET /api/material-exports?page=1&dataMode=BUSINESS：每页30批；仅展示当前角色能读的范围。测试商品不会混进默认经营资料。
- GET /api/material-exports/:id：整理时间、范围、每件整理时和当前资料、changes。已删除的商品标记回收站；已移出数据范围时不返回原快照内容。
- GET /api/material-exports/:id/download：原图 ZIP。资料已有变化时409并要求重新整理；单包原文件总量上限2GB。原文件不存在或损坏时失败，不以缩略图替换。流式响应中断后重新下载即可，不另建资料记录。

创建快照使用逐商品锁和原商品版本检查，创建审计与幂等回执同事务。下载重新核对当前库存、文案、字典用词、售价/币种、图片集合和顺序/属性、旧编号；内部范围另核对成本、位置与来源。图片补传即使未更新 Item.updatedAt，也会显示变化。下载校验原文件字节数和 SHA256，并在完成耗时校验后再次检查权限/变化。

## 包内容与字段

- 商品清单.csv：UTF-8 BOM、中文表头，金额为元且小数两位。未知金额空白；0.00 表示已知零。公式起始字符作为文本输出。各商品保留自身币种，不跨币种合计。
- 商品资料.json：format=tome-materials/1；amountUnit=MINOR_UNIT_100；priceMinor 为 currency 指定币种的整数百分之一单位；costCnyMinor 为人民币分，未知为 null。包含生成记录ID、时间、TM/code、id/version、资料、原文件名、SHA256、顺序、素材角色/来源/权限及包内路径。
- 商品/TM…/商品资料.txt：单件名称、参数和文案。原图按 TM 放置，序号保留顺序；原文件内容不转码不缩小，包内文件名会清理非法路径字符，originalName 原值在JSON中保留。

OPERATIONS 按明确字段白名单输出运营信息，包含来源品牌/成色等辨认信息；不输出任意原始 JSON、内部备注、采购款、DOCUMENT 或 AI_MARKETING 素材。INTERNAL 额外含成本、位置、完整已维护 facts、来源 payload 和内部素材，仅限财务权限。财务字段不能靠客户端隐藏保护。

资料下载仅供已有权限下的内部参考，不能替代外部使用许可、公开接口过滤或平台下架。原文件已下载至他人设备后无法远程撤回；再次下载前会检查变化。

## 断线恢复与限制

前端提交前把账号、原输入与请求键存入同浏览器的 IndexedDB，丢回执后重开下载继续原提交。输入变化不能静默复用旧内容；需核对旧记录或结束该次尝试。结束本地尝试不会删除服务器历史。

成功记录保存在服务端，两个账号可按各自权限查看同一批资料。恢复草稿依赖原浏览器存储，不是跨设备文件同步。尚未实现 AnQiCMS 专用数据接入或公网协作部署。
