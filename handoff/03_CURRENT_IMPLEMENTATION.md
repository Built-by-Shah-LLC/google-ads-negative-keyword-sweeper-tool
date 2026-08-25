# 03 — Current implementation

Line numbers refer to `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` unless a sibling path is given. This describes **CURRENT CODE BEHAVIOR**, not desired policy.

---

## Entry points

| Script | Entry | Role |
|---|---|---|
| Standalone daily | `function main()` line 1052 | MCC orchestrator |
| Standalone backfill | `main()` (same pattern; 90-day window, permanent label, extra emails) | One-time catch-up |
| Hub Search | `main()` `built-by-shah-mcc-search-negatives-sweeper.js` 867 | Hub-driven Search only |
| Hub PMax | `main()` `built-by-shah-mcc-pmax-negatives-sweeper.js` | Hub-driven PMax only |
| Local test | `node scripts/test-negative-sweeper-contract.js` | Parity + regressions |
| Rule copy | `node scripts/sync-negative-sweeper-rule-blocks.js` | Copy canonical blocks into siblings |

Ads Scripts ignore the CommonJS export at daily 4299–4319.

---

## Plain-text flow (standalone daily)

```
main()
  validateConfig_()
  if ACCOUNT_ALLOWLIST empty -> log, return
  today = formatDate(now, QUEUE_TIME_ZONE)
  doneLabel = DONE_LABEL_PREFIX + ':' + today
  dueIds = allowlisted MCC accounts missing doneLabel, sorted, slice 0..50
  if none due:
    if not Preview: sendSummaryEmail_(waveEmpty)
    return
  executeInParallel('processAccount', 'allFinished', JSON{runId, preview, today, doneLabel, overrides})

processAccount (child account)
  merge overrides + Ads account name into protected/competitor lists
  dateWindow = last ACTION_WINDOW_DAYS completed days ending yesterday
                + history from HISTORICAL_GUARD_DAYS through yesterday
                [account time zone]
  searchRows = GAQL search_term_view SEARCH
  pmaxRows   = GAQL campaign_search_term_view PERFORMANCE_MAX
  aggregate unique (channel, campaignId, normalized term)
  candidates = actionImpressions >= 1, sort spend then clicks then imps
  for each candidate:
    if campaign name lacks REQUIRED_CAMPAIGN_NAME_SUBSTRING -> WRONG_CAMPAIGN_NAME
    evaluateRules_
    if no match -> NO_RULE or PROTECTED (if protection string set without eligible rules)
    if matched but shouldExclude false -> PROTECTED
    if Google search-term status ADDED/EXCLUDED -> GOOGLE_STATUS
    if actionConversions > 0 -> CONVERTED_ACTION_WINDOW
    if historyConversions > 0 -> CONVERTED_HISTORY
    prepareExactNegative_ (sanitize, 80 chars / 10 words)
      fail length -> MANUAL_REVIEW
    resolve campaign; PMax assert methods
    findBlockingNegative_ (campaign + shared lists)
      hit -> ALREADY_COVERED
    else queue mutateAll EXACT campaign negative; reserve cache
  flushPendingExactNegatives_
  ensureDecisionReconciliation_ (every candidate has one decision)
  success = !hadFailure && !hitSafetyCeiling
  return JSON

allFinished
  if not Preview:
    stampDoneLabels_ only when success && customerId && !hitSafetyCeiling
    sendSummaryEmail_ (HTML + CSV)
  log ACCOUNT_RESULT lines
```

Hub Search/PMax differ: Hub due-queue; spoke Remove first; **no campaign-name substring**; Hub Preview **returns immediately** without scoring (`search-negatives-sweeper.js` 939–944); Search add via `createNegativeKeyword`; PMax Hub still calls `createNegativeKeyword` after `assertPMaxNegativeMethods_` (likely throws on real PMax objects); no MailApp; stamp Hub LSR columns.

---

## Important functions (standalone daily)

| Function | Lines | Responsibility |
|---|---|---|
| `main` | 1052–1106 | Validate, select due accounts, parallel dispatch |
| `allFinished` | 1109–1205 | Parse worker JSON, stamp labels, email, log |
| `processAccount` | 1207–1632 | Full per-account pipeline |
| `selectDueAllowlistedAccounts_` | 1634–1649 | Allowlist ∩ unlabeled, cap 50 |
| `accountHasLabelName_` | 1652–1664 | Read MCC labels |
| `stampDoneLabels_` | 1667–1707 | Apply date label on success only |
| `findManagerAccountByCustomerId_` | 1710–1726 | Label apply lookup |
| `ensureAccountLabelExists_` | 1729–1736 | Create MCC label if missing |
| `buildOverridesPayload_` / `mergeAccountOverride_` | 1738–1774 | Disabled IDs, protected, competitors |
| `filterAndSortCandidates_` | 1776–1788 | Min impressions + spend sort (re-sorted later PMax-first) |
| `pushAction_` | 1791–1815 | Cap email/log action rows |
| `recordTermDecision_` | 1836+ | One terminal decision per channel\|campaign\|term |
| `ensureDecisionReconciliation_` | ~1889 | Invariant: decisions == unique candidates |
| `querySearchTermsByChannel_` | 1950–2008 | GAQL + PMax fallback |
| `aggregateSearchTerms_` | 2011–2072 | Dedup and split action vs history metrics |
| `evaluateRules_` | 2074–2126 | Trigger/exception/protect |
| `isGenericBodyIntent_` | 2137–2180 | Exact generic maps after stripping near me |
| `isOemCollisionKeepIntent_` | 2183–2219 | OEM + collision/body shop + allowed fillers |
| `evaluateNamedLocalShop_` | 2229–2278 | Possessive / 2+ name bits |
| `namedShopNameBits_` | 2282–2304 | Strip places and fillers |
| `isGeoBodyShopIntent_` | 2311–2324 | Service words + zero name bits |
| `evaluateDealerOrAutoGroup_` | 2328–2357 | Trigger list + OEM service |
| `evaluateBareMakeModel_` | 2360–2370 | Entire query is make tokens |
| `evaluateLowIntentAutoGeo_` | 2378–2437 | car + place, no service |
| `campaignNameMatchesRequired_` | 2445+ | Must contain “Built by Shah” |
| `findBlockingNegative_` / `loadEffectiveNegatives_` | 2489–2563 | Campaign + shared lists |
| `loadPmaxCampaignNegativesViaGaql_` | 2565+ | PMax coverage read |
| `buildExactCampaignNegativeCreateOperation_` | 2745–2757 | mutateAll payload |
| `flushPendingExactNegatives_` / `applyExactNegativesBatch_` | 2766–2979 | Batch create, preview skip |
| `inspectExactNegative_` / `prepareExactNegative_` | 2983–3037 | Sanitize + 80/10 gate |
| `negativeBlocksSearchTerm_` | 3040–3062 | Exact/phrase/broad coverage |
| `sendSummaryEmail_` / `buildDecisionAuditCsv_` | 3065–3170 | Mail + CSV |
| `buildDateWindowFromTodayText_` | 3974–3983 | Yesterday-ending windows |
| `containsPhrase_` / `stemToken_` | 4024–4138 | Matchers |
| `validateConfig_` | 4254–4297 | Hard checks including 80/10 constants |

---

## MCC account-selection logic

Standalone daily 1634–1649:

- `AdsManagerApp.accounts().withIds(allowlistIds)`
- Skip if already has `BbsStandaloneNeg:yyyy-MM-dd`
- Sort IDs, `slice(0, MAX_PARALLEL_ACCOUNTS)` (50)

Backfill: skip if `BbsStandaloneNegBackfill` unless `IGNORE_DONE_LABEL`.

Hub Search `selectHubAccounts_` `built-by-shah-mcc-search-negatives-sweeper.js` 1194–1267: Enabled + Negatives Sweeper Enabled + Spoke URL; skip LSR === today unless force include list; sort Priority desc; cap 50.

---

## GAQL / AWQL

**Search** (1957–1966):

```
SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name,
       search_term_view.search_term, search_term_view.status,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '{historyStart}' AND '{actionEnd}'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND campaign.status = 'ENABLED'   -- unless INCLUDE_PAUSED_CAMPAIGNS
  AND ad_group.status = 'ENABLED'
  AND metrics.impressions > 0
```

AWQL is **not** used.

**PMax** (1970–1979): `campaign_search_term_view` (no ad group, no search_term_view.status). On failure, fallback `search_term_view` with `PERFORMANCE_MAX` (1987–2003) — documented as usually empty.

PMax existing negatives: `campaign_criterion` KEYWORD negative TRUE (2570–2576); attached lists via `campaign_shared_set` + `shared_criterion` (2614–2642).

---

## Date ranges and reporting delay

`buildDateWindowFromTodayText_` 3974–3983:

- `actionEnd` = today − 1 (account TZ for live; test uses UTC date text)
- `actionStart` = actionEnd − (ACTION_WINDOW_DAYS − 1)
- `historyStart` = actionEnd − (HISTORICAL_GUARD_DAYS − 1)

Daily CONFIG: `ACTION_WINDOW_DAYS: 7`, `HISTORICAL_GUARD_DAYS: 30` (lines 234–235).

Contract test expects window for today `2026-08-24`: action `2026-08-17`..`2026-08-23`, history start `2026-07-25` (`test-negative-sweeper-contract.js` 174–180).

**Reporting delay:** Docs require schedule ≥ 7:00 AM Pacific because Google Search terms for yesterday are typically ready ~6:00 AM **account local**. Live 2026-08-24 run was **3:41 AM Pacific**. Rolling 7-day overlap is the mitigation so a too-early run can catch late rows later **if the account is not treated as done forever for that calendar day** — done label is **date of the run**, so the next **calendar day** re-scans the overlapping 7 days. Same-day second wave only runs if the first wave **failed** or hit the ceiling (success stamps done).

---

## Search-term deduplication

Key: `channel + '|' + campaignId + '|' + normalizeText_(searchTerm)` (2019).

Ad group is queried for Search then **dropped**. Same term in two ad groups of one campaign is one candidate. Same term in two campaigns is two candidates (two possible exact campaign negatives).

`normalizeText_`: lower case, NFKD strip accents, `&` → `and`, non-alphanumeric → space (4151–4158).

---

## Classification workflow

See `evaluateRules_` 2074–2126 and `01_SEARCH_TERM_DECISION_POLICY.md` precedence. Custom evaluators listed in comment 344–346.

There is **no** AI, **no** confidence score, **no** UNCERTAIN enum.

---

## Arrays, dictionaries, regexes, word lists

| Name | Lines | Use |
|---|---|---|
| `CONFIG` | 207–258 | Allowlist, email, windows, ceilings |
| `SEED_INSURER_PROTECTED_PHRASES` | 266–299 | Whole-query protect |
| `SEED_COMPETITOR_PHRASES` | 301–326 | LOCAL_COMPETITOR including `'body works'`, `'auto arena body shop'` |
| `NEGATIVE_RULES` | 348–655 | Triggers/exceptions |
| `OEM_COLLISION_KEEP_BRANDS` | 658–664 | OEM keep helper |
| `BARE_MAKE_MODEL_TOKENS` | 667–673 | Bare make/model |
| `NAMED_SHOP_FILLER_TOKENS` | 675–696 | Name-bit strip |
| `US_PLACE_FILLER_TOKENS` | 699–981 | City/state tokens (incomplete) |
| `US_PLACE_MULTIWORD_PHRASES` | 984–1048 | Multi-word cities |
| Possessive regex | 2252 | `/[a-z0-9]'s\b/i` |
| `STEM_TOKEN_MAP_` | 4098–4138 | Irregular stems; `keyed` kept distinct |
| Year list | `buildYearTokenTriggers_` 331–336 | 1990–2026 strings |

---

## Competitor and city detection

**Competitors**

1. `LOCAL_COMPETITOR`: substring/stem match against seed + CONFIG + account competitor phrases (2088–2092).
2. `LOW_VALUE_COMPETITOR`: separate trigger list (maaco, pep boys, …) — does **not** include `a1`/`f1`/`earl` (those are on the **seed competitor** list).
3. `NAMED_LOCAL_SHOP`: heuristic (2229–2278).

**Cities:** not a service-area allowlist. Used only to strip geo tokens so leftover tokens look like shop names. Missing cities (e.g. New Rochelle) inflate name-bit counts.

---

## How negative text is generated

`inspectExactNegative_` 2983–2993:

- Trim
- Replace `[]"` with space
- Replace `,!@%^()={} ;~`<>?\\|` with space
- Collapse whitespace
- Format as `[text]` for display; mutateAll uses **unbracketed** `text` with `matchType: 'EXACT'` (2745–2756)

Hub Search passes `prepared.formatted` (with brackets) into `createNegativeKeyword` (`search-negatives-sweeper.js` 1078).

---

## Match type and scope

**Writes:** EXACT, campaign criterion, `negative: true`. Not ad group. Not account-level. Not shared-list create.

**Reads for skip:** campaign negatives + attached shared lists; EXACT/PHRASE/BROAD matching 3040–3062.

Broad coverage: every token in the negative must appear in the search term (order-insensitive set). Phrase: consecutive token substring.

---

## Mutation / application

Standalone: queue then `AdsApp.mutateAll` chunks of 2000 (`applyExactNegativesBatch_` 2822+). Preview: operations not applied (`preview` flag). Verify helpers exist for PMax (`assertPMaxNegativeMethods_` 2726+); standalone comments say Scripts `PerformanceMaxCampaign` lacks `negativeKeywords()` / `createNegativeKeyword()`, which is why mutateAll is used.

Hub PMax still calls `campaign.createNegativeKeyword` at `built-by-shah-mcc-pmax-negatives-sweeper.js` 1071 after asserting those methods exist (2155–2169). **Likely always fails** on current Scripts PMax objects.

Hub Search: per-term `createNegativeKeyword` + verify (1078–1083).

---

## Dry-run

No `DRY_RUN` CONFIG. Google Ads **Preview**:

- Standalone: `AdsApp.getExecutionInfo().isPreview()` — still scores; skips mutate, done labels, and email (`allFinished` 1159–1171; processAccount uses `preview` in flush).
- Hub: Preview **does not score** (939–944).

---

## Email generation

`sendSummaryEmail_` 3065–3104: `MailApp.sendEmail` to `EMAIL_RECIPIENTS`. HTML `buildSummaryEmailHtml_` 3244+; plain `buildSummaryEmailPlain_` 3881+. CSV attachment if `ATTACH_DECISION_AUDIT_CSV` and rows exist.

If recipients empty: still mutates; logs skip email (3067–3069).

Wave-empty still emails (1075–1084).

Backfill: additional per-shop detail emails (see backfill file; not duplicated here).

Hub sweepers: **no email**.

---

## Recipient mapping

Standalone: **one global list** (CONFIG 224–228 in live file; redacted in `04_CONFIGURATION_AND_DATA.md`). Not per account manager.

Hub Engine status email is a **different product** (manager/CSM columns). Not used by standalone sweeper.

---

## Logging and audit history

- `Logger.log` start, ACCOUNT_RESULT, decision funnel, label apply
- Standalone CSV columns listed 3108–3125 (Account ID, term, matched rules, Decision, Reason, metrics)
- Caps: `MAX_AUDIT_ROWS_PER_ACCOUNT` 1000, `MAX_AUDIT_CSV_ROWS_PER_WAVE` 25000 — truncation flagged
- Hub: spoke **Negatives Audit** rows (headers `SPOKE_HEADERS` search sweeper 53–74); newest under header (spoke generator pattern)

Standalone has **no** persistent sheet log. Undo = Ads UI delete.

---

## Error handling

- Per-account `try/catch` in `processAccount` 1609–1627: success false, FAILED action, still attempts reconciliation
- Parallel worker missing JSON → synthetic failure object 1136–1154
- Label apply failure logged, does not throw the wave
- PMax GAQL failure → fallback query
- `cleanError_` 4249–4251
- One account failure does not stop other parallel workers (Google parallel model)

---

## Retry behavior

- Failed or safety-ceiling accounts **not** stamped done → eligible later **the same calendar day** if another Scripts row runs
- Successful accounts stamped → skipped until tomorrow, then 7-day window overlaps
- Backfill: unlabeled shops remain in queue; `IGNORE_DONE_LABEL` force
- Hub: blank / not-today LSR retries

No HTTP retry loop. No exponential backoff.

---

## Execution-time protections

- 50 accounts / run
- Safety ceilings on **adds**, not scans
- Action log caps (500)
- Email row caps per account
- mutateAll chunk 2000
- `MAX_PARALLEL_ACCOUNTS` validated 1–50 (4255–4259)

Google MCC parallel ~60 minute envelope is documented in the Hub plan, not enforced in code.

---

## State persistence

| State | Where |
|---|---|
| Daily done | MCC account label `BbsStandaloneNeg:yyyy-MM-dd` |
| Backfill done | MCC label `BbsStandaloneNegBackfill` |
| Hub Search done | Hub column Negatives Last Successful Run |
| Hub PMax done | Negatives PMax Last Successful Run |
| Audit / undo Hub | Spoke Negatives Audit |
| Standalone audit | Email CSV only |

In-run negative cache prevents duplicate queues (`addExactNegativeToCache_`).

---

## Existing tests

`scripts/test-negative-sweeper-contract.js`:

- Identical `NEGATIVE_RULES` / seeds across five files
- `shouldExclude true` for 23 `suppliedTerms` (includes `auto arena body shop` as junk on unrelated account, `body works car near me`, `fix small dent in car`, …)
- Own-account protect vs competitor
- AAA context
- City geo keep
- Bare `car` / `car near me` not LOW_INTENT_AUTO_GEO
- Stem matcher cases
- Date window
- Aggregate cost across days (Hub Search/PMax `aggregateSearchTerms_` signature includes actionEnd; standalone uses channel as third arg — tests call modules[3] and [4] Hub files)
- Decision reconciliation + CSV contains NO_RULE / FAILED

No Google Ads integration tests. No evaluation of owner keep-list EX-001–012 (those would **fail** current `shouldExclude` for most).

---

## Hub-only: Remove path

`processRemoveRequests_` `built-by-shah-mcc-search-negatives-sweeper.js` 1350+: if Remove checked and Status ADDED and channel matches, delete exact campaign negative, set REMOVED. Failures increment failed (may block LSR stamp depending on `hadFailure`).
