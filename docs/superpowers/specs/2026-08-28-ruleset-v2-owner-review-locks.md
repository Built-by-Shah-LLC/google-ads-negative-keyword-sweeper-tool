# Spec: Ruleset v2 — Owner Review Locks from P&C ST Review Sheet

**Date:** 2026-08-28
**Status:** IMPLEMENTED 2026-08-28 — ruleset `2026-08-28.1` shipped; QA SHIP verdict; security PASS WITH NOTES (own-brand distinctiveness guard applied). Live eval (`npm run eval:kimi`) and P&C re-run pending Kimi quota.
**Supersedes/amends:** `2026-08-27-handoff-ruleset-llm-classifier.md` (owner-locked decisions 1, 2, 3 partially reversed herein)
**Target artifact:** `src/config/negative-keyword-rules.md` → rule set version `2026-08-28.1`

## Intent

The owner reviewed the P&C AUTOMOTIVE search-term export (run `20260827T153825893Z-37ac663c`)
and annotated ~130 `KEEP` rows with a `Notes` column. Every note argues the row should be a
negative. These notes are **owner locks** — they answer several `handoff/05_` open questions and
**reverse** parts of the 2026-08-27 owner-locked decisions.

## Owner decisions locked on 2026-08-28 (this discussion)

1. **Geo/service-area (A2, B2, Q6): DROPPED.** No proximity rules, no service-area context.
   All out-of-area proximity notes are out of scope for v2.
2. **Competitor detection (A6): EXPANDED + LOCKED — aggressive.** Any `[name] collision
   center` / `[name] body shop` / `[name] auto body` pattern is a competitor negative, even
   when the name token is a superlative, acronym, state name, or make/model. Owner:
   "better safe than sorry." Exceptions: own brand, and bare generic `city + service` where
   the token is only a place (`dallas auto body repair` stays KEEP).
   - Resolves Q2 (`texas collision center(s)` = chain → negative) and Q3/A7 (`malibu body
     shop dallas`, `classic chevrolet body shop` = dealer/named shop → negative).
   - Edge lock: token that is both a place and a plausible business name (`hurst auto body`,
     `ewing body shop`) → competitor negative.
   - Domain pattern: `thebodyshop com` (brand + com) → negative.
3. **Foreign language (A12/Q5): LOCKED — all foreign-language terms → NEGATIVE**, including
   Spanish. Reverses 2026-08-27 owner-locked decision 3. `POL-SPANISH-SERVICE-KEEP` is
   repealed; `hojalatero`, `carrozzeria`, `choque cerca de mi` all negative.
   Spanish DIY stays negative under `POL-DIY-HOWTO-NEGATIVE` (unchanged behavior).
4. **Paint (A4/Q7): LOCKED — any paint/painting/painter/repaint mention → NEGATIVE**,
   including `paint and body` phrasing. Owner rationale: paint jobs are mediocre ROI for the
   shop. Reverses the `paint and body shop near me` KEEP example.
5. **Parts vs collision (Q1): DIRECTION GIVEN, ladder pending.** Owner: "`major collision`
   wins, `accident bumper repair` not so much." See Part C ladder draft — needs owner
   confirmation on edge cases.
6. **Everything not questioned in discussion is ACCEPTED**: A1 (mechanic/technician/
   specialist override), A3 (small-jobs), A8 (unclear work type), A9 (UNDEFINED narrowing),
   A10 (rust), B1 (addresses), B3 (price-shopper), B4 (free), B5 (financing/budget),
   B6 (reviews), B7 (custom/fabrication), B9 (non-automotive), B10 (rental).

## Goal

Ruleset `2026-08-28.1` classifies the ~130 reviewed rows per the owner's notes while keeping
the binary contract (`KEEP | NEGATIVE_EXACT`), the no-deterministic-matcher architecture
(rules guide the LLM only), and full-query-exact negative integrity.

## Benchmark

- `npm run eval:kimi` over `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` **with updated
  expectations** for reversed categories (incl. Spanish rows flipping KEEP → NEGATIVE).
- Append the ~130 reviewed rows as new gold data. Target: ≥90% agreement on the new set,
  zero regressions on still-locked KEEP families (generic body-work, broad collision with
  service wording, own brand, insurers, OEM+body without city).

---

## Part A — Existing rules to FINE-TUNE

| # | Rule | Change | Status |
|---|---|---|---|
| A1 | `POL-MECHANICAL-ONLY-NEGATIVE` | `mechanic`/`technician`/`specialist`/`tech` tokens override body wording | ACCEPTED |
| A2 | `POL-GEO-LOCAL-KEEP` | ~~out-of-area carve-out~~ | **DROPPED** |
| A3 | `POL-COSMETIC-ONLY-NEGATIVE` | scratch/dent/ding/minor/small-job negatives even with body wording | ACCEPTED |
| A4 | `POL-COSMETIC-ONLY-NEGATIVE` (paint scope) | any paint/painting/painter/repaint → negative, incl. `paint and body` | **LOCKED** (Q7) |
| A5 | `POL-PARTS-ONLY-NEGATIVE` | any named-part repair scope → negative; crash-event severity ladder per Part C | **LOCKED** (Q1) |
| A6 | `POL-COMPETITOR-NEGATIVE` | aggressive `[name] + collision center/body shop/auto body/auto repair` = competitor; superlatives, acronyms (`dfw`, `az`, `dmv`, `rg`), state-name chains, make/model+city, place-or-name ambiguity, `brand com` domains | **LOCKED** |
| A7 | `POL-OEM-BODY-KEEP` | make/model + service **+ city** → dealer/named shop negative (folds into A6); make/model + service without city stays KEEP (`chevy body shop`) | RESOLVED via A6 |
| A8 | `POL-COLLISION-KEEP` | bare `collision`, `service collision`, `car damage repair`, `car broken` (no shop/repair/body context) → negative | ACCEPTED |
| A9 | `POL-UNDEFINED-KEEP` | remove: free estimate/quote, payment/financing, cheap/affordable, custom body shop, towing, informational price queries. **Remains KEEP:** attorney/legal, appraisal/adjuster, model-year, general informational | ACCEPTED |
| A10 | `POL-WRONG-VEHICLE-NEGATIVE` | add rust / older-vehicle intent | ACCEPTED |
| A11 | `POL-AMBIGUOUS-KEEP` | signal-less queries → negative (B8) instead of KEEP | **LOCKED** (Q4 blanket) |
| A12 | `POL-SPANISH-SERVICE-KEEP` | **REPEALED** — see B11 | **LOCKED** (Q5) |

## Part B — NEW rules to ADD

| # | Rule ID | Scope | Status |
|---|---|---|---|
| B1 | `POL-ADDRESS-ONLY-NEGATIVE` | bare street address / navigational, no service wording | ACCEPTED |
| B2 | ~~`POL-OUT-OF-AREA-NEGATIVE`~~ | — | **DROPPED** |
| B3 | `POL-PRICE-SHOPPER-NEGATIVE` | cost/price/estimate/quote/calculator/how much | ACCEPTED |
| B4 | `POL-FREE-NEGATIVE` | free/sample/example | ACCEPTED |
| B5 | `POL-FINANCING-BUDGET-NEGATIVE` | finance/payment plan/BNPL(sunbit)/discount/affordable/cheap | ACCEPTED |
| B6 | `POL-REVIEWS-NEGATIVE` | review/reviews | ACCEPTED |
| B7 | `POL-CUSTOM-FABRICATION-NEGATIVE` | custom/fabrication/fiberglass | ACCEPTED |
| B8 | `POL-NO-SERVICE-SIGNAL-NEGATIVE` | zero collision-event/body/insurer/own-brand signal → negative | **LOCKED** (Q4 blanket) |
| B9 | `POL-NON-AUTOMOTIVE-NEGATIVE` | devices/electronics/non-vehicle | ACCEPTED |
| B10 | `POL-RENTAL-NEGATIVE` | rental-car intent | ACCEPTED |
| B11 | `POL-FOREIGN-LANGUAGE-NEGATIVE` | any non-English query (Spanish, Italian, …) | **LOCKED** (Q5) |

## Part C — Precedence + the parts/collision ladder (Q1 draft for discussion)

Proposed decision order:

1. `POL-OWN-BRAND-KEEP` — always first.
2. Always-win negatives: B1 address, B9 non-automotive, B11 foreign, B10 rental, B6 reviews,
   B3–B5 price/free/financing, B7 custom, A10 rust/wrong-vehicle, A6 competitor.
3. A4 paint and A3 small-jobs — override body/collision wording.
4. **A5 parts ladder (Q1 proposal):**
   - **KEEP** when explicit severe crash-event language indicates broad/structural damage:
     `collision`, `crash`, `wreck`, `totaled`, insurance-claim collision —
     e.g. `major collision with frame damage and dents` (owner: wins),
     `honda accord collision insurance claim`, `rear end collision repair` (proposed KEEP).
   - **NEGATIVE** when repair scope is a single named part/zone, even with `accident`:
     `accident bumper repair` (owner lean: negative), `frame repair near me`,
     `fender bender repair`, `car front end damage repair`, `fix a car door`.
   - Open edge: `insurance claim bumper repair` — insurer lock vs parts scope. Proposal:
     insurer KEEP wins only when `collision`/`crash` wording is present; otherwise parts win.
5. A1 mechanical-token override.
6. B8 no-service-signal (if Q4 approved).
7. KEEP rules: collision-with-service-context (A8-narrowed), bodywork without paint/parts
   triggers, OEM-body without city, insurer, geo-local (unchanged, any city).
8. `POL-AMBIGUOUS-KEEP` — only for signal-present-but-contradictory (shrinks if Q4 approved).

## Part D — Final owner locks (2026-08-28, all resolved)

- **Q1 ladder: CONFIRMED.** `rear end collision repair` → KEEP; `accident bumper repair` →
  NEGATIVE; `insurance claim bumper repair` → NEGATIVE (insurer rescues only when
  `collision`/`crash` is also present).
- **Q4: CONFIRMED — blanket B8.** Signal-less queries default NEGATIVE with the approved
  KEEP signal list: crash-event tokens incl. slang (`collision`, `crash`, `wreck`,
  `totaled`, `rear ended`, `tboned`/`t-boned`, `hit my car`, `smashed`, `accident`),
  body tokens (`body`, `autobody`, `auto body`, `body shop`, `body work`), insurer names,
  own brand — plus the A8 service-context requirement (bare `collision` alone still
  negatives without shop/repair context).
- **Scope: CONFIRMED global agency policy** — applies to all 4 organizations.

No open questions remain.

## Part E — Code/config touchpoints

1. `src/config/negative-keyword-rules.md` → v2026-08-28.1 (the bulk of the work).
2. ~~Service-area prompt context~~ — **not needed** (geo dropped).
3. `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` / eval override map: update expectations
   for reversed categories (Spanish rows, custom, financing, free-estimate, paint, towing,
   informational-price); append the ~130 new owner-labeled rows.
4. Update the 2026-08-27 spec's "Owner-locked decisions" with a pointer here.

## Part F — Verification

1. `npm run check && npm test`.
2. `npm run eval:kimi` — ≥90% on the new ~130-row set; 100% on still-locked KEEP families;
   zero negatives on own-brand/insurer/generic body-work.
3. Re-run P&C AUTOMOTIVE (2,828 candidates) after Kimi quota reset; the 1,928 MISSING rows
   get classified and reviewed rows flip KEEP → NEGATIVE_EXACT with intended rule IDs.
4. Diff old vs new CSV row-by-row for the reviewed set.

## Risks & rollback

- **Over-negativing risk concentrates in Q1 (parts) and Q4 (default inversion).** Both are
  gated on owner confirmation + eval pass before any re-run.
- **Cross-org contamination:** these locks came from P&C's sheet but the rules file is shared
  by all 4 orgs. Confirm locks are global (assumed yes — owner reviews represent the whole
  agency's policy) before re-running Tello's, G&S, Auto Arena.
- **Rollback:** restore `2026-08-27.1` rules file + version string. Read-only phase — no Ads
  mutations to revert.

## Non-goals

- No Google Ads mutations (read-only stands).
- No deterministic word matcher in app code.
- Binary decision contract unchanged; no HUMAN_REVIEW state.
- No geo/service-area logic (dropped by owner).
