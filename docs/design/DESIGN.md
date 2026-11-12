# Mama Wallet: Design System v1

Put this file at `docs/design/DESIGN.md`. Treat it as the spec for the redesign.
The goal is a mobile app that sits next to Cash App, Revolut and Wise in quality,
while being usable by a 75-year-old who distrusts apps.

## 1. The feel

- Calm, trustworthy, a little warm. Money apps for elders should feel safe, not techy.
- Big numbers, few words, one obvious next action per screen.
- Two moods on one brand: **Family** is compact and informative (like a fintech
  home screen). **Elder** is spacious and huge (fewer things, bigger type).
- It is a PWA but must feel native: bottom tab bar, bottom sheets, a numeric keypad,
  smooth screen transitions, full-screen result states.

## 2. What to borrow from `docs/train/` (patterns, not pixels)

The six images are other designers' concepts. Borrow structure and craft only.
Do not copy layouts 1:1, and never reuse their logos, tokens, faces or brand marks.

| File (sorted order) | Borrow | Where it applies |
| --- | --- | --- |
| 1 (`0ae8d2…`, glassy light gradient, black pill bar) | Huge balance with dimmed decimals; one black pill bar with 2 actions and a round centre button; rounded bottom tab bar | Family home hero, action bar |
| 2 (`33ab16…`, warm beige, burgundy) | Numeric keypad screen; confirm screen with row breakdown (Amount / Fee / Total); list rows with icon, title, sub-label | Pay flow (both roles), review sheet |
| 3 (`6249bc…`, dark and red) | Full-bleed colour "deposit" screen with QR and info rows; quick-amount chips; big amount with keypad | Add money / receive screen |
| 4 (`c10741…`, white and pink) | Onboarding hero with floating icons and one pill CTA; permission screen; rounded notification cards | Onboarding, pairing, alerts list |
| 5 (`original-2c2816…`, soft pastel gradient) | Calm gradient backgrounds that shift per screen; simple Send / Receive buttons; recent activity cards | Home, activity |
| 6 (`original-ee7514…`, blue-grey, blob avatars) | Scalloped blob avatars for people and places; highlighted active row; dark rounded tray nav | Approved places, Mama tile, nav |

## 3. Principles

1. One primary action per screen. Everything else is quieter.
2. Numbers are the hero. Balance is the largest thing on Home. Decimals at 55% opacity.
3. Plain words. Never show HOLD, BLOCK, ruleId, vault, key, gas, credits or chain
   names in the Elder app. Family may see details inside an expandable "Details".
4. Every state is designed: loading (skeleton), empty, error, success, offline.
5. Thumb-first: primary controls in the bottom 40% of the screen.
6. Safety is visible: a shield chip ("Protected by Chinedu") is always on Elder screens;
   Family sees what Ward checked.
7. No dark patterns, no fake urgency, no fake notifications. Only claim what exists.

## 4. Tokens

**Colour** (all pairs below meet WCAG AA; ratios measured)

| Token | Hex | Use |
| --- | --- | --- |
| `--ink` | `#0E1A16` | Primary text (17.8:1 on white) |
| `--muted` | `#55655D` | Secondary text (6.2:1 on white, 5.6:1 on warm paper) |
| `--pine` | `#123B32` | Brand, hero cards, primary buttons (white on pine 12.4:1) |
| `--pine-600` | `#1B5A4B` | Pressed and hover for pine |
| `--mint` | `#D8F2A8` | Accent on pine, highlights (10.1:1 on pine) |
| `--mist-1` / `--mist-2` | `#EEF3EC` / `#DDE9E2` | Family background gradient |
| `--warm` | `#F7F4EC` | Elder background |
| `--card` | `#FFFFFF` | Cards |
| `--line` | `#E3E8E2` | Hairlines |
| `--success` / tint | `#14663D` / `#E3F4E8` | 6.1:1 |
| `--warn` / tint | `#7A4B00` / `#FFF1CF` | 6.6:1 |
| `--danger` / tint | `#9E2B20` / `#FDE8E4` | 6.3:1 |

Placeholders use `--muted`. Do not use a lighter grey: `#6F7F77` on white is only 4.2:1.
No dark mode in v1.

**Type.** One family: Manrope (variable, SIL OFL). Self-host the WOFF2 in
`mama-wallet/public/fonts/` with the licence text. No CDN, because the app must work
offline and in mock mode. System UI fallback. `font-variant-numeric: tabular-nums` for
every number.

| Role | Family app | Elder app |
| --- | --- | --- |
| Display (balance) | 44/48, weight 700, tracking -0.03em | 56/60 |
| H1 | 28/34 | 34/40 |
| H2 | 20/26 | 26/32 |
| Body | 16/24 | 20/30 |
| Caption | 13/18 | 16/22 |

**Space and shape.** 4pt grid. Screen padding 20. Card padding 16-20. Gaps 12.
Radius: card 24, sheet 28 (top corners), input 16, pill 999. Tap target at least 48
(Family) and 60 (Elder). Soft shadow `0 8px 24px rgba(14,26,22,.08)`. Glass cards use
`backdrop-filter: blur(16px)` with a solid fallback colour.

**Motion.** Taps 120ms ease-out with a 0.97 scale-down. Sheets 320ms
`cubic-bezier(.2,.9,.2,1)`. Screen transitions via the View Transitions API with a
plain fade fallback. Balance count-up 600ms (only when it changes). Success
check draws in 400ms. Everything respects `prefers-reduced-motion` (no movement,
instant state changes).

## 5. Components

App shell with safe-area padding (`env(safe-area-inset-*)`), top bar (avatar, title,
status chip), **BottomNav** (floating rounded tray, active tab as a filled pill),
**BalanceHero**, **ActionBar** (black or pine pill bar with a round centre button),
**PersonTile** (scalloped blob avatar with initials, name, optional status dot),
**Keypad**, **AmountDisplay**, **Chip**, **ActivityRow** (icon, plain-language title,
sub-label, amount, status chip), **ApprovalCard**, **RuleStepper**, **BottomSheet**,
**ResultScreen**, **Toast**, **Skeleton**, **EmptyState**, **ShieldChip**.
Icons: one inline-SVG set with consistent 1.75px strokes (Lucide-style, ISC licence).
No emoji as icons and no stock photos of people. Avatars are initials on blobs.

## 6. Screens

**Navigation.** Family tabs: Home, Activity, Protection, Mama. Elder tabs: Home,
Activity, Help.

### Onboarding and pairing
- **O1 Welcome.** Pale gradient, floating icons (shield, wallet, phone), headline
  "Send money home without handing it to scammers", one pill button "Create family wallet".
- **O2 About you.** Your name, parent's name, as a short progress-dotted flow.
- **O3 Rules.** Three preset cards: Careful / Balanced / Custom, each with a
  plain sentence ("Mama can spend up to $10 a day"). Custom opens steppers.
- **O4 Wallet created.** Celebration state, wallet address in a copy chip (labelled
  "demo wallet" in mock mode), primary "Invite Mama".
- **O5 Invite.** Native share sheet via `navigator.share`, with copy-link fallback; a
  waiting state that flips to "Mama is connected" with the avatar popping in.
- **P1 Parent landing** (the pairing link): "<Child> invited you to your protected
  wallet." Big button "Set up my wallet". Then three swipe cards explaining what
  protection means in one sentence each.

### Elder
- **E1 Home.** "Good afternoon, Mama". ShieldChip. Hero: "You have" + balance, plus a
  slim "Left to spend today $X" bar. Big **Pay** button. Places as a blob-avatar grid.
  Two big tiles: Pay someone new, Ask my family. Last 3 activities.
- **E2 Pay.** Choose place, then amount on a huge keypad with quick chips and a
  "Limit today" line, then **"Did someone ask you to send this?"** with three big
  answers (Yes / No / Not sure; Yes or Not sure asks "What did they say?"), then a
  review sheet showing Amount, Place and "Ward checked" ticks.
- **E3 Result** (full screen, one colour per outcome): **Sent** (green, animated
  check); **Waiting for your family** (amber, family avatar, "We'll tell you here");
  **Stopped to keep you safe** (calm, not red-alarm; "Your family has been told").
- **E4 Pay someone new.** Name and account, then "Your family will check this first".
- **E5 Activity.** Plain-language list.
- **E6 Help.** Three tappable situations ("I got a strange call", "A message from my
  bank asked me to pay", "Something else"), which send the request to the family inbox.

### Family
- **F1 Home.** "Hello, Chinedu". Hero: "Mama's wallet" balance. ActionBar: Add money
  and Withdraw (if enabled) with a centre "+" for Add. "Needs you · N" strip first when
  non-empty, with Approve and Reject right on the card. Shield summary: Allowed /
  Held / Stopped in 24h. Mama tile. Recent activity.
- **F2 Add money.** Keypad, source chip row (assets from the 1Click catalog only),
  review rows (Amount, Fee, Mama receives), confirm, success. A full-bleed colour
  "Receive" screen with QR and info rows if deposit addresses are available; if not
  built, skip it rather than fake it. Always label demo mode.
- **F3 Protection.** Rules as plain sentences with steppers, approved places as blob
  avatars with an add button, and **Freeze wallet** as a big switch behind a confirm sheet.
- **F4 Activity.** Grouped by day, filter chips (All, Held, Stopped), expandable
  "Details" showing the technical rule.
- **F5 Mama.** Device status, Replace device, Unpair, re-share invite.

### Desktop
Centre the app in a 430px column over the soft gradient. A rounded, subtly shadowed
container is fine from 768px up. Never stretch phone layouts to full width.

### Optional demo stage (only if time allows)
A `/stage` page showing Family and Elder as two phone frames side by side for the
demo video. Cookies are scoped by host, so load one frame from `localhost` and the
other from `127.0.0.1`. Check the server's framing headers first.

## 7. Copy rules

Short, warm, present tense. Elder app examples: "Sent.", "Waiting for your family to
say yes.", "Stopped to keep you safe." Family examples: "Mama tried to pay a new
account. We stopped it." Never imply real bank integration or guaranteed fraud
detection. Keep "Demo, no real money moves" visible wherever mock money is shown.

## 8. Accessibility and PWA

- AA contrast, visible focus rings, `aria-live` for status changes, labelled controls,
  keyboard-only completion of every flow, `prefers-reduced-motion`.
- "Bigger text" toggle for Elder (persist in `localStorage` inside try/catch).
- Manifest: `display: standalone`, theme and background colours from tokens, maskable
  icons, apple-touch-icon. `viewport-fit=cover`, `theme-color`, `overscroll-behavior:
  contain`, tap highlight off, `touch-action: manipulation`. Bump the service worker
  cache version.
- No heavy dependencies. Vanilla JS with ES modules, CSS custom properties. Split
  `app.js` into modules (router, views, components, api).

## 9. Definition of done

- Every screen above exists, in both mock states (empty and populated) and on
  slow/error API responses.
- Playwright screenshots of each screen at 360x800, 390x844, 430x932 and 1280x800,
  saved in `docs/screenshots/`, with no horizontal scroll, clipped text or overlap.
- axe-core reports no serious or critical issues on every screen.
- Side-by-side check against the matching reference image for each screen, with a
  written note of what was borrowed and what was changed.
- `npm test` and every README command still pass, and the README screenshots are
  updated.