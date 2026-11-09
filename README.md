# Ward + Mama Wallet

**Built for NEAR HACKATHON. Tracks: `security` (primary), `realworld`, `social`.**

An open policy layer that stops AI agents and scammers from draining a wallet (`/firewall`), and Mama Wallet (`/mama-wallet`), an app built on it to protect an elderly parent's money.

> Status: Day 2. Ward's policy rules, offline audit and funding preview are implemented. Mama Wallet and the remaining demo scenarios are planned.

## The problem

1. AI agents that hold money can be prompt-injected into sending it somewhere they shouldn't.
2. Elderly people are targeted by "send money now" scams, and families sending money home have no way to put limits on what a parent can spend.

Both problems have the same fix: enforce spending rules outside the model, then let the app (or agent) act only within them.

## What is in this repo

| Path | What it is |
| --- | --- |
| `/firewall` | Ward's `check()` API, offline ledger, 1Click quote preview and Rust vault. |
| `/mama-wallet` | Planned elder-facing wallet and family approval flow. All policy checks belong to Ward. |
| `/demo` | Credential-free funding, pharmacy payment and audit commands. |

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

## NEAR tools used

- NEAR Rust SDK `5.29.0` for the vault and its unsigned mock-runtime tests.
- NEAR Sandbox 2.12.0 (protocol 84), [NEAR Workspaces 5.0.0](https://github.com/near/near-workspaces-js/releases/tag/near-workspaces%405.0.0) and [NEAR API JS 5.1.1](https://github.com/near/near-api-js/releases/tag/near-api-js%405.1.1) for the local key and settlement proof. `vault.test.near` is generated within the disposable Sandbox. Ward has no public deployment address.
- NEAR Intents 1Click [dry quotes](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) for Arbitrum USDC to wrapped NEAR. Both asset IDs were verified against the [official token catalog](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens). The adapter was tested with simulated HTTP responses. A live quote and delivery of native NEAR to the vault are UNVERIFIED.

## Baseline and disclosure

- goChameleon (my existing crypto payment gateway) is an external service this project can call for merchant checkout. It is not part of this submission. TODO: link the pre-hackathon tag and the diff of work done in the window.
- Libraries and AI-assisted code: Node.js built-ins including `node:sqlite`, NEAR Rust SDK for the vault, NEAR Workspaces and NEAR API JS for the optional Sandbox test. Codex generated the policy, vault, ledger, funding adapter, demo and tests.

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
| 3 | `npm run --silent demo:audit` | `ALLOW \| pharmacy-payment \| policy_pass \| Payment passed policy` |

The table assumes a fresh ledger at `.ward/demo.sqlite`. For a separate run, set `WARD_DEMO_DB` to a new file. The demo uses a fixed UTC clock and credits a simulated native NEAR balance. The scam, family approval and injection scripts are planned.

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
