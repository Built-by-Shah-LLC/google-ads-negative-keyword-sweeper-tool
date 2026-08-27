# Spec: Handoff Business Rules → LLM Ruleset Rebuild

**Date:** 2026-08-27
**Branch:** `keywords-pipeline`
**Status:** Approved by owner, ready for implementation

## Intent

The LLM classifier (Kimi one-off today, Gemini adapter in the pipeline) must behave according to
the business logic, understanding, and rules documented in `handoff/` — implemented inside our
own TypeScript pipeline, not the legacy Google Ads Scripts.

## Problem

Current rule set (`src/config/negative-keyword-rules.json` v2026-08-26.2) has only 6 thin rules.
A live smoke test against the 124 owner-labeled examples
(`handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv`, run `runs/kimi-20260826T193757457Z`) scored:

- Overall agreement: **44.4%**
- Negative recall: **13.3%** (10/75)
- False positives: **4** — all in categories the handoff marks UNDEFINED (attorney,
  informational, mechanic-without-label, Spanish DIY)

Root cause: the rule set does not encode the business. The model free-styled on undefined
categories and followed an over-conservative KEEP bias on clear-junk categories.

## Goal

Classification behavior matches the handoff policy:

- Owner-confirmed keeps are never negatived (body-work family, collision intent, own brand,
  insurers, city+shop local demand, OEM+body).
- Clearly-irrelevant categories are negatived (salvage, careers, DIY/how-to, parts-only,
  mechanical-only, glass/tint, competitors, bare vehicle/low-intent geo, keys, wrong-vehicle,
  cosmetic-only with zero collision signal).
- Undefined/contradictory categories default to KEEP (no invented rules).
- Binary contract `KEEP | NEGATIVE_EXACT` unchanged (controlling architecture).

## Benchmark

Regression harness (`npm run eval:kimi`) over the 124 labeled rows. Targets vs baseline:

| Metric | Baseline (v2026-08-26.2) | Target |
|---|---|---|
| KEEP-side accuracy on owner-labeled keeps (EX-001–012 etc.) | ~failures observed | 100% |
| False positives (expected KEEP → NEGATIVE) | 4 | ≈0 |
| Overall agreement | 44.4% | ≥80% |
| Negative recall on clear-junk categories | 13.3% overall | ≥80% on junk categories |

## Owner-locked decisions (2026-08-27, this conversation)

1. **Cosmetic-only zone**: `NEGATIVE_EXACT` only when the full query is clearly a cosmetic-only
   service (PDR, dent-only, scratch-only, paint-only, detailing) with zero
   collision/accident/insurance/frame signal. Any such signal → KEEP.
2. **Undefined categories** (towing, free estimate/quote, financing, cheap/affordable,
   attorney/legal, informational, model-year tokens, custom body shop): **all KEEP** until the
   owner locks a rule. Overrides the historical "block free estimate" lock.
3. **Spanish**: Spanish collision/repair demand → KEEP; Spanish DIY/how-to
   (`como quitar golpes de granizo`) → NEGATIVE.
4. **Competitors**: national chains + named local shops → NEGATIVE; a query matching the
   account's own name → KEEP.
5. **Eval harness**: build as a permanent npm script.

## Proposed changes

### Phase 1 — Rule set rebuild (`src/config/negative-keyword-rules.json` → v2026-08-27.1)

KEEP-side rules:

| Rule ID | Covers | Kills handoff risk |
|---|---|---|
| `POL-COLLISION-KEEP` | collision/crash/accident/frame/unibody incl. insurance-claim language; cosmetic words do not matter | RISK-04 |
| `POL-BODYWORK-KEEP` | body work / auto body / body shop + near me / city — the 12 owner-labeled false adds | RISK-01, RISK-27 |
| `POL-OEM-BODY-KEEP` | brand + body shop / body work / collision ≠ dealer search | RISK-02 |
| `POL-OWN-BRAND-KEEP` | query contains the account's own name | RISK-12 |
| `POL-INSURER-KEEP` | insurer names; `aaa collision`/`aaa insurance` protected, bare `aaa` not | — |
| `POL-GEO-LOCAL-KEEP` | any city + shop/collision language = local demand, even unlisted cities | RISK-03, RISK-11 |
| `POL-AMBIGUOUS-KEEP` | mixed / insufficient / conflicting evidence → KEEP | RISK-20 |

NEGATIVE-side rules (only when the full query is clearly that intent):

| Rule ID | Covers |
|---|---|
| `POL-SALVAGE-JUNK-NEGATIVE` | salvage yard, junkyard, pick-n-pull, cash-for-cars |
| `POL-CAREERS-NEGATIVE` | jobs, hiring, salary, training, school |
| `POL-DIY-HOWTO-NEGATIVE` | how-to, DIY, incl. Spanish `como quitar/arreglar` |
| `POL-PARTS-ONLY-NEGATIVE` | parts, kits, body kit, interior/dashboard parts, upholstery |
| `POL-MECHANICAL-ONLY-NEGATIVE` | oil/brakes/engine/transmission/mechanic/alignment/tires, dealer service (`bmw service`) — no body/collision signal |
| `POL-GLASS-TINT-NEGATIVE` | windshield/glass-only (safelite), window tint |
| `POL-COSMETIC-ONLY-NEGATIVE` | PDR, dent-only, scratch, bumper-only, paint-only, detailing — zero collision signal (decision 1) |
| `POL-COMPETITOR-NEGATIVE` | national chains + named local shops; never the account's own name (decision 4) |
| `POL-BARE-VEHICLE-NEGATIVE` | bare make/model, low-intent geo (`car in dallas`), car shopping |
| `POL-KEYS-NEGATIVE` | car key / fob / locksmith |
| `POL-WRONG-VEHICLE-NEGATIVE` | RV/motorhome, classic/antique, sprinter conversion |

Meta rules:

- `POL-UNDEFINED-KEEP` — explicit list of decision-2 categories → KEEP.
- `POL-FULL-QUERY-EXACT` — output contract: negativeText equals the complete submitted searchTerm.

### Phase 2 — Code changes (minimal, additive)

- `src/types.ts`: `Rule` gains optional `examplesKeep` / `examplesNegative`
  (validation only reads `rule.id`; zero breakage).
- New `src/llm/prompt.ts`: single shared system-instruction + user-payload builder consumed by
  both `src/llm/gemini-classifier.ts` and `scripts/kimi-subscription-one-off.ts`
  (eliminates existing prompt drift between the two paths).

### Phase 3 — Eval harness

- New `scripts/evaluate-labeled-examples.ts` + npm script `eval:kimi`.
- Builds candidates from `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv`
  (mapping `AUTO_NEGATIVE_ALLOWED → NEGATIVE_EXACT`; `KEEP / HUMAN_REVIEW / UNRESOLVED → KEEP`),
  runs live Kimi classification, writes `runs/eval-<timestamp>/report.json` with overall
  agreement, KEEP-side accuracy, negative recall/precision, and per-category FP/FN listings.
- Known expected disagreement: EX-114 `range rover mechanic near me` (owner pasted without a
  keep/block label) will be NEGATIVE under `POL-MECHANICAL-ONLY-NEGATIVE` — flagged in report.

### Phase 4 — Verification

`npm run check` → `npm test` → `npm run eval:kimi`, compared against the recorded baseline.

### Phase 5 — Docs

Update `docs/MULTI_ORGANIZATION_LLM_SWEEPER_PLAN.md` status + README (ruleset version,
eval command).

## Non-goals

- No Google Ads mutations (read-only phase stands).
- No fetch/pipeline changes; OAuth-dependent paths untouched.
- No deterministic word matcher in app code (rules guide the LLM only — controlling
  architecture decision).
- Binary decision contract unchanged; no HUMAN_REVIEW decision state.

## Open questions

None blocking. Handoff `05_` questions 1–15 remain owner-level business locks; decision 2 above
defaults all of them to KEEP until the owner answers them.
