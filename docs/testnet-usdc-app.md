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
