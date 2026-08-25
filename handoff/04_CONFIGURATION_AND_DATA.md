# 04 — Configuration and data

No API keys, passwords, or OAuth tokens appear in the inspected sweeper sources. **Account IDs and personal emails from the live CONFIG are redacted below** and replaced in `handoff/source_code/` copies. Shop **names** from the 2026-08-24 log are kept as stable labels because they are required to understand own-brand protection tests.

---

## Account map (standalone allowlist as of repo CONFIG)

Source: `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` lines 208–213 and the 2026-08-24 script log in conversation 0715bce9.

| Placeholder | Role | Ads account name (from log) | Notes |
|---|---|---|---|
| ACCOUNT_01 | Allowlisted child | Auto Arena Body Shop | Own-brand test phrase `auto arena body shop` |
| ACCOUNT_02 | Allowlisted child | G&S Custom Auto Body, inc. d/b/a Bella's Collision | |
| ACCOUNT_03 | Allowlisted child | P&C AUTOMOTIVE | |
| ACCOUNT_04 | Allowlisted child | Tello's Collision Center | |

Real 10-digit IDs existed in CONFIG (dashed form). They are **not repeated in this handoff**. Relationship: all four share one allowlist, one email list, no `ACCOUNT_OVERRIDES`.

**UNKNOWN:** Whether these four are the only production shops, or a KC pilot. Filename `…-kc-today-…` suggests a Kansas City (or “KC”) catch-up paste. Hub Config row count (~70 shops in Engine docs) is **not** the standalone allowlist size.

---

## Account-manager mapping

**CURRENT CODE BEHAVIOR:** Standalone sweeper has **no** per-shop AM field. Hub Engine Config has Account Manager Name / Email for the **status email product**, unused by standalone negatives.

**UNKNOWN** for AM ownership of ACCOUNT_01–04 beyond the shared recipient list.

---

## Manager email mapping (redacted)

Source: daily CONFIG `EMAIL_RECIPIENTS` lines 224–228 (same four addresses in KC backfill prefill).

| Placeholder | Role |
|---|---|
| EMAIL_01 | Wave summary recipient |
| EMAIL_02 | Wave summary recipient |
| EMAIL_03 | Wave summary recipient |
| EMAIL_04 | Wave summary recipient |

`EMAIL_FROM_NAME`: `Built by Shah Daily Negatives` (line 230). Backfill from-name: `Built by Shah Negatives Backfill`.

If the list is empty, Ads mutations still run (daily 3067–3069).

---

## MCC labels

| Label | Script | Meaning |
|---|---|---|
| `BbsStandaloneNeg:yyyy-MM-dd` | Daily | Finished today’s wave (`DONE_LABEL_PREFIX` + queue TZ date) |
| `BbsStandaloneNegBackfill` | Backfill | Permanent catch-up done (`BACKFILL_DONE_LABEL`) |

`QUEUE_TIME_ZONE`: `America/Los_Angeles` (line 231).

Hub sweepers do **not** use these labels; they stamp Hub spreadsheet dates.

---

## Service-area configuration

**None per shop.** `US_PLACE_FILLER_TOKENS` / `US_PLACE_MULTIWORD_PHRASES` (daily 699–1048) are a static US city/state gazetteer for named-shop stripping. Incomplete (e.g. New Rochelle / Rochelle absent). Not a targeting radius.

---

## Competitor lists

**Seed (all allowlisted shops)** `SEED_COMPETITOR_PHRASES` 301–326:

maaco, pep boys, dent doctor, dent dr, earl scheib, earl shibe, scheib, **earl**, fix auto, **a1**, **f1**, caliber collision, service king, gerber collision, crash champions, abradors, carstar, ames collision center, **auto arena body shop**, **body works**, clickmechanic, collision consultants, dent mavericks, fast car automotive.

**CONFIG.COMPETITOR_PHRASES:** `[]` (line 216).

**ACCOUNT_OVERRIDES competitor:** none (commented example only, 217–222).

**Hub column** Negatives Competitor Phrases: per-shop, live Hub **UNKNOWN** (URL empty in Hub script).

**LOW_VALUE_COMPETITOR** extra triggers (465–472): kwik kar, midas, car x, carx, ziebart, jiffy lube (plus overlapping chain names). Does not include a1/f1/earl (those ride LOCAL_COMPETITOR seeds).

---

## Client brand names

Protected automatically:

- Standalone: **Ads account name** string (1757–1761)
- Hub: **Client Name** + **Account Name** Hub cells

ACCOUNT_01 name `Auto Arena Body Shop` therefore protects queries containing that phrase **in that account only**. The same phrase is a **seed competitor** for other accounts (tests 100–110).

---

## Services offered / not offered

**No machine-readable per-shop catalog.** Operators disable rule IDs if a shop offers glass, PDR, tint, rust, RVs, recruiting, etc. (`docs/Read this for the Search negatives sweeper…` official rule ID table).

**INFERRED INTENT (agency-wide):** collision / auto body is the product; mechanical, glass, PDR, cheap paint, salvage often treated as not offered. **Not** a confirmed per-shop matrix.

---

## Protected keywords / phrases

| Layer | Contents |
|---|---|
| Insurer seed | Daily 266–299 (State Farm, GEICO, Progressive, …; AAA only as `aaa insurance`, `aaa collision`, `aaa auto body`, …) |
| CONFIG.PROTECTED_PHRASES | `[]` |
| Account name | Always concatenated |
| Hub Protected Phrases | Per shop; live values UNKNOWN |
| Per-rule exceptions | See `NEGATIVE_RULES` (e.g. collision words on DENT_MINOR) |

There is **no** protected list containing `body work`. `isGenericBodyIntent_` maps (2154–2178) include `body shop` / `auto body` / `collision repair` but **not** `body work`.

---

## Existing negative lists

Scripts **read** campaign negatives and attached shared **NEGATIVE_KEYWORDS** sets. They **do not** inventory or export the lists. Live list membership: **UNKNOWN**.

---

## Spend / click / conversion thresholds

| CONFIG key | Daily value | Line |
|---|---|---|
| MIN_ACTION_IMPRESSIONS | 1 | 236 |
| MAX_ACTION_CONVERSIONS | 0 | 237 |
| MAX_HISTORICAL_CONVERSIONS | 0 | 238 |

No minimum spend or clicks to add. Sort order uses cost then clicks then impressions (1295–1301, 1783–1787). Hub spoke shows Cost Yesterday / Cost Lookback for humans, not as add gates.

---

## Date windows

| Key | Daily | Backfill |
|---|---|---|
| ACTION_WINDOW_DAYS | 7 | 90 |
| HISTORICAL_GUARD_DAYS | 30 | 90 (KC/final backfill CONFIG) |

Windows end **yesterday** in the **child account** time zone (`processAccount` 1256–1260).

---

## Auto-apply settings

| Key | Daily |
|---|---|
| No MODE / DRY_RUN | Adds whenever shop is selected |
| RUNAWAY_SAFETY_CEILING_PER_ACCOUNT | 5000 |
| RUNAWAY_SAFETY_CEILING_PER_CHANNEL | 2500 |
| MAX_NEGATIVE_KEYWORD_CHARACTERS | 80 (validated immutable) |
| MAX_NEGATIVE_KEYWORD_WORDS | 10 (validated immutable) |
| INCLUDE_PAUSED_CAMPAIGNS | false |
| REQUIRED_CAMPAIGN_NAME_SUBSTRING | `Built by Shah` |
| DISABLED_RULE_IDS | `[]` |

Hub Search ceiling: 500 per account (`built-by-shah-mcc-search-negatives-sweeper.js` 38).

---

## Email settings (standalone)

| Key | Value |
|---|---|
| EMAIL_RECIPIENTS | EMAIL_01–04 |
| EMAIL_FROM_NAME | Built by Shah Daily Negatives |
| ATTACH_DECISION_AUDIT_CSV | true |
| MAX_EMAIL_*_ROWS_PER_ACCOUNT | add 60, fail 12, manual 40, matched skip 20 |
| MAX_AUDIT_CSV_ROWS_PER_WAVE | 25000 |

---

## Dry-run settings

None in CONFIG. Use Google Ads Scripts **Preview**.

KC backfill extra: `IGNORE_DONE_LABEL: true` (`…-kc-today-v1.1.0.js` line 37) so already-labeled shops run again. Generic final backfill defaults `IGNORE_DONE_LABEL: false`.

---

## Hub sweeper CONFIG (repo defaults)

`built-by-shah-mcc-search-negatives-sweeper.js` 24–43:

- `HUB_SPREADSHEET_URL`: **empty string** (required at runtime)
- Sheets: Config / Negatives Audit
- CHANNEL SEARCH; PMax sibling CHANNEL PMAX
- INCLUDE_ACCOUNT_IDS / EXCLUDE_ACCOUNT_IDS empty
- Same 7 / 30 / 80 / 10 / 50 pattern

Live Hub URL: **UNKNOWN**.

---

## Apps Script negatives tab helper

`apps-script/add-negatives-audit-tab.gs` `NEGATIVES_SETUP`: empty spreadsheet URL, empty body shop name, 200 data rows. No secrets.

---

## Engine / Hub columns related to negatives

Defined in `apps-script/create-hub-workbook.gs` CONFIG_HEADERS (includes Negatives Sweeper Enabled, LSR, PMax LSR, Disabled Rule IDs, Protected Phrases, Competitor Phrases) and `_engine-hub-spoke-contract.js`. Live cell values: **UNKNOWN**.

Hub Definitions mention disable example `FREE_ESTIMATE` (`create-hub-workbook.gs` ~193) but the **script rule ID is `ESTIMATE_OR_QUOTE`**. Instructions also mention `SPANISH_BODY_SHOP` vs script `SPANISH_LANGUAGE`. See risks file.
