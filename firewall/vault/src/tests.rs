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
        vault.request_payment(account(PHARMACY), U128(60)).decision,
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
        vault.request_payment(account(PHARMACY), U128(61)).rule_id,
        "per_tx_ceiling"
    );
    assert_eq!(
        vault
            .request_payment(account("scammer.test"), U128(1))
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
        vault.request_payment(account(PHARMACY), U128(25)).decision,
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
        vault.request_payment(account(PHARMACY), U128(60)).decision,
        "HOLD"
    );
    let request_id = vault.pending_request_id().unwrap();
    assert!(get_created_receipts().is_empty());
    for _ in 0..2 {
        assert_eq!(
            vault.request_payment(account(PHARMACY), U128(25)).decision,
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
    vault.request_payment(account(PHARMACY), U128(60));
    vault.resolve_payment(vault.pending_request_id().unwrap(), true);
}

#[test]
#[should_panic(expected = "Pending request ID mismatch")]
fn stale_approval_cannot_release_a_later_hold() {
    let mut vault = vault();
    set_context(ELDER, 1);
    vault.request_payment(account(PHARMACY), U128(60));
    let stale_id = vault.pending_request_id().unwrap();
    set_context(FAMILY, 1);
    assert_eq!(
        vault.resolve_payment(stale_id, false).rule_id,
        "family_rejected"
    );

    set_context(ELDER, 1);
    vault.request_payment(account(PHARMACY), U128(55));
    set_context(FAMILY, 1);
    vault.resolve_payment(stale_id, true);
}
