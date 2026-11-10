import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openMockWard } from "./mock-ward.js";

const policy = {
  dailyCap: "40",
  perTxCeiling: "40",
  approvalThreshold: "25",
  payees: ["pharmacy.test"],
};

test("persists all decisions, credits a funding ID once, and charges only ALLOW", t => {
  const dir = mkdtempSync(join(tmpdir(), "ward-ledger-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ward.sqlite");
  const ward = openMockWard(file, { policy });
  const pharmacy = { payee: "pharmacy.test" };
  try {
    assert.equal(ward.creditMockFunding({ id: "family", amount: "100" }), "100");
    assert.equal(ward.creditMockFunding({ id: "family", amount: "100" }), "100");
    assert.equal(ward.requestPayment({ ...pharmacy, id: "large", amount: "30" }).decision, "HOLD");
    assert.equal(ward.requestPayment({ ...pharmacy, id: "normal", amount: "25" }).decision, "ALLOW");
    assert.equal(ward.requestPayment({ ...pharmacy, id: "normal", amount: "25" }).decision, "ALLOW");
    assert.throws(() => ward.requestPayment({ ...pharmacy, id: "normal", amount: "24" }), /already used/);
    assert.equal(ward.requestPayment({
      ...pharmacy, id: "cap", amount: "16", memo: "private message",
    }).ruleId, "daily_cap");
    assert.equal(ward.balance(), "75");
  } finally {
    ward.close();
  }

  const reopened = openMockWard(file, { policy });
  try {
    assert.equal(reopened.balance(), "75");
    assert.deepEqual(reopened.audit().map(row => row.decision), ["HOLD", "ALLOW", "BLOCK"]);
    assert(reopened.audit().every(row => row.reason && row.ruleId && row.timestamp));
    assert(!JSON.stringify(reopened.audit()).includes("private message"));
  } finally {
    reopened.close();
  }
});

test("records insufficient balance and resets cap at UTC midnight", t => {
  let time = Date.parse("2026-11-09T23:59:59Z");
  const ward = openMockWard(":memory:", { policy, clock: () => time });
  t.after(() => ward.close());
  const pay = id => ward.requestPayment({ id, payee: "pharmacy.test", amount: "25" });
  assert.equal(pay("before-funding").ruleId, "vault_balance");
  ward.creditMockFunding({ id: "family", amount: "100" });
  assert.equal(pay("day-one").decision, "ALLOW");
  assert.equal(pay("same-day").ruleId, "daily_cap");
  time += 1000;
  assert.equal(pay("day-two").decision, "ALLOW");
  assert.equal(ward.balance(), "50");
});

test("family resolution rechecks time windows, leaves blocked approvals pending and debits once", t => {
  let now = 10 * 60_000;
  const ward = openMockWard(":memory:", {
    policy: { ...policy, timeWindows: [{ startMinute: 10, endMinute: 20 }] },
    clock: () => now,
  });
  t.after(() => ward.close());
  ward.creditMockFunding({ id: "fund", amount: "100" });
  assert.equal(ward.requestPayment({ id: "held", payee: "pharmacy.test", amount: "30" }).decision, "HOLD");
  now = 20 * 60_000;
  assert.equal(ward.resolvePayment({ id: "held", approve: true }).ruleId, "time_window");
  assert.equal(ward.pending().length, 1);
  assert.equal(ward.balance(), "100");
  now = 86_400_000 + 10 * 60_000;
  assert.equal(ward.resolvePayment({ id: "held", approve: true }).ruleId, "family_approved");
  assert.equal(ward.resolvePayment({ id: "held", approve: true }).decision, "ALLOW");
  assert.throws(() => ward.resolvePayment({ id: "held", approve: false }), /already resolved/);
  assert.equal(ward.pending().length, 0);
  assert.equal(ward.balance(), "70");
  assert.deepEqual(ward.audit().map(row => row.decision), ["HOLD", "BLOCK", "ALLOW"]);
});

test("family rejection closes the request without changing the balance", t => {
  const ward = openMockWard(":memory:", { policy });
  t.after(() => ward.close());
  ward.creditMockFunding({ id: "fund", amount: "100" });
  ward.requestPayment({ id: "held", payee: "pharmacy.test", amount: "30" });
  assert.equal(ward.resolvePayment({ id: "held", approve: false }).ruleId, "family_rejected");
  assert.equal(ward.payment("held").decision, "BLOCK");
  assert.equal(ward.pending().length, 0);
  assert.equal(ward.balance(), "100");
});

test("reopens wallet rules, freeze, requests and funding receipts without duplicating money", t => {
  const dir = mkdtempSync(join(tmpdir(), "ward-wallet-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "wallet.sqlite");
  const ward = openMockWard(path, { policy });
  try {
    ward.creditMockFunding({ id: "first", amount: "100", sender: "Chinedu" });
    ward.updateRules({ dailyCap: "55", perTxCeiling: "35", approvalThreshold: "20", places: [], rulesVersion: 0 });
    ward.requestFamily({ id: "tailor", type: "payee", payee: "tailor.test", label: "Tailor" });
    ward.setFrozen(true);
  } finally {
    ward.close();
  }
  const reopened = openMockWard(path, { policy });
  t.after(() => reopened.close());
  assert.equal(reopened.status().dailyCap, "55");
  assert.equal(reopened.status().frozen, true);
  assert.deepEqual(reopened.audit()[0].changes.dailyCap, { before: "40", after: "55" });
  assert.equal(reopened.receipts()[0].sender, "Chinedu");
  const payment = { payee: "tailor.test", amount: "20" };
  assert.equal(reopened.requestPayment({ ...payment, id: "frozen" }).ruleId, "wallet_frozen");
  reopened.setFrozen(false);
  assert.equal(reopened.requestPayment({ ...payment, id: "unlisted" }).ruleId, "payee_allowlist");
  assert.equal(reopened.familyRequests()[0].status, "pending");
  reopened.resolveFamilyRequest({ id: "tailor", approve: true });
  assert.equal(reopened.balance(), "100");
  assert.equal(reopened.requestPayment({ ...payment, id: "approved" }).decision, "ALLOW");
  assert.equal(reopened.balance(), "80");
});

test("migrates old SQLite ledger rows into a private local namespace", t => {
  const dir = mkdtempSync(join(tmpdir(), "ward-legacy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "wallet.sqlite");
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE entries (
      sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL, timestamp TEXT NOT NULL,
      payee TEXT, amount TEXT, decision TEXT, ruleId TEXT, reason TEXT, UNIQUE (kind, id)
    );
    CREATE TABLE entry_details (sequence INTEGER PRIMARY KEY, data TEXT NOT NULL);
    INSERT INTO entries VALUES (1, 'funding', 'legacy', '2026-11-09T12:00:00.000Z', NULL, '50', NULL, NULL, NULL);
    INSERT INTO entry_details VALUES (1, '{"sender":"Original family"}');
  `);
  old.close();
  const local = openMockWard(path, { policy });
  assert.equal(local.balance(), "50");
  assert.equal(local.receipts()[0].sender, "Original family");
  local.close();
  const scoped = openMockWard(path, { familyId: "separate", policy });
  t.after(() => scoped.close());
  assert.equal(scoped.balance(), "0");
  assert.deepEqual(scoped.receipts(), []);
});
