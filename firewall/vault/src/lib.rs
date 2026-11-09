use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, PromiseError, env, near};

const DAY_MS: u64 = 86_400_000;
const MINUTE_MS: u64 = 60_000;
const MINUTES_PER_DAY: u16 = 1440;
const MAX_PAYEES: usize = 32;
// The only variable-size state after initialization is one pending payment.
const PENDING_STORAGE_BYTES: u64 = 256;

#[near(serializers = [borsh])]
struct PendingPayment {
    id: u64,
    payee: AccountId,
    amount: u128,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "camelCase")]
pub struct TimeWindow {
    start_minute: u16,
    end_minute: u16,
}

impl TimeWindow {
    fn valid(&self) -> bool {
        self.start_minute < MINUTES_PER_DAY
            && self.end_minute <= MINUTES_PER_DAY
            && self.start_minute != self.end_minute
    }

    fn contains(&self, minute: u16) -> bool {
        if self.start_minute < self.end_minute {
            (self.start_minute..self.end_minute).contains(&minute)
        } else {
            minute >= self.start_minute || minute < self.end_minute
        }
    }
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Decision {
    pub decision: &'static str,
    pub reason: &'static str,
    #[serde(rename = "ruleId")]
    pub rule_id: &'static str,
}

impl Decision {
    fn block(rule_id: &'static str, reason: &'static str) -> Self {
        Self {
            decision: "BLOCK",
            reason,
            rule_id,
        }
    }

    fn record(self, id: Option<u64>, payee: &AccountId, amount: u128) -> Self {
        env::log_str(
            &json!({
                "event": "payment_decision",
                "requestId": id.map(U64),
                "payee": payee,
                "amount": U128(amount),
                "result": self
            })
            .to_string(),
        );
        self
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
// The protocol-level access key checks are covered separately by sandbox/verify.js.
pub struct Vault {
    requester: AccountId,
    approver: AccountId,
    payees: Vec<AccountId>,
    daily_cap: u128,
    per_tx_ceiling: u128,
    approval_threshold: u128,
    time_windows: Vec<TimeWindow>,
    spend_day: u64,
    daily_spent: u128,
    next_id: u64,
    pending: Option<PendingPayment>,
}

#[near]
impl Vault {
    #[init]
    #[private]
    pub fn new(
        requester: AccountId,
        approver: AccountId,
        payees: Vec<AccountId>,
        daily_cap: U128,
        per_tx_ceiling: U128,
        approval_threshold: U128,
        time_windows: Vec<TimeWindow>,
    ) -> Self {
        let vault = env::current_account_id();
        assert!(requester != approver && requester != vault && approver != vault);
        assert!(!payees.is_empty() && payees.len() <= MAX_PAYEES && !payees.contains(&vault));
        assert!(time_windows.len() <= 8 && time_windows.iter().all(TimeWindow::valid));
        assert!(
            daily_cap.0 > 0 && per_tx_ceiling.0 > 0 && approval_threshold.0 <= per_tx_ceiling.0
        );
        Self {
            requester,
            approver,
            payees,
            daily_cap: daily_cap.0,
            per_tx_ceiling: per_tx_ceiling.0,
            approval_threshold: approval_threshold.0,
            time_windows,
            spend_day: 0,
            daily_spent: 0,
            next_id: 1,
            pending: None,
        }
    }

    pub fn request_payment(&mut self, payee: AccountId, amount: U128) -> Decision {
        assert_eq!(
            env::predecessor_account_id(),
            self.requester,
            "Requester only"
        );
        let amount = amount.0;
        let now = env::block_timestamp_ms();
        if let Some(block) = self.hard_block(&payee, amount, now) {
            return block.record(None, &payee, amount);
        }

        if amount > self.approval_threshold && self.pending.is_some() {
            return Decision::block("pending_full", "Resolve the existing hold first")
                .record(None, &payee, amount);
        }

        let id = self.next_id;
        self.next_id += 1;
        if amount > self.approval_threshold {
            let result = Decision {
                decision: "HOLD",
                rule_id: "approval_threshold",
                reason: "Family approval required",
            }
            .record(Some(id), &payee, amount);
            self.pending = Some(PendingPayment { id, payee, amount });
            return result;
        }

        self.schedule_payment(id, payee, amount, now / DAY_MS)
    }

    pub fn pending_request_id(&self) -> Option<U64> {
        self.pending.as_ref().map(|payment| U64(payment.id))
    }

    pub fn resolve_payment(&mut self, request_id: U64, approve: bool) -> Decision {
        assert_eq!(
            env::predecessor_account_id(),
            self.approver,
            "Approver only"
        );
        let pending = self.pending.as_ref().expect("No pending request");
        assert_eq!(pending.id, request_id.0, "Pending request ID mismatch");

        if !approve {
            let pending = self.pending.take().unwrap();
            return Decision::block("family_rejected", "Family rejected payment").record(
                Some(pending.id),
                &pending.payee,
                pending.amount,
            );
        }

        let now = env::block_timestamp_ms();
        if let Some(block) = self.hard_block(&pending.payee, pending.amount, now) {
            return block.record(Some(pending.id), &pending.payee, pending.amount);
        }

        let pending = self.pending.take().unwrap();
        self.schedule_payment(pending.id, pending.payee, pending.amount, now / DAY_MS)
    }

    #[private]
    pub fn record_settlement(
        &self,
        request_id: U64,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        env::log_str(
            &json!({
                "event": "payment_settlement",
                "requestId": request_id,
                "status": if result.is_ok() { "SETTLED" } else { "FAILED" }
            })
            .to_string(),
        );
    }
}

impl Vault {
    fn spent_on(&self, day: u64) -> u128 {
        if self.spend_day == day {
            self.daily_spent
        } else {
            0
        }
    }

    fn hard_block(&self, payee: &AccountId, amount: u128, now: u64) -> Option<Decision> {
        if amount == 0 {
            return Some(Decision::block(
                "invalid_payment",
                "Payment amount must be positive",
            ));
        }
        if amount > self.per_tx_ceiling {
            return Some(Decision::block(
                "per_tx_ceiling",
                "Payment exceeds per-transaction ceiling",
            ));
        }
        if amount > self.daily_cap.saturating_sub(self.spent_on(now / DAY_MS)) {
            return Some(Decision::block(
                "daily_cap",
                "Payment exceeds remaining daily cap",
            ));
        }
        if !self.payees.contains(payee) {
            return Some(Decision::block(
                "payee_allowlist",
                "Payee is outside the allowlist",
            ));
        }
        let minute = ((now % DAY_MS) / MINUTE_MS) as u16;
        if !self.time_windows.is_empty()
            && !self
                .time_windows
                .iter()
                .any(|window| window.contains(minute))
        {
            return Some(Decision::block(
                "time_window",
                "Payment is outside the UTC spending windows",
            ));
        }

        let reserve = u128::from(env::storage_usage() + PENDING_STORAGE_BYTES)
            * env::storage_byte_cost().as_yoctonear();
        if amount
            > env::account_balance()
                .as_yoctonear()
                .saturating_sub(reserve)
        {
            return Some(Decision::block(
                "vault_balance",
                "Vault has insufficient spendable balance",
            ));
        }
        None
    }

    fn schedule_payment(&mut self, id: u64, payee: AccountId, amount: u128, day: u64) -> Decision {
        // Charge the cap at scheduling time. A failed receipt still counts for this UTC day.
        self.daily_spent = self.spent_on(day) + amount;
        self.spend_day = day;
        let result = Decision {
            decision: "ALLOW",
            rule_id: "policy_pass",
            reason: "Payment passed policy",
        }
        .record(Some(id), &payee, amount);
        // Use only the host actions this vault needs. The generic Promise
        // builder also links gas-key actions unavailable on protocol 84.
        let transfer = env::promise_batch_create(&payee);
        env::promise_batch_action_transfer(transfer, NearToken::from_yoctonear(amount));
        let callback = env::promise_batch_then(transfer, &env::current_account_id());
        let args = json!({ "request_id": U64(id) }).to_string();
        env::promise_batch_action_function_call(
            callback,
            "record_settlement",
            args.as_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(10),
        );
        result
    }
}

#[cfg(test)]
mod tests;
