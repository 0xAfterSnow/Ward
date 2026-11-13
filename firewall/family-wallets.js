import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createMockWard, inTransaction, openWardDatabase, validateRules, WardInputError } from "./mock-ward.js";

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const INVITE_MS = 10 * 60_000;
const token = () => randomBytes(32).toString("base64url");
const digest = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
  ? createHash("sha256").update(value).digest("hex") : "";

export function openFamilyWallets(filename, { clock, authClock = Date.now, cloudScreen } = {}) {
  const db = openWardDatabase(filename);
  db.exec(`
    CREATE TABLE IF NOT EXISTS families (
      family_id TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE,
      child_name TEXT NOT NULL, parent_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_chain (
      family_id TEXT PRIMARY KEY REFERENCES families (family_id),
      approver TEXT NOT NULL UNIQUE, requester TEXT, scoped TEXT
    );
    CREATE TABLE IF NOT EXISTS wallet_chain_intents (
      family_id TEXT NOT NULL REFERENCES families (family_id), id TEXT NOT NULL,
      data TEXT NOT NULL, PRIMARY KEY (family_id, id)
    );
    CREATE TABLE IF NOT EXISTS wallet_review_messages (
      family_id TEXT NOT NULL REFERENCES families (family_id),
      scope TEXT NOT NULL, payment_id TEXT NOT NULL,
      asked TEXT, message TEXT NOT NULL,
      PRIMARY KEY (family_id, scope, payment_id)
    );
    CREATE TABLE IF NOT EXISTS wallet_sessions (
      family_id TEXT NOT NULL REFERENCES families (family_id),
      digest TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('family', 'elder')),
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wallet_sessions_family ON wallet_sessions (family_id, role);
    CREATE TABLE IF NOT EXISTS family_signin (
      family_id TEXT PRIMARY KEY REFERENCES families (family_id),
      digest TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS wallet_invites (
      family_id TEXT PRIMARY KEY REFERENCES families (family_id),
      digest TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL
    );
  `);
  const insertReviewMessage = db.prepare("INSERT OR IGNORE INTO wallet_review_messages VALUES (?, ?, ?, ?, ?)");
  const selectReviewMessage = db.prepare("SELECT asked, message FROM wallet_review_messages WHERE family_id = ? AND scope = ? AND payment_id = ?");
  const family = db.prepare("SELECT * FROM families WHERE family_id = ?");
  const insertFamily = db.prepare("INSERT INTO families VALUES (?, ?, ?, ?)");
  const chain = db.prepare("SELECT approver, requester, scoped FROM wallet_chain WHERE family_id = ?");
  const chainOwner = db.prepare("SELECT 1 FROM wallet_chain WHERE approver = ?");
  const insertChain = db.prepare("INSERT INTO wallet_chain VALUES (?, ?, NULL, NULL)");
  const setDevice = db.prepare("UPDATE wallet_chain SET requester = ?, scoped = ? WHERE family_id = ?");
  const selectIntent = db.prepare("SELECT data FROM wallet_chain_intents WHERE family_id = ? AND id = ?");
  const insertIntent = db.prepare("INSERT INTO wallet_chain_intents VALUES (?, ?, ?) ON CONFLICT DO NOTHING");
  const settings = db.prepare("INSERT INTO settings VALUES (?, ?)");
  const getSession = db.prepare("SELECT family_id, role FROM wallet_sessions WHERE digest = ? AND expires > ?");
  const connected = db.prepare("SELECT 1 FROM wallet_sessions WHERE family_id = ? AND role = 'elder' AND expires > ?");
  const insertSession = db.prepare("INSERT INTO wallet_sessions VALUES (?, ?, ?, ?)");
  const deleteSession = db.prepare("DELETE FROM wallet_sessions WHERE digest = ?");
  const signInFamily = db.prepare("SELECT family_id FROM family_signin WHERE digest = ?");
  const hasSignIn = db.prepare("SELECT 1 FROM family_signin WHERE family_id = ?");
  const saveSignIn = db.prepare(`INSERT INTO family_signin VALUES (?, ?)
    ON CONFLICT(family_id) DO UPDATE SET digest = excluded.digest`);
  const revoke = db.prepare("DELETE FROM wallet_sessions WHERE family_id = ? AND role = 'elder'");
  const saveInvite = db.prepare("INSERT OR REPLACE INTO wallet_invites VALUES (?, ?, ?)");
  const clearInvite = db.prepare("DELETE FROM wallet_invites WHERE family_id = ?");
  const getInvite = db.prepare("SELECT family_id FROM wallet_invites WHERE digest = ? AND expires > ?");
  const consume = db.prepare("DELETE FROM wallet_invites WHERE digest = ? AND expires > ? RETURNING family_id");

  function issueSession(id, role) {
    const value = token();
    insertSession.run(id, digest(value), role, authClock() + SESSION_SECONDS * 1000);
    return value;
  }

  const inviteError = () => new WardInputError("This pairing link expired or was already used", 403);

  return {
    create({ childName, parentName, ...inputs }, provisioned) {
      const names = [childName, parentName].map(value =>
        typeof value === "string" && value.length <= 60 ? value.trim() : "");
      if (names.some(name => !name)) throw new WardInputError("Enter both names, up to 60 characters each");
      const rules = validateRules(inputs);
      return inTransaction(db, () => {
        const id = randomUUID();
        insertFamily.run(id, provisioned?.address ?? `demo-${randomBytes(12).toString("hex")}`, ...names);
        if (provisioned) insertChain.run(id, provisioned.approver);
        settings.run(id, JSON.stringify({ ...rules, rulesVersion: 1, frozen: false }));
        return { id, session: issueSession(id, "family") };
      });
    },

    // Separate from audit and chain arguments; only the Family dashboard exposes this data.
    saveReviewMessage(familyId, scope, paymentId, { asked, memo }) {
      insertReviewMessage.run(familyId, scope, String(paymentId), asked ?? null, memo ?? "");
    },
    reviewMessage: (familyId, scope, paymentId) => selectReviewMessage.get(familyId, scope, String(paymentId)),
    family: id => family.get(id),
    chain: id => chain.get(id),
    hasChainOwner: account => Boolean(chainOwner.get(account)),
    intent: (id, ref) => JSON.parse(selectIntent.get(id, ref)?.data ?? "null"),
    saveIntent(id, ref, data) {
      insertIntent.run(id, ref, JSON.stringify(data));
      return JSON.parse(selectIntent.get(id, ref).data);
    },
    session: value => getSession.get(digest(value), authClock()),
    signOut: value => deleteSession.run(digest(value)),
    hasSignIn: id => Boolean(hasSignIn.get(id)),
    createSignIn(id) {
      const code = token();
      saveSignIn.run(id, digest(code));
      return code;
    },
    signIn(code, testnet) {
      const record = signInFamily.get(digest(typeof code === "string" ? code.trim() : code));
      if (!record || Boolean(chain.get(record.family_id)) !== testnet) {
        throw new WardInputError("That Family sign-in code is invalid", 401);
      }
      const id = record.family_id;
      return { id, session: issueSession(id, "family") };
    },
    connected: id => Boolean(connected.get(id, authClock())),

    ward(id) {
      return createMockWard(db, { familyId: id, policy: { openPayees: true, timeWindows: [] }, clock, cloudScreen });
    },

    invite(id, replace) {
      return inTransaction(db, () => {
        if (!replace && connected.get(id, authClock())) {
          throw new WardInputError("Mama is connected. Choose Replace device to invite a new phone", 409);
        }
        if (replace) {
          revoke.run(id);
          setDevice.run(null, null, id);
        }
        const value = token();
        saveInvite.run(id, digest(value), authClock() + INVITE_MS);
        return value;
      });
    },

    previewInvite(value) {
      const invite = getInvite.get(digest(value), authClock());
      if (!invite) throw inviteError();
      return { childName: family.get(invite.family_id).child_name };
    },

    acceptInvite(value, device, testnet = false) {
      return inTransaction(db, () => {
        const invite = consume.get(digest(value), authClock());
        if (!invite) throw inviteError();
        if (Boolean(chain.get(invite.family_id)) !== testnet) throw inviteError();
        if (testnet) {
          if (device.account === chain.get(invite.family_id).approver) throw new WardInputError("Use a separate device key");
          setDevice.run(device.account, device.scoped, invite.family_id);
        }
        revoke.run(invite.family_id);
        return { id: invite.family_id, session: issueSession(invite.family_id, "elder") };
      });
    },

    unpair(id) {
      return inTransaction(db, () => {
        revoke.run(id);
        setDevice.run(null, null, id);
        clearInvite.run(id);
      });
    },

    close: () => db.close(),
  };
}
