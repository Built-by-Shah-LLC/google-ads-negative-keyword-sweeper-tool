# Conditional phrase protection handoff

## Review findings and limits

Both live candidate repetitions matched all seven owner-required examples and
returned identical decisions across all 19 fixtures. Both scored 17/19 against
all diagnostic expectations; the two unprotected boundary disagreements also
occurred in both stable comparisons. They are documented below, not hidden
by the passing deterministic tests or treated as production accuracy evidence.

The unconditional pre-LLM KEEP path has been removed. Configured phrases select
narrow evidence exceptions; all complete queries still reach the LLM. Remaining
negative evidence, including evidence under the same rule, remains effective.
This is a model instruction contract, not deterministic classification enforcement.
The stable snapshot remains byte-for-byte identical to the original Git version.
Individual rule sections remain unchanged; only the active preamble and versions
changed. Existing integrity and change-budget controls remain active.

No deployment, Google Ads mutation, migration, data repair, branch-protection
configuration, or cloud permission change was performed. Live evaluation uses only
synthetic fixture terms and the configured paid provider. External branch protection
and deployment permissions remain prerequisites for preventing deliberate bypass.

## Verification

- `npm run check`: passed.
- `npm test`: 64 deterministic tests passed. These verify parsing, matching,
  submission, prompt construction, failure behavior, and release controls, not
  classification accuracy.
- `npm run rules:check -- HEAD`: passed; active Markdown changes are six added and
  two deleted lines within the preamble, plus two configured phrase entries.
- Compiled the production TypeScript into a temporary directory, copied the
  configuration as the Dockerfile does, and successfully loaded release
  `2026-09-09.2` with two protections. No Docker build or deployment was run.
- `git diff --check`: passed.
- Stable snapshot SHA-256: `9d5aa2d2380b1163b49310f1c49340f9e070d070715a81c81e73021280559336`;
  also compared its bytes with `HEAD:src/config/negative-keyword-rules.md`.

## File-by-file changes in this follow-up

Paths below are relative to the project root. Files carried forward unchanged from
the previous turn, including the stable snapshot, Dockerfile, deployment script,
package scripts, GitHub workflow, and LF attributes, were not modified again.

- **`src/config/phrase-protections.md` (new):** Replaces the unconditional list with
  `collision service` and `collision experts`, each specifying a phrase, negative
  rule ID, excused evidence, and optional account scope. Both are globally scoped.
  Longer queries match, while remaining exclusions still apply. Phrase breadth and
  exception wording require owner review. Verified through parser/matcher tests and
  release hash validation; live model evidence is recorded separately.
- **`src/config/phrase-protections.ts` (new):** Implements whole-token contiguous
  matching and strict configuration parsing. Returns matching entries, never a
  decision. Case, punctuation, spacing, and Unicode NFKC normalize; synonyms,
  plurals, and reordered tokens do not expand. Misconfiguration stops loading.
  Verified by boundary, location, scope, legacy-format, and invalid-rule tests.
- **`src/config/always-keep.md` (removed):** Deletes the old unconditional exact
  configuration to eliminate conflicting sources of policy. Old configuration is
  not silently migrated. Replacement entries and hash validation were verified.
- **`src/config/always-keep.ts` (removed):** Deletes deterministic KEEP generation
  and its synthetic citation. Callers must use phrase matching and LLM decisions.
  Verified by type checking and absence of the old runtime symbols.
- **`src/config/negative-keyword-rules.md`:** Advances rules to `2026-09-09.1` and
  prompt to `collision-classifier-v7`, adding a preamble about excused versus
  independent evidence. No individual rule section changes. New behavior remains a
  candidate release, not a replacement stable designation. Verified by diff, unit
  tests, and release-budget checks.
- **`src/config/rule-set.ts`:** Loads and validates the phrase file against known
  negative rule IDs and the manifest hash. The old file/schema no longer loads;
  complete bundles are required for startup. Verified by tamper tests and compiled
  bundle loading.
- **`src/config/rule-release.json`:** Advances the combined release to
  `2026-09-09.2`, records candidate rule/protection hashes, and preserves the stable
  identity/hash. The protection hash replaces the old override hash. Hash approval
  remains a review obligation, not proof of safety. Verified by release checks.
- **`src/types.ts`:** Replaces `AlwaysKeepEntry`/`alwaysKeep` with
  `PhraseProtection`/`phraseProtections` and retains release provenance. The new
  shape exposes a specific rule ID and evidence exception. Custom callers using
  the removed type need updating. Type checking passed.
- **`src/llm/prompt.ts`:** Sends scoped definitions, a trusted per-item match map,
  and explicit evidence-only instructions while preserving all query text and rules.
  Requires examination of same-rule evidence and existing citations, with no rule
  counting or forced KEEP. Fixed-token documentation includes protection policy.
  Adds prompt tokens and still depends on model compliance. Prompt-contract tests
  passed; live evaluation is separate.
- **`src/pipeline/process-organization.ts`:** Restores normal LLM classification
  for every candidate and removes synthetic protected decisions, special artifacts,
  and bypass accounting. Retains release ID in standard decisions output. Matched
  queries now incur model calls and fail normally if their provider request fails.
  Consumers of the removed special artifact must use standard outputs. Mocked
  pipeline tests verify full submission, preserved negatives, and no failure KEEP.
- **`scripts/check-rule-release.ts`:** Applies the existing five-entry change cap
  and release-ID/hash checks to phrase protections. Stable immutability, one-section
  and 40-line policy budgets remain. The check still requires external enforcement
  and a valid approved base commit. Verified directly and with temporary-Git tests.
- **`scripts/evaluate-phrase-protections.ts` (new):** Adds explicit `--live` synthetic
  model evaluation, two repetitions for candidate and stable policy, exact prompt
  and response artifacts, usage, and agreement reporting. Uses the configured
  timeout; disables HTTP retries for bounded evaluation. Fails the command on
  request errors or candidate mismatches. Calls a paid provider, never Google Ads.
  Type checked; actual execution and limitations are reported below.
- **`test/fixtures/phrase-protection-cases.json` (new):** Stores 19 synthetic cases
  with expected outcomes and matching IDs: required owner examples plus location,
  boundary, normalization, independent-exclusion, same-rule, and ordinary-policy
  diagnostics. These are regression expectations, not a labeled production sample.
  Parsed by unit tests and the separate evaluation script.
- **`test/phrase-protections.test.ts` (new):** Replaces unconditional-match tests
  with phrase selection, account scope, strict parsing, and hash-tamper coverage.
  Does not assert LLM decisions. All tests passed.
- **`test/always-keep.test.ts` (removed):** Removes tests that encoded the obsolete
  unconditional semantics; replaced by phrase-protection tests. Verified by full
  suite execution and type checking.
- **`test/process-organization.test.ts`:** Replaces bypass tests with full-query
  submission and failure tests. The mock intentionally returns NEGATIVE even for a
  positive example to prove the pipeline does not manufacture KEEP. All tests
  passed; mocked results do not measure classification accuracy.
- **`test/prompt.test.ts`:** Covers matching IDs for every fixture, complete query
  preservation, unchanged rules, account scope, non-search fields, same-rule
  evidence instructions, and absence of synthetic KEEP citations. Passed; it
  verifies prompt contents, not model obedience.
- **`test/rule-release.test.ts`:** Migrates release fixtures to the new schema and
  hashes while retaining oversized-entry, multi-section, and stable-edit rejection.
  Passed in an isolated temporary Git repository; hosted permissions are untested.
- **`docs/RULE_RELEASES.md`:** Rewrites the policy semantics, audit artifacts,
  compatibility notes, and evaluation procedure while preserving rollout/review
  requirements. Cross-checked against the code. Manual rollout and external
  enforcement remain operational follow-up, not performed work.
- **`docs/PHRASE_PROTECTION_HANDOFF.md` (new):** Records this file-by-file handoff,
  tests, live evidence, risks, and unperformed operations. Documentation only;
  checked against tool results and the final working tree.

## Live evaluation evidence

The initial sandboxed run could not reach the provider. A subsequent run with an
artificial 180-second timeout expired on the first stable request; its following
candidate request was interrupted before restarting with the configured
600-second timeout. Neither failed attempt yields classification evidence.

The first completed comparison on Kimi K2.6 (thinking enabled) matched all seven
owner-required examples in the candidate condition. Candidate agreement was 17/19;
stable agreement was 13/19 against the same diagnostic fixture expectations.
The only four changed decisions were the `collision service` location/normalization
examples and the example containing both configured phrases. All independent
negative exclusions stayed negative. The stable condition already kept the two
`collision experts` location examples, so the historical experts failure was not
reproduced in this run.

Both conditions kept `collision serviceman near me` and `collision expertship near
me`, disagreeing with the extra fixture's NEGATIVE hypotheses. Both had empty
protection maps and the model did not claim an exception. These diagnostic
expectations were not supplied by the owner and are not new candidate differences
in the first comparison. They remain visible; no unrelated rule was changed to
force agreement. Synthetic agreement is not production classification accuracy.

The second candidate repetition returned identical decisions across all 19 terms,
again matching all seven owner-required outcomes. It preserved the same-rule
negative evidence in `steve collision experts`, `mechanic collision service near
me`, `collision service and oil change`, `collision service and brake service`,
and `collision experts collision king`. The unconfigured plural `collision services
near me` stayed negative. Both completed candidate responses passed output
validation without an additional generation attempt.

The final stable repetition also scored 13/19 and returned the same decisions as
the first stable run. Both candidate runs matched 7/7 owner-required examples;
both stable runs matched 5/7. All four responses validated on their first generation
attempt. The completed evaluation command exited 1 because the two supplementary
candidate diagnostic expectations remain mismatches, not because requests failed.
Those extra expectations require policy-owner review before being treated as
business acceptance criteria. No live classification failures or mismatches were
silently converted to KEEP, hidden, or relabeled as passing tests.

The complete comparison is in
[runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/summary.json](../runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/summary.json).
The final code remains the code measured in this completed comparison.

## Generated evidence files

These local JSON files were created by the live evaluation attempts. Each was
parsed as JSON during handoff verification. Prompt files record sent/attempted
inputs, not proof of completed inference; metadata records configuration, not
proof of execution. Only completed result files contain validated classifications.
Synthetic data only; none is a deployment artifact or an authorization to import
negatives. Initial failed/interrupted attempts are preserved for transparency.
The completed comparison's rows, counts, required outcomes, and generation
attempt statuses were checked against its saved result files.

- **`runs/phrase-protection-eval-2026-09-09T05-55-05.711Z/candidate-1-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-55-05.711Z/candidate-2-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-55-05.711Z/metadata.json`:** Provider, versions, fixture hash, and comparison methodology; preserves the settings used by this attempt. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-55-05.711Z/stable-1-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-55-05.711Z/stable-2-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-55-05.711Z/summary.json`:** Aggregated completed outcomes or request errors; records only what finished in this attempt. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-56-01.072Z/candidate-1-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-56-01.072Z/metadata.json`:** Provider, versions, fixture hash, and comparison methodology; preserves the settings used by this attempt. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-56-01.072Z/stable-1-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-56-01.072Z/summary.json`:** Aggregated completed outcomes or request errors; records only what finished in this attempt. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/candidate-1-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/candidate-1-result.json`:** Validated model decisions, fixture comparisons, token usage, raw response, and generation attempts; supports the reported live findings. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/candidate-2-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/candidate-2-result.json`:** Validated model decisions, fixture comparisons, token usage, raw response, and generation attempts; supports the reported live findings. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/metadata.json`:** Provider, versions, fixture hash, and comparison methodology; preserves the settings used by this attempt. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/stable-1-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/stable-1-result.json`:** Validated model decisions, fixture comparisons, token usage, raw response, and generation attempts; supports the reported live findings. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/stable-2-prompt.json`:** Exact serialized system/user prompt for this condition and repetition; permits inspection of scope and full-query submission. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/stable-2-result.json`:** Validated model decisions, fixture comparisons, token usage, raw response, and generation attempts; supports the reported live findings. Read/JSON verification passed.
- **`runs/phrase-protection-eval-2026-09-09T05-59-34.111Z/summary.json`:** Aggregated completed outcomes or request errors; records only what finished in this attempt. Read/JSON verification passed.
