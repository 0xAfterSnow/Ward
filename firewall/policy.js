const MAX_AMOUNT = (1n << 128n) - 1n;
const ACCOUNT_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MINUTES_PER_DAY = 1440;

export function amountOf(value) {
  if (typeof value !== "string" || value.length > 39 || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return null;
  }
  const amount = BigInt(value);
  return amount <= MAX_AMOUNT ? amount : null;
}

export function isAccountId(value) {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value);
}

export function block(ruleId, reason) {
  return { decision: "BLOCK", reason, ruleId };
}

// All amounts are decimal strings in yoctoNEAR. spentToday comes from Ward's
// trusted ledger. Free text on a request has no effect on these rules.
export function check(tx, policy, nowMs = Date.now()) {
  const amount = amountOf(tx?.amount);
  if (amount === null || amount === 0n || !isAccountId(tx?.payee)) {
    return block("invalid_payment", "Payment requires a valid payee and a positive amount");
  }

  const ceiling = amountOf(policy?.perTxCeiling);
  const cap = amountOf(policy?.dailyCap);
  const spent = amountOf(policy?.spentToday);
  const threshold = amountOf(policy?.approvalThreshold);
  const payees = policy?.payees;
  const windows = policy?.timeWindows === undefined ? [] : policy.timeWindows;
  if (
    ceiling === null || ceiling === 0n || cap === null || cap === 0n || spent === null ||
    threshold === null || threshold > ceiling ||
    !Array.isArray(payees) || payees.length === 0 || payees.length > 32 ||
    !Array.from(payees).every(isAccountId) ||
    !Array.isArray(windows) || windows.length > 8 ||
    !Array.from(windows).every(validWindow) ||
    !Number.isSafeInteger(nowMs) || nowMs < 0
  ) {
    return block("invalid_policy", "Policy configuration is missing or invalid");
  }

  if (amount > ceiling) {
    return block("per_tx_ceiling", "Payment exceeds per-transaction ceiling");
  }
  if (spent + amount > cap) {
    return block("daily_cap", "Payment exceeds remaining daily cap");
  }
  if (!payees.includes(tx.payee)) {
    return block("payee_allowlist", "Payee is outside the allowlist");
  }
  const minute = Math.floor(nowMs / 60_000) % MINUTES_PER_DAY;
  if (windows.length > 0 && !windows.some(window => includesMinute(window, minute))) {
    return block("time_window", "Payment is outside the UTC spending windows");
  }
  if (amount > threshold) {
    return { decision: "HOLD", reason: "Family approval required", ruleId: "approval_threshold" };
  }
  return { decision: "ALLOW", reason: "Payment passed policy", ruleId: "policy_pass" };
}

function validWindow(window) {
  const { startMinute, endMinute } = window ?? {};
  return Number.isInteger(startMinute) && startMinute >= 0 && startMinute < MINUTES_PER_DAY &&
    Number.isInteger(endMinute) && endMinute >= 0 && endMinute <= MINUTES_PER_DAY &&
    startMinute !== endMinute;
}

function includesMinute({ startMinute, endMinute }, minute) {
  if (startMinute < endMinute) {
    return minute >= startMinute && minute < endMinute;
  }
  return minute >= startMinute || minute < endMinute;
}
