import { amountOf, isAccountId } from "./policy.js";

const QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";
// Asset IDs confirmed against the official 1Click token catalog.
const ARBITRUM_USDC = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
const WRAPPED_NEAR = "nep141:wrap.near";

export async function previewFunding({ amount, recipient, refundTo, jwt }, fetcher = fetch) {
  if (!(amountOf(amount) > 0n) || !isAccountId(recipient) ||
    typeof refundTo !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(refundTo)) {
    throw new Error("Supply a positive USDC amount, a NEAR recipient, and an Arbitrum refund address");
  }
  const headers = { "Content-Type": "application/json" };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const response = await fetcher(QUOTE_URL, {
    method: "POST",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: ARBITRUM_USDC,
      destinationAsset: WRAPPED_NEAR,
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      amount,
      recipient,
      refundTo,
      deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`1Click quote failed (HTTP ${response.status})`);
  const { quote, quoteRequest } = await response.json();
  if (
    quoteRequest?.dry !== true || !quote || typeof quote !== "object" || "depositAddress" in quote ||
    !(amountOf(quote.amountIn) > 0n) || !(amountOf(quote.amountOut) > 0n)
  ) {
    throw new Error("1Click did not return a valid dry-run quote");
  }

  // UNVERIFIED: live quote responses, 1Click settlement and conversion to native vault funds.
  return { dry: true, amountIn: quote.amountIn, amountOut: quote.amountOut, destinationAsset: WRAPPED_NEAR };
}
