# Architecture, storage and replay

[Back to README](../README.md) · Run commands from the repository root.

## What is in this repo

| Path | What it is |
| --- | --- |
| `/firewall` | Ward's `check()` API, offline ledger, 1Click quote preview and Rust vault. |
| `/mama-wallet` | Responsive Elder and Family views, install manifest, service worker and local app server. |
| `/demo` | Credential-free funding, pharmacy payment, scam, approval, injection and audit commands. |

## How the firewall works

`check(tx, policy)` from `firewall/policy.js` returns `{ decision, reason, ruleId, checks }`. The `checks` array lists each evaluated rule in order as `{ ruleId, passed, label }`. Use decimal strings in yoctoNEAR for the vault and CLI demos in `tx.amount` and the amount fields in `policy`. Ward supplies `policy.spentToday` from trusted state.

Policy rules:
- Daily cap and per-transaction ceiling
- Payee allowlist in the standalone CLI demos and vault. The multi-family mock wallet allows any valid recipient within the spending rules.
- Approval threshold (amounts above it become `HOLD` until a family member approves)
- Up to eight UTC time windows per day. Each `{ startMinute, endMinute }` uses minutes since midnight with an inclusive start and exclusive end. A start later than the end crosses midnight. An empty list allows any time.

Two layers:
1. **Hard limits.** The vault owns the funds. Configure the requester's function-call key with the vault as its receiver, `request_payment` as its only method, and a gas allowance. NEAR checks those permissions. The vault checks the payee and amount and accepts approvals from a separate family account. Approval rechecks the hard rules. The vault logs each policy decision and records the transfer outcome separately. See the [NEAR access key documentation](https://docs.near.org/protocol/accounts-contracts/access-keys).
2. **Screening (second layer, best-effort).** Ward scores optional payment notes after hard policy and balance checks. A score of 60 or higher can turn an otherwise allowed payment into a `HOLD`. Deterministic scoring checks for urgency, secrecy, threats and policy overrides. The optional cloud scorer can add a hold. Ward uses the deterministic result when the provider times out, fails or returns an invalid score. The vault enforces its hard rules independently of screening.

The mock ledger stores each decision, rule ID and reason in SQLite. The same database transaction checks the current balance and UTC daily spend and records the decision, including after waiting for a cloud score. A retry with the same payment ID, payee and amount replays the original decision without a second debit. The payment audit stores signal categories, never payment memo text. Categories are urgency, secrecy, bank or account threat, and policy override. Future payment answers and messages are stored separately in the local wallet SQLite database and exposed only to that family’s pending-review view. They are not included in chain arguments, Elder responses or the payment audit. This is local application storage, not end-to-end encryption; the server operator can access the database. Messages discarded before this feature cannot be recovered.

The local demo uses the multi-family mock backend. The browser testnet app reads spending balances from Circle’s USDC token contract and limits from the family vault. Onboarding gives each family its own demo address, ledger, and starting rules. Sessions, payment and request IDs, and funding quotes are scoped to that family. The demo address is an app identifier. Family members can edit rules, freeze or unfreeze payments, and replace or unpair Mama’s device. UTC midnight resets the daily cap. The PWA defaults to no spending windows. The CLI demos keep their fixed clock and original policy.

Mama can pay any valid recipient, ask for help, or ask the family to save a place. Approving a new place adds a shortcut. Every payment follows the same balance and spending checks. Answering **Yes** or **Not sure** to the pressure question triggers an app-layer hold for a payment that passes the hard rules. The 24-hour summary counts payment decisions, including family resolutions and blocked approval attempts. The standalone testnet vault uses its contract allowlist and rules.

## Try it: do X, see Y

```sh
export WARD_DEMO_DB="$(mktemp -d)/ward.sqlite"
npm run --silent demo:fund
npm run --silent demo:pay-pharmacy
npm run --silent demo:scam
npm run --silent demo:approve -- scam-payment
npm run --silent demo:injection
npm run --silent demo:audit
```

| # | Do | Expected result |
| --- | --- | --- |
| 1 | `npm run --silent demo:fund` | `MOCK FUNDING \| fixture=10 NEAR \| balance=10 NEAR` |
| 2 | `npm run --silent demo:pay-pharmacy` | `ALLOW \| policy_pass \| Payment passed policy \| balance=9 NEAR` |
| 3 | `npm run --silent demo:scam` | `HOLD \| screening_risk \| Payment note needs family review` followed by `FAMILY INBOX \| scam-payment`. The demo uses an allowlisted payee and an amount at the ordinary approval threshold. |
| 4 | `npm run --silent demo:approve -- scam-payment` | `ALLOW \| family_approved \| Family approved payment \| balance=8 NEAR` |
| 5 | `npm run --silent demo:injection` | `BLOCK \| per_tx_ceiling \| Payment exceeds per-transaction ceiling \| balance=8 NEAR`. Removing the injected note produces the same policy result. |
| 6 | `npm run --silent demo:audit` | The four audit lines shown below. |
| 7 | `npm run --silent demo:bank-scam` | The scripted pressure, new-payee rejection and audit shown below. Uses a separate in-memory ledger. |

```text
ALLOW | pharmacy-payment | policy_pass | Payment passed policy
HOLD | scam-payment | screening_risk | Payment note needs family review
ALLOW | scam-payment | family_approved | Family approved payment
BLOCK | injection-attempt | per_tx_ceiling | Payment exceeds per-transaction ceiling
```

The commands use a fresh ledger and a fixed UTC clock. The default ledger path is `.ward/demo.sqlite` if `WARD_DEMO_DB` is unset. To exercise a threshold hold separately, use a fresh ledger, fund it, then run `npm run --silent demo:hold`. It prints `HOLD | approval_threshold | Family approval required` and `FAMILY INBOX | family-review`. Run `npm run --silent demo:approve` to see `ALLOW | family_approved | Family approved payment | balance=8 NEAR`.

Run `npm run --silent demo:bank-scam` on its own to see:

```text
SCRIPTED BANK SCAM | Pay now or your account will be frozen. Do not call your family.
HOLD | someone_asked | Mama says someone asked her to send this
FAMILY INBOX | new payee | Bank safe account | safe-account.test
NEW PAYEE | rejected
AUDIT
HOLD | someone_asked | Mama says someone asked her to send this
ACTIVITY | payee_requested | Mama asked to add a new place
ACTIVITY | payee_rejected | Family rejected a new place
```
