# Moonshot thinking mode and structured-output conformance

Status: verified 2026-09-29/30 against the live `built-ads-manager-dev` deployment.
Audience: anyone touching `MOONSHOT_THINKING`, the LLM response schema, or the
two sweeper Cloud Run jobs.

## TL;DR

- The **manual sweeper** (`negative-keyword-sweeper-manual`, current code) must
  run with `MOONSHOT_THINKING=disabled`. With thinking enabled, `kimi-k2.6`
  returns structured output that is missing required fields and whole batches
  are discarded.
- The **daily sweeper** (`negative-keyword-sweeper`, pinned to the older image
  `sweeper:fb49c67`) runs with `MOONSHOT_THINKING=enabled` and works — its
  response contract predates the current schema and is not affected.
- Thinking is therefore a per-codebase compatibility property, not a global
  "better/worse" switch. Do not copy env settings between the two jobs.

## Evidence

### Probe (this repo: `scripts/probe-moonshot-schema.mjs`)

The probe posts the exact production `createResponseSchema` shape to
`https://api.moonshot.ai/v1/chat/completions` with model `kimi-k2.6` and checks
the returned JSON for required decision fields.

| Variant | Result |
| --- | --- |
| `thinking: { type: "disabled" }` | CONFORMANT — all required fields present (`itemId`, `decision`, `negativeText`, `ruleIds`, `confidence`, `reason`) |
| `thinking: { type: "enabled" }` | NON-CONFORMANT — required fields missing |
| thinking omitted | NON-CONFORMANT — required fields missing |

Both nullable forms (`anyOf: [string, null]` and `type: ["string", "null"]`)
behave identically; the schema's nullable style is not the issue. With thinking
on, the model spends output on reasoning and then emits an incomplete payload
against this strict schema.

### Production runs (Cloud SQL `negative_keyword_sweep_runs`)

- Manual job, thinking enabled (early 2026-09-29 runs): every LLM batch failed
  schema validation twice; runs persisted as `failed` with 0 decisions.
- Manual job, thinking disabled (`8trr8` and later): all batches succeed.
- Daily job, thinking enabled, image `sweeper:fb49c67` (2026-09-24 to
  2026-09-29): 18-26 batches per run, 0 failed batches. It also uses
  `LLM_MAX_ATTEMPTS=5`, and its prompt/validation code differs from the current
  branch, so its conformance profile cannot be extrapolated to the manual job.

## Residual non-conformance with thinking disabled

Thinking-off makes kimi-k2.6 structurally conformant but not perfectly tidy.
Two cosmetic deviations were observed in production and are now tolerated by
`src/llm/validation.ts` instead of discarding batches:

1. `reason` longer than 240 characters on large multi-day batches — clamped to
   240 characters (2026-09-30).
2. `negativeText` filled on a `KEEP` decision — the stray value is ignored
   (`negativeText` is only meaningful for `NEGATIVE_EXACT`, where the strict
   term-preservation check still applies) (2026-09-30).

If a run persists as `partial`, read `negative_keyword_run_errors` for the
exact validator message before changing anything; each tolerated deviation
needs a targeted, evidence-backed normalization like the two above.

## Configuration

- Job env: `MOONSHOT_THINKING=disabled` on `negative-keyword-sweeper-manual`.
- Code default: `thinkingMode()` in `src/config/env.ts` defaults to `disabled`
  for provider `moonshot` when the variable is unset.
- Local `.env` mirrors the job setting.

## Re-evaluating thinking for the current code

Thinking could only be re-enabled for the manual sweeper after reworking the
response schema so kimi-k2.6 fills it completely while reasoning. The required
steps are: adjust `createResponseSchema`, re-run
`scripts/probe-moonshot-schema.mjs` until the thinking-enabled variant is
CONFORMANT, run the full test suite, redeploy, and verify a multi-day manual
run end to end. Until the probe passes, keep thinking disabled.
