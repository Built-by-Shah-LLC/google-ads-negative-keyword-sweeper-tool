# Sandbox comparison: Kimi `kimi-for-coding` vs OpenAI `gpt-5.6-luna` — 260 ad-hoc terms

Date: `2026-09-01` · Rule set: **`2026-09-02.4`** (tightened: `POL-WEBSITE-NAV-NEGATIVE` added, panel-beater slang moved to `POL-PARTS-ONLY-NEGATIVE`) · Prompt: `collision-classifier-v6` · No soul identity (removed in `4ecbe28`)

Same 260 unique terms (295 raw rows deduped with production normalization), same account context (P&C AUTOMOTIVE), batch 50, low reasoning on both. No Google Ads calls.

| | Kimi `kimi-for-coding` | OpenAI `gpt-5.6-luna` |
|---|---:|---:|
| Run dir | `runs/sandbox-kimi-20260901T200648762Z/` | `runs/sandbox-openai-20260901T200659582Z/` |
| KEEP | 62 | 56 |
| NEGATIVE_EXACT | 198 | 204 |
| Input tokens | 54,119 (62% cached) | 54,108 (0% cached) |
| Output tokens | 62,651 (45,260 reasoning) | 15,865 (1,520 reasoning) |
| Total tokens | 116,770 | 69,973 |
| Requests / retries | 6 / 0 | 6 / 0 |
| Wall clock | ~12 min | ~2 min |
| Marginal cost | $0 (subscription; ~6% of observed 5h window) | **$0.0299** |

**Decision agreement: 238/260 = 91.5%** (22 disagreements).

## Tightened-rule verification (both models obeyed)

| Term | Kimi | Luna |
|---|---|---|
| panel beaters near me | NEGATIVE (`POL-PARTS-ONLY-NEGATIVE`) | NEGATIVE (`POL-PARTS-ONLY-NEGATIVE`) |
| usaa com bodyshop | NEGATIVE (`POL-WEBSITE-NAV-NEGATIVE`) | NEGATIVE (`POL-WEBSITE-NAV-NEGATIVE`) |

## All 22 disagreements

| Term | Kimi | Luna | Kimi rules | Luna rules |
|---|---|---|---|---|
| no deductible body shop | KEEP | **NEG** | POL-BODYWORK-KEEP | POL-PRICE-SHOPPER-NEGATIVE;POL-FULL-QUERY-EXACT |
| auto body shops that waive deductibles | KEEP | **NEG** | POL-BODYWORK-KEEP | POL-PRICE-SHOPPER-NEGATIVE;POL-FULL-QUERY-EXACT |
| avondale collision grapevine | **NEG** | KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | POL-GEO-LOCAL-KEEP |
| az collision center | KEEP | **NEG** | POL-GEO-LOCAL-KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT |
| c auto body | KEEP | **NEG** | POL-BODYWORK-KEEP | POL-COMPETITOR-NEGATIVE |
| california collision center fort worth | KEEP | **NEG** | POL-GEO-LOCAL-KEEP | POL-COMPETITOR-NEGATIVE |
| economy body shop | KEEP | **NEG** | POL-BODYWORK-KEEP | POL-COMPETITOR-NEGATIVE |
| golden triangle collision | **NEG** | KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | POL-GEO-LOCAL-KEEP |
| langley auto body | KEEP | **NEG** | POL-GEO-LOCAL-KEEP;POL-BODYWORK-KEEP | POL-COMPETITOR-NEGATIVE |
| latino body shop | KEEP | **NEG** | POL-BODYWORK-KEEP | POL-COMPETITOR-NEGATIVE |
| north texas collision center grand prairie | KEEP | **NEG** | POL-GEO-LOCAL-KEEP;POL-COLLISION-KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT |
| polo body shop | KEEP | **NEG** | POL-OEM-BODY-KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT |
| sterling collision repair | KEEP | **NEG** | POL-COLLISION-KEEP;POL-GEO-LOCAL-KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT |
| texas collision center plano parkway | **NEG** | KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | POL-GEO-LOCAL-KEEP |
| texas collision center preston rd | **NEG** | KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | POL-GEO-LOCAL-KEEP |
| texas collision center reeder road | **NEG** | KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | POL-GEO-LOCAL-KEEP |
| texas collision plano parkway | **NEG** | KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | POL-GEO-LOCAL-KEEP |
| texas collison | KEEP | **NEG** | POL-COLLISION-KEEP | POL-NO-SERVICE-SIGNAL-NEGATIVE |
| westway collision center | KEEP | **NEG** | POL-GEO-LOCAL-KEEP | POL-COMPETITOR-NEGATIVE |
| zaragoza body shop | KEEP | **NEG** | POL-GEO-LOCAL-KEEP | POL-COMPETITOR-NEGATIVE |
| allen auto repair & collision | **NEG** | KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | POL-COLLISION-KEEP |
| ames collision center | **NEG** | KEEP | POL-COMPETITOR-NEGATIVE;POL-FULL-QUERY-EXACT | POL-GEO-LOCAL-KEEP |

## Observations

1. **The disagreement mass is one gray zone: competitor-name vs place-name.** 17 of 22 disagreements are `POL-COMPETITOR-NEGATIVE` vs `POL-GEO-LOCAL-KEEP`/bodywork KEEP on borderline brand names (`az collision center`, `polo body shop`, `zaragoza body shop`, `westway collision center`...). Luna applies the aggressive unsure-is-competitor owner lock more literally; Kimi more often gives the benefit of the doubt to geo/local intent.
2. **Kimi missed a price-shopper rule it followed yesterday.** `no deductible body shop` and `auto body shops that waive deductibles`: Kimi KEEPed via `POL-BODYWORK-KEEP` (ignoring always-win `POL-PRICE-SHOPPER-NEGATIVE`), Luna negatived correctly. In the earlier same-day Kimi run (rules 2026-09-02.2/3) Kimi DID negative these — non-deterministic rule adherence.
3. **`texas collison` (misspelled):** Kimi kept it as crash-event demand; Luna negative via `POL-NO-SERVICE-SIGNAL-NEGATIVE`. Decide which behavior you want and lock it in the rules.
4. **Output-token economy:** Luna generated 75% fewer output tokens (reasoning 1.5K vs 45.3K) at equal decision quality on this set — 8.3× faster and $0.03 for 260 terms.
5. Note the direction flip vs the 30-day P&C run: there Kimi was the more negative model (57% vs 50.5%); on this competitor-heavy list Luna is (78.5% vs 76.2%). Neither is uniformly "stricter" — they draw the competitor/place line differently per query mix.
