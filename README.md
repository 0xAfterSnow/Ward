# Ward + Mama Wallet

**Built for NEAR HACKATHON. Tracks: `security` (primary), `realworld`, `social`.**

An open policy layer that stops AI agents and scammers from draining a wallet (`/firewall`), and Mama Wallet (`/mama-wallet`), an app built on it to protect an elderly parent's money.

> Status: Day 3. Mama Wallet is a local installable web app backed by Ward's mock ledger. The scam screening and injection demo script are planned.

## The problem

1. AI agents that hold money can be prompt-injected into sending it somewhere they shouldn't.
2. Elderly people are targeted by "send money now" scams, and families sending money home have no way to put limits on what a parent can spend.

Both problems have the same fix: enforce spending rules outside the model, then let the app (or agent) act only within them.

## What is in this repo

| Path | What it is |
| --- | --- |
| `/firewall` | Ward's `check()` API, offline ledger, 1Click quote preview and Rust vault. |
| `/mama-wallet` | Responsive Elder and Family views, install manifest, service worker and local app server. |
| `/demo` | Credential-free funding, pharmacy payment, hold, approval and audit commands. |

## How the firewall works

`check(tx, policy)` from `firewall/policy.js` returns `{ decision, reason, ruleId }`. Use decimal strings in yoctoNEAR for `tx.amount` and the amount fields in `policy`. Ward supplies `policy.spentToday` from trusted state.

Policy rules:
- Daily cap and per-transaction ceiling
- Payee allowlist
- Approval threshold (amounts above it become `HOLD` until a family member approves)
- Up to eight UTC time windows per day. Each `{ startMinute, endMinute }` uses minutes since midnight with an inclusive start and exclusive end. A start later than the end crosses midnight. An empty list allows any time.

Two layers:
1. **Hard limits.** The vault owns the funds. Configure the requester's function-call key with the vault as its receiver, `request_payment` as its only method, and a gas allowance. NEAR checks those permissions. The vault checks the payee and amount and accepts approvals from a separate family account. Approval rechecks the hard rules. The vault logs each policy decision and records the transfer outcome separately. See the [NEAR access key documentation](https://docs.near.org/protocol/accounts-contracts/access-keys).
2. **Screening (second layer, best-effort).** NEAR AI Cloud screening and deterministic fallback are planned.

The mock ledger stores each decision, rule ID and reason in SQLite. The same database transaction checks the current balance and UTC daily spend and records the decision. A retry with the same payment ID and inputs replays the decision without charging the balance again. The audit stores no request memo.

The PWA calls Ward's HTTP API. Ward checks the session role for each action. A family session can issue a one-use elder link, add demo credits, and approve or reject a held payment. Approval rechecks the hard policy and available balance before debiting the wallet. The approval link identifies a request and requires a family session to act on it.

## NEAR tools used

- NEAR Rust SDK `5.29.0` for the vault and its unsigned mock-runtime tests.
- NEAR Sandbox 2.12.0 (protocol 84), [NEAR Workspaces 5.0.0](https://github.com/near/near-workspaces-js/releases/tag/near-workspaces%405.0.0) and [NEAR API JS 5.1.1](https://github.com/near/near-api-js/releases/tag/near-api-js%405.1.1) for the local key and settlement proof. `vault.test.near` is generated within the disposable Sandbox. Ward has no public deployment address.
- NEAR Intents 1Click [dry quotes](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) for Arbitrum USDC to wrapped NEAR. Both asset IDs were verified against the [official token catalog](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens). The adapter was tested with simulated HTTP responses. A live quote and delivery of native NEAR to the vault are UNVERIFIED.

## Baseline and disclosure

- goChameleon (my existing crypto payment gateway) is an external service this project can call for merchant checkout. It is not part of this submission. TODO: link the pre-hackathon tag and the diff of work done in the window.
- Libraries and AI-assisted code: Node.js built-ins including `node:sqlite`, NEAR Rust SDK for the vault, NEAR Workspaces and NEAR API JS for the optional Sandbox test. Codex generated the policy, vault, ledger, funding adapter, Mama Wallet, demo and tests.

## Tests

```sh
npm install
npm test
npm run test:vault
```

Use Node.js 24.22.1. The separate vault test command was run with Rust 1.93.1. The Rust unit tests use the SDK mock runtime with no transaction signing.

### Local Sandbox enforcement proof

The integration test signs transactions with temporary accounts on a disposable local chain. It checks the exact RPC error codes for a direct transfer, family approval call, attached deposit and call to the wrong receiver using the scoped key. It also checks that the vault blocks excess amounts and unknown payees, holds a large payment for family approval, and settles exactly 3 test NEAR.

On Linux x86-64 with Rust 1.93.1 and the `wasm32-unknown-unknown` target installed, build the vault and download the official [Sandbox 2.12.0](https://raw.githubusercontent.com/near/nearcore/2.12.0/CHANGELOG.md) binary. This version supports the Rust build's WASM bulk-memory instructions.

```sh
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='--cfg near -C target-feature=-reference-types,-multivalue' \
  cargo build --locked --manifest-path firewall/vault/Cargo.toml --target wasm32-unknown-unknown --release
npm ci --prefix firewall/vault/sandbox --ignore-scripts
ward_sandbox_bin=$(mktemp -d)
curl -fsSL -o "$ward_sandbox_bin/near-sandbox.tar.gz" \
  https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.12.0/near-sandbox.tar.gz
tar -xzf "$ward_sandbox_bin/near-sandbox.tar.gz" --strip-components=1 -C "$ward_sandbox_bin"
export NEAR_SANDBOX_BINARY_PATH="$ward_sandbox_bin"
export NEAR_SANDBOX_BIN_PATH="$ward_sandbox_bin/near-sandbox"
unshare --user --map-root-user --net sh -c 'set -e
  ip link set lo up
  export TMPDIR="$(mktemp -d)"
  npm --prefix firewall/vault/sandbox test'
```

The test prints `SANDBOX protocol blocked direct transfer, approval, attached deposit and wrong receiver` and ends with `SANDBOX vault enforced payees and caps, held for family approval and settled 3 NEAR`. Between them it prints the contract audit receipts.

## Quick start (no keys, no funds)

Run `npm install` from the repository root with Node.js 24.22.1. The mock commands require no `.env` file, credentials, Rust toolchain or network access.

## Try it: do X, see Y

| # | Do | Expected result |
| --- | --- | --- |
| 1 | `npm run --silent demo:fund` | `MOCK FUNDING \| fixture=10 NEAR \| balance=10 NEAR` |
| 2 | `npm run --silent demo:pay-pharmacy` | `ALLOW \| policy_pass \| Payment passed policy \| balance=9 NEAR` |
| 3 | `npm run --silent demo:hold` | `HOLD \| approval_threshold \| Family approval required` followed by `FAMILY INBOX \| family-review` |
| 4 | `npm run --silent demo:approve` | `ALLOW \| family_approved \| Family approved payment \| balance=7 NEAR` |
| 5 | `npm run --silent demo:audit` | The three audit lines shown below. |

```text
ALLOW | pharmacy-payment | policy_pass | Payment passed policy
HOLD | family-review | approval_threshold | Family approval required
ALLOW | family-review | family_approved | Family approved payment
```

The table assumes a fresh ledger at `.ward/demo.sqlite`. For a separate run, set `WARD_DEMO_DB` to a new file. The demo uses a fixed UTC clock and credits a simulated native NEAR balance. Scam screening and the injection demo script are planned.

## Try the Mama Wallet PWA

Run `npm run dev` and open the **Private family setup link** printed in the terminal. Keep this setup link within your family. The local server uses `http://127.0.0.1:4173` by default. The steps below assume a fresh `.ward/wallet.sqlite`. Set `WARD_WALLET_DB` to a new path for another run.

| # | Do | Expected result |
| --- | --- | --- |
| 1 | Open the family setup link. Select **Add 10 demo credits**. | **Family dashboard** shows a balance of **10 credits**. |
| 2 | Select **Create pairing link** and open the link in a separate browser profile or private window on the same computer. | The **Elder view** opens and lists **Oak Street Pharmacy** and **Market Grocer**. Opening the same pairing link again fails. |
| 3 | In Elder, select **Oak Street Pharmacy**, enter **2**, choose **Review payment**, then **Confirm payment**. | Elder shows **Waiting for family** and still has **10 credits**. Family shows **Approval inbox · 1** within a few seconds. |
| 4 | In Family, select **Open approval link** or copy it to another signed-in family session. Select **Approve**. | Family balance falls to **8 credits** and the inbox clears. The audit log contains **HOLD** and **ALLOW**. Elder shows **Paid · 2 credits**. |
| 5 | In Elder, make a second payment for **3** credits. In Family, select **Reject**. | The balance stays at **8 credits**. The audit log shows **BLOCK** with **Family rejected payment**. Elder shows **Not paid · 3 credits**. |
| 6 | In a compatible browser, use its **Install Mama Wallet** or **Add to Home Screen** command. | Mama Wallet opens in its own app window. Payment actions require the running local server. |

The app uses an in-app inbox and shareable review links. Push and SMS are future work. This demo serves one mock wallet per server. Pairing links expire after 10 minutes and browser sessions expire after eight hours or a server restart. The ledger persists across restarts. The local server binds to loopback, so links work across browser profiles on the same computer.

## Optional 1Click preview

Set `WARD_QUOTE_RECIPIENT` to a separate development NEAR account and `WARD_QUOTE_REFUND_TO` to a development Arbitrum address. `WARD_QUOTE_USDC_ATOMIC` defaults to `1000000` (1 USDC). See `.env.example` for the optional JWT setting. Run `npm run quote:fund` to request a `dry: true` quote. The command prints input and output in atomic units and has no path to credit the mock ledger or sign a transaction. The 1Click API has no testnet.

## Limits and honesty

- Prototype, not a custodial or financial product.
- Screening is planned and will be evaluated on a small scenario set.
- The vault spike accepts one pending payment at a time. A transfer scheduled by the vault counts against that UTC day's cap even if settlement fails.
- The vault's full-access key, if retained, can bypass the contract. The agent and elder receive only the scoped requester key. The family approves from a separate account.
- TODO: anything not working at submission time.

## License

MIT. See [LICENSE](LICENSE).
