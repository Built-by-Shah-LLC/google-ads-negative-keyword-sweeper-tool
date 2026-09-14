# Sweeper run performance — measured profile and tuning levers

Measured on production run `20260910T112733703Z-8bf0ee7d` (Cloud Run Job
`negative-keyword-sweeper`, us-west1, 2026-09-10) — the first full sweep of all
66 registered client accounts with Moonshot/Kimi as the configured provider.

## Measured batch profile

Source: `negative_keyword_llm_batches` in Cloud SQL (77 succeeded batches at the
time of measurement).

| Metric | Value |
| --- | --- |
| Candidates per batch | 25 max (`LLM_BATCH_SIZE=25`), 21.5 average |
| Batch wall-clock duration | min 0.4 min / avg 4.2 min / max 11.1 min |
| Avg input tokens per batch | 15,635 |
| Avg output tokens per batch | 11,353 |
| — of which reasoning/thought tokens | 9,426 (83% of output) |
| Effective throughput | ~19 batches/hour |

At ~5,000 candidates per full sweep, one run needs ~200 batches, i.e. roughly
10 hours end-to-end with the default concurrency.

## Confirmed root cause of the Sep 10 slowdown (3.5h -> ~10h)

The candidate aggregation key in `src/google-ads/search-terms.ts`
(`aggregateCandidates`) was widened from account scope to
campaign/ad-group/channel scope (introduced in `d099d03`, merged via `8b25027`
on 2026-09-09, after the old us-central1 image was built):

- Old key: `customerId + normalizedTerm` — one candidate per unique search term
  per account; cross-campaign duplicates were deduplicated away.
- New key: `customerId + channel + campaignId + adGroupId + normalizedTerm` —
  one candidate per search term per campaign per ad group per channel. This is
  deliberate: campaign-scoped exact negatives need campaign-scoped candidates.

Measured on the same account (10X AUTO GROUP, 8847499121): 60 raw rows -> 3
candidates / 1 batch / 6.4K output tokens (Sep 4, old key) versus 91 raw rows
-> 91 candidates / 4 batches / ~45K output tokens (Sep 10, new key). The LLM
model, thinking mode, batch size, concurrency, GAQL, and prompt size were
unchanged between the deployments; per-batch latency (~4.2 min average) is
output-token-bound (~11.4K tokens generated at ~45 tok/s) in both eras. The
runtime increase is therefore driven by candidate volume multiplication, not
by slower batches, validation retries (4 of 87 batches needed a retry), or API
outages.

## Sep 10 alignment fix (commit `7bbbc11`, now on main and deployed)

The documented aggregation scope in `docs/MULTI_ORGANIZATION_LLM_SWEEPER_PLAN.md`
is `account + date + channel + campaign + normalized search term`. The
implementation had added `adGroupId` beyond that documented decision. Because
the planned negatives are campaign-level exact negatives, ad-group granularity
was pure overhead. The fix removed it, realigning code with the documented key.

Measured live on the first aligned run: AMG Autobody 117 raw rows -> 93
candidates (-20%), Anderson Auto Body 55 -> 46 (-16%). Accounts whose
duplication is cross-campaign (e.g. 10X AUTO GROUP) are intentionally
unchanged. Campaign-level scoping remains as documented.

## Cost impact

Token spend scales with candidate volume, so the Sep 9 scoping change
multiplied per-run tokens roughly in line with candidate growth (several x).
Per-batch token costs are unchanged (~15.6K input / ~11.4K output). Every
candidate is sent to the model even when the same normalized term was already
classified in another campaign of the same account; see the
classify-once-expand-many lever below.

## Why it is slow

1. **Thinking mode is enabled** (`MOONSHOT_THINKING=enabled`). kimi-k2.6 emits
   ~9.4K hidden reasoning tokens per batch before the structured answer. This is
   the single largest latency component.
2. **A large fixed prompt is re-sent with every batch**: the complete
   classification rules, output schema, and phrase protections tokenize to
   ~13K input tokens per request (recorded per-organization in
   `fixed-input-tokens.json` / `negative_keyword_llm_batches.fixed_input_tokens`).
3. **Default LLM concurrency is 3** (`LLM_CONCURRENCY` unset in `.env`;
   default in `src/config/env.ts`). Google Ads fetch concurrency defaults to 5.

## Tuning levers (change deliberately, one at a time)

| Lever | Effect | Risk |
| --- | --- | --- |
| `LLM_CONCURRENCY=8–10` | Near-proportional wall-clock reduction | Moonshot rate limits; token spend rate unchanged, just faster |
| `MOONSHOT_THINKING=disabled` | Cuts the dominant latency component (thought tokens) | Classification quality/compliance may drop; evaluate against labeled fixtures first (`npm run eval:openai` / phrase-protection eval) |
| `LLM_BATCH_SIZE=50` | Halves batch count and repeated fixed prompt tokens | Weaker per-item attention on large batches |
| Classify once, expand to scopes (code change) | Dedupe LLM input per account+term while recording the campaign scopes each term appeared in; expand decisions back to scopes for placement | Largest cost/latency recovery (~old-era volume) while keeping campaign placement; must preserve per-campaign context semantics and pass rule-release review |

Any of these require redeploying the job (the deploy script uploads allowlisted
`.env` values as job env vars); running executions keep their startup
configuration.

## Operational notes from the 2026-09-10 rollout

- Cloud Run does not prevent overlapping executions. A manual
  `gcloud run jobs execute` at 04:27 Pacific overlapped the 06:00 Pacific
  scheduled trigger; the scheduled duplicate was cancelled. Avoid manual
  full-scope runs within a few hours of the scheduled fire time.
- Persistence is incremental (per organization, per batch), so a cancelled or
  failed execution leaves partial rows in the sweep tables — visible evidence,
  not corruption.
- The client-account gate (`client_accounts`, `onboarding_status <> 'archived'`)
  runs before any LLM spend; unregistered MCC accounts fail fast and are
  recorded in `negative_keyword_run_errors` without consuming tokens.
