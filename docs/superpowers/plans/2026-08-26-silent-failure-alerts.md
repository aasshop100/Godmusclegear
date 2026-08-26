# Silent-failure alerts — BUILT

**Status: BUILT AND PUBLISHED 2026-08-26.** Both workflows are live with these
changes. **Live failure-injection tests 1, 2, 3, 4 and 6 are still OUTSTANDING** —
see the Verification section. The health-check logic was unit-tested against six
cases before being added (threshold, quiet night, both-chains-down, recovery,
array shape, no early alert), and a post-edit diff confirmed zero parameter
stripping on either workflow, but no email has yet been made to fail on purpose.
**Date:** 2026-08-26

---

## The problem

`Error Handler - Telegram Alerts` (`sXZtgBw3kX1dhgWg`) is now connected to all 12
MCP-reachable workflows. It fires when a workflow **fails**.

Nothing in the GMG money path fails.

Every external-service node in the crypto flow is set to
`onError: continueRegularOutput` — deliberately, so one broken service cannot
kill a sale. The cost is that those nodes swallow their error, the run finishes
green, and the error workflow is never invoked. Connecting the handler did not
close this, and it cannot.

Six nodes behave this way:

| Workflow | Node | What breaks, silently |
|---|---|---|
| `GMG - Create Order` | `Send Customer Order Email` | Buyer never gets payment instructions |
| `GMG - Create Order` | `Send Owner Order Email` | Lester never gets the order email |
| `GMG - Payment Watcher` | `Send Confirmed Email` | Buyer is never told their payment cleared |
| `GMG - Payment Watcher` | `Send Review Email` | Buyer is never told their payment needs checking |
| `GMG - Payment Watcher` | `Fetch Tron USDT` | Watcher stops seeing USDT payments |
| `GMG - Payment Watcher` | `Fetch Bitcoin` | Watcher stops seeing BTC payments |

All four email nodes share **one** SMTP credential (`wbNyEh5HUE1ugRdl`). If it
expires the way the Sheets OAuth credential kept doing, the store keeps taking
orders and stops emailing anybody, with no failure anywhere.

The two fetch nodes are worse, because the failure is invisible even in the
execution list: a failed fetch yields no transactions, `Match Payments` finds
nothing to match, and the run looks identical to a normal quiet cycle.

**Worked example.** SMTP credential expires at 2am. Six orders arrive overnight.
Six rows are written, six Telegrams reach Lester, zero emails are sent. Every
execution is green. First signal is a buyer asking where the payment details are.

---

## What this spec does NOT do

- **It does not remove `continueRegularOutput` as a philosophy.** An order must
  still complete when email is down. Alerting is added; blocking is not.
- **It does not add a heartbeat.** No "watcher is fine" messages. Matches the T5
  Catalog Health Check rule: alert only when something is actually wrong.
- **It does not touch the storefront.** No `script.js` changes.

---

## Part 1 — Email failures become loud

### The trap that makes this non-trivial

In `GMG - Create Order` the two email nodes are **chained**:

```
Build Emails → Send Customer Order Email → Send Owner Order Email
```

That works today only because `continueRegularOutput` passes items out the
**main** output even on failure, so a failed customer email still lets the owner
email run.

Switching to `continueErrorOutput` sends failed items out the **error** output
instead — so a failed customer email would silently skip the owner email too.
**The restructure below is required, not cosmetic.** Making the obvious one-line
change alone would introduce a worse bug than the one being fixed.

### Change

Rewire so both emails branch in parallel from `Build Emails`, each independently
able to fail:

```
Build Emails ─┬→ Send Customer Order Email ──(error)─→ Alert Email Failed
              └→ Send Owner Order Email ─────(error)─→ Alert Email Failed
```

- Remove connection `Send Customer Order Email → Send Owner Order Email`
- Add connection `Build Emails → Send Owner Order Email`
- Set both nodes to `onError: continueErrorOutput`
- New Telegram node `Alert Email Failed`, chat `1406681772`, fed from both error
  outputs

`Send Owner Order Email` currently reads `$("Build Emails").item.json.ownerSubject`
rather than `$json`, so moving it off the chain does not break its expressions.
`Send Customer Order Email` uses bare `$json` and stays directly downstream of
`Build Emails`, so it is unaffected. **Verify both after the rewire** — this is
exactly the kind of edit where n8n strips parameters.

In `GMG - Payment Watcher`, `Send Confirmed Email` and `Send Review Email` are
already terminal, so they need no restructure — only `continueErrorOutput` and a
connection to the same alert node.

### Alert text

```
EMAIL FAILED
Order {orderId}
To: {recipient}
Which: customer order email | owner order email | payment confirmed | payment review
Error: {error message}
The order itself is fine and the row is written. Only the email failed.
```

That last line matters: this alert must never read as "the order broke".

### Deliberately not throttled

If SMTP dies, every order produces alerts. That is proportional to order volume,
which is currently low, and the noise IS the signal. Revisit only if volume makes
it annoying.

---

## Part 2 — A blind watcher becomes loud

### Why not just alert on every fetch failure

TronGrid and mempool.space blip. A 2-minute schedule means a single bad minute
would alert, and alerting on every blip trains you to ignore the alert. It also
does not matter: a failed fetch while nothing is awaiting payment costs nothing.

### Rule

Alert when the watcher has been blind **persistently**, not momentarily.

Track consecutive failures per chain in `$getWorkflowStaticData('global')`:

- Fetch succeeded → reset that chain's counter to 0. If it had been in the
  alerted state, send **one** recovery message and clear the flag.
- Fetch failed → increment.
- Counter reaches **5** (≈10 minutes) → alert once, set the alerted flag.
- While still failing, re-alert every **30** cycles (≈1 hour) so a long outage
  does not go quiet, without spamming.

Detection: with `continueRegularOutput` a failed HTTP node emits an item carrying
`error`, and a successful TronGrid call has `data` while mempool.space returns an
array. The check must therefore be **"did this look like a valid response"**, not
merely "is the array empty" — an empty array is a legitimate quiet cycle and must
NOT count as a failure. Getting this backwards would alert every quiet night.

### Escalate when money is actually waiting

Include in the alert whether any row is currently `AWAITING_PAYMENT` or
`PAYMENT_SEEN`. `Read Orders` already has every row in the same execution, so
this costs nothing.

```
WATCHER BLIND — {USDT|BTC}
{n} consecutive failed polls (~{minutes} min)
{k} orders are waiting on payment right now      ← omitted when k = 0
Last error: {message}
Payments are still arriving on-chain; they are just not being noticed.
Check manually before telling any customer their payment did not arrive.
```

That last line is the important one. A blind watcher does **not** mean money was
lost — it means detection stopped. Nothing here should ever prompt telling a
customer their payment failed.

### Implementation note

Static data persists per workflow and survives restarts. It resets if the
workflow is deleted or re-imported — acceptable, because the worst case is one
missed alert cycle, not a wrong alert.

---

## Verification (before calling any of this done)

Per the standing rule: enumerate and test, no ad-hoc clicking.

1. **Email alert fires** — temporarily point a copy of an email node at a
   deliberately invalid SMTP host, run one order, confirm the Telegram arrives
   AND the order row is still written.
2. **Owner email still sends when the customer email fails** — the specific
   regression the restructure exists to prevent. This is the test that matters
   most; if only one test is run, run this one.
3. **Both emails still send on a normal order** — the restructure must not
   change the happy path.
4. **Watcher counter increments** — point `Fetch Tron USDT` at an unreachable
   host, confirm no alert before cycle 5, one alert at cycle 5, and no alert
   again until cycle 35.
5. **Quiet night is not an outage** — a successful fetch returning zero
   transactions must NOT increment the counter.
6. **Recovery message** — restore the URL, confirm exactly one recovery message.
7. **Re-read every touched workflow and diff** — the `returnAllMatches` class of
   silent parameter stripping has bitten this project repeatedly.

---

## Cost

Two Telegram nodes, one rewire of three connections, `onError` changed on six
nodes, and one Code node for the counters. No new credentials, no new services,
no schema change to the Orders sheet.
