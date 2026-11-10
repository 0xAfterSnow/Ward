import assert from "node:assert/strict";
import { test } from "node:test";
import { previewFunding } from "./funding.js";

const input = {
  amount: "1000000",
  recipient: "vault.example.near",
  refundTo: "0x0000000000000000000000000000000000000001",
};

test("uses 1Click dry quotes and returns only the preview amounts", async () => {
  const result = await previewFunding({ ...input, dry: false, jwt: "test-jwt" }, async (url, request) => {
    assert.equal(url, "https://1click.chaindefuser.com/v0/quote");
    assert.equal(request.method, "POST");
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.Authorization, "Bearer test-jwt");
    const body = JSON.parse(request.body);
    assert.equal(body.dry, true);
    assert.equal(body.recipientType, "DESTINATION_CHAIN");
    assert.equal(body.originAsset, "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near");
    assert.equal(body.destinationAsset, "nep141:wrap.near");
    assert.equal(body.amount, input.amount);
    assert.equal(body.recipient, input.recipient);
    assert.equal(body.refundTo, input.refundTo);
    return Response.json({
      quoteRequest: body,
      quote: { amountIn: input.amount, amountOut: "100000000000000000000000", timeEstimate: 100 },
    });
  });
  assert.deepEqual(result, {
    dry: true,
    amountIn: input.amount,
    amountOut: "100000000000000000000000",
    destinationAsset: "nep141:wrap.near",
  });
});

test("rejects unexpected deposit addresses and fails closed on HTTP errors", async () => {
  const quote = { depositAddress: "unexpected", amountIn: "1", amountOut: "2" };
  await assert.rejects(
    previewFunding(input, async () => Response.json({ quoteRequest: { dry: true }, quote })),
    /valid dry-run quote/,
  );
  await assert.rejects(
    previewFunding(input, async () => new Response("details", { status: 429 })),
    /HTTP 429/,
  );
});

test("passes the selected USDC chain to 1Click and rejects unknown sources", async () => {
  for (const [source, asset] of [
    ["base", "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"],
    ["ethereum", "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near"],
  ]) {
    await previewFunding({ ...input, source }, async (url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.originAsset, asset);
      assert.equal(body.dry, true);
      return Response.json({ quoteRequest: body, quote: { amountIn: "1", amountOut: "2" } });
    });
  }
  await assert.rejects(previewFunding({ ...input, source: "unknown" }, () => assert.fail()), /selected chain/);
});
