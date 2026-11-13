import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { demoClock, demoPolicy, formatNear, labels } from "../demo/fixture.js";
import { openFamilyWallets } from "./family-wallets.js";
import { dollarsToAtomic } from "../mama-wallet/server.js";
import { createWalletApi } from "./wallet-api.js";
import { TESTNET_USDC, formatUsdc, usdcToAtomic } from "./testnet-usdc.js";

const origin = "http://127.0.0.1:4173";
const starter = {
  childName: "Chinedu", parentName: "Ada", dailyCap: "5", perTxCeiling: "3", approvalThreshold: "1",
  places: demoPolicy.payees.map(id => ({ id, label: labels[id] })),
};

function fixture(t, { cloudScreen, chain } = {}) {
  let now = demoClock();
  const clock = () => now;
  const wallets = openFamilyWallets(":memory:", { clock, authClock: clock, cloudScreen });
  t.after(() => wallets.close());
  const api = createWalletApi({ wallets, origin, toAtomic: chain?.asset === "usdc" ? usdcToAtomic : dollarsToAtomic,
    format: chain?.asset === "usdc" ? formatUsdc : formatNear, clock, chain });

  async function request(path, { data, cookie, source = origin } = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.method = data === undefined ? "GET" : "POST";
    req.headers = { cookie, origin: source, "content-type": "application/json" };
    const response = {};
    await api(req, {
      writeHead(status, headers) { Object.assign(response, { status, headers }); },
      end(body) { response.body = JSON.parse(body); },
    }, `/api/${path}`);
    return response;
  }

  const post = (path, data, cookie) => request(path, { data, cookie });
  const cookieOf = response => response.headers["Set-Cookie"].split(";")[0];
  const codeOf = response => new URLSearchParams(new URL(response.body.link).hash.slice(1)).get("pair");
  return { request, post, cookieOf, codeOf, setTime: time => { now = time; } };
}

test("onboarding, pairing and wallet controls enforce roles and the starting rules", async t => {
  const { request, post: submit, cookieOf, codeOf, setTime } = fixture(t);
  assert.equal((await request("wallet")).status, 401);
  assert.equal((await submit("onboarding", { ...starter, childName: " " })).status, 400);
  assert.equal((await submit("onboarding", { ...starter, approvalThreshold: "4" })).status, 400);
  const familyLogin = await submit("onboarding", starter);
  assert.equal(familyLogin.status, 201);
  assert.match(familyLogin.body.address, /^demo-[0-9a-f]{24}$/);
  assert.equal(familyLogin.body.paired, false);
  const family = cookieOf(familyLogin);
  assert.match(familyLogin.headers["Set-Cookie"], /HttpOnly; SameSite=Strict/);
  const invite = await submit("invites", {}, family);
  const code = codeOf(invite);
  assert.deepEqual((await submit("invite-preview", { code })).body, { childName: "Chinedu" });
  assert.equal((await request("wallet", { cookie: family })).body.paired, false);
  const elderLogin = await submit("pair", { code });
  const elder = cookieOf(elderLogin);
  assert.equal((await submit("pair", { code })).status, 403);
  assert.equal((await request("wallet", { cookie: family })).body.paired, true);

  const funding = { data: { source: "base", dollars: "10", sender: "Fake sender" }, cookie: family };
  assert.equal((await request("funding-quote", { ...funding, cookie: elder })).status, 403);
  assert.equal((await request("funding-quote", { ...funding, source: "http://other.test" })).status, 403);
  assert.equal((await request("funding-quote", { ...funding, data: { ...funding.data, source: "invalid" } })).status, 400);
  const quote = await request("funding-quote", funding);
  assert.equal(quote.body.mode, "Fixture quote");
  assert.equal((await request("wallet", { cookie: elder })).body.balance, "0");
  const confirm = { data: { id: quote.body.id }, cookie: family };
  assert.equal((await request("funding-confirm", { ...confirm, cookie: elder })).status, 403);
  assert.equal((await request("funding-confirm", confirm)).body.balance, "10");
  assert.equal((await request("funding-confirm", confirm)).body.balance, "10");
  const elderWallet = (await request("wallet", { cookie: elder })).body;
  assert.equal(elderWallet.name, "Ada");
  assert.equal(elderWallet.receipts[0].sender, "Chinedu");

  const pay = { id: "request", payee: "pharmacy.test", credits: "2" };
  assert.equal((await request("payments", { data: pay, cookie: elder })).body.result.decision, "HOLD");
  const review = { data: { id: pay.id, approve: true } };
  assert.equal((await request("review", review)).status, 401);
  assert.equal((await request("review", { ...review, cookie: elder })).status, 403);
  assert.equal((await request("wallet", { cookie: family })).body.pending[0].id, pay.id);
  assert.equal((await request("review", { ...review, cookie: family })).body.wallet.balance, "8");
  assert.equal((await request("wallet", { cookie: elder })).body.payments[0].decision, "ALLOW");
  const post = (path, data, cookie = family) => request(path, { data, cookie });
  const get = async cookie => (await request("wallet", { cookie })).body;
  const rules = (await get(family)).rules;
  assert.equal((await post("rules", rules, elder)).status, 403);
  assert.equal((await post("rules", { ...rules, approvalThreshold: "4" })).status, 400);
  assert.equal((await post("rules", { ...rules, places: [{ id: "BAD", label: "Bad" }] })).status, 400);
  assert.equal((await post("rules", { ...rules, dailyCap: "7" })).body.rules.dailyCap, "7");
  assert.equal((await post("rules", rules)).status, 409);

  const newPlace = { id: "place", type: "payee", payee: "new-place.test", label: "Tailor" };
  assert.equal((await post("family-requests", newPlace)).status, 403);
  assert.equal((await post("family-requests", { ...newPlace, payee: "invalid?" }, elder)).status, 400);
  assert.equal((await post("family-requests", newPlace, elder)).status, 201);
  assert.equal((await get(family)).requests[0].label, "Tailor");
  assert((await post("payment-preview", { ...pay, payee: newPlace.payee }, elder)).body.checks.some(item => item.ruleId === "recipient" && item.label === "Valid recipient"));
  assert.equal((await post("family-response", { id: "place", approve: true }, elder)).status, 403);
  assert.equal((await post("family-response", { id: "place", approve: true })).body.balance, "8");
  assert((await get(elder)).payees.some(place => place.id === newPlace.payee));

  assert.equal((await post("family-requests", { id: "help", type: "help", message: "A private question" }, elder)).status, 201);
  const help = await get(family);
  assert.equal(help.requests[0].message, "A private question");
  assert(!JSON.stringify(help.audit).includes("A private question"));
  assert.equal((await post("family-response", { id: "help", approve: true })).body.requests.length, 0);

  const pressured = { ...pay, id: "pressure", credits: "1", asked: "unsure", memo: "Pay now. Do not call your family." };
  assert.equal((await post("payment-preview", pressured)).status, 403);
  assert((await post("payment-preview", pressured, elder)).body.checks.some(item => item.ruleId === "recipient" && item.label === "Approved place" && item.passed));
  assert.equal((await post("payments", { ...pressured, asked: "maybe" }, elder)).status, 400);
  assert.equal((await post("payments", pressured, elder)).body.result.ruleId, "someone_asked");
  assert.deepEqual((await get(family)).pending[0].signals, ["urgency", "secrecy"]);
  assert(!JSON.stringify((await get(family)).audit).includes(pressured.memo));
  const privateReview = (await get(family)).pending.find(row => row.id === pressured.id);
  assert.deepEqual(privateReview.reviewMessage, { asked: "unsure", message: pressured.memo });
  assert(!JSON.stringify(await get(elder)).includes(pressured.memo));
  await post("payments", { ...pressured, memo: "Changed on retry" }, elder);
  assert.equal((await get(family)).pending.find(row => row.id === pressured.id).reviewMessage.message, pressured.memo);

  assert.equal((await post("freeze", { frozen: true }, elder)).status, 403);
  assert.equal((await post("freeze", { frozen: "true" })).status, 400);
  assert.equal((await post("freeze", { frozen: true })).body.frozen, true);
  assert.equal((await post("payments", { ...pay, id: "frozen" }, elder)).body.result.ruleId, "wallet_frozen");
  const alert = (await get(family)).blockedAlerts[0];
  assert.equal(alert.ruleId, "wallet_frozen");
  assert.equal((await post("acknowledge-block", { id: alert.alertId }, elder)).status, 403);
  assert.equal((await post("acknowledge-block", { id: alert.alertId })).body.blockedAlerts.length, 0);
  assert((await get(family)).audit.some(row => row.id === "frozen"));

  assert.equal((await post("review", { id: "pressure", approve: true })).body.result.ruleId, "wallet_frozen");
  assert.equal((await post("freeze", { frozen: false })).body.frozen, false);
  assert.equal((await post("review", { id: "pressure", approve: false })).body.result.ruleId, "family_rejected");
  assert.deepEqual((await get(family)).summary.counts, { ALLOW: 1, HOLD: 2, BLOCK: 3 });

  const impersonator = { id: "safe-account", type: "payee", payee: "safe-account.test", label: "Bank safe account" };
  assert.equal((await post("family-requests", impersonator, elder)).status, 201);
  assert.equal((await post("family-response", { id: impersonator.id, approve: false })).status, 200);
  assert(!(await get(elder)).payees.some(place => place.id === impersonator.payee));
  assert.equal((await post("family-response", { id: impersonator.id, approve: true })).status, 409);

  const current = (await get(family)).rules;
  assert.equal((await post("rules", { ...current, dailyCap: "2", perTxCeiling: "2" })).status, 200);
  assert.equal((await get(elder)).leftToday, "0");
  assert.equal((await post("payments", { ...pay, id: "same-day", dollars: "1" }, elder)).body.result.ruleId, "daily_cap");
  setTime(Date.parse("2026-11-10T00:00:00Z"));
  assert.equal((await get(elder)).leftToday, "2");
  assert.equal((await post("payments", { ...pay, id: "next-day", dollars: "1" }, elder)).body.result.decision, "ALLOW");
});

test("families have isolated addresses, rules, ledgers, requests, quotes and devices", async t => {
  const { request, post, cookieOf, codeOf, setTime } = fixture(t);
  const a = await post("onboarding", starter);
  const b = await post("onboarding", { ...starter, childName: "Bisi", parentName: "Iya", dailyCap: "20", places: [] });
  const familyA = cookieOf(a);
  const familyB = cookieOf(b);
  assert.notEqual(a.body.address, b.body.address);

  const inviteA = codeOf(await post("invites", {}, familyA));
  const inviteB = codeOf(await post("invites", {}, familyB));
  assert.equal((await post("pair", { code: inviteB }, familyA)).status, 409);
  const elderA = cookieOf(await post("pair", { code: inviteA }));
  const elderB = cookieOf(await post("pair", { code: inviteB }));
  assert.equal((await post("invites", {}, familyB)).status, 409);
  assert.equal((await post("unpair", {}, elderB)).status, 403);
  assert.equal((await post("invites", { replace: true }, elderB)).status, 403);

  const quote = (await post("funding-quote", { source: "base", dollars: "10" }, familyB)).body;
  assert.equal((await post("funding-confirm", { id: quote.id }, familyA)).status, 409);
  assert.equal((await post("funding-confirm", { id: quote.id }, familyB)).body.balance, "10");
  assert.equal((await post("funding-confirm", { id: quote.id }, familyA)).status, 409);
  const direct = { id: "direct", payee: "unsaved.test", dollars: "1", asked: "no" };
  assert.equal((await post("payments", direct, elderB)).body.result.decision, "ALLOW");
  assert.equal((await post("payments", { ...direct, id: "bad-id", payee: "unsaved?" }, elderB)).body.result.ruleId, "invalid_payment");
  assert.equal((await post("payments", { ...direct, id: "oversize", dollars: "4" }, elderB)).body.result.ruleId, "per_tx_ceiling");
  const hold = { ...direct, id: "same-id", dollars: "2" };
  assert.equal((await post("payments", hold, elderB)).body.result.decision, "HOLD");
  assert.equal((await post("review", { id: hold.id, approve: true }, familyA)).status, 409);
  await post("family-requests", { id: "help-b", type: "help", message: "Private to B" }, elderB);
  assert.equal((await post("family-response", { id: "help-b", approve: true }, familyA)).status, 404);
  await post("freeze", { frozen: true }, familyA);
  assert.equal((await post("payments", hold, elderA)).body.result.ruleId, "wallet_frozen");
  assert.equal((await post("review", { id: hold.id, approve: true }, familyB)).body.wallet.balance, "7");

  const viewA = (await request("wallet", { cookie: familyA })).body;
  const viewB = (await request("wallet", { cookie: familyB })).body;
  assert.equal(viewA.balance, "0");
  assert.deepEqual(viewA.requests, []);
  assert.deepEqual(viewA.receipts, []);
  assert.equal(viewA.rules.dailyCap, "5");
  assert.equal(viewB.rules.dailyCap, "20");
  assert.equal(viewB.frozen, false);
  assert.equal(viewB.requests[0].message, "Private to B");

  const replacement = codeOf(await post("invites", { replace: true }, familyB));
  assert.equal((await request("wallet", { cookie: elderB })).status, 401);
  assert.equal((await request("wallet", { cookie: elderA })).status, 200);
  const next = cookieOf(await post("pair", { code: replacement }));
  assert.equal((await request("wallet", { cookie: next })).body.balance, "7");
  assert.equal((await post("unpair", {}, familyB)).body.paired, false);
  assert.equal((await post("payments", { ...direct, id: "revoked" }, next)).status, 401);
  const expired = codeOf(await post("invites", {}, familyB));
  setTime(demoClock() + 10 * 60_000);
  assert.equal((await post("invite-preview", { code: expired })).status, 403);
  assert.equal((await post("pair", { code: expired })).status, 403);
});

test("disconnecting a phone during screening prevents the payment from writing", async t => {
  let finish;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { post, request, cookieOf, codeOf } = fixture(t, {
    cloudScreen: () => new Promise(resolve => { finish = resolve; started(); }),
  });
  const family = cookieOf(await post("onboarding", starter));
  const code = codeOf(await post("invites", {}, family));
  const elder = cookieOf(await post("pair", { code }));
  const { body: quote } = await post("funding-quote", { source: "base", dollars: "10" }, family);
  await post("funding-confirm", { id: quote.id }, family);
  const payment = post("payments", { id: "pending-screen", payee: "any.test", dollars: "1", memo: "Invoice" }, elder);
  await ready;
  await post("unpair", {}, family);
  finish(0);
  assert.equal((await payment).status, 401);
  const view = (await request("wallet", { cookie: family })).body;
  assert.equal(view.balance, "10");
  assert.deepEqual(view.audit, []);
});

test("Family sign-in restores only its own wallet after session expiry", async t => {
  const { request, post, cookieOf, codeOf, setTime } = fixture(t);
  const first = await post("onboarding", starter);
  const second = await post("onboarding", { ...starter, childName: "Other family" });
  const family = cookieOf(first);
  const invite = codeOf(await post("invites", {}, family));
  const elder = cookieOf(await post("pair", { code: invite }));
  assert.equal((await post("family-sign-in-code", {}, elder)).status, 403);
  assert.equal((await post("family-sign-in-code", {})).status, 401);
  const previous = (await post("family-sign-in-code", {}, family)).body.code;
  const created = await post("family-sign-in-code", {}, family);
  assert.equal(created.headers["Cache-Control"], "no-store");
  assert.match(created.body.code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await post("family-sign-in", { code: previous })).status, 401);
  assert.equal((await post("family-sign-in", { code: created.body.code }, elder)).status, 409);

  setTime(demoClock() + 31 * 86_400_000);
  assert.equal((await request("wallet", { cookie: family })).status, 401);
  const restored = await post("family-sign-in", { code: created.body.code });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.role, "family");
  assert.equal(restored.body.address, first.body.address);
  assert.notEqual(restored.body.address, second.body.address);
  assert.equal(restored.body.hasSignIn, true);
  assert.equal(restored.body.code, undefined);
  const session = cookieOf(restored);
  const out = await post("family-sign-out", {}, session);
  assert.match(out.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal((await request("wallet", { cookie: session })).status, 401);
});

test("testnet routes require a finalized chain receipt and surface blocked transfers to the family", async t => {
  const owner = "1".repeat(64);
  const requester = "2".repeat(64);
  const scoped = "3".repeat(64);
  const address = "vault.test";
  const state = {
    approver: owner, requester: null, openPayees: true, frozen: false, pending: null,
    balance: dollarsToAtomic("4"), dailyCap: dollarsToAtomic("5"), leftToday: dollarsToAtomic("5"),
    perTxCeiling: dollarsToAtomic("3"), approvalThreshold: dollarsToAtomic("1"),
  };
  let ready = false;
  let prepared;
  let settle = false;
  const chain = {
    async provision(account) { assert.equal(account, owner); return address; },
    async state(vault) { assert.equal(vault, address); return state; },
    async scoped(account, key) { return ready && account === requester && key === scoped; },
    async prepare(intent) { prepared = intent; return { bytes: "AQ==", hash: "test-hash" }; },
    async finalized(intent) {
      assert.equal(intent.hash, "test-hash");
      return [{
        event: "payment_decision", requestId: settle ? "1" : null,
        amount: dollarsToAtomic("1"), payee: "recipient.test",
        result: settle ? { decision: "ALLOW", ruleId: "policy_pass", reason: "Allowed" }
          : { decision: "BLOCK", ruleId: "wallet_frozen", reason: "Frozen" },
      }];
    },
  };
  const { request, post, cookieOf, codeOf } = fixture(t, { chain });
  assert.deepEqual((await request("mode")).body, { mode: "testnet" });
  const setup = await post("onboarding", { ...starter, account: owner });
  const family = cookieOf(setup);
  assert.equal(setup.body.mode, "testnet");
  assert.equal(setup.body.balance, "4");
  assert.equal((await post("funding-confirm", { id: "local" }, family)).status, 409);
  const code = codeOf(await post("invites", {}, family));
  const elder = cookieOf(await post("pair", { code, account: requester, scoped }));
  const pay = { id: "chain-pay", op: "pay", payee: "recipient.test", dollars: "1", asked: "yes" };
  assert.equal((await post("chain-prepare", pay, elder)).status, 409);
  assert.equal((await post("chain-prepare", pay, family)).status, 403);

  state.requester = requester;
  const scope = { id: "chain-scope", op: "scope" };
  assert.equal((await post("chain-prepare", scope, elder)).status, 200);
  assert.equal(prepared.signer, requester);
  assert.equal(prepared.keyHex, requester);
  assert.deepEqual(prepared.args, { scoped });

  ready = true;
  assert.equal((await post("unpair", {}, family)).status, 409);
  assert.equal((await post("chain-prepare", pay, elder)).status, 200);
  assert.equal(prepared.signer, requester);
  assert.equal(prepared.keyHex, scoped);
  assert.equal(prepared.args.force_review, true);
  assert.deepEqual((await request("wallet", { cookie: family })).body.blockedAlerts, []);
  assert.equal((await post("chain-finish", { id: pay.id }, family)).status, 404);
  assert.equal((await post("chain-finish", { id: pay.id }, elder)).body.result.ruleId, "wallet_frozen");
  assert.equal((await post("chain-finish", { id: pay.id }, elder)).status, 200);
  const after = (await request("wallet", { cookie: family })).body;
  assert.equal(after.balance, "4");
  assert.equal(after.blockedAlerts.length, 1);
  assert.equal(after.blockedAlerts[0].hash, "test-hash");
  const alertId = after.blockedAlerts[0].alertId;
  assert.equal((await request("wallet", { cookie: elder })).body.payments[0].seenByFamily, false);
  assert.equal((await post("acknowledge-block", { id: alertId }, elder)).status, 403);
  const seen = await post("acknowledge-block", { id: alertId }, family);
  assert.deepEqual(seen.body.blockedAlerts, []);
  assert(seen.body.audit.some(row => row.hash === "test-hash" && row.decision === "BLOCK"));
  assert.equal((await request("wallet", { cookie: elder })).body.payments[0].seenByFamily, true);

  settle = true;
  assert.equal((await post("chain-prepare", { ...pay, id: "failed-settlement" }, elder)).status, 200);
  const failure = await post("chain-finish", { id: "failed-settlement" }, elder);
  assert.equal(failure.body.result.ruleId, "settlement_failed");
  const held = { ...pay, id: "held-note", asked: "unsure", memo: "They asked me to send this today." };
  await post("chain-prepare", held, elder);
  assert.deepEqual(Object.keys(prepared.args).sort(), ["amount", "force_review", "payee"]);
  assert(!JSON.stringify(prepared).includes(held.memo));
  state.pending = { id: "6", payee: held.payee, amount: dollarsToAtomic("1") };
  chain.finalized = async () => [{event: "payment_decision", requestId: "6", payee: held.payee, amount: dollarsToAtomic("1"), result: {decision: "HOLD", ruleId: "requested_review", reason: "Review"}}];
  const completed = await post("chain-finish", {id: held.id}, elder);
  assert.equal(completed.status, 200);
  assert(!JSON.stringify(completed.body).includes(held.memo));
  const privateNote = (await request("wallet", {cookie: family})).body.pending[0].reviewMessage;
  assert.deepEqual(privateNote, {asked: "unsure", message: held.memo});

});

test("USDC uses a separate session, six-decimal units and recipient registration", async t => {
  const account = "a".repeat(64);
  const elderAccount = "b".repeat(64);
  const scoped = "c".repeat(64);
  const state = {
    balance: "25000000", requester: elderAccount, frozen: false, pending: null,
    dailyCap: "5000000", leftToday: "5000000", perTxCeiling: "3000000", approvalThreshold: "1000000",
  };
  let registered = false;
  let prepared;
  const chain = {
    asset: "usdc", token: TESTNET_USDC, registrationCost: "0.00125",
    async provision(_, rules) {
      assert.equal(rules.dailyCap, "5000000");
      return "vault.fixture.test";
    },
    async state() { return state; },
    async scoped() { return true; },
    async isRegistered() { return registered; },
    async prepare(intent) { prepared = intent; return { bytes: "AQ==", hash: "usdc-fixture" }; },
  };
  const { request, post, cookieOf, codeOf } = fixture(t, { chain });
  assert.deepEqual((await request("mode")).body, {
    mode: "testnet", asset: "usdc", token: TESTNET_USDC, registrationCost: "0.00125",
  });
  const setup = await post("onboarding", { ...starter, account });
  const family = cookieOf(setup);
  assert.match(family, /^ward_usdc_session=/);
  assert.equal(setup.body.balance, "25");
  assert.equal((await request("wallet", { cookie: family.replace("ward_usdc_session", "ward_session") })).status, 401);
  const invite = codeOf(await post("invites", {}, family));
  const elder = cookieOf(await post("pair", { code: invite, account: elderAccount, scoped }));
  const pay = { id: "usdc-pay", op: "pay", payee: "recipient.test", dollars: "1.25" };
  assert.equal((await post("chain-prepare", pay, elder)).status, 422);
  const register = { id: "usdc-register", op: "register", recipient: pay.payee };
  assert.equal((await post("chain-prepare", register, elder)).status, 403);
  assert.equal((await post("chain-prepare", register, family)).status, 200);
  assert.deepEqual(prepared.args, { recipient: pay.payee });
  registered = true;
  assert.equal((await post("chain-prepare", pay, elder)).status, 200);
  assert.equal(prepared.args.amount, "1250000");
  assert.equal((await post("chain-prepare", { id: "fund", op: "fund", dollars: "12.34" }, family)).status, 200);
  assert.equal(prepared.args.amount, "12340000");
  assert.equal(formatUsdc("1250001"), "1.250001");
  assert.equal(usdcToAtomic("12.345"), null);
});
