const screen = document.querySelector("#screen");
const notice = document.querySelector("#notice");
const dialog = document.querySelector("#payment-dialog");
const form = document.querySelector("#payment-form");
const input = document.querySelector("#amount");
const paymentNext = document.querySelector("#payment-next");
const paymentError = document.querySelector("#payment-error");
let wallet;
let payment;
let invite;
let busy = false;
let fundingId;

function el(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function button(label, action, className) {
  const element = el("button", label, className);
  element.type = "button";
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
  if (!response.ok) throw new Error(result.error);
  return result;
}

function notify(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function credits(amount) {
  return `${amount} ${amount === "1" ? "credit" : "credits"}`;
}

function intro(title, description) {
  const header = el("div", undefined, "intro");
  header.append(el("h1", title), el("p", description));
  return header;
}

function balanceCard(data, family) {
  const card = el("section", undefined, "balance");
  const top = el("div");
  top.append(el("h2", family ? "Wallet balance" : "Money in your wallet"), el("p", credits(data.balance), "balance-number"));
  card.append(top);
  if (family) {
    const fund = button("Add 10 demo credits", () => update(async () => {
      fundingId ??= crypto.randomUUID();
      wallet = await api("fund", { id: fundingId });
      fundingId = undefined;
      notify("Added 10 demo credits to the wallet.");
    }), "fund");
    card.append(fund);
  }
  return card;
}

function empty(message) {
  return el("p", message, "empty");
}

function elderView(data) {
  const body = el("div", undefined, "elder");
  body.append(intro("Make a payment", "Choose where you’d like to pay."), balanceCard(data, false));
  const payees = el("section", undefined, "section");
  payees.append(el("h2", "Places you can pay"));
  const grid = el("div", undefined, "payees");
  for (const payee of data.payees) {
    const choose = button(payee.label, () => openPayment(payee), "payee");
    choose.append(el("span", "Choose →", "payee-action"));
    grid.append(choose);
  }
  payees.append(grid);
  body.append(payees);
  const activity = el("section", undefined, "section");
  activity.append(el("h2", "Your payments"));
  if (!data.payments.length) activity.append(empty("Your payments will appear here."));
  for (const row of data.payments.slice(0, 8)) {
    const status = row.decision === "HOLD" ? "Waiting for family"
      : row.decision === "ALLOW" ? "Paid" : "Not paid";
    const item = el("div", undefined, "list-row");
    item.append(el("strong", row.payee), el("span", `${status} · ${row.amount === null ? "—" : credits(row.amount)}`, row.decision.toLowerCase()));
    activity.append(item);
  }
  body.append(activity);
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

function familyView(data) {
  const body = el("div");
  body.append(intro("Family dashboard", "Review requests, top up the wallet, and see what happened."));
  const overview = el("div", undefined, "overview");
  overview.append(balanceCard(data, true));
  const pair = el("section", undefined, "pair panel");
  pair.append(el("h2", "Pair an elder"),
    el("p", "Send a one-use link to open the elder view. It expires in 10 minutes."),
    button("Create pairing link", () => update(async () => { invite = (await api("invites", {})).link; }), "outline"));
  if (invite) {
    const url = el("input", undefined, "share-url");
    url.value = invite;
    url.readOnly = true;
    url.setAttribute("aria-label", "Elder pairing link");
    url.addEventListener("focus", () => url.select());
    pair.append(url, button("Copy pairing link", () => copy(invite, "Pairing link copied.")));
  }
  overview.append(pair);
  body.append(overview);

  const inbox = el("section", undefined, "section panel");
  inbox.append(el("h2", `Approval inbox · ${data.pending.length}`));
  if (!data.pending.length) inbox.append(empty("No payments waiting for review."));
  const reviewId = new URLSearchParams(location.hash.slice(1)).get("review");
  for (const row of data.pending) {
    const item = el("article", undefined, row.id === reviewId ? "request selected" : "request");
    if (row.id === reviewId) item.tabIndex = -1;
    item.append(el("h3", `${row.payee} · ${credits(row.amount)}`), el("p", row.reason));
    const approval = `${location.origin}/family#review=${encodeURIComponent(row.id)}`;
    const actions = el("div", undefined, "actions");
    for (const [label, approve] of [["Approve", true], ["Reject", false]]) {
      actions.append(button(label, () => update(async () => {
        const { result, wallet: refreshed } = await api("review", { id: row.id, approve });
        wallet = refreshed;
        notify(result.reason + ".");
      }), approve ? "primary" : "outline"));
    }
    actions.append(button("Copy approval link", () => copy(approval, "Approval link copied."), "text-button"));
    item.append(actions, link("Open approval link", approval));
    inbox.append(item);
  }
  if (reviewId && !data.pending.some(row => row.id === reviewId)) {
    inbox.append(empty("This payment is no longer waiting for approval."));
  }
  body.append(inbox);

  const audit = el("section", undefined, "section panel");
  audit.append(el("h2", "Audit log"));
  if (!data.audit.length) audit.append(empty("Ward’s payment decisions will appear here."));
  for (const row of data.audit.slice(0, 30)) {
    const line = el("div", undefined, "audit-row");
    const detail = el("div");
    detail.append(el("strong", row.payee), el("p", row.reason));
    line.append(el("span", row.decision, `decision ${row.decision.toLowerCase()}`), detail,
      el("span", row.amount === null ? "—" : credits(row.amount), "audit-amount"));
    audit.append(line);
  }
  body.append(audit);
  return body;
}

function render() {
  screen.setAttribute("aria-busy", "false");
  document.querySelector("#role").textContent = wallet?.role === "family" ? "Family view"
    : wallet?.role === "elder" ? "Elder view" : "Demo wallet";
  if (!wallet) {
    screen.replaceChildren(intro("Welcome to Mama Wallet", "Open the setup link or ask your family for a pairing link."));
    return;
  }
  screen.replaceChildren(wallet.role === "family" ? familyView(wallet) : elderView(wallet));
}

async function update(work) {
  if (busy) return;
  busy = true;
  try {
    await work();
    render();
  } catch (error) {
    notify(error.message);
  } finally {
    busy = false;
  }
}

function openPayment(payee) {
  payment = { id: crypto.randomUUID(), payee: payee.id, label: payee.label };
  form.reset();
  input.disabled = false;
  document.querySelector("#amount-label").hidden = false;
  document.querySelector("#payment-title").textContent = `Pay ${payee.label}`;
  document.querySelector("#payment-description").textContent = "Enter how much you want to pay.";
  paymentNext.textContent = "Review payment";
  paymentError.hidden = true;
  dialog.showModal();
  input.focus();
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  if (payment.credits === undefined) {
    payment.credits = input.value;
    document.querySelector("#payment-title").textContent = "Confirm payment";
    document.querySelector("#payment-description").textContent =
      `Send ${credits(payment.credits)} to ${payment.label}?`;
    input.disabled = true;
    document.querySelector("#amount-label").hidden = true;
    paymentNext.textContent = "Confirm payment";
    return;
  }
  busy = true;
  paymentNext.disabled = true;
  document.querySelector("#payment-cancel").disabled = true;
  try {
    const { result, wallet: refreshed } = await api("payments", payment);
    wallet = refreshed;
    dialog.close();
    notify(result.decision === "HOLD" ? "Waiting for family. We’ll show the result here."
      : result.decision === "ALLOW" ? "Payment sent."
      : "Payment couldn’t be sent. Ask your family for help.");
    render();
    notice.tabIndex = -1;
    notice.focus();
  } catch (error) {
    paymentError.textContent = error.message;
    paymentError.hidden = false;
  } finally {
    busy = false;
    paymentNext.disabled = false;
    document.querySelector("#payment-cancel").disabled = false;
  }
});
dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
document.querySelector("#payment-cancel").addEventListener("click", () => dialog.close());
function focusReview() {
  screen.querySelector(".request.selected")?.focus();
}

window.addEventListener("hashchange", () => {
  if (wallet?.role === "family") {
    render();
    focusReview();
  }
});

async function start() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const pair = hash.get("pair");
  const family = hash.get("family");
  try {
    if (pair || family) {
      history.replaceState(null, "", location.pathname);
      await api(pair ? "pair" : "family-session", { code: pair ?? family });
    }
    wallet = await api("wallet");
  } catch (error) {
    if (pair || family || !error.message.includes("setup or pairing")) notify(error.message);
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
      if (!notice.hidden && notice.textContent.startsWith("Waiting for family")) notice.hidden = true;
      render();
    }
  } catch {
    // Keep the current view when a refresh fails.
  }
}, 2500);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Service worker unavailable", error));
}
await start();
