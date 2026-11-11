// Circle’s official six-decimal USDC on NEAR testnet.
export const TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

export function usdcToAtomic(value) {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [dollars, cents = ""] = value.split(".");
  return String(BigInt(dollars) * 1_000_000n + BigInt(cents.padEnd(2, "0")) * 10_000n);
}

export function formatUsdc(value) {
  const amount = BigInt(value);
  const fraction = String(amount % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return `${amount / 1_000_000n}${fraction ? "." + fraction : ""}`;
}
