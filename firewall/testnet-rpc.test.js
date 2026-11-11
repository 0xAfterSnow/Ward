import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestnetReader, nextTestnetNonce } from "./testnet-rpc.js";

test("uses the exact nonce from the matching access key in numeric and string RPC responses", async () => {
  const reader = createTestnetReader(async (_url, request) => {
    if (JSON.parse(request.body).params.request_type === "view_access_key") {
      return Response.json({ error: { cause: { name: "UNKNOWN_ACCESS_KEY" } } });
    }
    return new Response(
      '{"result":{"block_hash":"fixture-block","keys":[{"public_key":"other","access_key":{"nonce":1}},' +
      '{"public_key":"device","access_key":{"nonce":9007199254740993}}]}}');
  });
  assert.deepEqual(await reader.accessKey("fixture.test", "device"), { nonce: 9007199254740994n, blockHash: "fixture-block" });
  assert.equal(nextTestnetNonce("277080876000000"), 277080876000001n);
  await assert.rejects(reader.accessKey("fixture.test", "missing"), { status: 409 });
  assert.throws(() => nextTestnetNonce(undefined), { status: 503 });
});

test("classifies missing keys in legacy RPC result envelopes", async () => {
  const reader = createTestnetReader(async () => Response.json({
    result: { error: "access key ed25519:fixture does not exist while viewing" },
  }));
  await assert.rejects(reader.query("view_access_key", {}), { status: 503, rpcCode: "UNKNOWN_ACCESS_KEY" });
});

test("retries dropped reads and polls the same transaction hash without submitting again", async () => {
  let count = 0;
  const reader = createTestnetReader(async (url, request) => {
    const { method, params } = JSON.parse(request.body);
    assert.equal(method, "tx");
    assert.equal(params.tx_hash, "fixture-hash");
    assert.equal(params.wait_until, "NONE");
    count++;
    if (count === 1) throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    if (count === 2) return Response.json({ error: { cause: { name: "UNKNOWN_TRANSACTION" } } });
    return Response.json({ result: { final_execution_status: "FINAL", status: { SuccessValue: "" } } });
  }, async () => {});
  assert.equal((await reader.finalized("fixture-hash", "fixture.test")).final_execution_status, "FINAL");
  assert.equal(count, 3);
});

test("reports exhausted RPC retries without an internal server error", async () => {
  const reader = createTestnetReader(async () => { throw new TypeError("fetch failed"); }, async () => {});
  await assert.rejects(reader.query("view_account", {}), { status: 503 });
});

test("waits for a newly funded device key to become visible without writing to the chain", async () => {
  let reads = 0;
  let waits = 0;
  const reader = createTestnetReader(async (_url, request) => {
    const { method, params } = JSON.parse(request.body);
    assert.equal(method, "query");
    if (params.request_type === "view_access_key") {
      return Response.json({ error: { cause: { name: "UNKNOWN_ACCESS_KEY" } } });
    }
    assert.equal(params.request_type, "view_access_key_list");
    reads++;
    if (reads === 1) return Response.json({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } });
    if (reads === 2) return Response.json({ result: { keys: [], block_hash: "before" } });
    return Response.json({ result: { keys: [{ public_key: "device", access_key: { nonce: "900" } }], block_hash: "after" } });
  }, async () => { waits++; });
  assert.deepEqual(await reader.accessKey("fixture.test", "device", 3), { nonce: 901n, blockHash: "after" });
  assert.equal(waits, 2);
});

test("looks up the exact device key when the testnet key list is behind", async () => {
  const reader = createTestnetReader(async (_url, request) => {
    const { params } = JSON.parse(request.body);
    if (params.request_type === "view_access_key_list") {
      return Response.json({ result: { keys: [], block_hash: "before" } });
    }
    assert.equal(params.request_type, "view_access_key");
    assert.equal(params.account_id, "fixture.test");
    assert.equal(params.public_key, "device");
    return Response.json({ result: { nonce: "900", block_hash: "after" } });
  });
  assert.deepEqual(await reader.accessKey("fixture.test", "device"), { nonce: 901n, blockHash: "after" });
});
