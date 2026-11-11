// Device private keys stay as non-extractable CryptoKeys in this browser's IndexedDB.
const rpc = "https://test.rpc.fastnear.com";
let database;

function openKeys() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("mama-wallet-testnet", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("device");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function storage(key, method, value) {
  const db = await openKeys();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("device", method === "get" ? "readonly" : "readwrite");
    const store = transaction.objectStore("device");
    const request = method === "put" ? store.put(value, key) : store[method](key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function createKey() {
  const keys = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const account = Array.from(raw, byte => byte.toString(16).padStart(2, "0")).join("");
  return { account, privateKey: keys.privateKey };
}

export async function newDevice(setupId, elder = false) {
  const key = `setup:${setupId}`;
  let device = await storage(key, "get");
  if (!device) {
    device = { primary: await createKey(), scoped: elder ? await createKey() : null };
    await storage(key, "put", device);
  }
  return { account: device.primary.account, scoped: device.scoped?.account };
}

export async function rememberDevice(setupId, address) {
  const key = `setup:${setupId}`;
  const device = await storage(key, "get");
  if (!device) throw new Error("The testnet key is missing from this browser");
  await storage(address, "put", device);
  await storage(key, "delete");
}

export async function hasDevice(address, account) {
  const device = await storage(address, "get");
  return Boolean(device?.primary.privateKey && device.primary.account === account);
}

export async function signTestnet(api, address, op, args, expectedAccount) {
  const device = await storage(address, "get");
  if (!device || (expectedAccount && device.primary.account !== expectedAccount)) {
    throw new Error(op === "scope" || op === "pay"
      ? "Open this wallet in the browser profile that accepted the current pairing link"
      : "Use the original Family browser to sign this transaction");
  }
  const lockBytes = new TextEncoder().encode(JSON.stringify(args));
  const fingerprint = new Uint8Array(await crypto.subtle.digest("SHA-256", lockBytes));
  const lock = `transaction:${address}:${op}:${btoa(String.fromCharCode(...fingerprint))}`;
  let id = await storage(lock, "get");
  if (!id) {
    id = crypto.randomUUID();
    await storage(lock, "put", id);
  }
  try {
    const { bytes } = await api("chain-prepare", { ...args, id, op });
    const message = Uint8Array.from(atob(bytes), value => value.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", message);
    const key = op === "pay" ? device.scoped : device.primary;
    const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, digest));
    const signed = new Uint8Array(message.length + 1 + signature.length);
    signed.set(message);
    // NEAR Borsh SignedTransaction is Transaction followed by key type 0 and 64 signature bytes.
    signed.set(signature, message.length + 1);
    const encoded = btoa(String.fromCharCode(...signed));
    let rejection;
    try {
      const response = await fetch(rpc, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "send_tx",
          params: { signed_tx_base64: encoded, wait_until: "INCLUDED" } }),
        signal: AbortSignal.timeout(10_000),
      });
      rejection = (await response.json()).error;
    } catch {
      // A lost response can still mean the RPC accepted it. Check the prepared hash.
    }
    let finalized;
    try {
      finalized = await api("chain-finish", { id });
    } catch (error) {
      // An RPC rejection of a repeat broadcast can follow an earlier successful submission.
      // Keep the same local intent unless Ward confirms a terminal result.
      if (rejection && [409, 503].includes(error.status)) {
        const details = JSON.stringify(rejection);
        if (/NotEnoughBalance|LackBalanceForState|not enough balance|insufficient balance/i.test(details)) {
          throw new Error("Testnet reported insufficient balance. Top up your family account or fund the vault directly.");
        }
        if (/InvalidNonce|Expired|InvalidAccessKey/i.test(details)) {
          throw new Error("Testnet rejected this submission and hasn’t confirmed the original attempt. Check the transaction before sending again.");
        }
      }
      throw error;
    }
    await storage(lock, "delete");
    return finalized;
  } catch (error) {
    if (error.status === 422 || error.status === 400) await storage(lock, "delete");
    throw error;
  }
}
