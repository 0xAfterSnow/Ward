use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::testing_env;

const VAULT: &str = "vault.test";
const ELDER: &str = "elder.test";
const FAMILY: &str = "family.test";
const PHARMACY: &str = "pharmacy.test";

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn set_context(caller: &str, day: u64) {
    set_context_at(caller, day * DAY_MS);
}

fn set_context_at(caller: &str, timestamp_ms: u64) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(account(VAULT))
        .predecessor_account_id(account(caller))
        .signer_account_id(account(caller))
        .account_balance(NearToken::from_near(10))
        .block_timestamp(timestamp_ms * 1_000_000);
    testing_env!(context.build());
}

fn vault() -> Vault {
    set_context(VAULT, 0);
    Vault::new(
        account(ELDER),
        account(FAMILY),
        vec![account(PHARMACY)],
        U128(100),
        U128(60),
        U128(25),
        vec![],
    )
}

#[test]
fn approval_rechecks_overnight_window_at_the_end_boundary() {
    let mut vault = vault();
    vault.time_windows = vec![TimeWindow {
        start_minute: 1380,
        end_minute: 60,
    }];

    set_context_at(ELDER, 1380 * MINUTE_MS);
    assert_eq!(
        vault.request_payment(account(PHARMACY), U128(60), None).decision,
        "HOLD"
    );
    let request_id = vault.pending_request_id().unwrap();

    set_context_at(FAMILY, DAY_MS + 60 * MINUTE_MS);
    assert_eq!(
        vault.resolve_payment(request_id, true).rule_id,
        "time_window"
    );
    assert!(get_created_receipts().is_empty());
    assert_eq!(vault.pending_request_id(), Some(request_id));

    set_context_at(FAMILY, DAY_MS + 1380 * MINUTE_MS);
    assert_eq!(vault.resolve_payment(request_id, true).decision, "ALLOW");
}

#[test]
fn requests_outside_hard_limits_do_not_schedule_transfers() {
    let mut vault = vault();
    set_context(ELDER, 1);
    assert_eq!(
        vault.request_payment(account(PHARMACY), U128(61), None).rule_id,
        "per_tx_ceiling"
    );
    assert_eq!(
        vault
            .request_payment(account("scammer.test"), U128(1), None)
            .rule_id,
        "payee_allowlist"
    );
    assert!(get_created_receipts().is_empty());
    let logs = get_logs();
    assert_eq!(logs.len(), 2);
    assert!(logs.iter().all(|log| log.contains("\"BLOCK\"")));
}

#[test]
fn allowed_payment_schedules_a_transfer_and_charges_the_daily_cap() {
    let mut vault = vault();
    set_context(ELDER, 1);
    assert_eq!(
        vault.request_payment(account(PHARMACY), U128(25), None).decision,
        "ALLOW"
    );
    let receipts = get_created_receipts();
    let transfer = receipts
        .iter()
        .find(|receipt| receipt.receiver_id == account(PHARMACY))
        .unwrap();
    assert!(matches!(
        transfer.actions.as_slice(),
        [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 25
    ));
    assert_eq!(vault.daily_spent, 25);
}

#[test]
fn family_approval_rechecks_the_current_daily_cap() {
    let mut vault = vault();
    set_context(ELDER, 1);
    assert_eq!(
        vault.request_payment(account(PHARMACY), U128(60), None).decision,
        "HOLD"
    );
    let request_id = vault.pending_request_id().unwrap();
    assert!(get_created_receipts().is_empty());
    for _ in 0..2 {
        assert_eq!(
            vault.request_payment(account(PHARMACY), U128(25), None).decision,
            "ALLOW"
        );
    }
    set_context(FAMILY, 1);
    assert_eq!(vault.resolve_payment(request_id, true).rule_id, "daily_cap");
    assert!(get_created_receipts().is_empty());
    assert_eq!(vault.pending_request_id(), Some(request_id));

    set_context(FAMILY, 2);
    assert_eq!(vault.resolve_payment(request_id, true).decision, "ALLOW");
    assert!(vault.pending_request_id().is_none());
    assert_eq!(vault.daily_spent, 60);
}

#[test]
#[should_panic(expected = "Approver only")]
fn requester_cannot_approve_their_own_payment() {
    let mut vault = vault();
    set_context(ELDER, 1);
    vault.request_payment(account(PHARMACY), U128(60), None);
    vault.resolve_payment(vault.pending_request_id().unwrap(), true);
}

#[test]
#[should_panic(expected = "Pending request ID mismatch")]
fn stale_approval_cannot_release_a_later_hold() {
    let mut vault = vault();
    set_context(ELDER, 1);
    vault.request_payment(account(PHARMACY), U128(60), None);
    let stale_id = vault.pending_request_id().unwrap();
    set_context(FAMILY, 1);
    assert_eq!(
        vault.resolve_payment(stale_id, false).rule_id,
        "family_rejected"
    );

    set_context(ELDER, 1);
    vault.request_payment(account(PHARMACY), U128(55), None);
    set_context(FAMILY, 1);
    vault.resolve_payment(stale_id, true);
}

fn family_vault() -> Vault {
    set_context("test", 1);
    Vault::new_family(account(FAMILY), U128(100), U128(60), U128(25))
}

#[test]
fn open_recipient_vault_can_force_review_and_keeps_hard_limits() {
    let mut vault = family_vault();
    let key = env::signer_account_pk();
    set_context(FAMILY, 1);
    vault.set_requester(Some(account(ELDER)), Some(key));
    set_context(ELDER, 1);
    let recipient = account("tailor.test");
    assert_eq!(vault.request_payment(recipient.clone(), U128(61), Some(true)).rule_id, "per_tx_ceiling");
    assert_eq!(vault.request_payment(recipient.clone(), U128(1), None).decision, "ALLOW");
    assert_eq!(vault.request_payment(recipient, U128(1), Some(true)).rule_id, "requested_review");
    assert!(vault.pending_request_id().is_some());
}

#[test]
fn freeze_blocks_approval_and_disconnection_clears_a_hold() {
    let mut vault = family_vault();
    let key = env::signer_account_pk();
    set_context(FAMILY, 1);
    vault.set_requester(Some(account(ELDER)), Some(key));
    set_context(ELDER, 1);
    vault.request_payment(account(PHARMACY), U128(60), None);
    let pending = vault.pending_request_id().unwrap();
    set_context(FAMILY, 1);
    vault.set_frozen(true);
    assert_eq!(vault.resolve_payment(pending, true).rule_id, "wallet_frozen");
    vault.set_requester(None, None);
    assert_eq!(vault.pending_request_id(), None);
    assert!(get_logs().iter().any(|log| log.contains("device_replaced")));
}

#[test]
#[should_panic(expected = "Scoped requester key only")]
fn connecting_an_account_does_not_authorize_its_full_access_key() {
    let mut vault = family_vault();
    set_context(FAMILY, 1);
    let key = PublicKey::from_parts(near_sdk::CurveType::ED25519, vec![7; 32]).unwrap();
    vault.set_requester(Some(account(ELDER)), Some(key));
    set_context(ELDER, 1);
    vault.request_payment(account(PHARMACY), U128(1), None);
}

#[test]
#[should_panic(expected = "Approver only")]
fn spender_cannot_edit_limits() {
    let mut vault = family_vault();
    set_context(ELDER, 1);
    vault.set_limits(U128(200), U128(100), U128(90));
}

#[test]
#[should_panic(expected = "Approver only")]
fn spender_cannot_withdraw() {
    let vault = family_vault();
    set_context(ELDER, 1);
    vault.withdraw(U128(1));
}

#[test]
fn withdrawal_only_transfers_to_the_approver() {
    let vault = family_vault();
    set_context(FAMILY, 1);
    vault.withdraw(U128(123));
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, account(FAMILY));
    assert!(matches!(&receipts[0].actions[..], [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 123));
}

#[test]
#[should_panic(expected = "Sponsor only")]
fn family_initializer_is_bound_to_the_named_parent() {
    set_context(FAMILY, 1);
    Vault::new_family(account(FAMILY), U128(100), U128(60), U128(25));
}

#[test]
fn family_can_change_limits_and_legacy_payees() {
    let mut vault = vault();
    let new_payee = account("tailor.test");
    set_context(FAMILY, 1);
    vault.add_payee(new_payee.clone());
    vault.remove_payee(account(PHARMACY));
    vault.set_limits(U128(80), U128(40), U128(10));
    set_context(ELDER, 1);
    assert_eq!(vault.request_payment(account(PHARMACY), U128(1), None).rule_id, "payee_allowlist");
    assert_eq!(vault.request_payment(new_payee.clone(), U128(11), None).decision, "HOLD");
    assert_eq!(vault.request_payment(new_payee, U128(41), None).rule_id, "per_tx_ceiling");
}

#[test]
#[should_panic(expected = "Approver only")]
fn spender_cannot_replace_the_requester() {
    let mut vault = family_vault();
    set_context(ELDER, 1);
    vault.set_requester(None, None);
}

#[test]
#[should_panic(expected = "Approver only")]
fn spender_cannot_freeze_the_vault() {
    let mut vault = family_vault();
    set_context(ELDER, 1);
    vault.set_frozen(true);
}

const TOKEN: &str = "stable.test";

fn token_vault() -> Vault {
    set_context("test", 1);
    Vault::new_token_family(account(FAMILY), U128(5_000_000), U128(3_000_000), U128(1_000_000), account(TOKEN))
}

fn assert_ft_transfer(receiver: &str, amount: &str) {
    let receipts = get_created_receipts();
    let transfer = receipts.iter().find(|r| r.receiver_id == account(TOKEN)).unwrap();
    let [MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. }] = &transfer.actions[..]
        else { panic!("Expected one token function call") };
    assert_eq!(method_name, b"ft_transfer");
    assert_eq!(attached_deposit.as_yoctonear(), 1);
    let args: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(args).unwrap();
    assert_eq!(args, json!({ "receiver_id": receiver, "amount": amount }));
}

#[test]
fn token_vault_uses_token_units_and_sends_through_the_token_contract() {
    let mut vault = token_vault();
    assert_eq!(vault.wallet_state()["token"], TOKEN);
    assert!(vault.wallet_state()["balance"].is_null());
    let key = env::signer_account_pk();
    set_context(FAMILY, 1);
    vault.set_requester(Some(account(ELDER)), Some(key));
    set_context(ELDER, 1);
    assert_eq!(vault.request_payment(account(PHARMACY), U128(3_000_001), None).rule_id, "per_tx_ceiling");
    assert_eq!(vault.request_payment(account(PHARMACY), U128(1_000_000), None).decision, "ALLOW");
    assert_ft_transfer(PHARMACY, "1000000");
    assert_eq!(vault.daily_spent, 1_000_000);
    assert_eq!(vault.request_payment(account(PHARMACY), U128(2_000_000), None).decision, "HOLD");
    let id = vault.pending_request_id().unwrap();
    set_context(FAMILY, 1);
    assert_eq!(vault.resolve_payment(id, true).decision, "ALLOW");
    assert_ft_transfer(PHARMACY, "2000000");
    assert_eq!(vault.daily_spent, 3_000_000);

    set_context(VAULT, 1);
    vault.record_token_settlement(id, U128(2_000_000), U64(1), Err(PromiseError::Failed));
    assert_eq!(vault.daily_spent, 1_000_000);
    assert!(get_logs().iter().any(|line| line.contains("FAILED")));
}

#[test]
fn token_withdrawal_can_only_send_the_configured_token_to_family() {
    let vault = token_vault();
    set_context(FAMILY, 1);
    vault.withdraw(U128(250_000));
    assert_ft_transfer(FAMILY, "250000");
}

#[test]
fn token_deposits_accept_only_the_configured_contract() {
    let vault = token_vault();
    set_context(TOKEN, 1);
    assert_eq!(vault.ft_on_transfer(account(FAMILY), U128(250_000), String::new()), U128(0));
}

#[test]
#[should_panic(expected = "Configured token only")]
fn other_token_contracts_cannot_use_the_receiver_hook() {
    let vault = token_vault();
    set_context(ELDER, 1);
    vault.ft_on_transfer(account(FAMILY), U128(250_000), String::new());
}
