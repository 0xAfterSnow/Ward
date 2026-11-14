# Testnet vault: sponsor and deployment

[Back to README](../README.md) · Run commands from the repository root.

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
