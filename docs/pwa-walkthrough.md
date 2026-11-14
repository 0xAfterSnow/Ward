# Full Mama Wallet PWA walkthrough

[Back to README](../README.md) · Run commands from the repository root.

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

Legacy ledger rows opened through the SQLite migration stay in a local namespace that browser onboarding cannot claim.

Mock dollar amounts are simulated ledger units with no real money movement; in testnet mode amounts represent test USDC (or test NEAR in native mode), not redeemable dollars, even where the Elder display uses a dollar sign.

### Populated mock demo for recording

Run `npm run demo:seed`, then `WARD_WALLET_DB=.ward/demo-seed.sqlite npm run dev`. Open `/family`, choose **Sign in to an existing family**, and use the code printed by the seed command. Under **Mama**, create a pairing link for a separate browser profile. Each seed run adds a new family to this dedicated local database without deleting existing families: $125 funding, three completed payments, one stopped bank-impersonation attempt and one held payment. The starting available balance is $115.50. This command is mock-only, accepts no testnet arguments, and never contacts a chain or signs transactions. Keep the printed sign-in code local.
