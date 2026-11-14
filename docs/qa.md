# Playwright and screenshots

[Back to README](../README.md) · Run commands from the repository root.

Run `npm run test:ui` for an isolated, in-memory mock wallet with separate Family and Elder browser contexts. The script uses local Chrome (`CHROME_PATH` can override `/opt/google/chrome/chrome`), captures 360×800, 390×844, 430×932 and 1280×800, checks horizontal overflow and runs axe. Development dependencies only: Playwright and `@axe-core/playwright`.

| Screen | 390px | Desktop |
| --- | --- | --- |
| Welcome | [Welcome](screenshots/welcome-390.png) | [Desktop](screenshots/welcome-1280.png) |
| Elder Home | [Wallet](screenshots/elder-home-390.png) | [Desktop](screenshots/elder-home-1280.png) |
| Pay | [Keypad](screenshots/pay-amount-390.png) | [Desktop](screenshots/pay-amount-1280.png) |
| Family Home | [Wallet](screenshots/family-home-390.png) | [Desktop](screenshots/family-home-1280.png) |
| Protection | [Rules](screenshots/protection-390.png) | [Desktop](screenshots/protection-1280.png) |

[Capture and accessibility report](screenshots/qa/report.json) · [Reference study](design/REFERENCES.md).

Manrope is self-hosted under `mama-wallet/public/fonts/` with its OFL licence. UI icons are the requested Hugeicons free rounded set, vendored from `@hugeicons/core-free-icons` 4.4.0 with its MIT licence in `mama-wallet/public/icons-LICENSE.txt`.
