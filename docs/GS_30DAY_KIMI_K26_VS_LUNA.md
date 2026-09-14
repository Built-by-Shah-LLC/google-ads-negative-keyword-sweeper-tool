# G&S / Bella's Collision — 30-day head-to-head: Kimi `kimi-k2.6` (thinking enabled) vs OpenAI `gpt-5.6-luna` (low reasoning)

Date: 2026-09-01/02 · Rule set: `2026-09-02.4` · Prompt: `collision-classifier-v6` · Candidates: **1216** (same set for both, fetched once 2026-08-03..2026-09-01, 1,741 raw rows)

## Runs

| | Kimi `kimi-k2.6` | OpenAI `gpt-5.6-luna` |
|---|---:|---:|
| Run dir | `runs/measure-gs-30day-kimi-20260901T205607275Z` | `runs/measure-gs-30day-openai-20260901T204935421Z` |
| Endpoint | api.kimi.com/coding/v1 (subscription) | OpenAI Responses API (pay-per-token) |
| Reasoning | thinking: enabled (k2.6 max; k2.6 has no low/high gradation) | effort: low |
| Batch size | 25 | 50 |
| Status | SUCCEEDED (0 failed batches) | SUCCEEDED (0 failed batches) |
| KEEP | 416 (34.2%) | 408 (33.6%) |
| NEGATIVE_EXACT | 800 (65.8%) | 808 (66.4%) |
| Input tokens | 450,911 (73.1% cached) | 286,643 (3.9% cached) |
| Output tokens | 415,289 (reasoning 316,668) | 92,821 (reasoning 7,898) |
| Total tokens | 866,200 | 379,464 |
| Wall clock | ~26 min | ~4 min |
| Marginal cost | $0 (subscription quota) | $0.1667 |
| K2.6 list-price equivalent | $1.83 (platform $0.95/$0.16/$4.00 per 1M — key not platform-authorized, shown for scale) | — |

## Headline agreement: 1184/1216 = 97.4%

| | count | % of 1216 |
|---|---:|---:|
| Both NEGATIVE | 788 | 64.8% |
| Both KEEP | 396 | 32.6% |
| Kimi NEG, Luna KEEP | 12 | 1.0% |
| Kimi KEEP, Luna NEG | 20 | 1.6% |

## Rules-based correctness audit (no G&S owner labels exist — methodology below)

Bucket A (deterministic NEGATIVE per always-win token rules): **534 terms**. Bucket B (deterministic KEEP: approved KEEP signal, zero triggers, generic leftover): **235 terms**. Bucket C (gray: competitor-vs-place judgment): **447 terms**.

| | Kimi correct | Kimi wrong | Luna correct | Luna wrong |
|---|---:|---:|---:|---:|
| Bucket A negatives (534) | 533 (99.8%) | 1 (0.2%) | 532 (99.6%) | 2 (0.4%) |
| Bucket B KEEPs (235) | 229 (97.4%) | 6 (2.6%) | 227 (96.6%) | 8 (3.4%) |
| **Total scored (A+B=769)** | **762 (99.1%)** | **7 (0.9%)** | **759 (98.7%)** | **10 (1.3%)** |

### Wrong KEEPs — deterministic negatives the model failed to negative (Bucket A errors)

| Term | Model | Expected rule(s) | Model cited | Reason |
|---|---|---|---|---|
| autobidy shop near me | Kimi | no KEEP signal (POL-NO-SERVICE-SIGNAL-NEGATIVE) | POL-BODYWORK-KEEP | Misspelled 'autobidy' is clearly body-shop demand with no negative tokens. |
| autobidy shop near me | Luna | no KEEP signal (POL-NO-SERVICE-SIGNAL-NEGATIVE) | POL-BODYWORK-KEEP | Typographical variant of generic body-shop demand. |
| geico auto body repair shops | Luna | POL-MECHANICAL-ONLY-NEGATIVE(repair-no-crash) | POL-INSURER-KEEP | Recognized insurer plus auto body context indicates collision-related body-shop demand. |

### Wrong NEGATIVEs — clean KEEP-signal terms the model negatived (Bucket B errors)

| Term | Model | Why KEEP-able | Model cited | Reason |
|---|---|---|---|---|
| a a auto body | Kimi | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | Distinctive leftover 'a a' reads as a business name (AA Auto Body), not generic demand. |
| quality autobody | Kimi | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | Unsure whether leftover is descriptor or competitor name; negative per aggressive policy. |
| a&a auto body near me | Kimi | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | Distinctive leftover 'a&a' after stripping body-shop wording indicates competitor name. |
| quality auto body | Kimi | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | Leftover 'quality' is brand-like and likely a competitor name, not generic demand. |
| car body | Kimi | approved KEEP signal, generic leftover | POL-NO-SERVICE-SIGNAL-NEGATIVE;POL-BARE-VEHICLE-NEGATIVE;POL-FULL-QUERY-EXACT | Bare 'car body' has no approved service signal such as shop, work, collision, or location. |
| quality body works | Kimi | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | Leftover Quality is ambiguous between descriptor and competitor name, so negative per leftover-token test. |
| auto body collision repairs | Luna | approved KEEP signal, generic leftover | POL-MECHANICAL-ONLY-NEGATIVE;POL-FULL-QUERY-EXACT | Repair wording lacks the required crash-event token. |
| a a auto body | Luna | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | A A Auto Body is a named competing business. |
| quality autobody | Luna | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE | Brand-like leftover suggests a competing autobody business. |
| a&a auto body near me | Luna | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE | A&A is a distinctive named competing body business. |
| quality auto body | Luna | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | The brand-like leftover makes this potentially a competing body shop. |
| car body | Luna | approved KEEP signal, generic leftover | POL-NO-SERVICE-SIGNAL-NEGATIVE;POL-FULL-QUERY-EXACT | Bare vehicle/body wording provides insufficient service intent. |
| flower hill auto body | Luna | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | Distinctive business name indicates competitor intent. |
| quality body works | Luna | approved KEEP signal, generic leftover | POL-COMPETITOR-NEGATIVE | Distinctive business-like name indicates competitor intent. |

### Gray zone (Bucket C, 447 terms) — no deterministic answer

Both negative: 250 · Both KEEP: 168 · Kimi neg / Luna keep: 11 · Kimi keep / Luna neg: 18

| Term | Kimi | Luna | Gray leftover |
|---|---|---|---|
| frontier collision hempstead | KEEP | NEGATIVE_EXACT | frontier hempstead |
| fleetwood collision tuckahoe | KEEP | NEGATIVE_EXACT | fleetwood tuckahoe |
| dart auto body bronx | KEEP | NEGATIVE_EXACT | dart bronx |
| nexon auto collision | KEEP | NEGATIVE_EXACT | nexon |
| wreck a mended | KEEP | NEGATIVE_EXACT | mended |
| new rochelle auto body inc | KEEP | NEGATIVE_EXACT | rochelle inc |
| list of geico approved body shops | KEEP | NEGATIVE_EXACT | list geico approved |
| mclean auto body | KEEP | NEGATIVE_EXACT | mclean |
| dc auto body yonkers | NEGATIVE_EXACT | KEEP | dc yonkers |
| ar body shop | NEGATIVE_EXACT | KEEP | ar |
| bx collision | NEGATIVE_EXACT | KEEP | bx |
| hunts point collision | KEEP | NEGATIVE_EXACT | hunts |
| scarsdale auto body inc montgomery avenue scarsdale ny | KEEP | NEGATIVE_EXACT | scarsdale inc montgomery avenue scarsdale ny |
| dutchess auto body pawling ny | NEGATIVE_EXACT | KEEP | dutchess pawling ny |
| body man near me | KEEP | NEGATIVE_EXACT | man |
| promaster body shop | NEGATIVE_EXACT | KEEP | promaster |
| beechwood auto body | KEEP | NEGATIVE_EXACT | beechwood |
| european auto body shop near me | NEGATIVE_EXACT | KEEP | european |
| foreign auto body shop | NEGATIVE_EXACT | KEEP | foreign |
| richmond auto body amityville | NEGATIVE_EXACT | KEEP | richmond amityville |
| top rated auto body near me | KEEP | NEGATIVE_EXACT | rated |
| yorktown auto body inc | KEEP | NEGATIVE_EXACT | yorktown inc |
| frontier collision hempstead | KEEP | NEGATIVE_EXACT | frontier hempstead |
| auto space collision repair | KEEP | NEGATIVE_EXACT | space |
| central valley auto collision | NEGATIVE_EXACT | KEEP | central valley |
| mayfield auto body yonkers | NEGATIVE_EXACT | KEEP | mayfield yonkers |
| east coast auto body shop | KEEP | NEGATIVE_EXACT | east coast |
| dart auto body bronx | KEEP | NEGATIVE_EXACT | dart bronx |
| boston road collision | NEGATIVE_EXACT | KEEP | boston road |

## Gray-zone adjudication (Bucket C, 447 terms) — orchestrator verdicts vs both models

All 447 gray terms were adjudicated by manually applying rules `2026-09-02.4` at the
leftover-cluster level (286 unique clusters). Dominant principles, in pipeline order:
rule 3 (a city/neighborhood/region, vehicle make/model, or insurer name is **not**
competitor evidence by itself), rule 4 owner lock (a leftover that *might* be a place,
descriptor, or business → **NEGATIVE**), insurer/OEM protections
(`POL-INSURER-KEEP`, `POL-OEM-BODY-KEEP`), `POL-OWN-BRAND-NEGATIVE` (bella's / g&s),
and `POL-FOREIGN-LANGUAGE-NEGATIVE` (`cerca de mi` → NEG).

Adjudicated split: **KEEP 169 (37.8%) · NEGATIVE 278 (62.2%)**.

| Model | Bucket C correct | Bucket C accuracy | Whole run (A+B+C) correct | Whole-run accuracy |
|---|---|---|---|---|
| Kimi `kimi-k2.6` (thinking) | 424/447 | 94.9% | 762 + 424 = **1186/1216** | **97.5%** |
| `gpt-5.6-luna` (low) | 427/447 | 95.5% | 759 + 427 = **1186/1216** | **97.5%** |

Both right: 411 (92.0%) · Both wrong: 7. **The gray-zone adjudication erases Luna's
A+B edge — the models finish the 30-day run in a dead tie at 97.5%.**

Both-wrong terms (both models KEEP, adjudicated NEG): `new england collision`,
`aaa best auto body` (rules protect `aaa insurance`/`aaa collision` only — `aaa best
auto body` is the AAA-prefix business-name pattern), `roosevelt auto body`,
`adelphi auto body`, `mclean auto body shop`, `european autobody shop`; plus one
`body man near me` row (both NEG, adjudicated KEEP — body-work technician demand).

### Failure-mode signatures

- **Kimi over-KEEPs (20 of 23 errors):** force-fits brand-like leftovers into
  place/model/insurer readings — calls `roosevelt`, `adelphi`, `mclean` "unambiguous
  locations" (they are surnames/ambiguous), `dart`/`frontier`/`nexon` "vehicle models"
  (might-be-business → lock says NEG), and argues `inc` "is a corporate suffix, not a
  competitor name" on `new rochelle auto body inc` / `yorktown auto body inc` /
  `scarsdale auto body inc …` — the opposite of the owner preference for registered
  business names. Also parsed the pun shop `wreck a mended` as crash-event `wreck`.
- **Kimi over-NEGs (3):** `promaster body shop` (spirit-right, not rules-backed — see
  gap 2), `central valley auto collision` (Central Valley NY is a real hamlet),
  one `body man near me` row.
- **Luna over-KEEPs (15 of 20 errors):** treats initials/abbreviations as locations
  (`dc auto body yonkers`, `ar body shop`, `bx collision`) and surnames as places
  (`roosevelt`, `adelphi`, `mclean`, `mayfield`, `richmond`), plus descriptor
  leftovers (`european` ×2, `foreign`).
- **Luna over-NEGs (5):** `hunts point collision` (Hunts Point is an unambiguous Bronx
  neighborhood), `list of geico approved body shops` (KEEP by the letter — see gap 3),
  `top rated auto body near me` (see gap 4), `body man near me` ×2.
- **Kimi non-determinism confirmed:** `body man near me` got KEEP in one batch and
  NEGATIVE_EXACT in another — same term, same run. Matches the sandbox finding.

### Rules gaps surfaced by the adjudication

1. **`inc` / `corp` / `llc` not named as competitor evidence.** `POL-COMPETITOR-NEGATIVE`
   lists possessives, multi-word brand phrases, and chains, but never the registered-
   business suffix. Recommend adding: a trailing `inc|corp|llc|co|company` token on a
   place-named leftover is competitor evidence (e.g. `pelham collision llc`).
2. **ProMaster missing from `POL-WRONG-VEHICLE-NEGATIVE`.** The always-win list names
   Sprinter/camper/conversion vans only, and always-win rules fire from listed tokens
   only — so `promaster body shop` is KEEP by the letter. Kimi NEG'd it on spirit
   (commercial cargo van). Owner decision needed: add `promaster` to the van list.
3. **`list of X` directory intent uncovered.** `list of geico approved body shops` is
   KEEP by the letter (insurer + approved); Luna's research-intent NEG is sensible but
   not rules-backed. Consider a `list of` / directory trigger.
4. **`top rated` not covered by `POL-REVIEWS-NEGATIVE`** (tokens are
   review/reviews/rating/ratings; `rated` ≠ `rating`). KEEP by the letter; Luna
   over-fired. Add `rated`/`top rated` if the owner wants it negative.
5. **`body man` not in body-shop wording.** Adjudicated KEEP (technician demand +
   `near me`); both models NEG'd at least once. Could be added to body-shop wording or
   deliberately left gray.

### Debatable adjudications (my NEG; a looser reading could KEEP)

`dart auto body bronx` (Dodge Dart → `POL-OEM-BODY-KEEP` reading), `frontier collision
hempstead` (Nissan Frontier), `fleetwood collision tuckahoe` (Mt. Vernon neighborhood
OR Cadillac model OR shop), `bx collision` (Bronx shorthand), `new england collision`
/ `east coast auto body shop` (region vs brand), `roosevelt auto body` (real Nassau
hamlet), `boston road collision` (Bronx street). All are NEG under the owner lock; if
the owner relaxes the lock for make/model + place combos, several flip to KEEP.

## Methodology and caveats

- No owner-labeled ground truth exists for G&S (the 124 labeled handoff examples contain zero G&S/Bella's rows). Correctness is scored by mechanically applying the *deterministic* parts of rules `2026-09-02.4`: always-win token rules (reviews, price, towing, website-nav, paint, cosmetic, wrong-vehicle, panel-beater, glass, careers, keys, salvage, DIY, informational, wrong-outcome, mechanic/service/repair-without-crash-event, named-part-without-crash-event) and the KEEP-signal definition (crash-event wording, body-shop wording, insurer+context, make+body/collision).
- Bucket C (competitor-vs-place leftovers) is scored in the adjudication section above by manually applying rules `2026-09-02.4` under the 'unsure name vs place is negative' owner lock. Those verdicts are one adjudicator's reading; the debatable-calls list marks where a looser reading flips the answer.
- The audit's token regexes are stricter/dumber than an LLM reader; a handful of Bucket A/B assignments may themselves be debatable (e.g. Spanish place names, 'tech' as standalone token). Error tables above list every scored miss for manual review.
- Kimi `kimi-k2.6` has no low/high reasoning gradation (that is k3's `reasoning_effort`); thinking mode is binary. This run used thinking **enabled** = k2.6's maximum reasoning.
