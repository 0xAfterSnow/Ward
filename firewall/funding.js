import { amountOf, isAccountId } from "./policy.js";

const QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";
// Asset IDs confirmed against the official 1Click token catalog.
export const fundingSources = Object.freeze({
  arbitrum: { label: "USDC on Arbitrum", asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near" },
  base: { label: "USDC on Base", asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" },
  ethereum: { label: "USDC on Ethereum", asset: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near" },
});
const WRAPPED_NEAR = "nep141:wrap.near";

export async function previewFunding({ amount, recipient, refundTo, jwt, source = "arbitrum" }, fetcher = fetch) {
  if (!Object.hasOwn(fundingSources, source) || !(amountOf(amount) > 0n) || !isAccountId(recipient) ||
    typeof refundTo !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(refundTo)) {
    throw new Error("Supply a positive USDC amount, a NEAR recipient, and an EVM refund address for the selected chain");
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
      originAsset: fundingSources[source].asset,
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
