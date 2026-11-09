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
