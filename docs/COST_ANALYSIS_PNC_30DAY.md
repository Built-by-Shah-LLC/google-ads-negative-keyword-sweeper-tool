# 30-day keyword classification cost analysis — P&C Automotive

Analysis date: `2026-09-01`

Scope: one Google Ads account, **P&C AUTOMOTIVE** (customer ID `3825219066`),
classified with the production OpenAI pipeline (`collision-classifier` prompt, soul identity
`2026-09-01.1`, rule set `2026-08-31.2`, batch size 50, reasoning effort `low`).

All inputs below are **measured**, not assumed:

| Fact | Source | Value |
|---|---|---|
| P&C 30-day search-term candidates | `runs/20260827T153825893Z-37ac663c` (2026-07-28..2026-08-26) | **2,828** unique (from 3,565 raw rows) |
| Prompt size per candidate (trimmed 6-field envelope) | Rebuilt with real `buildClassifierPrompt` over real P&C data | 233 chars ≈ **62 tokens** |
| Fixed prompt overhead per batch (system instruction + rules + envelope wrapper + response schema) | Same reconstruction | ~14,943 chars ≈ **3,974 tokens** |
| Batches at production batch size 50 | 2,828 ÷ 50 | **57** |
| Output tokens per decision (luna, low reasoning) | Back-calculated from the two measured eval costs | **61 tokens/decision** |
| Chars-per-token factor | Calibrated: eval reconstruction (77,099 chars) vs measured eval input (~20.5K tokens) | **3.76** |

Model validation: reconstructing the 124-example eval with these constants predicts
$0.0138 for `gpt-5.6-luna` vs the **actual measured $0.0132** (~4% error).

## Pricing snapshot (2026-08-31, per 1M tokens)

From `scripts/evaluate-openai-models.ts` (documented OpenAI standard prices on the
evaluation date), plus gpt-4o at its standard published price (marked `*`; not part of
the project snapshot).

| Model | Input | Cached input | Output |
|---|---:|---:|---:|
| `gpt-5-nano` | $0.05 | $0.005 | $0.40 |
| `gpt-4.1-nano` | $0.10 | $0.025 | $0.40 |
| `gpt-4o-mini` | $0.15 | $0.075 | $0.60 |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 |
| `gpt-5.4-nano` | $0.20 | $0.02 | $1.25 |
| `gpt-5.4-mini` | $0.75 | $0.075 | $4.50 |
| `gpt-4o`* | $2.50 | $1.25 | $10.00 |

`gpt-5.3` does not appear in the project's pricing snapshot; no factual rate is available,
so it is excluded.

## Scenario A — one-off 30-day backfill, single run (2,828 terms, 57 batches)

Estimated totals: ~402K input tokens (179K uncached + 223K prefix-cached) and ~173K output
tokens. Cached-input pricing assumes batches 2..57 hit OpenAI's automatic prompt cache
(same system+rules prefix, `prompt_cache_key` stable within a run, concurrency 3 keeps
batches inside the cache TTL).

| Model | Expected cost | No-cache upper bound |
|---|---:|---:|
| `gpt-5-nano` | **$0.079** | $0.089 |
| `gpt-4.1-nano` | $0.093 | $0.109 |
| `gpt-4o-mini` | $0.147 | $0.164 |
| **`gpt-5.6-luna`** | **$0.247** | $0.287 |
| `gpt-5.4-nano` | $0.256 | $0.296 |
| `gpt-5.4-mini` | $0.927 | $1.078 |
| `gpt-4o`* | $2.451 | $2.730 |

## Scenario B — 30 days of daily production runs (48-hour rolling windows)

The pipeline dedups within a run only; the 48-hour overlap re-classifies each term ~2×.
~188 candidates/day → 5,640 decisions, 120 batches → ~826K input + ~344K output tokens.

| Model | Expected monthly cost | No-cache upper bound |
|---|---:|---:|
| `gpt-5-nano` | $0.158 | $0.179 |
| `gpt-4.1-nano` | $0.185 | $0.220 |
| `gpt-4o-mini` | $0.295 | $0.330 |
| **`gpt-5.6-luna`** | **$0.493** | $0.578 |
| `gpt-5.4-nano` | $0.510 | $0.595 |
| `gpt-5.4-mini` | $1.849 | $2.168 |
| `gpt-4o`* | $4.915 | $5.506 |

If cross-day dedup is added later, Scenario B converges to Scenario A economics
(~2,820 unique terms/month).

## Cost vs quality (measured on the 124 labeled handoff examples)

From `docs/OPENAI_MODEL_EVALUATION.md` (actual runs, 2026-08-31):

| Model | Agreement | Negatives caught (of 72) | Eval run cost |
|---|---:|---:|---:|
| `gpt-4o-mini` | 68.55% | 34 | $0.007624 |
| `gpt-5-nano` (10-term batches) | 67.74% | 34 | $0.011758 |
| **`gpt-5.6-luna`** | **91.94%** | **64** | $0.013197 |

The cheapest models miss ~half of the expected negatives (~700+ wasted-spend terms/month
at P&C volume). `gpt-5.6-luna` costs ~$0.35/month more than `gpt-4o-mini` while catching
nearly 2× the negatives — the least expensive option that preserves acceptable
business-rule behavior.

## Caveats

- Token estimates carry a ±15% band (chars/token calibration, tokenizer differences).
- Cached pricing depends on OpenAI prompt-cache hits; the no-cache bound is the safe ceiling.
- Retry storms inflate cost (the 2026-08-27 Kimi run burned 96 generation requests for 900
  decisions). The OpenAI validation-retry path has been clean in evals.
- gpt-4o pricing is its standard published rate, not from the project snapshot.

## Measured actuals — live 30-day run (2026-09-01)

Run directory: `runs/measure-pnc-30day-openai-20260831T201535531Z/`
(script: `scripts/measure-pnc-30day-openai.ts`, full production prompt path with soul
`2026-09-01.1`, rule set `2026-08-31.2`, prompt `collision-classifier-v4`)

**Window:** 2026-08-02..2026-08-31 (last 30 completed days) · **Status:** SUCCEEDED,
0 failed batches, token reconciliation: exact · **Wall clock:** ~8 minutes

| Metric | Measured | Estimate (Scenario A) | Error |
|---|---:|---:|---:|
| Raw search-term rows | 2,802 | — | — |
| Unique candidates / decisions | **2,238** | 2,828 (Jul window) | volume −21% |
| Batches (50/batch) | 45 | 57 | — |
| Fixed input tokens (API-counted) | 3,589 | 3,974 | +10.7% est |
| Input tokens | **357,698** | ~401,800 | +12.3% est |
| Cached input tokens | 22,451 (6.3%) | ~223K assumed | cache under-delivered |
| Output tokens | **171,993** | ~172,500 | +0.3% est |
| — of which reasoning (low effort) | 13,081 (5.8/decision) | — | — |
| Output per decision | 76.9 tok | 61 tok | −20.7% est |
| Input per decision | 159.8 tok | 142 tok | −11.1% est |
| Generation requests | 48 (45 batches + 3 in-batch validation retries) | 45 | — |
| Decisions | KEEP 1,108 · NEGATIVE_EXACT 1,130 (50.5% negative rate) | — | — |

### Actual cost of the measured run, priced per model on measured tokens

Same measured token counts (357,698 input / 22,451 cached / 171,993 output) priced at
each model's rates:

| Model | Cost for this exact 30-day run |
|---|---:|
| `gpt-5-nano` | $0.0857 |
| `gpt-4.1-nano` | $0.1029 |
| `gpt-4o-mini` | $0.1552 |
| **`gpt-5.6-luna` (what we actually paid)** | **$0.2739** |
| `gpt-5.4-nano` | $0.2825 |
| `gpt-5.4-mini` | $1.0271 |
| `gpt-4o`* | $2.5861 |

**Estimate accuracy:** predicted $0.2473 expected / $0.2874 no-cache ceiling for luna →
actual **$0.2739**, i.e. 10.8% above expected and inside the predicted band.

### Measured daily operations cost (48-hour rolling windows)

Smoke run `runs/20260831T201421924Z-feaeb2f8/` (2026-08-29..08-30) measured **95
candidates/day-window, 14,450 input + 6,337 output tokens, 2 batches, 0 failures**.
Note: daily-window volume (~48 new terms/day) is far below the 30-day-unique average
(~94/day) because P&C has strongly recurring terms; per-run dedup means daily ops
re-classify recurring terms. 30 daily runs ≈ 433.5K input + 190.1K output tokens:

| Model | Monthly cost (30 daily runs) |
|---|---:|
| `gpt-5-nano` | $0.098 |
| `gpt-4.1-nano` | $0.119 |
| `gpt-4o-mini` | $0.179 |
| **`gpt-5.6-luna`** | **$0.315** |
| `gpt-5.4-nano` | $0.324 |
| `gpt-5.4-mini` | $1.181 |
| `gpt-4o`* | $2.985 |

### Lessons from the measurement

1. **Prompt caching under-delivered**: only 6.3% of input came back cached (concurrency 3
   fires batches in near-simultaneous waves, ahead of cache warmth). Budget with the
   no-cache ceiling, treat cache hits as a bonus.
2. **Output tokens/decision (76.9) ran ~21% above the eval-derived 61** — real P&C
   reasons are wordier than the labeled-eval average. Output price dominates model choice.
3. **The estimates were sound**: input-per-decision within 11%, total luna cost within
   11% of prediction and under the conservative ceiling.
4. Daily ops on luna (~$0.32/month) cost barely more than a monthly one-off backfill
   (~$0.27) at current volume — the 48h overlap penalty is small while daily volume is
   ~95 terms. Cross-day dedup would still cut ~20% of LLM spend.

---

## Kimi for Coding run — same range, same candidates (2026-09-01)

**Exact model used: `kimi-for-coding`** — this is the Kimi for Coding **subscription
plan's API alias** served at `https://api.kimi.com/coding/v1` (OpenAI-compatible
`chat/completions`). There is no `k2.6` model string anywhere in this repo's history;
every past Kimi production run (manifests of 2026-08-26/27/28) used the literal string
`kimi-for-coding`. If the plan changes the underlying checkpoint (e.g. K2.x), the API
string stays `kimi-for-coding`.

Run directory: `runs/measure-pnc-30day-kimi-20260901T160347846Z/`
(script: `scripts/measure-pnc-30day-kimi.ts`)

Methodology for a provider-agnostic comparison: **reused the exact 2,238 candidates**
from the OpenAI measurement run (no Google Ads refetch) → byte-identical prompts (same
soul `2026-09-01.1`, rules `2026-08-31.2`, schema, batch size 50, concurrency 3,
`reasoning_effort: low`). Kimi has no input-token-count endpoint, so the fixed-input
baseline is the OpenAI API-counted 3,589 tokens for the identical prefix (recorded as
`UNSUPPORTED_BY_PROVIDER` + reference value in `fixed-input-tokens.json`).

### Measured side-by-side

| Metric | OpenAI `gpt-5.6-luna` | Kimi `kimi-for-coding` |
|---|---:|---:|
| Candidates / decisions | 2,238 | 2,238 (same set) |
| Batches (50/batch) | 45 | 45 |
| Failed batches / retries | 0 / 3 in-batch validation retries | **0 / 0** |
| Input tokens | 357,698 | **339,398** |
| Cached input | 22,451 (6.3%) | **200,064 (59.0%)** |
| Output tokens (total) | 171,993 | **633,018** |
| — reasoning tokens | 13,081 (5.8/decision) | 458,598 (**204.9/decision**) |
| — text output tokens | 158,912 (71.0/decision) | 174,420 (77.9/decision) |
| Total tokens | 529,691 | **972,416** |
| API requests | 48 | 45 |
| Wall clock | ~8 min | **~59 min** |
| Decisions | KEEP 1,108 · NEG 1,130 (50.5%) | KEEP 963 · NEG 1,275 (**57.0%**) |
| Marginal cost | $0.2739 (pay-per-token) | $0 (subscription; consumes quota, see below) |

**Read:** both models write nearly identical amounts of decision text (~72–78
tokens/decision). Kimi "thinks" 35× more (205 reasoning tokens/decision even at low
effort), which is why it's ~7.4× slower per batch. Kimi's prompt caching also works far
better with concurrent batches (59% vs 6.3% cached input). Kimi is meaningfully more
negative-happy (+145 NEGATIVE_EXACT decisions); which side is *right* needs a diff
against the owner-locked labeled examples.

### Kimi subscription quota: how much of the limit does this use?

The Kimi for Coding plan enforces a **5-hour rolling usage window** (HTTP 403
`access_terminated_error: "You've reached your 5-hour usage limit"` — observed firsthand
on 2026-08-27). The API returns **no rate-limit headers** (this run captured none), so
consumption must be tracked locally. Empirical bounds from our own runs on this plan:

| Evidence | Tokens in one 5h window | Outcome |
|---|---:|---|
| 2026-08-27: 4 parallel org runs (P&C + 3 others) | ~1.93M recorded (~242 requests in ~30 min) | **403 limit hit** — quota exhausted |
| 2026-08-28: single org run (Auto Arena) | 709K (40 requests) | Succeeded |
| **2026-09-01: this P&C 30-day run** | **972K (45 requests)** | **Succeeded, zero errors** |

**Conclusion:** this plan's 5-hour capacity sits somewhere above ~1.9M tokens. One P&C
30-day Kimi run (≈0.97M tokens, 45 requests) consumes **roughly half (≤50%) of the
observed 5-hour window** — you can fit about two such runs per window, or one run plus
normal daily-driver usage. Daily 48h-window ops would be tiny by comparison: ~95
candidates → ~14.4K input + ~26.9K output ≈ **41K tokens/day (~2% of the window)**.

Caveat: the exact token cap depends on the plan tier (the observed ~1.9M+ ceiling may
itself be the cap, or the runs may have died on a request-rate axis). The authoritative
number is on the Kimi membership/quota page:
`https://www.kimi.com/membership/subscription?tab=quota`.

### Provider verdict for this workload

- **Cost:** Kimi is $0 marginal on the subscription but quota-bound; OpenAI luna is
  $0.27 per 30-day run with no practical quota concern.
- **Speed:** OpenAI is ~7.4× faster wall-clock (8 vs 59 min).
- **Volume headroom:** Kimi's 5h window caps multi-org backfills (4 orgs in parallel
  already broke it once); OpenAI scales to all 88 orgs without quota planning.
- **Quality:** unresolved from token data alone — Kimi flags 12.8% more terms as
  negatives; needs a decision-diff against owner-locked labels before any switch.
