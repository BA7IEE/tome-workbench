# 成本依据接口补充（1.0.0-rc.5）

`POST /api/costing/orders/:id/basis` 继续要求 finance 权限、CSRF、Idempotency-Key、version 与 confirmed=true。现有字段不变，新增可选 `paymentBreakdown`（省略或null沿用直接净额方式）。金额均是订单币种的整数分。

```json
{
  "paymentBreakdown": {
    "cashPaid": 30000,
    "creditUsed": 10000,
    "cashRefunded": 0,
    "creditRefunded": 5000,
    "lineRefunds": []
  }
}
```

四个支付退款字段必须齐全且非负；现金与Credit支付是退款前总额。净额为35000，持久化到foreignEconomicTotalOverride；若同时提供该字段，必须等于计算净额。全额退款后的0合法。来源必须启用Credit视同支付规则，不接受退款大于全部支付。请求中的明细作为证据存入依据修订快照；`GET /api/costing/orders/:id/preview` 的paymentBreakdown返回已确认明细。

可选lineRefunds为`[{"lineId":"本订单行UUID","amount":5000}]`，amount须大于0，同一行不能重复，合计须等于cashRefunded+creditRefunded。未填写或空数组表示人工确认采用整单净额比例分摊。填写时只冲减指定行，不能引用其他订单、未保留商品，也不能形成负采购分摊。

ACTUAL_CASH_CNY模式将cashPaidCny除以原始cashPaid推导汇率；没有明细时使用来源paymentAmount。确认即固定fxMicros；修改退款而保持原现金扣款时保留原汇率，显式提供汇率视为重新确认。原支付0不能推导汇率，应提供确认汇率。旧依据没有固定汇率时不从已更新的来源金额自动补算。

依据修订保存orderVersion和sourcePolicyVersion。后续版本变化阻止写入，必须重确认。现金/信用退款信号触发净额确认，但不自动识别退款方向或扣款是否已净额化，不自动更改库存。单件成本使用同一原汇率，按分处理尾差；CostEntry仍按原事务锁作废并替换，Sale.cost历史快照保持不变。

来源规则支持两种明确的分摊权重。`PROPORTIONAL_LINE_AMOUNT` 使用订单行原价，保留给没有逐件折后金额的来源；`PROPORTIONAL_LINE_NET_AMOUNT` 使用 `sourceLineNetAmount`。TRR 应使用后者，因为同一订单各件商品折扣率可能不同。它把最终经济支付总额（现金、Credit、退款按上述规则核对后的结果）按逐件折后金额比例分摊，整单尾差仍按分闭合；缺少任何已保留商品的正数折后金额时阻断，不得退回原价比例猜测。`sourceCurrentPrice` 是平台另行显示的当前价，不参与此算法。

切换来源分摊规则会增加来源版本，已有订单成本依据因此失效，必须重新确认；既有成交成本快照不反改。迁移只增加字段和可选规则，不从历史 `sourceCurrentPrice` 自动回填折后金额，也不自动改现有来源规则。
