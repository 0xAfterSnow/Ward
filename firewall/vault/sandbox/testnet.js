import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { isAccountId } from "../../policy.js";

const build = "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='--cfg near -C target-feature=-reference-types,-multivalue' cargo build --locked --manifest-path firewall/vault/Cargo.toml --target wasm32-unknown-unknown --release";
const [mode, flag, ...extra] = process.argv.slice(2);
const wasmPath = new URL("../target/wasm32-unknown-unknown/release/ward_vault.wasm", import.meta.url);
const rpc = "https://test.rpc.fastnear.com";
const near = 10n ** 24n;
const gas = 50n * 10n ** 12n;
const amount = value => String(BigInt(value) * near);

async function main() {
  if (extra.length || !["deploy", "demo"].includes(mode)
    || (flag !== undefined && (mode !== "deploy" || !["--execute", "--preflight"].includes(flag)))) {
    throw new Error("Use npm run deploy:vault:testnet or npm run demo:vault");
  }
  if (mode === "deploy" && !flag) {
    console.log(`npm ci --prefix firewall/vault/sandbox --ignore-scripts
${build}
npm run deploy:vault:testnet -- --execute
npm run demo:vault`);
    return;
  }

  const parent = process.env.WARD_TESTNET_PARENT;
  const keyPath = process.env.WARD_TESTNET_KEYS;
  const sponsorPath = process.env.WARD_TESTNET_SPONSOR_KEY;
  if (flag === "--preflight") {
    const { providers } = (await import("near-api-js")).default;
    const provider = new providers.JsonRpcProvider({ url: rpc });
    const chain = await provider.status();
    if (chain.chain_id !== "testnet" || chain.sync_info.syncing) throw new Error("Testnet RPC is unavailable");
    console.log(`TESTNET RPC | height=${chain.sync_info.latest_block_height}`);
    const wasm = await readFile(wasmPath);
    const module = await WebAssembly.compile(wasm);
    const exports = new Set(WebAssembly.Module.exports(module).map(entry => entry.name));
    for (const name of ["new", "request_payment", "resolve_payment"]) {
      if (!exports.has(name)) throw new Error(`Vault WASM is missing ${name}`);
    }
    console.log(`VAULT WASM | bytes=${wasm.length} | sha256=${createHash("sha256").update(wasm).digest("hex")}`);
    console.log(parent && keyPath && sponsorPath
      ? "Testnet variables are set. Execution also requires explicit approval."
      : "needs testnet config: set WARD_TESTNET_PARENT, WARD_TESTNET_SPONSOR_KEY and WARD_TESTNET_KEYS");
    return;
  }
  if (!parent || !keyPath || (mode === "deploy" && !sponsorPath)) {
    throw new Error("needs testnet config: set WARD_TESTNET_PARENT and WARD_TESTNET_KEYS (deployment also needs WARD_TESTNET_SPONSOR_KEY)");
  }
  const ids = Object.fromEntries(["vault", "elder", "family", "payee"].map(role => [role, `${role}.${parent}`]));
  if (!parent.endsWith(".testnet") || !Object.values(ids).every(isAccountId)) {
    throw new Error("Use a funded named .testnet parent with room for the four subaccount names");
  }

  const { connect, KeyPair, keyStores, transactions } = (await import("near-api-js")).default;
  const keyStore = new keyStores.InMemoryKeyStore();
  const client = await connect({ networkId: "testnet", nodeUrl: rpc, keyStore });
  const provider = client.connection.provider;
  const loadKey = async (id, key) => {
    await keyStore.setKey("testnet", id, key);
    return client.account(id);
  };
  const final = async (label, account, outcome) => {
    const hash = outcome.transaction.hash;
    console.log(`${label} | ${hash} | https://testnet.nearblocks.io/txns/${hash}`);
    const result = await provider.txStatus(hash, account.accountId, "FINAL");
    if (typeof result.status?.SuccessValue !== "string") throw new Error(`${label} failed on testnet`);
    return result;
  };

  const repo = await realpath(new URL("../../../", import.meta.url));
  async function outsideRepo(path) {
    if (!isAbsolute(path)) throw new Error("Use absolute credential paths outside the repository");
    const resolved = await realpath(path);
    const fromRepo = relative(repo, resolved);
    if (!fromRepo.startsWith("../") && !isAbsolute(fromRepo)) {
      throw new Error("Keep testnet credentials outside the repository");
    }
    return resolved;
  }
  async function readKeys(path) {
    const resolved = await outsideRepo(path);
    if ((await stat(resolved)).mode & 0o077) throw new Error("Set credential file permissions to 0600");
    return JSON.parse(await readFile(resolved, "utf8"));
  }
  const chain = await provider.status();
  if (chain.chain_id !== "testnet") throw new Error("RPC did not identify itself as testnet");

  if (mode === "deploy") {
    const wasm = await readFile(wasmPath);
    const { private_key } = await readKeys(sponsorPath);
    const sponsor = await loadKey(parent, KeyPair.fromString(private_key));
    if (!isAbsolute(keyPath)) throw new Error("Use an absolute output path outside the repository");
    const output = join(await outsideRepo(dirname(keyPath)), basename(keyPath));
    const keys = Object.fromEntries([...Object.keys(ids), "restricted"].map(role => [role, KeyPair.fromRandom("ed25519")]));
    await writeFile(output, JSON.stringify({ parent, ...Object.fromEntries(Object.entries(keys).map(([role, key]) =>
      [role, key.toString()])) }), { mode: 0o600, flag: "wx" });

    for (const [role, balance] of Object.entries({ vault: 10n, elder: 2n, family: 1n, payee: 1n })) {
      await final(`CREATE ${role}`, sponsor, await sponsor.createAccount(ids[role], keys[role].getPublicKey(), balance * near));
    }
    const vault = await loadKey(ids.vault, keys.vault);
    const init = {
      requester: ids.elder, approver: ids.family, payees: [ids.payee],
      daily_cap: amount(4), per_tx_ceiling: amount(2), approval_threshold: amount(1), time_windows: [],
    };
    await final("DEPLOY AND INITIALIZE", vault, await vault.signAndSendTransaction({
      receiverId: ids.vault,
      actions: [transactions.deployContract(wasm), transactions.functionCall("new", init, gas, 0n)],
    }));
    const elder = await loadKey(ids.elder, keys.elder);
    await final("ROTATE ELDER KEY", elder, await elder.signAndSendTransaction({
      receiverId: ids.elder,
      actions: [
        transactions.addKey(keys.restricted.getPublicKey(), transactions.functionCallAccessKey(ids.vault, ["request_payment"], near)),
        transactions.deleteKey(keys.elder.getPublicKey()),
      ],
    }));
    await verifyElderKey(provider, ids, keys.restricted);
    console.log(`TESTNET VAULT | ${ids.vault}`);
    return;
  }

  const keys = await readKeys(keyPath);
  if (keys.parent !== parent) throw new Error("The key file is for a different testnet parent");
  const restricted = KeyPair.fromString(keys.restricted);
  await verifyElderKey(provider, ids, restricted);
  const elder = await loadKey(ids.elder, restricted);
  const family = await loadKey(ids.family, KeyPair.fromString(keys.family));
  const call = async (account, methodName, args, expected, settlement) => {
    const outcome = await final(methodName, account, await account.functionCall({
      contractId: ids.vault, methodName, args, gas, attachedDeposit: 0n,
    }));
    const result = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString());
    if (result.ruleId !== expected) throw new Error(`Expected ${expected}, received ${result.ruleId}`);
    const events = outcome.receipts_outcome.filter(receipt => receipt.outcome.executor_id === ids.vault)
      .flatMap(receipt => receipt.outcome.logs).map(log => {
        try { return JSON.parse(log); } catch { return null; }
      });
    const id = events.find(event => event?.event === "payment_decision")?.requestId;
    if (settlement && !events.some(event => event?.event === "payment_settlement"
      && event.status === "SETTLED" && event.requestId === id)) {
      throw new Error(`Missing settlement receipt for request ${id}`);
    }
    console.log(`${result.decision} | ${result.ruleId}${settlement ? " | SETTLED" : ""}`);
    return id;
  };
  const request = (payee, value) => ({ payee, amount: amount(value) });
  await call(elder, "request_payment", request(ids.payee, 1), "policy_pass", true);
  const held = await call(elder, "request_payment", request(ids.payee, 2), "approval_threshold");
  if (typeof held !== "string" || !/^\d+$/.test(held)) throw new Error("Missing held request ID");
  await call(family, "resolve_payment", { request_id: held, approve: true }, "policy_pass", true);
  // The 4 NEAR cap leaves room for the allowlist check after 3 NEAR settles.
  await call(elder, "request_payment", request(ids.family, 1), "payee_allowlist");
}

async function verifyElderKey(provider, ids, restricted) {
  const { keys } = await provider.query({
    request_type: "view_access_key_list", finality: "final", account_id: ids.elder,
  });
  const permission = keys[0]?.access_key.permission.FunctionCall;
  if (keys.length !== 1 || keys[0].public_key !== restricted.getPublicKey().toString()
    || permission?.receiver_id !== ids.vault || permission.allowance == null
    || permission.method_names.length !== 1 || permission.method_names[0] !== "request_payment") {
    throw new Error("The elder must have exactly one key scoped to this vault's request_payment");
  }
}

main().catch(error => {
  // SDK and network errors may include request details. Print safe diagnostics.
  console.error(error.type ? `Testnet operation failed (${error.type})` : error.message);
  if (error.context?.transactionHash) console.error(`Transaction: ${error.context.transactionHash}`);
  process.exitCode = 1;
});
