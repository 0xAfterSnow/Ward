import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import sdk from "near-api-js";
import { isAccountId } from "../../policy.js";
import { WardInputError } from "../../mock-ward.js";

import { createTestnetReader, TESTNET_RPC as RPC } from "../../testnet-rpc.js";
import { TESTNET_USDC, formatUsdc } from "../../testnet-usdc.js";

const { rpc, query, finalized: readFinal, accessKey } = createTestnetReader();
const gas = 50n * 10n ** 12n;
const near = 10n ** 24n;
const { transactions: tx, utils, KeyPair, keyStores, connect } = sdk;
const { base_encode: base58, base_decode: decode58 } = utils.serialize;

function publicKey(account) {
  if (typeof account !== "string" || !/^[0-9a-f]{64}$/.test(account)) {
    throw new WardInputError("A valid testnet device account is required");
  }
  return utils.PublicKey.fromString(`ed25519:${base58(Buffer.from(account, "hex"))}`);
}

export function makeBrowserTransaction({ signer, receiver, key, nonce, blockHash, actions }) {
  const transaction = tx.createTransaction(signer, key, receiver, nonce, actions, decode58(blockHash));
  const bytes = tx.encodeTransaction(transaction);
  return {
    bytes: Buffer.from(bytes).toString("base64"),
    hash: base58(createHash("sha256").update(bytes).digest()),
  };
}

const call = (method, args, prepaid = gas) => tx.functionCall(method, args, prepaid, 0n);
const fields = rules => ({
  daily_cap: rules.dailyCap, per_tx_ceiling: rules.perTxCeiling, approval_threshold: rules.approvalThreshold,
});

export async function openBrowserTestnet({ parent, keyPath, wasmPath, asset = "near" } = {}) {
  if (!isAccountId(parent) || !parent.endsWith(".testnet") || parent.length > 45 || !keyPath || !isAbsolute(keyPath)) {
    throw new Error("Configure WARD_TESTNET_PARENT and the absolute WARD_TESTNET_SPONSOR_KEY path");
  }
  if (!["near", "usdc"].includes(asset)) throw new Error("Unsupported testnet asset");
  const token = asset === "usdc" ? TESTNET_USDC : null;
  const initializer = token ? "new_token_family" : "new_family";
  const keyFile = await realpath(keyPath);
  const repo = await realpath(new URL("../../../", import.meta.url));
  if (!relative(repo, keyFile).startsWith("../") || (await stat(keyFile)).mode & 0o077) {
    throw new Error("Keep the sponsor key outside this repository with mode 0600");
  }
  const { private_key } = JSON.parse(await readFile(keyFile, "utf8"));
  const sponsorKey = KeyPair.fromString(private_key);
  const wasm = await readFile(wasmPath ?? new URL("../target/wasm32-unknown-unknown/release/ward_vault.wasm", import.meta.url));
  const module = await WebAssembly.compile(wasm);
  if (!WebAssembly.Module.exports(module).some(entry => entry.name === initializer)) {
    throw new Error("Build the updated family vault WASM before starting testnet mode");
  }
  const chain = await rpc("status", []);
  if (chain.chain_id !== "testnet" || chain.sync_info.syncing) throw new Error("Testnet RPC is unavailable");
  const keys = new keyStores.InMemoryKeyStore();
  await keys.setKey("testnet", parent, sponsorKey);
  const client = await connect({ networkId: "testnet", nodeUrl: RPC, keyStore: keys });
  const sponsor = await client.account(parent);
  const sponsorAccess = await query("view_access_key", { account_id: parent, public_key: sponsorKey.getPublicKey().toString() });
  if (sponsorAccess.permission !== "FullAccess") throw new Error("The testnet sponsor needs a full-access key");

  async function view(account_id, method_name, args = {}) {
    const result = await query("call_function", {
      account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    return JSON.parse(Buffer.from(result.result).toString());
  }
  const tokenBalance = id => view(token, "ft_balance_of", { account_id: id });
  const registration = id => view(token, "storage_balance_of", { account_id: id });
  let registrationDeposit;
  if (token) {
    const [metadata, bounds] = await Promise.all([view(token, "ft_metadata"), view(token, "storage_balance_bounds")]);
    if (metadata.symbol !== "USDC" || metadata.decimals !== 6) throw new Error("Unexpected USDC contract metadata");
    registrationDeposit = BigInt(bounds.min);
  }

  // Serialize sponsor sends. Check account state before retrying provisioning.
  let tail = Promise.resolve();
  function sponsorWork(work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  async function exists(id) {
    try { await query("view_account", { account_id: id }); return true; }
    catch (error) { if (error.rpcCode === "UNKNOWN_ACCOUNT") return false; throw error; }
  }
  async function send(receiverId, actions) {
    let outcome;
    try {
      outcome = await sponsor.signAndSendTransaction({ receiverId, actions });
    } catch (error) {
      const hash = error.context?.transactionHash;
      if (!hash) throw new WardInputError("Testnet couldn’t complete sponsorship. Retry the same setup in a moment.", 503);
      const result = await readFinal(hash, parent);
      if (Object.hasOwn(result.status ?? {}, "SuccessValue")) return;
      throw new WardInputError("Testnet rejected the sponsor transaction. Check the sponsor balance.", 422);
    }
    const finalized = await readFinal(outcome.transaction.hash, parent);
    if (!Object.hasOwn(finalized.status, "SuccessValue")) throw new WardInputError("Testnet provisioning failed", 502);
  }
  async function ensureGas(account) {
    publicKey(account);
    if (!(await exists(account))) await send(account, [tx.transfer(near / 10n)]);
  }
  const storageAction = id => tx.functionCall("storage_deposit",
    { account_id: id, registration_only: true }, gas, registrationDeposit);

  async function state(address) {
    const result = await view(address, "wallet_state");
    if ((result.token ?? null) !== token) throw new WardInputError("Open this wallet in its original asset mode", 409);
    if (token) result.balance = await tokenBalance(address);
    return result;
  }
  async function available(accountId) {
    const [account, config] = await Promise.all([
      query("view_account", { account_id: accountId }), rpc("EXPERIMENTAL_protocol_config", { finality: "final" }),
    ]);
    const reserve = BigInt(account.storage_usage) * BigInt(config.runtime_config.storage_amount_per_byte);
    const locked = BigInt(account.locked);
    return BigInt(account.amount) - (reserve > locked ? reserve - locked : 0n);
  }

  return {
    asset,
    token,
    ...(token ? { registrationCost: utils.format.formatNearAmount(registrationDeposit.toString()),
      isRegistered: async account => Boolean(await registration(account)) } : {}),
    async provision(approver, rules) {
      publicKey(approver);
      const tag = createHash("sha256").update(approver).digest("hex").slice(0, 16);
      const address = `${token ? "u" : "m"}-${tag}.${parent}`;
      return sponsorWork(async () => {
        const funded = await exists(address);
        if (!funded && (await available(parent)) < 5n * near) {
          throw new WardInputError("Top up the Ward testnet sponsor to at least 5 test NEAR", 503);
        }
        await ensureGas(approver);
        if (!funded) {
          // Create, fund, deploy and initialize in one receipt without adding a vault access key.
          await send(address, [tx.createAccount(), tx.transfer(4n * near), tx.deployContract(wasm),
            tx.functionCall(initializer, { approver, ...fields(rules), ...(token ? { token } : {}) }, 100n * 10n ** 12n, 0n)]);
        }
        const [wallet, access] = await Promise.all([state(address), query("view_access_key_list", { account_id: address })]);
        if (wallet.approver !== approver || !wallet.openPayees || access.keys.length) {
          throw new WardInputError("The provisioned vault has unexpected permissions", 502);
        }
        if (token) {
          for (const account of [approver, address]) {
            if (!(await registration(account))) await send(token, [storageAction(account)]);
          }
        }
        return address;
      });
    },

    state,

    async scoped(account, keyHex, address) {
      if (!account || !keyHex) return false;
      let keys;
      try { ({ keys } = await query("view_access_key_list", { account_id: account })); }
      catch (error) { if (error.rpcCode === "UNKNOWN_ACCOUNT") return false; throw error; }
      const key = keys[0];
      const permission = key?.access_key.permission.FunctionCall;
      return keys.length === 1 && key.public_key === publicKey(keyHex).toString()
        && permission?.receiver_id === address && permission.method_names.length === 1
        && permission.method_names[0] === "request_payment" && BigInt(permission.allowance ?? 0) > 0n;
    },

    async prepare({ op, signer, keyHex, address, args }) {
      const key = publicKey(keyHex);
      let receiver = address;
      let actions;
      switch (op) {
        case "fund": {
          if (token) {
            const balance = await tokenBalance(signer);
            if (BigInt(balance) < BigInt(args.amount)) {
              throw new WardInputError(`Your family account has ${formatUsdc(balance)} test USDC. Fund it or send USDC straight to the vault.`, 422);
            }
            receiver = token;
            actions = [tx.functionCall("ft_transfer", { receiver_id: address, amount: args.amount }, gas, 1n)];
            break;
          }
          const feeBuffer = near / 1_000n;
          if ((await available(signer)) < BigInt(args.amount) + feeBuffer) {
            throw new WardInputError("Your family account has too little test NEAR for this transfer. Top it up or fund the vault directly.", 422);
          }
          actions = [tx.transfer(BigInt(args.amount))];
          break;
        }
        case "limits": actions = [call("set_limits", fields(args))]; break;
        case "freeze": actions = [call("set_frozen", args)]; break;
        case "requester":
          actions = [call("set_requester", { requester: args.requester,
            requester_key: args.scoped ? publicKey(args.scoped).toString() : null })];
          break;
        case "register":
          if (!token) throw new WardInputError("USDC registration requires a USDC wallet", 400);
          if (!(await exists(args.recipient))) throw new WardInputError("The recipient’s NEAR testnet account does not exist yet", 422);
          if (await registration(args.recipient)) throw new WardInputError("This recipient is already registered for USDC", 422);
          receiver = token;
          actions = [storageAction(args.recipient)];
          break;
        case "withdraw":
          if (token && BigInt(await tokenBalance(address)) < BigInt(args.amount)) {
            throw new WardInputError("The vault has too little USDC for this withdrawal", 422);
          }
          actions = [call("withdraw", args, token ? 80n * 10n ** 12n : gas)];
          break;
        case "pay": actions = [call("request_payment", args, token ? 80n * 10n ** 12n : gas)]; break;
        case "review": actions = [call("resolve_payment", args, token ? 80n * 10n ** 12n : gas)]; break;
        case "scope":
          await sponsorWork(() => ensureGas(signer));
          receiver = signer;
          actions = [tx.addKey(publicKey(args.scoped), tx.functionCallAccessKey(address, ["request_payment"], near / 10n)),
            tx.deleteKey(key)];
          break;
        default: throw new Error("Unsupported testnet operation");
      }
      // The bootstrap transfer can finalize before the access-key query catches up.
      const { nonce, blockHash } = await accessKey(signer, key.toString(), op === "scope" ? 8 : 1);
      return makeBrowserTransaction({ signer, receiver, key, nonce, blockHash, actions });
    },

    async finalized(intent, address) {
      const result = await readFinal(intent.hash, intent.signer);
      if (!Object.hasOwn(result.status, "SuccessValue")) {
        throw new WardInputError("Testnet rejected the transaction. Check the account balance and permissions.", 422);
      }
      const failedTokenCall = token && result.receipts_outcome.some(item =>
        item.outcome.executor_id === token && Object.hasOwn(item.outcome.status, "Failure"));
      if (failedTokenCall && ["fund", "withdraw", "register"].includes(intent.op)) {
        throw new WardInputError("The USDC contract rejected the transfer or registration", 422);
      }
      const events = result.receipts_outcome.filter(item => item.outcome.executor_id === address)
        .flatMap(item => item.outcome.logs).flatMap(line => {
          try { return [JSON.parse(line)]; } catch { return []; }
        });
      return events;
    },
  };
}
