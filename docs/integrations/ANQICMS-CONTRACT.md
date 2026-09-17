# AnQiCMS 标准交付合同 · 本地脱敏版 v1

状态：**本地资料交付合同已验证，ToMe 不连接真实 AnQiCMS API。** 本文冻结交给
外部 Agent MCP/API 或人工的输入、身份、图片和售出语义；不把本地模拟、脱敏回执或
生成的资料描述为真实站点已发布。

## 已验证范围

`GET /api/distribution-agent/attempts/:id/anqicms-spike` 是保留的受限兼容资料读取
接口；它无 HTTP 客户端、无外部端点调用、无凭据读取或数据库写入，只生成
`tome.anqicms.spike/v1` 本地脱敏交付投影。默认产品路径仍是标准 Handoff Skill/MCP，
不要求外部 Agent 使用领取或租约，也不把 ToMe 描述为站点执行 Runtime。

test/fixtures/anqicms-spike/deidentified-20.json 包含 20 件非真实、无客户与经营
资料的脱敏夹具。单元测试覆盖 USD、标准 `styleNumber` 写入与旧
`style_number` 兼容读取、成色等级/瑕疵说明分离、最多 9 张 Gallery 图片、溢出图片
进入正文图片清单、全部库存状态的 stock=0、同 archive ID 更新以及伪远端身份拒绝。
隔离 PostgreSQL 集成测试走实际 DistributionSession、UsePackage、DistributionAttempt、
Listing 和售出后的 DELIST，验证：

1. 无 archive ID 时只允许按 tm_code 保护性查找后新建；
2. 收到稳定 archive ID 后，更新必须复用同一 ID；
3. 售出后的 DELIST 走 identity-only 投影，输出 STOCK_ZERO，stock=0、保留页面、
   显示 SOLD、不开 Checkout；即使历史图片授权已失效也不会读取历史 Package；
4. 成本、供应商、内部位置、内部鉴定依据和合作账不进入输出。

本地测试不连接互联网，不证明 AnQiCMS 的真实字段名、认证方式、图片上传 URL、
页面 URL、SEO 生成、Sitemap 或远端更新行为。

## 固定身份和结果规则

tm_code 是永久外部键，格式为 TM000123。标题可包含 TM，但不能用标题判断是否
同一商品。合同中的 LOOKUP_THEN_CREATE 表示未来 Connector 必须先按 tm_code
保护性查找；只有确认找不到时才创建。

收到真实 API 回执时，只接受明确的 archive_id 作为稳定远端身份：

~~~text
Listing.remoteId = archive_id
Listing.url      = 页面 URL（若 API 返回）
~~~

MANUAL:TM...、纯 TM、空值和含 Token/Cookie/密码特征的文本不能作为 archive ID。
normalizeAnqicmsReceipt() 只规范化脱敏回执为既有 DistributionAttempt 结果格式；
它不会发送请求或保存任何外部凭据。

## 发布与更新资料

有效渠道价必须是 USD。无论 Item 的默认币种为何，若没有有效 USD ChannelPrice，
Readiness 会阻止生成交易使用包和本地交付资料。

| AnQiCMS 合同字段 | 来源 | 约束 |
| --- | --- | --- |
| title | 冻结 UsePackage 标题 | 保留永久 TM |
| content | 冻结 UsePackage 正文 | 必须包含已确认品相/瑕疵披露 |
| price | USD 分单位格式化为两位小数字符串 | 不换汇，不以 0 代替未知值 |
| stock | AVAILABLE 为 1 | 其他状态为 0 |
| images | 使用包排序前 9 张公开且已核验实物图 | API 的 9 张 Gallery 假设待真实 UAT 确认 |
| contentImages | 第 10 张及以后公开且已核验实物图 | Connector 必须让瑕疵图对消费者可见 |
| category、keywords、description、url_token | 冻结分类/正文/永久 TM | SEO 只取商品公开资料 |
| custom.tm_code | 永久 TM | 唯一外部键 |
| custom.brand、size、color、material、measurements、year、collection | 冻结批准版本 | 空值保持空，不凭常识补齐 |
| custom.condition_grade | 冻结的 CONDITION 字典 code | 例如 `VERY_GOOD`；未知保持空，不从瑕疵正文推断 |
| custom.condition_description | 冻结批准版本的瑕疵/使用痕迹说明 | 与等级分开；必须进入正文披露 |
| custom.styleNumber | 冻结批准版本的 `attributes.styleNumber` | 历史 `style_number` 仅兼容读取；所有新写入和输出统一为 `styleNumber` |

读取端点只返回使用包内图片的受限下载路径；分发 Token 仍不能写 Item、库存、成本、
价格、Sale 或 Listing，也不能访问另一个 Channel 的 Attempt。

## 售出页面语义：identity-only

ToMe 的 Item=SOLD 是库存事实。对已有 archive ID 的 AnQiCMS 发布记录，DELIST
只读取当前 Item 的永久 TM/库存状态、目标 Channel 和 Listing.archive ID；它不读取或
重验历史 Package、图片、文案、USD 报价、鉴定或 `validUntil`。输出固定为：

~~~json
{
  "operation": "STOCK_ZERO",
  "identity": { "tm_code": "TM000123", "archive_id": "..." },
  "fields": { "stock": 0 },
  "page": {
    "retain": true,
    "displayState": "SOLD",
    "checkout": false,
    "inquiryOnly": true
  }
}
~~~

这表示未来 Connector 应将页面保留为不可购买的 SEO 历史页，而不是删除页面；
当前系统只生成并验证本地资料，尚未发送这个请求。

## 进入真实外部 UAT / Connector 前的门槛

真实 AnQiCMS 接入需要维护者另行授权，并且只能使用 20 件已脱敏或明确授权的商品。
在连接前必须记录并人工核对：认证与权限范围、实际 endpoint 和字段、图片上传与
9 张上限、tm_code 查找、create/update 幂等、archive ID、页面 URL、USD 金额、
stock=0 售出页、SEO Title/Description/Sitemap，以及失败/超时/重复回执恢复。
任何 Cookie、密码、Token、客户资料或真实经营正文都不能写入源码、测试、日志、ZIP
或数据库明文字段。

ToMe 不计划在核心 Runtime 内实现 REST Connector。外部 Agent 使用 AnQiCMS MCP/API
完成实际操作后，只回传真实 archive ID、链接（如有）和结果；ToMe 仍用既有
DistributionAttempt、Audit/Receipt/Outbox 和 Listing 冲突保护记录该事实，不能旁路写
Item、库存或 Sale。

本 PR 没有连接外部 Agent、AnQiCMS MCP/API 或真实经营资料，因此 **20 件真实授权商品
UAT 尚未执行**；本地 20 件脱敏夹具只验证合同形状，不能替代该门槛。
