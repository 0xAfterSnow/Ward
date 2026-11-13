import { randomBytes } from "node:crypto";
import { SESSION_SECONDS } from "./family-wallets.js";
import { fundingSources } from "./funding.js";
import { amountOf, check, isAccountId } from "./policy.js";
import { validateRules } from "./mock-ward.js";
import { NOTE_LIMIT, REVIEW_SCORE, screenNote } from "./screening.js";

const token = () => randomBytes(32).toString("base64url");

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
  requested_review: "Mama asked for a review or reported pressure",
  settlement_failed: "Testnet could not deliver the payment",
};

export function createWalletApi({ wallets, origin, toAtomic, format, quoteFunding, chain, clock = Date.now }) {
  const quotes = new Map();
  const cookieName = chain?.asset === "usdc" ? "ward_usdc_session" : "ward_session";
  const cookie = (value, maxAge = SESSION_SECONDS) =>
    `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${origin.startsWith("https:") ? "; Secure" : ""}`;

  async function dashboard(ward, familyId, role) {
    const family = wallets.family(familyId);
    const { places, dailyCap, perTxCeiling, approvalThreshold, leftToday, rulesVersion, ...status } = ward.status();
    const device = chain && wallets.chain(familyId);
    const live = device && await chain.state(family.address);
    const deviceReady = Boolean(live?.requester && live.requester === device.requester
      && await chain.scoped(device.requester, device.scoped, family.address));
    const names = new Map(places.map(({ id, label }) => [id, label]));
    const rowView = (row, includeReview = false) => ({
      id: String(row.id).split(":")[0],
      ...(role === "family" && includeReview === true ? { reviewMessage: wallets.reviewMessage(familyId, chain ? "chain" : "mock", String(row.id).split(":")[0]) ?? null } : {}),
      kind: row.kind,
      payee: names.get(row.payee) ?? (role === "family" ? row.payee : null),
      amount: row.amount === null ? null : format(row.amount),
      decision: row.decision,
      ruleId: row.ruleId,
      reason: explanations[row.ruleId] ?? row.reason,
      timestamp: row.timestamp,
      signals: row.signals ?? [],
      hash: row.hash,
    });
    const audit = ward.audit();
    const receipts = ward.receipts().slice(-12).reverse().map(({ sender, amount, timestamp }) =>
      ({ sender, amount: format(amount), timestamp }));
    const data = { role, name: family.parent_name, childName: family.child_name,
      balance: format(live?.balance ?? ward.balance()), leftToday: format(live?.leftToday ?? leftToday), receipts,
      frozen: live?.frozen ?? status.frozen, ...(live ? {
        mode: "testnet", address: family.address, deviceReady,
        ...(chain.asset === "usdc" ? { asset: chain.asset } : {}),
        ...(role === "elder" ? { deviceAccount: device.requester } : {}),
        requesterEnabled: Boolean(device.requester && live.requester === device.requester),
      } : {}) };

    const requests = ward.familyRequests();
    if (role === "family") {
      const recent = audit.filter(row => row.decision && Date.parse(row.timestamp) > clock() - 86_400_000);
      const counts = { ALLOW: 0, HOLD: 0, BLOCK: 0 };
      for (const row of recent) counts[row.decision]++;
      return {
        ...data, address: family.address, paired: live ? deviceReady : wallets.connected(familyId),
        hasSignIn: wallets.hasSignIn(familyId),
        ...(live ? { fundingAccount: device.approver, deviceRequested: Boolean(device.requester), deviceAttached: Boolean(live.requester) } : {}),
        pending: live ? (live.pending ? [rowView({
          ...live.pending, kind: "payment", decision: "HOLD", ruleId: ward.payment(live.pending.id)?.ruleId ?? "requested_review",
        }, true)] : []) : ward.pending().map(row => rowView(row, true)),
        blockedAlerts: ward.blockedAlerts().map(row => ({ ...rowView(row), alertId: String(row.sequence) })),
        requests: requests.filter(row => row.status === "pending").map(({ family_id, ...row }) => row),
        audit: audit.map(rowView).reverse(),
        summary: { counts, stopped: recent.filter(row => row.decision === "BLOCK").map(rowView).reverse() },
        rules: { dailyCap: format(live?.dailyCap ?? dailyCap), perTxCeiling: format(live?.perTxCeiling ?? perTxCeiling),
          approvalThreshold: format(live?.approvalThreshold ?? approvalThreshold), places, rulesVersion },
        sources: Object.entries(fundingSources).map(([id, source]) => ({ id, label: source.label })),
      };
    }
    const latest = new Map();
    for (const row of audit) {
      if (row.kind === "payment" || row.kind === "resolution") latest.set(row.id, row);
    }
    return {
      ...data, payees: places, payments: [...latest.values()].map(row => ({
        ...rowView(row),
        ...(row.kind === "payment" && row.decision === "BLOCK" ? { seenByFamily: ward.blockSeen(row.sequence) } : {}),
      })).reverse(),
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

  const deviceId = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

  function checkChain(payment, live) {
    const result = check(payment, { ...live, openPayees: true, payees: [],
      spentToday: String(BigInt(live.dailyCap) - BigInt(live.leftToday)), timeWindows: [] });
    if (result.decision !== "BLOCK" && amountOf(payment.amount) > BigInt(live.balance)) {
      return { decision: "BLOCK", ruleId: "vault_balance",
        checks: [...result.checks, { ruleId: "vault_balance", passed: false, label: "Enough in the vault" }] };
    }
    return result;
  }

  async function prepareChain({ body, familyId, role, ward, rulesInput, authorize }) {
    const { id, op } = body;
    if (!validId(id)) throw new ApiError(400, "Invalid transaction reference");
    const device = wallets.chain(familyId);
    const previous = wallets.intent(familyId, id);
    if (previous) {
      const signer = role === "elder" ? device.requester : device.approver;
      if (previous.op !== op || previous.role !== role || previous.signer !== signer) {
        throw new ApiError(422, "That saved action belongs to a different device. Retry from this device to start a new action.");
      }
      return previous;
    }

    const address = wallets.family(familyId).address;
    const live = await chain.state(address);
    let signer = device.approver;
    let keyHex = signer;
    let args;
    let localRules;
    let reviewMessage;
    if (role === "elder") {
      signer = device.requester;
      if (!signer || live.requester !== signer) throw new ApiError(409, "Ask your family to enable this device first");
      if (op === "scope") {
        keyHex = signer;
        args = { scoped: device.scoped };
      } else if (op === "pay") {
        keyHex = device.scoped;
        if (!(await chain.scoped(signer, keyHex, address))) throw new ApiError(409, "Finish connecting this phone first");
        const { payee, amount, memo, asked } = paymentBody(body);
        reviewMessage = { asked, memo };
        if (!isAccountId(payee) || amountOf(amount) === null) throw new ApiError(400, "Enter a valid recipient and amount");
        if (chain.asset === "usdc" && checkChain({ payee, amount }, live).decision !== "BLOCK"
          && !(await chain.isRegistered(payee))) {
          throw new ApiError(422, "This recipient needs USDC registration. Ask your family to register the address first.");
        }
        args = { payee, amount, force_review: asked === "yes" || asked === "unsure" || screenNote(memo).score >= REVIEW_SCORE };
      } else throw new ApiError(403, "Family access required");
    } else {
      switch (op) {
        case "fund":
        case "withdraw": {
          const amount = toAtomic(body.dollars);
          if (!(amountOf(amount) > 0n)) throw new ApiError(400, "Enter a positive amount in the wallet’s currency");
          args = { amount };
          break;
        }
        case "register":
          if (chain.asset !== "usdc" || !isAccountId(body.recipient)) throw new ApiError(400, "Enter a valid NEAR testnet account");
          args = { recipient: body.recipient };
          break;
        case "review":
          if (!live.pending || body.requestId !== live.pending.id || typeof body.approve !== "boolean") {
            throw new ApiError(409, "This payment is no longer waiting for approval");
          }
          if (chain.asset === "usdc" && body.approve && !(await chain.isRegistered(live.pending.payee))) {
            throw new ApiError(422, "Register the recipient for USDC before approving this payment");
          }
          args = { request_id: body.requestId, approve: body.approve };
          break;
        case "requester":
          if (typeof body.connect !== "boolean" || (body.connect && !device.requester)) {
            throw new ApiError(400, "Choose a device to connect");
          }
          args = { requester: body.connect ? device.requester : null, scoped: body.connect ? device.scoped : null };
          break;
        case "freeze":
          if (typeof body.frozen !== "boolean") throw new ApiError(400, "Choose whether to freeze the wallet");
          args = { frozen: body.frozen };
          break;
        case "limits":
          localRules = { ...validateRules(rulesInput(body)), rulesVersion: body.rulesVersion };
          if (localRules.rulesVersion !== ward.status().rulesVersion) throw new ApiError(409, "Reload the latest family rules");
          args = localRules;
          break;
        default: throw new ApiError(403, "This action requires the connected spender device");
      }
    }
    authorize();
    const transaction = await chain.prepare({ op, signer, keyHex, address, args });
    authorize();
    if (reviewMessage) wallets.saveReviewMessage(familyId, "intent", id, reviewMessage);
    return wallets.saveIntent(familyId, id, { ...transaction, op, role, signer, args, localRules });
  }

  async function finishChain({ body, familyId, role, ward, authorize }) {
    if (!validId(body.id)) throw new ApiError(400, "Invalid transaction reference");
    const intent = wallets.intent(familyId, body.id);
    if (!intent || intent.role !== role) throw new ApiError(404, "Transaction not found");
    const family = wallets.family(familyId);
    const events = await chain.finalized(intent, family.address);
    authorize();
    let result = { reason: "Confirmed on NEAR testnet", hash: intent.hash };
    for (const event of events.filter(item => item.event === "payment_decision")) {
      const { result: decision } = event;
      const failed = decision.decision === "ALLOW" && !events.some(item => item.event === "payment_settlement"
        && item.requestId === event.requestId && item.status === "SETTLED");
      const kind = intent.op === "pay" ? "payment"
        : (intent.op === "review" && intent.args.approve && decision.decision === "BLOCK") ? "review_attempt" : "resolution";
      result = failed ? { ...result, decision: "BLOCK", ruleId: "settlement_failed", reason: explanations.settlement_failed }
        : { ...result, ...decision };
      ward.recordChainDecision({ ...result, event, kind });
      if (intent.op === "pay" && event.requestId != null) {
        const saved = wallets.reviewMessage(familyId, "intent", body.id);
        if (saved) wallets.saveReviewMessage(familyId, "chain", event.requestId, { asked: saved.asked, memo: saved.message });
      }
    }
    if (["pay", "review"].includes(intent.op) && !result.decision) throw new ApiError(502, "Payment receipt missing");
    if (intent.op === "fund") ward.recordChainFunding({ hash: intent.hash, amount: intent.args.amount, sender: family.child_name });
    if (intent.op === "limits" && ward.status().rulesVersion === intent.localRules.rulesVersion) ward.updateRules(intent.localRules);
    return { result, wallet: await dashboard(ward, familyId, role) };
  }

  return async (req, res, pathname) => {
    try {
      if (req.method !== "GET" && req.method !== "POST") throw new ApiError(405, "Method unavailable");
      if (req.method === "POST" && req.headers.origin !== origin) {
        throw new ApiError(403, "Open Mama Wallet from its own address");
      }
      if (req.method === "GET" && pathname === "/api/mode") {
        return send(res, 200, { mode: chain ? "testnet" : "demo",
          ...(chain?.asset === "usdc" ? { asset: chain.asset, token: chain.token, registrationCost: chain.registrationCost } : {}) });
      }
      const body = req.method === "POST" ? await readBody(req) : null;
      const sessionId = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([\\w-]+)`))?.[1];
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
      if (body && pathname === "/api/family-sign-in") {
        if (session) throw new ApiError(409, "Sign out or open a separate browser profile");
        const { id, session: value } = wallets.signIn(body.code, Boolean(chain));
        return send(res, 200, await dashboard(wallets.ward(id), id, "family"), { "Set-Cookie": cookie(value) });
      }
      if (body && (pathname === "/api/onboarding" || pathname === "/api/pair")) {
        if (session) throw new ApiError(409, "Open this in a separate browser profile");
        const family = pathname === "/api/onboarding";
        let provisioned;
        const rules = rulesInput(body);
        if (chain && family) {
          validateRules(rules);
          if (!deviceId(body.account) || [body.childName, body.parentName].some(name =>
            typeof name !== "string" || !name.trim() || name.length > 60)) throw new ApiError(400, "Enter both names and a device account");
          if (wallets.hasChainOwner(body.account)) throw new ApiError(409, "This device key already has a testnet wallet");
          provisioned = { address: await chain.provision(body.account, rules), approver: body.account };
        }
        if (chain && !family && (!deviceId(body.account) || !deviceId(body.scoped) || body.account === body.scoped)) {
          throw new ApiError(400, "Separate testnet device keys are required");
        }
        const { id, session: value } = family ? wallets.create(rules, provisioned)
          : wallets.acceptInvite(body.code, { account: body.account, scoped: body.scoped }, Boolean(chain));
        return send(res, family ? 201 : 200, await dashboard(wallets.ward(id), id, family ? "family" : "elder"),
          { "Set-Cookie": cookie(value) });
      }

      if (!session) throw new ApiError(401, "Set up a wallet or open a fresh pairing link to continue");
      const { role, family_id: familyId } = session;
      if (Boolean(wallets.chain(familyId)) !== Boolean(chain)) throw new ApiError(401, "Open the wallet in its original network mode");
      const ward = wallets.ward(familyId);
      const view = () => dashboard(ward, familyId, role);
      if (req.method === "GET" && pathname === "/api/wallet") return send(res, 200, await view());
      if (!body) throw new ApiError(404, "Page unavailable");
      if (pathname === "/api/family-sign-in-code" || pathname === "/api/family-sign-out") {
        if (role !== "family") throw new ApiError(403, "Family access required");
        if (pathname === "/api/family-sign-in-code") {
          return send(res, 200, { code: wallets.createSignIn(familyId) });
        }
        wallets.signOut(sessionId);
        return send(res, 200, { signedOut: true }, { "Set-Cookie": cookie("", 0) });
      }
      const authorize = () => {
        if (wallets.session(sessionId)?.family_id !== familyId) throw new ApiError(401, "This device is no longer connected");
      };
      if (chain && pathname === "/api/chain-prepare") {
        const { bytes, hash } = await prepareChain({ body, familyId, role, ward, rulesInput, authorize });
        return send(res, 200, { bytes, hash });
      }
      if (chain && pathname === "/api/chain-finish") {
        return send(res, 200, await finishChain({ body, familyId, role, ward, authorize }));
      }
      if (chain && ["/api/payments", "/api/funding-quote", "/api/funding-confirm", "/api/rules", "/api/freeze", "/api/review"].includes(pathname)) {
        throw new ApiError(409, "Use the signed NEAR testnet flow");
      }

      if (role === "elder") {
        if (pathname === "/api/payment-preview") {
          const payment = paymentBody(body);
          let result;
          if (chain) {
            const live = await chain.state(wallets.family(familyId).address);
            result = checkChain(payment, live);
          } else result = ward.previewPayment(payment);
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
          wallets.saveReviewMessage(familyId, "mock", payment.id, payment);
          return send(res, 200, { result, wallet: await view() });
        }
        if (pathname === "/api/family-requests") {
          const data = body;
          if (!validId(data.id)) throw new ApiError(400, "Invalid request reference");
          ward.requestFamily(data);
          return send(res, 201, await view());
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
        if (chain && body.replace && (await chain.state(wallets.family(familyId).address)).requester) {
          throw new ApiError(409, "Disconnect the device on testnet before replacing it");
        }
        const code = wallets.invite(familyId, body.replace === true);
        return send(res, 201, { link: `${origin}/elder#pair=${code}` });
      }
      if (pathname === "/api/unpair") {
        if (chain && (await chain.state(wallets.family(familyId).address)).requester) {
          throw new ApiError(409, "Disconnect the device on testnet first");
        }
        wallets.unpair(familyId);
        return send(res, 200, await view());
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
          if (ward.receipts().some(row => row.id === id)) return send(res, 200, await view());
          throw new ApiError(409, "This quote expired. Request a new quote");
        }
        ward.creditMockFunding(quote);
        quotes.delete(id);
        return send(res, 200, await view());
      }
      if (pathname === "/api/rules") {
        ward.updateRules(rulesInput(body));
        return send(res, 200, await view());
      }
      if (pathname === "/api/freeze") {
        ward.setFrozen(body.frozen);
        return send(res, 200, await view());
      }
      if (pathname === "/api/acknowledge-block") {
        if (typeof body.id !== "string" || !/^\d{1,16}$/.test(body.id)) throw new ApiError(400, "Invalid alert reference");
        ward.acknowledgeBlock(body.id);
        return send(res, 200, await view());
      }
      if (pathname === "/api/family-response") {
        const data = body;
        if (!validId(data.id)) throw new ApiError(400, "Invalid request reference");
        ward.resolveFamilyRequest(data);
        return send(res, 200, await view());
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
        return send(res, 200, { result, wallet: await view() });
      }
      throw new ApiError(404, "Page unavailable");
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.destroyed) send(res, error.status ?? 500, { error: error.status ? error.message : "Wallet is temporarily unavailable" });
    }
  };
}
