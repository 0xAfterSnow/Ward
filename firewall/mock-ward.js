import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { amountOf, block, check, isAccountId } from "./policy.js";

function validateId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error("A valid request ID is required");
  }
}

// An offline ledger for the demo. Production custody is handled by the vault.
export function openMockWard(filename, { policy, clock = Date.now } = {}) {
  const db = new DatabaseSync(filename, { timeout: 5000 });
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      sequence INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payee TEXT,
      amount TEXT,
      decision TEXT,
      ruleId TEXT,
      reason TEXT,
      UNIQUE (kind, id)
    )
  `);
  const entries = db.prepare("SELECT * FROM entries ORDER BY sequence");
  const find = db.prepare("SELECT * FROM entries WHERE kind = ? AND id = ?");
  const held = db.prepare(`
    SELECT payment.* FROM entries AS payment
    LEFT JOIN entries AS resolution ON resolution.kind = 'resolution' AND resolution.id = payment.id
    WHERE payment.kind = 'payment' AND payment.decision = 'HOLD' AND resolution.id IS NULL
    ORDER BY payment.sequence
  `);
  const insert = db.prepare(`
    INSERT INTO entries (kind, id, timestamp, payee, amount, decision, ruleId, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function atomic(write) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = write();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function totals(day) {
    let balance = 0n;
    let spent = 0n;
    for (const row of entries.iterate()) {
      if (row.kind === "funding") {
        balance += BigInt(row.amount);
      } else if (row.decision === "ALLOW") {
        balance -= BigInt(row.amount);
        if (day && row.timestamp.startsWith(day)) {
          spent += BigInt(row.amount);
        }
      }
    }
    return { balance, spent };
  }

  function evaluate(payee, amount, now, timestamp) {
    const { balance, spent } = totals(timestamp.slice(0, 10));
    const result = check({ payee, amount }, { ...policy, spentToday: String(spent) }, now);
    if (result.decision !== "BLOCK" && amountOf(amount) > balance) {
      return block("vault_balance", "Vault has insufficient spendable balance");
    }
    return result;
  }

  return {
    creditMockFunding({ id, amount }) {
      validateId(id);
      const credit = amountOf(amount);
      if (credit === null || credit === 0n) {
        throw new Error("Funding amount must be positive");
      }
      return atomic(() => {
        const { balance } = totals();
        const previous = find.get("funding", id);
        if (previous) {
          if (previous.amount !== amount) throw new Error("Funding ID already used");
          return String(balance);
        }
        const funded = String(balance + credit);
        if (amountOf(funded) === null) throw new Error("Mock balance would overflow");
        insert.run("funding", id, new Date(clock()).toISOString(), null, amount, null, null, null);
        return funded;
      });
    },

    requestPayment({ id, payee, amount }) {
      validateId(id);
      const parsedAmount = amountOf(amount);
      const auditAmount = parsedAmount === null ? null : amount;
      const auditPayee = isAccountId(payee) ? payee : null;
      return atomic(() => {
        const previous = find.get("payment", id);
        if (previous) {
          if (previous.payee !== auditPayee || previous.amount !== auditAmount) {
            throw new Error("Payment ID already used");
          }
          const { decision, reason, ruleId } = previous;
          return { decision, reason, ruleId };
        }
        const now = clock();
        const timestamp = new Date(now).toISOString();
        const result = evaluate(payee, amount, now, timestamp);
        insert.run(
          "payment", id, timestamp, auditPayee, auditAmount,
          result.decision, result.ruleId, result.reason,
        );
        return result;
      });
    },

    resolvePayment({ id, approve }) {
      validateId(id);
      if (typeof approve !== "boolean") throw new Error("Choose approve or reject");
      return atomic(() => {
        const previous = find.get("resolution", id);
        if (previous) {
          if ((previous.decision === "ALLOW") !== approve) throw new Error("Payment already resolved");
          const { decision, reason, ruleId } = previous;
          return { decision, reason, ruleId };
        }
        const payment = find.get("payment", id);
        if (payment?.decision !== "HOLD") throw new Error("Payment is not waiting for approval");
        const { payee, amount } = payment;
        const now = clock();
        const timestamp = new Date(now).toISOString();
        const result = approve
          ? evaluate(payee, amount, now, timestamp)
          : block("family_rejected", "Family rejected payment");
        if (approve && result.decision === "BLOCK") {
          insert.run("review_attempt", `${id}:${randomUUID()}`, timestamp, payee, amount,
            result.decision, result.ruleId, result.reason);
          return result;
        }
        const resolution = approve
          ? { decision: "ALLOW", ruleId: "family_approved", reason: "Family approved payment" }
          : result;
        insert.run("resolution", id, timestamp, payee, amount,
          resolution.decision, resolution.ruleId, resolution.reason);
        return resolution;
      });
    },

    pending() {
      return held.all();
    },

    payment(id) {
      validateId(id);
      return find.get("resolution", id) ?? find.get("payment", id);
    },

    balance() {
      return String(totals().balance);
    },

    audit() {
      return entries.all().filter(row => row.decision !== null);
    },

    close() {
      db.close();
    },
  };
}
