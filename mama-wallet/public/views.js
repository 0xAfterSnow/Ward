import { api } from "./api.js";
import { el, button, link, icon, avatar, balanceValue, keypad, shield } from "./components.js";
import { route, navigate, transition } from "./router.js";
const screen = document.querySelector("#screen");
const notice = document.querySelector("#notice");
const dialog = document.querySelector("#wallet-dialog");
const form = document.querySelector("#wallet-form");
const roleLabel = document.querySelector("#role");
const bigger = document.querySelector("#bigger");
let wallet;
let busy = false;
let dialogBusy = false;
let dialogTrigger;
let invitation;
let disconnected = false;
let testnet = false;
let usdc = false;
let registrationCost;
let showSignIn = false;
let familyCanSign = false;
const testnetUnit = () => usdc ? "test USDC" : "test NEAR";
const familySetupKey = () => usdc ? "family-usdc" : "family";
let chain;
const onChain = (op, args = {}) => chain.signTestnet(api, wallet.address, op, args, wallet.deviceAccount ?? wallet.fundingAccount);

async function checkFamilyKey() {
  familyCanSign = Boolean(testnet && wallet?.role === "family" &&
    await chain.hasDevice(wallet.address, wallet.fundingAccount).catch(() => false));
}

let noticeTimer;
function dismissNotice() {
  clearTimeout(noticeTimer);
  if (notice.contains(document.activeElement)) document.querySelector("#main").focus({ preventScroll: true });
  notice.hidden = true;
  notice.replaceChildren();
}
function notify(message, focus = false, duration = wallet?.role === "elder" ? 10000 : 6000) {
  clearTimeout(noticeTimer);
  const close = button("Dismiss", dismissNotice, "notice-dismiss");
  close.setAttribute("aria-label", "Dismiss message");
  notice.replaceChildren(el("span", message), close);
  notice.hidden = false;
  if (focus) notice.focus();
  // Errors can request duration=0; ordinary confirmations never linger indefinitely.
  if (duration > 0) noticeTimer = setTimeout(dismissNotice, duration);
}

const dollars = value => {
  if (!testnet) return `$${value}`;
  if (wallet?.role === "elder") return `$${Number(value).toLocaleString("en-US", {maximumFractionDigits: 4})}`;
  const [whole, fraction = ""] = String(value).split(".");
  const shortened = fraction.slice(0, usdc ? 6 : 4).replace(/0+$/, "");
  return `${whole}${shortened ? "." + shortened : ""} ${testnetUnit()}`;
};
const panel = (title, className = "") => {
  const section = el("section", undefined, `panel ${className}`);
  section.append(el("h2", title));
  return section;
};

function receipts(data) {
  if (!data.receipts.length) return null;
  const list = panel("Money arrived", "receipts");
  for (const row of data.receipts.slice(0, 4)) {
    const receipt = el("p", undefined, "receipt list-row");
    receipt.append(el("span", `From ${row.sender}`), el("strong", dollars(row.amount)));
    list.append(receipt);
  }
  return list;
}

const paymentStatuses = { ALLOW: "Sent", HOLD: "Waiting for family", BLOCK: "Stopped" };
const outcomeText = {
  ALLOW: "Payment sent",
  HOLD: "Waiting for your family to say yes. We’ll tell you here.",
  BLOCK: "Stopped to keep you safe. Your family has been told.",
};

function elderActivity(data, recent = false) {
  const activity = panel(recent ? "Recent activity" : "Your activity", "elder-activity");
  for (const row of data.payments.slice(0, recent ? 3 : 40)) {
    const item = el("article", undefined, "activity-row");
    const description = el("div");
    description.append(el("strong", row.payee ?? "Payment"), el("p", paymentStatuses[row.decision], "muted"));
    item.append(icon(row.decision === "ALLOW" ? "arrow" : "clock"), description, el("strong", row.amount ? dollars(row.amount) : ""));
    activity.append(item);
  }
  for (const row of data.requests.slice(0, recent ? 1 : 40)) {
    activity.append(el("p", row.type === "help" ? row.status === "seen" ? "Your family saw your message." : "Your family has your help request."
      : `${row.label} · ${{ pending: "Waiting for family", approved: "Your family saved this place", rejected: "Your family didn’t save this place" }[row.status]}`, "list-row"));
  }
  if (!data.payments.length && !data.requests.length) activity.append(illustration("wallet-care", "small"), el("p", "Your payments and family updates will appear here.", "empty-state"));
  return activity;
}
function elderView(data) {
  const body = el("div", undefined, "elder");
  const tab = route();
  if (tab === "activity") {
    body.append(el("h1", "Activity"), elderActivity(data));
    const money = receipts(data); if (money) body.append(money);
    return body;
  }
  if (tab === "help") {
    body.append(el("h1", "Let’s ask your family"), illustration("family-help", "compact"), el("p", "If something feels wrong, you can ask for help here.", "muted"));
    for (const label of ["I got a strange call", "A message from my bank asked me to pay", "Something else"])
      body.append(button(label, () => openFamilyRequest("help", label), "help-tile"));
    body.append(el("p", "Your family sees your message in their wallet. If you need help now, call them too.", "muted"));
    return body;
  }
  const hour = new Date().getHours();
  body.classList.add("elder-home");
  body.append(el("h1", `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${data.name}`));
  const balance = el("section", undefined, `balance elder-balance${data.frozen ? " paused" : ""}`);
  balance.append(el("h2", "You have", "balance-label"), testnet ? el("p", dollars(data.balance), "balance-number") : balanceValue(data.balance));
  const daily = el("dl", undefined, "daily-amount");
  daily.append(el("dt", "Left to spend today"), el("dd", dollars(data.leftToday)));
  balance.append(daily);
  if (data.frozen) balance.append(el("p", "Your family paused payments", "caution"));
  body.append(balance);
  const pay = button("Pay", openPlaces, "primary pay-primary"); pay.append(icon("arrow"));
  pay.disabled = testnet && !data.deviceReady;
  body.append(pay);
  if (testnet && !data.deviceReady) {
    const setup = panel("Connect this phone");
    setup.append(el("p", data.requesterEnabled ? "Your family approved this device. Finish connecting to make payments." : "Ask your family to approve this device in their wallet."));
    if (data.requesterEnabled) setup.append(button("Finish connecting", () => update(async () => {
      wallet = (await onChain("scope")).wallet; notify("Your device is connected.", true);
    }), "primary"));
    body.append(setup);
  }
  const places = panel("Your places", "places");
  places.append(placeGrid(data)); body.append(places);
  const support = el("div", undefined, "support");
  const newPayment = button("Pay someone new", openNewPayment, "support-tile");
  newPayment.prepend(icon("plus")); newPayment.disabled = testnet && !data.deviceReady;
  const help = button("Ask my family", () => openFamilyRequest("help"), "support-tile"); help.prepend(icon("person"));
  support.append(newPayment, help); body.append(support, elderActivity(data, true));
  return body;
}
function placeGrid(data) {
  const grid = el("div", undefined, "payees");
  for (const payee of data.payees) {
    const choose = button(payee.label, () => openPayment(payee), "payee", payee.id);
    choose.disabled = testnet && !data.deviceReady;
    choose.replaceChildren(avatar(payee.label), el("span", payee.label)); grid.append(choose);
  }
  if (!data.payees.length) grid.append(el("p", "No saved places yet. You can pay someone new.", "empty-state"));
  return grid;
}
function openPlaces() {
  stage("Who are you paying?", [placeGrid(wallet), button("Pay someone new", openNewPayment)]);
}

async function copy(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    notify(message);
  } catch {
    notify("Select and copy the link shown on screen.");
  }
}

function inboxPanel(data, detail = false) {
  const total = data.pending.length + data.requests.length + data.blockedAlerts.length;
  const inbox = panel("Needs you", total ? "inbox has-requests" : "inbox");
  if (total) {
    const count = el("span", String(total), "queue-count");
    count.setAttribute("aria-label", `${total} awaiting review`);
    inbox.firstElementChild.append(" ", count);
  }
  if (!total) inbox.append(el("p", "You’re all caught up. Requests from Mama will appear here.", "muted"));
  for (const row of data.blockedAlerts) {
    const item = el("article", undefined, "request");
    item.append(el("h3", `Payment stopped · ${row.payee ?? "Unknown recipient"}`),
      el("p", [row.amount && dollars(row.amount), row.reason].filter(Boolean).join(" · ")),
      el("p", "This payment is closed. Mark it as read to let Mama know you saw it.", "muted"),
      button("Mark as read", () => update(async () => {
        wallet = await api("acknowledge-block", { id: row.alertId });
        notify("Stopped payment marked as read.", true);
      }), "outline", `block-${row.alertId}`));
    if (testnet && row.hash) item.append(link("View testnet receipt", `https://testnet.nearblocks.io/txns/${row.hash}`));
    inbox.append(item);
  }
  const reviewId = new URLSearchParams(location.hash.slice(1)).get("review");
  for (const row of data.pending) {
    const item = el("article", undefined, "request");
    const heading = el("h3", undefined, "request-heading");
    heading.append(el("span", row.payee ?? "Payment"), el("span", dollars(row.amount), "request-amount"));
    item.append(heading, el("p", row.reason));
    if (row.reviewMessage) {
      const context = el("div", undefined, "review-message");
      const answer = { yes: "Yes", no: "No", unsure: "Not sure" }[row.reviewMessage.asked];
      if (answer) context.append(el("p", `Did someone ask Mama to send this? ${answer}`));
      if (row.reviewMessage.message) context.append(el("h4", "What they said"), el("p", row.reviewMessage.message, "message"));
      item.append(context);
    } else if (row.ruleId === "requested_review" || row.ruleId === "someone_asked") {
      item.append(el("p", "The original message wasn’t saved for this payment.", "muted"));
    }
    if (row.signals.length) item.append(el("p", `Message signals: ${row.signals.join(", ")}`, "muted"));
    const approval = `${location.origin}/family#review=${encodeURIComponent(row.id)}`;
    const actions = el("div", undefined, "actions");
    for (const [label, approve] of [["Approve", true], ["Reject", false]]) {
      actions.append(button(label, () => update(async () => {
        const result = testnet ? await onChain("review", { requestId: row.id, approve }) : await api("review", { id: row.id, approve });
        wallet = result.wallet;
        if (new URLSearchParams(location.hash.slice(1)).get("review") === String(row.id)) history.replaceState(null, "", "/family#tab=home");
        if (detail) dialog.close();
        notify(`${result.result.reason}.`, true);
      }), approve ? "primary" : "outline", `${row.id}-${label}`));
    }
    const links = el("div", undefined, "review-links");
    const open = link("Open approval link", approval);
    open.dataset.focus = `${row.id}-open`;
    open.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      history.pushState(null, "", approval);
      focusReview();
    });
    links.append(open,
      button("Copy approval link", () => copy(approval, "Approval link copied."), "text-button", `${row.id}-copy`));
    item.append(actions);
    if (!detail) item.append(links);
    inbox.append(item);
  }
  if (reviewId && !data.pending.some(row => String(row.id) === reviewId)) {
    inbox.append(el("p", "This payment is no longer waiting for approval."));
  }
  for (const row of data.requests) {
    const item = el("article", undefined, "request");
    const resolve = approve => update(async () => {
      wallet = await api("family-response", { id: row.id, approve });
      notify(row.type === "help" ? "Mama can see that you read her request."
        : approve ? "Place saved to Mama’s shortcuts." : "New place rejected.", true);
    });
    if (row.type === "help") {
      item.append(el("h3", `${data.name} asked for help`));
      if (row.message) item.append(el("p", row.message, "message"));
      item.append(button("Mark as read", () => resolve(true), "primary", `${row.id}-seen`));
    } else {
      item.append(el("h3", `New place · ${row.label}`), el("p", row.payee, "message"),
        el("p", "Scammers can impersonate a bank. Call Mama on a number you know before saving this place.", "caution"));
      const actions = el("div", undefined, "actions");
      actions.append(button("Approve", () => resolve(true), "primary", `${row.id}-approve`),
        button("Reject", () => resolve(false), "outline", `${row.id}-reject`));
      item.append(actions);
    }
    inbox.append(item);
  }
  return inbox;
}

function openFreeze(data) {
    stage(data.frozen ? "Resume payments?" : "Pause Mama’s payments?", [el("p", data.frozen ? "Mama can pay again within your spending rules." : "All payments pause until you turn them back on. Mama will see that you paused them.")], data.frozen ? "Unfreeze wallet" : "Freeze wallet", async () => {
      wallet = testnet ? (await onChain("freeze", { frozen: !data.frozen })).wallet : await api("freeze", { frozen: !data.frozen });
      finish(wallet.frozen ? "Payments paused" : "Payments are back on");
    });
}

function rulesPanel(data) {
  const rules = panel("Protection rules", "rules");
  const list = el("dl", undefined, "limits");
  for (const [key, label] of limitFields) {
    list.append(el("dt", {dailyCap: "Each day", perTxCeiling: "Each payment", approvalThreshold: "Ask you above"}[key]), el("dd", dollars(data.rules[key])));
  }
  const places = el("ul", undefined, "approved-list");
  for (const place of data.rules.places) { const item = el("li"); item.append(avatar(place.label), el("span", place.label)); places.append(item); }
  rules.append(list, el("h3", "Approved places"), places,
    button("Edit protection rules", () => openRules(data.rules)));
  rules.append(button(data.frozen ? "Unfreeze wallet" : "Freeze wallet", () => openFreeze(data), "freeze-button", "freeze"));
  return rules;
}

function summaryPanel(data) {
  const summary = panel("Protection summary", "summary");
  summary.append(el("p", "Last 24 hours", "muted"));
  const metrics = el("dl", undefined, "metrics");
  for (const decision of ["ALLOW", "HOLD", "BLOCK"]) {
    const metric = el("div");
    metric.append(el("dt", { ALLOW: "Allowed", HOLD: "Held", BLOCK: "Stopped" }[decision]),
      el("dd", String(data.summary.counts[decision])));
    metrics.append(metric);
  }
  summary.append(metrics);
  if (!data.summary.stopped.length) summary.append(el("p", "No payments were stopped.", "muted"));
  
  return summary;
}

let activityFilter = "All";
function auditPanel(data, recent = false) {
  const audit = panel(recent ? "Recent activity" : "Your wallet history", "activity");
  if (!recent) {
    const filters = el("div", undefined, "filter-bar");
    for (const label of ["All", "Held", "Stopped"]) {
      const control = button(label, () => { activityFilter = label; render(); }, "filter", `filter-${label}`);
      control.setAttribute("aria-pressed", String(activityFilter === label)); filters.append(control);
    }
    audit.append(filters);
  }
  const rows = data.audit.filter(row => recent || activityFilter === "All" || row.decision === (activityFilter === "Held" ? "HOLD" : "BLOCK"));
  if (data.audit.length && !rows.length) audit.append(el("p", "No payments in this view.", "empty-state"));
  if (!data.audit.length) audit.append(illustration("wallet-care", "small"), el("p", "Wallet decisions and protection changes will appear here.", "muted"));
  let day;
  for (const row of rows.slice(0, 40)) {
    const date = new Date(row.timestamp).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    if (date !== day) {
      audit.append(el("h3", date, "activity-day"));
      day = date;
    }
    const item = el("article", undefined, "audit-row");
    if (row.decision) item.append(el("strong",
      [paymentStatuses[row.decision], row.payee, row.amount && dollars(row.amount)].filter(Boolean).join(" · ")));
    item.append(el("p", row.decision ? { ALLOW: "Payment completed", HOLD: "Waiting for your review", BLOCK: "Stopped by your protection rules" }[row.decision] : row.reason));
    const details = el("details"); details.append(el("summary", "Details"), el("p", [row.decision, row.ruleId, row.reason].filter(Boolean).join(" · ")));
    item.append(details);
    audit.append(item);
  }
  return audit;
}

function familyView(data) {
  const body = el("div", undefined, "family");
  const tab = route();
  if (tab === "activity") { body.append(el("h1", "Activity"), auditPanel(data)); const money = receipts(data); if (money) body.append(money); return body; }
  if (tab === "protection") { body.append(el("h1", "Looking out for Mama"), el("p", "A little freedom. A little peace of mind.", "muted"), rulesPanel(data), summaryPanel(data)); return body; }
  if (tab !== "mama") {
    const greeting = el("div", undefined, "greeting");
    greeting.append(avatar(data.childName), el("h1", `Hello, ${data.childName}`)); body.append(greeting);
    const hero = el("section", undefined, "family-hero");
    hero.append(el("h2", `${data.name}’s wallet`, "balance-label"), testnet ? el("p", dollars(data.balance), "balance-number") : balanceValue(data.balance),
      el("p", testnet ? "Test money only" : "Demo, no real money moves", "muted demo-note"));
    const funding = el("div", undefined, "action-bar");
    const add = () => testnet ? openTestnetDeposit() : openFunding(data);
    funding.append(button(data.frozen ? "Unfreeze wallet" : "Freeze wallet", () => openFreeze(data), "bar-action"));
    const plus = button("Add money", add, "bar-plus"); plus.replaceChildren(icon("plus")); plus.setAttribute("aria-label", "Add money"); funding.append(plus);
    funding.append(testnet ? button("Withdraw", () => openTestnetFunding("withdraw"), "bar-action") : button("Activity", () => navigate("activity", render), "bar-action"));
    hero.append(funding); body.append(hero);
    if (data.pending.length + data.requests.length + data.blockedAlerts.length) body.append(inboxPanel(data));
    const mama = button("", () => navigate("mama", render), "mama-tile");
    const text = el("span"); text.append(el("strong", data.name), el("span", data.paired ? "Connected to your family" : "Invite her to your family wallet", "muted"));
    mama.append(avatar(data.name), text, icon("arrow")); body.append(mama);
    body.append(summaryPanel(data));
    const recent = auditPanel({ ...data, audit: data.audit.slice(0, 3) }, true); body.append(recent);
    return body;
  }
  body.append(el("h1", data.name), el("p", "Your family, connected.", "muted"));
  const address = el("details"); address.append(el("summary", "Details"), el("p", `${testnet ? "Testnet vault" : "Demo wallet"} · ${data.address}`, "message")); body.append(address);
  if (testnet && !familyCanSign) body.append(el("p", "Use the original Family browser to confirm transfers.", "muted"));
  const setup = panel(data.paired ? "Connected phone" : `Invite ${data.name}`, "setup");
  const connection = el("p", data.paired ? `${data.name} is connected`
    : data.deviceRequested ? "A device is waiting to connect on testnet" : `${data.name} is waiting for an invite`, "connection");
  connection.setAttribute("role", "status");
  setup.append(connection);
  if (!data.paired || !data.receipts.length || !data.rules.rulesVersion) {
    const list = el("ol", undefined, "checklist");
    for (const [label, done] of [
      ["Send money", data.receipts.length > 0],
      ["Set rules", data.rules.rulesVersion > 0],
      [`Pair ${data.name}’s phone`, data.paired],
    ]) {
      const step = el("li", undefined, done ? "complete" : "");
      step.append(el("span", label), el("span", done ? "Done" : "To do", "step-status"));
      list.append(step);
    }
    setup.append(list);
  }
  const devices = el("div", undefined, "actions device-actions");
  if (testnet && data.deviceRequested && !data.requesterEnabled) {
    devices.append(button("Approve device", () => update(async () => {
      wallet = (await onChain("requester", { connect: true })).wallet;
      notify("Device approved. Mama can finish connecting her phone.", true);
    }), "primary"));
  }
  if (data.paired || data.deviceRequested || data.deviceAttached) {
    devices.append(button("Replace device", () => openPairing(true)),
      button("Unpair device", () => openUnpair(), "text-button"));
  } else {
    devices.append(button("Create pairing link", () => openPairing(false)));
  }
  setup.append(devices);
  body.append(setup);
  const access = panel("Family sign-in", "family-access");
  access.append(el("p", data.hasSignIn
    ? "Use your saved code to open this dashboard on another browser."
    : "Save a sign-in code so you can get back to this dashboard after your session expires."));
  access.append(button(data.hasSignIn ? "Replace sign-in code" : "Create sign-in code", () => openSignInCode(data.hasSignIn)));
  if (data.hasSignIn) access.append(button("Sign out", () => {
    stage("Sign out of Family", [el("p", "You’ll need your saved sign-in code to come back.")], "Sign out", async () => {
      await api("family-sign-out", {});
      wallet = undefined;
      showSignIn = true;
      dialog.close();
      render();
    });
  }, "text-button"));
  body.append(access);
  return body;
}

function render() {
  const focused = screen.contains(document.activeElement) ? document.activeElement.dataset.focus : undefined;
  screen.setAttribute("aria-busy", "false");
  const elder = wallet?.role === "elder" || Boolean(invitation) || (!wallet && (location.pathname === "/elder" || disconnected));
  document.body.classList.toggle("elder-mode", elder);
  bigger.hidden = wallet?.role !== "elder";
  document.querySelector("#demo-chip").hidden = !elder;
  document.querySelector("#demo-chip").textContent = testnet ? "Test money only" : "Demo, no real money moves";
  roleLabel.hidden = elder;
  roleLabel.textContent = testnet ? "Test wallet" : wallet ? "Family view" : "Demo wallet";
  if (testnet) document.querySelector("footer").textContent = "Test money only";
  document.querySelector(".wallet-nav")?.remove();
  if (!wallet) {
    document.querySelector("#shield")?.remove();
    if (invitation) screen.replaceChildren(inviteView(invitation));
    else if (elder) {
      const welcome = el("section", undefined, "panel");
      welcome.append(el("h1", "Connect your wallet"), el("p", "Ask your family to send you a new pairing link."));
      screen.replaceChildren(welcome);
    } else screen.replaceChildren(showSignIn ? signInView() : onboardingView());
    return;
  }
  screen.replaceChildren(elder ? elderView(wallet) : familyView(wallet));
  document.querySelector("#shield")?.remove();
  if (elder) { const chip = shield(wallet.childName); chip.id = "shield"; screen.before(chip); }
  const navigation = el("nav", undefined, "wallet-nav");
  navigation.setAttribute("aria-label", "Wallet sections");
  const destinations = elder ? [["Home", "home"], ["Activity", "activity"], ["Help", "help"]]
    : [["Home", "home"], ["Activity", "activity"], ["Protection", "shield"], ["Mama", "person"]];
  for (const [label, symbol] of destinations) {
    const tab = label.toLowerCase();
    const control = button(label, () => navigate(tab, render), "nav-item");
    control.replaceChildren(icon(symbol), el("span", label));
    if (route() === tab) control.setAttribute("aria-current", "page");
    navigation.append(control);
  }
  document.body.append(navigation);
  if (focused) screen.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}

async function update(work) {
  if (busy) return;
  busy = true;
  const trigger = document.activeElement;
  if (trigger instanceof HTMLButtonElement) trigger.disabled = true;
  screen.setAttribute("aria-busy", "true");
  try {
    await work();
    render();
  } catch (error) {
    notify(wallet?.role === "elder" ? "We couldn’t finish that. Please try again." : error.message, true, 0);
  } finally {
    busy = false; screen.setAttribute("aria-busy", "false");
    if (trigger instanceof HTMLButtonElement) trigger.disabled = false;
  }
}

function field(label, input) {
  const wrapper = el("label", label);
  wrapper.append(input);
  return wrapper;
}

function textInput(value = "", maxLength = 60, required = true) {
  const input = el("input");
  Object.assign(input, { value, maxLength, required, autocomplete: "off" });
  return input;
}

function amountInput(value) {
  const input = textInput(value, 11);
  input.inputMode = "decimal";
  input.pattern = "[0-9]{1,8}(\\.[0-9]{1,2})?";
  return input;
}

function stage(title, fields, actionLabel, action) {
  dialog.className = "";
  delete dialog.dataset.approval;
  const heading = el("h2", title);
  heading.id = "dialog-title";
  heading.tabIndex = -1;
  const error = el("p", undefined, "form-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const actions = el("div", undefined, "actions");
  const cancel = button(action ? "Cancel" : "Done", () => dialog.close(), action ? "text-button" : "primary");
  const submit = el("button", actionLabel, "primary");
  submit.type = "submit";
  if (action) actions.append(submit);
  actions.append(cancel);
  const disclosure = el("p", testnet ? "Test money only" : "Demo, no real money moves", "demo-note");
  form.replaceChildren(...(wallet?.role === "elder" ? [shield(wallet.childName)] : []), heading, ...fields, error, actions, disclosure);
  form.onsubmit = async event => {
    event.preventDefault();
    if (!action || dialogBusy) return;
    dialogBusy = true;
    submit.disabled = cancel.disabled = true;
    submit.textContent = "Please wait…"; form.setAttribute("aria-busy", "true");
    error.hidden = true;
    try {
      await action();
    } catch (problem) {
      error.textContent = wallet?.role === "elder" ? "We couldn’t finish that. Check your connection and try again." : problem.message;
      error.hidden = false;
    } finally {
      dialogBusy = false;
      submit.disabled = cancel.disabled = false;
      submit.textContent = actionLabel; form.setAttribute("aria-busy", "false");
    }
  };
  if (!dialog.open) {
    dialogTrigger = document.activeElement.dataset.focus;
    dialog.showModal();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) dialog.animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 320, easing: "cubic-bezier(.2,.9,.2,1)" });
  }
  heading.focus();
}

function finish(message, art) {
  render();
  stage(message, art ? [illustration(art, "compact")] : []);
}

function openPayment(payee) {
  const payment = { id: crypto.randomUUID(), payee: payee.id };
  const amount = amountInput();
  amount.className = "amount-display";
  amount.placeholder = "0.00";
  function amountStep() {
    stage(`Pay ${payee.label}`, [field("Amount in dollars", amount), el("p", `Limit today · ${dollars(wallet.leftToday)}`, "muted amount-limit"), keypad(amount)], "Continue", () => {
      payment.dollars = amount.value; questionStep();
    });
    dialog.className = "payment-screen";
  }
  function questionStep() {
    const question = el("fieldset");
    question.append(el("legend", "Choose an answer", "muted"));
    const options = el("div", undefined, "options");
    const extra = el("textarea"); extra.maxLength = 512; extra.rows = 2;
    const more = field("What did they say?", extra); more.hidden = true;
    for (const [value, label] of [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]]) {
      const input = el("input"); Object.assign(input, { name: "asked", value, type: "radio", required: true });
      const option = field(label, input); option.prepend(input);
      input.addEventListener("change", () => { more.hidden = value === "no"; }); options.append(option);
    }
    question.append(options, more);
    stage("Did someone ask you to send this?", [el("p", "It’s okay to check. Your family can help.", "muted"), question, button("Back to amount", amountStep, "text-button")], "Review payment", async () => {
      payment.asked = new FormData(form).get("asked"); payment.memo = payment.asked === "no" ? "" : extra.value;
      const { checks } = await api("payment-preview", { payee: payment.payee, dollars: payment.dollars });
      const details = el("div", undefined, "payment-checks"); details.append(el("strong", "Ward checked"));
      const list = el("ul");
      const labels = { recipient: "Valid recipient", payee_allowlist: "Approved place", daily_cap: "Within your daily limit", per_tx_ceiling: "Within your payment limit", vault_balance: "Enough money available", wallet_frozen: "Payments are on" };
      const failed = { recipient: "Check the recipient", payee_allowlist: "This place needs family approval", daily_cap: "Above what you can spend today", per_tx_ceiling: "Above your limit for one payment", vault_balance: "There isn’t enough money in your wallet", wallet_frozen: "Your family paused payments" };
      for (const item of checks.filter(check => labels[check.ruleId])) {
        const row = el("li"); row.append(icon(item.passed ? "check" : "shield"), el("span", item.passed ? labels[item.ruleId] : failed[item.ruleId])); list.append(row);
      }
      details.append(list);
      const rows = el("dl", undefined, "review-rows");
      rows.append(el("dt", "Amount"), el("dd", dollars(payment.dollars)), el("dt", "Place"), el("dd", payee.label));
      stage("Ready to send?", [rows, details, button("Back", questionStep, "text-button")], "Confirm payment", async () => {
        const { result, wallet: refreshed } = testnet ? await onChain("pay", payment) : await api("payments", payment);
        wallet = refreshed; render();
        const titles = { ALLOW: "Sent", HOLD: "Waiting for your family", BLOCK: "Stopped to keep you safe" };
        const mark = el("div", undefined, "result-mark"); mark.append(result.decision === "HOLD" ? avatar(wallet.childName) : icon(result.decision === "ALLOW" ? "check" : "shield"));
        stage(titles[result.decision], [mark, el("p", result.decision === "ALLOW" ? `${dollars(payment.dollars)} to ${payee.label}` : result.decision === "BLOCK" ? "Your family has been told." : outcomeText[result.decision])]);
        dialog.className = `result-screen result-${result.decision.toLowerCase()}`;
      });
    });
  }
  amountStep();
}

function openTestnetDeposit() {
  const address = textInput(wallet.address);
  address.readOnly = true;
  address.addEventListener("focus", () => address.select());
  const status = el("p");
  status.setAttribute("role", "status");
  const faucet = link(usdc ? "Open Circle USDC faucet" : "Open testnet faucet",
    usdc ? "https://faucet.circle.com/" : "https://near-faucet.io/");
  faucet.target = "_blank";
  faucet.rel = "noopener noreferrer";
  stage("Add money for Mama", [
    el("p", usdc ? "On the Circle faucet, select USDC and Near Testnet, then paste this vault address."
      : "Send test NEAR straight to this vault. The balance updates after testnet confirms the deposit."),
    field("Mama’s spending vault", address),
    button("Copy vault address", async () => {
      try {
        await navigator.clipboard.writeText(address.value);
        status.textContent = "Vault address copied.";
      } catch {
        address.focus();
        status.textContent = "Select and copy the vault address above.";
      }
    }, "outline"),
    faucet,
    button("Transfer from family account instead", () => openTestnetFunding("fund"), "text-button"),
    ...(usdc ? [button("Register a USDC recipient", openUsdcRegistration, "text-button")] : []),
    status,
  ]);
}

function openUsdcRegistration() {
  const recipient = textInput();
  stage("Register a USDC recipient", [
    el("p", `NEAR requires a one-time token storage deposit for each recipient. This uses ${registrationCost} test NEAR from your family account, plus gas.`),
    field("Recipient’s NEAR testnet account", recipient),
  ], "Confirm registration", async () => {
    wallet = (await onChain("register", { recipient: recipient.value.trim() })).wallet;
    finish("Recipient registered for USDC");
  });
}

function openTestnetFunding(op) {
  const amount = amountInput();
  const fund = op === "fund";
  stage(`${fund ? "Send" : "Withdraw"} ${testnetUnit()}`, [
    el("p", fund ? `Move ${testnetUnit()} from your family account into Mama’s spending vault.`
      : `Send ${testnetUnit()} from the protected vault back to your family account.`),
    ...(fund ? [el("p", `Vault for spending funds: ${wallet.address}`, "message")] : []),
    el("p", `Family account: ${wallet.fundingAccount}`, "message"),
    field(`Amount in ${testnetUnit()}`, amount),
  ], fund ? "Confirm testnet transfer" : "Confirm testnet withdrawal", async () => {
    wallet = (await onChain(op, { dollars: amount.value })).wallet;
    finish(fund ? "Testnet transfer confirmed" : "Testnet withdrawal confirmed");
  });
}

function openFunding(data) {
  const source = el("select");
  const sourceDetails = el("details"); sourceDetails.append(el("summary", "Details"));
  for (const [index, item] of data.sources.entries()) {
    const option = el("option", item.label); option.value = item.id; source.append(option);
    sourceDetails.append(el("p", `Source ${index + 1}: ${item.label}`));
  }
  const amount = amountInput(); amount.className = "amount-display"; amount.placeholder = "0.00";
  const chips = el("div", undefined, "source-chips");
  for (const [index, item] of data.sources.entries()) {
    const chip = button(item.label, () => { source.value = item.id; for (const node of chips.children) node.setAttribute("aria-pressed", String(node === chip)); }, "amount-chip");
    chip.setAttribute("aria-pressed", String(index === 0)); chips.append(chip);
  }
  const sourceField = field("Funding source", source); sourceField.hidden = true;
  stage("Add money for Mama", [field("Amount in dollars", amount), chips, sourceField, sourceDetails, keypad(amount, ['10','25','50'])], "Preview quote", async () => {
    const quote = await api("funding-quote", { source: source.value, dollars: amount.value });
    const rows = el("dl", undefined, "review-rows");
    rows.append(el("dt", "Amount"), el("dd", dollars(quote.dollars)), el("dt", "Demo fee"), el("dd", "$0"), el("dt", "Mama receives"), el("dd", dollars(quote.dollars)));
    const detail = el("details"); detail.append(el("summary", "Details"), el("p", `${quote.mode} · ${quote.label}`));
    if (quote.output) detail.append(el("p", `1Click preview output: ${quote.output} wrapped NEAR`));
    stage("A little love, on its way", [rows, el("p", "This is a demo transfer. The quote is a dry run.", "muted"), detail], "Confirm demo transfer", async () => {
      wallet = await api("funding-confirm", { id: quote.id });
      finish(`${dollars(quote.dollars)} arrived in ${data.name}’s wallet`, "wallet-care");
      dialog.className = "result-screen result-allow";
    });
  });
}

function openPairing(replace) {
  stage(replace ? "Replace device" : `Invite ${wallet.name}`, [
    el("p", replace
      ? "Creating a new link disconnects the old phone immediately."
      : "Send a one-use link to Mama. It expires in 10 minutes."),
  ], replace ? "Disconnect and create link" : "Generate pairing link", async () => {
    if (testnet && replace && wallet.deviceAttached) {
      wallet = (await onChain("requester", { connect: false })).wallet;
    }
    const { link: url } = await api("invites", { replace });
    wallet = await api("wallet");
    render();
    const address = textInput(url, url.length);
    address.readOnly = true;
    address.addEventListener("focus", () => address.select());
    const status = el("p", undefined, "muted");
    status.setAttribute("role", "status");
    const actions = el("div", undefined, "actions");
    if (typeof navigator.share === "function") {
      actions.append(button("Share pairing link", async () => {
        try { await navigator.share({ title: "Mama Wallet invite", url }); }
        catch (error) {
          if (error.name !== "AbortError") status.textContent = "Use Copy pairing link to share the invite.";
        }
      }, "primary"));
    }
    actions.append(button("Copy pairing link", async () => {
      try {
        await navigator.clipboard.writeText(url);
        status.textContent = "Pairing link copied.";
      } catch { address.focus(); status.textContent = "Select and copy the link shown above."; }
    }));
    stage("Pairing link ready", [illustration("family-connect", "compact"), field("Elder pairing link", address), actions, status]);
    status.textContent = `Waiting for ${wallet.name} to connect…`;
    const waiting = setInterval(async () => {
      if (!dialog.open || !status.isConnected) { clearInterval(waiting); return; }
      try { const next = await api("wallet"); if (next.paired) { wallet = next; status.textContent = `${next.name} is connected`; status.prepend(avatar(next.name)); clearInterval(waiting); render(); } } catch { /* Keep the link available during a connection interruption. */ }
    }, 2500);
    dialog.addEventListener("close", () => clearInterval(waiting), { once: true });
  });
}

function openUnpair() {
  stage("Unpair device", [el("p", "Mama’s phone will lose access immediately. You can invite a new phone later.")],
    "Disconnect device", async () => {
      if (testnet && wallet.deviceAttached) wallet = (await onChain("requester", { connect: false })).wallet;
      wallet = await api("unpair", {});
      finish("Device disconnected");
    });
}

function openNewPayment() {
  const name = textInput("", 80, false);
  const payee = textInput("", 64);
  payee.minLength = 2;
  stage("Pay someone new", [field("Name (optional)", name), field("Recipient account ID", payee),
    button("Ask family to save a place", () => openFamilyRequest("payee"), "text-button")],
    "Continue to payment", () => {
      const id = payee.value.trim();
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) {
        throw new Error("Enter a valid lowercase recipient account ID");
      }
      openPayment({ id, label: name.value.trim() || id });
    });
}

function openFamilyRequest(type, initialMessage = "") {
  const newPayee = type === "payee";
  const id = crypto.randomUUID();
  const name = textInput("", 80);
  const payee = textInput("", 64);
  const message = el("textarea");
  message.value = initialMessage;
  message.maxLength = 512;
  message.rows = 3;
  const fields = newPayee
    ? [el("p", "Your family will check this first, then decide whether to save a shortcut."), field("Name of the place or person", name), field("Account ID", payee)]
    : [field("What do you need help with? (optional)", message)];
  stage(newPayee ? "Ask family to save a place" : "Ask my family", fields, "Send to family", async () => {
    const details = newPayee ? { payee: payee.value, label: name.value } : { message: message.value };
    wallet = await api("family-requests", { id, type, ...details });
    finish(newPayee ? "Your family will check this new place." : "Your family has your request.", "family-help");
  });
}

const limitFields = [
  ["dailyCap", "Daily limit"],
  ["perTxCeiling", "Per-payment limit"],
  ["approvalThreshold", "Ask me above"],
];

function rulesFields(rules) {
  const inputs = Object.fromEntries(limitFields.map(([key]) => [key, amountInput(rules[key])]));
  const list = el("div", undefined, "place-editor");
  const rows = [];
  function addPlace(place = {}) {
    const row = el("div", undefined, "place-edit-row");
    const label = textInput(place.label, 80);
    const id = textInput(place.id, 64);
    const entry = { row, label, id };
    const remove = button("Remove place", () => {
      const index = rows.indexOf(entry);
      rows.splice(index, 1);
      row.remove();
      (rows[index]?.label ?? rows.at(-1)?.label ?? add).focus();
    }, "text-button");
    if (place.label) remove.setAttribute("aria-label", `Remove place: ${place.label}`);
    row.append(field("Place name", label), field("Account ID", id), remove);
    rows.push(entry);
    list.append(row);
    return label;
  }
  const add = button("Add approved place", () => addPlace().focus());
  rules.places.forEach(addPlace);
  return {
    fields: [
      ...limitFields.map(([key, label]) => {
        const row = el("div", undefined, "rule-stepper");
        const minus = button("−", () => { inputs[key].value = String(Math.max(0, Number(inputs[key].value) - 1)); }); minus.setAttribute("aria-label", `Decrease ${label}`);
        const plus = button("+", () => { inputs[key].value = String(Number(inputs[key].value) + 1); }); plus.setAttribute("aria-label", `Increase ${label}`);
        row.append(minus, field(`${label} (${testnet ? testnetUnit() : "$"})`, inputs[key]), plus); return row;
      }),
      el("h3", "Approved places (optional)"),
      el("p", "Saved places are shortcuts. All payments follow the same limits.", "muted"),
      list, add,
    ],
    value: () => ({
      ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])),
      places: rows.map(({ id, label }) => ({ id: id.value, label: label.value })),
    }),
  };
}

function openRules(rules) {
  const editor = rulesFields(rules);
  stage("Edit protection rules", editor.fields, "Save rules", async () => {
    const values = { ...editor.value(), rulesVersion: rules.rulesVersion };
    wallet = testnet ? (await onChain("limits", values)).wallet : await api("rules", values);
    finish("Protection rules saved");
  });
}

function illustration(name, size = "") {
  const image = el("img", undefined, `story-art ${size}`);
  image.src = `/illustrations/${name}.webp`;
  image.alt = ""; // Decorative: adjacent headings and copy communicate the state.
  image.width = 960; image.height = 640;
  image.decoding = "async";
  return image;
}
function familyReadyArt() { return illustration("family-ready"); }
function welcomeArt() { return illustration("family-ready"); }

function onboardingView() {
  const page = el("section", undefined, "onboarding-flow");
  function welcome() {
    page.replaceChildren(welcomeArt(), el("p", "A little closer, wherever you are.", "eyebrow"),
      el("h1", "Send money home without handing it to scammers"),
      el("p", "Her everyday freedom. Your helping hand.", "muted"),
      button("Create family wallet", names, "primary"),
      button("Sign in to an existing family", () => { showSignIn = true; render(); }, "text-button"));
  }
  const child = textInput(); child.autocomplete = "given-name";
  const parent = textInput();
  const editor = rulesFields({ dailyCap: "10", perTxCeiling: "3", approvalThreshold: "1", places: [] });
  function progress(step) { const node = el("p", `Step ${step} of 2`, "progress-dots"); return node; }
  function names() {
    const setup = el("form", undefined, "setup-form");
    const submit = el("button", "Continue", "primary"); submit.type = "submit";
    setup.append(field("Your name", child), field("Parent’s name", parent), submit);
    setup.onsubmit = event => { event.preventDefault(); rules(); };
    page.replaceChildren(progress(1), el("h1", "Who are we looking out for?"), el("p", "Start with the names you use at home.", "muted"), setup, button("Back", welcome, "text-button"));
    child.focus();
  }
  function rules() {
    const setup = el("form", undefined, "setup-form");
    const presets = el("fieldset", undefined, "presets"); presets.append(el("legend", "Choose a starting point"));
    const custom = el("div", undefined, "custom-rules"); custom.append(...editor.fields); custom.hidden = true;
    custom.querySelectorAll("input,button").forEach(node => { node.disabled = true; });
    for (const [value, title, text] of [["careful", "Careful", `${parent.value} can spend up to $10 a day.`], ["balanced", "Balanced", `${parent.value} can spend up to $20 a day.`], ["custom", "Custom", "Set the amounts that work for your family."]]) {
      const radio = el("input"); Object.assign(radio, { type: "radio", name: "preset", value, checked: value === "careful" });
      const label = el("label", undefined, "preset"); const copy = el("span"); copy.append(el("strong", title), el("span", text, "muted")); label.append(radio, copy);
      radio.addEventListener("change", () => { custom.hidden = value !== "custom"; custom.querySelectorAll("input,button").forEach(node => { node.disabled = custom.hidden; }); }); presets.append(label);
    }
    const submit = el("button", "Create family wallet", "primary"); submit.type = "submit";
    const error = el("p", undefined, "form-error"); error.hidden = true; error.setAttribute("role", "alert");
    setup.append(presets, custom, error, submit);
    setup.onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      const preset = new FormData(setup).get("preset");
      const values = preset === "custom" ? editor.value() : { dailyCap: preset === "careful" ? "10" : "20", perTxCeiling: preset === "careful" ? "3" : "5", approvalThreshold: preset === "careful" ? "1" : "2", places: [] };
      busy = true; submit.disabled = true; submit.textContent = "Creating your wallet…";
      try {
        const device = testnet ? await chain.newDevice(familySetupKey()) : {};
        wallet = await api("onboarding", { childName: child.value, parentName: parent.value, ...values, ...device });
        if (testnet) await chain.rememberDevice(familySetupKey(), wallet.address);
        await checkFamilyKey(); history.replaceState(null, "", "/family"); render();
        const address = el("details"); address.append(el("summary", "Details"), el("p", wallet.address, "message"), button("Copy wallet address", () => copy(wallet.address, "Wallet address copied.")));
        stage("Your family wallet is ready", [familyReadyArt(), el("p", "A little independence for Mama. A helping hand from you."), el("p", testnet ? "Test wallet" : "Demo wallet", "muted"), address], `Invite ${wallet.name}`, () => openPairing(false));
      } catch (problem) { error.textContent = problem.message; error.hidden = false; }
      finally { busy = false; submit.disabled = false; submit.textContent = "Create family wallet"; }
    };
    page.replaceChildren(progress(2), el("h1", "Freedom, with a safety net"), el("p", "You can change these amounts any time.", "muted"), setup, button("Back", names, "text-button"));
    page.querySelector('h1').tabIndex = -1; page.querySelector('h1').focus();
  }
  welcome(); return page;
}

function signInView() {
  const view = el("section", undefined, "panel onboarding");
  view.append(el("h1", "Sign in to Family"));
  const login = el("form");
  const code = textInput("", 64);
  code.type = "password";
  const submit = el("button", "Sign in", "primary");
  submit.type = "submit";
  login.append(field("Family sign-in code", code), submit);
  login.addEventListener("submit", event => {
    event.preventDefault();
    void update(async () => {
      wallet = await api("family-sign-in", { code: code.value });
      await checkFamilyKey();
      const review = new URLSearchParams(location.hash.slice(1)).get("review");
      history.replaceState(null, "", review ? `/family#review=${encodeURIComponent(review)}` : "/family");
      notify("Signed in to Family.", true);
      if (review) { render(); focusReview(); }
    });
  });
  view.append(login, button("Set up a family wallet", () => { showSignIn = false; render(); }, "text-button"));
  return view;
}

function openSignInCode(replace) {
  stage(replace ? "Replace Family sign-in code" : "Create Family sign-in code", [
    el("p", replace ? "Creating a new code invalidates the previous code." : "Save the code in your password manager. Anyone with it can sign in as Family."),
  ], "Generate code", async () => {
    const { code } = await api("family-sign-in-code", {});
    wallet = { ...wallet, hasSignIn: true };
    render();
    const input = textInput(code, 64);
    input.readOnly = true;
    dialog.addEventListener("close", () => { input.value = ""; }, { once: true });
    stage("Save your Family sign-in code", [
      el("p", "Copy this code somewhere safe. Ward only shows it once."),
      field("Family sign-in code", input),
      button("Copy code", async () => {
        input.select();
        try { await navigator.clipboard.writeText(code); } catch { input.focus(); }
      }),
    ]);
  });
}

function inviteView({ childName, code }) {
  const panel = el("section", undefined, "panel onboarding");
  panel.classList.add("pairing-landing");
  const cards = el("div", undefined, "explain-cards"); cards.tabIndex = 0; cards.setAttribute("aria-label", "How your wallet works. Scroll for three explanations.");
  for (const [symbol, title, copy] of [["wallet", "Your everyday money", "See what you have and pay people you know."], ["shield", "A helping hand", "Your family sets spending limits and checks payments that need a second look."], ["help", "You can always ask", "Ask for help here. Your family sees your message in their wallet."]]) {
    const card = el("article"); card.append(icon(symbol), el("h2", title), el("p", copy)); cards.append(card);
  }
  panel.append(shield(childName), illustration("family-connect"), el("h1", `${childName} invited you to your protected wallet`), cards,
    el("p", "Set up this phone to see your balance and make payments."),
    button("Set up my wallet", () => update(async () => {
      const device = testnet ? await chain.newDevice(code, true) : {};
      wallet = await api("pair", { code, ...device });
      if (testnet) await chain.rememberDevice(code, wallet.address);
      invitation = undefined;
      history.replaceState(null, "", "/elder");
      notify(testnet ? "Ask your family to approve this phone." : "Your wallet is ready.", true);
    }), "primary"));
  return panel;
}

dialog.addEventListener("cancel", event => { if (dialogBusy) event.preventDefault(); });
dialog.addEventListener("close", () => {
  if (dialogTrigger && !dialog.open && document.activeElement === document.body) screen.querySelector(`[data-focus="${CSS.escape(dialogTrigger)}"]`)?.focus();
});

function setBigger(enabled) {
  document.body.classList.toggle("bigger-text", enabled);
  bigger.setAttribute("aria-pressed", String(enabled));
}
try { setBigger(localStorage.getItem("mama-bigger-text") === "true"); } catch { setBigger(false); }
bigger.addEventListener("click", () => {
  const enabled = bigger.getAttribute("aria-pressed") !== "true";
  setBigger(enabled);
  try { localStorage.setItem("mama-bigger-text", String(enabled)); } catch { /* Use this page’s preference. */ }
});

function focusReview() {
  const id = new URLSearchParams(location.hash.slice(1)).get("review");
  if (!id || wallet?.role !== "family") return;
  const row = wallet.pending.find(item => String(item.id) === id);
  stage("Review payment", row ? [inboxPanel({ ...wallet, pending: [row], requests: [], blockedAlerts: [] }, true)]
    : [el("p", "This payment is no longer waiting for approval.")]);
  dialog.dataset.approval = "true";
}
window.addEventListener("popstate", () => {
  if (dialog.dataset.approval) dialog.close();
  if (wallet && !dialog.open) { render(); focusReview(); }
});
window.addEventListener("hashchange", () => {
  if (wallet && !dialog.open) {
    render();
    focusReview();
  }
});

async function start() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const pair = hash.get("pair");
  try {
    const mode = await api("mode");
    testnet = mode.mode === "testnet";
    usdc = mode.asset === "usdc";
    registrationCost = mode.registrationCost;
    if (testnet) chain = await import("./testnet.js");
  } catch {
    screen.setAttribute("aria-busy", "false");
    screen.replaceChildren(el("h1", "Wallet connection unavailable"),
      button("Try again", () => location.reload(), "primary"));
    return;
  }
  try {
    if (pair) {
      invitation = { ...await api("invite-preview", { code: pair }), code: pair };
    } else {
      wallet = await api("wallet");
      await checkFamilyKey();
    }
  } catch (error) {
    if (pair || error.status !== 401) notify(error.message);
  }
  render();
  focusReview();
}

setInterval(async () => {
  if (!wallet || busy || dialog.open || document.visibilityState === "hidden") return;
  const previous = wallet;
  try {
    const next = await api("wallet");
    if (!busy && !dialog.open && wallet === previous && JSON.stringify(next) !== JSON.stringify(previous)) {
      wallet = next;
      if (next.role === "elder") {
        const resolved = next.payments.find(row => row.decision !== "HOLD" &&
          previous.payments.some(old => old.id === row.id && old.decision === "HOLD"));
        if (resolved) notify(outcomeText[resolved.decision]);
      }
      if (next.role === "family" && next.blockedAlerts.some(alert =>
        !previous.blockedAlerts.some(old => old.alertId === alert.alertId))) {
        notify("A payment was stopped. Check Needs you.");
      }
      render();
    }
  } catch (error) {
    if (error.status === 401 && wallet === previous && !busy && !dialog.open) {
      disconnected = previous.role === "elder";
      showSignIn = previous.role === "family" && previous.hasSignIn;
      wallet = undefined;
      notify(disconnected ? "This phone is no longer connected." : "Your family session expired.");
      render();
    }
  }
}, 2500);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Service worker unavailable", error));
}
function connectionState() {
  document.querySelector("#offline")?.remove();
  if (!navigator.onLine) {
    const banner = el("p", "You’re offline. Connect to the internet to make payments or see updates.", "offline-banner"); banner.id = "offline"; banner.setAttribute("role", "status"); document.querySelector(".topbar").after(banner);
  }
}
window.addEventListener("online", connectionState); window.addEventListener("offline", connectionState); connectionState();
export { start };
