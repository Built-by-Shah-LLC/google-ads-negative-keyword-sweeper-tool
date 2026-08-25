# Read this for the standalone MCC negatives sweeper — allowlist, no Hub

This is a **separate** script from the Hub/Spoke Search and PMax negatives sweepers.

| | Hub/Spoke sweepers | This standalone sweeper |
|---|---|---|
| File | `built-by-shah-mcc-search-negatives-sweeper.js` + PMax twin | `built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` |
| On/off | Hub columns | `CONFIG.ACCOUNT_ALLOWLIST` in the script |
| Logging / undo | Spoke **Negatives Audit** (Reviewed / Remove) | Morning **HTML email + decision-audit CSV**; undo in Google Ads UI |
| Sheets | Hub + Spoke required | **None** |
| Channels | Two scripts | **Search + PMax in one script** |

Do **not** put the same Account ID on this allowlist **and** turn on Hub **Negatives Sweeper Enabled** for that shop. You would risk double-adding the same exact negatives.

## Two scripts (do not mix them up)

| | **Daily negatives sweeper (ongoing)** | **Backfill negatives sweeper (one-time)** |
|---|---|---|
| Final file | `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` | `scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js` |
| Lookback | **Rolling seven completed days**, ending yesterday | About the **last 90 days** |
| Schedule | **Daily at 7:00 AM Pacific or later** | **Run once** (or until all shops labeled); do **not** leave on Daily |
| Done label | `BbsStandaloneNeg:yyyy-MM-dd` (date-based) | `BbsStandaloneNegBackfill` (permanent) |
| Email | One summary email per wave | Wave summary + per-shop detail emails |

Temporary KC prefill (delete when done): `scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-kc-today-v1.1.0.js`

---


Rule IDs and triggers match the Hub/Spoke sweeper guide: [Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md](./Read%20this%20for%20the%20Search%20negatives%20sweeper%20-%20auto-add%20review%20and%20remove%20on%20the%20spoke.md).

---

## New or existing shops — run backfill once first

The daily sweeper automatically retries the **last seven completed days**. That overlap catches search terms Google publishes late. It does not replace the one-time backfill for older search terms from weeks or months ago.

Before you schedule the daily sweeper (or when you add shops that have already been advertising for a while), run the **one-time 90-day backfill** once:

1. Paste `scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js` into its own MCC Scripts row.
2. Use the **same** `ACCOUNT_ALLOWLIST` and email settings you will use for daily.
3. **Run** (and run a second wave if you have more than 50 allowlisted shops) until every shop has the permanent label `BbsStandaloneNegBackfill` (or your `BACKFILL_DONE_LABEL`) and/or the email says the catch-up queue is empty.
4. Then paste/schedule the **daily** script (`built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js`).

Do **not** leave the backfill script on a Daily schedule. The backfill email subject is labeled **Backfill (90-day)** so you can tell it apart from the morning daily email.

Shops or campaigns with less than 90 days of history are fine. Google Ads only returns the search terms that exist in that window. Missing early days are empty results, not errors — the account can still finish and get the done label (including with zero adds).

### Done label (so the script knows who already finished)

After a **clean** finish, the script stamps an **account label** named exactly:

`BbsStandaloneNegBackfill`

Where to see it:

1. Open the **MCC** (manager account), not only the child account.
2. Go to the **Accounts** list (all client accounts).
3. Customize columns and show **Labels** (if the column is hidden).
4. Or check **Tools → Shared library → Labels** / account labels for `BbsStandaloneNegBackfill`.

If you do **not** see that label on a shop, the script never stamped it done (Preview, failures, or safety ceiling). Those shops are **not** skipped on the next Run.

### Caps (what is limited vs what is not)

- **Scanning search terms is uncapped.** The script loads and scores every Search + PMax term in the lookback window (with impressions).
- **Adds are capped per channel per run** so a bad rule cannot melt the Ads Scripts clock:
  - Backfill defaults: **50,000** eligible adds per channel (Search and PMax separately).
  - Daily sweeper defaults: **2,500** per channel.
- If a shop hits the ceiling, it is **not** stamped done — Run again and it continues (already-added exacts are skipped).
- **Emails**
  - **Daily:** one summary email per wave (up to 50 shops). It shows raw Search/PMax rows, unique campaign terms, and terminal decision counts that reconcile exactly. It lists adds, matched-but-skipped reasons, and **Manual review** terms (queries that matched junk rules but are over 80 characters or 10 words — not auto-added). A bounded CSV attachment includes every retained unique term, including `NO_RULE` rows. The email warns if the audit cap truncates row details.
  - **Backfill:** one wave summary **plus** per-shop detail emails (split into parts when a shop has many adds), because 90-day catch-up can be huge. Manual review terms are listed there too for paste into Ads.

To force a full re-run of already-labeled shops: set `IGNORE_DONE_LABEL: true` in CONFIG, Run, then set it back to `false`. Or remove the label from those accounts in the MCC Accounts list.

Temporary prefilled paste (4 KC shops + emails already filled):  
`scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-kc-today-v1.1.0.js`  
Delete that Scripts row when catch-up is done. Keep logic changes on the generic final backfill file (`…-backfill-negatives-sweeper-final-v1.1.0.js`), then refresh the KC prefill from it if you still need it.

---

## Install

### Daily sweeper (ongoing)

1. At the **MCC** → Tools → Scripts, create a new script. Name it clearly, e.g. `Standalone Negatives Daily (Search + PMax)`.
2. Paste `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js`.
3. Fill `CONFIG.ACCOUNT_ALLOWLIST` with the Google Ads Account IDs you want (dashes OK) — usually the same list as backfill.
4. Fill `CONFIG.EMAIL_RECIPIENTS` (one or more emails).
5. Major auto insurer names are protected automatically in the script (State Farm, GEICO, Progressive, etc.) so those queries are not negatived. AAA protection is context-aware: `AAA insurance`, claims, approved-body, and collision intent stay protected, while mechanical junk such as `aaa auto repair` can still be excluded. Optionally set global `DISABLED_RULE_IDS`, `PROTECTED_PHRASES`, `COMPETITOR_PHRASES`, and/or `ACCOUNT_OVERRIDES` for one shop. **v1.3.0+** uses plural/stem-aware matching and negatives clear junk (Spanish, estimates, paint/refinish, buffing, clear coat, dashboard repair, mechanical-only, and narrow vehicle-plus-place searches such as `car in dallas`). Named competitors are only auto-negatived when confidence is high (possessives, multi-word brands, or names in `COMPETITOR_PHRASES`). **City + body shop / collision geo intent is kept.** Ambiguous single-token names (could be a city or a shop) are left alone on purpose — add known one-word competitors to `COMPETITOR_PHRASES` if you still want them blocked.
6. Authorize, then **Run** once to confirm the single summary email + any adds / Manual review rows.
7. Schedule **Frequency: Daily** at **7:00 AM Pacific or later**. Google says prior-day Search terms are normally ready around 6:00 AM in each account’s local time. An earlier Pacific run can be too early for Pacific and Central shops.
8. Keep the **backfill** script off Daily schedule. When catch-up is finished, pause or delete the temporary `…-kc-today.js` Scripts row if you used it.

### More than 50 accounts

Google caps `executeInParallel` at **50 accounts per run**. This script auto-takes the next ≤50 allowlisted accounts that are not yet done today.

- Queue state is an **account label** named like `BbsStandaloneNeg:2026-08-20` (prefix + date in `QUEUE_TIME_ZONE`).
- With ~70 shops, add a **second** Scripts row with the **identical** code and the **same** allowlist (for example 7:00 and 8:00 AM Pacific). Wave 2 picks up whoever wave 1 already labeled as done.
- Rule of thumb: `ceil(allowlistSize / 50)` scheduled runs each day.

You get **one email per wave**. That is expected when you need two morning runs.

---

## What it does each morning

1. Reads the **last seven completed days** of Search and PMax search terms (each account’s time zone) that had impressions. The window always ends yesterday. Search uses `search_term_view`; PMax uses `campaign_search_term_view` (Google’s campaign-level view — plain `search_term_view` does not include Performance Max). PMax exact negatives are added with `AdsApp.mutateAll` (campaign criterion create); Scripts’ `PerformanceMaxCampaign` object has no `negativeKeywords()` / `createNegativeKeyword()`, so coverage is read via GAQL.
2. Skips any campaign whose name does **not** include `Built by Shah` (CONFIG `REQUIRED_CAMPAIGN_NAME_SUBSTRING`, case-insensitive) so other campaigns in a mixed account are left alone.
3. Applies the same junk-intent rules as the Hub sweepers (exact full-query campaign negatives only).
4. Skips terms that converted in the seven-day action window or the 30-day history guard, already-covered negatives, and Google ADDED/EXCLUDED statuses.
5. On success, stamps today’s done label on that account.
6. Emails a summary with a reconciled decision funnel and attaches a CSV. Every unique evaluated campaign term receives exactly one decision: `ADDED`, `NO_RULE`, `PROTECTED`, `GOOGLE_STATUS`, `CONVERTED_ACTION_WINDOW`, `CONVERTED_HISTORY`, `ALREADY_COVERED`, `WRONG_CAMPAIGN_NAME`, `MANUAL_REVIEW`, `FAILED`, or `HIT_SAFETY_CEILING`.

Mistakes: delete the exact negative in Google Ads (campaign level). There is no Remove checkbox sheet.

### How to confirm adds actually landed

Scripts **Details** often leaves **Account / Campaign / Ad group** columns blank when negatives are added with `AdsApp.mutateAll` (batch API). That is a Google Ads Scripts UI quirk — the Change JSON still shows `campaign_criterion` adds with `"negative": true`.

Reliable check: open the **client account** → the **Built by Shah** campaign → **Negatives** → search for an exact match from the email (example: `[paint and body shop near me]`).

Do **not** rely only on the child account’s Change history view; script batch mutates are easy to miss there.

---

## The morning email

The HTML email uses the same visual language as the Hub Engine status email:

- Navy **Built by Shah** header and “For internal use only” pill
- Wave snapshot tiles (accounts / added / failures / manual review)
- Reconciled raw-row, unique-term, and terminal-decision counts
- Green “Added” account cards with exact negatives and rule IDs
- Matched-but-skipped rows with their exact safe reason
- Red failure callouts when something could not be added
- A bounded decision-audit CSV attachment, including `NO_RULE` vocabulary gaps

Open a sample in your browser:

[Open this in a browser to preview the Search Negatives Sweep email.html](./Open%20this%20in%20a%20browser%20to%20preview%20the%20Search%20Negatives%20Sweep%20email.html)

Full plain-language walkthrough (what the script does, every rule, many keyword examples):

[Open this in a browser - Standalone Negatives Sweeper explained.html](./Open%20this%20in%20a%20browser%20-%20Standalone%20Negatives%20Sweeper%20explained.html)

If nothing was added, you still get a short all-clear email so you know the job ran. If `EMAIL_RECIPIENTS` is empty, the script still adds negatives but skips the email.

---

## CONFIG cheat sheet

```javascript
ACCOUNT_ALLOWLIST: ['123-456-7890', '123-456-7890'],
DISABLED_RULE_IDS: ['YEAR_TOKEN'],           // global
PROTECTED_PHRASES: ['specialty coating'],    // global
COMPETITOR_PHRASES: ['rival body shop'],     // global + seeds
ACCOUNT_OVERRIDES: {
  '1234567890': {
    DISABLED_RULE_IDS: ['AUTO_GLASS'],
    PROTECTED_PHRASES: ['mobile repair'],
    COMPETITOR_PHRASES: ['local rival']
  }
},
EMAIL_RECIPIENTS: ['user@example.com'],
QUEUE_TIME_ZONE: 'America/Los_Angeles',
ACTION_WINDOW_DAYS: 7,                         // keep rolling seven completed days
REQUIRED_CAMPAIGN_NAME_SUBSTRING: 'Built by Shah'  // skip campaigns without this in the name
```

The Ads **account name** is always treated as a protected phrase for that shop. Campaign names must include `Built by Shah` (or your configured substring) or that campaign is skipped.

### Recovery run after deploying v1.3.0

1. Paste the updated daily script into every standalone sweeper Scripts row.
2. Remove that day’s `BbsStandaloneNeg:yyyy-MM-dd` label from the affected accounts, or wait until the next day.
3. Run after **7:00 AM Pacific**.
4. Confirm the email decision counts equal the unique terms evaluated and open the attached CSV.
5. Search the CSV for the supplied terms. Each one should be `ADDED`, already covered/status, converted, protected for a documented account-aware reason, or explicitly failed/manual review.

The rolling window automatically recovers the prior seven completed days. Run the separate 90-day backfill again only when you want to recover older vocabulary gaps; existing coverage checks prevent duplicate exact negatives.

For rule maintenance, edit the standalone daily script as the canonical source, then run:

```bash
node scripts/sync-negative-sweeper-rule-blocks.js
node scripts/test-negative-sweeper-contract.js
```

The contract fails if the daily, both backfills, Hub Search, or Hub PMax rule definitions or helper behavior drift apart.

---

## MCC vs child account

This script is designed for the **MCC** with an in-script allowlist so you maintain one paste. An MCC script does **not** have to hit every client — only IDs on the allowlist run.

If you only want one shop, put only that ID on the allowlist (or remove it to turn the shop off).
