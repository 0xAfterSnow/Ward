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
  const browserVaultId = `family-vault.${root.accountId}`;
  const browserVault = root.getAccount(browserVaultId);
  const provisioned = await root.batch(browserVaultId).createAccount().transfer(4n * near)
    .deployContract(wasm).functionCall("new_family", {
      approver: family.accountId, daily_cap: amount(4), per_tx_ceiling: amount(2), approval_threshold: amount(1),
    }, { gas: 100n * 10n ** 12n }).transact();
  assert(provisioned.succeeded);
  assert.deepEqual((await root.viewAccessKeys(browserVaultId)).keys, []);
  assert((await root.batch(browserVaultId).transfer(6n * near).transact()).succeeded);

  const browserKey = KeyPair.fromRandom("ed25519");
  const browserAccountId = Buffer.from(browserKey.getPublicKey().data).toString("hex");
  const browser = root.getAccount(browserAccountId);
  assert((await root.batch(browserAccountId).transfer(near).transact()).succeeded);
  await browser.setKey(browserKey);
  const browserScoped = KeyPair.fromRandom("ed25519");
  await family.call(browserVault, "set_requester", {
    requester: browserAccountId, requester_key: browserScoped.getPublicKey().toString(),
  });
  const payment = { payee: pharmacy.accountId, amount: amount(1) };
  await assert.rejects(browser.call(browserVault, "request_payment", payment), /Scoped requester key only/);
  assert((await browser.batch(browserAccountId)
    .addKey(browserScoped.getPublicKey(), functionCallAccessKey(browserVaultId, ["request_payment"], near / 10n))
    .deleteKey(browserKey.getPublicKey()).transact()).succeeded);
  await browser.setKey(browserScoped);

  const direct = await browser.callRaw(browserVault, "request_payment", payment);
  assert(direct.logsContain(/"status":"SETTLED"/));
  const hold = await browser.call(browserVault, "request_payment", { ...payment, force_review: true });
  assert.equal(hold.ruleId, "requested_review");
  const state = await browserVault.view("wallet_state");
  assert.equal(state.pending.payee, pharmacy.accountId);
  await family.call(browserVault, "set_frozen", { frozen: true });
  assert.equal((await family.call(browserVault, "resolve_payment", {
    request_id: state.pending.id, approve: true,
  })).ruleId, "wallet_frozen");
  await family.call(browserVault, "set_frozen", { frozen: false });
  await family.call(browserVault, "set_limits", {
    daily_cap: amount(5), per_tx_ceiling: amount(2), approval_threshold: amount(1),
  });
  assert((await family.callRaw(browserVault, "resolve_payment", {
    request_id: state.pending.id, approve: true,
  })).logsContain(/"status":"SETTLED"/));
  await family.call(browserVault, "set_requester", { requester: null, requester_key: null });
  await assert.rejects(browser.call(browserVault, "request_payment", payment), /Requester only/);
  assert((await family.callRaw(browserVault, "withdraw", { amount: amount(1) })).succeeded);
  console.log("SANDBOX family vault has no access keys and enforced scoped spending, freeze and disconnection");
  if (process.env.WARD_SANDBOX_FT_WASM) {
    const token = await root.createSubAccount("stable");
    const tokenWasm = await readFile(process.env.WARD_SANDBOX_FT_WASM);
    assert((await token.deploy(tokenWasm)).succeeded);
    await token.call(token, "new", {
      owner_id: token.accountId, total_supply: "100000000",
      metadata: { spec: "ft-1.0.0", name: "Sandbox USD", symbol: "sUSD", decimals: 6 },
    });

    const stableId = `stable-vault.${root.accountId}`;
    const stable = root.getAccount(stableId);
    assert((await root.batch(stableId).createAccount().transfer(4n * near).deployContract(wasm)
      .functionCall("new_token_family", {
        approver: family.accountId, daily_cap: "5000000", per_tx_ceiling: "3000000",
        approval_threshold: "1000000", token: token.accountId,
      }, { gas: 100n * 10n ** 12n }).transact()).succeeded);
    const storage = BigInt((await token.view("storage_balance_bounds")).min);
    for (const account of [stableId, family.accountId, pharmacy.accountId]) {
      await token.call(token, "storage_deposit", { account_id: account, registration_only: true },
        { attachedDeposit: storage });
    }
    const balance = id => token.view("ft_balance_of", { account_id: id });
    assert.equal(await balance(stableId), "0");
    await token.call(token, "ft_transfer", { receiver_id: stableId, amount: "5000000" }, { attachedDeposit: 1n });
    assert.equal(await balance(stableId), "5000000");

    const tokenSpender = await root.createSubAccount("stable-spender");
    const tokenOriginal = await tokenSpender.getKey();
    const tokenScoped = KeyPair.fromRandom("ed25519");
    await family.call(stable, "set_requester", {
      requester: tokenSpender.accountId, requester_key: tokenScoped.getPublicKey().toString(),
    });
    assert((await tokenSpender.batch(tokenSpender)
      .addKey(tokenScoped.getPublicKey(), functionCallAccessKey(stableId, ["request_payment"], near))
      .deleteKey(tokenOriginal.getPublicKey()).transact()).succeeded);
    await tokenSpender.setKey(tokenScoped);
    const requestToken = value => tokenSpender.callRaw(stable, "request_payment",
      { payee: pharmacy.accountId, amount: value }, { gas: 80n * 10n ** 12n });
    assert.equal((await requestToken("3000001")).parseResult().ruleId, "per_tx_ceiling");
    assert((await requestToken("1000000")).logsContain(/"status":"SETTLED"/));
    assert.equal((await requestToken("2000000")).parseResult().decision, "HOLD");
    const pendingToken = await stable.view("pending_request_id");
    assert((await family.callRaw(stable, "resolve_payment", { request_id: pendingToken, approve: true },
      { gas: 80n * 10n ** 12n })).logsContain(/"status":"SETTLED"/));
    assert.equal(await balance(pharmacy.accountId), "3000000");
    assert((await family.callRaw(stable, "withdraw", { amount: "500000" },
      { gas: 80n * 10n ** 12n })).succeeded);
    assert.equal(await balance(family.accountId), "500000");
    assert.equal(await balance(stableId), "1500000");
    console.log("SANDBOX token vault settled 3 test tokens and withdrew 0.5");
  }
} finally {
  await worker.tearDown();
}
