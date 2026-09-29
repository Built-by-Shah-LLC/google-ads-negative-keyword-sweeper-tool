# Positive keyword contradiction findings

Generated from live Google Ads data on 2026-09-24. This report covers all 15 configured companies after applying the campaign eligibility filters from the `main` branch.

## Result

There are **4 distinct active positive keyword texts** (4 keyword criteria) that the static and company-specific dynamic rules would classify as negative if active-positive-keyword protection were removed.

| Company | Active positive keyword | Google match type | Ad group | Rule contradicted | Why the rules would otherwise make it negative |
|---|---|---:|---|---|---|
| CAPITAL COLLISION | `auto body shop that takes payments` | EXACT | Mix Conv St EX 1 | `POL-PRICE-SHOPPER-NEGATIVE` | “takes payments” is payment/financing intent. The price-shopper rule is always-win and says body-shop wording does not save it. |
| CAPITAL COLLISION | `IE body shop` | PHRASE | Generic Body Shop Search | `POL-COMPETITOR-NEGATIVE` | `IE` is ambiguous: it may mean the Inland Empire region or a business name. The leftover-token rule requires NEGATIVE when a token might be a place, descriptor, or competitor and is not unambiguously geographic. |
| CAPITAL COLLISION | `quality collision center chino` | EXACT | Mix Conv St EX 1 | `POL-COMPETITOR-NEGATIVE` | After stripping the geo term `chino` and service terms `collision center`, `quality` remains. It is not in the rule's removable quality-shopping list, so the unclear leftover is treated as competitor evidence. |
| LG Auto Body (Rockville) | `cheap body shop near me` | PHRASE | Generic Body Shop Search | `POL-PRICE-SHOPPER-NEGATIVE` | `cheap` is an explicit price-shopping signal. The rule is always-win and body-shop/local wording does not save the query. |

All four are in campaigns named `Built by Shah - Google Ad Campaign` and have effective status `ACTIVE` (campaign, ad group, and keyword criterion are enabled). Therefore, a search term with the same normalized full text is forced to KEEP by the active-positive-keyword protection.

Google Ads match type does **not** widen this LLM protection. A PHRASE or BROAD positive keyword is still protected only when the search term exactly matches the keyword text after case and whitespace normalization. The description field is explanatory metadata and is not used for substring matching.

## Campaign filters applied

The positive-keyword fetch now mirrors the campaign eligibility policy on `main` before it fetches keyword criteria:

1. Campaign name contains the configured value, currently `Built by Shah`, case-insensitively.
2. Campaign status is `ENABLED`.
3. Campaign primary status is `ELIGIBLE` or `LIMITED`.
4. A `LIMITED` campaign must have at least one primary-status reason, and every reason must be one of:
   - `BUDGET_CONSTRAINED`
   - `BIDDING_STRATEGY_LIMITED`
   - `BIDDING_STRATEGY_CONSTRAINED`
   - `SEARCH_VOLUME_LIMITED`
5. Missing, empty, mixed, or unknown LIMITED reasons fail closed.
6. Removed ad groups and removed/negative keyword criteria are excluded.

Paused ad groups or keyword criteria are retained in the prompt as `PAUSED` evidence, but they do not force KEEP. Only an `ACTIVE` positive keyword creates the contradiction counted in this report.

## Inventory by company

“Unique active” is deduplicated by normalized keyword text within each company. “Contradictions” counts distinct active texts; there are no duplicate contradictory criteria in this snapshot.

| Customer ID | Company | Qualifying campaign | Total criteria | Active | Paused | Unique active | Contradictions |
|---:|---|---|---:|---:|---:|---:|---:|
| 1130534333 | CAPITAL COLLISION | Built by Shah - Google Ad Campaign | 320 | 121 | 199 | 106 | 3 |
| 1618289856 | Sonoma Auto Center | Built by Shah - Google Ad Campaign | 348 | 136 | 212 | 111 | 0 |
| 2305040084 | Anderson Auto Body | Built by Shah - Google Ad Campaign (R) 2/3/26 | 386 | 36 | 350 | 32 | 0 |
| 3419276158 | Tello's Collision Center | Built by Shah - Google Ad Campaign | 310 | 131 | 179 | 116 | 0 |
| 3666014313 | DG Enterprise LLC DBA Art City Auto Body | Built by Shah - Google Ad Campaign | 359 | 140 | 219 | 120 | 0 |
| 4007102747 | TRI STATE AUTO BODY | None passed all filters | 0 | 0 | 0 | 0 | 0 |
| 6304919700 | Art City Auto Body - Orem | None passed all filters | 0 | 0 | 0 | 0 | 0 |
| 6592667815 | Frankie Ms Auto Body | None passed all filters | 0 | 0 | 0 | 0 | 0 |
| 7289311819 | Pit Stop Auto Collision | Built by Shah - Google Ad Campaign | 384 | 161 | 223 | 146 | 0 |
| 7990574090 | Electrified Collision | Built by Shah - Google Ad Campaign | 293 | 113 | 180 | 107 | 0 |
| 8402372674 | Akins Collision Center | Built by Shah - Google Ad Campaign | 193 | 12 | 181 | 12 | 0 |
| 8500809656 | 3J Collision Center | None passed all filters | 0 | 0 | 0 | 0 | 0 |
| 8791302016 | LG Auto Body (Rockville) | Built by Shah - Google Ad Campaign | 398 | 161 | 237 | 146 | 1 |
| 8820051592 | CARSTAR - Santa Maria | Built by Shah - Google Ad Campaign | 231 | 44 | 187 | 41 | 0 |
| 9459997727 | Arrow Body Services | Built by Shah - Google Ad Campaign | 340 | 144 | 196 | 122 | 0 |
| **Total** | **15 companies** | **11 qualifying campaigns/accounts** | **3,562** | **1,199** | **2,363** | **1,059** | **4** |

The unique-active total is the sum of per-company unique counts; the same text used by two different companies remains two account-specific protections.

## Review method

Every active positive keyword was screened against the explicit static and company-specific rules with positive-keyword protection removed. Five plausible conflict candidates received a second rules-only review with `kimi-k2.6`:

- The four keywords listed above were classified `NEGATIVE_EXACT` under the cited rules.
- `body shop beach cities` was classified KEEP under `POL-GEO-LOCAL-KEEP` and `POL-BODYWORK-KEEP`, so it is not a contradiction.

The contradiction count intentionally excludes paused positive keywords because the prompt treats them only as weaker service evidence and still allows independent negative evidence to win.

## Important effect on 3J and other zero-inventory accounts

3J Collision Center, TRI STATE AUTO BODY, Art City Auto Body - Orem, and Frankie Ms Auto Body currently have no campaign that passes the complete name/status/primary-status/reason filter. Their generated prompt files therefore contain no Google Ads positive keywords. Any previously observed 3J positive keyword, including location terms such as Riverside, is no longer in the filtered positive inventory and cannot override the rules through active-positive-keyword protection.
