# Local Sandbox enforcement proof

[Back to README](../README.md) · Run commands from the repository root.

The vault unit tests passed on Rust 1.93.1. They use the SDK mock runtime. The signed Sandbox proof below passed with the same Rust version.

## Signed enforcement proof

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

Vault unit tests:

```sh
npm run test:vault
```
