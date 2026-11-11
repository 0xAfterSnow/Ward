import { setTimeout as sleep } from "node:timers/promises";
import { WardInputError } from "./mock-ward.js";

export const TESTNET_RPC = "https://test.rpc.fastnear.com";
const U64_MAX = (1n << 64n) - 1n;

export function nextTestnetNonce(value) {
  const decimal = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof decimal === "string" && /^\d{1,20}$/.test(decimal) && BigInt(decimal) < U64_MAX) {
    return BigInt(decimal) + 1n;
  }
  throw new WardInputError("Testnet didn’t return a usable device nonce. Retry in a moment.", 503);
}

// Only read methods use this client. Retrying a read never resubmits a transaction.
export function createTestnetReader(fetcher = fetch, pause = sleep) {
  async function rpc(method, params) {
    let reply;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(TESTNET_RPC, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "ward-wallet", method, params }),
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) throw new Error("Testnet RPC HTTP error");
        reply = JSON.parse(await response.text(), (key, value, context) =>
          key === "nonce" && typeof value === "number" ? context.source : value);
        break;
      } catch {
        if (attempt === 2) throw new WardInputError("NEAR testnet is temporarily unreachable. Retry the same action in a moment.", 503);
        await pause(250 * (attempt + 1));
      }
    }
    if (reply?.error) {
      const rpcCode = reply.error.cause?.name ?? reply.error.name;
      throw Object.assign(new WardInputError("NEAR testnet couldn’t answer this request. Retry in a moment.", 503), { rpcCode });
    }
    if (!reply?.result || typeof reply.result.error === "string") {
      const reason = reply?.result?.error ?? "";
      const rpcCode = /access key.*does not exist/i.test(reason) ? "UNKNOWN_ACCESS_KEY"
        : /account.*does not exist/i.test(reason) ? "UNKNOWN_ACCOUNT" : undefined;
      throw Object.assign(new WardInputError("NEAR testnet couldn’t read this account or vault.", 503), { rpcCode });
    }
    return reply.result;
  }

  const query = (type, args) => rpc("query", { request_type: type, finality: "final", ...args });

  async function finalized(hash, signer) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await rpc("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "NONE" });
        if (result.final_execution_status === "FINAL") return result;
      } catch (error) {
        if (!["UNKNOWN_TRANSACTION", "TIMEOUT_ERROR"].includes(error.rpcCode)) throw error;
      }
      if (attempt < 4) await pause(850);
    }
    throw new WardInputError("Testnet hasn’t confirmed this transaction. Retry the same action to check it.", 409);
  }

  async function accessKey(account, key, attempts = 1) {
    const missing = error => ["UNKNOWN_ACCOUNT", "UNKNOWN_ACCESS_KEY"].includes(error.rpcCode);
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const { keys, block_hash } = await query("view_access_key_list", { account_id: account });
        const access = keys?.find(entry => entry.public_key === key)?.access_key;
        if (access) return { nonce: nextTestnetNonce(access.nonce), blockHash: block_hash };
      } catch (error) {
        if (!missing(error)) throw error;
      }
      try {
        const { nonce, block_hash } = await query("view_access_key", { account_id: account, public_key: key });
        return { nonce: nextTestnetNonce(nonce), blockHash: block_hash };
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (attempt + 1 < attempts) await pause(1_000);
    }
    throw new WardInputError("Testnet hasn’t indexed the device key yet. Keep this pairing and try Finish connecting again shortly.", 409);
  }

  return { rpc, query, finalized, accessKey };
}
