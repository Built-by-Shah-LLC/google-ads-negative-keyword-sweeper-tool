# Volume Recovery implementation plan

**Status:** Approved for local implementation on 15 October 2026

**Prepared:** 15 October 2026

**Planning reference:** [DEV-13](https://builtbyshah-team.atlassian.net/browse/DEV-13), completed research and fictional mock

**Implementation owners:** Keyword Sweeper for analysis; Built Ads Manager for account controls, schema, authorized reads and CSV export

An authorized employee enables Volume Recovery for an account in Ads Manager. The server saves that choice and a durable review request, starts a private Cloud Run Job from the Keyword Sweeper repository, and returns the request ID. The job reads Google Ads, evaluates existing exclusions, and writes its report to the shared PostgreSQL database. Ads Manager displays progress and the completed report, which the employee can download as CSV.

The small refinement to the proposed flow is that the worker writes the result directly to the database already shared by both applications. Ads Manager reads that result through its server API. This uses the existing persistence boundary and removes a callback endpoint, callback authentication, and duplicate result delivery.

This first implementation produces recommendations. Enabling recovery does not change Google Ads, change the normal sweep policy, or enroll the account in a recurring schedule.

## 1 Product behavior

The feature lives inside the account's existing **Policy & automation** workspace. Add a Volume Recovery section using the established account composition rather than a new navigation destination or general reports area.

The first version supports:

- One persistent enable switch per account, initially off.
- One review when the switch changes from off to on.
- A **Run again** action while enabled; every completed rerun has its own dated report.
- Separate Search and Performance Max results within the same account report.
- An account policy that maps existing negative-rule categories to retain, review, or consider for a future pilot.
- A measurement-readiness summary, current exclusion inventory, ranked findings, and CSV download.
- Visible starting, running, completed, partial, failed, and stale-progress states.

Turning the switch off prevents new review requests. A request already accepted may finish, and its report remains available. This avoids adding cancellation and preserves the report someone already requested. Changing a policy does not rewrite a previous report or automatically run another review; the UI indicates that a new review is needed.

The control belongs to internal employees under Ads Manager's existing access model. Clients receive a deliberately shareable export; this feature adds no client login.

## 2 Existing foundations and ownership

Reuse the server-side Cloud Run invocation approach in `built-ads-manager/apps/web/src/server/keyword-sweeps/manual-keyword-sweep-execution.ts`. It already obtains runtime Google credentials and invokes a named private job with server-built argument overrides. Keep the existing manual sweep behavior intact.

Reuse Keyword Sweeper's Google Ads authentication/client, supported Search and PMax query parsers, exact arithmetic, model-provider adapters, bounded concurrency, structured logging, and PostgreSQL connection conventions. The recovery output needs its own validated contract because a recommendation to review an existing negative is a different record from a normal `KEEP` or `NEGATIVE_EXACT` classification.

Built Ads Manager owns all migrations in `packages/db`, serialized contracts in `packages/domain`, authorization and repositories in `packages/api`, and browser/server integration in `apps/web`. Keyword Sweeper owns the recovery entry point, collection, analysis, and result persistence. Use one report contract version and one set of database constraints across them; a shared package or third repository is unnecessary.

Current product decisions D-104/D-105 assign human-reviewed Google Ads keyword changes to Ads Manager. Recovery findings must not invoke the existing reviewed **Keep** command: for Search it can also create or enable an exact positive keyword, and its retained-decision workflow is different from reviewing legacy exclusions. Any future recovery pilot needs a separate product decision within the current ownership model.

The current Sweeper checkout contains older global-policy and mutation-capable entry points, while Ads Manager documents a newer manual worker and database-owned compiled policy. Before coding, align the implementation branch with the approved manual/policy integration. Reuse the actual approved code rather than rebuilding a policy compiler or treating the older deployment document as live-state proof.

## 3 End to end request flow

```mermaid
sequenceDiagram
    participant U as Employee in Ads Manager
    participant A as Ads Manager server
    participant D as Shared PostgreSQL
    participant C as Cloud Run Jobs API
    participant W as Sweeper recovery job
    participant G as Google Ads and LLM
    U->>A: Enable recovery for this account
    A->>D: Save configuration and pending run in one transaction
    D-->>A: Commit run ID
    A->>C: Start the recovery job with run ID
    C-->>A: Execution accepted
    A->>D: Retain execution reference
    A-->>U: 202 with run ID and current status
    W->>D: Claim pending run atomically
    W->>G: Read exclusions and evidence; classify intent
    W->>D: Save results, coverage and terminal status
    loop While the report is open and running
        U->>A: Request progress
        A->>D: Read account-authorized report
        A-->>U: Current progress or report
    end
    U->>A: Download CSV for this run
    A->>D: Read the same immutable result
    A-->>U: CSV download
```

The HTTP request waits only for the short Cloud Run launch call, never for Google Ads collection or model completion. Do not start an unawaited background promise after sending the HTTP response. The durable request transaction must commit before the cloud call, so the worker can find it and a cloud failure cannot erase the request.

Use the existing launcher's API version and authentication pattern. Cloud Run Jobs execute batch workloads; they do not host a worker HTTP endpoint. The current v1 `jobs.run` method returns an Execution, which the new gateway must parse and retain internally instead of discarding. A successful launch acknowledges execution creation, not report completion. [Cloud Run execution model](https://docs.cloud.google.com/run/docs/execute/jobs), [v1 jobs.run contract](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.jobs/run).

## 4 Minimal data model

Add two recovery tables and extend account configuration. Keep normal sweep history and the non-runnable D-050 classification-intent table unchanged.

### Account configuration

Extend `client_accounts` with recovery enablement and a small, validated recovery-policy object. The policy object contains a format version, category overrides keyed to existing rule IDs or stable rule families, and an optional conversion-action interpretation override. Use a revision counter for concurrent saves and the existing audit mechanism for actor and before/after values.

Default categories come from a reviewed recovery mapping over the existing taxonomy. Account overrides can change that treatment. Do not copy the entire negative-keyword rules document into a second editable rule system. Do not change the account's daily negative policy merely because recovery is enabled.

### volume_recovery_runs

One row serves as both the durable request and the run record. Retain:

- Organization, account, request ID, requesting employee, idempotency key, request fingerprint, and request time.
- Status, current stage, started/completed time, heartbeat time, and internal cloud execution reference.
- Resolved account timezone/currency, date window, campaign selection, captured policy revision/content/hash, scoring version, and report contract version.
- Conversion profile and source-coverage summary, including unavailable sources and tracking/goal concerns.
- Exclusion, matched-evidence, processed, and failed counts; provider/model identity and normalized token totals.
- Safe failure code/message and fixed read-only/no-Google-Ads-mutation invariants.

The worker resolves the account timezone from its authoritative account metadata before collection and records the exact resulting dates. A retry uses those dates rather than moving the window.

The request transaction pins the recovery configuration and approved base/account policy revision references. The worker loads those immutable revisions and verifies their hashes; it does not switch to a newer policy while the request waits to start. Missing or inconsistent snapshots fail the run with a configuration error.

### volume_recovery_items

One row represents an exclusion in a target campaign context. An inventory-only row represents an exclusion with no relevant active campaign. Retain:

- Organization/account/run references and a stable item key derived from exclusion resource identity plus target context.
- Item kind: keyword negative or brand exclusion; exact text when applicable; match type; source scope; resource identity; list/attachment context; and all affected campaign IDs.
- Target campaign/channel and ad-group context when applicable. The same shared negative may have different evidence in different campaigns.
- Known and possible overlapping blockers, and whether blocker coverage is complete enough to assess.
- Historic evidence aggregates, selected conversion-action breakdown, observed dates, and explicitly labeled query samples.
- Provenance: legacy/unattributed by default, with a source decision/rule reference only when a trustworthy ledger actually exists.
- Inferred category, competitor likelihood, semantic confidence, value class, score components, evidence confidence, recommendation, and bounded explanation.

Use typed columns for fields needed by filtering/sorting and schema-validated JSONB for the bounded evidence and attachment structures. Store the complete aggregates used in scoring; any capped query list is a labeled sample, not the input from which a different total is inferred. Avoid a separate table for each metric or each LLM response field.

All new records use organization-aware foreign keys, forced RLS, and existing transaction-scoped organization context. Enforce one active run per account and unique run/item identities. The web role can change configuration, create requests, and record dispatch metadata; the worker can claim/finalize requests and write result rows. Completed results and captured policy/evidence are immutable. The browser never writes a computed score or result status.

## 5 Run state and failure handling

Persist five lifecycle states: `pending`, `running`, `succeeded`, `partial`, and `failed`. Display **Starting** for pending and **Completed** for succeeded. Measurement readiness and recommendation type are separate fields; an Amber account can still have a successfully completed report.

Handle these failure windows explicitly:

1. **Repeated clicks or HTTP retries:** the same idempotency key and payload resolve to the same run. A different payload with that key is rejected. The database's one-active-run constraint prevents two employees from starting paid work twice for the same account.
2. **Saved request, failed launch:** retain a visible failed start. The account can remain enabled; its latest report says that no analysis completed. Retry creates a new request after a definite rejection, or redispatches the same pending request if launch acceptance is uncertain.
3. **Launch timeout or lost response:** leave the request pending with an uncertain dispatch outcome. Retrying that run ID is safe because only one worker can claim it. A launch error must not overwrite a worker that has already moved the row to running.
4. **Duplicate Cloud Run executions:** claim `pending -> running` with one conditional database operation. Only the winner reads Google Ads or calls the LLM; other executions exit. The claim and all worker writes are bound to the winning execution identity. The worker records that identity as the authoritative execution reference; a delayed launch response must not replace it after the run starts.
5. **Worker crash:** retain completed item batches and heartbeat information. Show stale progress after five minutes without a heartbeat; this is an uncertainty signal, not proof of failure. Before permitting a new paid run for a stale active request, the explicit retry command checks its recorded Cloud Run execution. Terminal failure finalizes it as partial or failed; an execution still active or unavailable remains visible for investigation.
6. **Some sources or model batches fail:** retain valid results, record the missing coverage, and finish partial. Results that depend on missing blocker inventory cannot be labeled potential pilot.
7. **No exclusions or no historic matches:** complete normally and explain the finding. Missing history is not a zero-performance finding.
8. **Database failure:** fail the job; local files cannot substitute for a saved report. The portal retains the prior durable state and shows stale progress until execution status is reconciled.

Use the existing bounded HTTP/provider retries inside the worker. Set whole-task automatic retries to zero initially to avoid repeating a partially paid analysis without a resume design. A completed, partial, or failed analysis rerun creates a new report; it does not edit the original.

No outbox service or automatic dispatcher is needed for the initial interactive flow. The durable run row plus explicit retry covers a failed launch, including a web-process crash between commit and dispatch. This choice means a saved request is not guaranteed automatic execution after such a crash; the UI must expose retry. Add a dispatcher only if unattended eventual execution becomes a requirement.

## 6 API and access contract

Use account-scoped, same-origin endpoints under the existing server architecture. Proposed routes are:

- `GET /api/accounts/:accountId/volume-recovery` for configuration, latest status, and bounded report history.
- `PUT /api/accounts/:accountId/volume-recovery` for validated configuration, expected revision, and an idempotency key. An off-to-on transition creates the first request transactionally.
- `POST /api/accounts/:accountId/volume-recovery/runs` for an explicit rerun or safe retry of an existing pending launch. Return the active run when one already exists; never create competing work.
- `GET /api/accounts/:accountId/volume-recovery/runs/:runId` for paginated report rows and status.
- `GET /api/accounts/:accountId/volume-recovery/runs/:runId/export` for CSV from the same stored report.

Derive organization, actor, role, visible account, Google customer ID, and cloud target on the server. The browser supplies no Google Ads resource identity, cloud job name, model, raw prompt, tenant identifier, or mutation flag.

Use the D-061 cost-bearing command permission: Owner/Admin or an assigned Account Manager can configure/start. Reuse the current account sweep-evidence read predicate for viewing/export; export must never widen visibility. Validate permissions on every request, including a CSV URL reused after an employee loses access.

Keep five-second-to-ten-second browser polling while an active report is visible, using the existing refresh convention and stopping at a terminal state or when the page is hidden. Choose ten seconds if no reusable convention applies. Status reads do not launch work. No WebSocket, server-sent events, notification feed, or completion email is required.

## 7 Worker analysis stages

### Stage 1 Resolve the account and capture policy

Claim one persisted request and resolve its active `client_accounts` mapping in the configured organization. Verify Google Ads accessibility. Load the compiled negative policy and recovery overrides pinned to that request by immutable revision/hash. A mismatched account or inaccessible customer fails safely.

Recovery must work for accounts that have never run Keyword Sweeper. Do not require `runs/`, a normal sweep decision, the 30-day baseline-completion file, or membership in the daily-sweep master list. The configured account mapping and authorized request are the selection authority.

Default analysis scope is all enabled, non-removed Search and PMax campaigns in that account. Inventory exclusions from paused/other contexts as applicable, but label them outside the active recommendation scope. Preserve delivery-status diagnostics rather than hiding low-volume campaigns through the normal sweep's serving filter. Do not silently inherit its campaign-name filter. Display the resolved scope in the report.

### Stage 2 Profile conversion measurement automatically

Read conversion-action metadata, category/type, primary or secondary treatment, goal configuration, reported values, conversion ownership, and available import diagnostics. When conversion tracking is owned by a manager account, resolve that ownership and permissions before declaring the customer has no meaningful actions.

Choose a measurement basis from the evidence hierarchy: reported sales/qualified leads; meaningful value; raw forms/calls; demand only. Preserve action-by-action facts. Do not add a form, call, direction request, and YouTube engagement together and call the sum qualified leads. Where several actions may describe the same lead, label conversion events rather than unique people and prefer the highest supported funnel stage.

Use metadata and diagnostics for Green/Amber/Red readiness; attach a reason to every label. Green means the available measurement is suitable for the stated ranking basis, not verified CRM truth. A generic imported action named Phone Call remains uncertain unless its category/source or retained account override establishes a more specific meaning. LLM confidence alone cannot promote it to qualified revenue evidence.

This profiling is automatic across accounts. Ask a human only about a valuable unresolved ambiguity or an account override, rather than requiring 60 manual questionnaires. A missing API diagnostic stays unavailable; do not assume that every Google tag or Data Manager UI warning can be reproduced through the Ads API.

### Stage 3 Inventory current exclusions

Read campaign negatives, ad-group negatives, account negatives, shared-list contents and attachments. Inventory brand exclusions separately. Retain exact provider resource identity, scope, match type, current attachment fan-out, and collection time.

The existing direct negative manager combines reads with mutation code and covers only part of this scope. Reuse a safe read parser where useful, but add dedicated collectors through the read client rather than importing its writer-bearing manager into the recovery worker.

Record coverage per source. A permission error or unsupported brand representation produces a partial inventory with explicit uncertainty; it cannot become a confident claim that no other blocker exists.

### Stage 4 Collect historic served-query evidence and context

Default to a 90-day inclusive evidence window ending two calendar days before collection in the account timezone. Show the exact dates. Also derive comparable recent and preceding 30-day campaign summaries where coverage exists. Two days reduces reporting immaturity; it does not settle all conversions. Retain known conversion lag and label recent cohorts provisional.

Use Search's search-term reporting and PMax's campaign search-term reporting separately. PMax keyword negatives affect its Search/Shopping inventory, so query findings cannot be presented as evidence of recovering volume across every PMax channel. Fetch base traffic/cost and conversion-action breakdowns in compatible, separate queries when necessary; joining action-segmented rows must not multiply clicks or spend. Validate query/field compatibility against the configured Ads API version before implementation is considered complete.

Collect campaign budgets, bid/serving status, goal changes and available recent change context as supporting evidence. Change-history coverage can be shorter than the performance window. Budget restrictions, tracking problems, and bidding changes are alternative explanations for low volume; a report must not assign causation to negatives from a before/after chart alone.

Stored Ads Manager facts may supply a context comparison when their scope, attribution basis, dates, and freshness match. Historic query evidence must be independently available from Google Ads or a verified compatible snapshot. No Sweeper history is assumed.

### Stage 5 Link exclusions to observed queries and blockers

Match exact, phrase, and broad negatives using documented negative-keyword semantics, scoped to the campaign/ad group and attachment set. Do not reuse positive-keyword close-variant matching or a loose substring classifier. Treat brand exclusions and uncertain matching as separate coverage concerns. Google-side spelling/symbol behavior that cannot be reproduced reliably is marked possible rather than asserted as a known blocker. [Negative keyword behavior](https://support.google.com/google-ads/answer/2453972).

For each finding, retain the set of other exclusions that would still block the observed query. Removing one exact negative may have no effect while an account or shared-list negative remains. Broad/phrase negatives can also block unobserved queries, so their observed historic traffic is only part of their potential effect.

Store historic metrics as observed served-query evidence. Call them pre-exclusion only if a reliable timestamp and source establish that sequence. Current negative resources do not automatically reveal their original author, rule, or creation date. Set original source rule/decision to null for legacy records; keep any inferred category in its own field.

Overlapping negatives can link to the same historic query. Deduplicate the source metrics before aggregation and do not sum candidate rows into a forecast of recovered account leads.

### Stage 6 Classify intent with the existing LLM provider

Use the current provider adapter and bounded batches with a separate recovery prompt and strict output schema. The model identifies intent/category, competitor likelihood, confidence, and a short explanation. It can infer competitor terms without a hand-curated list; ambiguous names can remain uncertain.

Send only the minimum relevant account/campaign/query and policy context. Treat advertiser names, search terms, and historical text as untrusted data. The model receives no execution tools and does not calculate financial metrics, invent demand, or grant an exception to account policy. Validate item IDs, allowed categories, confidence bounds, and completeness. A failed batch leaves reviewable unclassified items and a partial report.

Reuse the rule taxonomy and existing approved per-account services/aliases where present. An inferred competitor label is a recommendation input, not proof that competitor traffic will convert profitably.

### Stage 7 Apply account policy and rank business evidence

Apply the account category mapping, coverage/measurement limitations, and scope risk. Separate retain, manual review, potential future pilot, and insufficient-evidence findings. An LLM must not override a retain policy.

Potential future pilot is limited initially to a direct campaign exact negative with relevant commercial evidence, complete blocker assessment, no remaining known blocker, suitable measurement, and no account veto. A legacy item can qualify for review without Sweeper provenance, but missing exclusion history lowers confidence. Shared-list, account, ad-group, phrase, broad, and brand exclusions stay outside the initial pilot cohort.

### Stage 8 Publish one durable report

Persist validated item batches, then finalize counts, source coverage, measurement profile, immutable policy/score context, and status. A succeeded status requires all mandatory collection and classification work to be accounted for. The presence of useful rows does not convert a partial report into success.

Ads Manager reads the completed snapshot. It does not reconstruct a previous recommendation using today's rules or silently refresh its historic figures.

## 8 Ranking specification for review

Rank within an account, channel, and comparable goal basis. Never compare raw currency values across different accounts or mix PMax campaign-wide conversions with query-level Search performance.

Use value classes in this order inside each recommendation group:

1. **A:** reported qualified leads, converted leads, sales, or actual revenue attributable to the observed query evidence.
2. **B:** meaningful conversion value and an established interpretation/efficiency basis, without the stronger Class A outcome evidence.
3. **C:** raw conversion events and CPA, with lead quality unconfirmed.
4. **D:** historic clicks with insufficient meaningful conversion evidence.
5. **E:** impressions only, or no usable served-query evidence. Missing evidence is distinguishable from observed zero outcomes.

Classes D/E are research findings. Aggregate account-level qualified results cannot upgrade a query into Class A when query/action attribution is unavailable. Constant placeholder values such as one unit per form do not turn a raw lead into trusted monetary value.

Keep the agreed weighting: 40 points quality/value, 25 efficiency, 15 supporting conversions, 10 observed demand, and 10 recency/stability. The following deliberately simple normalization is a proposed scoring version 1, to review against labeled examples before release:

- **Quality/value, 0–40:** for a qualified-lead goal, `40 × min(qualified events / 4, 1)`. For a revenue goal, `40 × min(observed ROAS / configured target ROAS, 1)`. Class C and demand-only rows get no invented quality points. Without a valid value target or outcome mapping, use the lower evidence class.
- **Efficiency, 0–25:** for a lead goal, `25 × min(target CPA / observed CPA, 1)` using the same selected conversion basis. For a revenue goal, use the equivalent observed-to-target ROAS ratio. Use the existing account target only when it applies to this goal; otherwise show this component unavailable and award no unearned points. Do not renormalize missing components into a higher score.
- **Supporting conversions, 0–15:** `15 × min(selected conversion events / 4, 1) × min(supporting clicks / 30, 1)`. This is evidence strength, not a statistical probability.
- **Observed demand, 0–10:** `10 × min(supporting historic clicks / 50, 1)`. An impression-only row receives no click points; its impressions remain visible in Class E.
- **Recency/stability, 0–10:** five points if supporting evidence exists in the last 30 days, plus `5 × min(number of distinct completed weeks with selected conversion evidence / 3, 1)`. Use the account calendar. Older evidence remains visible with reduced freshness; reduced freshness is not proof that current demand has disappeared.

Store the raw inputs, unavailable flags, exact component values, rounding rule and scoring version. Use exact decimal arithmetic for cost, fractional conversions, CPA and ROAS; round only for presentation. Zero denominators produce unavailable ratios. Do not treat these thresholds or an LLM confidence score as validated probabilities, and do not implement a score threshold that authorizes removal.

The constants above belong to one small versioned scoring function, not a user-configurable scoring engine. Human review can change the account policy or conversion interpretation; changing scoring mathematics requires a reviewed score version.

## 9 Fictional walkthrough of the completed flow

**Every account name, term and metric in this walkthrough is fictional.** Example Collision Repair has never used Keyword Sweeper. There are no previous runs, original source rules, or mutation records available.

1. An authorized manager enables recovery. Ads Manager stores enabled configuration and request `R1`, commits, launches the private recovery job, and immediately shows Starting.
2. The worker claims R1. Its automatic conversion profile finds raw form leads and a generically named imported call action whose quality is unclear. It marks readiness Amber and uses the clearly interpretable raw form action as Class C evidence.
3. The worker inventories direct, ad-group, account and shared exclusions, plus separate brand settings. It maps all relevant campaign attachments before ranking.
4. A Search campaign has `[riverton collision repair]`, a legacy direct exact negative. Available historic evidence is 520 impressions, 38 clicks, $304 spend and 3 raw form conversion events. The LLM identifies likely competitor/service intent. Assume, for this example only, a matching account target CPA of $85, recent supporting evidence, and conversion evidence in two completed weeks. Observed CPA is $101.33; components are 0, 20.97, 11.25, 7.60 and 8.33: approximately **48/100, Class C**. The outcome remains manual review because the measurement/legacy-history uncertainty is unresolved.
5. A PMax campaign has `[collision repair estimate]`, with 640 historic impressions, 46 clicks, $414 spend and 4 raw form events. It appears in the PMax section as separate query evidence. Its historic CPA of $103.50 does not establish incremental future leads or an effect on PMax's other inventory.
6. `"cheap body repair"` appears on a shared list attached to five campaigns, with 2,300 historic impressions, 113 clicks, $678 spend and zero selected lead events. The report shows the five-campaign impact and retains it under this account's policy; it is outside the initial pilot scope.
7. `auto body repair jobs` is an account broad negative. This account's employment-intent policy says retain, so demand metrics cannot promote it.
8. If another phrase/shared negative also covers the Riverton query, its row shows that remaining blocker and is ineligible for the first pilot cohort. It is not described as independently releasable.
9. The worker saves the report. Ads Manager shows Completed or Partial according to actual source coverage. Downloading CSV reads this same R1 snapshot. Google Ads remains unchanged.

This reproduces the intent of the earlier mock while stating the additional scoring assumptions needed to calculate its illustrative 48-point result.

## 10 Report and CSV

At the top of the existing account workspace show enabled state, last requested/completed time, analyzed dates, progress or safe error, measurement readiness with reasons, and coverage. Offer the enable switch, Run again/Retry as appropriate, and Download CSV when rows or a meaningful empty report exist.

Keep Search and PMax separate using the current tab/filter convention. Start with a paginated table and filters for recommendation, channel, scope/match type and search text. An expanded row shows evidence dates, selected conversion basis, score components, all known/possible blockers, affected campaigns, provenance, and a plain explanation. Show unavailable, partial and stale values explicitly. Do not promise an incremental conversion forecast.

Generate CSV from the authorized database snapshot on demand. Use the run ID to keep it consistent with the screen. Include account/campaign identity, channel, dates/as-of time, negative text, scope, match type, recommendation, selected historic impressions/clicks/spend/conversion events/CPA/value, value class, confidence/coverage flags, and a short client-safe reason.

Keep internal target thresholds, full policy text, cross-account competitor relationships, employee commentary, provider payloads, cloud identifiers, and internal error details out of the shareable CSV. CSV quoting and spreadsheet-formula neutralization must cover untrusted text; preserve long IDs as text. Blank means unavailable, while a numeric zero means an observed zero. The export is a report, not a file that can be uploaded to a mutation executor.

Stream complete rows server-side with existing pagination/batching. If a practical export limit is required, return a clear limit/error rather than silently dropping rows. A CSV of a partial run must identify its partial status. An empty completed report still has a meaningful status/coverage row.

## 11 Runtime and cost defaults

Deploy a dedicated private Cloud Run Job, proposed name `negative-keyword-volume-recovery`, from the same repository/runtime as Sweeper. Use a separate entry point, `src/volume-recovery.ts`, that accepts only a persisted run ID. A bare invocation fails with usage help. The deployed environment fixes mutation mode to disabled, and the recovery dependency graph contains no writer or email-delivery stage.

Use the existing private database network path, Secret Manager pattern, and current provider. Restrict the web identity to launching this job with controlled argument overrides; retain execution-read permissions needed for explicit stale-run reconciliation. The job identity receives only its required read sources and recovery persistence grants. No public URL or copied service-account key is required.

Initial operational defaults are one account per execution, one Cloud Run task, a 30-minute task timeout, no whole-task automatic retry, a one-minute heartbeat, and one LLM batch in flight per execution. Use the existing provider retry budget and bounded Google Ads reads. Keep raw-row/model-batch/time limits explicit and mark incomplete work partial; never hide a candidate cap inside a success status.

Allow at most three active recovery requests per organization initially, enforced in the request transaction under the existing advisory-lock pattern. A fourth start returns a clear busy response without accepting work; an enabling transaction rolls back so the switch remains off. Terminal requests free capacity. The same-request replay does not consume another slot. Per-execution task parallelism alone would not limit 60 independent executions, so it cannot substitute for this small admission check.

Start with individual account controls. Automatic profiling handles the substance of the 60-account workload; no account needs a mandatory manually written business profile. Bulk launch, a global queue, portfolio scheduling, and a quota orchestration service are deferred until actual use justifies them.

## 12 Expected code and documentation changes

These are proposed module locations, to follow the approved branch's exact naming during implementation.

In Keyword Sweeper:

- `src/volume-recovery.ts`: strict request-ID entry point and read-only runtime setup.
- `src/volume-recovery/`: collection orchestration, documented blocker matching, measurement profile, ranking, and a recovery-specific model prompt/response validator. Use a few cohesive modules; avoid a new framework or plugin system.
- `src/storage/postgres/`: recovery request claim, heartbeat, batch persistence and finalization using existing organization-context conventions.
- `src/google-ads/`: new read collectors where current Search/PMax/client helpers are insufficient. Preserve distinct channel parsing.
- `test/`: small synthetic tests for matching, conversion profiling, exact scoring, malformed model responses, partial collection and duplicate claims. Reuse the existing fake HTTP/provider transport style.
- `package.json` and deployment configuration: one recovery command and a dedicated job deployment path using the existing image/build approach.
- This plan, architecture/deployment docs and README: document the approved flow and actual release evidence at implementation time.

In Built Ads Manager:

- `packages/db/migrations/`: the next collision-free forward migration for account configuration, two tables, indexes, RLS, grants, immutability and audited command support. Do not guess the migration number from the older integration plan.
- `packages/domain/`: serialized request/status/report and validated policy contracts.
- `packages/api/src/keyword-sweeps/`: account-authorized recovery commands, reads, export and PostgreSQL adapter. Reuse existing session, visibility, revision and idempotency conventions.
- `apps/web/src/server/keyword-sweeps/` and thin route delegates: same-origin transports and the small recovery Cloud Run launch adapter.
- The existing account Policy & automation feature: configuration, live status, report rows and download using canonical components.
- `docs/product/scope-ledger.md`, `decisions.md`, architecture, API/UI contracts, acceptance matrix, operations, what-we-use and status: admit and explain precisely this read-only workflow and CSV exception. Update the applicable design composition rather than adding a new design system.

No changes to the existing normal-sweep decision meanings, reviewed keyword writer, account ingestion scheduler, or older classification-intent lifecycle are required.

## 13 Delivery sequence and exit criteria

### Phase 1 Agree the contract and prepare persistence

Review this plan, record the narrow recovery/CSV product admission in Ads Manager, and create linked implementation work under DEV with both repository labels where appropriate. Keep DEV-13 as completed research. Settle the defaults listed in Section 16 and align the approved manual/policy source revisions.

Prepare the migration, shared serialized contract and synthetic sample report. The exit proof is an isolated PostgreSQL test demonstrating configuration revision handling, tenant/account isolation, unique active requests, immutable terminal results and the CSV field boundary.

### Phase 2 Complete one offline vertical slice

Build the worker against injected Google Ads/model fixtures and persistence; build the portal transports and account UI against the same fake report. Exercise enable -> pending -> claim -> result -> poll -> CSV, including a duplicate launch and a saved request with a failed start. No live provider is needed to prove this workflow.

The exit proof is one end-to-end synthetic account, with the fictional legacy mock and its exact score reproducible from stored inputs. Existing manual-sweep and reviewed-keyword tests must continue to pass.

### Phase 3 Connect supported read sources

Implement all inventory scopes and supported conversion/query reads using the configured Ads API version. Confirm field compatibility and legacy-account behavior. Test Search/PMax segregation, conversion ownership, missing history, hidden query coverage and overlapping blockers. Keep unknown data explicit.

The exit proof combines mocked transport coverage with a separately authorized one-account read-only validation of API availability, source counts, meaningful evidence mapping and model output. If a required source is inaccessible, ship that coverage as partial or resolve the gap before calling inventory complete.

### Phase 4 Review and deploy a small account cohort

Run the repository checks and targeted database/security/UI tests. Verify desktop, laptop/tablet and 390px layout, keyboard/focus behavior, progress/error states and exported CSV. Use independent review where the Ads Manager shell/dialog contract requires it.

After release approval, apply the forward migration, deploy the worker, and deploy the portal behind its default-off feature flag. Enable one named account, then a small named cohort. Reconcile the request, cloud execution, saved rows, status and export. Measure duration, model usage, ambiguous conversion mappings and partial-source rates before broader use.

There is no Google Ads mutation pilot in these phases.

## 14 Verification checklist

The required evidence is proportional to the behavior, with targeted tests for:

- Authorization, tenant isolation, direct run/export URL access, revoked access and archived accounts.
- Atomic configuration/request persistence, optimistic revision conflicts, duplicate clicks, concurrent users, organization admission limit and replay with a different payload.
- Launch rejected, launch accepted but response lost, web crash before dispatch, worker crash, duplicate worker, stale execution and database unavailable.
- An account with no Sweeper history, no 30-day baseline and no daily master-list entry.
- All negative scopes, shared-list fan-out, literal exact/phrase/broad semantics, unsupported matching uncertainty, brand separation and remaining blockers.
- Search/PMax attribution, query/action segmentation without multiplying spend, manager-owned conversions, ambiguous imported calls, duplicated funnel actions, flat values, and null/zero distinctions.
- Exact money/fractional-conversion arithmetic, zero denominators, policy vetoes before recommendations, score reproducibility and no double-counted recovery forecast.
- Bounded model responses, missing/duplicate item IDs, unknown categories and prompt-injection-shaped advertiser text.
- Immutable report snapshots, partial and empty exports, complete server paging, quoting/formula safety and exclusion of private fields.
- No mutation transport imported by the worker, mutation-enabled configuration rejected, no live validation/mutate request, and no email stage triggered.

At implementation handoff run `npm run check`, `npm test` and `npm run build` in Sweeper. Add `npm run rules:check` if rule-release/account-policy compilation changes. In Ads Manager run `npm run docs:check`, `npm run check`, `npm run build` and the relevant targeted tests plus scope-lock checks. Synthetic tests establish workflow and arithmetic correctness; a model evaluation and a live read-only source check establish different evidence and must be reported separately.

## 15 Release and rollback

Deploy database preparation before code that requires it; deploy the worker before enabling the portal start path. Record the exact migration/image/application revisions and least-privilege grants. Use existing environment separation and the account/pilot data policy when choosing an approved runtime; do not copy live client records into local or staging fixtures.

Rollback disables new starts through the feature flag, allows accepted read-only work to finish where practical, and returns to the last reviewed worker/web images. Retain requests, reports and audit history. Prefer a forward schema correction to a destructive down migration. Recovery changes no Google Ads state, so there are no Ads resources to undo.

Do not promise a completion-time SLA before the one-account and cohort measurements. Publish progress stages and actual timestamps instead of an invented percentage or estimated lead lift.

## 16 Proposed defaults for Shah review

The following choices make the first release concrete without introducing a configuration framework:

1. Enabling starts one review; subsequent reviews are explicit. Switching off does not cancel accepted work.
2. The worker writes directly to shared PostgreSQL; the portal polls and exports that snapshot. There is no callback or separate message queue.
3. Use a dedicated recovery job from the Sweeper repository and the existing server-side Cloud Run launch pattern.
4. Analyze all enabled Search/PMax campaigns for the selected mapped account, independently of normal sweep history and gates.
5. Use a 90-day history ending account-local today minus two days, with conversion-lag/coverage caveats.
6. Keep the 40/25/15/10/10 weighting with the explicit proposed normalization in Section 8. Review the four-event, 30-click and 50-click evidence constants against labeled examples before finalizing scoring version 1.
7. Configure/start with the current Owner/Admin or assigned Account Manager rule; reuse existing sweep-evidence visibility for reads/export.
8. Export one client-safe CSV from the saved report. PDF/XLSX generation, scheduled reports and client logins are outside this release.
9. Start with three active requests per organization, one model batch per execution and a 30-minute task limit. Add automatic dispatch only if the manual retry tradeoff is unacceptable in actual use.
10. Future negative removal, positive-keyword changes, automated policy relaxation, bulk apply and reconciliation with later normal sweeps require a subsequent implementation plan.

## 17 Source references and boundaries

Repository foundations include [Sweeper architecture](ARCHITECTURE_DECISIONS.md), [shared database ownership](SHARED_DATABASE_AND_ADS_MANAGER_INTEGRATION_PLAN.md), [account policy proposal](ACCOUNT_SPECIFIC_POLICY_COMPILATION_PLAN.md), the current Google Ads client/search-term/persistence modules, and Ads Manager's current AGENTS, scope ledger, D-060/D-061, D-104/D-105, AD-021 and manual Cloud Run gateway. The older account-policy document is a proposal; it does not replace Ads Manager's newer approved database-owned policy contract.

Google's documentation supports the batch job/launch design and documented negative matching. Field availability for conversion diagnostics, all exclusion scopes and query/action segmentation must be verified against the actual configured Ads API version in Phase 3. Historic served-query evidence never guarantees the traffic or conversions that a removal would recover. Search-term privacy limits and exclusions installed before the available history may leave no useful evidence.

Implementation is tracked by DEV-52 (Keyword Sweeper) and DEV-53 (Ads Manager). Source implementation and offline verification are authorized. Deployment, shared-database migration execution, live provider execution and Google Ads mutations remain separate operations.

## 18 Implementation handoff — 15 October 2026, iteration one

### Review findings and disposition

Independent review found five source defects: status polling could bypass a
draft revision; pre-claim failures could remain pending; resource-order action
selection could discard qualified evidence; delayed pagination could replace a
new review; and archived pending requests could consume capacity. All five
were fixed and rechecked. Responsive review also fixed unstyled controls,
narrow-column evidence and tablet space loss. No further actionable issue was
found in the inspected source/screenshots. This is not release approval.

### Delivered versus remaining

DEV-52 and DEV-53 are **Work in progress**. This is the first local vertical
slice, not the entire approved feature. No code was pushed, merged or deployed.
No database migration/grant/repair, Cloud Run execution, Google Ads call or
mutation, or LLM provider call was performed. Original dirty checkouts were
preserved; feature branches start from fetched origin/main.

Remaining source work: delivery/budget/bidding/change context, full blocker and
list-attachment detail, and configured meaningful-value/ROAS/Class B ranking.
The current collector explicitly marks delivery context unavailable, making
actual reports partial. Revenue does not earn invented quality/efficiency
points. Matching, privacy/attribution gaps, uncalibrated constants and unknown
legacy origin remain limitations, not probabilities or removal authority.

Release still requires approved disposable PostgreSQL migration/RLS/grant and
concurrency/crash rehearsal, read-only GAQL/model compatibility, separate Cloud
Run/IAM setup and durable authenticated portal flow proof.

### Evidence actually run

- Sweeper: typecheck and build passed; full suite **196 passed, one existing
  PostgreSQL integration test skipped** (197 total); 13 focused recovery cases.
- Ads Manager: all five workspace typechecks and **960 tests passed** (web 465,
  worker 91, API 236, database 68, domain 100); optimized workspace build passed.
  The unconfigured build logged sanitized app-context/static-policy failures
  while prerendering safe states; build success is not live connection proof.
- Docs check, four-case QA specification check, git whitespace review and
  migration source verification passed. The verifier reports 41 reversible
  migration files and applies no SQL. Contract mirrors are byte-identical.
- Fixture browser: exact local origin, synthetic account, disabled write/run
  controls; layout at 1440/1280/768/390/320px; filter empty/restore; native
  click disclosure, visible focus and complete trusted Enter activation.
  Independent reviewer inspected the current screenshots. Delayed UI race
  checks assert source guards, not actual browser timing.
- Network showed no Ads/LLM/Cloud Run/recovery-command call. Existing Google
  Fonts and extension instrumentation loaded; favicon 404s/dev-stack traffic
  were recorded as environment noise. No credentials or durable data created.
- Ponytail kept the existing PostgreSQL, Cloud Run and model transport; no
  dependency, callback service, queue, scheduler or general reporting system.

### File-by-file change report

All links identify the isolated implementation worktrees. Source commits are
local feature-branch work; schema/grant files are preparation only.

#### Keyword Sweeper — feature/dev-52-volume-recovery

- [README.md](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/README.md) — Change/why: Links the approved recovery plan and handoff so operators can find the separate read-only workflow. Effect: Documentation only; normal sweep entrypoints are unchanged. Risk/follow-up: Do not treat the local implementation as deployed. Verified: Link inspection and diff review.

- [package.json](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/package.json) — Change/why: Adds the recovery CLI script using the installed TypeScript runner. Effect: Local explicit entrypoint; no dependency or lockfile change. Risk/follow-up: Never run it with live configuration without separate approval. Verified: Typecheck, full tests and build.

- [src/llm/moonshot-classifier.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/llm/moonshot-classifier.ts) — Change/why: Exposes the existing authenticated structured-response transport for recovery; retains reported usage for invalid JSON. Effect: Normal classifier behavior stays unchanged; recovery has its own schema. Risk/follow-up: Transport responses and real provider/schema compatibility are unverified. Verified: Existing Moonshot adapter tests plus recovery tests and typecheck.

- [docs/VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/docs/VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md) — Change/why: Captures the accepted plan and this file-by-file implementation handoff. Effect: Documents first-iteration progress, release gaps and unchanged safety boundaries. Risk/follow-up: This progress appendix is not a deployment or complete-feature claim. Verified: Source/plan comparison and handoff inventory check.

- [src/volume-recovery.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery.ts) — Change/why: Adds the UUID-only worker entrypoint and mutation-disabled/persistence/execution checks. Effect: Constructs only read-only Ads collection and bounded Moonshot-compatible classification; claims before external work. Risk/follow-up: Separate job must override the image command to node; other LLM providers are not supported here yet. Verified: CLI rejection tests, typecheck and build; entrypoint not run live.

- [src/volume-recovery/analysis.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/analysis.ts) — Change/why: Joins scoped historical evidence, caches blocker matching and ranks one supported observed outcome without summing funnels. Effect: Raw forms remain Class C; unknown provenance stays legacy; overlap/coverage/account vetoes restrict pilot labels. Risk/follow-up: Full blocker/list detail and value-target/Class B scoring remain follow-up; no score authorizes an action. Verified: Legacy mock, stronger-action selection, overlap, null and qualified-evidence tests.

- [src/volume-recovery/classifier.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/classifier.ts) — Change/why: Adds a recovery-specific untrusted-data prompt and strict ID/category/confidence/completeness validator. Effect: Model supplies semantic intent, not money, lead forecasts or execution decisions. Risk/follow-up: Only the existing Moonshot-compatible transport is admitted by this first adapter. Verified: Malformed/invented-output tests and typecheck; no provider call.

- [src/volume-recovery/contract.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/contract.ts) — Change/why: Defines strict contract v1, policy validation, safe item projection and action-level evidence. Effect: Keeps decimals as strings and unknowns null; no provider payload is exposed. Risk/follow-up: Must remain identical to the portal mirror; change both before release. Verified: Byte comparison against portal mirror; parser/policy regression tests.

- [src/volume-recovery/persistence.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/persistence.ts) — Change/why: Adds organization-scoped claim, heartbeat, append-only item batches, terminal finalization and archived-pending cleanup. Effect: Only the winning execution writes findings; policy snapshots are hashed and retained. Risk/follow-up: Mocked tests do not prove PostgreSQL locks, RLS or grants; real rehearsal is required. Verified: Duplicate/hash/lifecycle/archived regression tests and typecheck.

- [src/volume-recovery/pipeline.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/pipeline.ts) — Change/why: Orchestrates collect, bounded sequential classification, ranking, batch persistence and explicit partial/failure outcomes. Effect: Duplicate claims exit before Ads/LLM calls; invalid model output retains useful evidence and reported tokens. Risk/follow-up: Unexpected process termination needs the portal's execution-state reconciliation; no live crash test yet. Verified: Offline fake-store complete/partial/duplicate/hash tests and build.

- [src/volume-recovery/scoring.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/scoring.ts) — Change/why: Adds rational decimal scoring, account-local dates and conservative negative matching. Effect: No positive-keyword stemming/fuzzy expansion or renormalized missing points. Risk/follow-up: Punctuation/spelling ambiguity remains review-only; constants are uncalibrated ranking aids. Verified: Exact decimal, zero/null, timezone and exact/phrase/broad tests.

- [src/volume-recovery/sources.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/sources.ts) — Change/why: Adds bounded SELECT collectors for campaigns, all exclusion scopes, manager-owned actions/goals and Search/PMax query/action facts. Effect: No Sweeper history or normal campaign-name/30-day gate is required; gaps become explicit coverage flags. Risk/follow-up: Live GAQL compatibility is unverified; delivery/change context is deliberately flagged missing so actual reports remain partial. Verified: Synthetic SELECT-only/manager-owner/source-failure tests, typecheck and build.

- [test/volume-recovery.test.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/test/volume-recovery.test.ts) — Change/why: Adds 13 offline recovery regressions using synthetic legacy account evidence. Effect: Tests no-history assumptions, money, semantics, source gaps, action selection and claim behavior. Risk/follow-up: Mocks/source assertions are not provider or real database proof. Verified: All 13 targeted cases and the full suite passed.

#### Ads Manager — feature/dev-53-volume-recovery

- [apps/web/AGENTS.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/AGENTS.md) — Change/why: Next.js regenerated its instruction heading to its current canonical level during local dev. Effect: Instruction substance is unchanged; generated change is retained as required by the existing contract. Risk/follow-up: No Next/package upgrade was introduced by this edit. Verified: Diff inspection; installed Next guides were read.

- [apps/web/app/(authenticated)/accounts/[accountId]/keyword-sweeps/page.tsx](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/app/(authenticated)/accounts/[accountId]/keyword-sweeps/page.tsx) — Change/why: Composes recovery inside the existing authorized account policy route. Effect: Existing policy/evidence sections remain; preview receives only synthetic recovery fixtures. Risk/follow-up: Live authorized account loading remains an integration gate. Verified: Web typecheck/build, scope lock and fixture browser inspection.

- [apps/web/src/scope-lock.test.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/scope-lock.test.ts) — Change/why: Admits only the four D-114 route files. Effect: Retired general reporting and other routes remain locked out. Risk/follow-up: Any new endpoint still needs scope admission. Verified: Full web scope-lock tests passed.

- [apps/web/src/server/accounts/account-policy-workspace-route.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/server/accounts/account-policy-workspace-route.ts) — Change/why: Recognizes the volume-recovery section. Effect: Uses the existing account route parser and canonical redirects. Risk/follow-up: Does not add a new page or arbitrary query surface. Verified: Existing route tests, web typecheck/build and direct preview navigation.

- [apps/web/src/server/core/config.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/server/core/config.ts) — Change/why: Adds validated all-or-none separate recovery job configuration, absent by default. Effect: No configured target means no Cloud Run dispatch; manual-job reuse is rejected. Risk/follow-up: Actual IAM/job command/environment must be verified separately. Verified: Typecheck/build and gateway disabled/argument tests; no configured target was called.

- [apps/web/src/server/core/session.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/server/core/session.ts) — Change/why: Wires the recovery repository and execution gateway from authenticated server context. Effect: Tenant/actor and cloud target remain server-owned. Risk/follow-up: Requires prepared schema before any durable recovery use. Verified: Typecheck/build and repository/transport tests.

- [apps/web/src/ui/features/account-analytics/account-tabs.tsx](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/ui/features/account-analytics/account-tabs.tsx) — Change/why: Adds Volume Recovery to Policy & automation. Effect: Reuses existing keyboard/selection and mobile section-selector machinery. Risk/follow-up: Scoped recovery layout needs its documented responsive selector rule. Verified: Scope tests and independent desktop-through-320px screenshot review.

- [design-system/components.css](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/design-system/components.css) — Change/why: Adds canonical recovery spacing, full-row readable evidence and contained table prose. Effect: Recovery uses the existing section selector below 1200px; other account sections are unaffected. Risk/follow-up: Uses supported modern container sizing/:has; target-browser behavior needs deployed-flow proof. Verified: Desktop/laptop/tablet/390px/320px screenshots, geometry and independent review.

- [design-system/components.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/design-system/components.md) — Change/why: Documents the canonical recovery component extension rather than a parallel visual system. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [design-system/product-compositions.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/design-system/product-compositions.md) — Change/why: Documents recovery hierarchy, disclosures, table containment and under-1200px section selector. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/acceptance-matrix.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/acceptance-matrix.md) — Change/why: Adds D-114's offline evidence and explicit pre-release integration/source-work gates. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/api-ownership.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/api-ownership.md) — Change/why: Lists exactly the five operations across four account-scoped recovery route files. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/architecture.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/architecture.md) — Change/why: Documents shared-DB asynchronous delivery, claim/idempotency/capacity and responsibility boundaries. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/frontend-reconciliation-matrix.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/frontend-reconciliation-matrix.md) — Change/why: Records what is wired locally and what live durable evidence remains. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/operations.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/operations.md) — Change/why: Documents prepared-only migration/grants, absent target, future separate job command/IAM and rollback gates. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/product/decisions.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/product/decisions.md) — Change/why: Records accepted D-114 and its read-only exception without expanding Ads-write authority. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/product/scope-ledger.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/product/scope-ledger.md) — Change/why: Admits only the account recovery controls, request/report API, separate worker and CSV. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/security/threat-model.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/security/threat-model.md) — Change/why: Documents tenant authorization, untrusted model input, immutable evidence and safe export controls. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/status.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/status.md) — Change/why: Records this first source iteration, verified counts/review findings and remaining work truthfully. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/ui-contracts.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/ui-contracts.md) — Change/why: Documents mirrored v1 safe data types, decimals/nulls and browser concurrency boundaries. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [docs/what-we-use.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/what-we-use.md) — Change/why: Records reuse of existing services and that no new job/connection has been provisioned. Effect: Documentation only; this does not enable a runtime, deploy or apply a migration. Risk/follow-up: Keep release status distinct from passing offline checks; incomplete source/value/context work is explicit. Verified: Documentation validation, source comparison and independent review where applicable.

- [packages/api/src/index.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/api/src/index.ts) — Change/why: Exports the authorized recovery repository/API and gateway port. Effect: Keeps route composition inside the existing API package. Risk/follow-up: Exports alone do not enable a job or grant permissions. Verified: Workspace builds and typechecks.

- [packages/db/src/dev-runtime-grants.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/db/src/dev-runtime-grants.ts) — Change/why: Prepares web read/request/dispatch-only access to recovery tables. Effect: Web role cannot write computed item evidence. Risk/follow-up: Grant script was not executed; existing environment roles still need rehearsal. Verified: Grant statement unit test and typecheck/build.

- [packages/db/src/sweeper-runtime-grants.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/db/src/sweeper-runtime-grants.ts) — Change/why: Prepares worker read/claim/finalize/item-insert permissions. Effect: Worker cannot rewrite pinned request policy or delete recovery history. Risk/follow-up: Grant script was not executed; role ownership/RLS need a disposable test. Verified: Grant statement tests and typecheck/build.

- [packages/db/test/dev-runtime-grants.test.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/db/test/dev-runtime-grants.test.ts) — Change/why: Updates expected least-privilege grant strings. Effect: Protects web/worker responsibility separation at source level. Risk/follow-up: Text tests do not prove effective database privileges. Verified: Full database suite passed.

- [packages/domain/src/index.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/domain/src/index.ts) — Change/why: Exports the approved recovery contract. Effect: Callers use the existing domain package; no new dependency. Risk/follow-up: Consumers must deploy with compatible v1 schema/worker. Verified: Workspace builds and typechecks.

- [apps/web/app/api/accounts/[accountId]/volume-recovery/route.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/app/api/accounts/[accountId]/volume-recovery/route.ts) — Change/why: GET workspace / PUT settings thin Node route delegates to the shared strict transport. Effect: Keeps account/run identity in route params and disables caching. Risk/follow-up: Requires schema/session setup; no route was used against durable data. Verified: Web route typecheck/build, scope lock and shared transport tests.

- [apps/web/app/api/accounts/[accountId]/volume-recovery/runs/[runId]/csv/route.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/app/api/accounts/[accountId]/volume-recovery/runs/[runId]/csv/route.ts) — Change/why: GET terminal CSV thin Node route delegates to the shared strict transport. Effect: Keeps account/run identity in route params and disables caching. Risk/follow-up: Requires schema/session setup; no route was used against durable data. Verified: Web route typecheck/build, scope lock and shared transport tests.

- [apps/web/app/api/accounts/[accountId]/volume-recovery/runs/[runId]/route.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/app/api/accounts/[accountId]/volume-recovery/runs/[runId]/route.ts) — Change/why: GET authorized report page thin Node route delegates to the shared strict transport. Effect: Keeps account/run identity in route params and disables caching. Risk/follow-up: Requires schema/session setup; no route was used against durable data. Verified: Web route typecheck/build, scope lock and shared transport tests.

- [apps/web/app/api/accounts/[accountId]/volume-recovery/runs/route.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/app/api/accounts/[accountId]/volume-recovery/runs/route.ts) — Change/why: POST explicit run/check thin Node route delegates to the shared strict transport. Effect: Keeps account/run identity in route params and disables caching. Risk/follow-up: Requires schema/session setup; no route was used against durable data. Verified: Web route typecheck/build, scope lock and shared transport tests.

- [apps/web/src/server/keyword-sweeps/volume-recovery-execution.test.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/server/keyword-sweeps/volume-recovery-execution.test.ts) — Change/why: Tests disabled dispatch, exact args, launch uncertainty and execution-name/state restrictions. Effect: Uses fake fetch/token functions, not Google Cloud. Risk/follow-up: Does not prove ADC/IAM or a real job. Verified: All adapter tests passed.

- [apps/web/src/server/keyword-sweeps/volume-recovery-execution.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/server/keyword-sweeps/volume-recovery-execution.ts) — Change/why: Adds the bounded ADC Cloud Run v1 adapter and execution-state lookup. Effect: Only the persisted UUID is sent; no browser job args/customer/environment overrides. Risk/follow-up: Real IAM/v1 response compatibility and job identity are untested; unknown outcomes stay pending. Verified: Mocked adapter tests and web build/typecheck.

- [apps/web/src/server/keyword-sweeps/volume-recovery-transport.test.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/server/keyword-sweeps/volume-recovery-transport.test.ts) — Change/why: Tests request rejection before authorization and route-scoped private CSV. Effect: Uses stubbed authorized API; no network/provider call. Risk/follow-up: Not browser authentication or durable CSV export proof. Verified: All transport tests passed.

- [apps/web/src/server/keyword-sweeps/volume-recovery-transport.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/server/keyword-sweeps/volume-recovery-transport.ts) — Change/why: Adds strict same-origin private browser transport and safe CSV headers. Effect: Rejects tenant/actor injection, duplicate filters, oversized/unknown write fields. Risk/follow-up: Real authenticated sessions/CSRF journeys are still a deployed-flow gate. Verified: Transport tests, typecheck and build.

- [apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-fixture.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-fixture.ts) — Change/why: Adds the agreed synthetic legacy competitor example. Effect: No prior Sweeper data is assumed; preview controls cannot dispatch or save. Risk/follow-up: Fixture metrics/readiness are examples, not a real account or forecast. Verified: Fixture/SSR tests and browser inspection.

- [apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-panel.test.tsx](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-panel.test.tsx) — Change/why: Adds example-rendering and UI concurrency guard checks. Effect: Protects read-only labels, Class C evidence and draft/page guard presence. Risk/follow-up: Source assertions do not simulate race timing. Verified: Both panel tests and full web suite passed.

- [apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-panel.tsx](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-panel.tsx) — Change/why: Adds settings, explicit run/check, active polling, retained history, filters/pages, evidence and CSV link. Effect: Draft revision is independent of polling; late pages are generation-guarded; native disclosures remain keyboard operable. Risk/follow-up: Actual delayed/durable flows are not exercised by the preview; overrides remain explicit per account. Verified: SSR/source-guard tests, full build and fixture browser QA with independent visual review.

- [packages/api/src/keyword-sweeps/volume-recovery.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/api/src/keyword-sweeps/volume-recovery.ts) — Change/why: Implements roles, pinned requests, revision/idempotency, org capacity, dispatch/reconciliation, report pages and safe CSV. Effect: Commit precedes launch; stale or archived pending work cannot silently monopolize capacity; CSV excludes private policy/provider data. Risk/follow-up: DB concurrency/RLS and successful deployed CSV journeys remain unverified; report history is latest 20 runs. Verified: Ten offline API tests, full API suite, typecheck and build.

- [packages/api/test/keyword-sweeps/volume-recovery.test.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/api/test/keyword-sweeps/volume-recovery.test.ts) — Change/why: Adds ten fake-database command/permission/lifecycle/export-safety tests. Effect: Covers commit-before-launch, revisions, receipts, stale pending and archived cleanup. Risk/follow-up: SQL mocks assert control flow/predicates, not engine behavior. Verified: All ten targeted tests and full API suite passed.

- [packages/db/migrations/0047_volume_recovery.sql](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/db/migrations/0047_volume_recovery.sql) — Change/why: Prepares settings columns, run/item tables, RLS, immutable evidence, unique active request and receipt types. Effect: Requires an explicitly approved migration/grant rollout before runtime use; down migration refuses evidence loss. Risk/follow-up: Not applied or rehearsed; PostgreSQL RLS/trigger/rollback behavior is a release gate. Verified: Migration-source test and verifier: 41 reversible files, no SQL applied.

- [packages/db/test/volume-recovery-migration.test.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/db/test/volume-recovery-migration.test.ts) — Change/why: Checks recovery migration isolation, immutability, no-mutation invariants and loss-safe rollback declarations. Effect: Guards accidental removal of schema safety clauses. Risk/follow-up: Explicitly not a live SQL/RLS/concurrency test. Verified: Full database suite passed.

- [packages/domain/src/volume-recovery.ts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/domain/src/volume-recovery.ts) — Change/why: Mirrors recovery contract v1, strict policy/item validators and action evidence. Effect: Only safe declared fields cross the web boundary. Risk/follow-up: No persisted deployment yet; both mirrors must change together. Verified: Byte comparison, shared-contract regressions and full typecheck/build.

- [qa/agent-e2e/suites/accounts/volume-recovery.case.md](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/qa/agent-e2e/suites/accounts/volume-recovery.case.md) — Change/why: Defines the fixture-only recovery visual/filter/disclosure case. Effect: Observation only; real durable commands and providers are excluded. Risk/follow-up: Fixture proof must never substitute for release integration evidence. Verified: QA validator: four unique cases; case executed on the local preview.

### Generated local QA artifacts (not committed source)

Under [the local QA run](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/qa/agent-e2e/runs/volume-recovery-20261015/report.md):

- report.md: records target/safety, measured geometry, fixes, network noise,
  keyboard evidence and fixture-only verdict; reviewed against actual outputs.
- desktop.png: settings/control styling evidence; visually inspected.
- desktop-report.png: collapsed disclosure with visible keyboard focus; inspected.
- desktop-expanded.png: final full-width evidence at 1440px; inspected independently.
- laptop-report.png: expanded evidence at 1280px; inspected independently.
- tablet-report.png: corrected 768px selector/content layout; inspected independently.
- mobile-settings.png: stacked 390px controls; inspected.
- mobile-report.png: readable, container-bounded 390px evidence; inspected independently.
- narrow-report.png: 320px contained edge case; inspected independently.
- desktop-evidence.png: invalid element-capture diagnostic retained, explicitly
  not acceptance evidence.

Artifacts are synthetic local evidence and do not prove database, roles or
cloud behavior. Keep the worktrees/evidence until review; no cleanup or
production rollback has been performed.
