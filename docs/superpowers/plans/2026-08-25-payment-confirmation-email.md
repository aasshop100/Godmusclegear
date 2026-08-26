# Payment Confirmation Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Tasks 2–3 BUILT and verified 2026-08-25 (execution `5020`). Task 4
Steps 1–2 done; Step 3 (one real send) waits on the SPF edit. **Workflow remains
UNPUBLISHED.**
Task 1 (sender) COMPLETE: credential `wbNyEh5HUE1ugRdl`
(`SMTP - God Muscle Gears`) is live and connection-tested, sending as
`admin@godmusclegears.com` via `aasshop100@gmail.com`. SPF verified live 2026-08-26 as
`v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all` — one record,
2 of 10 DNS lookups used, no DMARC. Deliverability proven 2026-08-26: a real send to
`lester@beligas.org` (Namecheap Private Email — independent of Google) landed in
the **inbox**, From read `GOD MUSCLE GEARS <admin@godmusclegears.com>`, with no
"via gmail.com" annotation. Gmail honoured the verified send-as alias rather
than rewriting it, and the SMTP envelope carried `admin@godmusclegears.com` —
so the SPF record edited above is the one actually evaluated.

**Depends on:** `2026-08-23-crypto-payment-automation.md` Tasks 1–6 and
`2026-08-25-payment-fee-tolerance.md` Tasks 1–4 (both done). Modifies the
`Match Payments` node again, so it must land **after** the fee-tolerance work,
not in parallel with it.

**Relationship to `2026-08-25-payment-status-polling.md`:** complementary, not
alternative. Polling updates the page for a buyer whose tab is still open; this
email reaches everyone else. If only one gets built, build this one — most
buyers pay from their exchange app and close the tab.

---

## The problem

When the watcher confirms a payment, three things happen: the sheet row flips to
`PAID`, Lester gets a Telegram, and the customer is told nothing at all.

The status-polling plan fixes that only for a buyer sitting on the success page.
That is the minority. A buyer typically copies the address, switches to their
exchange app, sends, and never returns to the tab. For them the last thing the
site ever said was "this quote expires in 27m 52s".

An email does not care whether the tab is open.

## What gets sent, and what does not

| Order reaches | Email? | Why |
|---|---|---|
| `PAID` (exact) | **yes** | the confirmation the buyer is waiting for |
| `PAID` (auto-accepted) | **yes — identical to the above** | see the warning below |
| `REVIEW` | **yes** | silence here is worse; they paid and heard nothing |
| `PAYMENT_SEEN` | no | transient, BTC-only, and the `PAID` mail follows minutes later |
| `EXPIRED` | no | out of scope; a separate decision about chasing dead quotes |
| unmatched | no | there is no customer to email — no order was identified |

### The auto-accepted email MUST be identical to the exact-match one

An auto-accepted payment is one that came up short (usually the sender's
exchange fee) and was let through anyway. The sheet records
`auto-accepted, short by 1.50` and the Telegram to Lester states it.

**None of that may appear in the customer's email.** A buyer who is told "you
sent 1.50 too little and we accepted it" has learned that a tolerance exists,
roughly where it sits, and that underpaying works. That is the ceiling becoming
a published discount by a slower route.

The `PAID` email therefore states the **expected** amount, never the received
amount, and carries no note field. This is asserted by a test in Task 4, not
left to reviewer discipline.

## Global constraints

- **Exactly-once.** The watcher runs every 2 minutes. Duplicate confirmation
  emails to a paying customer are a trust problem, not a cosmetic one.
- **An email failure must never block order processing.** The sheet update and
  the Telegram alert are the system of record; a bounced address must not roll
  either back.
- **No shipping promises.** Nothing auto-ships. "Being prepared" is true;
  "dispatched" is not.
- **`REVIEW` must tell the customer not to pay again.** A buyer who reads it as
  failure and re-sends creates a second unmatched payment and a refund problem.
- **Never mention the auto-accept ceiling, in any email, in any status.**

## File structure

| File | Status | Responsibility |
|---|---|---|
| n8n `GMG - Payment Watcher` | Modify | `Match Payments` carries customer identity; new email branch. |
| n8n credential | Create/decide | SMTP sender for godmusclegears.com — Task 1. |
| `docs/emails/payment-confirmed.html` | Create | Confirmation email body, kept in the repo for review. |
| `docs/emails/payment-review.html` | Create | Mismatch email body. |

---

### Task 1: The sender — RESOLVED 2026-08-25, needs one manual step from Lester

**Answer:** `admin@godmusclegears.com` is a verified **send-as alias on the Gmail
account `aasshop100@gmail.com`**.

**Consequence — the existing credential cannot be reused.** A Gmail SMTP
credential authenticates as one specific Gmail account, and a send-as alias only
works from the account it is verified on. The instance's only SMTP credential,
**"SMTP account"** (`Hw4TxjxRJwylggXA`), is authenticated as whichever account
sends SingilinMO's `support@singilinmo.com` mail — a different account. It
cannot send as this alias.

A second credential is the right answer regardless: rotating SingilinMO's
password must not be able to break God Muscle Gears order confirmations.

Calling EmailJS server-side from n8n was considered and **rejected** — it shares
the 200/month quota with the storefront's order emails, so a busy month would
silently kill order confirmations.

- [x] **Step 1: Create the credential — Lester, in the n8n UI**

New credential, type **SMTP**, name it `SMTP - God Muscle Gears`:

| Field | Value |
|---|---|
| Host | `smtp.gmail.com` |
| Port | `465` |
| SSL/TLS | on |
| User | `aasshop100@gmail.com` |
| Password | a Google **App Password** — see below |

**It must be an App Password, not the account password.** Google removed
plain-password SMTP; generate a 16-character App Password at
`myaccount.google.com` → Security → App passwords. That menu only appears once
**2-Step Verification is enabled** on `aasshop100@gmail.com`, so turn that on
first if it is off.

Paste the App Password straight into n8n. It should not be sent through chat or
written into any file in this repo.

- [x] **Step 2: Set the From address**

In the email nodes: `GOD MUSCLE GEARS <admin@godmusclegears.com>`. This works
only because the alias is verified on the authenticating account — if the From
is changed to any address not verified on `aasshop100@gmail.com`, Gmail silently
rewrites it back to `aasshop100@gmail.com` and the buyer sees a personal Gmail
address on their order confirmation.

- [x] **Step 3: EDIT the existing SPF record — do not add a second one** — DONE 2026-08-26

DNS as it actually stands, checked 2026-08-25:

```
godmusclegears.com  TXT  "v=spf1 include:_spf.mx.cloudflare.net ~all"
godmusclegears.com  MX   route1/2/3.mx.cloudflare.net
_dmarc.godmusclegears.com  — no record
```

Three things follow from that.

**An SPF record already exists.** It must be EDITED, not added to. Two `v=spf1`
records on one domain is a permanent SPF failure — receivers treat it as
`permerror` rather than merging them — which would break the domain's mail
rather than improve it. Change the existing record to:

```
v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all
```

Keep the Cloudflare include. Dropping it breaks inbound forwarding, which is how
`admin@godmusclegears.com` reaches the Gmail inbox at all.

**The MX records confirm Cloudflare Email Routing**, which is receive-and-forward
only — it provides no outbound SMTP. So `admin@godmusclegears.com` is a
forwarding address, and the actual sending is Gmail's "Send mail as" feature on
`aasshop100@gmail.com`. Confirm that alias is already set up there
(Gmail → Settings → Accounts → "Send mail as"); if it is not, add it, and the
verification email will arrive through the Cloudflare forward.

**There is no DMARC record.** That is why this arrangement works at all today:
mail sent through Gmail as a custom-domain alias is unaligned — the DKIM
signature is `d=gmail.com` and the envelope sender is the Gmail account, neither
matching the `godmusclegears.com` From header — and with no DMARC policy
published, receivers have nothing instructing them to reject it.

Be honest about what the SPF edit buys: it helps where the envelope sender
carries the domain, and it is correct and harmless regardless, but it does not
produce true DMARC alignment for Gmail-alias sending. **The only way to get
that is a real mailbox on the domain** — Google Workspace or Zoho — which is
Option B from the original decision. Not needed now; revisit if confirmation
emails start landing in spam.

> Do not publish a DMARC record while sending this way. A `p=quarantine` or
> `p=reject` policy on an unaligned setup would send your own order
> confirmations to spam by instruction.

- [x] **Step 4: Prove deliverability** — DONE 2026-08-26

Send one test to a **non-Gmail** address — Outlook, Yahoo, or Proton. Gmail is
lenient about mail originating from Gmail and will flatter the result.

Confirm: it arrives in the inbox and not spam, the From reads
`GOD MUSCLE GEARS <admin@godmusclegears.com>`, and the message does not carry a
"via gmail.com" annotation.

- [x] **Step 5: Record the credential id**

**DONE 2026-08-25.**

| | |
|---|---|
| `<SMTP_CRED_ID>` | `wbNyEh5HUE1ugRdl` (`SMTP - God Muscle Gears`) |
| `<FROM_ADDRESS>` | `GOD MUSCLE GEARS <admin@godmusclegears.com>` |

The alias was already verified in Gmail before this work started. Connection
tested green on smtp.gmail.com:465 with SSL.

**Do not confuse it with `SMTP account` (`Hw4TxjxRJwylggXA`)**, which
authenticates as `lstrmrcd@gmail.com` and sends SingilinMO's lender mail. The two
Google accounts are separate, which is why a send-as alias on one cannot be used
by the other. Picking the wrong credential in a node is a silent misconfiguration
— the send succeeds, from the wrong identity.

---

### Task 2: Carry customer identity through `Match Payments`

**Files:**
- Modify: n8n `GMG - Payment Watcher`, `Match Payments` node

The node currently emits `matchedOrderId` but not the customer's email or name —
both sit on the matched order row and are simply not forwarded.

**Interfaces:**
- Produces: `customerEmail`, `customerName`, `expectedAmount` on each result
  item, consumed by Task 3.

- [x] **Step 1: Add the fields to the emitted object**

In the `results.push({ json: {...} })` block, add:

```js
    customerEmail: m.order ? String(m.order.email || '') : '',
    customerName: m.order ? String(m.order.customerName || '') : '',
    // The EXPECTED amount, deliberately - never the received amount. On an
    // auto-accepted payment those differ, and the difference is exactly what
    // the customer must not be shown.
    expectedAmount: m.order ? (p.coin === 'BTC'
      ? Number(m.order.expectedAmount).toFixed(8)
      : Number(m.order.expectedAmount).toFixed(2)) : '',
```

- [x] **Step 2: Mirror it into `payment-matching.js`?  — NO**

Deliberately not. `payment-matching.js` is the pure *matching* module; who to
email is presentation, not matching. Adding it there would widen a module whose
narrowness is the reason it can be tested exhaustively.

Note this divergence in the module's header comment so the next person to run
the Task 3 parity check knows the emit block is expected to differ from the
module and only `findMatch` plus the constants must agree.

- [x] **Step 3: Re-verify the workflow**

`get_workflow_details UEIXJauCOKOhxIUh`, then confirm the nodes you did not
touch are intact — `Payment Addresses` assignments and `watchFrom`, both Telegram
`chatId`s, all four Sheets nodes' `operation` and schemas, `errorWorkflow`,
`timezone`, and all connections. This workflow has had unrelated parameters
silently dropped by `update_workflow` before.

---

### Task 3: The email branch

**Files:**
- Modify: n8n `GMG - Payment Watcher`
- Create: `docs/emails/payment-confirmed.html`, `docs/emails/payment-review.html`

- [x] **Step 1: Write the two bodies in the repo first**

Author both as standalone HTML in `docs/emails/` so the copy can be read and
reviewed in a diff rather than only inside an n8n text field. Email-safe markup:
tables, inline styles, no flexbox, no external CSS.

**`payment-confirmed.html`** — order id, the **expected** amount, "your order is
confirmed and is being prepared", the Telegram handle for questions. No received
amount. No note field. No tracking promise.

**`payment-review.html`** — order id, that a payment was received, that it does
not match the quote, **"please don't send again"**, and that a human is checking
it. Do not state the shortfall: at this point the amount genuinely is wrong and
naming the gap invites the buyer to "top up", producing a second small payment
that matches nothing.

- [x] **Step 2: Add the branch**

After `Alert Matched`, add a Switch on `newStatus`:

```
Alert Matched → Needs Customer Email? ─ PAID   → Send Confirmed Email
                                      └ REVIEW → Send Review Email
                                      └ (else) → nothing
```

Placing it after `Alert Matched` means it runs after `Log Matched Tx` has already
written the dedupe key to `processed_tx`. That ordering is the exactly-once
guarantee: if anything upstream fails, the tx is not marked processed and nothing
was emailed either, so the next run retries cleanly.

- [x] **Step 3: Guard the send**

Both `emailSend` nodes:

- credential `<SMTP_CRED_ID>`, from `<FROM_ADDRESS>`
- to `={{ $("Match Payments").item.json.customerEmail }}`
- **`onError: "continueRegularOutput"`** — a bounced or malformed address must
  not fail the execution. The order is already `PAID` in the sheet and Lester
  already has the Telegram; losing the email is a nuisance, losing the run is not.
- an IF (or an expression guard) so a blank `customerEmail` is skipped rather
  than attempted — older test rows have no email and would error every cycle.

- [x] **Step 4: Subject lines**

- `PAID` — `Payment confirmed — order {{orderId}}`
- `REVIEW` — `We received your payment — order {{orderId}}`

The review subject deliberately does not say "problem" or "failed". The money
arrived; only the amount is in question.

---

### Task 4: Verify without sending real mail

- [x] **Step 1: Pinned-data run**

`test_workflow` pins every credentialed node, so `emailSend` is simulated and
nothing leaves the instance. Feed the same synthetic TronGrid fixture used for
execution `5018` and confirm routing:

| Pinned payment | Expected email |
|---|---|
| exact | Confirmed |
| short 1.50 (auto-accepted) | Confirmed — **identical body to the exact case** |
| short 3.01 | Review |
| over 1.50 (auto-accepted) | Confirmed |
| ambiguous / unmatched | none — the branch is not reached |
| matched order with blank `customerEmail` | none, and **no execution error** |

- [x] **Step 2: Assert the leak is closed**

Diff the rendered body of the exact case against the auto-accepted case. They
must be **byte-identical**. Then grep both for `auto-accepted`, `short by`,
`over by`, and the received amount — all must be absent.

This is the highest-value check in the plan. Everything else here is a
convenience feature; this one is the difference between a tolerance that stays
private and one that becomes a published discount.

- [ ] **Step 3: One real send to yourself**

Per the pattern in `n8n-workflows.md`: `test_workflow` never really sends, so it
cannot prove deliverability. Do one genuine send by temporarily setting a test
order's email to Lester's own address and running the watcher manually against a
pinned payment. Confirm the mail arrives, renders in Gmail **and** on a phone,
and is not in spam.

Delete that test row by exact id afterwards.

---

### Task 5: Fold into go-live

- [x] **Step 1: Extend the go-live checklist**

Add to `2026-08-23-crypto-payment-automation.md`: the SMTP credential must exist
and be verified before publishing the watcher, or every confirmed payment fails
its email step silently (harmlessly, given `continueRegularOutput` — which is
exactly why it would go unnoticed).

- [x] **Step 2: Update memory**

Record in `C:\Users\LESTER\memory\n8n-workflows.md`: the sender decision, that
the `PAID` email is deliberately identical for exact and auto-accepted payments,
and that the email branch sits after `Log Matched Tx` for exactly-once.

---

## Residual risks

- **Deliverability is the real risk, not the code.** A confirmation email that
  reliably spam-folders is worse than no email: the customer concludes they were
  ignored, and Lester believes they were told. Task 1 Step 1 exists for this and
  should not be skipped because the Gmail test looked fine.
- **`continueRegularOutput` makes email failure invisible.** That is the right
  trade — order processing must not depend on mail — but it means a broken SMTP
  credential could go unnoticed for weeks. Worth a glance at the execution log
  after go-live, or a later check that compares `PAID` rows against sends.
- **This does not replace the status-polling plan.** A buyer with the tab open
  still watches a countdown run to "expired" while their confirmation email sits
  in another app. The two together are what make the flow coherent.
