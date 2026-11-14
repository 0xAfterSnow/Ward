# Testnet vault: sponsor and deployment

[Back to README](../README.md) · Run commands from the repository root.

## Verify the published proof without credentials

```sh
npm run --silent verify:testnet
```

This Node built-ins-only script reads the six hashes from the README proof table. It never loads `.env`, accesses a key file, or signs/submits a transaction. Export `WARD_TESTNET_RPC` to prefer a custom endpoint. Otherwise it tries `https://rpc.testnet.near.org`, then `https://test.rpc.fastnear.com`, then `https://archival-rpc.testnet.near.org` for historical receipts. The latter two are listed on the [current NEAR RPC providers page](https://docs.near.org/api/rpc/providers), checked 2026-11-14. Each RPC query has a 15-second timeout per endpoint; historical lookups can take several minutes with fallback.

`PASS` means the returned data met the check; `FAIL` makes the process exit 1, including when RPC data cannot be read. `SKIP` explicitly marks unavailable receipt-log checks. Receipt logs verify historical decisions and settlement, not the vault's present storage or balance. No logs are inferred from a successful transaction alone.

### Actual command output — 2026-11-14

The initial sandbox attempt failed DNS resolution (`EAI_AGAIN`). The following real run outside that sandbox reached public RPCs but suffered timeouts partway through; **UNVERIFIED** below means that check could not be read in this run. Exit code: **1**.

```sh
npm run --silent verify:testnet
```

```text
RPC | query | https://rpc.testnet.near.org
KEY | ed25519:HrmGAWsJLiVZdhZGBYnf6AcE9xM73hr6Wj3g5Gpno3yZ | {"FunctionCall":{"allowance":"999243045941150500000000","method_names":["request_payment"],"receiver_id":"vault.aftersnow.testnet"}}
PASS | elder.aftersnow.testnet: no full-access keys; all keys scoped to vault.aftersnow.testnet / ["request_payment"]
RPC unavailable | https://rpc.testnet.near.org | The operation was aborted due to timeout
RPC unavailable | https://test.rpc.fastnear.com | HTTP 408
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Deploy and initialize | 5PrMF7WGDzutKDbENu7g2n2kA7TtNwUVTe2Puxf39CQx | FINAL and SUCCESS | expected vault.aftersnow.testnet -> vault.aftersnow.testnet
RPC unavailable | https://rpc.testnet.near.org | HTTP 408
RPC unavailable | https://test.rpc.fastnear.com | The operation was aborted due to timeout
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Rotate elder key | DygFdzwWK1tQ1ikDXsqhVgbhQcQXhA8X4yaoGqZsvRvL | FINAL and SUCCESS | expected elder.aftersnow.testnet -> elder.aftersnow.testnet
RPC unavailable | https://rpc.testnet.near.org | fetch failed (ETIMEDOUT)
RPC unavailable | https://test.rpc.fastnear.com | fetch failed (ETIMEDOUT)
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Request 1 test NEAR | VBjpEYCL4THDxuZv8XyHKSBPqykPN8ApGh1GDyMg74s | FINAL and SUCCESS | expected elder.aftersnow.testnet -> vault.aftersnow.testnet
PASS | Request 1 test NEAR | receipt logs: ALLOW/SETTLED | requestId=1 | policy_pass
RPC unavailable | https://rpc.testnet.near.org | The operation was aborted due to timeout
RPC unavailable | https://test.rpc.fastnear.com | fetch failed (ETIMEDOUT)
RPC unavailable | https://archival-rpc.testnet.near.org | fetch failed (ETIMEDOUT)
FAIL | Request 2 test NEAR | DcUyxSGL366nRaZKoTe6kuiNk9PcMS9SJ1Mf59GG2AvM | No RPC endpoint returned EXPERIMENTAL_tx_status; UNVERIFIED
SKIP | Request 2 test NEAR: receipt logs not read; state UNVERIFIED
RPC unavailable | https://rpc.testnet.near.org | fetch failed (ETIMEDOUT)
RPC unavailable | https://test.rpc.fastnear.com | fetch failed (ETIMEDOUT)
RPC unavailable | https://archival-rpc.testnet.near.org | fetch failed (ETIMEDOUT)
FAIL | Approve as family | BHa6LtkiTDQH8VPhrUoR9pM9FgyXLVPhgNJzJzJg9aPW | No RPC endpoint returned EXPERIMENTAL_tx_status; UNVERIFIED
SKIP | Approve as family: receipt logs not read; state UNVERIFIED
RPC unavailable | https://rpc.testnet.near.org | fetch failed (ETIMEDOUT)
RPC unavailable | https://test.rpc.fastnear.com | fetch failed (ETIMEDOUT)
RPC unavailable | https://archival-rpc.testnet.near.org | fetch failed (ETIMEDOUT)
FAIL | Request payment to an unapproved recipient | i5bEZrvefHUCFhJKYD3YqwGFBwy6XARpbu3XpxFFadv | No RPC endpoint returned EXPERIMENTAL_tx_status; UNVERIFIED
SKIP | Request payment to an unapproved recipient: receipt logs not read; state UNVERIFIED
```

The raw alternative also ran outside the sandbox, exited **0**, and returned:

```sh
curl -s https://rpc.testnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"elder.aftersnow.testnet"}}'
```

```json
{"jsonrpc":"2.0","result":{"block_hash":"QEtEnW1dYPtCF6tbLUnbgoEV1qi2Mk9zAAAeDR8At41","block_height":277701163,"keys":[{"access_key":{"nonce":277075256000003,"permission":{"FunctionCall":{"allowance":"999243045941150500000000","method_names":["request_payment"],"receiver_id":"vault.aftersnow.testnet"}}},"public_key":"ed25519:HrmGAWsJLiVZdhZGBYnf6AcE9xM73hr6Wj3g5Gpno3yZ"}]},"id":1}
```

### Archival retry — all checks passed

The explicit archival retry exited **0** and read all six historical transactions and all four expected vault receipt-log results:

```sh
WARD_TESTNET_RPC=https://archival-rpc.testnet.near.org npm run --silent verify:testnet
```

```text
RPC | query | https://archival-rpc.testnet.near.org
KEY | ed25519:HrmGAWsJLiVZdhZGBYnf6AcE9xM73hr6Wj3g5Gpno3yZ | {"FunctionCall":{"allowance":"999243045941150500000000","method_names":["request_payment"],"receiver_id":"vault.aftersnow.testnet"}}
PASS | elder.aftersnow.testnet: no full-access keys; all keys scoped to vault.aftersnow.testnet / ["request_payment"]
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Deploy and initialize | 5PrMF7WGDzutKDbENu7g2n2kA7TtNwUVTe2Puxf39CQx | FINAL and SUCCESS | expected vault.aftersnow.testnet -> vault.aftersnow.testnet
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Rotate elder key | DygFdzwWK1tQ1ikDXsqhVgbhQcQXhA8X4yaoGqZsvRvL | FINAL and SUCCESS | expected elder.aftersnow.testnet -> elder.aftersnow.testnet
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Request 1 test NEAR | VBjpEYCL4THDxuZv8XyHKSBPqykPN8ApGh1GDyMg74s | FINAL and SUCCESS | expected elder.aftersnow.testnet -> vault.aftersnow.testnet
PASS | Request 1 test NEAR | receipt logs: ALLOW/SETTLED | requestId=1 | policy_pass
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Request 2 test NEAR | DcUyxSGL366nRaZKoTe6kuiNk9PcMS9SJ1Mf59GG2AvM | FINAL and SUCCESS | expected elder.aftersnow.testnet -> vault.aftersnow.testnet
PASS | Request 2 test NEAR | receipt logs: HOLD | requestId=2 | approval_threshold
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Approve as family | BHa6LtkiTDQH8VPhrUoR9pM9FgyXLVPhgNJzJzJg9aPW | FINAL and SUCCESS | expected family.aftersnow.testnet -> vault.aftersnow.testnet
PASS | Approve as family | receipt logs: ALLOW/SETTLED | requestId=2 | policy_pass
RPC | EXPERIMENTAL_tx_status | https://archival-rpc.testnet.near.org
PASS | Request payment to an unapproved recipient | i5bEZrvefHUCFhJKYD3YqwGFBwy6XARpbu3XpxFFadv | FINAL and SUCCESS | expected elder.aftersnow.testnet -> vault.aftersnow.testnet
PASS | Request payment to an unapproved recipient | receipt logs: BLOCK | requestId=null | payee_allowlist
```

### Repository checks

`npm test` passed **39/39**, with zero failures or skips, on Node 24.22.1. `node --check scripts/verify-testnet.mjs` and `git diff --check` passed. Every README Markdown link and HTML image source was checked: all 15 local paths/anchors resolved, and the local `/family` URL returned HTTP 200 with `npm run dev` running. All seven Nearblocks URLs returned HTTP 403 to HTTP GET requests; their page contents remain **UNVERIFIED** in this environment. Their six transaction hashes and vault account were independently read through RPC above.

## Create and fund a sponsor

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

## Configure Ward

If you created the sponsor with `save-to-keychain`, export its full-access private key in your own terminal with `near account export-account "$ward_parent" using-private-key network-config testnet`. Set `ward_parent` to your public sponsor account ID first. The CLI displays the key locally. Save it as the `private_key` field of a JSON file outside the repository and set the file permissions to `0600`. [NEAR CLI key export](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md#using-private-key---export-existing-account-using-a-private-key)

From the repository root, run `test -e .env || cp .env.example .env` and fill in these three entries in `.env`. Both vault commands load that file automatically. Variables already exported in your shell take precedence.

| Variable | Value |
| --- | --- |
| `WARD_TESTNET_PARENT` | The public `.testnet` account ID you just created or an existing funded sponsor. |
| `WARD_TESTNET_SPONSOR_KEY` | The absolute path to the sponsor JSON. For the commands above, run `printf '%s\n' "$ward_sponsor_file"` to see the path. If using an existing account, use its full-access credential JSON with a `private_key` field and permissions `0600`. |
| `WARD_TESTNET_KEYS` | An unused absolute file path in an existing private directory outside this repository. Run `printf '%s\n' "$ward_key_dir/${ward_parent}-vault-keys.json"` for a suggested path if you used the setup above. Leave the file absent. Ward creates it during deployment and reads it during the demo. |

Use full paths beginning with `/` in `.env`. Keep both JSON files outside the repository. Put only paths in `.env` and keep the private keys local. Run the deployment before the demo so the generated key file and testnet vault exist.

## Build, deploy, and run the demo

After building, `npm run --silent deploy:vault:testnet -- --preflight` checks the public RPC and validates the local WASM without accessing credentials. This read-only check passed with a fresh build on Rust 1.93.1. Run `npm run --silent deploy:vault:testnet` to print the commands. It exits without signing. Run the last two commands only after explicitly authorizing the testnet transactions.

```sh
npm ci --prefix firewall/vault/sandbox --ignore-scripts
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='--cfg near -C target-feature=-reference-types,-multivalue' cargo build --locked --manifest-path firewall/vault/Cargo.toml --target wasm32-unknown-unknown --release
npm run deploy:vault:testnet -- --execute
npm run demo:vault
```

Deployment stores the new credentials locally, creates the four accounts, deploys and calls `new`, then atomically replaces the elder's original key with a function-call key for `request_payment` on the vault. It verifies that the elder has exactly that one key. Vault and family are separate signers. The output key file is for the operator and contains their keys. Give the elder only the scoped requester key. Keep the output key file if provisioning stops partway and use the printed hashes to inspect progress before resuming manually. The script refuses to overwrite that file.

The demo sends 1 test NEAR, holds 2 test NEAR, approves and checks the settlement receipt, then tries to pay the non-allowlisted family account. Each transaction prints a hash and explorer link. The two successful payments consume 3 of the 4 test NEAR daily cap, so run the sequence against a fresh vault. Without configuration, it exits with `needs testnet config: set WARD_TESTNET_PARENT and WARD_TESTNET_KEYS (deployment also needs WARD_TESTNET_SPONSOR_KEY)`.
