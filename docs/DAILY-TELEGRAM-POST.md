# Daily Telegram post — how one card reaches the group

> **No spreadsheet IDs, chat IDs, bot handles, tokens or credential names in this
> file.** This repository is public. The identifiers live in local notes, not here.

Every morning at 09:00 Manila one product or blog card is posted to the customer
Telegram group: a photo with a caption, drawn from a 45-row content sheet.

It ran on Make.com until 2026-10-02. It now runs on n8n, in the same instance as
the order and payment workflows.

## The chain

```
Schedule 09:00 Manila → read all 45 rows → pick today's row → HEAD-check the image
                                                                      │
                                                   200 ───────────────┤
                                                                      │
                                       send photo + caption → stamp Status
                                                                      │
                                              not 200 ────────────────┘
                                                                      │
                                                     alert the owner, post nothing
```

Five steps. The only one that writes to the group is gated behind the image
check, and the only one that writes to the sheet is gated behind a successful
send. Nothing is ever stamped as posted unless it actually posted.

### What lives where

| | |
|---|---|
| **Content** | A tab of 45 rows, `Day \| Title \| Caption \| Image_URL \| Status`. **Since 2026-10-16 it lives in the storefront inventory spreadsheet**, not a file of its own — see `INVENTORY-SYNC.md`. |
| **Images** | Served from this repo's `images/` directory, i.e. the live site. |
| **Links** | Captions point at per-product pages (`/p/<id>.html`), blog guides, `proofs.html` or `peptide-calculator.html`. See `INVENTORY-SYNC.md` siblings and the product-pages design doc. |
| **Schedule + logic** | An n8n workflow. Its Code node holds the cycle length and the epoch date. |
| **Status column** | An **audit stamp** (`YYYY-MM-DD posted`), written after a successful send. |

## The row is chosen by date, not by a pointer

```
day = ((daysSince(EPOCH) mod 45) + 45) mod 45 + 1
```

evaluated in `Asia/Manila`. There is no "next row" marker anywhere.

This matters more than it sounds. A stored pointer can desync — if a write fails
after a send, or a human edits the column, the queue either repeats a day or
skips one, silently. Date arithmetic cannot drift: whatever happened yesterday,
today's row is a pure function of today's date.

Three consequences:

- **A missed day is skipped, not queued.** If the instance is down at 09:00, that
  day's card is simply never posted. Correct for a content calendar — nobody
  wants three days of backlog dumped at once on recovery.
- **Running twice in one day is a no-op.** The Code node compares `Status`
  against today's date and returns zero items if it already posted.
- **Clearing the `Status` column cannot break the cycle.** It only erases the
  audit trail.

**If you add or remove rows, change `CYCLE` in the Code node to match.** The
arithmetic does not count the sheet — a mismatch makes it ask for a row number
that does not exist, and the node throws.

## Why the image is checked first

Telegram's `sendPhoto` rejects a URL that does not resolve, and the whole run
fails. So the image is fetched with `HEAD` first, with "never error" set, and the
status code is branched on. A dead image produces an owner alert naming the day,
the title and the HTTP code — and **the row is deliberately not stamped**, so the
problem is still visible in the sheet.

This is not hypothetical. It is exactly what took the automation down:

### What happened in September 2026

The cycle wrapped round to Day 1 and hit three rows whose `Image_URL` ended in
`.png` while the files on the site were `.jpg`. Three consecutive failures, three
days running. Make then **deactivated the scenario itself** and stopped — last
successful post Sep 27, nothing at all after Sep 30.

The failure was invisible for two reasons worth remembering:

1. **It was off, not broken.** Make switches a scenario off after consecutive
   errors rather than emailing and carrying on. "Nothing posted today" looked
   like a scheduling glitch, not a dead automation.
2. **The platform left no local trace.** Nothing in this repo, the n8n instance,
   the OS scheduler or any config file referenced it.

The n8n rebuild addresses the first directly: the workflow is wired to the shared
error handler, so a failure messages the owner on day one.

## Traps

**Image extensions are mixed.** `images/` holds `.jpg`, `.png` and `.webp`, and
the extension does not follow from the product name. When adding a row, copy the
filename — never guess it. Verify the URL returns 200 before saving.

**Captions cap at 1024 characters**, not 4096. That is Telegram's limit for a
photo caption specifically; a text message gets the larger budget. Exceeding it
fails the send.

**The n8n Executions list renders every timestamp in UTC**, regardless of the
workflow timezone. The 09:00 Manila run appears as `01:00`. That is correct — do
not "fix" the schedule because of it.

**A changed trigger time only applies on publish.** Editing the schedule of a
published workflow does nothing until it is unpublished and published again.

**The service account needs Editor, not Viewer.** The content sheet is
link-viewable, so reads succeed even when the service account was never granted
access at all — and the failure only surfaces at the write step, at the very end
of the run. A working read proves nothing about write access.

**Only FAILURES are stored.** This workflow runs with
`saveDataSuccessExecution: none`, so a healthy run leaves no execution record at
all. An empty executions list does not mean it never ran — it usually means the
opposite. **Read the `Status` column to see what actually posted**, never the
executions list.

**A send failure raises no Telegram alert of its own.** The alert node hangs off
the *image check* only. If the send itself fails — a bad chat, a restricted bot
— nothing fires except the shared error handler. Worth a second alert branch off
the send node; not built yet.

### The group moved, and the send broke with it (2026-10-16)

The 09:00 run failed with `400 Bad Request: CHAT_RESTRICTED`. Everything
upstream was fine: 45 rows read, the day picked, the image returning 200. Only
the send failed, because the customer group had been replaced and the bot was no
longer able to post to the old chat. **Day 14 never went out**, and the previous
day had posted normally, so this broke the same day the group changed.

The fix was to address the chat **by its public username rather than a numeric
id**. The Bot API accepts `@username` for a public chat, so no id lookup is
needed — and, unlike a numeric id, it survives the group being recreated again.
The old and new groups had completely different ids, which is what proved the
group had been replaced rather than renamed.

**If this recurs:** the bot must be a *member* of the target group with
permission to send. Check that before touching the workflow. Note the group is a
**forum** (topics enabled) — a send with no thread id lands in General, which is
what we rely on. If General is ever closed or posting is restricted to topics,
the send node will need a `message_thread_id`.

## Changing the content

| To change… | Do this |
|---|---|
| A caption or image | Edit the sheet. No deploy, no workflow change. |
| The posting time | Edit the schedule, then **unpublish and republish**. |
| The number of rows | Edit the sheet **and** `CYCLE` in the Code node. |
| Which day falls when | Move `EPOCH` in the Code node. `EPOCH` is Day 1. |
| Add a product image | Add it to `images/`, deploy, then reference it. The sheet points at the live site, so an undeployed image is a dead link. |
| Which chat it posts to | Edit the send node's chat. Prefer the public `@username` over a numeric id — the id changes if the group is ever recreated, the username does not. |
