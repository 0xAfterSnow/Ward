# Optional integrations: NEAR AI Cloud and 1Click

[Back to README](../README.md) · Run commands from the repository root.

## Optional NEAR AI Cloud screening

Set `NEAR_AI_API_KEY` in the environment, then run `WARD_SCREENING=near-ai npm run dev`. Use synthetic payment notes. The adapter sends only the bounded note to NEAR AI Cloud, with a 3.5-second timeout and a 48-token completion limit. Notes already flagged by deterministic scoring and payments already held or blocked by Ward skip the cloud request. The default PWA and all CLI demos use deterministic scoring without credentials.

## Optional 1Click preview

Set `WARD_QUOTE_RECIPIENT` to a separate development NEAR account and `WARD_QUOTE_REFUND_TO` to a development EVM address on the selected source chain (Arbitrum for the CLI). `WARD_QUOTE_USDC_ATOMIC` defaults to `1000000` (1 USDC). See [`.env.example`](../.env.example) for the optional JWT setting. Run `npm run quote:fund` to request a `dry: true` quote. The command prints input and output in atomic units and has no path to credit the mock ledger or sign a transaction. The 1Click API has no testnet. With both addresses in the environment when running `npm run dev`, the PWA requests a dry quote through the same adapter. Otherwise the preview is a labelled fixture. Both modes credit only the mock ledger at the entered dollar amount. Live quotes remain UNVERIFIED.

- NEAR Rust SDK `5.29.0` for the vault and its unsigned mock-runtime tests.
- NEAR Sandbox 2.12.0 (protocol 84), [NEAR Workspaces 5.0.0](https://github.com/near/near-workspaces-js/releases/tag/near-workspaces%405.0.0) and [NEAR API JS 5.1.1](https://github.com/near/near-api-js/releases/tag/near-api-js%405.1.1) for the local key and settlement proof. `vault.test.near` is generated within the disposable Sandbox. The public testnet proof uses `vault.aftersnow.testnet` and the same NEAR API JS version.
- NEAR Intents 1Click [dry quotes](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) for Arbitrum USDC to wrapped NEAR. The PWA also offers USDC on Base and Ethereum. These assets were checked against the [official token catalog](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens). The adapter was tested with simulated HTTP responses. Live 1Click quotes and delivery from 1Click to the vault are UNVERIFIED.
- Optional NEAR AI Cloud Chat Completions adapter for `zai-org/GLM-5.1-FP8`, called over HTTP with Node's built-in `fetch`. The model ID and endpoint come from the official docs. Tests use simulated responses. Live inference and TEE attestation are UNVERIFIED. [NEAR AI Cloud quickstart](https://docs.near.ai/cloud/quickstart) · [Chat Completions API](https://docs.near.ai/api-reference/chat/create-chat-completion)
