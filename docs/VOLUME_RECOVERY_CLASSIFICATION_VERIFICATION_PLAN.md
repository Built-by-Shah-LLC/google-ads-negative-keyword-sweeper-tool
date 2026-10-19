# Volume Recovery: intent classification and pipeline verification plan

Date: 2026-10-20

Status: offline implementation and verification completed locally; reviews/publication pending (see section 13)

Repositories: Keyword Sweeper and Built Ads Manager

## 1. Outcome and boundaries

Answer two separate questions with evidence:

1. Does the LLM interpret negative-keyword intent correctly under the account's policy?
2. Does an accepted classification survive collection, batching, analysis, persistence, API parsing, and presentation without being lost or attached to the wrong finding?

Implement the smallest coherent regression coverage and any narrow fixes it exposes. Reuse existing tests, provider adapters, fixtures, and report contracts. No new framework, service, job, or infrastructure is needed.

This document is a follow-up for the main chat. Finish its currently running task at a safe boundary, then reconcile this plan with the changes already implemented. Do not overwrite or duplicate that work.

Creating this document does not authorise implementation or any external operation. Any implementation must remain within the main chat's current authorisation. In particular:

- No Google Ads API calls, including reads.
- No live database access or repairs, migrations, Cloud Run executions, or deployments.
- No paid LLM requests without separate explicit approval.
- No Jira mutations, pushes, merges, or other external changes without their own approval.
- No assumption that these legacy accounts have ever run Keyword Sweeper.

## 2. Observed evidence from the supplied CSV

Source: `/Users/aliamin/Downloads/volume-recovery.csv`.

- Review ID: `a26840a6-22f5-4242-a76b-9f6ab2e82a3b`.
- Status: `partial`.
- Evidence window: 2026-07-20 through 2026-10-17, USD.
- Export: 10,000 data rows and 36 columns; approximately 6.0 MiB.
- No columns for intent category, competitor likelihood, semantic confidence, or LLM explanation.
- `Evidence confidence` is a different field from the LLM's semantic confidence.
- All exported rows show low evidence confidence, amber conversion evidence readiness, and incomplete blocker coverage. These do not establish low model confidence or universal classification failure.
- The first-row warnings identify unsuccessful intent batches 5, 15, 19, 20, and 35, plus `classification_limit` and `classification_time_limit`.
- Other warnings include missing/partial account direct negatives, exclusion details, conversion diagnostics, context/blocker/detail limits, and `report_item_limit`.
- Seven rows have positive conversion-event counts. These are observed events, not verified qualified leads or incremental recovery forecasts.

### What this proves

The run recorded incomplete classification and source coverage. The export cannot show successful intent results because it omits their fields.

### What this does not prove

- That every model request failed, or that successful responses were semantically correct.
- How many unique inputs were accepted, rejected, or never evaluated.
- Why each unsuccessful batch failed; the original warnings do not distinguish every provider, parse, or schema failure.
- Which final CSV rows belong to a numbered model batch. Batching happens before final report sorting and campaign expansion.
- That the 10,000 exported findings represent the complete account inventory.
- That an exclusion with no reported history has zero demand.

Do not treat current recommendations as expected classification labels. The CSV is output to investigate, not a ground-truth answer key.

## 3. Build one small, CSV-grounded fixture

Select approximately 25 distinct model inputs, with additional repeated campaign findings where needed. Preserve source row numbers; row 1 is the header. Sanitise account names and provider resource identifiers before committing a fixture. Keep term text necessary for the regression.

Include these actual examples:

- Row 34: `job`, shared-list phrase negative. Compare with service-related uses of the same word.
- Row 38: `paint job`, shared-list phrase negative, PMax, one click. Row 906 has the same text/scope/match type in Search with zero clicks. Identical model inputs may share intent, never campaign metrics.
- Row 9602: `paint job`, direct campaign exact negative, with no observed history. Different scope/match type makes this a different model input under the current request contract.
- Row 61: `full car paint job cost near me`, campaign exact. Do not classify it as employment solely because it contains `job`.
- Row 27: `free estimates for car body repairs`, campaign exact. Interpret the service-shopping intent under the supplied account policy; do not assume every occurrence of `free` has the same meaning.
- Row 9: `car repair freehold nj`, campaign exact. Row 11: `free`, shared-list broad. `Freehold` must not become a free-offer intent or match through a loose substring rule.
- Row 39: `lacey collision`, campaign exact. Allow a reasoned competitor inference or uncertainty; do not call a competitor verified without supporting evidence.
- Row 621: `talleres de reparación de autos chocados cerca de mi`, PMax campaign exact, two clicks and one conversion event. Exercise multilingual service intent without inventing lead quality.
- Row 3: `修 车 行`, PMax campaign exact. Exercise non-Latin text and encoding.
- Rows 1176–1179: `oil change`, `mechanic repair`, `car mechanic`, and `car repair`, shared-list exact, with missing history and blank channel. Preserve unknowns instead of inventing zero metrics or a campaign attachment.
- Include representative ad-group negatives and the remaining match types from the CSV so the fixture is not only campaign exact terms.

### Pin expected meanings and policy

Use the original run's frozen policy snapshot if it already exists and can be supplied without live access. Otherwise pin an explicit test policy and label the fixture a CSV-grounded regression, not an exact reproduction of the original run.

For each case, record the expected semantic meaning, permitted taxonomy category or accepted uncertainty, competitor expectation, and a short rationale. Do not require verbatim model explanations or an arbitrary exact confidence score. A correct intent may still require retaining the exclusion under account policy.

Use a small reviewed reference set, not a manual questionnaire for all 60 accounts. Future account runs should use their own frozen policy, not hard-coded assumptions from this example account.

### Preserve the no-history distinction

A negative already in place throughout the reporting window may have prevented matching queries from serving. Missing served-query history therefore cannot tell us whether reopening it would produce useful demand.

Keep these findings in an explicit insufficient-evidence/no-history group. Semantic relevance can justify review, but it cannot manufacture performance evidence or make the finding pilot-eligible. Do not silently discard this group because it has no clicks.

## 4. Classifier-only offline regression

Exercise the real recovery prompt builder, provider adapter, response parser, and recovery validator with fake HTTP responses. Reuse the existing Moonshot dispatcher testing pattern. If the recovery factory cannot accept the existing fake transport, add only the smallest necessary injection seam.

Do not make this solely a test that supplies already-accepted `RecoveryIntent` objects.

### Request assertions

- The correct pinned policy, account context, negative text, scope, match type, and item IDs enter the actual request.
- Allowed categories are derived from the pinned taxonomy and agree with the response schema.
- Advertiser text remains data, not executable instructions. A malicious-input fixture must be clearly synthetic; do not claim it appeared in the CSV.
- Historical performance is not invented by the model or used as a substitute for intent.

### Response assertions

- Exactly one accepted result per requested ID, with no omissions, duplicates, or foreign IDs.
- Category is an allowed ID or an explicit accepted unknown.
- Competitor likelihood, bounded finite confidence, and nonempty explanation survive parsing.
- Malformed JSON, unsupported categories, missing/duplicate/foreign IDs, invalid confidence, and invalid field shapes fail validation safely.
- Out-of-order valid results join by ID, not array position.
- Provider/time-out failure remains distinguishable from response validation failure without exposing raw provider data or credentials.
- Token usage remains accounted for on validated and rejected responses wherever the provider returned usable usage data.

Passing this layer proves request/response integration and validation. It does not prove that the real model chooses correct labels.

## 5. Whole offline pipeline regression

Run the actual orchestration with real collection parsing, grouping, batching, classifier adapter, matching, analysis, ranking, and report serialization. Replace external transports and storage with existing test fakes/an in-memory store. At least one positive case must go through the real adapter and parser rather than injecting ready-made intents.

The source CSV contains aggregate report rows, not original query-level API responses. Any reconstructed source responses must be labelled synthetic, with CSV provenance only for values actually available. Do not fabricate a claim that collection faithfully replayed the original account run. Exact replay requires already-existing raw snapshots and the frozen policy.

### Required cases

1. **Successful flow:** accepted category, competitor likelihood, semantic confidence, and explanation reach the correct saved finding. Serialise and parse the saved item through the production contract.
2. **Batch boundary:** 25 unique inputs require one classification batch; 26 require two. No lost, duplicated, or incorrectly associated IDs.
3. **Deduplication:** identical inputs classify once and fan out to their findings. Different scope/match type must not collapse. Campaign metrics, source identities, recommendations, and blocker details remain separate.
4. **Prioritisation before the cap:** place an observed valuable candidate beyond the old arbitrary first-2,000 inventory position. Verify the current business-evidence prioritisation admits it before lower-evidence candidates, with deterministic ordering. Do not use raw impressions as the primary business-value signal.
5. **Candidate cap:** use 2,001 synthetic unique inputs offline. Confirm the model-input limit counts unique inputs, skipped findings remain in the report with an explicit reason, and no paid requests occur.
6. **Elapsed-time cap:** use a fake clock, not a 20-minute wait. Skipped findings remain reviewable with their existing traffic evidence and a clear time-budget reason.
7. **Partial batch failure:** one batch fails while another succeeds. Successful intent remains intact; failed rows stay unclassified with safe explanations; run status and coverage are partial.
8. **All batches fail:** retain useful evidence and make the classification failure explicit. No fallback category or confident competitor label is invented.
9. **Missing taxonomy:** fail closed before provider access, retain an actionable explanation, and never produce a pilot recommendation.
10. **Policy gate:** a confident model cannot override a retain policy. Relevant intent alone does not imply that an exclusion should be removed.
11. **Evidence gate:** missing/rejected/skipped classification, amber measurement, incomplete blocker coverage, or other required missing evidence cannot become a potential pilot.
12. **Unknown versus unavailable:** an accepted unknown category is distinguishable from no accepted model result. Do not conflate model confidence with evidence confidence.
13. **No history:** blank or unavailable metrics stay unknown. The term remains visible without a fabricated forecast, recovered leads, conversion quality, campaign attachment, or zero-demand claim.
14. **Channels and scopes:** cover Search and PMax, exact/phrase/broad, campaign/ad-group/shared exclusions, and applicable blocker matching. Shared evidence must not multiply historic traffic or conversion events.
15. **Accounting:** total unique inputs reconcile to evaluated, rejected, and not evaluated. Campaign-expanded finding counts are reported separately. Progress, terminal status, and saved item count agree with what actually occurred.

Prefer asserting existing fields, summaries, and coverage. Do not introduce a new status framework or database migration solely for these tests.

An in-memory-store test does not prove PostgreSQL grants, RLS, transaction fencing, concurrency, Cloud Run IAM, or a deployed end-to-end integration. Keep those limitations explicit.

## 6. Ads Manager report/API/export boundary

Add a narrow regression covering saved worker finding -> report API parsing -> visible report detail and export where supported.

- A successfully classified finding retains category, inferred competitor status, semantic confidence, and safe explanation through the contract.
- The user can distinguish successful classification, accepted uncertainty, rejected response, and not evaluated because of a limit.
- Show a safe reason when classification is unavailable. Do not replace it with a generic evidence-confidence label.
- Add useful semantic fields to the compact export if they are still absent; use the smallest additive, documented change. An export that drops intent cannot verify intent delivery.
- Keep raw prompts, full policy internals, credentials, raw provider errors, and unnecessary large evidence blobs out of the export.
- Preserve CSV escaping/formula-injection protections, complete pagination, row-count checks, and honest size-limit handling. Additional fields must not silently truncate the export or reintroduce uncontrolled payload growth.
- Do not mutate existing retained reports to make them look newly classified. Older payloads without semantic results must render honestly.

Coordinate with the current table/export implementation. This is reporting visibility and regression coverage, not a second UI redesign. If presentation changes are necessary, use existing components and the repository's desktop/narrow-viewport accessibility checks.

## 7. Optional real-model semantic evaluation: separately approved

Prepare an opt-in evaluation for the small reference fixture. Do not execute it until the user explicitly approves the provider cost and the account text/policy being sent.

- Use the configured recovery model and pinned policy, not a different prompt or a hand-written substitute classifier.
- Keep all Google Ads transports fake or disabled and use no live database.
- Start with one small batch; any additional calls or repeated trials must remain within the approved scope and budget.
- Evaluate clear cases against the reviewed reference meanings and taxonomy. Ambiguous business/place names can reasonably remain unknown.
- Require explanations grounded in supplied text/policy. Reject invented competitor verification, performance, revenue, or lead quality.
- Record model/provider/settings, policy identity, input and output tokens, available cache usage, estimated or actual cost with its basis, accepted/rejected/skipped counts, and each disagreement.
- Treat self-reported confidence as model output, not a calibrated accuracy probability.
- Report clear-case correctness and ambiguous cases separately. Do not hide a failed important case behind one aggregate score.
- A single successful call or mocked success is not sufficient to claim robust semantic quality. State sample size and remaining uncertainty.
- Keep paid evaluation out of default CI. If useful, sanitise an approved successful response into an offline regression fixture.

Only this layer supplies evidence about the actual model's classification quality. If it is not run, state that semantic accuracy remains unverified.

## 8. Likely implementation locations

Use the latest main-chat working tree as the source of truth. Extend these existing locations where possible; do not create parallel infrastructure:

- Sweeper: `test/volume-recovery.test.ts` for orchestration, batching, grouping, limits, failure modes, and policy/evidence gates.
- Sweeper: `test/volume-recovery-evidence.test.ts` for source/matching/metric boundaries where appropriate.
- Sweeper: `test/moonshot-classifier.test.ts` and recovery-specific tests beside the existing suites for the actual prompt/transport/parser integration.
- Sweeper: one small sanitised fixture under the existing test-fixture convention, with CSV row provenance and expected semantic meanings.
- Sweeper: `src/volume-recovery/classifier.ts` only if a minimal transport seam or a reproduced classification bug requires a change. Change pipeline/analysis only for demonstrated failures not already fixed.
- Ads Manager: `packages/api/test/keyword-sweeps/volume-recovery.test.ts` for report parsing and compact export fields.
- Ads Manager: `apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-panel.test.tsx` and existing CSV tests for accepted/unknown/unavailable intent presentation.
- Update relevant existing contracts/documentation only if behavior or exported fields change.

Do not commit the entire private 10,000-row export, introduce a new test framework, or change the account's live policy.

## 9. Implementation sequence and verification

1. Inspect the latest changes and existing tests; identify what this plan already covers. Preserve unrelated work.
2. Pin the small fixture and policy. Document missing original-run inputs instead of fabricating them.
3. Add the targeted offline classifier integration regression, then pipeline/report regressions. Show the failure before fixing an actual bug where feasible.
4. Make only the narrow source/report fixes demonstrated necessary.
5. Run targeted offline tests, then the relevant repository checks in an isolated local/preview configuration that cannot reach real providers or production credentials.
6. Review the resulting diff for scope, privacy, backward compatibility, and truthful coverage.
7. Hand off offline findings. Request separate approval only if proceeding to the optional real-model evaluation.

Sweeper baseline for later implementation: `npm run check`, relevant targeted tests, `npm test`, and `npm run build`. Add `npm run rules:check` only if rule-release or account-policy compilation is changed.

Ads Manager baseline for later implementation: targeted API/UI tests using the repository's current scripts, `npm run docs:check`, `npm run check`, and `npm run build`. Perform relevant visual/accessibility checks only if UI changes are made. Do not invoke Cloud Run, real recovery entrypoints, live provider probes, or mutation tooling as a substitute for offline tests.

These commands are planned verification, not evidence that they were run while creating this document. A passing build is not proof of classification correctness, database integration, or a successful deployment.

## 10. Acceptance criteria

- [x] A small sanitised fixture traces to actual CSV rows; synthetic source/failure data is clearly identified.
- [x] Policy and expected semantic meanings are explicit; existing report recommendations are not treated as gold labels.
- [x] The recovery request/adapter/parser/validator are exercised together offline.
- [x] At least one successful pipeline case uses that adapter, not only injected accepted intents.
- [x] Required batching, ID validation, deduplication, prioritisation, cap/time, partial-failure, missing-policy, no-history, and policy/evidence-gate cases pass.
- [x] Classification counters reconcile separately from campaign-expanded findings.
- [x] Saved semantic fields survive report parsing and are visible or honestly unavailable in the UI/export.
- [x] Unknown semantic category is not confused with unsuccessful or skipped classification.
- [x] CSV safety, privacy, size bounds, and legacy-report compatibility are preserved.
- [x] Offline tests make no Google Ads, real-model, or live database calls.
- [x] Repository checks actually run are documented without overstating their coverage.
- [x] Real-model quality is explicitly marked unverified; opt-in evaluator is prepared, not run live.
- [x] Local evidence is distinguished from publication/deployment; no prohibited live operation was performed.

## 11. Handoff and remaining limits

The implementation handoff should report separately:

1. **Integration correctness:** tests actually run, what they exercised, results, and gaps.
2. **Semantic accuracy:** real-model evaluation results, or explicitly not run; no claim based on mocks.
3. **Reporting visibility:** where intent appears and how failed/skipped/unknown cases are represented.
4. **Operational limits:** source coverage, caps, original snapshots unavailable, and database/cloud/live behaviors not verified.
5. **Changes:** file-by-file behavior, reason, risks, compatibility, verification, and follow-up.
6. **Delivery state:** relevant Jira key/status only if verified, local commit/release state, and any approval still needed.

Existing implementation context mentions DEV-52 and DEV-53; confirm their current scope/status before recording new delivery evidence. This document neither changes Jira nor asserts their current status.

Risks to keep visible: a small fixture cannot establish accuracy across every account; original CSV output cannot reconstruct missing source history; multilingual/ambiguous terms may need uncertainty; model results can vary; export additions affect consumers and byte limits; and any main-chat changes made after this inspection must be reconciled rather than overwritten.

## 12. Work performed to produce this document

Read-only inspection of the supplied CSV and relevant local source/tests informed this plan. This follow-up creates only this Markdown document. It does not implement the tests, rerun the report, contact Google Ads or an LLM, alter stored data, or deploy anything.

## 13. Implementation evidence — 20 October 2026

Section 12 describes the original planning-only turn, not this later authorized
implementation. Shah subsequently approved implementation, review and main
publication; no migration, Google Ads API operation, paid model call, database
repair, job or deployment is authorized by the current task.

The implementation now pins 26 CSV-grounded findings / 25 unique model inputs.
Original policy/raw snapshots were unavailable, so the policy, identities,
attachments and reconstructed source responses are explicitly fictional. Blank
channels remain unattached; missing metrics remain null. Only same text/scope/
match inputs share intent. The mirrored row-621 saved finding is asserted
against actual offline worker output and passed through real portal report
parsing, static compact-table rendering and complete CSV export.

A reproduced red regression showed array-valued category data passed the old
validator. The narrow fix enforces string shapes and rejects blank reasons;
the factory accepts the existing optional fake dispatcher. No ranking, live
policy or persisted contract changed. Provider failure, rejected responses,
accepted unknown, cap/time/taxonomy skips, 25/26 batching, 2,001 inputs,
outcome-first deterministic prioritisation, null history, policy/evidence vetoes
and separate unique-input/finding accounting pass offline.

Ads Manager appends five safe intent CSV fields after the existing 36. The
intent note is code-owned text, not raw model reasoning; that reasoning stays
in the authorized table. Paging, escaping, complete-count and 10 MiB/10,000-row
limits remain enforced. No UI component/layout change or new visual pass.

Actual checks: 71 focused recovery tests passed; full Sweeper check/build and
254 tests passed (255 total; one optional database integration skip explicitly
disabled). Ads Manager targeted API 17 / table 18 tests passed; all five
typechecks and 1,012 tests passed (499 web, 94 worker, 246 API, 69 DB unit, 104
domain), and preview-mode workspace build passed with DB variables removed.
Contracts and mirrored saved fixtures compare byte-identically. Local portal
docs check remains blocked by the unrelated untracked `agents/` directory,
which was preserved, as was the user's `next-env.d.ts` byte-for-byte.

The opt-in evaluator's consent/budget/refusal, one-request/no-retry adapter,
usage/cost and disagreement handling passed fake-transport tests. It was not
run against a real model: semantic accuracy is **unverified**. Cost estimates
use operator-supplied rates, not current-price claims or a billing cap; output
requires human explanation review. No original live report was reclassified.
Both independent fallback reviews identified a missing-usage/zero-cost bug;
it was reproduced red and fixed with code-owned usage-availability flags.
Missing/malformed main usage now means unknown cost/budget; missing/invalid
cache remains unknown with conservative full-input pricing. Explicit reported
zero remains distinct. The runtime's existing normalized totals are unchanged.

Review/publication outcomes and the complete file-by-file report are recorded
in section 24 of `VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md` and the companion
portal's D-121 status entry. DEV-52/DEV-53 were read as Work in progress; no
Jira cloud change. No main merge is implied until its actual evidence is added.
