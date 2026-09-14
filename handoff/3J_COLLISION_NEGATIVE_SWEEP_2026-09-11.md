# Search Term Waste Cleanup — 3J Collision Center

**Account:** 3J Collision Center (Google Ads CID 850-080-9656)
**Period analyzed:** August 13 – September 11, 2026 (rolling 30 days)
**Completed:** September 11, 2026
**Scope:** Both active search campaigns — "Built by Shah – Google Ad Campaign" and "Retargeting (Search Campaign Visitors) – Built by Shah"

---

## What we did

Every search query that triggered your ads over the last 30 days was extracted and individually reviewed by an AI classification system against your advertising policy (collision-repair intent only). Queries matching waste patterns — competitor names, DIY/price shoppers, cosmetic-only repairs, parts-only queries, non-English, paint-only, and other non-collision intent — were blocked as **exact-match negative keywords at the campaign level**, so your ads no longer show for them.

## Results at a glance

| Metric | Value |
|---|---|
| Search queries analyzed | **2,177** |
| Queries kept (relevant traffic) | 634 |
| Queries identified as waste | **1,543 (70.9%)** |
| Already blocked before this sweep | 964 |
| **New negative keywords applied** | **573** |
| Verified live in Google Ads | **573 / 573 (100%)** |

## Financial impact

| | Spend (30d) | Clicks | Impressions | Conversions | Avg CPC | Cost / Conv. |
|---|---|---|---|---|---|---|
| Waste queries (now blocked) | **$723.17** | 118 | 2,949 | 10.0 | $6.13 | $72.32 |
| Kept queries (working spend) | $1,245.83 | 138 | 2,748 | 24.7 | $9.03 | **$50.51** |
| **Total analyzed** | **$1,969.00** | | | | | |

- **36.7% of search spend** was going to queries outside your targeting policy.
- Blocking them protects approximately **$723 per month — ≈ $8,678 per year** — for this account.
- Traffic that was kept converts at **$50.51 per lead**; the blocked waste was converting at **$72.32** — even the occasional waste-query conversion cost **43% more** than your quality traffic. Removing it pushes budget toward queries that convert cheaper and match your service profile.

## What kind of waste was blocked

| Waste category | Queries | Example |
|---|---|---|
| Competitor business names | 563 | "darbys auto body", "nice and easy auto body" |
| Mechanical-only repairs | 199 | engine/transmission queries, not collision |
| Paint-only / color change | 157 | "how much does it cost to get a car painted black" |
| Cosmetic-only (scratch/dent) | 123 | "fix car scratch", "dents and scratches repair" |
| Price shoppers / free-seekers | 117 | "cheap auto body shop near me", "bodyshop quote" |
| Parts-only replacement | 104 | "side mirror replacement" |
| Foreign-language | — | "carrocería y pintura cerca de mi" |
| Other no-service-signal | 64 | navigational/informational queries |

## Safety & verification

- The sweep ran in **dry-run (validate-only) mode first**: Google Ads checked every proposed negative for validity **without writing anything**.
- Only after review were the negatives applied — in small, tracked batches.
- A post-write verification re-queried Google Ads and confirmed **all 573 new negatives are live**.
- 6 queries could not be blocked as exact negatives because they exceed Google Ads' 10-word keyword limit (all long "how much does it cost to…" questions); these are documented for alternative handling.
- No ads, keywords, bids, budgets, or campaign settings were modified — negative keywords were the only change. Existing negatives (964) were detected and left untouched.

---

*Methodology: search-term report aggregated over the trailing 30 days; per-query AI classification (Moonshot Kimi k2.6 with reasoning enabled) against the account's collision-repair advertising policy; exact-match campaign-level negative keywords; full audit trail retained (per-query decisions, reasons, confidence scores, and Google Ads request IDs available on request).*
