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

function el(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function button(label, action, className = "outline", key = label) {
  const element = el("button", label, className);
  element.type = "button";
  element.dataset.focus = key;
  element.addEventListener("click", action);
  return element;
}

function link(label, href) {
  const element = el("a", label, "text-link");
  element.href = href;
  return element;
}

async function api(path, data) {
  const response = await fetch(`/api/${path}`, data === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function notify(message, focus = false) {
  notice.hidden = false;
  notice.textContent = message;
  if (focus) notice.focus();
}

const dollars = value => {
  if (!testnet) return `$${value}`;
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

function elderView(data) {
  const body = el("div", undefined, "elder");
  body.append(el("h1", "Your wallet"));
  const balance = el("section", undefined, `balance elder-balance${data.frozen ? " paused" : ""}`);
  const available = el("div");
  available.append(el("h2", "Available balance", "balance-label"),
    el("p", dollars(data.balance), "balance-number"));
  const daily = el("dl", undefined, "daily-amount");
  daily.append(el("dt", "Left to spend today"), el("dd", dollars(data.leftToday)));
  balance.append(
    el("p", data.frozen ? "Payments paused by your family" : "Protected by your family", "protection"),
    available,
    daily,
  );
  body.append(balance);
  if (testnet && !data.deviceReady) {
    const setup = panel("Connect this phone");
    setup.append(el("p", data.requesterEnabled ? "Your family approved this device. Finish connecting to make payments."
      : "Ask your family to approve this device in their wallet."));
    if (data.requesterEnabled) setup.append(button("Finish connecting", () => update(async () => {
      wallet = (await onChain("scope")).wallet;
      notify("Your device is connected.", true);
    }), "primary"));
    body.append(setup);
  }

  const places = panel("Approved places", "places");
  const grid = el("div", undefined, "payees");
  for (const payee of data.payees) {
    const choose = button(payee.label, () => openPayment(payee), "payee", payee.id);
    const initial = el("span", payee.label[0].toUpperCase(), "initial");
    initial.setAttribute("aria-hidden", "true");
    const arrow = el("span", "→", "arrow");
    arrow.setAttribute("aria-hidden", "true");
    choose.disabled = testnet && !data.deviceReady;
    choose.replaceChildren(initial, el("span", payee.label), arrow);
    grid.append(choose);
  }
  if (!data.payees.length) grid.append(el("p", "Your family hasn’t saved any places yet. You can still pay someone new."));
  places.append(grid);
  body.append(places);
  const support = el("div", undefined, "support");
  const newPayment = button("Pay someone new", openNewPayment);
  newPayment.disabled = testnet && !data.deviceReady;
  support.append(
    newPayment,
    button("Ask my family", () => openFamilyRequest("help"), "help-button"),
  );
  body.append(support);

  const money = receipts(data);
  if (money) body.append(money);
  if (data.payments.length || data.requests.length) {
    const activity = panel("Your updates", "elder-activity");
    for (const row of data.payments.slice(0, 8)) {
      const item = el("p", undefined, "list-row");
      item.append(el("strong", row.payee ?? "Payment"), el("span",
        [paymentStatuses[row.decision], row.amount && dollars(row.amount),
          row.seenByFamily && "Seen by family"].filter(Boolean).join(" · ")));
      activity.append(item);
    }
    for (const row of data.requests.slice(0, 4)) {
      const message = row.type === "help"
        ? row.status === "seen" ? "Your family saw your message." : "Your family has your help request."
        : `${row.label} · ${{ pending: "Waiting for family", approved: "Your family saved this place", rejected: "Your family didn’t save this place" }[row.status]}`;
      activity.append(el("p", message, "list-row"));
    }
    body.append(activity);
  }
  return body;
}

async function copy(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    notify(message);
  } catch {
    notify("Select and copy the link shown on screen.");
  }
}

function inboxPanel(data) {
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
    if (row.id === reviewId) {
      item.classList.add("selected");
      item.tabIndex = -1;
    }
    const heading = el("h3", undefined, "request-heading");
    heading.append(el("span", row.payee ?? "Payment"), el("span", dollars(row.amount), "request-amount"));
    item.append(heading, el("p", row.reason));
    if (row.signals.length) item.append(el("p", `Message signals: ${row.signals.join(", ")}`, "muted"));
    const approval = `${location.origin}/family#review=${encodeURIComponent(row.id)}`;
    const actions = el("div", undefined, "actions");
    for (const [label, approve] of [["Approve", true], ["Reject", false]]) {
      actions.append(button(label, () => update(async () => {
        const result = testnet ? await onChain("review", { requestId: row.id, approve }) : await api("review", { id: row.id, approve });
        wallet = result.wallet;
        notify(`${result.result.reason}.`, true);
      }), approve ? "primary" : "outline", `${row.id}-${label}`));
    }
    const links = el("div", undefined, "review-links");
    links.append(link("Open approval link", approval),
      button("Copy approval link", () => copy(approval, "Approval link copied."), "text-button", `${row.id}-copy`));
    item.append(actions, links);
    inbox.append(item);
  }
  if (reviewId && !data.pending.some(row => row.id === reviewId)) {
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

function rulesPanel(data) {
  const rules = panel("Protection rules", "rules");
  const list = el("dl", undefined, "limits");
  for (const [key, label] of limitFields) {
    list.append(el("dt", label), el("dd", dollars(data.rules[key])));
  }
  const places = el("ul", undefined, "approved-list");
  for (const place of data.rules.places) places.append(el("li", place.label));
  rules.append(list, el("h3", "Approved places"), places,
    button("Edit protection rules", () => openRules(data.rules)));
  rules.append(button(data.frozen ? "Unfreeze wallet" : "Freeze wallet", () => update(async () => {
    wallet = testnet ? (await onChain("freeze", { frozen: !data.frozen })).wallet : await api("freeze", { frozen: !data.frozen });
    notify(wallet.frozen ? "Wallet frozen. All payments are paused." : "Wallet unfrozen. Payments can resume.", true);
  }), "text-button", "freeze"));
  return rules;
}

function summaryPanel(data) {
  const summary = panel("Protection summary", "summary");
  summary.append(el("p", "Last 24 hours", "muted"));
  const metrics = el("dl", undefined, "metrics");
  for (const decision of ["ALLOW", "HOLD", "BLOCK"]) {
    const metric = el("div");
    metric.append(el("dt", { ALLOW: "Allowed", HOLD: "Held", BLOCK: "Blocked" }[decision]),
      el("dd", String(data.summary.counts[decision])));
    metrics.append(metric);
  }
  summary.append(metrics, el("h3", "What we stopped"));
  if (!data.summary.stopped.length) summary.append(el("p", "No payments were stopped.", "muted"));
  for (const row of data.summary.stopped.slice(0, 6)) summary.append(el("p", row.reason, "stopped"));
  return summary;
}

function auditPanel(data) {
  const audit = panel("Activity", "activity");
  if (!data.audit.length) audit.append(el("p", "Wallet decisions and protection changes will appear here.", "muted"));
  let day;
  for (const row of data.audit.slice(0, 40)) {
    const date = new Date(row.timestamp).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    if (date !== day) {
      audit.append(el("h3", date, "activity-day"));
      day = date;
    }
    const item = el("article", undefined, "audit-row");
    if (row.decision) item.append(el("strong",
      [paymentStatuses[row.decision], row.payee, row.amount && dollars(row.amount)].filter(Boolean).join(" · ")));
    item.append(el("p", row.reason), el("small", row.ruleId, "muted"));
    audit.append(item);
  }
  return audit;
}

function familyView(data) {
  const body = el("div", undefined, "family");
  body.append(el("h1", `${data.name}’s wallet`));
  const hero = el("section", undefined, `balance family-balance${data.frozen ? " paused" : ""}`);
  const title = el("div");
  title.append(el("h2", "Available balance", "balance-label"), el("p", dollars(data.balance), "balance-number"),
    el("p", testnet ? (usdc ? "USDC · NEAR testnet" : "Native NEAR · testnet") : "USDC · demo balance", "balance-meta"),
    el("p", `${testnet ? "Testnet vault" : "Demo wallet"} · ${data.address}`, "demo-address"));
  const funding = el("div", undefined, "actions");
  funding.append(button(testnet ? "Add money for Mama" : "Send money",
    () => testnet ? openTestnetDeposit() : openFunding(data), "primary"));
  if (testnet) funding.append(button("Withdraw to my account", () => openTestnetFunding("withdraw")));
  hero.append(el("p", data.frozen ? "Payments paused" : "Family protection is on", "protection"), title, funding);
  body.append(hero);
  if (testnet && !familyCanSign) {
    body.append(el("p", "You can view this wallet here. Use the original Family browser to sign testnet transactions.", "muted"));
  }
  const work = el("div", undefined, "family-grid");
  const inbox = inboxPanel(data);
  work.append(inbox, rulesPanel(data), summaryPanel(data), auditPanel(data));
  body.append(work);
  const setup = panel(`Invite ${data.name}`, "setup");
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
  if (!data.pending.length && !data.requests.length && !data.blockedAlerts.length) work.before(setup);
  else work.after(setup);
  const money = receipts(data);
  if (money) setup.after(money);
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
  const elder = wallet?.role === "elder" || (!wallet && (location.pathname === "/elder" || disconnected));
  document.body.classList.toggle("elder-mode", elder);
  bigger.hidden = wallet?.role !== "elder";
  roleLabel.hidden = elder;
  roleLabel.textContent = testnet ? "NEAR testnet" : wallet ? "Family view" : "Demo wallet";
  if (testnet) document.querySelector("footer").textContent = `NEAR testnet · Payments use ${testnetUnit()}`;
  document.querySelector(".wallet-nav")?.remove();
  if (!wallet) {
    if (invitation) screen.replaceChildren(inviteView(invitation));
    else if (elder) {
      const welcome = el("section", undefined, "panel");
      welcome.append(el("h1", "Connect your wallet"), el("p", "Ask your family to send you a new pairing link."));
      screen.replaceChildren(welcome);
    } else screen.replaceChildren(showSignIn ? signInView() : onboardingView());
    return;
  }
  screen.replaceChildren(elder ? elderView(wallet) : familyView(wallet));
  const navigation = el("nav", undefined, "wallet-nav");
  navigation.setAttribute("aria-label", "Wallet sections");
  const destinations = elder
    ? [["Wallet", ".balance", "M4 7h16v12H4z M4 7V5h12 M15 11h5v4h-5z"],
      ["Pay", ".places", "M12 20V4 M6 10l6-6 6 6"],
      ["Updates", ".elder-activity, .receipts", "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5"]]
    : [["Wallet", ".balance", "M4 7h16v12H4z M4 7V5h12 M15 11h5v4h-5z"],
      ["Activity", ".activity", "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5"],
      ["Family", ".setup", "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M2 20v-2a6 6 0 0 1 12 0v2 M16 5a3 3 0 0 1 0 6 M17 14a5 5 0 0 1 5 5v1"]];
  for (const [label, selector, path] of destinations) {
    const target = screen.querySelector(selector);
    if (!target) continue;
    target.id = `section-${label.toLowerCase()}`;
    const anchor = el("a");
    anchor.href = `#${target.id}`;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const drawing = document.createElementNS(icon.namespaceURI, "path");
    drawing.setAttribute("d", path);
    icon.append(drawing);
    anchor.append(icon, el("span", label));
    navigation.append(anchor);
  }
  document.body.append(navigation);
  if (focused) screen.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}

async function update(work) {
  if (busy) return;
  busy = true;
  try {
    await work();
    render();
  } catch (error) {
    notify(error.message, true);
  } finally {
    busy = false;
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
  const heading = el("h2", title);
  heading.id = "dialog-title";
  heading.tabIndex = -1;
  const error = el("p", undefined, "form-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const actions = el("div", undefined, "actions");
  const cancel = button(action ? "Cancel" : "Done", () => dialog.close(), action ? "outline" : "primary");
  const submit = el("button", actionLabel, "primary");
  submit.type = "submit";
  if (action) actions.append(submit);
  actions.append(cancel);
  form.replaceChildren(heading, ...fields, error, actions);
  form.onsubmit = async event => {
    event.preventDefault();
    if (!action || dialogBusy) return;
    dialogBusy = true;
    submit.disabled = cancel.disabled = true;
    error.hidden = true;
    try {
      await action();
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    } finally {
      dialogBusy = false;
      submit.disabled = cancel.disabled = false;
    }
  };
  if (!dialog.open) {
    dialogTrigger = document.activeElement.dataset.focus;
    dialog.showModal();
  }
  heading.focus();
}

function finish(message) {
  render();
  stage(message, []);
}

function openPayment(payee) {
  const payment = { id: crypto.randomUUID(), payee: payee.id };
  const amount = amountInput();
  const question = el("fieldset");
  question.append(el("legend", "Did someone ask you to send this?"));
  const options = el("div", undefined, "options");
  const extra = el("textarea");
  extra.maxLength = 512;
  extra.rows = 2;
  const more = field("What did they say?", extra);
  more.hidden = true;
  for (const [value, label] of [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]]) {
    const input = el("input");
    Object.assign(input, { name: "asked", value, type: "radio", required: true });
    const option = field(label, input);
    option.prepend(input);
    input.addEventListener("change", () => { more.hidden = value === "no"; });
    options.append(option);
  }
  question.append(options, more);
  stage(`Pay ${payee.label}`, [field(testnet ? `Amount in ${testnetUnit()}` : "Amount in dollars", amount), question], "Review payment", async () => {
    payment.dollars = amount.value;
    payment.asked = new FormData(form).get("asked");
    payment.memo = payment.asked === "no" ? "" : extra.value;
    const { checks } = await api("payment-preview", { payee: payment.payee, dollars: payment.dollars });
    const details = el("div", undefined, "payment-checks");
    details.append(el("strong", "Ward checked"));
    const list = el("ul");
    const visible = ["recipient", "payee_allowlist", "daily_cap", "per_tx_ceiling", "vault_balance", "wallet_frozen"];
    for (const item of checks.filter(check => visible.includes(check.ruleId))) {
      const failed = {
        payee_allowlist: "This place needs family approval",
        daily_cap: "Above what you can spend today",
        per_tx_ceiling: "Above your limit for one payment",
        vault_balance: "There isn’t enough money in your wallet",
        wallet_frozen: "Your family paused payments",
      };
      list.append(el("li", item.passed ? `✓ ${item.label}` : failed[item.ruleId]));
    }
    details.append(list);
    stage("Confirm payment", [el("p", `Send ${dollars(payment.dollars)} to ${payee.label}?`), details],
      "Confirm payment", async () => {
        const { result, wallet: refreshed } = testnet ? await onChain("pay", payment) : await api("payments", payment);
        wallet = refreshed;
        if (result.decision === "BLOCK") {
          render();
          stage(outcomeText.BLOCK, [
            el("p", result.reason),
            el("p", "Your family can mark this payment as read in Needs you."),
          ]);
        } else {
          finish(outcomeText[result.decision]);
        }
      });
  });
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
  for (const item of data.sources) {
    const option = el("option", item.label);
    option.value = item.id;
    source.append(option);
  }
  const amount = amountInput();
  const demo = "Demo: no real money moves. Quote is a dry run.";
  stage("Send money", [field("Source asset and chain", source), field("Amount in dollars", amount),
    el("p", demo, "muted")], "Preview quote", async () => {
    const quote = await api("funding-quote", { source: source.value, dollars: amount.value });
    const fields = [el("p", `${quote.mode} · ${quote.label}`), el("p", `${data.name} receives ${dollars(quote.dollars)} in the demo.`)];
    if (quote.output) fields.push(el("p", `1Click preview output: ${quote.output} wrapped NEAR`));
    fields.push(el("p", demo, "muted"));
    stage("Review transfer", fields, "Confirm demo transfer", async () => {
      wallet = await api("funding-confirm", { id: quote.id });
      finish(`${dollars(quote.dollars)} arrived in ${data.name}’s wallet`);
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
    stage("Pairing link ready", [field("Elder pairing link", address), actions, status]);
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
  const payee = textInput("", 64);
  payee.minLength = 2;
  stage("Pay someone new", [field("Recipient account ID", payee),
    button("Ask family to save a place", () => openFamilyRequest("payee"), "text-button")],
    "Continue to payment", () => {
      const id = payee.value.trim();
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) {
        throw new Error("Enter a valid lowercase recipient account ID");
      }
      openPayment({ id, label: id });
    });
}

function openFamilyRequest(type) {
  const newPayee = type === "payee";
  const id = crypto.randomUUID();
  const name = textInput("", 80);
  const payee = textInput("", 64);
  const message = el("textarea");
  message.maxLength = 512;
  message.rows = 3;
  const fields = newPayee
    ? [el("p", "Ask your family to add a shortcut for this place."), field("Name of the place or person", name), field("Account ID", payee)]
    : [field("What do you need help with? (optional)", message)];
  stage(newPayee ? "Ask family to save a place" : "Ask my family", fields, "Send to family", async () => {
    const details = newPayee ? { payee: payee.value, label: name.value } : { message: message.value };
    wallet = await api("family-requests", { id, type, ...details });
    finish(newPayee ? "Your family will check this new place." : "Your family has your request.");
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
    if (place.label) remove.setAttribute("aria-label", `Remove ${place.label}`);
    row.append(field("Place name", label), field("Account ID", id), remove);
    rows.push(entry);
    list.append(row);
    return label;
  }
  const add = button("Add approved place", () => addPlace().focus());
  rules.places.forEach(addPlace);
  return {
    fields: [
      ...limitFields.map(([key, label]) => field(`${label} (${testnet ? testnetUnit() : "$"})`, inputs[key])),
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

function onboardingView() {
  const page = el("div", undefined, "onboarding-layout");
  const intro = el("div", undefined, "onboarding-intro");
  intro.append(el("h1", "Set up a family wallet"),
    el("p", testnet ? `Set up a family vault for ${testnetUnit()} on NEAR testnet.`
      : "Send money home, set spending limits, and review payments that need your approval."));
  const setup = el("form", undefined, "panel setup-form");
  const child = textInput();
  const parent = textInput();
  const editor = rulesFields({ dailyCap: "10", perTxCeiling: "3", approvalThreshold: "1", places: [] });
  const submit = el("button", "Create family wallet", "primary");
  submit.type = "submit";
  const names = el("div", undefined, "setup-names");
  names.append(field("Your name", child), field("Parent’s name", parent));
  setup.append(el("h2", "Family details"), names, el("h2", "Starting rules"), ...editor.fields, submit);
  setup.addEventListener("submit", event => {
    event.preventDefault();
    void update(async () => {
      const device = testnet ? await chain.newDevice(familySetupKey()) : {};
      wallet = await api("onboarding", { childName: child.value, parentName: parent.value, ...editor.value(), ...device });
      if (testnet) await chain.rememberDevice(familySetupKey(), wallet.address);
      await checkFamilyKey();
      history.replaceState(null, "", "/family");
      notify(testnet ? "Testnet wallet created." : "Demo wallet created.", true);
    });
  });
  intro.append(button("Sign in to an existing family", () => { showSignIn = true; render(); }, "text-button"));
  page.append(intro, setup);
  return page;
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
      history.replaceState(null, "", "/family");
      notify("Signed in to Family.", true);
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
  panel.append(el("h1", `${childName} invited you to your protected wallet`),
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
  screen.querySelector(".request.selected")?.focus();
}
window.addEventListener("hashchange", () => {
  if (wallet?.role === "family" && !dialog.open) {
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
await start();
