# Mama Wallet on NEAR testnet

[Back to README](../README.md) · Run commands from the repository root.

The signed local Sandbox test verified the vault’s token deposit, spending limit, family approval, settlement and withdrawal with an NEP-141 fixture. Circle’s public USDC contract metadata and token storage cost were verified on NEAR testnet. The project owner verified the browser USDC payment flow end to end on NEAR testnet by sending testnet USDC to another recipient through Mama Wallet.

Build the updated WASM using the command in [Build, deploy, and run the demo](testnet-vault.md#build-deploy-and-run-the-demo) and install the pinned SDK with `npm ci --prefix firewall/vault/sandbox --ignore-scripts`. Use `WARD_TESTNET_PARENT` and `WARD_TESTNET_SPONSOR_KEY` in `.env`. The sponsor needs at least 5 test NEAR for a new family. The vault receives test NEAR for contract storage and gas, and starts with zero USDC. Its spending and withdrawal methods move USDC. The sponsor also covers USDC registration for the vault and family account.

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

## Owner transaction proof

[Owner-provided testnet transaction](https://testnet.nearblocks.io/txns/FfPqbbfbxqFureZaYtEoztmMtjAEngq9bhg41pg3qbxA), read via public RPC on 2026-11-14:

| Chain field | Observed value |
| --- | --- |
| Final execution status | `FINAL`; transaction and all receipt outcomes successful |
| Transaction signer | `6ff423d3d567f0e35d9cdd67d14ae570d3fe2a2800c715eb0a44dfb00fafb15b` |
| Transaction receiver / token sender | `u-2b2ecfd971b68ec6.aftersnow.testnet` |
| Transaction call | `resolve_payment` with `{"request_id":"7","approve":true}` |
| Token contract | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` |
| Token metadata | name `USDC`, symbol `USDC`, decimals `6` |
| Token amount | `10000000` base units = **10 testnet USDC** |
| Token recipient | `aftersnow.testnet` |
| Vault receipt logs | `ALLOW` under `policy_pass`, request `7`; then `SETTLED` |

The token contract's NEP-141 `ft_transfer` receipt log records the vault as `old_owner_id`, `aftersnow.testnet` as `new_owner_id`, and `10000000` as `amount`. The chain proves this approval and token transfer; it does not identify the browser UI used to submit it. The app attribution above is the owner's report.

Re-read the transaction and token metadata without keys:

```sh
curl -s https://archival-rpc.testnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"EXPERIMENTAL_tx_status","params":{"tx_hash":"FfPqbbfbxqFureZaYtEoztmMtjAEngq9bhg41pg3qbxA","sender_account_id":"6ff423d3d567f0e35d9cdd67d14ae570d3fe2a2800c715eb0a44dfb00fafb15b","wait_until":"FINAL"}}'
curl -s https://rpc.testnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af","method_name":"ft_metadata","args_base64":"e30="}}'
```

The metadata response's `result.result` is a UTF-8 byte array containing JSON. Metadata was read at block `277701189`; historical transfer values come from the transaction receipts, not today's balances.
