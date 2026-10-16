# Tracking-number email Implementation Plan

> ## EXECUTED — 2026-10-16. Three steps below were WRONG; read this first.
>
> All nine tasks are done and `GMG - Tracking Emails` (`0JvCQIgVoRfEhUP2`) is
> published and active. Kept as the record, not as a to-do list.
>
> **Task 8 Step 1 told you to paste `tracking-email.js` "verbatim" and Step 2 to
> verify it byte-identical by sha256. Both are wrong.** The UMD wrapper cannot
> run inside a Code node: `module` and `window` are both undefined there, so it
> builds the API object and discards it, leaving every function unreachable. The
> live `Match Payments` node has the module BODY inlined flat with the wrapper
> stripped, and so does this one. Derive it mechanically and check it
> *behaviourally* against the tested module instead.
>
> **Task 8 Step 3 said to dry-run with the send node disabled. That is not safe.**
> A disabled n8n node PASSES ITS INPUT THROUGH, so `Stamp Emailed` ran and marked
> the order as emailed while nothing was sent. In production that means the next
> run finds no new numbers, skips, and the customer is never told. **Disable the
> stamp too, or disconnect it.**
>
> That accident also exposed a real bug the dry run would otherwise have hidden:
> an emailSend node outputs the SMTP result (`accepted`, `messageId`,
> `response`), not the data that fed it. `Stamp Emailed` and `Alert Send Failed`
> read `$json.orderId`, which resolved ONLY because the disabled node was passing
> through. Enabled, the stamp would have written an empty id and matched no row.
> Both now read `$('Decide Sends').item.json` — the same reason the Payment
> Watcher's alert reads `$("Match Payments")`.
>
> **Task 9 Step 4 said to create a cron-job.org job. Not needed.** This workflow
> carries its own Schedule Trigger, so publishing IS the schedule. The Sales Ops
> jobs live on cron-job.org only because Vercel Hobby caps crons at two.
>
> Also added after the plan was written: every tracking email states **"allow
> 4–7 business days"** for delivery.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **No spreadsheet IDs, URLs, secrets or credential values in this file.** This
> repository is public. Env var *names* appear; values never do.

**Goal:** When a tracking number reaches a website order, email that customer the number — automatically, the same night.

**Architecture:** Sales Ops tags an order with the GMG website order id and exposes a read-only endpoint listing tagged orders that have tracking numbers. A nightly n8n workflow reads that endpoint, diffs the numbers against what it has already emailed (state kept on the Orders sheet row), sends the branded email, and stamps the row. `/api/tracking-import` is never touched.

**Tech Stack:** Next.js 15 / React / TypeScript (Sales Ops) · `node --test` in both repos · plain JS UMD module shared with an n8n Code node (GMG) · n8n Sheets + emailSend + Telegram nodes.

## Global Constraints

- **Shippable statuses are exactly `PAID` and `BANK_TRANSFER`.** Bank-transfer orders never reach `PAID`; gating on `PAID` alone silently skips them.
- **Sheet timestamps are Philippine local time with NO offset** (`2026-10-16 21:30:00`), matching `createdAt` and `paidAt`. Readers must treat them as UTC+8.
- **Send first, then stamp.** A duplicate email is recoverable; a silent non-send is not.
- **Never say "cancelled" or "do not pay"** in any customer email in this system.
- **The customer Telegram handle is `@Godmusclegear`** — singular, no trailing `s`.
- **New Orders-tab columns are APPENDED at the end.** Never reorder; n8n nodes map by header name.
- **Sales Ops optional fields take no migration** — follow `cancelled?` / `noTrackingNeeded?`.
- Sales Ops tests: `npm test` → `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "src/**/*.test.ts"`, tests co-located as `src/lib/<name>.test.ts`, imports carry the `.ts` extension.
- GMG tests: `node --test tests/*.test.js` (NOT `node --test tests/`, which Node resolves as a module path and fails).

---

## File Structure

**GMG repo (`Godmusclegear-main`)**

| File | Responsibility |
|---|---|
| `tracking-email.js` *(create)* | Pure decision layer: parse numbers, diff against already-emailed, status gate, first-vs-follow-up. Pasted verbatim into the n8n Code node. |
| `tests/tracking-email.test.js` *(create)* | Its tests. |
| `docs/emails/tracking-shipped.html` *(create)* | Source of truth for the email body. |

**Sales Ops repo (`sales-ops-app`)**

| File | Responsibility |
|---|---|
| `src/lib/tracking-numbers.ts` *(create)* | `trackingNumbersFromText`, moved out of `page.tsx` so routes can reach it. |
| `src/lib/tracking-numbers.test.ts` *(create)* | Its tests. |
| `src/lib/website-shipments.ts` *(create)* | Pure selector: orders → the shipment list the endpoint returns. |
| `src/lib/website-shipments.test.ts` *(create)* | Its tests. |
| `src/lib/gmg-orders-client.ts` *(create)* | Reads the Orders tab. Sheets access only — no parsing, no matching. |
| `src/app/api/website-shipments/route.ts` *(create)* | Secret-gated GET for n8n. |
| `src/app/api/website-orders/route.ts` *(create)* | Access-code-gated GET for the picker. |
| `src/components/WebsiteOrderPicker.tsx` *(create)* | The picker dialog. |
| `src/app/page.tsx` *(modify)* | `websiteOrderId?` on `Order`; import the moved parser; mount the picker. |

---

### Task 1: GMG decision module

**Files:**
- Create: `tracking-email.js`
- Test: `tests/tracking-email.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseNumbers(text) -> string[]`, `SHIPPABLE -> string[]`, `decideSend({ row, trackingNumbers }) -> Decision`.
  `Decision` is one of:
  `{ action:'alert', reason:'order-not-found'|'not-shippable', orderId, status? }`,
  `{ action:'skip', reason:'no-new-numbers', orderId }`,
  `{ action:'send', orderId, newNumbers:string[], isFirst:boolean, packageCount:number, emailedAfter:string }`.
  `emailedAfter` is the exact string to write into `trackingEmailed` after a successful send.

- [ ] **Step 1: Write the failing test**

Create `tests/tracking-email.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseNumbers, decideSend, SHIPPABLE } = require('../tracking-email.js');

const row = (over) => Object.assign({
  orderId: 'ORDER-1', status: 'PAID', trackingEmailed: '', packageCount: 1
}, over);

test('parseNumbers splits on newline, comma, semicolon and slash', () => {
  assert.deepStrictEqual(parseNumbers('A1\nB2, C3;D4/E5'), ['A1', 'B2', 'C3', 'D4', 'E5']);
});

test('parseNumbers trims and drops blanks', () => {
  assert.deepStrictEqual(parseNumbers('  A1 ,, \n B2 '), ['A1', 'B2']);
});

test('parseNumbers on empty input is an empty list', () => {
  assert.deepStrictEqual(parseNumbers(''), []);
  assert.deepStrictEqual(parseNumbers(undefined), []);
});

test('BANK_TRANSFER is shippable - those orders never reach PAID', () => {
  assert.ok(SHIPPABLE.includes('BANK_TRANSFER'));
  assert.ok(SHIPPABLE.includes('PAID'));
});

test('a missing row alerts, it does not send', () => {
  const d = decideSend({ row: null, trackingNumbers: ['A1'], orderId: 'ORDER-X' });
  assert.strictEqual(d.action, 'alert');
  assert.strictEqual(d.reason, 'order-not-found');
  assert.strictEqual(d.orderId, 'ORDER-X');
});

test('an EXPIRED order alerts - a number against it means the wrong tag', () => {
  const d = decideSend({ row: row({ status: 'EXPIRED' }), trackingNumbers: ['A1'] });
  assert.strictEqual(d.action, 'alert');
  assert.strictEqual(d.reason, 'not-shippable');
  assert.strictEqual(d.status, 'EXPIRED');
});

test('first number on a clean order sends, flagged as first', () => {
  const d = decideSend({ row: row(), trackingNumbers: ['A1'] });
  assert.strictEqual(d.action, 'send');
  assert.deepStrictEqual(d.newNumbers, ['A1']);
  assert.strictEqual(d.isFirst, true);
  assert.strictEqual(d.emailedAfter, 'A1');
});

test('nothing new means nothing happens', () => {
  const d = decideSend({ row: row({ trackingEmailed: 'A1' }), trackingNumbers: ['A1'] });
  assert.strictEqual(d.action, 'skip');
  assert.strictEqual(d.reason, 'no-new-numbers');
});

test('a second parcel sends only the new number and is not first', () => {
  const d = decideSend({ row: row({ trackingEmailed: 'A1', packageCount: 2 }), trackingNumbers: ['A1', 'B2'] });
  assert.strictEqual(d.action, 'send');
  assert.deepStrictEqual(d.newNumbers, ['B2']);
  assert.strictEqual(d.isFirst, false);
  assert.strictEqual(d.emailedAfter, 'A1\nB2');
});

test('a corrected number resends with no special case', () => {
  const d = decideSend({ row: row({ trackingEmailed: 'A1' }), trackingNumbers: ['A2'] });
  assert.strictEqual(d.action, 'send');
  assert.deepStrictEqual(d.newNumbers, ['A2']);
  assert.strictEqual(d.emailedAfter, 'A1\nA2');
});

test('two numbers at once go in one email', () => {
  const d = decideSend({ row: row({ packageCount: 2 }), trackingNumbers: ['A1', 'B2'] });
  assert.deepStrictEqual(d.newNumbers, ['A1', 'B2']);
  assert.strictEqual(d.isFirst, true);
});

test('packageCount defaults to 1 when the cell is blank or junk', () => {
  assert.strictEqual(decideSend({ row: row({ packageCount: '' }), trackingNumbers: ['A1'] }).packageCount, 1);
  assert.strictEqual(decideSend({ row: row({ packageCount: 'x' }), trackingNumbers: ['A1'] }).packageCount, 1);
  assert.strictEqual(decideSend({ row: row({ packageCount: '2' }), trackingNumbers: ['A1'] }).packageCount, 2);
});

test('no tracking numbers at all is a skip, never an alert', () => {
  assert.strictEqual(decideSend({ row: row(), trackingNumbers: [] }).action, 'skip');
});

test('duplicates within one input collapse', () => {
  const d = decideSend({ row: row(), trackingNumbers: ['A1', 'A1'] });
  assert.deepStrictEqual(d.newNumbers, ['A1']);
  assert.strictEqual(d.emailedAfter, 'A1');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/tracking-email.test.js`
Expected: FAIL — `Cannot find module '../tracking-email.js'`

- [ ] **Step 3: Write the implementation**

Create `tracking-email.js`:

```js
// tracking-email.js — GOD MUSCLE GEARS
// Decides whether a tracking number owes the customer an email, and which
// numbers that email should carry. No DOM, no network, no storage.
// Unit-tested here, then pasted verbatim into the n8n Code node.
//
// Rules that must never be relaxed:
//   1. BANK_TRANSFER is shippable. Those orders never reach PAID, so gating on
//      PAID alone silently skips every bank-transfer customer.
//   2. A number against a non-shippable order means the WRONG ORDER WAS TAGGED.
//      Report it; never email on it. The cost of guessing is a stranger
//      receiving someone else's parcel details.
//   3. State is the SET of numbers already emailed, never a boolean. That is
//      what makes a second parcel send its own email and a corrected number
//      resend itself, with no special case for either.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  const SHIPPABLE = ['PAID', 'BANK_TRANSFER'];

  // Mirrors trackingNumbersFromText in Sales Ops: the same field is typed by
  // the same human, so the same separators have to work on both sides.
  function parseNumbers(value) {
    return String(value === undefined || value === null ? '' : value)
      .split(/[\n,;/]+/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function unique(list) {
    const seen = {};
    const out = [];
    list.forEach(function (item) {
      if (seen[item]) return;
      seen[item] = true;
      out.push(item);
    });
    return out;
  }

  function decideSend(input) {
    const row = input.row;
    const orderId = row ? String(row.orderId || '') : String(input.orderId || '');

    if (!row) return { action: 'alert', reason: 'order-not-found', orderId: orderId };

    const status = String(row.status || '');
    if (SHIPPABLE.indexOf(status) === -1) {
      return { action: 'alert', reason: 'not-shippable', orderId: orderId, status: status };
    }

    const already = parseNumbers(row.trackingEmailed);
    const current = unique(
      (Array.isArray(input.trackingNumbers) ? input.trackingNumbers : [])
        .reduce(function (acc, item) { return acc.concat(parseNumbers(item)); }, [])
    );
    const newNumbers = current.filter(function (n) { return already.indexOf(n) === -1; });

    if (!newNumbers.length) {
      return { action: 'skip', reason: 'no-new-numbers', orderId: orderId };
    }

    const count = parseInt(row.packageCount, 10);
    return {
      action: 'send',
      orderId: orderId,
      newNumbers: newNumbers,
      isFirst: already.length === 0,
      packageCount: isFinite(count) && count > 0 ? count : 1,
      emailedAfter: already.concat(newNumbers).join('\n')
    };
  }

  return {
    SHIPPABLE: SHIPPABLE,
    parseNumbers: parseNumbers,
    decideSend: decideSend
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/tracking-email.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole GMG suite — nothing else may break**

Run: `node --test tests/*.test.js`
Expected: PASS, 195 existing + 14 new = 209.

- [ ] **Step 6: Commit**

```bash
git add tracking-email.js tests/tracking-email.test.js
git commit -m "Decide when a tracking number owes the customer an email"
```

---

### Task 2: The shipped email template

**Files:**
- Create: `docs/emails/tracking-shipped.html`

**Interfaces:**
- Consumes: `decideSend`'s output, surfaced in the n8n node as `newNumbers`, `isFirst`, `packageCount`.
- Produces: the HTML body pasted into the `Send Tracking Email` node in Task 8.

- [ ] **Step 1: Write the template**

Create `docs/emails/tracking-shipped.html`:

```html
<!--
GOD MUSCLE GEARS — "shipped / tracking number" email
Sent by GMG - Tracking Emails when a website order gains a tracking number.

THE NUMBER IS TEXT FIRST, LINK SECOND — on purpose.
The USPS deep link often lands on a blank Akamai block page on a plain
left-click and only works reliably on Ctrl/Cmd+click. Every click in an email
is a plain click. So the number is rendered large and selectable, which always
works because it can be pasted anywhere, and the link is a convenience that may
not cooperate. Do not demote the number to link text.

This email is what makes good on the order-confirmation promise: "your tracking
number will be emailed within 24 hours (excluding weekends)".

{{ numbersHtml }} and {{ headline }} / {{ intro }} are built in the Code node so
this template holds no branching.
-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5; padding:24px 0; font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; background:#ffffff; border-radius:12px; overflow:hidden;">
        <tr>
          <td style="background:#111111; padding:20px 24px;">
            <p style="margin:0; font-size:15px; font-weight:bold; letter-spacing:2px; color:#ffffff;">GOD MUSCLE GEARS</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px 8px;">
            <p style="margin:0 0 6px; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#047857;">{{ $json.headline }}</p>
            <p style="margin:0 0 18px; font-size:22px; font-weight:bold; color:#111111;">{{ $json.greeting }}</p>
            <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:#333333;">{{ $json.intro }}</p>
            {{ $json.numbersHtml }}
            <p style="margin:0 0 18px; font-size:14px; line-height:1.6; color:#666666;">Tracking can take a few hours to show movement after the label is scanned. If the link does not load, copy the number above and paste it into the carrier's site.</p>
            <p style="margin:0 0 24px; font-size:14px; line-height:1.6; color:#666666;">Questions about your order? Message us on Telegram at <a href="https://t.me/Godmusclegear" style="color:#0088cc; text-decoration:none;">@Godmusclegear</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #e5e5e5; padding:16px 24px;">
            <p style="margin:0; font-size:12px; line-height:1.6; color:#999999;">GOD MUSCLE GEARS · <a href="https://godmusclegears.com" style="color:#999999; text-decoration:underline;">godmusclegears.com</a><br>This is an automated message about order {{ $json.orderId }}.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

- [ ] **Step 2: Commit**

```bash
git add docs/emails/tracking-shipped.html
git commit -m "Add the shipped-email template, number as text before link"
```

---

### Task 3: Sales Ops — move the number parser into lib

**Files:**
- Create: `src/lib/tracking-numbers.ts`
- Create: `src/lib/tracking-numbers.test.ts`
- Modify: `src/app/page.tsx` (delete the local `trackingNumbersFromText`, import it instead)

**Interfaces:**
- Produces: `trackingNumbersFromText(value: string): string[]` — identical behaviour to the function being moved. `page.tsx` and both new routes consume it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tracking-numbers.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { trackingNumbersFromText } from "./tracking-numbers.ts";

test("splits on newline, comma, semicolon and slash", () => {
  assert.deepEqual(trackingNumbersFromText("A1\nB2, C3;D4/E5"), ["A1", "B2", "C3", "D4", "E5"]);
});

test("trims each entry and drops blanks", () => {
  assert.deepEqual(trackingNumbersFromText("  A1 ,, \n B2 "), ["A1", "B2"]);
});

test("an empty field yields an empty list", () => {
  assert.deepEqual(trackingNumbersFromText(""), []);
});

test("a single number comes back as one entry", () => {
  assert.deepEqual(trackingNumbersFromText("9400111899223"), ["9400111899223"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `./tracking-numbers.ts`

- [ ] **Step 3: Create the module**

Create `src/lib/tracking-numbers.ts`:

```ts
// Splitting a free-text tracking field into individual numbers, and nothing
// else. Lived inside page.tsx until API routes needed it too — the same reason
// order-parser.ts exists: one parser, shared, never two that can drift.

export function trackingNumbersFromText(value: string): string[] {
  return value
    .split(/[\n,;/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Point `page.tsx` at it**

In `src/app/page.tsx`, delete the local definition (the `function trackingNumbersFromText(value: string) { … }` block near line 820) and add to the import block at the top of the file:

```ts
import { trackingNumbersFromText } from "@/lib/tracking-numbers";
```

Leave all five existing call sites unchanged.

- [ ] **Step 5: Run the tests and the build**

Run: `npm test`
Expected: PASS, including the 4 new tests.

Run: `npm run build`
Expected: compiles with no TypeScript error. **Stop the dev server first** — running a build while `next dev` is up corrupts `.next/dev/types/routes.d.ts` and the build then fails inside that generated file.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tracking-numbers.ts src/lib/tracking-numbers.test.ts src/app/page.tsx
git commit -m "Move trackingNumbersFromText into lib so routes can use it"
```

---

### Task 4: Sales Ops — the tag field and the shipments endpoint

**Files:**
- Create: `src/lib/website-shipments.ts`
- Create: `src/lib/website-shipments.test.ts`
- Create: `src/app/api/website-shipments/route.ts`
- Modify: `src/app/page.tsx` (add `websiteOrderId?` to `type Order`)

**Interfaces:**
- Consumes: `trackingNumbersFromText` from Task 3.
- Produces: `websiteShipments(orders) -> WebsiteShipment[]` where
  `WebsiteShipment = { websiteOrderId: string; orderNumber: string; trackingNumbers: string[] }`.
  Task 8's n8n workflow consumes the route's JSON array of exactly that shape.

- [ ] **Step 1: Write the failing test**

Create `src/lib/website-shipments.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { websiteShipments } from "./website-shipments.ts";

const order = (over: Record<string, unknown> = {}) => ({
  orderNumber: "Lester1001",
  trackingNumber: "A1",
  websiteOrderId: "ORDER-1",
  ...over,
});

test("a tagged order with a number is returned", () => {
  assert.deepEqual(websiteShipments([order()]), [
    { websiteOrderId: "ORDER-1", orderNumber: "Lester1001", trackingNumbers: ["A1"] },
  ]);
});

test("an untagged order is ignored - this is what keeps Beligas orders out", () => {
  assert.deepEqual(websiteShipments([order({ websiteOrderId: undefined })]), []);
});

test("a tagged order with no tracking number yet is ignored", () => {
  assert.deepEqual(websiteShipments([order({ trackingNumber: "" })]), []);
});

test("multiple numbers in one field are split", () => {
  assert.deepEqual(websiteShipments([order({ trackingNumber: "A1\nB2" })])[0].trackingNumbers, ["A1", "B2"]);
});

test("a cancelled order is excluded", () => {
  assert.deepEqual(websiteShipments([order({ cancelled: true })]), []);
});

test("a blank tag string counts as untagged", () => {
  assert.deepEqual(websiteShipments([order({ websiteOrderId: "  " })]), []);
});

test("no customer data is returned", () => {
  const keys = Object.keys(websiteShipments([order({ clientName: "Someone Real" })])[0]);
  assert.deepEqual(keys.sort(), ["orderNumber", "trackingNumbers", "websiteOrderId"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `./website-shipments.ts`

- [ ] **Step 3: Write the selector**

Create `src/lib/website-shipments.ts`:

```ts
// Which Sales Ops orders owe a website customer a tracking email, as data.
// No I/O. The route does the reading; this decides what counts.
//
// Returns NO customer data on purpose. The email address and name come from the
// GMG Orders sheet, which is the only place the customer actually typed them.

import { trackingNumbersFromText } from "./tracking-numbers.ts";

export type ShipmentSourceOrder = {
  orderNumber?: string;
  trackingNumber?: string;
  websiteOrderId?: string;
  cancelled?: boolean;
};

export type WebsiteShipment = {
  websiteOrderId: string;
  orderNumber: string;
  trackingNumbers: string[];
};

export function websiteShipments(orders: ShipmentSourceOrder[]): WebsiteShipment[] {
  const out: WebsiteShipment[] = [];
  for (const order of orders ?? []) {
    if (order?.cancelled) continue;
    const websiteOrderId = (order?.websiteOrderId ?? "").trim();
    if (!websiteOrderId) continue;
    const trackingNumbers = trackingNumbersFromText(order?.trackingNumber ?? "");
    if (!trackingNumbers.length) continue;
    out.push({ websiteOrderId, orderNumber: (order?.orderNumber ?? "").trim(), trackingNumbers });
  }
  return out;
}
```

- [ ] **Step 4: Add the field to the Order type**

In `src/app/page.tsx`, inside `type Order = { … }` (starts line 83), add after `noTrackingNeeded?: boolean;`:

```ts
  // The GMG website order this row fulfils, set by the website-order picker.
  // Absent on every Beligas order — its presence is what makes this a website
  // order and what puts it in /api/website-shipments. Optional for the same
  // reason as `cancelled`: no migration.
  websiteOrderId?: string;
```

- [ ] **Step 5: Write the route**

Create `src/app/api/website-shipments/route.ts`:

```ts
// Read-only. n8n calls this nightly to find website orders that have gained a
// tracking number. It never writes, and it returns no customer data.

import { NextResponse } from "next/server";

import { readPayload } from "@/lib/sales-ops-db";
import { websiteShipments } from "@/lib/website-shipments";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const requestSecret = new URL(request.url).searchParams.get("secret");

  if (cronSecret && authorization !== `Bearer ${cronSecret}` && requestSecret !== cronSecret) {
    return NextResponse.json({ message: "Website shipments is private." }, { status: 401 });
  }

  try {
    const payload = await readPayload();
    return NextResponse.json(websiteShipments(payload?.orders ?? []));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
```

`readPayload` and `salesOpsDbConfigured` are the real exports of `src/lib/sales-ops-db.ts` (lines 41 and 23); `readPayload` returns `SalesOpsPayload | null`, which is why `payload?.orders ?? []` is written defensively above.

- [ ] **Step 6: Run the tests and the build**

Run: `npm test`
Expected: PASS, including the 7 new tests.

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/website-shipments.ts src/lib/website-shipments.test.ts src/app/api/website-shipments/route.ts src/app/page.tsx
git commit -m "Expose website orders that have gained a tracking number"
```

---

### Task 5: Sales Ops — read the GMG Orders tab for the picker

**Files:**
- Create: `src/lib/gmg-orders-client.ts`
- Create: `src/app/api/website-orders/route.ts`

**Interfaces:**
- Consumes: `googleAccessToken`, `googleConfigured` from `src/lib/google-auth.ts`; `googleFetch` from `src/lib/google-fetch.ts`.
- Produces: `gmgOrdersConfigured(): boolean` and `readWebsiteOrders(): Promise<WebsiteOrderOption[]>` where
  `WebsiteOrderOption = { orderId, createdAt, customerName, usdTotal, items, status, packageCount }` — all strings except `packageCount: number`. Task 6's picker consumes exactly this shape from `/api/website-orders`.

- [ ] **Step 1: Write the reader**

Create `src/lib/gmg-orders-client.ts`:

```ts
// Reading the GMG storefront's Orders tab, and nothing else. No parsing of
// business meaning, no matching — that belongs to whoever calls this.
//
// Auth is the SAME refresh-token grant as sheets-client.ts: it authenticates as
// the account that OWNS that spreadsheet, so no service account and no extra
// sharing is involved. If reads start failing with invalid_grant, check the
// OAuth consent screen's publishing status FIRST.

import { googleAccessToken, googleConfigured } from "./google-auth.ts";
import { googleFetch } from "./google-fetch.ts";

const TAB_RANGE = "Orders!A:Z";
const SHIPPABLE = ["PAID", "BANK_TRANSFER"];

export type WebsiteOrderOption = {
  orderId: string;
  createdAt: string;
  customerName: string;
  usdTotal: string;
  items: string;
  status: string;
  packageCount: number;
};

export function gmgOrdersConfigured(): boolean {
  return Boolean(googleConfigured() && process.env.GMG_ORDERS_SHEET_ID);
}

export async function readWebsiteOrders(): Promise<WebsiteOrderOption[]> {
  const token = await googleAccessToken();
  const sheetId = process.env.GMG_ORDERS_SHEET_ID ?? "";

  const response = await googleFetch(
    "GMG Orders read",
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(TAB_RANGE)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );

  if (!response.ok) {
    // A 403 (not shared) and a 404 (bad tab name) are indistinguishable by
    // status alone, so surface Google's own message.
    throw new Error(`GMG Orders read failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { values?: string[][] };
  const rows = body.values ?? [];
  if (!rows.length) return [];

  // Column order is NOT assumed. The tab gains columns over time (trackingEmailed
  // and trackingEmailedAt were appended in this very feature), so everything is
  // read by header name.
  const header = rows[0];
  const at = (row: string[], name: string) => {
    const index = header.indexOf(name);
    return index === -1 ? "" : (row[index] ?? "");
  };

  return rows
    .slice(1)
    .filter((row) => SHIPPABLE.includes(at(row, "status")))
    .map((row) => ({
      orderId: at(row, "orderId"),
      createdAt: at(row, "createdAt"),
      customerName: at(row, "customerName"),
      usdTotal: at(row, "usdTotal"),
      items: at(row, "items"),
      status: at(row, "status"),
      packageCount: Number.parseInt(at(row, "packageCount"), 10) || 1,
    }))
    .filter((order) => order.orderId)
    .reverse();
}
```

- [ ] **Step 2: Write the route**

Create `src/app/api/website-orders/route.ts`:

```ts
// Candidate website orders for the picker. Guarded by the same access code as
// /api/data, because it is called from the browser, not by a cron job.

import { NextResponse } from "next/server";

import { gmgOrdersConfigured, readWebsiteOrders } from "@/lib/gmg-orders-client";

export async function GET(request: Request) {
  const expected = process.env.SALES_OPS_ACCESS_CODE;
  if (expected && request.headers.get("x-sales-ops-access-code") !== expected) {
    return NextResponse.json({ message: "Website orders is private." }, { status: 401 });
  }

  if (!gmgOrdersConfigured()) {
    return NextResponse.json({ message: "GMG Orders sheet is not configured." }, { status: 503 });
  }

  try {
    return NextResponse.json(await readWebsiteOrders());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
```

`x-sales-ops-access-code` is the header `/api/data` checks (its route, line 41), and `cloudAccessCode()` in `page.tsx` (line 889) is what sends it.

- [ ] **Step 3: Add the env var**

Add `GMG_ORDERS_SHEET_ID` to `.env.local` for local work, and in Vercel for Production. The value is the GMG storefront spreadsheet id — it is in local notes, never in this repo.

After adding it in Vercel, redeploy with fresh env:

```bash
vercel redeploy <prod-url>
```

Not `vercel --prod`, which would ship whatever is in the working tree.

- [ ] **Step 4: Verify the read against the real sheet**

Run the dev server, then:

```bash
curl -s -H "x-sales-ops-access-code: <code>" http://localhost:3000/api/website-orders
```

Expected: a JSON array containing the shippable website orders, each with a non-empty `orderId` and `customerName`, newest first. Expired orders must NOT appear.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmg-orders-client.ts src/app/api/website-orders/route.ts
git commit -m "Read the GMG Orders tab so the picker has something to show"
```

---

### Task 6: Sales Ops — the picker

**Files:**
- Create: `src/components/WebsiteOrderPicker.tsx`
- Modify: `src/app/page.tsx` (mount it in the order form)

**Interfaces:**
- Consumes: `WebsiteOrderOption` from Task 5 via `GET /api/website-orders`.
- Produces: a component with props
  `{ value?: string; takenIds: string[]; accessCode: string; onChange: (orderId: string | undefined) => void }`.

- [ ] **Step 1: Write the component**

Create `src/components/WebsiteOrderPicker.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

// Links a Sales Ops order to the GMG website order it fulfils. The link is the
// whole safety story for this feature: with it, the tracking email goes to an
// address the customer typed at checkout. Without it, something would have to
// GUESS from the name — and a repeat customer makes that a coin flip.
//
// Orders already linked elsewhere are shown disabled rather than hidden, so the
// reason one is unavailable is visible instead of mysterious.

type WebsiteOrderOption = {
  orderId: string;
  createdAt: string;
  customerName: string;
  usdTotal: string;
  items: string;
  status: string;
  packageCount: number;
};

type Props = {
  value?: string;
  takenIds: string[];
  accessCode: string;
  onChange: (orderId: string | undefined) => void;
};

export function WebsiteOrderPicker({ value, takenIds, accessCode, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<WebsiteOrderOption[] | null>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/website-orders", {
          headers: { "x-sales-ops-access-code": accessCode },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as WebsiteOrderOption[];
        if (!cancelled) setOptions(data);
      } catch (cause) {
        // The feature must stay usable when the sheet read fails, so the manual
        // box below is the fallback rather than a dead end.
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [open, options, accessCode]);

  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded bg-emerald-100 px-2 py-1 font-mono text-emerald-900">{value}</span>
        <button type="button" className="text-red-600 underline" onClick={() => onChange(undefined)}>
          unlink
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="text-sm text-blue-600 underline" onClick={() => setOpen(true)}>
        Link website order
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-slate-300 p-3">
      {error && <p className="text-sm text-red-600">Could not load website orders: {error}</p>}
      {!options && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {options?.map((option) => {
        const taken = takenIds.includes(option.orderId);
        return (
          <button
            key={option.orderId}
            type="button"
            disabled={taken}
            onClick={() => { onChange(option.orderId); setOpen(false); }}
            className={`block w-full rounded border p-2 text-left text-sm ${taken ? "cursor-not-allowed opacity-40" : "hover:bg-slate-50"}`}
          >
            <span className="font-medium">{option.customerName}</span>{" "}
            <span className="text-slate-500">
              {option.createdAt.slice(0, 10)} · ${option.usdTotal} · {option.status}
              {option.packageCount > 1 ? ` · ${option.packageCount} parcels` : ""}
            </span>
            <span className="block truncate text-xs text-slate-500">{option.items}</span>
            {taken && <span className="block text-xs text-amber-700">already linked to another order</span>}
          </button>
        );
      })}

      {options?.length === 0 && <p className="text-sm text-slate-500">No shippable website orders.</p>}

      <div className="flex gap-2 pt-1">
        <input
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          placeholder="or paste an order id"
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          className="rounded bg-slate-800 px-2 py-1 text-sm text-white"
          onClick={() => { const id = manual.trim(); if (id) { onChange(id); setOpen(false); } }}
        >
          Use
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Carry the field through the form's four touch points**

All four are in `src/app/page.tsx`. Miss one and the tag silently fails to save or silently fails to load.

**(a)** Add the import at the top:

```tsx
import { WebsiteOrderPicker } from "@/components/WebsiteOrderPicker";
```

**(b)** `blankOrderForm()` (line 662) — add as the last entry, after `estimatedDelivery: ""`:

```ts
    websiteOrderId: "",
```

**(c)** The edit-load `setOrderForm({ … })` (line 1755) — add after `estimatedDelivery: order.estimatedDelivery,`:

```ts
      websiteOrderId: order.websiteOrderId ?? "",
```

**(d)** The `orderValues: Order` object built on save (line ~1709, just after `const trackingNumber = trackingNumbersFromText(…)`) — add:

```ts
      // Empty string means untagged. Store undefined rather than "" so an
      // untagged order looks exactly like every pre-existing one.
      websiteOrderId: orderForm.websiteOrderId.trim() || undefined,
```

**(e)** Render the picker in the order form, beside the tracking-number input (the form's inputs start around line 4550):

```tsx
<label className="block text-sm font-medium">Website order</label>
<WebsiteOrderPicker
  value={orderForm.websiteOrderId || undefined}
  takenIds={orders
    .filter((order) => order.id !== editingOrderId)
    .map((order) => order.websiteOrderId ?? "")
    .filter(Boolean)}
  accessCode={cloudAccessCode()}
  onChange={(websiteOrderId) =>
    setOrderForm({ ...orderForm, websiteOrderId: websiteOrderId ?? "" })
  }
/>
```

`cloudAccessCode()` (line 889) is the same helper `readCloudDatabaseData` uses, so the picker authenticates exactly like every other call from this page.

- [ ] **Step 3: Verify in the browser**

Run the dev server and open the app. Expected:
1. "Link website order" appears on the order form.
2. Clicking it lists shippable website orders, newest first, with name, date, total and items.
3. Picking one shows the id with an "unlink" control.
4. Saving, reloading, and reopening the order still shows the linked id.
5. Opening the picker on a second order shows the first one's id greyed out as "already linked to another order".

- [ ] **Step 4: Build and commit**

Run: `npm run build` (dev server stopped) — expected: clean.

```bash
git add src/components/WebsiteOrderPicker.tsx src/app/page.tsx
git commit -m "Link a Sales Ops order to the website order it fulfils"
```

---

### Task 7: Add the two columns to the Orders tab

**Files:** none in git — this is a data change to the live spreadsheet.

**Interfaces:**
- Produces: headers `trackingEmailed` and `trackingEmailedAt` at the end of the Orders tab's header row. Task 8 reads and writes both by name.

- [ ] **Step 1: Read the current header row**

Using the local `gdrive` OAuth token (`C:\Users\LESTER\.gdrive-token.json` with `C:\Users\LESTER\gdrive-credentials.json`), read `Orders!A1:Z1` and confirm it currently ends at `discountLine` with 24 columns.

- [ ] **Step 2: Append the two headers**

Write `trackingEmailed` and `trackingEmailedAt` into the first two empty header cells after the last populated one — **append only**. Do not reorder, rename, or insert columns: every n8n Sheets node maps by header name, and a reorder also strips validation and formatting from the moved cells.

- [ ] **Step 3: Verify nothing else moved**

Re-read `Orders!A1:Z1` and confirm the first 24 headers are byte-identical to Step 1 and the two new ones follow. Then re-read a known data row and confirm its values are unchanged.

- [ ] **Step 4: Confirm the live workflows still run**

Wait for one `GMG - Payment Watcher` execution (it runs every 2 minutes) and confirm status `success`. The watcher reads and writes this tab, so a green run after the change proves the append was harmless.

---

### Task 8: The n8n workflow

**Files:** none in git — built through the n8n MCP tools.

**Interfaces:**
- Consumes: `GET /api/website-shipments` (Task 4), `tracking-email.js` (Task 1), `docs/emails/tracking-shipped.html` (Task 2), the two columns (Task 7).
- Produces: workflow `GMG - Tracking Emails`.

- [ ] **Step 1: Create the workflow with the send node DISABLED**

Nodes, in order:

1. **Schedule 21:30 Manila** — a Schedule Trigger. Workflow setting `timezone: Asia/Manila`, and `errorWorkflow` set to the shared error handler, matching the other three GMG workflows.
2. **Fetch Shipments** — HTTP Request, GET the Sales Ops endpoint with the secret as a query parameter, `AbortSignal` equivalent: set the node's timeout to 10000 ms. A hang must fail, not block forever.
3. **Read Orders** — Google Sheets read, the merged spreadsheet, tab `Orders` by NAME, `returnAllMatches` on, service-account auth, the same credential the other GMG workflows use.
4. **Decide Sends** — a Code node holding `tracking-email.js` **pasted verbatim**, then below it the glue that, for each shipment, finds its Orders row by `orderId`, calls `decideSend`, and emits one item per decision carrying `action`, `orderId`, plus for a send: `newNumbers`, `isFirst`, `packageCount`, `emailedAfter`, `customerEmail`, `customerName`, and the three presentation strings the template expects — `headline`, `greeting`, `intro`, `numbersHtml`. Build `numbersHtml` here so the template carries no branching: each number as a large selectable line with the USPS link beneath it.
5. **Route Decision** — a Switch on `action`: `send` → the email, `alert` → the alert, `skip` → nothing.
6. **Send Tracking Email** — emailSend, the GMG SMTP credential, from `GOD MUSCLE GEARS <admin@godmusclegears.com>`, subject built from `isFirst`, body = the Task 2 template. **Set `onError: continueErrorOutput`.** Start this node **disabled**.
7. **Stamp Emailed** — Google Sheets update on `Orders`, matching column `orderId`, writing `trackingEmailed` = `emailedAfter` and `trackingEmailedAt` = now in Manila time with no offset. `onError: continueErrorOutput`.
8. **Alert Tracking Issue** — Telegram to the owner chat, naming the order id, the reason, and that nothing was sent.
9. **Alert Send Failed** — Telegram, fed by the error outputs of nodes 6 and 7. Its text must reference **only this branch's own data**, never another node's items.

- [ ] **Step 2: Verify the module was pasted byte-identically**

Fetch the workflow back and compare the pasted region of the Code node against `tracking-email.js` with sha256. They must match. A hand-retyped copy is how a tested module silently diverges from the one that runs.

- [ ] **Step 3: Dry run with the send disabled**

Tag one real website order in Sales Ops, give its Sales Ops row a tracking number, then execute the workflow manually. Expected: `Decide Sends` emits one `send` decision with the right `orderId`, `newNumbers`, `isFirst: true`, and a `customerEmail` that matches the sheet. No email leaves, because node 6 is disabled. Nothing is stamped.

- [ ] **Step 4: Verify the alert paths**

Temporarily point one shipment at a non-existent order id and re-run: expected one `alert` decision, reason `order-not-found`, no send. Then point it at an `EXPIRED` order: expected reason `not-shippable`. Undo both.

- [ ] **Step 5: Do NOT publish yet**

Leave the workflow unpublished until Task 9. An unpublished workflow does not run on its schedule.

---

### Task 9: Go live

- [ ] **Step 1: Enable the send node and publish**

Enable `Send Tracking Email`, then publish the workflow. Confirm `activeVersionId` equals `versionId` afterwards — a draft that is not published is not what runs.

- [ ] **Step 2: Run the owner's sample order end to end**

The owner places a real sample order on the website, tags it in Sales Ops, and gives it a tracking number. Run the workflow manually.

Expected, all four:
1. the email arrives at the address on the order, with the number as selectable text;
2. `trackingEmailed` on that row holds the number;
3. `trackingEmailedAt` holds a Manila timestamp;
4. a second manual run sends nothing and says nothing.

- [ ] **Step 3: Prove the second-parcel path**

Add a second tracking number to the same Sales Ops order and run again. Expected: one email carrying **only** the new number, worded as a follow-up, and `trackingEmailed` now holding both.

- [ ] **Step 4: Schedule it**

Only once Steps 2 and 3 have both passed, create the 21:30 Asia/Manila job on cron-job.org in the same account as the existing Sales Ops jobs, with "save responses in job history" and "notify on failure" both ON.

Note the two traps that account has already cost time: the timezone defaults to Asia/Shanghai and must be changed on the ADVANCED tab, and the form is React-controlled — setting fields programmatically silently reverts, so type into them.

- [ ] **Step 5: Update the memory cards**

Record in `ecommerce-stores.md` and `sales-ops-webapp.md`: the new workflow and its id, the two new columns, the `websiteOrderId` field, the two new endpoints, the env var name, and the cron job. Note explicitly that the 24-hour promise in the confirmation email is now kept by automation rather than by hand.

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Sales Ops owns the tag, n8n owns the sending | 4, 6, 8 |
| `websiteOrderId?` optional, no migration | 4 |
| Two appended columns, header-name mapping | 7 |
| Read-only secret-gated shipments endpoint | 4 |
| Picker list source + greyed-out linked ids + manual fallback | 5, 6 |
| `trackingNumbersFromText` extracted, one parser | 3 |
| Send rule incl. `BANK_TRANSFER` and the status gate | 1 |
| Send first then stamp, loud on stamp failure | 8 |
| Silence when nothing to do | 1, 8 |
| Number as text before link | 2, 8 |
| First vs follow-up wording; parcel-count line | 1, 2, 8 |
| Own alert node, not a shared one | 8 |
| Nine behavioural cases unit-tested | 1 |
| `/api/tracking-import` untouched | all — no task modifies it |
| Rollout order, inert first | 4–9 |
