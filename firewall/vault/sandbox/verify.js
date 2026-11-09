import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionCallAccessKey } from "near-api-js/lib/transaction.js";
import { KeyPair, Worker } from "near-workspaces";

const wasmPath = process.env.WARD_VAULT_WASM ??
  new URL("../target/wasm32-unknown-unknown/release/ward_vault.wasm", import.meta.url);
const wasm = await readFile(wasmPath);
const near = 10n ** 24n;
const amount = value => String(BigInt(value) * near);
const worker = await Worker.init({ network: "sandbox", rm: true });

try {
  const root = worker.rootAccount;
  const elder = await root.createSubAccount("elder", { initialBalance: 5n * near });
  const family = await root.createSubAccount("family");
  const pharmacy = await root.createSubAccount("pharmacy");
  const vault = await root.createSubAccount("vault", { initialBalance: 10n * near });
  assert((await vault.deploy(wasm)).succeeded);
  await vault.call(vault, "new", {
    requester: elder.accountId,
    approver: family.accountId,
    payees: [pharmacy.accountId],
    daily_cap: amount(3),
    per_tx_ceiling: amount(2),
    approval_threshold: amount(1),
    time_windows: [],
  });

  const original = await elder.getKey();
  const restricted = KeyPair.fromRandom("ed25519");
  const permission = functionCallAccessKey(vault.accountId, ["request_payment"], near);
  const changed = await elder.batch(elder)
    .addKey(restricted.getPublicKey(), permission)
    .deleteKey(original.getPublicKey())
    .transact();
  assert(changed.succeeded);
  await elder.setKey(restricted);
  const { keys } = await elder.viewAccessKeys(elder.accountId);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].public_key, restricted.getPublicKey().toString());
  assert.deepEqual(keys[0].access_key.permission.FunctionCall.method_names, ["request_payment"]);
  assert.equal(keys[0].access_key.permission.FunctionCall.receiver_id, vault.accountId);

  const request = (payee, value) => elder.callRaw(vault, "request_payment", {
    payee: payee.accountId,
    amount: value,
  });

  const start = BigInt((await pharmacy.accountView()).amount);
  await assert.rejects(
    elder.batch(vault).transfer(1n).transact(),
    { type: "RequiresFullAccess" },
  );
  await assert.rejects(
    elder.call(vault, "resolve_payment", { request_id: "1", approve: true }),
    { type: "MethodNameMismatch" },
  );
  await assert.rejects(
    elder.call(vault, "request_payment", { payee: pharmacy.accountId, amount: amount(1) },
      { attachedDeposit: 1n }),
    { type: "DepositWithFunctionCall" },
  );
  await assert.rejects(
    elder.call(pharmacy, "request_payment", {}),
    { type: "ReceiverMismatch" },
  );
  console.log("SANDBOX protocol blocked direct transfer, approval, attached deposit and wrong receiver");

  assert.equal((await request(pharmacy, String(2n * near + 1n))).parseResult().ruleId, "per_tx_ceiling");
  assert.equal((await request(family, amount(1))).parseResult().ruleId, "payee_allowlist");

  const held = await request(pharmacy, amount(2));
  assert.equal(held.parseResult().decision, "HOLD");
  const pending = await vault.view("pending_request_id");
  assert.equal(BigInt((await pharmacy.accountView()).amount), start);

  const allowed = await request(pharmacy, amount(1));
  assert.equal(allowed.parseResult().decision, "ALLOW");
  assert(allowed.logsContain(/"status":"SETTLED"/));
  assert.equal(BigInt((await pharmacy.accountView()).amount), start + near);

  const approval = await family.callRaw(vault, "resolve_payment", { request_id: pending, approve: true });
  assert.equal(approval.parseResult().decision, "ALLOW");
  assert(approval.logsContain(/"status":"SETTLED"/));
  assert.equal(BigInt((await pharmacy.accountView()).amount), start + 3n * near);
  assert.equal((await request(pharmacy, "1")).parseResult().ruleId, "daily_cap");
  console.log("SANDBOX vault enforced payees and caps, held for family approval and settled 3 NEAR");
} finally {
  await worker.tearDown();
}
