# Session handoff — 2026-08-26

Written at the end of the go-live session. **Everything described here is done,
published and verified unless it says otherwise.**

---

## Where things stand

**The store is LIVE and taking real orders through the automated flow.**
`MAINTENANCE_MODE = false`, all three n8n workflows published, both sheet tabs
headers-only, `main` deployed and clean.

Shipped this session:

| | |
|---|---|
| Bank transfer branch | built + tested (never existed before) |
| BTC panel + email show a USD figure | live |
| reCAPTCHA actually enforced | live, both directions tested |
| Google Sheets on a service account | no more OAuth expiry |
| Silent-failure alerts | live, verified by breaking things on purpose |
| Shared error handler on 12 workflows | done |
| Maintenance mode lifted | done |

---

## THE ONE THING THAT HAS NEVER RUN AGAINST REAL MONEY

**No crypto payment has ever been _detected_ end-to-end.**

Matching is unit-tested (85 tests) and the BTC ceiling is pinned against real
amounts from the receiving address, but **no real payment has ever been matched
to a live order automatically.** Lester chose to let a real customer be that
test rather than send his own funds.

**When the first crypto order arrives, watch it:**

1. Row flips `AWAITING_PAYMENT` → `PAID` (or `REVIEW`)
2. The customer gets the confirmation email
3. `processed_tx` gains the transaction
4. `paidAt` is stamped

If the watcher fails, **the money still arrives** — it is simply not noticed, and
the row sits at `AWAITING_PAYMENT`. Nothing is lost; detection just did not
happen. Never tell a customer their payment failed on that basis.

---

## Traps that cost real time this session — do not rediscover them

**1. `$'` in a JS replacement string splices the file.**
`String.replace(a, b)` treats `$'` in `b` as "everything after the match". The
added code contained `'≈ $' + usd`, and it spliced a copy of the whole file into
a string literal — this broke the live payment panel once. **Always use a
replacer FUNCTION:** `s.replace(anchor, () => added)`. Every edit script in this
repo now does.

**2. n8n Custom Auth: `qs`, never `body`.**
The reCAPTCHA secret lives in credential `UOSNeCTioNxfSzCy` shaped
`{"qs":{"secret":"..."}}`. With a form-urlencoded body n8n builds `form`, so an
injected `body` is silently dropped. Worse, **Google returns
`invalid-input-response` for a missing secret AND a bad token alike** — verified
directly against siteverify. Never read that code as "the secret is good"
(I did, and it was wrong). Diagnose with the received token **length** instead:
`0` = none arrived, a real one is ~2400 chars.

**3. `continueErrorOutput` severs chained nodes.**
`continueRegularOutput` passes failed items out the MAIN output, so a chained
node still runs. `continueErrorOutput` does not. In `GMG - Create Order` the two
order emails **must stay parallel branches** off `Build Emails`. Chained, a
failed customer email would silently skip the owner email too.

**4. n8n strips parameters on edit.**
`returnAllMatches` on the Sheets reads is load-bearing — without it only the
first row is read and two open orders can be assigned the same payable amount.
**Re-fetch and diff after every workflow edit.** Done every time this session;
zero drift.

**5. `addConnection` uses `sourceIndex`.**
Not `sourceOutput`, not `outputIndex` — both are silently ignored and everything
lands on output 0. That briefly put a captcha pass and a captcha reject on the
same branch.

**6. Workflow settings are not versioned.** `setWorkflowSettings` applies
immediately; no publish needed. Node/connection changes DO need publishing.

---

## Open items, roughly in priority order

1. **Watch the first real crypto payment** (above). Nothing to build.
2. **`Lester Domain staycation sample` is active with no trigger.** An active
   workflow nobody remembers is worth a look — decide whether to deactivate it.
3. **8 workflows have `availableInMCP: false`** so they cannot be edited via MCP
   and have no error workflow. All inactive experiments; harmless until one is
   activated.
4. **A `DMARC` record is deliberately absent.** Do not add one until there is a
   real mailbox on the domain, or it will instruct receivers to bin GMG's own
   order confirmations.
5. **The checkout took ~24s to respond once** (2026-08-26, one occurrence,
   against 3–11s normally). Cause never identified; CoinGecko responds in 0.2s
   from here. Watch whether it recurs on real orders before chasing it.

---

## Where the detail lives

- `docs/GO-LIVE-RUNBOOK.md` — EXECUTED. Record of what was done, plus the
  first-week watch list.
- `docs/superpowers/plans/2026-08-23-crypto-payment-automation.md` — the main
  plan, with a LIVE status section.
- `docs/superpowers/plans/2026-08-26-silent-failure-alerts.md` — spec AND the
  verification log for the alerting work.
- `C:\Users\LESTER\memory\ecommerce-stores.md` and `n8n-workflows.md` — the
  working memory, both updated.
