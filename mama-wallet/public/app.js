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

const dollars = value => `$${value}`;
const panel = (title, className = "") => {
  const section = el("section", undefined, `panel ${className}`);
  section.append(el("h2", title));
  return section;
};

function receipts(data) {
  if (!data.receipts.length) return null;
  const list = panel("Money arrived", "receipts");
  for (const row of data.receipts.slice(0, 4)) {
    list.append(el("p", `${row.sender} sent ${dollars(row.amount)} · arrived`, "receipt"));
  }
  return list;
}

const paymentStatuses = { ALLOW: "Sent ✓", HOLD: "Waiting for family", BLOCK: "Stopped" };
const outcomeText = {
  ALLOW: "Sent ✓",
  HOLD: "Waiting for your family to say yes. We’ll tell you here.",
  BLOCK: "Stopped to keep you safe. Your family has been told.",
};

function elderView(data) {
  const body = el("div", undefined, "elder");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  body.append(el("h1", `${greeting}, ${data.name}`));
  const balance = el("section", undefined, "balance elder-balance");
  balance.append(
    el("p", data.frozen ? "Payments paused by your family" : "Protected by your family", "protection"),
    el("h2", `You have ${dollars(data.balance)}`, "balance-number"),
    el("p", `Left to spend today: ${dollars(data.leftToday)}`, "spending-left"),
  );
  body.append(balance);

  const places = panel("Approved places", "places");
  const grid = el("div", undefined, "payees");
  for (const payee of data.payees) {
    const choose = button(payee.label, () => openPayment(payee), "payee", payee.id);
    const initial = el("span", payee.label[0].toUpperCase(), "initial");
    initial.setAttribute("aria-hidden", "true");
    const arrow = el("span", "→", "arrow");
    arrow.setAttribute("aria-hidden", "true");
    choose.replaceChildren(initial, el("span", payee.label), arrow);
    grid.append(choose);
  }
  if (!data.payees.length) grid.append(el("p", "Your family hasn’t saved any places yet. You can still pay someone new."));
  places.append(grid);
  body.append(places);
  const support = el("div", undefined, "support");
  support.append(
    button("Pay someone new", openNewPayment),
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
        [paymentStatuses[row.decision], row.amount && dollars(row.amount)].filter(Boolean).join(" · ")));
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
  const total = data.pending.length + data.requests.length;
  const inbox = panel(`Needs you${total ? ` · ${total}` : ""}`, "inbox");
  if (!total) inbox.append(el("p", "You’re all caught up. Requests from Mama will appear here.", "muted"));
  const reviewId = new URLSearchParams(location.hash.slice(1)).get("review");
  for (const row of data.pending) {
    const item = el("article", undefined, "request");
    if (row.id === reviewId) {
      item.classList.add("selected");
      item.tabIndex = -1;
    }
    item.append(el("h3", `${row.payee ?? "Payment"} · ${dollars(row.amount)}`), el("p", row.reason));
    if (row.signals.length) item.append(el("p", `Message signals: ${row.signals.join(", ")}`, "muted"));
    const approval = `${location.origin}/family#review=${encodeURIComponent(row.id)}`;
    const actions = el("div", undefined, "actions");
    for (const [label, approve] of [["Approve", true], ["Reject", false]]) {
      actions.append(button(label, () => update(async () => {
        const result = await api("review", { id: row.id, approve });
        wallet = result.wallet;
        notify(`${result.result.reason}.`, true);
      }), approve ? "primary" : "outline", `${row.id}-${label}`));
    }
    item.append(actions, link("Open approval link", approval),
      button("Copy approval link", () => copy(approval, "Approval link copied."), "text-button", `${row.id}-copy`));
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
    wallet = await api("freeze", { frozen: !data.frozen });
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
  const hero = el("section", undefined, "balance family-balance");
  const title = el("div");
  title.append(el("p", data.frozen ? "Wallet frozen" : "Family protection is on", "protection"),
    el("h1", `${data.name}’s wallet`), el("p", dollars(data.balance), "balance-number"),
    el("p", "USDC · demo balance", "spending-left"),
    el("p", `Demo wallet · ${data.address}`, "demo-address"));
  hero.append(title, button("Send money", () => openFunding(data), "primary"));
  body.append(hero);
  const work = el("div", undefined, "family-grid");
  const inbox = inboxPanel(data);
  work.append(inbox, rulesPanel(data), summaryPanel(data), auditPanel(data));
  body.append(work);
  const setup = panel(`Invite ${data.name}`, "setup");
  const connection = el("p", data.paired ? `${data.name} is connected` : `${data.name} is waiting for an invite`, "connection");
  connection.setAttribute("role", "status");
  setup.append(connection);
  if (!data.paired || !data.receipts.length || !data.rules.rulesVersion) {
    const list = el("ol", undefined, "checklist");
    for (const [index, label, done] of [
      [1, "Send money", data.receipts.length > 0],
      [2, "Set rules", data.rules.rulesVersion > 0],
      [3, `Pair ${data.name}’s phone`, data.paired],
    ]) {
      list.append(el("li", `${done ? "✓" : index}  ${label}`, done ? "complete" : ""));
    }
    setup.append(list);
  }
  const devices = el("div", undefined, "actions device-actions");
  if (data.paired) {
    devices.append(button("Replace device", () => openPairing(true)),
      button("Unpair device", () => openUnpair(), "text-button"));
  } else {
    devices.append(button("Create pairing link", () => openPairing(false)));
  }
  setup.append(devices);
  if (!data.pending.length && !data.requests.length) work.before(setup);
  else work.after(setup);
  const money = receipts(data);
  if (money) setup.after(money);
  return body;
}

function render() {
  const focused = screen.contains(document.activeElement) ? document.activeElement.dataset.focus : undefined;
  screen.setAttribute("aria-busy", "false");
  const elder = wallet?.role === "elder" || (!wallet && (location.pathname === "/elder" || disconnected));
  document.body.classList.toggle("elder-mode", elder);
  bigger.hidden = wallet?.role !== "elder";
  roleLabel.hidden = elder;
  roleLabel.textContent = wallet ? "Family view" : "Demo wallet";
  if (!wallet) {
    if (invitation) screen.replaceChildren(inviteView(invitation));
    else if (elder) {
      const welcome = el("section", undefined, "panel");
      welcome.append(el("h1", "Connect your wallet"), el("p", "Ask your family to send you a new pairing link."));
      screen.replaceChildren(welcome);
    } else screen.replaceChildren(onboardingView());
    return;
  }
  screen.replaceChildren(elder ? elderView(wallet) : familyView(wallet));
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
  stage(`Pay ${payee.label}`, [field("Amount in dollars", amount), question], "Review payment", async () => {
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
        const { result, wallet: refreshed } = await api("payments", payment);
        wallet = refreshed;
        finish(outcomeText[result.decision]);
      });
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
      ...limitFields.map(([key, label]) => field(`${label} ($)`, inputs[key])),
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
    wallet = await api("rules", { ...editor.value(), rulesVersion: rules.rulesVersion });
    finish("Protection rules saved");
  });
}

function onboardingView() {
  const panel = el("section", undefined, "panel onboarding");
  panel.append(el("h1", "Set up a family wallet"),
    el("p", "Send money home without handing it to scammers. Try it together with a demo wallet."));
  const setup = el("form");
  const child = textInput();
  const parent = textInput();
  const editor = rulesFields({ dailyCap: "10", perTxCeiling: "3", approvalThreshold: "1", places: [] });
  const submit = el("button", "Create family wallet", "primary");
  submit.type = "submit";
  setup.append(field("Your name", child), field("Parent’s name", parent), el("h2", "Starting rules"), ...editor.fields, submit);
  setup.addEventListener("submit", event => {
    event.preventDefault();
    void update(async () => {
      wallet = await api("onboarding", { childName: child.value, parentName: parent.value, ...editor.value() });
      history.replaceState(null, "", "/family");
      notify("Demo wallet created.", true);
    });
  });
  panel.append(setup);
  return panel;
}

function inviteView({ childName, code }) {
  const panel = el("section", undefined, "panel onboarding");
  panel.append(el("h1", `${childName} invited you to your protected wallet`),
    el("p", "Set up this phone to see your balance and make payments."),
    button("Set up my wallet", () => update(async () => {
      wallet = await api("pair", { code });
      invitation = undefined;
      history.replaceState(null, "", "/elder");
      notify("Your wallet is ready.", true);
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
    if (pair) {
      invitation = { ...await api("invite-preview", { code: pair }), code: pair };
    } else {
      wallet = await api("wallet");
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
      render();
    }
  } catch (error) {
    if (error.status === 401 && wallet === previous && !busy && !dialog.open) {
      disconnected = previous.role === "elder";
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
