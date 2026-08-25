# 00 — Project handoff: Google Ads Negative Keyword Sweeper

**Purpose of this folder:** evidence-backed analysis for rebuilding the sweeper as a **conservative, AI-assisted** system. This file orients another engineer. Decision rules live in `01_SEARCH_TERM_DECISION_POLICY.md`. Code behavior lives in `03_CURRENT_IMPLEMENTATION.md`. Do not treat this file as a license to change production code.

**Evidence labels used throughout this package**

| Label | Meaning |
|---|---|
| **CONFIRMED REQUIREMENT** | Stated by the business owner in this conversation, or locked in writing by the owner in a prior conversation and not later withdrawn. |
| **CURRENT CODE BEHAVIOR** | What the JavaScript actually does, with file/line citations. Not automatically correct. |
| **INFERRED INTENT** | A reasonable reading of docs/comments/plans that the owner did not explicitly lock. |
| **UNKNOWN** | Not specified in project sources. Not invented here. |

---

## Executive summary

This repository contains **two parallel negative-keyword products** plus a Hub-and-Spoke metrics Engine. The Engine does **not** add negatives.

1. **Standalone MCC sweeper (currently live on a 4-shop allowlist).** One Google Ads Script at the manager-account (MCC) level. It reads Search + Performance Max search terms, scores them with token/phrase/stem rules, and auto-adds the **full query** as an **exact campaign negative**. It emails a wave summary plus a decision-audit CSV. There is no human approval gate before the add. **CURRENT CODE BEHAVIOR**
2. **Hub/Spoke Search + PMax sweepers (implemented, sibling of the Engine).** Same rule block, Hub on/off + per-shop overrides, spoke **Negatives Audit** with Reviewed/Remove. **CURRENT CODE BEHAVIOR**

The owner has now stated a **stricter product goal** than the live script implements:

- Desired leads are **serious collision / body-shop customers**, not cosmetic scratch/ding/dent/bumper-only shoppers. **CONFIRMED REQUIREMENT** (this conversation, 2026-08-25)
- Context matters: a query containing “dent”, “scratch”, or “bumper” can still be a serious accident. Single-word matching must not decide the outcome. **CONFIRMED REQUIREMENT**
- The live script has **already added valuable terms as negatives**. **CONFIRMED REQUIREMENT** (owner-labeled list on 2026-08-25; see Known failure examples)
- **False positives are much more harmful than false negatives.** Uncertain terms must go to **human review**, not auto-negate. **CONFIRMED REQUIREMENT**

Those statements **contradict** several locked historical choices (auto-add with no approval, block `free estimate`, aggressive `YEAR_TOKEN` / `earl` / `a1` / `f1`, treat many paint/body phrases as junk). This package records both sides. It does not pick a winner.

**Canonical rule source in code:** `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` (header version **1.3.0**; filename still says v1.1.0). Siblings are generated copies via `scripts/sync-negative-sweeper-rule-blocks.js`.

---

## Confirmed business objective

**CONFIRMED REQUIREMENT (this conversation):** Rebuild understanding so another engineer and an AI system can implement a **conservative AI-assisted** sweeper for **collision-repair / body-shop** Google Ads accounts.

Desired customer (owner, this conversation):

- Generally has **meaningful collision damage from a larger accident**.
- Generally **not** desired: small scratches, minor dings/dents, tiny bumps, cosmetic work, bumper-only replacement inquiries.
- **Exceptions:** a bumper or dent mention can still describe a serious collision. Do not decide from one word.

**CONFIRMED REQUIREMENT (prior product, still in docs):** Stop wasted spend on junk search queries by adding exact campaign negatives, without mixing every client’s metrics into one sheet. Hub = control plane; spokes = per-shop dashboards; Engine = metrics only.

**CURRENT CODE BEHAVIOR:** The live standalone sweeper auto-applies exact campaign negatives whenever **any** enabled rule matches and safety gates pass. It does not implement QUALIFIED / DISQUALIFIED / UNCERTAIN / PROTECTED as first-class classes. `MANUAL_REVIEW` exists only when the proposed exact negative exceeds **80 characters or 10 words**.

---

## Exact runtime

| Product | Runtime | Evidence |
|---|---|---|
| Standalone daily / backfill sweepers | **Google Ads Scripts** at the **MCC**, `AdsManagerApp.accounts().executeInParallel` | `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` lines 1–22, 1052–1106 |
| Hub Search / PMax sweepers | **Google Ads Scripts** at the **MCC**, plus **SpreadsheetApp** (Hub + spoke Sheets) | `scripts/built-by-shah-mcc-search-negatives-sweeper.js` lines 1–21, 867–909 |
| Hub / spoke generators, Negatives Audit tab helper | **Google Apps Script** (Sheets), not Ads Scripts | `apps-script/create-hub-workbook.gs`, `create-body-shop-workbook.gs`, `add-negatives-audit-tab.gs` |
| Contract test / rule sync | **Node.js** local (no npm packages) | `scripts/test-negative-sweeper-contract.js`, `scripts/sync-negative-sweeper-rule-blocks.js` |

Not a standalone Apps Script Ads product. Not a web app. Not TypeScript in this repo (no `.ts` sweeper files found).

---

## MCC vs individual-account install

**CURRENT CODE BEHAVIOR:** All sweeper scripts are designed to be pasted into the **manager account (MCC)**. They select child accounts; they are not intended to be installed once per client account.

- Standalone: `CONFIG.ACCOUNT_ALLOWLIST` + MCC labels. Accounts not on the list are untouched. `docs/Read this for the standalone MCC negatives sweeper - allowlist no Hub.md` lines 196–200.
- Hub sweepers: Hub Config rows where **Enabled** and **Negatives Sweeper Enabled** are both on and Spoke URL is filled. `docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md` lines 31–32.

**UNKNOWN:** Whether a Hub Search/PMax Scripts row is actually installed in the live MCC today. Logs the owner pasted on 2026-08-24 were from **Standalone DAILY Negatives Sweeper**, not the Hub scripts.

---

## Account-selection method

### Standalone daily (CURRENT CODE BEHAVIOR)

1. Normalize `CONFIG.ACCOUNT_ALLOWLIST` to 10-digit customer IDs.
2. Query MCC accounts with those IDs.
3. Skip accounts that already have today’s done label `BbsStandaloneNeg:yyyy-MM-dd` (`QUEUE_TIME_ZONE`, default `America/Los_Angeles`).
4. Take at most `MAX_PARALLEL_ACCOUNTS` (50). Sort remaining IDs lexicographically.
5. `executeInParallel('processAccount', 'allFinished', input)`.

See `selectDueAllowlistedAccounts_` at daily script lines 1634–1649.

### Standalone backfill (CURRENT CODE BEHAVIOR)

Same allowlist, but done label is permanent `BbsStandaloneNegBackfill`. `IGNORE_DONE_LABEL` can force a re-run. Lookback ~90 days. Per-shop detail emails in addition to a wave summary.

### Hub Search / PMax (CURRENT CODE BEHAVIOR)

Hub Config: skip unless Enabled + Negatives Sweeper Enabled + Spoke URL. Skip if Last Successful Run (Search) or Negatives PMax Last Successful Run (PMax) is already today, unless `INCLUDE_ACCOUNT_IDS` force list. Optional `EXCLUDE_ACCOUNT_IDS`. Sort by Priority descending, then account ID. Cap 50.

---

## Scheduled frequency

**CURRENT CODE BEHAVIOR / documented ops:**

| Script | Intended schedule |
|---|---|
| Standalone daily | **Daily at 7:00 AM Pacific or later** so prior-day Search terms are published. Two identical Scripts rows (e.g. 7:00 and 8:00) if allowlist > 50. |
| Standalone backfill | **Run once** (repeat waves until labeled). Do **not** leave on Daily. |
| Hub Search / PMax | Same 7:00 AM Pacific-or-later Daily; two rows if ~70 shops enabled. Separate PMax Scripts rows. |
| Engine (metrics) | Separate schedule; ~70 shops need **at least two** Engine runs/day. Not this product. |

**CONFIRMED from live logs (2026-08-24):** A standalone daily run started **3:41 AM Pacific**, which is **earlier** than the documented 7:00 AM Pacific guidance. Owner later compared UI Search terms ~6 hours after that run.

---

## Current workflow: search-term retrieval through reporting

### Standalone daily (CURRENT CODE BEHAVIOR)

```
MCC main()
  validate CONFIG
  pick ≤50 allowlisted accounts missing today's done label
  executeInParallel processAccount
    per child account timezone:
      GAQL last HISTORICAL_GUARD_DAYS through yesterday (impressions > 0)
      Search: search_term_view
      PMax: campaign_search_term_view (fallback search_term_view on error)
      aggregate unique (channel, campaignId, normalized search term)
      keep terms with action-window impressions ≥ 1
      skip campaigns whose name does not contain "Built by Shah"
      evaluateRules_ (token/stem triggers + exceptions + protected phrases)
      skip: no rule, protected, Google ADDED/EXCLUDED status,
            conversions in 7-day window or 30-day guard,
            already covered by campaign or attached shared-list negative,
            empty after sanitization
      if query > 80 chars or > 10 words → MANUAL_REVIEW (no Ads write)
      else queue exact campaign negative
    AdsApp.mutateAll (EXACT, campaign criterion, negative=true)
    reconcile one terminal decision per unique term
  allFinished:
    stamp done labels only if success && !safety ceiling && !preview
    MailApp HTML + plain email + bounded CSV
```

Hub Search/PMax: same scoring idea, but writes spoke **Negatives Audit**, processes **Remove** checkboxes, stamps Hub LSR, **no email**, Hub Preview returns immediately without scoring, Search uses `campaign.createNegativeKeyword`, PMax still calls `createNegativeKeyword` (likely unavailable; standalone uses mutateAll instead).

---

## Current automation level

| Stage | Standalone daily | Hub Search/PMax |
|---|---|---|
| Retrieval | Fully automatic | Fully automatic |
| Classification | Deterministic word rules; **no AI** | Same rule block |
| Human approval before add | **None** | **None** (Reviewed is after-the-fact) |
| Auto-apply | Yes, if Hub flags / allowlist say on | Yes |
| Undo | Manual delete in Google Ads UI | Spoke **Remove** → next run deletes |
| Uncertainty class | Only length/word-count `MANUAL_REVIEW` | Same 80/10 gate |
| DRY_RUN CONFIG flag | **None** (Google Preview skips writes + email) | **None** (Preview skips all mutations, including scoring) |

**CONFIRMED REQUIREMENT (this conversation):** Uncertain terms must be sent to human review rather than automatically negated. That is **not** current code behavior except for oversize queries.

**CONFIRMED REQUIREMENT (Hub plan, 2026, locked):** Auto-add exact campaign negatives daily; AM reviews after; Remove undoes. No script DRY_RUN. Source: Cursor plan `negatives_sweeper_hub-spoke_927ad403.plan`.

These two confirmed requirements **contradict** each other on when a human sees the term.

---

## Known failure example(s)

### A. Valuable terms auto-negatived (false positives) — CONFIRMED

Owner, 2026-08-25, listed terms **already added** that **should not have been added**:

- `body work shops near me`
- `car body work repair`
- `body work shop`
- `body work near me`
- `automotive body work near me`
- `body work for cars near me`
- `auto body works near me`
- `auto body shop new rochelle`
- `cadillac body shop near me`
- `car body works`
- `bmw body work repairs`
- `auto body works`

Owner answers in that thread (chose **A and C** on a two-question form; assistant interpreted and owner said “keep going”):

- **“Body work” / “auto body work” is the core service** — real customers, not junk.
- **“Car body work,” “body work shop,” “automotive body work”** are legitimate body-shop searches.
- **Brand + body shop / body work** (`cadillac body shop near me`, `bmw body work repairs`) is real collision/body intent, not a dealership search.

A plan to stop those adds was drafted the same morning (**Keep body work**). **It was not implemented.** `SEED_COMPETITOR_PHRASES` still contains `'body works'` (daily script line 321). `DEALER_OR_AUTO_GROUP` still contains `'cadillac body'` (line 491). `New Rochelle` is still absent from the US place list.

Likely code causes (see `05_RISKS_BUGS_AND_OPEN_QUESTIONS.md`):

1. Stem matching makes competitor seed `body works` match **`body work`**.
2. Trigger `cadillac body` fires on Cadillac body-shop queries.
3. Unknown city leftovers (`new` + `rochelle`) look like a two-token shop name.

### B. Owner said prior day’s adds were correct, then later said some adds were wrong — CONTRADICTORY

2026-08-24: “All of the negative keywords that you added in the campaigns were correct.” Same owner, 2026-08-25: the twelve body-work terms “should not have been added.” Treat as **operator feedback evolving**, not as a single gold label set.

### C. Missed junk terms (false negatives / never seen) — CONFIRMED as owner-expected adds; cause mixed

Owner, 2026-08-24, listed 23 terms that “should have also been added.” Many were later encoded as test expectations that `shouldExclude === true` in `scripts/test-negative-sweeper-contract.js` lines 57–98. The same morning’s run started at **3:41 AM Pacific** with `ACTION_WINDOW_DAYS` then **1** (yesterday only). Docs/code were later changed to a **rolling 7 completed days**. Whether each miss was “never in the GAQL pull” vs “saw and skipped” was **not fully proven**; the owner’s CSV for a later run was promised but **not present in this repo**.

### D. Historical aggressive tokens accepted, then conservative rebuild requested — CONTRADICTORY

2026 conversation “Expand Negatives Rule Set”: owner chose to **block `free estimate` / `free quote`** and to keep aggressive `earl` / `a1` / `f1` / **YEAR_TOKEN 1990–2026**, accepting false-positive risk. This conversation: false positives are much worse; uncertainty → human review.

---

## Project file tree (relevant only)

```
scripts/
  built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js   # canonical daily MCC script
  built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js
  built-by-shah-mcc-standalone-backfill-negatives-sweeper-kc-today-v1.1.0.js  # temp 4-shop prefill
  built-by-shah-mcc-search-negatives-sweeper.js
  built-by-shah-mcc-pmax-negatives-sweeper.js
  sync-negative-sweeper-rule-blocks.js
  test-negative-sweeper-contract.js
  built-by-shah-mcc-engine.js                    # metrics Engine; must NOT mutate negatives
  _engine-hub-spoke-contract.js                  # Hub column names including Negatives *
apps-script/
  create-hub-workbook.gs                         # Hub Negatives columns + Definitions
  create-body-shop-workbook.gs                   # spoke Negatives Audit tab
  add-negatives-audit-tab.gs
docs/
  Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md
  Read this for the standalone MCC negatives sweeper - allowlist no Hub.md
  Open this in a browser - Standalone Negatives Sweeper explained.html
  Daily Negatives Sweeper Walkthrough.html / .pdf
  Open this in a browser to preview the Search Negatives Sweep email.html
  Open this when you are ready to go live - …
  Start here - what does each of these guides do.md
  Give this to Codex - full product brief…       # web-app rebuild; v1 forbids Ads writes
.cursor/rules/
  negatives-sweeper-separate-from-engine.mdc
handoff/                                         # this package
```

Copied (sanitized) sources: `handoff/source_code/` — see `handoff/source_code/MANIFEST.md`.

---

## Important terminology

| Term | Meaning here |
|---|---|
| **Search term** | What a person typed (or Google reported), not the keyword bid. |
| **Negative keyword** | Prevents ads from matching. This system only **creates** exact campaign negatives (standalone/Hub add path). |
| **Exact / phrase / broad** | Google match types. Adds are **exact only**. Coverage checks still honor existing phrase/broad negatives. |
| **Campaign negative** | Negative attached to one campaign, not the whole account, not a shared list write. |
| **Shared negative list** | Read for coverage; **never written** by these scripts. |
| **Rule ID** | String like `DENT_MINOR`. Hub “Disabled Rule IDs” must match exactly. |
| **Trigger** | Phrase/token that can fire a rule. |
| **Exception** | Phrase that **disables that one rule** for the query, not all rules. |
| **Protected phrase** | Account/global phrase that **blocks all auto-exclude** for the query. |
| **Action window** | Completed days ending yesterday used for “did this term show / convert recently.” Daily default: 7 days. |
| **History / conversion guard** | Longer window (daily default 30 days) — any conversion skips auto-add. |
| **Done label** | MCC account label meaning “this shop finished today’s standalone wave.” |
| **Hub / Spoke / Engine** | Agency config sheet / per-shop sheet / metrics script. Separate from sweepers. |
| **MANUAL_REVIEW** | In code: query too long for an exact negative. **Not** a general uncertainty queue. |
| **QUALIFIED / DISQUALIFIED / UNCERTAIN / PROTECTED** | Classes defined for the rebuild in `01_…`. **Not implemented** as named enums in JS. |

---

## Features already implemented

**CURRENT CODE BEHAVIOR**

- MCC parallel processing, 50-account cap, due-queue labels (standalone) or Hub LSR (Hub sweepers)
- Search `search_term_view` + PMax `campaign_search_term_view`
- Token/phrase matching with plural/stem helpers
- Large `NEGATIVE_RULES` catalog (~40 IDs) including custom evaluators: `LOCAL_COMPETITOR`, `NAMED_LOCAL_SHOP`, `BARE_MAKE_MODEL`, `DEALER_OR_AUTO_GROUP`, `LOW_INTENT_AUTO_GEO`
- Insurer seed protections; AAA is phrase-based (not bare `aaa`)
- Account name (standalone) or Account Name + Client Name (Hub) auto-protected
- Exact full-query campaign negatives only on the add path
- Conversion and existing-negative / Google status skips
- Oversize query → email/spoke manual review, no add
- Runaway safety ceiling (standalone: 2500/channel, 5000/account; Hub Search: 500/account)
- Standalone HTML email + CSV of every unique evaluated term’s terminal decision
- Hub spoke Reviewed/Remove undo
- Node contract test that all five paste files share identical `NEGATIVE_RULES` / seeds / selected evaluations
- Campaign name substring gate on **standalone only** (`Built by Shah`)
- Preview: standalone scores but does not mutate or email; Hub Preview skips scoring and writes

---

## Features discussed but not implemented

| Item | Status | Source |
|---|---|---|
| Conservative AI classifier with UNCERTAIN → human review | Discussed this conversation; **not in code** | This query |
| Stop blocking “body work” / Cadillac body shop / New Rochelle geo | Plan “Keep body work” 2026-08-25; **code unchanged** | Conversation [Keep body work](0715bce9-d644-49c4-a3b2-3ff03879dc87) |
| Fuzzy misspelling beyond listed variants | Docs say cannot; not built | Hub sweeper guide “What this script cannot auto-detect” |
| Reliable unnamed local-shop vs city detector | Heuristic only; docs admit limits | Same |
| Script `DRY_RUN` / WOULD_ADD spoke rows | Explicitly **rejected** in Hub plan | Plan file; Cursor rule `negatives-sweeper-separate-from-engine.mdc` |
| Folding negatives into the Engine | Forbidden | Same Cursor rule; PRD |
| Third MCC audit workbook | Forbidden | Same |
| Rule editor on the spoke | Forbidden | Same |
| Auto-add **bare trigger words** as phrase/broad negatives | Forbidden | Same; standalone header lines 61–62 |
| Built Ads Manager web app with in-app review | Specified in Codex brief; **v1 forbids any Ads write including negatives** | `docs/Give this to Codex - full product brief to rebuild this system as a web app.md` ~line 842 |
| Owner CSV of a later decision audit for missed-add diagnosis | Promised 2026-08-25; **file not in repo** | Conversation |
| Per-AM recipient mapping on standalone | Global `EMAIL_RECIPIENTS` only | CONFIG |
| Service-area city allow/deny lists per shop | Only a static US place filler list for named-shop geo | `US_PLACE_FILLER_TOKENS` |

---

## External connections currently used

**CURRENT CODE BEHAVIOR**

| Connection | Who uses it |
|---|---|
| Google Ads Scripts / Ads Manager App / GAQL (`AdsApp.search`) | All sweepers |
| `AdsApp.mutateAll` campaign criterion create | Standalone Search + PMax adds |
| `campaign.createNegativeKeyword` | Hub Search (and Hub PMax, if the API exists) |
| `MailApp.sendEmail` | Standalone daily + backfill |
| `SpreadsheetApp` Hub + spoke | Hub sweepers; Apps Script generators |
| MCC account labels | Standalone queue |
| Node `fs` / `assert` / `require` | Local sync + contract test only |

No third-party HTTP APIs, no LLM API, no npm runtime dependency for Ads Scripts.

**UNKNOWN:** Live Hub spreadsheet URL (Hub Search `HUB_SPREADSHEET_URL` is empty in repo). Live MCC script IDs.

---

## Assumptions made by the existing implementation

These are **CURRENT CODE BEHAVIOR** assumptions, not confirmed business truth.

1. A **single matching junk trigger** is enough to auto-negative the **entire query**, even if the query also contains body-shop language (unless that rule has an exception or a global protected phrase).
2. **Stem/plural equivalence** is safe (`body works` ≈ `body work`, `cracked` ≈ `crack`, `repaint` ≈ `paint`).
3. **Zero conversions** in 7 + 30 days means the term is safe to block (ignores conversion lag beyond 30 days, and ignores “good intent, no convert yet”).
4. **Yesterday-ending windows** in the **account time zone** are the right truth; Google’s UI later the same day may still differ.
5. Campaigns not named **Built by Shah** should be ignored (**standalone only**).
6. **City lists** are complete enough that leftover tokens are shop names.
7. **Spanish collision vocabulary** (`choque`, `colision`, `enderezado`, …) is junk to block, not qualified demand.
8. **Towing**, **estimates/quotes**, **model years**, **paint including “paint and body”**, **custom body shop**, and **cheap/affordable** (even with collision words) are auto-blockable.
9. Shared lists need only be **read**.
10. If email recipients are empty, **still mutate** Ads (standalone).
11. Preview in Hub sweepers need not even **score** terms.
12. False positives can be cleaned up later (spoke Remove or Ads UI).

**CONFIRMED REQUIREMENT (this conversation) that conflicts with several items above:** context can rescue cosmetic words; false positives are worse than misses; uncertainty must not auto-negate.

---

## Sources inspected vs unavailable

**Inspected**

- All sweeper `.js` files, contract test, rule-sync script
- Hub/spoke Apps Script generators and `add-negatives-audit-tab.gs`
- Negatives docs, HTML walkthroughs, email preview, go-live guide, README, Start here
- Cursor rules: `negatives-sweeper-separate-from-engine.mdc`, Hub-Spoke PRD, go-live sync, scheduling reminder
- Codex web-app brief (negatives out of scope for v1)
- Hub plan upload `negatives_sweeper_hub-spoke_927ad403.plan-L1-L379-0.md`
- Agent transcripts: [Missed negatives / body-work false adds](0715bce9-d644-49c4-a3b2-3ff03879dc87), [Expand rule set / free estimate](97da38e7-2fc6-4d96-96e8-671461837f65)
- This conversation’s confirmed conservative constraints
- `git status` snapshot at conversation start (sweepers present as new/modified files)

**Unavailable or not fully inspectable**

- Live Google Ads UI, live negatives lists, live Search Terms report after 7:00 AM
- Owner’s later decision-audit CSV (promised, not in repo)
- Shah walkthrough `.mp4` (not transcribed here)
- Live Hub spreadsheet contents (no URL in Hub sweeper CONFIG)
- MCP `SearchConversations` tool (not in available namespaces this session)
- TypeScript sources (none in repo)
- Per-shop competitor/city lists beyond script seeds (none found as data files)

**Not treated as automatically correct:** any `shouldExclude: true` test, HTML “junk → exact negative” table, or historical owner “block free estimate” choice.

---

## How to read the rest of this package

1. `01_SEARCH_TERM_DECISION_POLICY.md` — business rules vs code, with precedence.
2. `02_LABELED_SEARCH_TERM_EXAMPLES.csv` — evaluation seed set.
3. `03_CURRENT_IMPLEMENTATION.md` — functions, GAQL, mutations.
4. `04_CONFIGURATION_AND_DATA.md` — CONFIG and redacted account map.
5. `05_RISKS_BUGS_AND_OPEN_QUESTIONS.md` — false-positive mechanics and questions for the owner.
6. `06_RELEVANT_FILES_TO_SHARE.md` — minimal file list for another engineer.
7. `source_code/` — copies of runtime files; emails and account IDs replaced with placeholders.
