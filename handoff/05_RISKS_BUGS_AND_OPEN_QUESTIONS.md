# 05 — Risks, bugs, and open questions

Issues that can **block valuable collision / body-shop searches**. Severity is relative to the owner’s 2026-08-25 statement that **false positives are worse than misses**. This file does not recommend a production patch (analysis only).

**Confirmed vs suspected:** Confirmed means observed in code plus an owner-labeled or test-backed example. Suspected means mechanism exists; live harm not proven in-repo.

---

## Risk register

### RISK-01 — Stemmed competitor seed `body works` matches `body work`

| Field | Content |
|---|---|
| Severity | **Critical** |
| File / line | `SEED_COMPETITOR_PHRASES` daily 321; `containsPhrase_` / `stemToken_` 4024–4095; `evaluateRules_` LOCAL_COMPETITOR 2088–2092 |
| Existing behavior | `works` stems to `work`, so `body works` matches `body work shops near me` and most of the owner’s 12 false adds |
| Example | `body work near me` |
| Actual / likely result | AUTO exact campaign negative |
| Expected result | KEEP (EXPLICIT_USER_LABEL 2026-08-25) |
| Why dangerous | Blocks the core service query family |
| Requirement needed | Distinctive competitor names only; never seed generic service phrases; stem-exceptions for `work`/`works` |
| Confirmed vs suspected | **Confirmed** (owner list + code) |

### RISK-02 — `cadillac body` dealer trigger

| Field | Content |
|---|---|
| Severity | **Critical** |
| File / line | DEALER_OR_AUTO_GROUP triggers daily 491; `evaluateDealerOrAutoGroup_` 2328–2330 |
| Existing behavior | Phrase `cadillac body` matches `cadillac body shop near me` before OEM-keep logic |
| Example | `cadillac body shop near me` |
| Actual / likely result | ADDED |
| Expected result | KEEP (owner 2026-08-25) |
| Why dangerous | OEM + body shop is a real customer |
| Requirement needed | Dealer rules must require dealership/service-center language, not `brand + body` |
| Confirmed vs suspected | **Confirmed** |

### RISK-03 — Unknown cities look like shop names

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | `namedShopNameBits_` 2282–2304; `US_PLACE_FILLER_TOKENS` 699–981 (no rochelle); `evaluateNamedLocalShop_` 2257–2260 |
| Existing behavior | `auto body shop new rochelle` → leftovers `new` + `rochelle` (2 tokens) → NAMED_LOCAL_SHOP |
| Example | `auto body shop new rochelle` |
| Actual / likely result | ADDED |
| Expected result | KEEP (owner: city + shop is local demand) |
| Why dangerous | Any unlisted city+body shop can be treated as a competitor |
| Requirement needed | Complete service-area gazetteer **or** never infer shop names from leftover geo tokens; default UNCERTAIN |
| Confirmed vs suspected | **Confirmed** for New Rochelle; suspected for other missing cities |

### RISK-04 — Single-token cosmetic triggers without mixed-intent class

| Field | Content |
|---|---|
| Severity | **Critical** (policy) |
| File / line | DENT_MINOR / BUMPER_MINOR / SCRATCH_OR_KEYED / SMALL_JOB / EXTERIOR_PANEL_MINOR 349–402 |
| Existing behavior | One token (`dent`, `bumper`, `scratch`, `small`, `door`) + no exception words → shouldExclude true → auto-add full query |
| Example | `dent repair`; contrast `major collision with frame damage and dents` |
| Actual / likely result | First AUTO; second KEEP **only because** `collision` is an exception token |
| Expected result | This conversation: do not decide from one cosmetic word; mixed → HUMAN_REVIEW |
| Why dangerous | Real wrecks described with dent/bumper/scratch get blocked if they omit the five exception words |
| Requirement needed | Contextual classifier; UNCERTAIN default; exception vocabulary expanded or replaced |
| Confirmed vs suspected | **Confirmed** mechanism; mixed-query labels partially UNRESOLVED |

### RISK-05 — Extracting / matching a short seed inside a qualified query

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | `firstMatchingPhrase_` 4013–4017 (first list hit wins); seeds `a1`, `f1`, `earl` 309–312 |
| Existing behavior | Does not add the short word alone, but **selects the full query** for exact negative because the short token is present |
| Example | Docs: `earl smith collision`; `a1 body shop` |
| Actual / likely result | Full-query EXACT add |
| Expected result | UNKNOWN; docs warn false positives; owner previously accepted aggressive tokens |
| Why dangerous | Phrase/exact of a long query still kills that query; short tokens collide with names/cities |
| Requirement needed | Ban short tokens (<3–4 chars) unless HUMAN_REVIEW; distinctive multi-word brands only |
| Confirmed vs suspected | **Confirmed** in code/docs; live `earl smith` not in CSV |

### RISK-06 — `PAINT_MINOR` includes `paint and body` with empty exceptions

| Field | Content |
|---|---|
| Severity | **Critical** |
| File / line | 364–374 |
| Existing behavior | `paint and body shop near me` excludes; standalone install doc uses `[paint and body shop near me]` as the **verification example** of a successful add |
| Example | `paint and body shop near me`; `automobile body repairing & painting scarsdale ny` |
| Actual / likely result | ADDED |
| Expected result | UNRESOLVED / likely KEEP given 2026-08-25 body-shop keep |
| Why dangerous | Core industry phrasing |
| Requirement needed | Owner lock: is “paint and body” QUALIFIED shop intent or DISQUALIFIED paint shopping? |
| Confirmed vs suspected | **Confirmed** code + docs contradiction |

### RISK-07 — YEAR_TOKEN has no collision exception

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | 328–336, 650–654 |
| Existing behavior | Any 1990–2026 year token excludes the full query |
| Example | Docs: `2022 camry rear end collision` |
| Actual / likely result | ADDED |
| Expected result | Previously accepted FP; this conversation prefers not blocking valuable terms |
| Why dangerous | Typical collision queries include model year |
| Requirement needed | Re-lock: disable YEAR_TOKEN, or exception on collision/accident, or HUMAN_REVIEW |
| Confirmed vs suspected | **Confirmed** docs; CONTRADICTORY owner history |

### RISK-08 — SPANISH_LANGUAGE includes collision Spanish

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | 581–590 (`choque`, `colision`, `enderezado`, `golpe`, …) |
| Existing behavior | Spanish collision seekers auto-negatived; live `[talleres de pintura automotriz cerca de mi]` |
| Example | `choque cerca de mi` |
| Actual / likely result | ADDED |
| Expected result | UNKNOWN (desired customer may be Spanish-speaking) |
| Why dangerous | Language ≠ junk intent |
| Requirement needed | Owner lock on Spanish collision vs Spanish how-to (`como quitar golpes`) |
| Confirmed vs suspected | **Confirmed** code; business UNKNOWN |

### RISK-09 — Stem `cracked` → `crack` fires AUTO_GLASS

| Field | Content |
|---|---|
| Severity | **Medium** |
| File / line | `stemToken_` 4078–4080; AUTO_GLASS trigger `crack` 407; live email `[cracked dashboard repair near me]` |
| Existing behavior | `cracked dashboard` classified AUTO_GLASS |
| Example | `cracked dashboard repair near me` |
| Actual / likely result | ADDED as glass |
| Expected result | UNKNOWN (interior vs glass vs collision) |
| Why dangerous | Wrong rule, possibly wrong job type; still auto |
| Requirement needed | Do not stem `cracked` to windshield `crack`; dashboard rule separate |
| Confirmed vs suspected | **Confirmed** live add + stem rules |

### RISK-10 — Phrase/broad **coverage** of existing negatives

| Field | Content |
|---|---|
| Severity | **High** (if lists already contain short broad terms) |
| File / line | `negativeBlocksSearchTerm_` 3040–3062 |
| Existing behavior | Scripts do not **create** phrase/broad, but **honor** them as already covering. Broad: all negative tokens ⊆ query tokens |
| Example | Existing broad `body` would skip adding a duplicate but would already hide `body shop near me` |
| Actual / likely result | ALREADY_COVERED or ads already blocked |
| Expected result | UNKNOWN inventory |
| Why dangerous | Historical broad `dent`/`paint`/`body` would dwarf exact-full-query design |
| Requirement needed | Audit live campaign/shared lists; never add broad automatically |
| Confirmed vs suspected | **Suspected** (mechanism confirmed; live lists UNKNOWN) |

### RISK-11 — Geographic false positives beyond New Rochelle

| Field | Content |
|---|---|
| Severity | **Medium** |
| File / line | Place lists 699–1048; `LOW_INTENT_AUTO_GEO` 2378–2437 |
| Existing behavior | Unlisted places become name bits; `car in dallas` excluded; `car near me` kept |
| Example | Unlisted suburb + `auto body shop` |
| Actual / likely result | NAMED_LOCAL_SHOP add |
| Expected result | KEEP local demand (owner on New Rochelle) |
| Why dangerous | Incomplete gazetteer |
| Confirmed vs suspected | **Suspected** (same bug class as RISK-03) |

### RISK-12 — Competitor false positives: own brand and generic seeds

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | Seed `auto arena body shop` 320; protect only if account name matches |
| Existing behavior | On ACCOUNT_02–04, searching Auto Arena is a competitor add (test EX-027). On ACCOUNT_01 it is PROTECTED |
| Example | `auto arena body shop` |
| Actual / likely result | Account-dependent |
| Expected result | Owner 2026-08-24 listed it as a **missed add** (wanted blocked everywhere except maybe own account) |
| Why dangerous | Cross-account: correct competitor vs false; own-account: protect. Owner miss list **conflicts** with own-brand protect |
| Confirmed vs suspected | **Confirmed** tests; owner labels CONTRADICTORY |

### RISK-13 — Singular/plural / stemming over-match

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | 4024–4095, 4056–4063 prefix `re`/`un`/`pre` (`repaint`≈`paint`) |
| Existing behavior | Intended for tints/bumpers; also causes RISK-01 |
| Example | `body work` vs `body works` |
| Why dangerous | Service language ≡ competitor brand |
| Confirmed vs suspected | **Confirmed** |

### RISK-14 — Search-term intent vs matched-keyword performance

| Field | Content |
|---|---|
| Severity | **Low** (not implemented) |
| File / line | Aggregation ignores keyword (2019); Search GAQL still selects ad group unused |
| Existing behavior | Does not use keyword stats to decide |
| Why dangerous | N/A today; a future AI must not substitute keyword CPA for query intent |
| Confirmed vs suspected | N/A |

### RISK-15 — Zero conversions in a short window

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | 1362–1383; CONFIG 237–238 |
| Existing behavior | Zero conversions in 7 + 30 days is **required** to add, not a weak signal |
| Example | Qualified `body work near me` with impressions and $0 conversions still added (if rules match) |
| Expected result | This conversation: insufficient data / UNCERTAIN ≠ auto-negative |
| Why dangerous | New good queries look like junk |
| Confirmed vs suspected | **Confirmed** |

### RISK-16 — Conversion lag beyond 30 days

| Field | Content |
|---|---|
| Severity | **Medium** |
| File / line | HISTORICAL_GUARD_DAYS 30 |
| Existing behavior | Later conversion does not un-negative |
| Why dangerous | Phone-call lag; already-added exact remains |
| Confirmed vs suspected | **Suspected** (typical Ads lag; no in-repo proof) |

### RISK-17 — Email / CSV vs mutations

| Field | Content |
|---|---|
| Severity | **Medium** |
| File / line | Caps 247–249, 251–254; Preview skips email 1171; Hub Preview skips scoring 939–944; mutateAll Scripts Details blank columns (docs) |
| Existing behavior | CSV/email can truncate; Preview Hub shows nothing; operator may compare UI row counts (ad-group) to unique campaign-terms |
| Example | 2026-08-24: termsReviewed 22 vs UI ~30+ rows |
| Why dangerous | Humans think the script “missed” terms it never saw or aggregated away |
| Confirmed vs suspected | **Confirmed** 2026-08-24 diagnosis thread |

### RISK-18 — Duplicate / conflicting negatives

| Field | Content |
|---|---|
| Severity | **Medium** |
| File / line | Cache 1569–1574; coverage skip; no shared-list write |
| Existing behavior | Same term two campaigns → two exacts. Hub + standalone on same ID **double-add** (docs warning) |
| Why dangerous | Messy lists; harder undo |
| Confirmed vs suspected | **Confirmed** as documented foot-gun |

### RISK-19 — Scope mismatch

| Field | Content |
|---|---|
| Severity | **Low** on writes (campaign only) |
| File / line | 2745–2756 |
| Existing behavior | Campaign exact. Standalone skips non–Built by Shah campaigns; **Hub Search does not** — all enabled Search campaigns in the account |
| Why dangerous | Hub could negative non-agency campaigns in mixed accounts |
| Confirmed vs suspected | **Confirmed** code difference |

### RISK-20 — Default uncertainty to negative

| Field | Content |
|---|---|
| Severity | **Critical** (vs this conversation) |
| File / line | `shouldExclude: eligibleRules.length > 0` 2120 |
| Existing behavior | Any eligible rule → auto path (if gates pass) |
| Expected result | UNCERTAIN → HUMAN_REVIEW |
| Confirmed vs suspected | **Confirmed** |

### RISK-21 — Failure paths that still apply some changes

| Field | Content |
|---|---|
| Severity | **Medium** |
| File / line | mutateAll partial chunk success; then `hadFailure` skips done stamp (1594, 1667–1680) |
| Existing behavior | Some negatives persist; account retried later (duplicates skipped via coverage) |
| Why dangerous | Partial wave; email may show FAILED mixed with ADDED |
| Confirmed vs suspected | **Suspected** typical batch APIs; code records per-item failure |

### RISK-22 — Search-term text as instructions

| Field | Content |
|---|---|
| Severity | **Low today** |
| File / line | Terms used as keyword text only |
| Existing behavior | No LLM prompt injection surface in production JS |
| Why dangerous | A future AI-assisted system **must** treat search terms as untrusted data, not instructions |
| Confirmed vs suspected | **Suspected** (rebuild risk) |

### RISK-23 — Match syntax / sanitization

| Field | Content |
|---|---|
| Severity | **Low–Medium** |
| File / line | 2983–2987 strips brackets and punctuation |
| Existing behavior | Query with `[]` or commas becomes different negative text than raw query |
| Why dangerous | UI search term ≠ stored exact; undo harder |
| Confirmed vs suspected | **Suspected** |

### RISK-24 — TOWING / ESTIMATE / CHEAP / PAYMENT ignore collision

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | TOWING 629–632; ESTIMATE 533–539; CHEAP 475–478; PAYMENT 522–530 — empty exceptions |
| Existing behavior | `collision repair payment plan`, `free quote collision repair`, `tow` after accident all exclude |
| Expected result | Some documented as intentional; this conversation did not re-lock |
| Why dangerous | Serious-accident customers often search estimate/tow/finance |
| Confirmed vs suspected | **Confirmed** code; business CONTRADICTORY |

### RISK-25 — Hub PMax `createNegativeKeyword`

| Field | Content |
|---|---|
| Severity | **High** (Hub PMax path) |
| File / line | `built-by-shah-mcc-pmax-negatives-sweeper.js` 1071, 2155–2169; contrast standalone mutateAll 51–52, 2745 |
| Existing behavior | Asserts methods that standalone says PMax objects lack |
| Actual / likely result | FAILED all PMax adds on Hub path |
| Expected result | Same mutateAll as standalone if PMax negatives are required |
| Confirmed vs suspected | **Suspected** (no live Hub PMax log in-repo); standalone comment is EXPLICIT |

### RISK-26 — Too-early daily run + done label

| Field | Content |
|---|---|
| Severity | **High** (historical; mitigated but not eliminated) |
| File / line | Was ACTION_WINDOW_DAYS 1 at 2026-08-24 3:41 AM PT run; now 7-day window 234, 3969–3983; still stamps done for **calendar day** 1667 |
| Existing behavior | After success, same-day late-arriving terms wait until **tomorrow’s** overlap (7 days includes yesterday again) |
| Example | Owner miss list vs 3:41 AM pull |
| Why dangerous | Same-day UI vs script disagreement; operators distrust the tool |
| Confirmed vs suspected | **Confirmed** 2026-08-24; 7-day change later |

### RISK-27 — `isGenericBodyIntent_` / OEM keep omit `body work`

| Field | Content |
|---|---|
| Severity | **High** |
| File / line | 2154–2178, 2206–2210 (`work` not allowed) |
| Existing behavior | Helpers that spare `body shop` do not spare `body work` |
| Example | `bmw body work repairs` |
| Actual / likely result | Not kept by OEM helper; competitor stem may still exclude |
| Expected result | KEEP |
| Confirmed vs suspected | **Confirmed** |

### RISK-28 — Hub Preview scores nothing; standalone Preview emails nothing

| Field | Content |
|---|---|
| Severity | **Medium** (ops) |
| File / line | Hub 939–944; standalone 1171 |
| Existing behavior | Operators cannot Preview-check Hub decisions; standalone Preview has no email CSV |
| Why dangerous | First **Run** is live auto-apply |
| Confirmed vs suspected | **Confirmed** |

### RISK-29 — Wrong Hub disable IDs in Definitions

| Field | Content |
|---|---|
| Severity | **Medium** |
| File / line | `create-hub-workbook.gs` ~193 `FREE_ESTIMATE`; Instructions `SPANISH_BODY_SHOP` vs `SPANISH_LANGUAGE` |
| Existing behavior | Typing the docs alias does **not** disable the real rule (`toSet_` uppercases exact id 2085) |
| Why dangerous | Shop thinks glass/estimate is off; script still adds |
| Confirmed vs suspected | **Confirmed** string mismatch |

---

## Prioritized unanswered business-rule questions

Do not answer these in implementation without the owner. Ordered by how badly they block a conservative rebuild.

1. **When a query contains both a serious-accident/collision signal and a cosmetic word (`dent`, `scratch`, `bumper`, `paint`), must the system KEEP, HUMAN_REVIEW, or still AUTO_NEGATIVE?** Code only spares some rules if specific exception tokens appear. This conversation forbids single-word auto-decide but does not publish a full override table.

2. **Is “body work” / “paint and body” / “auto body works” always QUALIFIED shop demand?** Owner 2026-08-25 said yes for the twelve terms. Docs and `PAINT_MINOR` still treat paint-and-body as junk. **Must `custom body shop` stay DISQUALIFIED?**

3. **May the system auto-negative any term without a human, or must AUTO_NEGATIVE be limited to a named high-precision subset (salvage, oil change, named national chains, …) with everything else HUMAN_REVIEW?** This conversation says uncertainty must not auto-negate. The Hub plan said auto-add then review after.

4. **Should `free estimate` / `free quote` / `estimate` on collision queries be DISQUALIFIED, QUALIFIED, or UNCERTAIN?** Owner previously locked block; collision customers commonly search this.

5. **Should model years (YEAR_TOKEN), towing, financing, cheap/affordable, and Spanish collision vocabulary auto-block even when the query is otherwise a wreck/body-shop search?**

6. **How should OEM + body shop / body work / collision be treated vs OEM + service/dealership?** Owner kept Cadillac/BMW body-shop queries. Is **every** make+body-shop QUALIFIED (owner option “keep all OEM body” was C on question 2 — if A and C applied to both questions, this may already be locked)?

7. **Are competitor names account-specific (never negative own brand; negative other shops’ brands) or global?** `auto arena body shop` on the miss list vs own-account protect vs seed competitor.

8. **Is Spanish-language collision demand in-market (KEEP/HUMAN_REVIEW) or out-of-market junk (AUTO)?** `SPANISH_LANGUAGE` currently auto-blocks `choque` / `colision` / `enderezado`.

9. **What is the service-area rule?** Keep all US city+body-shop queries? Only listed cities? HUMAN_REVIEW for unknown places? Out-of-area negatives?

10. **Are towing, glass, PDR, mechanical, salvage, RV, Sprinter, classic cars globally out of scope, or per-shop (today’s Disabled Rule IDs model)?**

11. **Must converted queries always KEEP even if clearly cosmetic?** Code yes. Conservative policy unspecified.

12. **Is exact-full-query the only allowed negative implementation even after human approval, or may reviewers add phrase negatives?**

13. **Which product is production: standalone allowlist, Hub/Spoke sweepers, or both?** Overlap is forbidden per shop. Live logs show standalone 4 shops; Hub URL in repo is empty.

14. **Schedule: is 7:00 AM Pacific the required earliest Run, and should a successful morning run still re-open if Search terms arrive later the same day?**

15. **For terms longer than 80 characters / 10 words, is MANUAL_REVIEW the right queue, and who triages standalone email vs Hub spoke?**
