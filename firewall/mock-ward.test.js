import assert from "node:assert/strict";
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
