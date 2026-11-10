import { randomBytes } from "node:crypto";
import { SESSION_SECONDS } from "./family-wallets.js";
import { fundingSources } from "./funding.js";
import { NOTE_LIMIT } from "./screening.js";

const token = () => randomBytes(32).toString("base64url");
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
    if (length > 16_384) throw new ApiError(413, "Request is too large");
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

function validId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

const explanations = {
  per_tx_ceiling: "This is above the limit for one payment",
  daily_cap: "This is above what Mama has left to spend today",
  payee_allowlist: "This place is outside the family’s approved list",
  time_window: "This is outside the family’s spending hours",
  vault_balance: "There isn’t enough money in Mama’s wallet",
  approval_threshold: "This payment is above your ask-me amount",
  screening_risk: "The payment message showed signs of pressure",
};

export function createWalletApi({ wallets, origin, toAtomic, format, quoteFunding, clock = Date.now }) {
  const quotes = new Map();
  const cookie = value =>
    `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${origin.startsWith("https:") ? "; Secure" : ""}`;

  function dashboard(ward, familyId, role) {
    const family = wallets.family(familyId);
    const { places, dailyCap, perTxCeiling, approvalThreshold, leftToday, rulesVersion, ...status } = ward.status();
    const names = new Map(places.map(({ id, label }) => [id, label]));
    const rowView = row => ({
      id: row.id.split(":")[0],
      kind: row.kind,
      payee: names.get(row.payee) ?? (role === "family" ? row.payee : null),
      amount: row.amount === null ? null : format(row.amount),
      decision: row.decision,
      ruleId: row.ruleId,
      reason: explanations[row.ruleId] ?? row.reason,
      timestamp: row.timestamp,
      signals: row.signals ?? [],
    });
    const audit = ward.audit();
    const receipts = ward.receipts().slice(-12).reverse().map(({ sender, amount, timestamp }) =>
      ({ sender, amount: format(amount), timestamp }));
    const data = { role, name: family.parent_name, childName: family.child_name,
      balance: format(ward.balance()), leftToday: format(leftToday), receipts, frozen: status.frozen };

    const requests = ward.familyRequests();
    if (role === "family") {
      const recent = audit.filter(row => row.decision && Date.parse(row.timestamp) > clock() - 86_400_000);
      const counts = { ALLOW: 0, HOLD: 0, BLOCK: 0 };
      for (const row of recent) counts[row.decision]++;
      return {
        ...data, address: family.address, paired: wallets.connected(familyId),
        pending: ward.pending().map(rowView),
        requests: requests.filter(row => row.status === "pending").map(({ family_id, ...row }) => row),
        audit: audit.map(rowView).reverse(),
        summary: { counts, stopped: recent.filter(row => row.decision === "BLOCK").map(rowView).reverse() },
        rules: { dailyCap: format(dailyCap), perTxCeiling: format(perTxCeiling),
          approvalThreshold: format(approvalThreshold), places, rulesVersion },
        sources: Object.entries(fundingSources).map(([id, source]) => ({ id, label: source.label })),
      };
    }
    const latest = new Map();
    for (const row of audit) {
      if (row.kind === "payment" || row.kind === "resolution") latest.set(row.id, row);
    }
    return {
      ...data, payees: places, payments: [...latest.values()].map(rowView).reverse(),
      requests: requests.map(({ id, type, label, status }) => ({ id, type, label, status })),
    };
  }

  function paymentBody({ id, payee, dollars, credits, memo, asked }) {
    if (memo !== undefined && (typeof memo !== "string" || memo.length > NOTE_LIMIT)) {
      throw new ApiError(400, `Use up to ${NOTE_LIMIT} characters for your message`);
    }
    if (asked !== undefined && !["yes", "no", "unsure"].includes(asked)) {
      throw new ApiError(400, "Choose Yes, No or Not sure");
    }
    return { id, payee, amount: toAtomic(dollars ?? credits), memo, asked };
  }

  return async (req, res, pathname) => {
    try {
      if (req.method !== "GET" && req.method !== "POST") throw new ApiError(405, "Method unavailable");
      if (req.method === "POST" && req.headers.origin !== origin) {
        throw new ApiError(403, "Open Mama Wallet from its own address");
      }
      const body = req.method === "POST" ? await readBody(req) : null;
      const sessionId = req.headers.cookie?.match(/(?:^|;\s*)ward_session=([\w-]+)/)?.[1];
      const session = wallets.session(sessionId);
      const now = Date.now();
      for (const [id, quote] of quotes) if (quote.expires <= now) quotes.delete(id);
      const rulesInput = data => ({
        ...data, dailyCap: toAtomic(data.dailyCap), perTxCeiling: toAtomic(data.perTxCeiling),
        approvalThreshold: toAtomic(data.approvalThreshold),
      });

      if (body && pathname === "/api/invite-preview") {
        return send(res, 200, wallets.previewInvite(body.code));
      }
      if (body && (pathname === "/api/onboarding" || pathname === "/api/pair")) {
        if (session) throw new ApiError(409, "Open this in a separate browser profile");
        const family = pathname === "/api/onboarding";
        const { id, session: value } = family ? wallets.create(rulesInput(body)) : wallets.acceptInvite(body.code);
        return send(res, family ? 201 : 200, dashboard(wallets.ward(id), id, family ? "family" : "elder"),
          { "Set-Cookie": cookie(value) });
      }

      if (!session) throw new ApiError(401, "Set up a wallet or open a fresh pairing link to continue");
      const { role, family_id: familyId } = session;
      const ward = wallets.ward(familyId);
      const view = () => dashboard(ward, familyId, role);
      if (req.method === "GET" && pathname === "/api/wallet") return send(res, 200, view());
      if (!body) throw new ApiError(404, "Page unavailable");

      if (role === "elder") {
        if (pathname === "/api/payment-preview") {
          const result = ward.previewPayment(paymentBody(body));
          return send(res, 200, { checks: result.checks });
        }
        if (pathname === "/api/payments") {
          const payment = paymentBody(body);
          if (!validId(payment.id)) throw new ApiError(400, "Invalid payment reference");
          let result;
          try {
            result = await ward.requestScreenedPayment(payment, () => {
              if (wallets.session(sessionId)?.family_id !== familyId) {
                throw new ApiError(401, "This phone is no longer connected. Ask your family for a new link");
              }
            });
          } catch (error) {
            if (error.message === "Payment ID already used") throw new ApiError(409, error.message);
            throw error;
          }
          return send(res, 200, { result, wallet: view() });
        }
        if (pathname === "/api/family-requests") {
          const data = body;
          if (!validId(data.id)) throw new ApiError(400, "Invalid request reference");
          ward.requestFamily(data);
          return send(res, 201, view());
        }
        throw new ApiError(403, "Family access required");
      }

      if (["/api/payments", "/api/payment-preview", "/api/family-requests"].includes(pathname)) {
        throw new ApiError(403, "Mama’s phone is required for this action");
      }
      if (pathname === "/api/invites") {
        if (body.replace !== undefined && typeof body.replace !== "boolean") {
          throw new ApiError(400, "Choose whether to replace the connected phone");
        }
        const code = wallets.invite(familyId, body.replace === true);
        return send(res, 201, { link: `${origin}/elder#pair=${code}` });
      }
      if (pathname === "/api/unpair") {
        wallets.unpair(familyId);
        return send(res, 200, view());
      }
      if (pathname === "/api/funding-quote") {
        const { source, dollars } = body;
        const amount = toAtomic(dollars);
        if (!Object.hasOwn(fundingSources, source) || !amount || amount === "0") {
          throw new ApiError(400, "Choose a source and enter a positive dollar amount");
        }
        if ([...quotes.values()].filter(quote => quote.family_id === familyId).length >= 20) throw new ApiError(429, "Too many quotes. Try again in a few minutes.");
        const id = token();
        const quote = { id, family_id: familyId, amount, sender: wallets.family(familyId).child_name, expires: now + 5 * 60_000 };
        quotes.set(id, quote);
        let preview;
        try {
          preview = quoteFunding ? await quoteFunding({ source, amount }) : null;
        } catch {
          quotes.delete(id);
          throw new ApiError(502, "The 1Click dry quote is unavailable. Try again in a moment");
        }
        quote.ready = true;
        return send(res, 201, { id, label: fundingSources[source].label, dollars: format(amount),
          mode: preview ? "1Click dry quote" : "Fixture quote", output: preview?.output ?? null });
      }
      if (pathname === "/api/funding-confirm") {
        const { id } = body;
        if (!validId(id)) throw new ApiError(400, "Invalid quote reference");
        const quote = quotes.get(id);
        if (quote?.family_id !== familyId || !quote.ready || quote.expires <= Date.now()) {
          if (ward.receipts().some(row => row.id === id)) return send(res, 200, view());
          throw new ApiError(409, "This quote expired. Request a new quote");
        }
        ward.creditMockFunding(quote);
        quotes.delete(id);
        return send(res, 200, view());
      }
      if (pathname === "/api/rules") {
        ward.updateRules(rulesInput(body));
        return send(res, 200, view());
      }
      if (pathname === "/api/freeze") {
        ward.setFrozen(body.frozen);
        return send(res, 200, view());
      }
      if (pathname === "/api/family-response") {
        const data = body;
        if (!validId(data.id)) throw new ApiError(400, "Invalid request reference");
        ward.resolveFamilyRequest(data);
        return send(res, 200, view());
      }
      if (pathname === "/api/review") {
        const { id, approve } = body;
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
        return send(res, 200, { result, wallet: view() });
      }
      throw new ApiError(404, "Page unavailable");
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.destroyed) send(res, error.status ?? 500, { error: error.status ? error.message : "Wallet is temporarily unavailable" });
    }
  };
}
