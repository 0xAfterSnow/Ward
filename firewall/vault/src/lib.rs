use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, PromiseError, PublicKey, env, near};

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
    requester: Option<AccountId>,
    requester_key: Option<PublicKey>,
    open_payees: bool,
    token: Option<AccountId>,
    frozen: bool,
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
            requester: Some(requester),
            requester_key: None,
            open_payees: false,
            token: None,
            frozen: false,
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

    #[init]
    pub fn new_family(
        approver: AccountId,
        daily_cap: U128,
        per_tx_ceiling: U128,
        approval_threshold: U128,
    ) -> Self {
        Self::family(approver, daily_cap, per_tx_ceiling, approval_threshold, None)
    }

    #[init]
    pub fn new_token_family(
        approver: AccountId,
        daily_cap: U128,
        per_tx_ceiling: U128,
        approval_threshold: U128,
        token: AccountId,
    ) -> Self {
        assert_ne!(token, env::current_account_id(), "Use a separate token contract");
        Self::family(approver, daily_cap, per_tx_ceiling, approval_threshold, Some(token))
    }

    pub fn ft_on_transfer(&self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        assert_eq!(self.token.as_ref(), Some(&env::predecessor_account_id()), "Configured token only");
        let _ = (sender_id, amount, msg);
        U128(0)
    }

    pub fn set_requester(&mut self, requester: Option<AccountId>, requester_key: Option<PublicKey>) {
        self.assert_approver();
        assert!(requester.as_ref().is_none_or(|id| id != &self.approver && id != &env::current_account_id()));
        assert!(!self.open_payees || requester.is_some() == requester_key.is_some(), "Set the scoped key with the device");
        if requester != self.requester || requester_key != self.requester_key {
            if let Some(payment) = self.pending.take() {
                Decision::block("device_replaced", "The requesting device was disconnected")
                    .record(Some(payment.id), &payment.payee, payment.amount);
            }
            self.requester = requester;
            self.requester_key = requester_key;
        }
    }

    pub fn set_limits(&mut self, daily_cap: U128, per_tx_ceiling: U128, approval_threshold: U128) {
        self.assert_approver();
        Self::validate_limits(daily_cap, per_tx_ceiling, approval_threshold);
        self.daily_cap = daily_cap.0;
        self.per_tx_ceiling = per_tx_ceiling.0;
        self.approval_threshold = approval_threshold.0;
    }

    pub fn set_frozen(&mut self, frozen: bool) {
        self.assert_approver();
        self.frozen = frozen;
    }

    pub fn add_payee(&mut self, payee: AccountId) {
        self.assert_approver();
        assert!(!self.open_payees, "Open-recipient wallets use off-chain shortcuts");
        assert_ne!(payee, env::current_account_id());
        if !self.payees.contains(&payee) {
            assert!(self.payees.len() < MAX_PAYEES, "Payee list is full");
            self.payees.push(payee);
        }
    }

    pub fn remove_payee(&mut self, payee: AccountId) {
        self.assert_approver();
        assert!(!self.open_payees, "Open-recipient wallets use off-chain shortcuts");
        self.payees.retain(|id| id != &payee);
    }

    pub fn withdraw(&self, amount: U128) {
        self.assert_approver();
        assert!(amount.0 > 0 && self.can_schedule(amount.0), "Invalid withdrawal amount or insufficient NEAR for gas");
        let transfer = self.transfer(&self.approver, amount.0);
        env::promise_return(transfer);
    }

    pub fn wallet_state(&self) -> near_sdk::serde_json::Value {
        let day = env::block_timestamp_ms() / DAY_MS;
        json!({
            "requester": self.requester,
            "approver": self.approver,
            "openPayees": self.open_payees,
            "frozen": self.frozen,
            "dailyCap": U128(self.daily_cap),
            "perTxCeiling": U128(self.per_tx_ceiling),
            "approvalThreshold": U128(self.approval_threshold),
            "leftToday": U128(self.daily_cap.saturating_sub(self.spent_on(day))),
            "token": self.token,
            "balance": self.token.is_none().then(|| U128(Self::spendable())),
            "pending": self.pending.as_ref().map(|p| json!({
                "id": U64(p.id), "payee": p.payee, "amount": U128(p.amount)
            })),
        })
    }

    pub fn request_payment(&mut self, payee: AccountId, amount: U128, force_review: Option<bool>) -> Decision {
        assert_eq!(Some(env::predecessor_account_id()), self.requester, "Requester only");
        if let Some(key) = &self.requester_key {
            assert_eq!(&env::signer_account_pk(), key, "Scoped requester key only");
        }
        let amount = amount.0;
        let now = env::block_timestamp_ms();
        if let Some(block) = self.hard_block(&payee, amount, now) {
            return block.record(None, &payee, amount);
        }

        let forced = force_review.unwrap_or(false);
        let needs_review = forced || amount > self.approval_threshold;
        if needs_review && self.pending.is_some() {
            return Decision::block("pending_full", "Resolve the existing hold first")
                .record(None, &payee, amount);
        }

        let id = self.next_id;
        self.next_id += 1;
        if needs_review {
            let result = Decision {
                decision: "HOLD",
                rule_id: if forced { "requested_review" } else { "approval_threshold" },
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
        self.assert_approver();
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
        Self::log_settlement(request_id, result.is_ok());
    }

    #[private]
    pub fn record_token_settlement(
        &mut self,
        request_id: U64,
        amount: U128,
        day: U64,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if result.is_err() && self.spend_day == day.0 {
            self.daily_spent = self.daily_spent.saturating_sub(amount.0);
        }
        Self::log_settlement(request_id, result.is_ok());
    }

}

impl Vault {
    fn log_settlement(request_id: U64, settled: bool) {
        env::log_str(&json!({
            "event": "payment_settlement",
            "requestId": request_id,
            "status": if settled { "SETTLED" } else { "FAILED" }
        }).to_string());
    }

    fn family(
        approver: AccountId,
        daily_cap: U128,
        per_tx_ceiling: U128,
        approval_threshold: U128,
        token: Option<AccountId>,
    ) -> Self {
        let vault = env::current_account_id();
        let (_, sponsor) = vault.as_str().split_once('.').expect("Named vault required");
        assert_eq!(env::predecessor_account_id().as_str(), sponsor, "Sponsor only");
        assert_ne!(approver, vault, "Use a separate approver account");
        Self::validate_limits(daily_cap, per_tx_ceiling, approval_threshold);
        Self {
            requester: None,
            requester_key: None,
            open_payees: true,
            token,
            frozen: false,
            approver,
            payees: vec![],
            daily_cap: daily_cap.0,
            per_tx_ceiling: per_tx_ceiling.0,
            approval_threshold: approval_threshold.0,
            time_windows: vec![],
            spend_day: 0,
            daily_spent: 0,
            next_id: 1,
            pending: None,
        }
    }

    fn can_schedule(&self, amount: u128) -> bool {
        Self::spendable() >= if self.token.is_some() { 1 } else { amount }
    }

    fn transfer(&self, payee: &AccountId, amount: u128) -> near_sdk::PromiseIndex {
        if let Some(token) = &self.token {
            // The token contract atomically checks and debits its actual balance.
            let transfer = env::promise_batch_create(token);
            let args = json!({ "receiver_id": payee, "amount": U128(amount) }).to_string();
            env::promise_batch_action_function_call(
                transfer, "ft_transfer", args.as_bytes(),
                NearToken::from_yoctonear(1), Gas::from_tgas(25),
            );
            transfer
        } else {
            let transfer = env::promise_batch_create(payee);
            env::promise_batch_action_transfer(transfer, NearToken::from_yoctonear(amount));
            transfer
        }
    }

    fn assert_approver(&self) {
        assert_eq!(env::predecessor_account_id(), self.approver, "Approver only");
    }

    fn validate_limits(daily: U128, ceiling: U128, threshold: U128) {
        assert!(daily.0 > 0 && ceiling.0 > 0 && ceiling.0 <= daily.0 && threshold.0 <= ceiling.0, "Invalid spending limits");
    }

    fn spendable() -> u128 {
        let reserve = u128::from(env::storage_usage() + PENDING_STORAGE_BYTES)
            * env::storage_byte_cost().as_yoctonear();
        env::account_balance().as_yoctonear().saturating_sub(reserve)
    }

    fn spent_on(&self, day: u64) -> u128 {
        if self.spend_day == day {
            self.daily_spent
        } else {
            0
        }
    }

    fn hard_block(&self, payee: &AccountId, amount: u128, now: u64) -> Option<Decision> {
        if self.frozen {
            return Some(Decision::block("wallet_frozen", "Your family paused payments"));
        }
        if amount == 0 || payee == &env::current_account_id() {
            return Some(Decision::block(
                "invalid_payment",
                "Use a positive amount and a separate recipient",
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
        if !self.open_payees && !self.payees.contains(payee) {
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

        if !self.can_schedule(amount) {
            if self.token.is_some() {
                return Some(Decision::block("vault_gas", "Vault needs test NEAR for token transfers"));
            }
            return Some(Decision::block(
                "vault_balance",
                "Vault has insufficient spendable balance",
            ));
        }
        None
    }

    fn schedule_payment(&mut self, id: u64, payee: AccountId, amount: u128, day: u64) -> Decision {
        // Reserve against the daily cap before sending. The token callback releases failed transfers.
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
        let transfer = self.transfer(&payee, amount);
        let callback = env::promise_batch_then(transfer, &env::current_account_id());
        let (method, args) = if self.token.is_some() {
            ("record_token_settlement", json!({ "request_id": U64(id), "amount": U128(amount), "day": U64(day) }))
        } else {
            ("record_settlement", json!({ "request_id": U64(id) }))
        };
        env::promise_batch_action_function_call(
            callback,
            method,
            args.to_string().as_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(10),
        );
        result
    }
}

#[cfg(test)]
mod tests;
