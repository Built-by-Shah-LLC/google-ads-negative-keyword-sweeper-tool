# CarVive Collision Centers — 30-day head-to-head: Kimi `kimi-k2.6` (thinking enabled) vs OpenAI `gpt-5.6-luna` (low reasoning)

Date: 2026-09-02 · Rule set: `2026-09-02.5` · Prompt: `collision-classifier-v6` · Candidates: **2819** (same set for both, fetched once 2026-08-03..2026-09-01, 4,095 raw rows) · Account: `3076522621` (America/Los_Angeles)

Note: this account ran under rules `2026-09-02.5`, one revision newer than the G&S 30-day run (`2026-09-02.4`). `.5` makes body-attached `repair` (`auto body repair`, `body repair`) KEEP and keeps only contiguous `auto repair` / `car repair` mechanical. Both models followed `.5` here; repair-with-body terms are therefore not comparable with the G&S numbers.

## Runs

| | Kimi `kimi-k2.6` | OpenAI `gpt-5.6-luna` |
|---|---:|---:|
| Run dir | `runs/measure-carvive-30day-kimi-20260902T161857188Z` | `runs/measure-carvive-30day-openai-20260902T160846701Z` |
| Endpoint | api.kimi.com/coding/v1 (subscription) | OpenAI Responses API (pay-per-token) |
| Reasoning | thinking: enabled (k2.6 max; k2.6 has no low/high gradation) | effort: low |
| Batch size | 25 | 50 |
| Status | SUCCEEDED (0 failed batches, 113/113) | PARTIAL (56/57 batches) |
| KEEP | 1095 (38.8%) | 1081 (38.3% of all; 39.0% of scored) |
| NEGATIVE_EXACT | 1724 (61.2%) | 1688 (59.9% of all; 61.0% of scored) |
| Unscored | 0 | 50 (batch 0028 failed validation twice) |
| Input tokens | 1,141,323 (74.0% cached) | 695,707 (3.4% cached) |
| Output tokens | 497,048 (reasoning 272,682) | 214,354 (reasoning 21,815) |
| Total tokens | 1,638,371 | 910,061 |
| Wall clock | ~61 min | ~10 min |
| Marginal cost | $0 (subscription quota) | $0.3921 |
| K2.6 list-price equivalent | $2.41 (platform $0.95/$0.16/$4.00 per 1M — key not platform-authorized, shown for scale) | — |
| Token reconciliation | reconciled | reconciled |

Luna's failed batch 0028 (50 terms unscored): for item `tesla auto collision center` the model emitted `negativeText: "paint scratches on car"` — a different term's text from the same batch. Exact-text validation correctly rejected the response twice. No other batch failures in either run.

## Headline agreement: 2686/2769 = 97.0%

(2,769 paired terms; the 50 terms in Luna's failed batch have Kimi-only decisions.)

| | count | % of 2769 |
|---|---:|---:|
| Both NEGATIVE | 1649 | 59.6% |
| Both KEEP | 1037 | 37.5% |
| Kimi NEG, Luna KEEP | 44 | 1.6% |
| Kimi KEEP, Luna NEG | 39 | 1.4% |

Essentially the same agreement as G&S (97.4%).

## Rules-based correctness audit (no CarVive owner labels exist — methodology below)

Bucket A (deterministic NEGATIVE per own-brand/always-win token rules or no KEEP signal): **1153 terms**. Bucket B (deterministic KEEP: approved KEEP signal, zero triggers, generic leftover): **543 terms**. Bucket C (gray: competitor-vs-place judgment, 600 unique leftover clusters): **1123 terms**.

| | Kimi correct | Kimi wrong | Luna correct | Luna wrong |
|---|---:|---:|---:|---:|
| Bucket A negatives (1153) | 1148 (99.6%) | 5 (0.4%) | 1126/1134 scored (99.3%) | 8 (0.7%) |
| Bucket B KEEPs (543) | 534 (98.3%) | 9 (1.7%) | 519/535 scored (97.0%) | 16 (3.0%) |
| **Total scored (A+B=1696)** | **1682 (99.2%)** | **14 (0.8%)** | **1645/1669 (98.6%)** | **24 (1.4%)** |

Luna's unscored rows by bucket: A 19, B 8, C 23.

### Wrong KEEPs — deterministic negatives the model failed to negative (Bucket A errors)

| Term | Model | Expected rule(s) | Model cited | Reason |
|---|---|---|---|---|
| diminished value claim (also `car diminished value claim`, `diminished value claim california`) | Kimi ×3 | no KEEP signal (POL-NO-SERVICE-SIGNAL-NEGATIVE) | POL-AMBIGUOUS-KEEP | Over-extended the appraisal/adjuster carve-out; no collision or body-shop signal present. Debatable — see gap 4. |
| side swipe car repair | Kimi, Luna | contiguous `car repair`, no listed crash-event (POL-MECHANICAL-ONLY-NEGATIVE) | POL-COLLISION-KEEP (Kimi), POL-BODYWORK-KEEP-ish (Luna) | Both treated unlisted `side swipe` as crash-event wording. Letter-strict error; spirit-reasonable — see gap 5. |
| getting car fixed through insurance | Kimi | repair-equivalent `fixed`, no body/crash (POL-MECHANICAL-ONLY-NEGATIVE) | POL-AMBIGUOUS-KEEP | Claim adjacency does not create a body-shop signal. |
| body car repair near me | Luna | contiguous `car repair` wins even with `body` elsewhere (`.5` explicit) | POL-BODYWORK-KEEP | Read jumbled word order as body repair; the `.5` contiguous-phrase rule says NEG. |
| bmw certified shops | Luna | no body/collision wording — bare `shops` is not body-shop signal (POL-NO-SERVICE-SIGNAL-NEGATIVE) | POL-OEM-BODY-KEEP | Invented body context ("BMW plus body-shop context") that the query does not contain. |
| certified tesla repair shop near me (also `tesla certified repair shop near me`) | Luna ×2 | make plus generic repair shop = mechanical (`.5` explicit) | POL-OEM-BODY-KEEP | G&S showed the same pattern NEG'd correctly by both; here Luna protected it. |
| dent body shop | Luna | dent is the ask (POL-COSMETIC-ONLY-NEGATIVE) | POL-BODYWORK-KEEP | Reasoned "dent is not the sole job scope" on a two-word scope query. |
| independent auto damage appraisal companies | Luna | no KEEP signal (POL-NO-SERVICE-SIGNAL-NEGATIVE) | POL-AMBIGUOUS-KEEP | Appraisal without collision/claim signal; debatable — see gap 4. |

### Wrong NEGATIVEs — clean KEEP-signal terms the model negatived (Bucket B errors)

| Term | Model | Why KEEP-able | Model cited | Reason |
|---|---|---|---|---|
| collision car repair | Luna | crash-event wording saves contiguous `car repair` (`.5` explicit: `collision auto repair` stays KEEP) | POL-MECHANICAL-ONLY-NEGATIVE | Direct rule misapplication: "contiguous car repair is mechanical intent despite collision wording". |
| car body | Kimi | generic body wording, zero triggers (same call as G&S) | POL-BARE-VEHICLE-NEGATIVE | Same term was a both-model error at G&S; only Kimi repeats it here. |
| quality body shop / good body shop near me / good body shops near me / good auto body shops near me / best auto body shop near me | Kimi (first two), Luna (all five) | generic quality descriptors, generic leftover (G&S `quality *` precedent) | POL-COMPETITOR-NEGATIVE | Descriptor-vs-brand uncertainty; G&S scored the same pattern as a model error. |
| expert auto body / expert body shop / body shop experts | Kimi ×3, Luna (`expert auto body` only) | generic trust descriptor (same class as `quality`) | POL-COMPETITOR-NEGATIVE | Kimi over-fires the leftover lock on trust descriptors; Luna fires once. |
| a&a auto body shop | Kimi, Luna | mechanical bucketer strips `a&a` to generic (G&S precedent: models wrong) | POL-COMPETITOR-NEGATIVE | Distinctive-leftover reading has merit — see debatable list. |
| the body shop / the body shop near me (×2) / the body shop collision repair | Luna ×4 | letter-KEEP: generic body-shop wording, no listed trigger | POL-COMPETITOR-NEGATIVE | "The Body Shop" brand reading. Debatable — the cosmetics-brand/named-shop reading is defensible. |
| the shop auto body / the california auto body shop (×2 rows) | Luna, both | letter-KEEP by the same generic reading | POL-COMPETITOR-NEGATIVE | Brand-phrase reading; debatable. |
| ca expert auto body and repair center | Kimi, Luna | `ca` + descriptor + body wording | POL-COMPETITOR-NEGATIVE | "CA Expert" brand reading; debatable. |

### Gray zone (Bucket C, 1123 terms) — adjudicated split: KEEP 561 (50.0%) · NEGATIVE 562 (50.0%)

All 600 leftover clusters were adjudicated by applying rules `2026-09-02.5` under the owner lock (unsure name vs place is negative), with G&S precedents: unambiguous city/neighborhood/region (including closed-up spellings like `southbay`, `silverlake`) is KEEP; street-name shops (`melrose`, `la brea`, `sunset boulevard`, `glenoaks`) are NEG under the lock; nationality/specialty descriptors (`european`, `euro`, `german`, `japanese`, `korean`, `mexican`, `spanish`, `foreign motors`) are NEG; listed brand-like tokens (`elite`, `premier`, `pro`, `master(s)`, `king(s)`, `champion(s)`, `classic(s)`) are NEG; registered suffixes already handled by `.5` in Bucket A; insurer (`nationwide collision center`) and OEM certification demand (`mopar`, `fca`, `amg`, `gm`, `byd`, `maruti`, `ev`) are KEEP; quality/trust/speed descriptors (`good`, `quality`, `reliable`, `reputable`, `excellent`, `fast`, `quick`, `express`) are KEEP by the G&S `quality` line.

| Model | Bucket C correct | Bucket C accuracy | Whole run (A+B+C) correct | Whole-run accuracy |
|---|---|---|---|---|
| Kimi `kimi-k2.6` (thinking) | 1066/1123 | 94.9% | 1682 + 1066 = **2748/2819** | **97.5%** |
| `gpt-5.6-luna` (low) | 1030/1100 scored | 93.6% | 1645 + 1030 = **2675/2769** | **96.6%** |

Both right: 1006/1100 paired (91.5%) · Both wrong: 33 rows. Disagreements (83): **Kimi right 53, Luna right 30** (C-only disagreements: 61, Kimi right 37 / Luna right 24).

Both-wrong rows (33, duplicates across campaigns kept): `collision repair network` (KEEP letter), `fast auto body`, `express body shop`, `does honda have a body shop`, `ventura collision center encino` (NEG), `cali auto body` (NEG), `aluminum body repair`, `expert auto body sun valley`, `la brea auto body shop` (NEG), `reseda saticoy auto body` (NEG), `real body shop` (NEG), `does tesla do body work` (×2), `excellent collision`, `5 star body shops`, `body shop labor rates`, `fill holes in car body` (NEG — both KEEP'd clear DIY), `la collision center north hollywood` (NEG, ×2), `body shop los angeles sunset` (NEG), `list of tesla approved body shops`, `body shop sunset boulevard` (NEG), `progressive 1 auto collision center` (NEG), `preferred auto body shop`, `luxury auto collision`, `luxury vehicle collision van nuys` (NEG), `most expensive auto body shop near me`, `mb collision centers` (NEG), `are body shops open on weekends`, `are auto body shops open on saturday`, `va auto body shop` (NEG), `auto body before and after`, `colima auto body` (NEG).

### Failure-mode signatures

- **Kimi over-KEEPs (31 of 71 errors):** force-fits double-geo readings onto brand+city patterns (`ventura collision center encino` → "Ventura and Encino are place wording"; `la collision center north hollywood`; `luxury vehicle collision van nuys`), reads state abbreviations as geo (`va auto body shop` → "VA is a state/region"), treats `commercial` as a plain descriptor on `commercial auto body shop` (fleet/commercial reading missed), over-extends the appraisal carve-out to claim-only queries (`diminished value claim` ×3), and invents crash-event wording from unlisted tokens (`side swipe car repair`).
- **Kimi over-NEGs (40 of 71):** fires the competitor lock on unambiguous local places — `reseda collision center`, `westlake auto collision`, `west valley auto body shop` (×3 rows; Reseda/Westlake/West Valley are plainly SFV neighborhoods/regions, the inverse of G&S where Kimi over-KEEP'd place readings), on the insurer `nationwide collision center`, and on trust descriptors (`reliable auto body shop` ×3, `5 star body shops`, `top rated collision center near me`).
- **Luna over-KEEPs (45 of 94):** extends `POL-OEM-BODY-KEEP` past its `.5` boundary (`certified tesla repair shop near me`, `tesla certified repair shop near me`, `bmw certified shops` — make + generic repair shop is explicitly mechanical under `.5`), misses dealer/brand names (`van chevrolet body shop` — "Chevrolet plus body-shop intent has no separate business name", wrong: Van Chevrolet is a dealer), KEEPs street-name/abbreviation shops (`melrose body shop`, `glenoaks collision center`, `yosemite auto body shop`, `beverly auto body`, `oc body shop`, `us body shop`, `310 auto collision`, `323 auto collision`), ignores the contiguous-`car repair` rule on `body car repair near me`, and waves `dent body shop` through the dent rule.
- **Luna over-NEGs (49 of 94):** fires rules outside their listed tokens — `collision car repair` (`.5` says crash-event wording saves contiguous `car repair`; Luna NEG'd it anyway), `can you fix a totaled car` (informational despite `totaled`), `no deductible auto body repair` (price rule; `deductible` not a listed token), `top rated collision center near me` (reviews rule; `rated` ≠ `rating`, same gap as G&S), `topanga auto body`, `best body shop los angeles`, `la auto collision` (plain geo), and the `the body shop *` family (brand reading; letter-KEEP).
- **Non-determinism in both models:** same term decided both ways within a single run — Kimi 10 terms (`nationwide collision center`, `the fix auto body`, `the california auto body shop`, `european body shop`, `ventura collision center encino`, `body shop experts`, `west valley auto body shop`, `5 star body shops`, `central valley auto body northridge`, `real body shop van nuys`), Luna 15 terms (`the body shop near me`, `the body shop collision repair`, `the body shop simi valley`, `collision car repair`, `best auto body shop near me`, `european body shop`, `york auto body shop`, `good body shops near me`, `topanga auto body`, `ventura collision center encino`, `best body shop los angeles`, `are body shops open on weekends`, `woodley collision`, `5 star body shops`, `certified tesla repair shop near me`). G&S flagged this for Kimi; at CarVive volume Luna flip-flops more often.

### Rules gaps surfaced by the adjudication

1. **`rated` / `5 star` / `top rated` still not covered by `POL-REVIEWS-NEGATIVE`** (tokens are review/reviews/rating/ratings). G&S gap 4 recurs: Luna fired REVIEWS on `top rated collision center near me`; both models NEG'd `5 star body shops`. KEEP by the letter. Owner decision pending from G&S.
2. **Question forms outside the informational list.** `does tesla do body work`, `does honda have a body shop`, `are body shops open on weekends`, `are auto body shops open on saturday`, `can you fix a totaled car` — KEEP by the letter (listed patterns are `what is` / `how does` / `can a` / `vs`); both models NEG'd most of them. `can you fix a totaled car` carries `totaled` and is genuinely KEEP-able; the capability/hours questions need an owner decision (service-adjacent KEEP vs informational NEG).
3. **Deductible wording uncovered.** `no deductible auto body repair`, `body shop no deductible`, `collision shops that waive deductible near me` — `deductible` is not a PRICE token. Luna fired PRICE on all three; Kimi split. KEEP by the letter; add `deductible` wording to `POL-PRICE-SHOPPER-NEGATIVE` if the owner wants these negative.
4. **Diminished-value / valuation research uncovered.** `diminished value claim` (×3, no crash token → NEG by no-signal) vs `cars value after accident` (crash token → KEEP by the letter) — the letter answer flips on token presence, not intent. Consider a `diminished value` / `value after accident` trigger under `POL-WRONG-OUTCOME-NEGATIVE` or INFORMATIONAL.
5. **`side swipe` / `sideswipe` missing from crash-event wording.** Both models treated `side swipe car repair` as crash intent; the listed crash tokens don't include it. Add it if the owner agrees it is crash-event wording (likely).
6. **Motorcycles (and ProMaster) still missing from `POL-WRONG-VEHICLE-NEGATIVE`.** `motorcycle crash repairs near me` is KEEP by the letter. G&S gap 2 (ProMaster) remains open in `.5` too.
7. **`refinishing` missing from `POL-PAINT-COLOR-NEGATIVE`.** `escondido body refinishing` — Kimi NEG (spirit: refinishing = repaint), Luna KEEP (letter). Add `refinishing` / `refinish` if the owner wants it negative.
8. **Price/image research wording outside token lists.** `body shop labor rates`, `most expensive auto body shop near me`, `auto body before and after` — KEEP by the letter; both models NEG'd. Add `rates`, `expensive`, `before and after` if the owner wants them negative.
9. **`list of X approved body shops`** — G&S gap 3 recurs verbatim: `list of tesla approved body shops`, both NEG'd, KEEP by the letter. Consider a `list of` directory-intent trigger.
10. **Street-name shops vs geo KEEP.** `melrose`, `la brea`, `sunset boulevard`, `glenoaks`, `colima`, `reseda saticoy`, `commerce lane` adjudicated NEG under the lock (G&S `boston road collision` precedent); Luna over-KEEPs these. The rules never distinguish street-geo from city-geo — worth one sentence in `POL-GEO-LOCAL-KEEP` either way.
11. **`body panel repair`**: `panel` is absent from the named-part list (only `quarter panel` and panel-beater slang). Both models NEG'd correctly by spirit; add `body panel` / `panel repair` to `POL-PARTS-ONLY-NEGATIVE`.

### Debatable adjudications (my call; a looser reading flips them)

KEEP-side: `malibu auto body` (city vs Chevy model vs shop — geo chosen), `hollister body shops` (city vs clothing brand), standalone out-of-area cities (`princeton`, `washington`, `bedford`, `englewood`, `chandler`, `eugene`, `tempe`, `dublin ca`, `miami`, `nyc`, `las vegas`), `aluminum body repair` / `aluminum certified body shop` (material as service qualifier, not parts shopping), `fast` / `quick` / `express` (speed descriptors; Express Auto Body is a common real shop name), `reliable` / `excellent` / `5 star` (trust/rating descriptors), `full body shop`, `motorcycle crash repairs near me` (letter), `escondido body refinishing` (letter), question forms (`does do`, `does have`, `are weekends`, `are saturday`, `can you fix`), `labor rates` / `most expensive` / `before after` / `no deductible` / `that waive deductible` (letter), `cars value after accident` (letter), `list`, `collision repair network` (letter), `canoga` (Canoga Park shorthand), `north ranch auto body` (real Thousand Oaks neighborhood), `ne` (`auto body near ne`).

NEG-side: street-name shops (`melrose`, `la brea`, `sunset boulevard`, `los angeles sunset`, `glenoaks`, `commerce lane`, `colima`, `reseda saticoy`, `knollwood`, `lakeside`, `yosemite`, `beverly`), abbreviations (`oc`, `av`, `va`, `az`, `us`, `cali`, `310`, `323`), brand+city combos (`ventura collision center encino`, `la collision center north hollywood`, `central valley auto body northridge`, `luxury vehicle collision van nuys`, `marina auto body huntington beach`, `phoenix auto body los angeles`), `commercial auto body shop` (fleet reading), `body shop sale` / `body shop sales` (retail/sale intent), `biggest body shops in usa` (research intent), `vive collision` (competitor chain; not the own-brand fragment `carvive`), `columbia auto body` (lock over city reading), `the fix auto body` (`The Fix` brand phrase; the rest of the `fix` cluster is verb-first generic KEEP), `mid valley auto body`, `westside valley auto body`.

## Methodology and caveats

- No owner-labeled ground truth exists for CarVive (the 124 labeled handoff examples contain zero CarVive rows). Correctness is scored by mechanically applying the *deterministic* parts of rules `2026-09-02.5`: own-brand (`carvive`), always-win token rules (foreign-language, towing, price, informational, reviews, website-nav, paint/color, cosmetic/fender-bender/dent, wrong-outcome, custom-fab, mechanic/service tokens, contiguous `auto repair`/`car repair` without crash-event, other repair without body-shop or crash-event wording, mechanical parts without body/crash context, wrong-vehicle, glass/tint without body/crash context, panel-beater/interior/kit/named-part scope without crash, salvage, careers, DIY, keys), the `.5` registered-suffix competitor rule (`inc`/`llc`/`corp`/`incorporated`/`ltd`), named national chains and possessive business names, and the KEEP-signal definition (crash-event wording, body-shop wording including body-attached repair, insurer+body/collision/claim/approved, make+body/collision).
- Bucket C (competitor-vs-place leftovers) is scored by applying rules `2026-09-02.5` to all 600 leftover clusters under the 'unsure name vs place is negative' owner lock and the G&S precedents listed in the gray-zone section. Those verdicts are one adjudicator's reading; the debatable-calls list marks where a looser reading flips the answer.
- The audit's token regexes are stricter/dumber than an LLM reader; a handful of Bucket A/B assignments may themselves be debatable (`the body shop *`, `a&a auto body shop`, `ca expert auto body and repair center`, `the california auto body shop` — the models' competitor readings there have real merit; they are scored as model errors for consistency with the G&S `quality` / `a&a` precedents). Error tables above list every scored miss for manual review.
- Luna's 50 unscored terms (failed batch 0028) are excluded from its accuracy denominators per bucket; agreement is computed over the 2,769 paired terms only.
- Kimi `kimi-k2.6` has no low/high reasoning gradation (that is k3's `reasoning_effort`); thinking mode is binary. This run used thinking **enabled** = k2.6's maximum reasoning.
- Cost figures: Luna from the pricing snapshot in `scripts/evaluate-openai-models.ts` ($0.20 input / $0.02 cached / $1.20 output per 1M). Kimi marginal cost is $0 on the coding subscription; the k2.6 list-price equivalent uses platform rates ($0.95 / $0.16 cached / $4.00 per 1M) for scale only.

## Bottom line

At 2,819 candidates CarVive is a heavier and dirtier traffic mix than G&S (more PMax spillover: out-of-state cities, shop-name lookups, retail/sale noise). Both models stay above 96.5% whole-run accuracy with 97.0% mutual agreement. Kimi k2.6 edges Luna on correctness (97.5% vs 96.6%, and 53-30 on the 83 disagreements) at $0 marginal cost but ~6× the wall clock and ~3.8× the total tokens; Luna is 6× faster and far cheaper than Kimi's list-price equivalent but had the run's only batch failure (an exact-text cross-term copy error that validation caught). The error profiles are mirror images worth watching: Kimi over-fires the competitor lock on plain local places (`reseda`, `westlake`, `west valley`), while Luna over-extends OEM protection to generic repair shops (`certified tesla repair shop`) and misses dealer/street-name competitors (`van chevrolet`, `melrose`).
