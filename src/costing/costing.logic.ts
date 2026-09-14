type Weight = { id: string; weight: number };
export type PaymentBreakdown = {
  cashPaid: number;
  creditUsed: number;
  cashRefunded: number;
  creditRefunded: number;
};

// All amounts are in minor units of the order currency, before any FX.
// Refund destinations do not change their economic value.
export function netPayment(b: PaymentBreakdown) {
  if (
    [b.cashPaid, b.creditUsed, b.cashRefunded, b.creditRefunded].some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    )
  )
    throw new Error("支付与退款金额必须是非负整数分");
  const net = b.cashPaid + b.creditUsed - b.cashRefunded - b.creditRefunded;
  if (net < 0 || net > 2000000000)
    throw new Error("退款不能超过现金与Credit支付总额");
  return net;
}

export function creditValue(amounts: number[], included: boolean) {
  return included ? amounts.filter((v) => v < 0).reduce((n, v) => n - v, 0) : 0;
}
export function allocateProportional(total: number, rows: Weight[]) {
  if (total < 0 || !Number.isSafeInteger(total))
    throw new Error("invalid allocation total");
  const valid = rows.filter(
    (r) => Number.isSafeInteger(r.weight) && r.weight > 0,
  );
  const sum = valid.reduce((n, r) => n + BigInt(r.weight), 0n);
  if (!valid.length || sum <= 0n) throw new Error("allocation weights missing");
  const base = new Map<string, number>(),
    remainders: { id: string; remainder: bigint }[] = [];
  let used = 0;
  for (const r of valid) {
    const numerator = BigInt(total) * BigInt(r.weight),
      floor = numerator / sum,
      rem = numerator % sum;
    const amount = Number(floor);
    base.set(r.id, amount);
    used += amount;
    remainders.push({ id: r.id, remainder: rem });
  }
  remainders.sort((a, b) =>
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let n = 0; n < total - used; n++) {
    const id = remainders[n % remainders.length].id;
    base.set(id, (base.get(id) || 0) + 1);
  }
  return base;
}

export function allocateEqual(total: number, ids: string[]) {
  if (total < 0 || !Number.isSafeInteger(total) || !ids.length)
    throw new Error("invalid equal allocation");
  const sorted = [...ids].sort(),
    base = Math.floor(total / sorted.length),
    remainder = total - base * sorted.length;
  return new Map(sorted.map((id, n) => [id, base + (n < remainder ? 1 : 0)]));
}
export function convertByFx(amount: number, fxMicros: number) {
  if (
    amount < 0 ||
    fxMicros <= 0 ||
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(fxMicros)
  )
    throw new Error("invalid fx conversion");
  return Number((BigInt(amount) * BigInt(fxMicros) + 500000n) / 1000000n);
}
export function deriveFxMicros(cashPaidCny: number, paymentAmount: number) {
  if (cashPaidCny < 0 || paymentAmount <= 0)
    throw new Error("cannot derive fx");
  return Number(
    (BigInt(cashPaidCny) * 1000000n + BigInt(Math.floor(paymentAmount / 2))) /
      BigInt(paymentAmount),
  );
}
export function economicForeignTotal(input: {
  paymentAmount: number | null;
  totalAmount: number | null;
  storeCreditAsPayment: boolean;
  storeCredits: number[];
  override: number | null;
}) {
  if (input.override !== null) return input.override;
  const paid = input.paymentAmount ?? input.totalAmount;
  if (paid === null) throw new Error("missing order payment");
  const used = creditValue(input.storeCredits, input.storeCreditAsPayment);
  return paid + used;
}
