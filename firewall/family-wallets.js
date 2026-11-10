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
    CREATE TABLE IF NOT EXISTS wallet_sessions (
      family_id TEXT NOT NULL REFERENCES families (family_id),
      digest TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('family', 'elder')),
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wallet_sessions_family ON wallet_sessions (family_id, role);
    CREATE TABLE IF NOT EXISTS wallet_invites (
      family_id TEXT PRIMARY KEY REFERENCES families (family_id),
      digest TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL
    );
  `);
  const family = db.prepare("SELECT * FROM families WHERE family_id = ?");
  const insertFamily = db.prepare("INSERT INTO families VALUES (?, ?, ?, ?)");
  const settings = db.prepare("INSERT INTO settings VALUES (?, ?)");
  const getSession = db.prepare("SELECT family_id, role FROM wallet_sessions WHERE digest = ? AND expires > ?");
  const connected = db.prepare("SELECT 1 FROM wallet_sessions WHERE family_id = ? AND role = 'elder' AND expires > ?");
  const insertSession = db.prepare("INSERT INTO wallet_sessions VALUES (?, ?, ?, ?)");
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
    create({ childName, parentName, ...inputs }) {
      const names = [childName, parentName].map(value =>
        typeof value === "string" && value.length <= 60 ? value.trim() : "");
      if (names.some(name => !name)) throw new WardInputError("Enter both names, up to 60 characters each");
      const rules = validateRules(inputs);
      return inTransaction(db, () => {
        const id = randomUUID();
        insertFamily.run(id, `demo-${randomBytes(12).toString("hex")}`, ...names);
        settings.run(id, JSON.stringify({ ...rules, rulesVersion: 1, frozen: false }));
        return { id, session: issueSession(id, "family") };
      });
    },

    family: id => family.get(id),
    session: value => getSession.get(digest(value), authClock()),
    connected: id => Boolean(connected.get(id, authClock())),

    ward(id) {
      return createMockWard(db, { familyId: id, policy: { openPayees: true, timeWindows: [] }, clock, cloudScreen });
    },

    invite(id, replace) {
      return inTransaction(db, () => {
        if (!replace && connected.get(id, authClock())) {
          throw new WardInputError("Mama is connected. Choose Replace device to invite a new phone", 409);
        }
        if (replace) revoke.run(id);
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

    acceptInvite(value) {
      return inTransaction(db, () => {
        const invite = consume.get(digest(value), authClock());
        if (!invite) throw inviteError();
        revoke.run(invite.family_id);
        return { id: invite.family_id, session: issueSession(invite.family_id, "elder") };
      });
    },

    unpair(id) {
      return inTransaction(db, () => {
        revoke.run(id);
        clearInvite.run(id);
      });
    },

    close: () => db.close(),
  };
}
