import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { amountOf, block, check, isAccountId } from "./policy.js";
import { normalizeNote, NOTE_LIMIT, REVIEW_SCORE, screenNote, validScore } from "./screening.js";

function validateId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error("A valid request ID is required");
  }
}

export class WardInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function text(value, limit) {
  return typeof value === "string" && value.length <= limit ? value.trim() : "";
}

function place(input) {
  const label = text(input?.label, 80);
  if (!label || !isAccountId(input?.id)) {
    throw new WardInputError("Enter a name and a valid lowercase account ID for each place");
  }
  return { id: input.id, label };
}

export function inTransaction(db, write) {
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

export function validateRules({ dailyCap, perTxCeiling, approvalThreshold, places }) {
  const cap = amountOf(dailyCap);
  const ceiling = amountOf(perTxCeiling);
  const threshold = amountOf(approvalThreshold);
  if (!cap || !ceiling || threshold === null) throw new WardInputError("Enter valid amounts for all three limits");
  if (ceiling > cap) throw new WardInputError("The payment limit must be at or below the daily limit");
  if (threshold > ceiling) throw new WardInputError("Ask-me amount must be at or below the payment limit");
  if (!Array.isArray(places) || places.length > 32) throw new WardInputError("Choose up to 32 approved places");
  const approved = places.map(place);
  if (new Set(approved.map(item => item.id)).size !== approved.length) {
    throw new WardInputError("Each account can appear only once in approved places");
  }
  return { dailyCap, perTxCeiling, approvalThreshold, places: approved };
}

export function openWardDatabase(filename) {
  const db = new DatabaseSync(filename, { timeout: 5000 });
  try {
    inTransaction(db, () => {
      const hasLegacy = db.prepare("PRAGMA table_info(entries)").all();
      const migrate = hasLegacy.length && !hasLegacy.some(column => column.name === "family_id");
      const legacyTables = migrate
        ? ["entries", "entry_details", "settings", "family_requests"].filter(name =>
          db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
        : [];
      for (const name of legacyTables) db.exec(`ALTER TABLE ${name} RENAME TO legacy_${name}`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS entries (
          family_id TEXT NOT NULL, sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL,
          timestamp TEXT NOT NULL, payee TEXT, amount TEXT, decision TEXT, ruleId TEXT, reason TEXT,
          UNIQUE (family_id, kind, id), UNIQUE (family_id, sequence)
        );
        CREATE TABLE IF NOT EXISTS entry_details (
          family_id TEXT NOT NULL, sequence INTEGER NOT NULL, data TEXT NOT NULL,
          PRIMARY KEY (family_id, sequence),
          FOREIGN KEY (family_id, sequence) REFERENCES entries (family_id, sequence)
        );
        CREATE TABLE IF NOT EXISTS settings (family_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS family_requests (
          family_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, timestamp TEXT NOT NULL,
          payee TEXT, label TEXT, message TEXT, status TEXT NOT NULL DEFAULT 'pending',
          PRIMARY KEY (family_id, id)
        );
      `);
      const columns = {
        entries: "sequence, kind, id, timestamp, payee, amount, decision, ruleId, reason",
        entry_details: "sequence, data", settings: "data",
        family_requests: "id, type, timestamp, payee, label, message, status",
      };
      // Old rows belong to the local CLI namespace. Onboarding never claims it.
      for (const name of legacyTables) {
        db.exec(`INSERT INTO ${name} (family_id, ${columns[name]}) SELECT 'local', ${columns[name]} FROM legacy_${name}`);
      }
      for (const name of legacyTables.reverse()) db.exec(`DROP TABLE legacy_${name}`);
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openMockWard(filename, options) {
  const db = openWardDatabase(filename);
  return { ...createMockWard(db, options), close: () => db.close() };
}

// Every query on a ledger uses the family scope supplied by the server.
export function createMockWard(db, { familyId = "local", policy, clock = Date.now, cloudScreen, labels = {} } = {}) {
  const scope = sql => {
    const statement = db.prepare(sql);
    return Object.fromEntries(["all", "get", "run", "iterate"].map(method =>
      [method, (...args) => statement[method](familyId, ...args)]));
  };
  const entries = scope("SELECT * FROM entries WHERE family_id = ? ORDER BY sequence");
  const find = scope("SELECT * FROM entries WHERE family_id = ? AND kind = ? AND id = ?");
  const detail = scope("SELECT data FROM entry_details WHERE family_id = ? AND sequence = ?");
  const insertDetail = scope("INSERT INTO entry_details VALUES (?, ?, ?)");
  const selectSettings = scope("SELECT data FROM settings WHERE family_id = ?");
  const writeSettings = scope("INSERT OR REPLACE INTO settings VALUES (?, ?)");
  const insertRequest = scope("INSERT INTO family_requests (family_id, id, type, timestamp, payee, label, message) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const selectRequest = scope("SELECT * FROM family_requests WHERE family_id = ? AND id = ?");
  const selectRequests = scope("SELECT * FROM family_requests WHERE family_id = ? ORDER BY rowid DESC");
  const resolveRequest = db.prepare("UPDATE family_requests SET status = ? WHERE family_id = ? AND id = ?");
  const defaults = {
    dailyCap: policy?.dailyCap, perTxCeiling: policy?.perTxCeiling,
    approvalThreshold: policy?.approvalThreshold, frozen: policy?.frozen === true,
    places: policy?.payees?.map(id => ({ id, label: labels[id] ?? id })) ?? [],
    rulesVersion: 0,
  };
  const settings = () => {
    const row = selectSettings.get();
    return row ? JSON.parse(row.data) : defaults;
  };
  const save = next => writeSettings.run(JSON.stringify(next));
  const details = row => JSON.parse(detail.get(row.sequence)?.data ?? "{}");
  const withDetails = row => ({ ...row, ...details(row) });
  const held = scope(`
    SELECT payment.* FROM entries AS payment
    LEFT JOIN entries AS resolution ON resolution.family_id = payment.family_id AND resolution.kind = 'resolution' AND resolution.id = payment.id
    WHERE payment.family_id = ? AND payment.kind = 'payment' AND payment.decision = 'HOLD' AND resolution.id IS NULL
    ORDER BY payment.sequence
  `);
  const insert = scope(`
    INSERT INTO entries (family_id, kind, id, timestamp, payee, amount, decision, ruleId, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function record(kind, id, timestamp, payee, amount, decision, ruleId, reason, metadata) {
    const { lastInsertRowid } = insert.run(kind, id, timestamp, payee, amount, decision, ruleId, reason);
    if (metadata) insertDetail.run(lastInsertRowid, JSON.stringify(metadata));
  }

  function log(ruleId, reason, payee = null, metadata) {
    record("activity", randomUUID(), new Date(clock()).toISOString(), payee, null, null, ruleId, reason, metadata);
  }

  const atomic = write => inTransaction(db, write);

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
    const config = settings();
    const result = check({ payee, amount }, {
      ...policy, ...config, payees: config.places.map(place => place.id), spentToday: String(spent),
    }, now);
    if (result.decision !== "BLOCK" && amountOf(amount) > balance) {
      return {
        ...block("vault_balance", "Vault has insufficient spendable balance"),
        checks: [...result.checks, { ruleId: "vault_balance", passed: false, label: "Enough money in your wallet" }],
      };
    }
    return result;
  }

  function recordPayment({ id, payee, amount, memo, asked }, cloudScore = 0, authorize) {
    validateId(id);
    const parsedAmount = amountOf(amount);
    const auditAmount = parsedAmount === null ? null : amount;
    const auditPayee = isAccountId(payee) ? payee : null;
    return atomic(() => {
      authorize?.();
      const previous = find.get("payment", id);
      if (previous) {
        if (previous.payee !== auditPayee || previous.amount !== auditAmount) {
          throw new Error("Payment ID already used");
        }
        const { decision, reason, ruleId } = previous;
        return { decision, reason, ruleId, ...details(previous) };
      }
      const now = clock();
      const timestamp = new Date(now).toISOString();
      const hardDecision = evaluate(payee, amount, now, timestamp);
      const { score, signals } = hardDecision.decision === "BLOCK"
        ? { score: 0, signals: [] } : screenNote(memo);
      let result = { ...hardDecision, signals };
      if (hardDecision.decision !== "BLOCK" && (asked === "yes" || asked === "unsure")) {
        result = { ...result, decision: "HOLD", ruleId: "someone_asked", reason: "Mama says someone asked her to send this" };
      } else if (hardDecision.decision === "ALLOW" && Math.max(score, cloudScore) >= REVIEW_SCORE) {
        result = { ...result, decision: "HOLD", ruleId: "screening_risk", reason: "Payment note needs family review" };
      }
      record(
        "payment", id, timestamp, auditPayee, auditAmount,
        result.decision, result.ruleId, result.reason, { checks: result.checks, signals },
      );
      return result;
    });
  }

  return {
    creditMockFunding({ id, amount, sender }) {
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
        record("funding", id, new Date(clock()).toISOString(), null, amount, null, null, null, sender ? { sender } : undefined);
        return funded;
      });
    },

    requestPayment(tx) {
      return recordPayment(tx);
    },

    async requestScreenedPayment(tx, authorize) {
      validateId(tx.id);
      const note = normalizeNote(tx.memo);
      if (!cloudScreen || !note.trim() || screenNote(note).score >= REVIEW_SCORE || tx.asked === "yes" || tx.asked === "unsure" || find.get("payment", tx.id)) {
        return recordPayment(tx, 0, authorize);
      }
      const now = clock();
      if (evaluate(tx.payee, tx.amount, now, new Date(now).toISOString()).decision !== "ALLOW") {
        return recordPayment(tx, 0, authorize);
      }
      let score;
      try {
        score = await cloudScreen(note);
      } catch {
        // Keep the deterministic score when the provider is unavailable.
      }
      // Recheck current policy and balance in the write transaction after the network wait.
      return recordPayment(tx, validScore(score) ? score : 0, authorize);
    },

    resolvePayment({ id, approve }) {
      validateId(id);
      if (typeof approve !== "boolean") throw new Error("Choose approve or reject");
      return atomic(() => {
        const previous = find.get("resolution", id);
        if (previous) {
          if ((previous.decision === "ALLOW") !== approve) throw new Error("Payment already resolved");
          const { decision, reason, ruleId } = previous;
          return { decision, reason, ruleId, ...details(previous) };
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
          record("review_attempt", `${id}:${randomUUID()}`, timestamp, payee, amount,
            result.decision, result.ruleId, result.reason);
          return result;
        }
        const resolution = approve
          ? { decision: "ALLOW", ruleId: "family_approved", reason: "Family approved payment" }
          : result;
        record("resolution", id, timestamp, payee, amount,
          resolution.decision, resolution.ruleId, resolution.reason);
        return resolution;
      });
    },

    pending() {
      return held.all().map(withDetails);
    },

    payment(id) {
      validateId(id);
      return find.get("resolution", id) ?? find.get("payment", id);
    },

    balance() {
      return String(totals().balance);
    },

    audit() {
      return entries.all().filter(row => row.ruleId !== null).map(withDetails);
    },

    receipts() {
      return entries.all().filter(row => row.kind === "funding").map(withDetails).filter(row => row.sender);
    },

    status() {
      const config = settings();
      const spent = totals(new Date(clock()).toISOString().slice(0, 10)).spent;
      const remaining = (amountOf(config.dailyCap) ?? 0n) - spent;
      return { ...config, leftToday: String(remaining > 0n ? remaining : 0n) };
    },

    previewPayment({ payee, amount }) {
      const now = clock();
      return evaluate(payee, amount, now, new Date(now).toISOString());
    },

    updateRules({ dailyCap, perTxCeiling, approvalThreshold, places, rulesVersion }) {
      const rules = validateRules({ dailyCap, perTxCeiling, approvalThreshold, places });
      return atomic(() => {
        const previous = settings();
        if (rulesVersion !== previous.rulesVersion) throw new WardInputError("Rules changed. Close and reopen the editor to try again", 409);
        const next = { ...previous, ...rules, rulesVersion: rulesVersion + 1 };
        save(next);
        const changes = {};
        for (const key of ["dailyCap", "perTxCeiling", "approvalThreshold", "places"]) {
          if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
            changes[key] = { before: previous[key], after: next[key] };
          }
        }
        log("rules_updated", "Family updated the protection rules", null, { changes });
      });
    },

    setFrozen(frozen) {
      if (typeof frozen !== "boolean") throw new WardInputError("Choose whether to pause payments");
      return atomic(() => {
        const previous = settings();
        if (previous.frozen === frozen) return;
        save({ ...previous, frozen });
        log(frozen ? "wallet_paused" : "wallet_resumed", frozen ? "Family paused wallet payments" : "Family resumed wallet payments");
      });
    },

    requestFamily({ id, type, payee, label, message }) {
      validateId(id);
      if (type !== "payee" && type !== "help") throw new WardInputError("Choose a family request");
      const requested = type === "payee" ? place({ id: payee, label }) : null;
      if (message !== undefined && (typeof message !== "string" || message.length > NOTE_LIMIT)) {
        throw new WardInputError(`Use up to ${NOTE_LIMIT} characters for your message`);
      }
      return atomic(() => {
        const prior = selectRequest.get(id);
        const note = type === "help" ? text(message, NOTE_LIMIT) : null;
        if (prior) {
          if (prior.type !== type || prior.payee !== (requested?.id ?? null)
              || prior.label !== (requested?.label ?? null) || prior.message !== note) {
            throw new WardInputError("That request reference is already in use", 409);
          }
          return;
        }
        if (requested && settings().places.some(item => item.id === requested.id)) {
          throw new WardInputError("This place is already approved");
        }
        if (requested && selectRequests.all().some(row => row.status === "pending" && row.payee === requested.id)) {
          throw new WardInputError("Your family already has a request for this place", 409);
        }
        insertRequest.run(id, type, new Date(clock()).toISOString(), requested?.id ?? null, requested?.label ?? null, note);
        log(type === "help" ? "help_requested" : "payee_requested",
          type === "help" ? "Mama asked for help" : "Mama asked to add a new place", requested?.id);
      });
    },

    familyRequests() {
      return selectRequests.all();
    },

    resolveFamilyRequest({ id, approve }) {
      validateId(id);
      if (typeof approve !== "boolean") throw new WardInputError("Choose a response");
      return atomic(() => {
        const request = selectRequest.get(id);
        if (!request) throw new WardInputError("That request is unavailable", 404);
        const status = request.type === "help" ? "seen" : approve ? "approved" : "rejected";
        if (request.status === status) return;
        if (request.status !== "pending") throw new WardInputError("This request was already answered", 409);
        if (status === "approved") {
          const previous = settings();
          if (!previous.places.some(item => item.id === request.payee)) {
            if (previous.places.length >= 32) throw new WardInputError("Remove an approved place before adding another");
            const places = [...previous.places, { id: request.payee, label: request.label }];
            save({ ...previous, places, rulesVersion: previous.rulesVersion + 1 });
          }
        }
        resolveRequest.run(status, familyId, id);
        const reason = { seen: "Family saw Mama’s help request", approved: "Family approved a new place", rejected: "Family rejected a new place" };
        log(request.type === "help" ? "help_seen" : `payee_${status}`, reason[status], request.payee);
      });
    },

  };
}
