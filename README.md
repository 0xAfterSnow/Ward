# Ward + Mama Wallet

A caller pretends to be Mama’s bank and tells her to move her money to a “safe account.” Her family can send money home and set rules about how much she can spend and when to ask them first. Mama can pay a new recipient or pick a familiar place from her shortcuts.

**Send money home without handing it to scammers.**

Ward checks payments against those rules. Mama Wallet is the family-facing demo. Its bank scam is a scripted scenario.

Built for NEAR HACKATHON in the Security, Real-World Money, and Social Money tracks.

## Quick start

**Minimum Node.js 22.23.4.** Verified on Node.js 22.23.4 and 24.22.1. Run `npm install` from the repository root. The mock demos require no credentials, Rust toolchain or network access.

## What to look at

1. Run `npm run --silent demo:bank-scam` to see the scripted pressure payment held and the new-payee request rejected.
2. Create a demo family wallet, invite Mama in a second browser profile, send demo dollars, and review a payment in the family inbox.
3. Open the finalized [NEAR testnet receipts](#verify-on-near-testnet) to see the vault settle 3 test NEAR and block an unapproved recipient.

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

The mock ledger stores each decision, rule ID and reason in SQLite. The same database transaction checks the current balance and UTC daily spend and records the decision, including after waiting for a cloud score. A retry with the same payment ID, payee and amount replays the original decision without a second debit. The payment audit stores signal categories, never payment memo text. Categories are urgency, secrecy, bank or account threat, and policy override.

The local demo uses the multi-family mock backend. The browser testnet app reads spending balances from Circle’s USDC token contract and limits from the family vault. Onboarding gives each family its own demo address, ledger, and starting rules. Sessions, payment and request IDs, and funding quotes are scoped to that family. The demo address is an app identifier. Family members can edit rules, freeze or unfreeze payments, and replace or unpair Mama’s device. UTC midnight resets the daily cap. The PWA defaults to no spending windows. The CLI demos keep their fixed clock and original policy.

Mama can pay any valid recipient, ask for help, or ask the family to save a place. Approving a new place adds a shortcut. Every payment follows the same balance and spending checks. Answering **Yes** or **Not sure** to the pressure question triggers an app-layer hold for a payment that passes the hard rules. The 24-hour summary counts payment decisions, including family resolutions and blocked approval attempts. The standalone testnet vault uses its contract allowlist and rules.

## NEAR tools used

- NEAR Rust SDK `5.29.0` for the vault and its unsigned mock-runtime tests.
- NEAR Sandbox 2.12.0 (protocol 84), [NEAR Workspaces 5.0.0](https://github.com/near/near-workspaces-js/releases/tag/near-workspaces%405.0.0) and [NEAR API JS 5.1.1](https://github.com/near/near-api-js/releases/tag/near-api-js%405.1.1) for the local key and settlement proof. `vault.test.near` is generated within the disposable Sandbox. The public testnet proof uses `vault.aftersnow.testnet` and the same NEAR API JS version.
- NEAR Intents 1Click [dry quotes](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) for Arbitrum USDC to wrapped NEAR. The PWA also offers USDC on Base and Ethereum. These assets were checked against the [official token catalog](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens). The adapter was tested with simulated HTTP responses. Live 1Click quotes and delivery from 1Click to the vault are UNVERIFIED.
- Optional NEAR AI Cloud Chat Completions adapter for `zai-org/GLM-5.1-FP8`, called over HTTP with Node's built-in `fetch`. The model ID and endpoint come from the official docs. Tests use simulated responses. Live inference and TEE attestation are UNVERIFIED. [NEAR AI Cloud quickstart](https://docs.near.ai/cloud/quickstart) · [Chat Completions API](https://docs.near.ai/api-reference/chat/create-chat-completion)

## Baseline and disclosure

- goChameleon is the team's pre-existing payment gateway. Ward is developed in a separate repository and the demo has no goChameleon dependency.
- Libraries and AI-assisted code: Node.js built-ins including `node:sqlite`, NEAR Rust SDK for the vault, NEAR Workspaces and NEAR API JS for the optional Sandbox test. Codex generated the policy, vault, ledger, funding and screening adapters, Mama Wallet, demo and tests.

## Tests

```sh
npm install
npm test
npm run test:vault
```

The vault unit tests passed on Rust 1.93.1. They use the SDK mock runtime. The signed Sandbox proof below passed with the same Rust version.

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

The test prints `SANDBOX protocol blocked direct transfer, approval, attached deposit and wrong receiver`, `SANDBOX vault enforced payees and caps, held for family approval and settled 3 NEAR`, and `SANDBOX family vault has no access keys and enforced scoped spending, freeze and disconnection`.

For the token scenario, build the upstream FT source with NEAR SDK 5.17.2. The current upstream build imports host functions unavailable in Sandbox 2.12.0. [NEAR FT example](https://github.com/near-examples/FT/tree/15360ac443fe91e9d55a3b3db616fe6eb6514942)

```sh
ward_ft=$(mktemp -d)
git clone https://github.com/near-examples/FT.git "$ward_ft/upstream"
git -C "$ward_ft/upstream" checkout --detach 15360ac443fe91e9d55a3b3db616fe6eb6514942
cp -r "$ward_ft/upstream/src" "$ward_ft/src"
cp firewall/vault/Cargo.lock "$ward_ft/Cargo.lock"
cat > "$ward_ft/Cargo.toml" <<'EOF'
[package]
name = "fungible-token"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
near-sdk = { version = "=5.17.2", features = ["legacy"] }
near-contract-standards = "=5.17.2"

[profile.release]
codegen-units = 1
lto = true
opt-level = "z"
panic = "abort"
EOF
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='--cfg near -C target-feature=-reference-types,-multivalue' \
  cargo build --manifest-path "$ward_ft/Cargo.toml" --target wasm32-unknown-unknown --release
export WARD_SANDBOX_FT_WASM="$ward_ft/target/wasm32-unknown-unknown/release/fungible_token.wasm"
```

Run the same Sandbox command with that variable set. The token scenario prints `SANDBOX token vault settled 3 test tokens and withdrew 0.5`. It uses a disposable local NEP-141 fixture.

## Verify on NEAR testnet

The standalone vault is deployed at [`vault.aftersnow.testnet`](https://testnet.nearblocks.io/address/vault.aftersnow.testnet). The finalized receipts show two payments totaling **3 test NEAR**. The current on-chain key list for `elder.aftersnow.testnet` contains one function-call key scoped to `request_payment` on this vault.

| Step | Verified result | Transaction |
| --- | --- | --- |
| Deploy and initialize | Deployed the contract and called `new` | [`5PrMF7WGDzutKDbENu7g2n2kA7TtNwUVTe2Puxf39CQx`](https://testnet.nearblocks.io/txns/5PrMF7WGDzutKDbENu7g2n2kA7TtNwUVTe2Puxf39CQx) |
| Rotate elder key | Added the scoped key and removed the original full-access key | [`DygFdzwWK1tQ1ikDXsqhVgbhQcQXhA8X4yaoGqZsvRvL`](https://testnet.nearblocks.io/txns/DygFdzwWK1tQ1ikDXsqhVgbhQcQXhA8X4yaoGqZsvRvL) |
| Request 1 test NEAR | `ALLOW` and `SETTLED` for request 1 | [`VBjpEYCL4THDxuZv8XyHKSBPqykPN8ApGh1GDyMg74s`](https://testnet.nearblocks.io/txns/VBjpEYCL4THDxuZv8XyHKSBPqykPN8ApGh1GDyMg74s) |
| Request 2 test NEAR | `HOLD` for request 2 under `approval_threshold` | [`DcUyxSGL366nRaZKoTe6kuiNk9PcMS9SJ1Mf59GG2AvM`](https://testnet.nearblocks.io/txns/DcUyxSGL366nRaZKoTe6kuiNk9PcMS9SJ1Mf59GG2AvM) |
| Approve as family | `ALLOW` and `SETTLED` for request 2 | [`BHa6LtkiTDQH8VPhrUoR9pM9FgyXLVPhgNJzJzJg9aPW`](https://testnet.nearblocks.io/txns/BHa6LtkiTDQH8VPhrUoR9pM9FgyXLVPhgNJzJzJg9aPW) |
| Request payment to an unapproved recipient | `BLOCK` under `payee_allowlist` | [`i5bEZrvefHUCFhJKYD3YqwGFBwy6XARpbu3XpxFFadv`](https://testnet.nearblocks.io/txns/i5bEZrvefHUCFhJKYD3YqwGFBwy6XARpbu3XpxFFadv) |

The receipts and access-key permissions can be inspected without credentials or signing. The setup below reproduces the proof with a fresh sponsor.

### Create and fund a sponsor

Use a named `.testnet` account with more than 14 test NEAR available. Choose a fresh account so Ward can create the four subaccounts `vault`, `elder`, `family`, and `payee`. If you already have such an account and a full-access key in a local JSON file, skip to **Configure Ward**.

Install the NEAR CLI if needed with `npm install -g near-cli-rs`. In your own terminal, run the following. When prompted, enter a unique account name ending in `.testnet`. This writes a new key file in your home directory and submits its public key to the account creation faucet. [NEAR CLI install and key generation](https://docs.near.org/tools/cli) · [Account creation with a public key](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md#use-manually-provided-public-key---use-the-provided-public-key-manually)

```bash
read -r -p 'New named .testnet account: ' ward_parent
ward_key_dir="$HOME/.local/share/ward-testnet"
ward_sponsor_file="$ward_key_dir/${ward_parent}.json"
mkdir -p -m 700 "$ward_key_dir"

# Use a fresh account name and file. Stop if this file already exists.
(umask 077; test ! -e "$ward_sponsor_file" && near generate-keypair --signature-scheme ed25519 save-to-file "$ward_sponsor_file") &&
  chmod 600 "$ward_sponsor_file" &&
  ward_public_key=$(node -e 'const key = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(key.public_key ?? "")) process.exit(1); process.stdout.write(key.public_key)' "$ward_sponsor_file") &&
  near account create-account sponsor-by-faucet-service "$ward_parent" \
    use-manually-provided-public-key "$ward_public_key" network-config testnet create
```

The account creation faucet provides the account. Top it up with test NEAR if needed, then check that its available balance exceeds 14 test NEAR. The top-up faucet takes the public account ID. [NEAR Testnet Faucet](https://near-faucet.io/)

```sh
near tokens "$ward_parent" view-near-balance network-config testnet now
```

### Configure Ward

If you created the sponsor with `save-to-keychain`, export its full-access private key in your own terminal with `near account export-account "$ward_parent" using-private-key network-config testnet`. Set `ward_parent` to your public sponsor account ID first. The CLI displays the key locally. Save it as the `private_key` field of a JSON file outside the repository and set the file permissions to `0600`. [NEAR CLI key export](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md#using-private-key---export-existing-account-using-a-private-key)

From the repository root, run `test -e .env || cp .env.example .env` and fill in these three entries in `.env`. Both vault commands load that file automatically. Variables already exported in your shell take precedence.

| Variable | Value |
| --- | --- |
| `WARD_TESTNET_PARENT` | The public `.testnet` account ID you just created or an existing funded sponsor. |
| `WARD_TESTNET_SPONSOR_KEY` | The absolute path to the sponsor JSON. For the commands above, run `printf '%s\n' "$ward_sponsor_file"` to see the path. If using an existing account, use its full-access credential JSON with a `private_key` field and permissions `0600`. |
| `WARD_TESTNET_KEYS` | An unused absolute file path in an existing private directory outside this repository. Run `printf '%s\n' "$ward_key_dir/${ward_parent}-vault-keys.json"` for a suggested path if you used the setup above. Leave the file absent. Ward creates it during deployment and reads it during the demo. |

Use full paths beginning with `/` in `.env`. Keep both JSON files outside the repository. Put only paths in `.env` and keep the private keys local. Run the deployment before the demo so the generated key file and testnet vault exist.

### Build, deploy, and run the demo

After building, `npm run --silent deploy:vault:testnet -- --preflight` checks the public RPC and validates the local WASM without accessing credentials. This read-only check passed with a fresh build on Rust 1.93.1. Run `npm run --silent deploy:vault:testnet` to print the commands. It exits without signing. Run the last two commands only after explicitly authorizing the testnet transactions.

```sh
npm ci --prefix firewall/vault/sandbox --ignore-scripts
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='--cfg near -C target-feature=-reference-types,-multivalue' cargo build --locked --manifest-path firewall/vault/Cargo.toml --target wasm32-unknown-unknown --release
npm run deploy:vault:testnet -- --execute
npm run demo:vault
```

Deployment stores the new credentials locally, creates the four accounts, deploys and calls `new`, then atomically replaces the elder's original key with a function-call key for `request_payment` on the vault. It verifies that the elder has exactly that one key. Vault and family are separate signers. The output key file is for the operator and contains their keys. Give the elder only the scoped requester key. Keep the output key file if provisioning stops partway and use the printed hashes to inspect progress before resuming manually. The script refuses to overwrite that file.

The demo sends 1 test NEAR, holds 2 test NEAR, approves and checks the settlement receipt, then tries to pay the non-allowlisted family account. Each transaction prints a hash and explorer link. The two successful payments consume 3 of the 4 test NEAR daily cap, so run the sequence against a fresh vault. Without configuration, it exits with `needs testnet config: set WARD_TESTNET_PARENT and WARD_TESTNET_KEYS (deployment also needs WARD_TESTNET_SPONSOR_KEY)`.

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

## Run Mama Wallet on NEAR testnet

The signed local Sandbox test verified the vault’s token deposit, spending limit, family approval, settlement and withdrawal with an NEP-141 fixture. Circle’s public USDC contract metadata and token storage cost were verified on NEAR testnet. Public deployment and signed USDC payments through the browser are **UNVERIFIED**.

Build the updated WASM using the command in [Verify on NEAR testnet](#verify-on-near-testnet) and install the pinned SDK with `npm ci --prefix firewall/vault/sandbox --ignore-scripts`. Use `WARD_TESTNET_PARENT` and `WARD_TESTNET_SPONSOR_KEY` in `.env`. The sponsor needs at least 5 test NEAR for a new family. The vault receives test NEAR for contract storage and gas, and starts with zero USDC. Its spending and withdrawal methods move USDC. The sponsor also covers USDC registration for the vault and family account.

Stop any server using port 4173, then run:

```sh
npm run dev:testnet
```

1. Open the printed **Mama Wallet on NEAR testnet (USDC)** URL. Create a family wallet and set its limits in **test USDC**. The dashboard shows **USDC · NEAR Testnet** and the public vault address.
2. Choose **Add money for Mama**, copy **Mama’s spending vault**, and open the Circle faucet. Select **USDC** and **Near Testnet**, then paste the vault address. Once the deposit confirms, Ward reads the actual token balance. **Transfer from family account instead** moves USDC you already hold in that account. [Circle testnet faucet](https://faucet.circle.com/) · [Circle’s published USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
3. Invite Mama in another browser profile. After she accepts, choose **Approve device** in Family, then **Finish connecting** in Elder. The vault checks the scoped key on spender calls.
4. Mama can pay any registered NEAR testnet USDC recipient under the family’s limits. For an unregistered recipient, Family can choose **Add money for Mama → Register a USDC recipient**. The dialog shows the one-time storage deposit in test NEAR before you confirm. Family can review held payments or withdraw USDC to its own account. The vault counts an outgoing payment against the daily cap while it settles. A failed token transfer releases that amount after the callback. [NEAR fungible token standard](https://docs.near.org/primitives/ft/standard)
5. **Replace device** and **Unpair device** disable the spender on-chain before Ward revokes the browser session. A replacement needs a fresh approval.

For an existing native-NEAR browser wallet, use `npm run dev:testnet:near` on its original browser profile. USDC wallets use a separate session and database at `.ward/testnet-usdc-families.sqlite`. Existing native balances and limits stay denominated in NEAR. Both modes bind to loopback.

Device keys use browser-native Ed25519 and live in IndexedDB. Keep the original family browser profile. Key recovery is outside this prototype. App notifications are in-app. External deposits update the vault balance after finality. The activity feed records actions submitted through Ward.

In the Family dashboard, choose **Family sign-in → Create sign-in code** and save the code in your password manager. On another browser or after your session expires, choose **Sign in to an existing family** on the setup page. Use the same wallet mode you used to create the code. Sign-in restores the Family dashboard and history. Testnet transactions still require the signing key in the original Family browser. Mama reconnects through a Family pairing link.

## Try the Mama Wallet PWA

Run `npm run dev` and open the **Create a demo family wallet** URL printed in the terminal. By default it is `http://127.0.0.1:4173/family`. The server stores families in `.ward/families.sqlite`. Set `WARD_WALLET_DB` to another path for a clean demo.

| # | Do | Expected result |
| --- | --- | --- |
| 1 | Enter **Chinedu** for **Your name** and **Mama** for **Parent’s name**. Keep the starting limits at **10**, **3**, and **1**. Select **Add approved place** and enter **Oak Street Pharmacy** with account ID **pharmacy.test**. Choose **Create family wallet**. | **Mama’s wallet** opens with **$0**, a **Demo wallet** address, **Protection rules**, and an **Invite Mama** card. Approved places are optional. |
| 2 | Select **Create pairing link**, then **Generate pairing link**. Open it in a separate browser profile on the same computer. Select **Set up my wallet**. | The invite says **Chinedu invited you to your protected wallet**. After acceptance, Family shows **Mama is connected**. The link fails on reuse. |
| 3 | In Family, select **Send money**, choose **USDC on Base**, enter **50.25**, then **Preview quote** and **Confirm demo transfer**. | The default preview says **Fixture quote · USDC on Base**. Both wallets show **Chinedu sent $50.25 · arrived** and a balance of **$50.25**. |
| 4 | In Elder, choose **Oak Street Pharmacy**, enter **1**, choose **Not sure**, and enter `Pay now. Your account will be frozen.` Select **Review payment**, then **Confirm payment**. | Confirmation shows **✓ Approved place**. The result reads **Waiting for your family to say yes. We’ll tell you here.** Family shows **Needs you · 1** and **Mama says someone asked her to send this**. |
| 5 | In Family, select **Approve**. In Elder, pay the pharmacy **2** and answer **No**. Review and confirm, then select **Reject** in Family. | The first payment shows **Sent ✓** and leaves **$49.25**. The second shows **This payment is above your ask-me amount** in Family. Rejection leaves **$49.25** and shows **Stopped to keep you safe. Your family has been told.** in Elder. |
| 6 | In Elder, choose **Pay someone new**, enter **tailor.test**, and choose **Continue to payment**. Enter **1**, answer **No**, review, and confirm. | The preview shows **✓ Valid recipient**. The payment shows **Sent ✓** and leaves **$48.25**. |
| 7 | In Elder, choose **Pay someone new** and then **Ask family to save a place**. Enter **Aso Tailor** and **tailor.test**, and send. Approve it in Family. | Family sees **New place · Aso Tailor** and a scam warning. Elder gets an **Aso Tailor** shortcut. The balance stays at **$48.25**. |
| 8 | In Elder, select **Ask my family**, enter **Please call me.**, and send. In Family, choose **Mark as read**. | Family sees the message in **Needs you**. Elder updates to **Your family saw your message.** |
| 9 | In Family, select **Freeze wallet**. In Elder, try another **1** dollar pharmacy payment. In Family, select **Unfreeze wallet**. | Elder sees **Your family paused payments** at confirmation, then the stopped message. Family sees **Payment stopped** in **Needs you**. **Mark as read** clears the alert and keeps the activity entry. |
| 10 | In Family, select **Replace device**, then **Disconnect and create link**. Pair from a third browser profile. Then select **Unpair device** and **Disconnect device**. | The old phone loses access when the replacement link is created. The replacement sees the same wallet and balance after accepting. Unpairing revokes its access too. |
| 11 | In a compatible browser, choose **Install Mama Wallet** or **Add to Home Screen**. | Mama Wallet can open in its own app window. Payment actions require the running server. Installation is UNVERIFIED in this run. |

Pairing links last 10 minutes and can be shared with the browser share sheet where available, or copied. Each wallet keeps one connected parent device. Browser sessions last 30 days and survive server restarts. The Family sign-in code restores access to the dashboard after session expiry. Push and SMS are outside this demo.

The default loopback server supports separate browser profiles on one computer. To use a separate phone, run behind an HTTPS reverse proxy reachable by both devices and set `WARD_WALLET_ORIGIN` to its exact HTTPS origin. Preserve the public Host header. The server can bind to a specific interface via `WARD_WALLET_HOST` when an HTTPS origin is configured. Cross-device HTTPS and native sharing are UNVERIFIED in this run.

The earlier single-wallet PWA database remains separate. Legacy ledger rows opened through the SQLite migration stay in a local namespace that browser onboarding cannot claim.

### Playwright screenshots

| View | Before | After |
| --- | --- | --- |
| Elder · 390px | [Baseline](docs/screenshots/before-elder-390.png) | [Elder wallet](docs/screenshots/elder-390.png) |
| Family · 390px | [Baseline](docs/screenshots/before-family-390.png) | [Family inbox](docs/screenshots/family-390.png) |
| Elder · 1280px | [Baseline](docs/screenshots/before-elder-1280.png) | [Elder wallet](docs/screenshots/elder-1280.png) |
| Family · 1280px | [Baseline](docs/screenshots/before-family-1280.png) | [Family inbox](docs/screenshots/family-1280.png) |

## Optional NEAR AI Cloud screening

Set `NEAR_AI_API_KEY` in the environment, then run `WARD_SCREENING=near-ai npm run dev`. Use synthetic payment notes. The adapter sends only the bounded note to NEAR AI Cloud, with a 3.5-second timeout and a 48-token completion limit. Notes already flagged by deterministic scoring and payments already held or blocked by Ward skip the cloud request. The default PWA and all CLI demos use deterministic scoring without credentials.

## Optional 1Click preview

Set `WARD_QUOTE_RECIPIENT` to a separate development NEAR account and `WARD_QUOTE_REFUND_TO` to a development EVM address on the selected source chain (Arbitrum for the CLI). `WARD_QUOTE_USDC_ATOMIC` defaults to `1000000` (1 USDC). See `.env.example` for the optional JWT setting. Run `npm run quote:fund` to request a `dry: true` quote. The command prints input and output in atomic units and has no path to credit the mock ledger or sign a transaction. The 1Click API has no testnet. With both addresses in the environment when running `npm run dev`, the PWA requests a dry quote through the same adapter. Otherwise the preview is a labelled fixture. Both modes credit only the mock ledger at the entered dollar amount. Live quotes remain UNVERIFIED.

## Limits and honesty

- Prototype using demo dollars in a local ledger and test NEAR in the vault proof. The bank impersonation scenario is scripted. Bank integration is outside the demo scope.
- Screening was tested on a small set of synthetic scenarios. Its scores are advisory and a low score offers no assurance about fraud.
- The vault spike accepts one pending payment at a time. Native NEAR transfers count at scheduling time. Token transfers reserve their amount at scheduling and release it on a confirmed failure.
- The vault's full-access key, if retained, can bypass the contract. The agent and elder receive only the scoped requester key. The family approves from a separate account.
- The published CLI vault and the browser family vault use separate deployments. The browser family vault’s signed end-to-end proof on public testnet remains UNVERIFIED.

## License

MIT. See [LICENSE](LICENSE).
