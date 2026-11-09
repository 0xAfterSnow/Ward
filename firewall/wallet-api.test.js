import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { amount, demoClock, demoPolicy, formatNear, labels } from "../demo/fixture.js";
import { openMockWard } from "./mock-ward.js";
import { createWalletApi } from "./wallet-api.js";

test("pairing separates elder and family roles and approval links grant no authority", async t => {
  const origin = "http://127.0.0.1:4173";
  const familyCode = "a".repeat(43);
  const ward = openMockWard(":memory:", { policy: demoPolicy, clock: demoClock });
  t.after(() => ward.close());
  const api = createWalletApi({
    ward, origin, familyCode, fundingAmount: amount(10), toAtomic: amount, format: formatNear,
    payees: demoPolicy.payees.map(id => ({ id, label: labels[id] })),
  });

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

  assert.equal((await request("wallet")).status, 401);
  const familyLogin = await request("family-session", { data: { code: familyCode } });
  const family = familyLogin.headers["Set-Cookie"].split(";")[0];
  assert.match(familyLogin.headers["Set-Cookie"], /HttpOnly; SameSite=Strict/);
  const invite = await request("invites", { data: {}, cookie: family });
  const code = new URLSearchParams(new URL(invite.body.link).hash.slice(1)).get("pair");
  const elderLogin = await request("pair", { data: { code } });
  const elder = elderLogin.headers["Set-Cookie"].split(";")[0];
  assert.equal((await request("pair", { data: { code } })).status, 403);

  assert.equal((await request("fund", { data: { id: "topup" }, cookie: elder })).status, 403);
  assert.equal((await request("fund", { data: { id: "topup" }, cookie: family, source: "http://other.test" })).status, 403);
  assert.equal((await request("fund", { data: { id: "topup" }, cookie: family })).body.balance, "10");

  const pay = { id: "request", payee: "pharmacy.test", credits: "2" };
  assert.equal((await request("payments", { data: pay, cookie: elder })).body.result.decision, "HOLD");
  const review = { data: { id: pay.id, approve: true } };
  assert.equal((await request("review", review)).status, 401);
  assert.equal((await request("review", { ...review, cookie: elder })).status, 403);
  assert.equal((await request("wallet", { cookie: family })).body.pending[0].id, pay.id);
  assert.equal((await request("review", { ...review, cookie: family })).body.wallet.balance, "8");
  assert.equal((await request("wallet", { cookie: elder })).body.payments[0].decision, "ALLOW");
});
