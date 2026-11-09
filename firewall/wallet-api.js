import { randomBytes, timingSafeEqual } from "node:crypto";

const token = () => randomBytes(32).toString("base64url");
const SESSION_MS = 8 * 60 * 60_000;
const INVITE_MS = 10 * 60_000;
const COOKIE = "ward_session";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new ApiError(415, "Expected JSON");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4096) throw new ApiError(413, "Request is too large");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new ApiError(400, "Invalid request");
  }
}

function send(res, status, data, headers) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}

function sameToken(value, expected) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
    && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

function validId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

// Transport and role checks belong to Ward. This instance controls a single mock wallet.
export function createWalletApi({ ward, origin, familyCode, payees, fundingAmount, toAtomic, format }) {
  const sessions = new Map();
  const invites = new Map();
  const payeeNames = new Map(payees.map(({ id, label }) => [id, label]));
  const cookie = (value, age) =>
    `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;

  function rowView(row) {
    return {
      id: row.id.split(":")[0],
      payee: payeeNames.get(row.payee) ?? row.payee ?? "Unknown payee",
      amount: row.amount === null ? null : format(row.amount),
      decision: row.decision,
      ruleId: row.ruleId,
      reason: row.reason,
      timestamp: row.timestamp,
    };
  }

  function dashboard(role) {
    const audit = ward.audit();
    const data = { role, balance: format(ward.balance()) };
    if (role === "family") {
      return { ...data, pending: ward.pending().map(rowView), audit: audit.map(rowView).reverse() };
    }
    const latest = new Map();
    for (const row of audit) {
      if (row.kind !== "review_attempt") latest.set(row.id, row);
    }
    return { ...data, payees, payments: [...latest.values()].map(rowView).reverse() };
  }

  return async (req, res, pathname) => {
    try {
      if (req.method !== "GET" && req.method !== "POST") throw new ApiError(405, "Method unavailable");
      if (req.method === "POST" && req.headers.origin !== origin) {
        throw new ApiError(403, "Open Mama Wallet from its own address");
      }
      const sessionId = req.headers.cookie?.match(/(?:^|;\s*)ward_session=([\w-]+)/)?.[1];
      const now = Date.now();
      for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
      for (const [code, expires] of invites) if (expires <= now) invites.delete(code);
      const role = sessions.get(sessionId)?.role;

      if (req.method === "POST" && (pathname === "/api/family-session" || pathname === "/api/pair")) {
        const { code } = await readBody(req);
        const family = pathname === "/api/family-session";
        if (family ? !sameToken(code, familyCode) : !(invites.get(code) > Date.now() && invites.delete(code))) {
          throw new ApiError(403, family ? "This family link is invalid" : "This pairing link has expired or was already used");
        }
        const id = token();
        sessions.delete(sessionId);
        sessions.set(id, { role: family ? "family" : "elder", expires: Date.now() + SESSION_MS });
        return send(res, 200, { role: sessions.get(id).role }, { "Set-Cookie": cookie(id, SESSION_MS / 1000) });
      }

      if (!role) throw new ApiError(401, "Open a family setup or pairing link to continue");
      if (req.method === "GET" && pathname === "/api/wallet") return send(res, 200, dashboard(role));
      if (req.method !== "POST") throw new ApiError(404, "Page unavailable");

      if (pathname === "/api/payments" && role === "elder") {
        const { id, payee, credits } = await readBody(req);
        if (!validId(id)) throw new ApiError(400, "Invalid payment reference");
        let result;
        try {
          result = ward.requestPayment({ id, payee, amount: toAtomic(credits) });
        } catch (error) {
          if (error.message === "Payment ID already used") throw new ApiError(409, error.message);
          throw error;
        }
        return send(res, 200, { result, wallet: dashboard(role) });
      }

      if (role !== "family") throw new ApiError(403, "Family access required");
      if (pathname === "/api/invites") {
        if (invites.size >= 20) throw new ApiError(429, "Too many active links. Try again in a few minutes.");
        const code = token();
        invites.set(code, now + INVITE_MS);
        return send(res, 201, { link: `${origin}/elder#pair=${code}` });
      }
      if (pathname === "/api/fund") {
        const { id } = await readBody(req);
        if (!validId(id)) throw new ApiError(400, "Invalid funding reference");
        ward.creditMockFunding({ id, amount: fundingAmount });
        return send(res, 200, dashboard(role));
      }
      if (pathname === "/api/review") {
        const { id, approve } = await readBody(req);
        if (!validId(id) || typeof approve !== "boolean") throw new ApiError(400, "Choose a payment and an action");
        let result;
        try {
          result = ward.resolvePayment({ id, approve });
        } catch (error) {
          if (["Payment already resolved", "Payment is not waiting for approval"].includes(error.message)) {
            throw new ApiError(409, error.message);
          }
          throw error;
        }
        return send(res, 200, { result, wallet: dashboard(role) });
      }
      throw new ApiError(404, "Page unavailable");
    } catch (error) {
      if (!(error instanceof ApiError)) console.error(error);
      if (!res.destroyed) send(res, error.status ?? 500, { error: error.status ? error.message : "Wallet is temporarily unavailable" });
    }
  };
}
