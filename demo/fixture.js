const near = 10n ** 24n;
export const amount = whole => String(BigInt(whole) * near);
export const demoClock = () => Date.parse("2026-11-09T12:00:00Z");
export const demoPolicy = {
  dailyCap: amount(5),
  perTxCeiling: amount(3),
  approvalThreshold: amount(1),
  payees: ["pharmacy.test", "grocer.test"],
  timeWindows: [{ startMinute: 480, endMinute: 1200 }],
};
export const labels = { "pharmacy.test": "Oak Street Pharmacy", "grocer.test": "Market Grocer" };

export function formatNear(value) {
  const integer = BigInt(value);
  const fractional = String(integer % near).padStart(24, "0").replace(/0+$/, "");
  return fractional ? `${integer / near}.${fractional}` : String(integer / near);
}
