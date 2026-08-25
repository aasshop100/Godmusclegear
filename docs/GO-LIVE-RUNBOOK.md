# Crypto Payment Automation — Go-Live Runbook

Task 8 of `docs/superpowers/plans/2026-08-23-crypto-payment-automation.md`.
Work top to bottom. Do not skip the verification line under a step.

**Rollback at any point:** `main` is untouched until Step 6. Before that, nothing
customers can reach has changed — unpublish the workflows and stop.

---

## 0 — Pre-flight

Do not start until all of these are true:

- [ ] SPF record edited and propagated (`nslookup -type=TXT godmusclegears.com`
      shows `_spf.google.com`)
- [ ] EmailJS `template_0ry9w0v` replaced with `docs/emailjs-customer-template.html`
- [ ] EmailJS tested with a **crypto** order AND a **bank transfer** order —
      the bank-transfer one must show "we will contact you soon" and **no**
      empty payment box
- [ ] EmailJS sender changed to `admin@godmusclegears.com`
- [ ] One deliverability test sent to a **non-Gmail** address, landed in inbox
- [ ] **Live USDT payment test passed** — a real payment matched, order flipped
      to `PAID`, Telegram received

> The live USDT test is the one that must not be skipped. The Tron address has
> never received anything, so real TRC-20 parsing has never run against real
> chain data. Bitcoin parsing was proven; USDT was not.

---

## 1 — Close the local origin on both webhooks

`GMG - Create Order` → `Order Webhook`, and `GMG - Order Status` →
`Status Webhook`. Remove `,http://localhost:8899` from `allowedOrigins` on each,
leaving:

```
https://godmusclegears.com,https://www.godmusclegears.com
```

**Do NOT** add `Access-Control-Allow-Origin` to any Respond node. It overrides
the webhook's own `allowedOrigins` and previously broke every `www.` request.

**Verify:** re-fetch both workflows and confirm no localhost remains.

---

## 2 — Delete the test rows

`Orders` tab, **by exact id** — never by a content match:

```
TEST-001  TEST-002  TEST-003  TEST-004  TEST-005
TEST-006  TEST-007  TEST-008
LIVE-USDT-TEST  LIVE-BINANCE-TEST
ORDER-1787584663956
TOKEN-TEST-001
BANK-TEST-001  CRYPTO-REG-001
```

> `BANK-TEST-001` and `CRYPTO-REG-001` are from verifying the bank-transfer
> branch on 2026-08-26. `BAD-METHOD-001` was also attempted but threw before the
> append, so it has no row — do not go looking for it.

Plus whatever order id the live USDT test created.

`processed_tx` tab: delete all test rows (8 from the original build, plus any
from the live test).

**Verify:** count rows before and after. Both tabs should contain only the
header row.

---

## 3 — Advance `watchFrom` — do this AFTER Step 2, never before

On `GMG - Payment Watcher` → `Payment Addresses` node, set `watchFrom` to the
current Manila time, format `YYYY-MM-DD HH:MM:SS`.

> **This is the step most likely to go wrong, and it is loud when it does.**
> `watchFrom` and `processed_tx` are the two things stopping the watcher from
> reporting historical transactions. Step 2 just emptied `processed_tx`. The
> receiving addresses are live exchange deposit addresses with years of history,
> and the chain APIs return the last ~50 transactions — so if `watchFrom` is
> still `2026-08-24 22:45:00` when the watcher next runs, it will alert on every
> transaction since then, including the live test payment you already handled.
>
> Empty `processed_tx` and a stale `watchFrom` is the bad combination. Never
> leave the system in that state between steps.

**Verify:** the node shows today's date, and it is later than the live test
payment.

---

## 4 — Publish all three workflows

```
GMG - Create Order      YTYSoa22Gu9L6NzC
GMG - Payment Watcher   UEIXJauCOKOhxIUh
GMG - Order Status      1v3236DBmMZBL88h
```

All three, together. A published create-order handing out `statusToken`s while
the status workflow is unpublished means every customer page polls a dead
endpoint — harmless, but the fix is then not actually live.

**Verify:** for each, `versionId === activeVersionId`. This instance uses
draft/publish — an edit after publishing only changes the draft, and the live
behaviour does not move until you republish.

---

## 5 — Watch one idle cycle

Wait ~4 minutes and check the watcher's executions.

**Verify:** two clean runs, **no Telegram alerts**. Alerts here mean Step 3 was
missed and it is re-reporting history. If that happens: unpublish the watcher,
fix `watchFrom`, re-publish.

---

## 6 — Deploy the site (the point of no return)

Workflows first, site second. If the site goes live against unpublished
webhooks, every crypto checkout fails with "we could not generate your payment
details" and the order is blocked.

```bash
git checkout main && git merge crypto-payment-automation && git push origin main
```

GitHub Pages rebuilds in ~1–2 minutes, no build step.

**Verify:** hard-reload https://godmusclegears.com/checkout.html and confirm the
payment method options read **Bank Transfer / USDT (TRC-20) / Bitcoin**.

---

## 7 — Place one real order yourself

Not optional. One seam has never run end to end: browser checkout → create-order
webhook → `sessionStorage` → the page polling with `statusToken`. Every link was
verified individually, but never as a chain, because the webhook was unpublished
throughout development.

Use the smallest possible cart and USDT.

**Verify, in order:**

1. Success page shows the amount, address, QR and a running countdown
2. Order confirmation email arrives **with** the payment block
3. Send the payment
4. Within ~2 min: Telegram `PAYMENT CONFIRMED`
5. The success page — still open — flips to **"Payment confirmed"** and the
   countdown stops
6. The customer confirmation email arrives
7. Sheet row shows `PAID` with a `paidAt` and a real `txHash`

If 5 fails but 4 and 6 work, polling is broken and nothing else is — the page
degrades silently by design, so it will not announce itself. Check the browser
console on the success page.

**Then delete that order's rows** from both tabs, by exact id.

---

## 8 — Update the record

- Mark Task 8 done in `2026-08-23-crypto-payment-automation.md`
- Update `C:\Users\LESTER\memory\ecommerce-stores.md` and `n8n-workflows.md`:
  the three workflows are **published**, and the live site runs the automated
  crypto flow

---

## After go-live — worth a look in the first week

- **`auto-accepted, short by` notes in the sheet.** A cluster of shortfalls at
  exactly the ceiling is not exchange fees, it is someone who worked out the
  tolerance.
- **The email step failing silently.** Both send nodes use
  `continueRegularOutput`, so a broken SMTP credential loses emails without
  failing any run. Compare `PAID` rows against sends occasionally.
- **Unmatched-payment alerts.** Occasional ones are normal (ambiguity is
  reported rather than guessed). A rising rate means concurrent orders are
  colliding inside the auto-accept band, and the ceiling needs revisiting.
