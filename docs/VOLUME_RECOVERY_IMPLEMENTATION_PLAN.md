# Volume Recovery implementation plan

Latest source handoff: [20 October evidence corrections](#22-evidence-corrections--20-october-2026).
Earlier integration verification: [19 October integration and review](#20-integration-and-verification-handoff--19-october-2026).
Main publication authorization: [code-only checkpoint](#21-code-only-main-publication--19-october-2026).

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
2. **Saved request, failed launch:** retain a visible failed start after a definite rejection. The account can remain enabled; its latest report says that no analysis completed. A later explicit run creates a new request. Unattempted pending work at `Starting` can be retried once through the durable dispatch fence.
3. **Launch timeout or lost response:** leave the request pending with an operator-check stage. Before any external start, atomically change `Starting` to `Requesting execution` and commit. Fenced, uncertain and known accepted attempts are never automatically relaunched. A late launch error cannot invalidate a known execution or worker claim. A pre-call process crash after the fence is also uncertain and retains the account/organization capacity slot until separately approved operator investigation/reconciliation. This conservative behavior supersedes the original same-run timeout redispatch proposal.
4. **Duplicate Cloud Run executions:** claim `pending -> running` with one conditional database operation. Only the winner reads Google Ads or calls the LLM; other executions exit. The claim and all worker writes are bound to the winning execution identity. The worker records that identity as the authoritative execution reference; a delayed launch response must not replace it after the run starts.
5. **Worker crash:** retain completed item batches and heartbeat information. Show stale progress after five minutes without a heartbeat; this is an uncertainty signal, not proof of failure. Before permitting a new paid run for a stale active request, the explicit retry command checks its recorded Cloud Run execution. Terminal failure finalizes it as partial or failed; an execution still active or unavailable remains visible for investigation.
6. **Some sources or model batches fail:** retain valid results, record the missing coverage, and finish partial. Results that depend on missing blocker inventory cannot be labeled potential pilot.
7. **No exclusions or no historic matches:** complete normally and explain the finding. Missing history is not a zero-performance finding.
8. **Database failure:** fail the job; local files cannot substitute for a saved report. The portal retains the prior durable state and shows stale progress until execution status is reconciled.

Use the existing bounded HTTP/provider retries inside the worker. Set whole-task automatic retries to zero initially to avoid repeating a partially paid analysis without a resume design. A completed, partial, or failed analysis rerun creates a new report; it does not edit the original.

No outbox service or automatic dispatcher is needed for the initial interactive flow. An explicit retry can dispatch a request that never acquired its launch fence. A crash after fencing cannot safely be distinguished from a lost successful response, so it requires an operator check rather than timed redispatch. This choice does not guarantee automatic execution or automatic capacity recovery; add a dispatcher only if unattended eventual execution becomes a requirement. Do not infer that a legacy unfenced `Starting` row was never attempted during a rolling upgrade.

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

Read existing report pages and encode complete rows server-side. The implementation retains encoded lines under a 10 MiB aggregate UTF-8 bound (including escaping/CRLF) and a 10,000-item bound; it does not accumulate unbounded rich raw row arrays. Exceeding either limit returns a clear error, never a truncated file. A CSV of a partial run identifies its partial status. An empty completed report still has a meaningful status/coverage row. Streaming is deferred because this bounded implementation fits the current serving memory budget.

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

## 19 Source-completion handoff — 15 October 2026, iteration two

### Review findings first

Independent review found four edge cases: flat default purchase values could
earn monetary points; a minimum phrase/broad witness could overstate no-history
coverage; parser-valid detail could exceed the database byte limit; and count/
byte caps could hide the selected action or omit other actions silently.
All were fixed with regression checks. The selected action is first and is
preserved, flat/unit/default monetary evidence is unconfirmed, no-history
non-exact coverage is incomplete, and capped findings are visibly partial and
review-only. Independent source and screenshot review has no remaining
actionable finding. Desktop visual review also replaced a crowded target
toolbar with the canonical responsive form grid.

### Outcome and operating boundaries

The three remaining source areas are implemented: campaign context collection,
full bounded source/list/attachment/blocker details, and exact value/ROAS/
Class B ranking. Both existing feature branches are continued; no package,
service, queue, endpoint, table or migration was added. Ponytail kept this in
the existing worker, typed JSON report, PostgreSQL and portal modules.

DEV-52 and DEV-53 remain **Work in progress**. The Jira records were inspected,
not transitioned or edited in this iteration. The prior local commits were
`f37ac84` (Sweeper) and `15c641d` (Ads Manager); final chat identifies the new
local commits. Remote read-only checks found neither feature branch published.
No push, merge, deployment, database migration/repair/grant, credential/IAM
change, Cloud Run execution, Google Ads request/mutation, or LLM call occurred.
Original dirty checkouts remain untouched. The temporary feature worktrees
remain available for review; there is no production action to roll back.

### Behavior and limitations

- Context retains current budget/sharing, serving/primary/bid state, standard
  or portfolio targets, resolved account/campaign/custom goals and comparable
  recent/preceding 30-day campaign totals. These are not query-level qualified
  outcomes or proof that negatives caused a decline. Shared budgets are not
  represented as a per-campaign allocation.
- Change Event uses a 29-account-local-day window ending before today, a
  10,000-row query limit and at most 20 relevant summaries/campaign. No actor
  email, old/new payload, inferred author or negative-creation date is stored.
  Capped/failed context is explicit; it does not become a complete 90-day
  history. Source queries are otherwise bounded at 20,000 rows.
- Source detail includes list and attachment resources, affected campaign
  identities (including relevant campaigns outside Search/PMax ranking),
  brand members and known/possible other blockers with scope, match, group,
  list and witness samples. Candidate-text witnesses without history are
  labelled hypothetical, never assigned traffic. Brand/spelling/symbol and
  unobserved broader-query semantics remain conservative limitations.
- Classes A/B/C/D/E and the approved 40/25/15/10/10 weights are retained.
  Confirmed action-specific value targets can establish Class B; compatible
  purchase metadata can use a sole-action Google goal ROAS target automatically.
  Generic forms, unit/default values and mixed-goal targets cannot gain
  automatic monetary points. Sale-event evidence alone does not establish
  monetary value or revenue-pilot readiness. Qualified events remain distinct
  from confirmed value and raw events; funnel actions are not summed as people.
- Cost, fractional conversions, CPA, ROAS and score ratios use exact arithmetic.
  Zero/missing denominators are unavailable; missing components are not
  renormalized. Components and total round half-up for display; the total is
  calculated from exact components, not by adding displayed rounded numbers.
  Ranking inputs/selected action/target source and score version are retained.
- Blocker matching has a two-million-comparison budget. Detail caps are 200
  blockers/attachments, 100 brand members/actions, and 64 KiB compact JSON per
  new item (with extra headroom for PostgreSQL's 128 KiB JSONB constraint).
  Original metrics/counts and the selected action survive caps; omitted detail
  becomes partial/low-confidence/review-only. Old v1 reports without extended
  fields retain the original 128 KiB read bound and are not silently upgraded.
- UI/CSV read the same immutable snapshot. CSV includes observed context and
  blocker paths, not agency targets, scores, raw intent explanations or provider
  payloads. A score is an ordering aid, not a probability, volume forecast or
  authority to remove anything. No historic Sweeper run is assumed.

### Verification actually run

- Sweeper: typecheck/build passed; full suite **208 passed, one existing
  PostgreSQL integration test skipped** (209 total), including **25** focused
  recovery/evidence tests. Synthetic collectors exercise account-local dates,
  goals/portfolio context, source failures/caps, exact attachment paths, brand
  members, Search/PMax separation, default/mixed-goal rejection, Class B/ROAS,
  zero division, Unicode size caps and legacy compatibility. No live GAQL ran.
- Ads Manager: all five workspace typechecks and **963 tests passed** (web 466,
  worker 91, API 238, DB 68, domain 100). **12 API** and **3 panel** focused
  cases include pinned value policy, safe CSV, native evidence text and existing
  auth/idempotency behavior. These use mocks, not PostgreSQL/RLS execution.
- Full optimized Ads Manager workspace build passed under fixture-only
  `APP_ENV=local` / `LOCAL_TEST_MODE=preview`; it proves compilation, not live
  deployment configuration. Docs check, four-case QA specification validation,
  mirrored-contract comparison and whitespace checks passed. No rule release
  or account-policy compilation changed, so rules:check was not needed.
- Agent-e2e observed the exact local preview origin with fictional data and
  disabled save/run/value controls. Desktop/laptop/tablet/390px/320px layouts,
  blockers/context/value disclosures, trusted Enter/focus and filter empty/
  restore passed; independent reviewer inspected current screenshots. Network
  capture after navigation saw only local assets and the existing Google Fonts
  stylesheet, no recovery command or Ads/LLM/Cloud Run request. The console
  collector found no subsequent errors; initial startup before injection is not
  covered. No credentials/durable data were created; emulation was cleared and
  the agent-owned server stopped. QA-owned tabs remain for review.

Still unverified and separately gated: real PostgreSQL migration/RLS/grants,
concurrency/crash recovery, read-only GAQL/manager-owned goal and provider
compatibility, Cloud Run/IAM and deployed authenticated persistence/poll/CSV.
Source completion is not release approval. Conservative missing evidence may
reduce useful candidates; scoring constants still require business calibration.

### Complete file-by-file source change report

Paths below are the isolated worktrees. Every entry describes this iteration,
not production operations. “Worker checks” means the offline Sweeper
typecheck/209-test suite/build; “portal checks” means the five typechecks,
963-test suite and fixture build; “docs checks” means link/context validation
plus diff review. These checks do not imply live integration proof.

#### Keyword Sweeper — feature/dev-52-volume-recovery

- [analysis.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/analysis.ts) — Joins full blocker/context detail and selects one action's meaningful value/target for Class B or revenue ROAS. Adds count/byte caps and partial/manual-review downgrade to prevent unearned eligibility. Metrics are preserved, not forecast. Risk: conservative inference, legacy origin and uncalibrated score weights. Verified: worker checks, monetary/default/no-history/selected-last/cap regressions and independent review.
- [blockers.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/blockers.ts) — New small matcher extracts known/possible scoped paths and cached witness matches, including exact candidate-text overlap without served history. Bounds comparisons and emitted detail. Effect: reviewers see what still blocks a query. Risk: not a Google brand/spelling emulator or exhaustive broader-query demand model. Verified: attachment/group/brand/no-history/budget-bound tests, worker checks and review.
- [context.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/context.ts) — New read-only collector resolves campaign budget/bidding/goals, account-calendar comparisons and sanitized recent changes. Nulls and caps remain explicit; no schema/lifecycle changes. Risk: query/permission compatibility untested live, change history shorter than performance history, present settings not historic causality. Verified: synthetic collector/date/goal/cap/privacy tests, worker checks and public Google documentation inspection.
- [contract.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/contract.ts) — Adds optional typed v1 value targets, ROAS, ranking inputs, context and blocker/source detail; strict safe projections, UTF-8 policy/item bounds and old-report compatibility. Effect: richer immutable JSON without migration. Risk: both repos must ship matching contracts; unsupported/oversized new payloads fail closed. Verified: byte-identical mirror, parser/policy/Unicode/legacy tests and worker/portal checks.
- [scoring.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/scoring.ts) — Extends existing exact fractions with value-to-spend/target ROAS for quality and efficiency; preserves lead scoring and missing-component behavior. Effect: meaningful value can rank without counting raw leads as qualified. Risk: attribution/meaning and targets must be valid; weights not calibrated probabilities. Verified: exact ratios, caps, zero-denominator tests and worker checks.
- [sources.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/src/volume-recovery/sources.ts) — Retains full list/attachment/brand metadata and conversion default/origin/type data, inventories campaign fan-out beyond ranked channels and delegates contextual reads. Replaces the first-iteration placeholder gap. Risk: unread/capped sources still make partial reports; no provider calls executed here. Verified: SELECT-only fake-reader tests, full attachment/brand/fan-out cases and worker checks.
- [volume-recovery-evidence.test.ts](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/test/volume-recovery-evidence.test.ts) — Adds 12 synthetic evidence cases covering the new collectors, ranking, blockers, caps and compatibility so regressions are reproducible without cloud data. Effect: test-only; fixtures assume no prior Sweeper history. Risk: mocks do not validate real GAQL or RLS. Verified: all 12 new/25 focused/209 total cases accounted for and typechecked.
- [implementation plan](/private/tmp/bbs-volume-recovery-sweeper.Ze9zSR/docs/VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md) — Adds latest-handoff navigation and this outcome, file report, evidence and remaining gates; preserves iteration-one history. Effect: review documentation only. Risk: local source proof is not client results or release approval. Verified: compared against final diffs, actual command results and independent review.

#### Ads Manager — feature/dev-53-volume-recovery

- [domain contract](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/domain/src/volume-recovery.ts) — Mirrors the worker's additive v1 fields and safe bounds for caller/UI compatibility; no provider shape leaks. Operational effect: existing JSON storage suffices. Risk: coordinated source release needed, legacy fields stay optional. Verified: mirror comparison, worker parser cases and portal checks.
- [API repository/CSV](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/api/src/keyword-sweeps/volume-recovery.ts) — Extends terminal CSV with retained observed ROAS/value meaning, source paths, blockers and sanitized context. Existing save/run/report APIs remain unchanged. Risk: CSV is wider; targets/scores/private payloads intentionally excluded and formulas remain escaped. Verified: 12 focused API cases, projection/column parity/privacy assertions, portal checks and review.
- [API tests](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/packages/api/test/keyword-sweeps/volume-recovery.test.ts) — Adds pinned-value-policy and complete safe-CSV regressions using mock persistence. Effect: test-only, no schema execution. Risk: does not prove live transaction/RLS or download authorization. Verified: all 12 focused/238 API cases passed and typechecked.
- [panel](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-panel.tsx) — Adds draft-only value interpretation/target controls, readable known/possible blocker/source disclosures and campaign context/value evidence. Uses native forms/details, current permissions/revision handling and existing endpoints. Risk: real save/poll/history flows remain integration gates; values are not inferred in the browser. Verified: portal checks, 3 panel tests, fixture browser and independent source/visual review.
- [fixture](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-fixture.ts) — Extends fictional legacy example with shared blocker/context and a separate Class B business-value/4x-ROAS finding. Keeps original raw-lead score 48.15 and no prior Sweeper provenance. Effect: preview only, controls cannot persist or execute. Risk: invented demonstration values are not client results. Verified: panel/parser-compatible types, portal checks and actual screenshots.
- [panel tests](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/apps/web/src/ui/features/negative-keyword-sweeps/volume-recovery-panel.test.tsx) — Adds SSR assertions for complete blocker/context/value text and disabled controls. Effect: test-only. Risk: static rendering does not prove interactive timing; actual disclosures/filtering checked separately. Verified: 3 focused cases and full portal checks.
- [canonical CSS](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/design-system/components.css) — Adds the single responsive value-form grid to avoid squeezed selected meanings; canonical gaps, two columns when space permits, otherwise stacked. No shared navigation changes. Risk: long control content still needs viewport review. Verified: desktop/laptop/tablet/390px/320px screenshots, geometry and independent review.
- [component catalog](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/design-system/components.md) — Documents the value-form grid and native bounded evidence pattern so UI changes have a canonical reusable owner. Documentation only; no capability expansion. Risk: keep future equivalents aligned. Verified: docs checks and screenshot/source comparison.
- [composition catalog](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/design-system/product-compositions.md) — Extends D-114's existing composition with target/grid/context/blocker semantics and no-write boundary. Documentation only; no new page/overlay. Risk: not authority for future Ads actions. Verified: docs checks and UI review.
- [acceptance matrix](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/acceptance-matrix.md) — Replaces the now-finished source TODO with actual synthetic/visual evidence, preserving every integration release gate. No runtime effect. Risk: offline passes must not be read as staff-use approval. Verified: docs checks and command/result comparison.
- [API ownership](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/api-ownership.md) — Documents optional policy input and the safe report/CSV additions without new endpoints. No runtime effect. Risk: private target/score exclusions remain binding. Verified: docs checks and API projection tests/source review.
- [architecture](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/architecture.md) — Records additive JSON storage, per-action target separation, context limitations and deterministic caps under AD-026. No migration/service addition. Risk: deployed coordination still required. Verified: docs checks and worker/domain/API comparison.
- [operations](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/operations.md) — Removes obsolete source gaps and records concrete query/item/cap/default-inference boundaries, retaining approval gates. No operation was run. Risk: actual GAQL/RLS/IAM remains unproved. Verified: docs checks, bounded-source tests and diff review.
- [D-114 decision](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/product/decisions.md) — Clarifies evidence quality/defaults/partial caps within the existing admission. No role/write/schema authority expansion. Risk: later scope changes still need approval. Verified: docs checks and comparison with accepted plan/current request.
- [threat model](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/security/threat-model.md) — Documents sanitized change data, byte/count bounds and deterministic financial/LLM separation. No credential or permission change. Risk: source controls are not live IAM/RLS evidence. Verified: docs checks, projection/privacy tests and independent review.
- [status](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/status.md) — Leads with completed source areas and actual tests/build/review, preserving first-iteration history and unfinished release gates. Documentation only; Jira unchanged. Risk: status must stay distinct from deployment. Verified: docs checks, command logs and final git review.
- [UI contracts](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/ui-contracts.md) — Documents optional v1 fields, exact ratio units, immutable target meaning and legacy compatibility. No runtime effect. Risk: both repo mirrors must stay synchronized. Verified: docs checks, byte comparison and parser cases.
- [integration inventory](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/docs/what-we-use.md) — Records broader observed Ads context through the same unconnected recovery integration; explicitly no new vendor/permission. No provisioning. Risk: public docs and mocks do not prove live compatibility. Verified: docs checks and collector inspection.
- [QA case](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/qa/agent-e2e/suites/accounts/volume-recovery.case.md) — Adds value/context/blocker/disabled-control assertions to the existing observe-only legacy preview case. Effect: repeatable QA specification, not CI/browser code or write authority. Risk: real persistence remains blocked pending approval. Verified: 4-case validator, actual fixture execution and independent screenshots.

#### Ignored local QA artifacts (not committed or client data)

All are under [the source-completion QA run](/private/tmp/bbs-volume-recovery-ads-manager.H5N9LJ/qa/agent-e2e/runs/volume-recovery-source-20261015/report.md).
They document only the synthetic local preview; no production behavior changes.
Each PNG was opened and inspected, then independently reviewed. Build outputs
and compiler caches are generated verification artifacts, not source changes.

- `report.md`: records run scope, findings, observations, network/console limits and cleanup; checked against executed steps.
- `desktop-settings.png`: revised two-column form/full meanings; verifies desktop spacing.
- `desktop-blockers.png`: exact shared-list/resource path and fan-out; verifies readable bounded evidence.
- `desktop-context.png`: expanded budget/bidding/goal context; verifies separate causal warnings.
- `laptop-settings.png`: 1280px target form; verifies full selected meaning and gaps.
- `tablet-settings.png`: 768px stacked target form; verifies constrained-width labels.
- `tablet-value.png`: Class B/4x-ROAS evidence; verifies business value is not presented as qualification.
- `mobile-settings.png`: 390px stacked controls; verifies full meaning, disabled state and no overflow.
- `mobile-blockers.png`: 390px long resource/list paths; verifies wrapping and retained scope.
- `mobile-context.png`: 390px expanded context; verifies readable warnings and no document overflow.
- `narrow-keyboard.png`: 320px native disclosure focus; verifies visible unclipped outline after trusted Enter.
- `mobile-filter-empty.png`: unmatched filter state; verifies honest empty results before restore.

### Technical references checked (public documentation, not account API calls)

- [Change Event limits and omissions](https://developers.google.com/google-ads/api/docs/change-event).
- [Bid strategy status](https://developers.google.com/google-ads/api/docs/campaigns/bidding/strategy-status).
- [v25 accessible bidding strategy fields](https://developers.google.com/google-ads/api/fields/v25/accessible_bidding_strategy).
- [v25 conversion goals](https://developers.google.com/google-ads/api/fields/v25/campaign_conversion_goal), [custom goals](https://developers.google.com/google-ads/api/fields/v25/custom_conversion_goal).
- [v25 brand member fields](https://developers.google.com/google-ads/api/fields/v25/shared_criterion).
- [Account-negative inventory applicability](https://support.google.com/google-ads/answer/11396330).

## 20 Integration and verification handoff — 19 October 2026

### Review findings and disposition

Two independent fallback reviewers covered correctness and security across both
branches. Dedicated Bugbot/Security Review agent types were unavailable; these
are not results from those services. The first review found:

1. P1: direct account keyword criteria were omitted while blocker coverage could
   be complete. Added the separate direct-keyword read and required both account
   sources before complete coverage; a sole overlapping account negative now
   prevents a pilot recommendation.
2. P2: pending-run retries could start duplicate jobs and a rejected redundant
   launch could fail an already accepted execution. Added a committed atomic
   launch fence using the existing stage column, with guarded outcome writes.
3. P2: 10,000 rich CSV items could exceed the 512 MiB web memory allocation.
   Encode rows incrementally and reject beyond 10 MiB of final escaped UTF-8
   output, retaining the count limit and formula protection.

Shah approved all three fixes and repeat reviews. Both repeat source reviews
found no remaining actionable findings. The correctness review's documentation
note is addressed by the revised failure-handling section above and the portal
operations, architecture, API and threat-model amendments. Independent visual
review inspected all 12 current captures; the main agent executed the browser
and PostgreSQL checks separately.

Actual PostgreSQL also exposed three previously mock-hidden defects: target
CPL was read from a nonexistent account column; the worker audit trigger lacked
INSERT permission; and 0047's down guard could miss evidence under forced RLS
for a non-BYPASSRLS schema owner. Those source corrections are covered below.

### Evidence and release boundaries

- Ads Manager: all five typechecks and **990 tests passed** (480 web, 93 worker,
  244 API, 69 DB, 104 domain), including 15 focused recovery API cases. Full
  optimized workspace build passed in fixture-only preview mode.
- Sweeper: typecheck/build passed; **210 passed, one existing optional DB test
  skipped** (211 total), including 27 focused recovery cases. No policy/rule
  compilation changed, so rules:check was not required. Contract mirrors match.
- Actual loopback PostgreSQL 18: **16 groups passed** using the real API/grant
  code and worker persistence/analysis, fictional inputs and disabled HTTP.
  Covers tenant/assignment/RLS, immutable evidence, configuration dates,
  idempotency/capacity, 20-way launch retries, worker claims, paging/exact money/
  safe CSV, uncertain/pre-call-crash fences, archived cleanup and terminal
  reconciliation. Cloud gateway, collectors and classifier are fakes.
- Full migration chain through 0048 applied, empty-rolled-back and reapplied
  under a non-superuser/NOBYPASSRLS owner. Populated 0047 rollback refused and
  retained FORCE RLS. Its forward SQL is byte-identical to the prior feature
  commit. This is native PostgreSQL 18 evidence, not PostgreSQL 16 CI/Cloud SQL.
- Actual local fixture browser: 1440/1280/768/390/320px, native trusted Enter,
  disabled controls, readable source/blocker/context/value disclosures, filter
  empty/restore and no document overflow passed. Capture after navigation saw
  only local 200-status link-prefetch GETs and no console warnings/errors;
  initial startup is outside capture. No login/save/run/export occurred.
- Docs/QA specification and whitespace checks cover the integrated source.
  They do not establish production behavior. Initial mock CSV regression used
  an oversized invalid item; reduced it to a parser-accepted rich Unicode item
  before the final passing aggregate-limit check.

No Google Ads API read/write, live LLM, cloud execution/deployment, production
database access/migration/grant/data repair, IAM/credential change or Jira write
occurred. Art City is explicitly on hold: no further lookup or actual client
report was attempted. DEV-52/DEV-53 remain at last verified Work in progress.
Production 0047/grant state is not independently verified. Live GAQL/model,
Cloud Run/IAM and deployed authenticated save/run/poll/download remain release
gates. GitHub PR/CI evidence is not established by local tests.

Ads Manager resolves the ten approved documentation conflicts while integrating
`origin/main` at `1c41ddf` into the feature branch; incoming D-115/D-116/D-117
work is preserved. D-114's obsolete reservation alone was removed. Both Dev
deploy workflows are prepared as manual-only with explicit default-false
approval, but this source is not published. Existing cloud schedules and remote
workflow behavior remain unchanged. No new feature push or main merge is part
of this local checkpoint. Original dirty checkouts remain untouched.

Operational tradeoffs: an unknown launch or crash after the launch fence keeps
its capacity slot until an operator establishes the outcome and obtains separate
approval for safe reconciliation. No timed redispatch, outbox or admin mutation
surface was added. Legacy pending work from an unfenced version needs inspection
before a rolling upgrade. Oversized CSV downloads fail clearly; paginated
report access remains. Roll back compatible application code/config, not
immutable report history. 0048's incomplete-note compatibility still needs
environment-specific verification before any affected rollout.

### Complete file-by-file report for this iteration

Every entry states change/purpose, behavior/operational effect, principal
risk/follow-up and verification. `Portal` means the 990 offline tests, five
typechecks and fixture build; `Worker` means the 211-test offline suite,
typecheck/build; `PG` means the 16 explicitly approved local fictional groups;
`Docs` means source/decision reconciliation and the documentation validator.
No label means live acceptance. Test files only change verification behavior.
Incoming-main files below are retained, not new recovery feature scope; their
original detailed D-115/D-116/D-117 reports remain in portal `docs/status.md`.

#### Keyword Sweeper — current iteration

- `src/volume-recovery/sources.ts` — Inventories direct account keywords separately from attached lists and retains account scope/fan-out/source details. Prevents invisible blockers; unavailable/capped reads remain partial. Risk: live field/permission compatibility unproved. Verified: Worker, direct-only overlap/fan-out and source-failure tests, both reviews.
- `src/volume-recovery/analysis.ts` — Requires both account sources before complete supported blocker coverage. A failed/missing source cannot earn a pilot label. Risk: conservative downgrades when Google denies a representation; no fallback assumption of empty inventory. Verified: Worker and both reviews.
- `test/volume-recovery-evidence.test.ts` — Adds direct-account overlap/fan-out and either-source-failure regressions with injected SELECT results. Prevents the original false-complete bug without customer history. Risk: mocks are not live GAQL validation. Verified: all 27 focused cases/Worker.
- `test/volume-recovery.test.ts` — Adds successful direct-account coverage to the synthetic complete-inventory baseline. Keeps existing pilot tests honest under the stronger gate. Risk: synthetic completeness only. Verified: Worker.
- `docs/VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md` — Supersedes unsafe timeout redispatch, documents bounded CSV and this complete handoff. No runtime or release action. Risk: source proof must not be mistaken for production signoff. Verified: final source, actual results and review-note reconciliation.

#### Ads Manager — recovery corrections, gates and documentation

- `.github/workflows/deploy-dev-worker.yml` — Removes push deployment and requires explicit manual deployment-and-Ads-read approval. A future main merge is code-only for this workflow; existing schedules are untouched. Risk: future manual dispatch still invokes discovery/sync and is prohibited now. Verified: deployment-safety tests/Portal and source review; no dispatch.
- `.github/workflows/deploy-dev.yml` — Removes push deployment and requires explicit default-false manual approval. Preserves deployment implementation but stops automatic publication effects once merged. Risk: release becomes a deliberate manual operation, gates not yet remote. Verified: deployment-safety tests/Portal and review.
- `apps/worker/test/deployment-safety.test.ts` — Guards both workflows against automatic/reusable triggers and ungated deploy jobs. Test-only protection; string/source checks are not GitHub execution proof. Verified: both new cases/Portal.
- `package.json` — Adds the explicit `test:recovery:postgres` command without dependencies or automatic test/CI wiring. Keeps DB writes opt-in and worker source path explicit. Risk: operators must supply a prepared disposable loopback `_test` database. Verified: PG and refusal of missing opt-in/remote URL.
- `scripts/verify-volume-recovery-postgres.ts` — New cross-repo rehearsal using actual repositories/grants/worker and fake external dependencies. Rejects remote/redirect URL options, requires opt-in, never loads env files and blocks fetch. Risk: PG18/fakes and simulated crashes are not cloud/provider or general isolation proof; fixtures persist only until run-owned cluster disposal. Verified: all 16 groups and safety refusals.
- `packages/api/src/keyword-sweeps/volume-recovery.ts` — Resolves current CPL by account-local effective date, atomically fences launch before gateway calls, guards late outcomes and caps encoded CSV at10MiB. Reuses schema and immutable requests. Risk: unknown launch holds capacity; unusually rich exports refuse rather than truncate; live integration still gated. Verified: 15 focused tests, Portal, PG, both repeat reviews.
- `packages/api/test/keyword-sweeps/volume-recovery.test.ts` — Covers target query/pinned value, concurrent/accepted/uncertain/pre-call-crash dispatch and valid rich Unicode/quoted CSV limits. Mock checks complement, not replace, PG concurrency. Verified: all 15 focused and244 API cases.
- `packages/db/migrations/0047_volume_recovery.sql` — Corrects only down guard visibility with atomic temporary owner-visible RLS changes and restored FORCE RLS. Refuses evidence loss for non-bypass owners. Risk: schema-owner-only rollback; no production reapply is needed merely for this fix, forward SQL unchanged. Verified: byte comparison, PG populated refusal and non-super full roundtrip.
- `packages/db/src/sweeper-runtime-grants.ts` — Grants INSERT-only audit access required by invoker-rights lifecycle triggers, explicitly removing other audit privileges. Enables real worker claim without audit reads/deletes. Risk: approved runtime grant rollout still required; not performed. Verified: PG claim and audit-read denial, Portal/review.
- `packages/db/test/dev-runtime-grants.test.ts` — Asserts audit revoke/INSERT and absence of audit SELECT in worker grant generation. Test-only; actual role behavior additionally checked in PG. Verified: Portal/PG.
- `packages/db/test/volume-recovery-migration.test.ts` — Guards owner-visible/restore-FORCE order in down SQL. Test-only; source assertions do not by themselves establish transactional safety. Verified: Portal plus real PG refusal/roundtrip.
- `design-system/components.md` — Unions recovery value-grid/evidence guidance with main's retained-form/floating-help patterns. Preserves both admitted designs; no new component runtime. Risk: doc drift/shared consumers. Verified: Docs, independent source/12-capture review.
- `design-system/product-compositions.md` — Preserves recovery and updated Today/Overview sibling-modal compositions. Keeps scope boundaries rather than choosing one branch's docs. Risk: no live behavior implied. Verified: Docs/source and responsive review.
- `docs/acceptance-matrix.md` — Preserves incoming criteria and records exact PG/offline/fixture evidence plus live gaps. Prevents local results being read as release approval. Risk: PG18 is not target PG16. Verified: Docs and actual command/capture results.
- `docs/api-ownership.md` — Preserves new sweep CSV ownership and recovery APIs; adds10MiB/10k export and no-relaunch semantics. No new endpoint or permission. Risk: stale client expectations for retries/large exports; explicit semantics now documented. Verified: Docs/API source/tests.
- `docs/architecture.md` — Unions incoming Today/checklist/export design with recovery, effective CPL, stage fence, aggregate export and least privilege/rollback contracts. No provisioning. Risk: operational rollout is separate. Verified: Docs, PG/source and reviews.
- `docs/domain-rule-coverage.md` — Retains main's eleven-check/binary-note rule and duration evidence mapping. Documentation only, not recovery scope. Risk: preserve historic status compatibility. Verified: Docs/Portal domain tests.
- `docs/frontend-reconciliation-matrix.md` — Unions recovery and incoming Today/tooltip/request-modal state. No runtime change; explicitly retains local/live evidence limits. Risk: stale presentation map. Verified: Docs/source and responsive captures.
- `docs/operations.md` — Reconciles incoming rollout notes and D-118 manual gates, local runner, unknown-launch capacity tradeoff, direct-account coverage and CSV limits. Operational instructions only; no production commands run. Risk: manual dispatch still reads Ads, legacy pending rows need inspection. Verified: Docs/PG/source and review-note reconciliation.
- `docs/product/brief.md` — Retains main's admitted eleven-module/binary-current-editor refinements. No new recovery admission or data write. Risk: historical stored semantics must stay readable. Verified: Docs/Portal domain/checklist tests.
- `docs/product/decisions.md` — Preserves accepted D-114 and incoming D-115–117, removes the obsolete D-114 reservation and adds D-118 approvals/limits. Documentation is not cloud execution authority. Risk: maintain distinct source/live claims. Verified: Docs/sequential decisions and request comparison.
- `docs/product/scope-ledger.md` — Unions only the already-approved recovery and incoming refinements. Adds no arbitrary Ads writer/report feature. Risk: accidental scope widening avoided by explicit exclusions. Verified: Docs/Portal scope-lock tests and review.
- `docs/security/threat-model.md` — Preserves both branches and records fence, CSV aggregate bound and dual account-source completeness. No secret/role scope expansion beyond explicit audit INSERT. Risk: source controls are not live IAM/RLS proof. Verified: Docs, repeat security review, privacy tests/PG denials.
- `docs/status.md` — Records reviewed defects/fixes, exact990/210/16-group evidence, merge/gate state, client-report hold and this inventory's location. No Jira/release mutation. Risk: historical status entries are dated, not newly revalidated. Verified: Docs/actual command results and final repository state.
- `docs/ui-contracts.md` — Unions optional recovery v1 and incoming Today/date/duration fields. Keeps old consumers/nullable missing values. Risk: contract mirrors must remain coordinated. Verified: Docs/Portal and mirror comparison.
- `docs/what-we-use.md` — Corrects source-level auto-deploy descriptions, records disposable PG proof and distinguishes untouched live schedules/resources. No external connection added. Risk: prospective gates are not published yet. Verified: Docs/workflow and runner source.

#### Ads Manager — incoming-main source retained during integration

All entries in this subsection preserve main's existing implementations, with
no additional local logic edits. Their reason is avoiding regressions/lost work
while integrating recovery. `Portal` was rerun against the merged source. New
recovery fixture screenshots do not repeat every incoming Today interaction or
establish authenticated writes; original main QA details remain dated evidence.

- `apps/web/app/(authenticated)/today/page.test.tsx` — Retains compact critical-count rendering assertion. Test-only; copy check is not behavior/auth proof. Verified: Portal.
- `apps/web/app/api/accounts/[accountId]/keyword-sweeps/[runId]/csv/route.ts` — Retains terminal sweep CSV Node GET adapter. No sweep execution; live authorization/download remains a gate. Verified: Portal route/build and CSV tests.
- `apps/web/src/scope-lock.test.ts` — Retains admitted sweep CSV route alongside recovery routes. Test-only inventory, not authorization. Verified: Portal.
- `apps/web/src/server/keyword-sweeps/keyword-sweep-csv.ts` — Retains main's distinct bounded terminal sweep export with formula/privacy/count checks. Does not reuse recovery data or call Ads. Risk: real session/count completeness still unproved. Verified: Portal CSV tests/build.
- `apps/web/src/server/keyword-sweeps/keyword-sweep-csv.test.ts` — Retains paging/escaping/privacy/access/count refusal cases. Test-only doubles, not live RLS. Verified: Portal.
- `apps/web/src/ui/components/dialog-frame.tsx` — Retains mounted-but-closed form semantics. Preserves modal draft/retry state; hidden focus ownership is a shared UI risk. Verified: Portal and original D-117 interaction evidence, not rerun here.
- `apps/web/src/ui/components/dialog-frame.test.tsx` — Retains closed-frame hidden/ARIA assertions. Static test-only, not actual focus-trap proof. Verified: Portal.
- `apps/web/src/ui/features/account-analytics/metric-help-disclosure.tsx` — Retains floating hover/focus help, viewport clamp and owner-aware Escape. Shared tooltip/scroll compatibility risk. Verified: Portal and existing D-117 browser evidence; no new tooltip operation here.
- `apps/web/src/ui/features/account-analytics/metric-help-disclosure.test.tsx` — Retains semantics/edge placement tests. Test-only geometry, not real pointer behavior. Verified: Portal.
- `apps/web/src/ui/features/account-workflows/daily-checklist-screen.tsx` — Retains binary current editing, optional incomplete notes and historical labels. Risk: durable notes require0048 compatibility; no durable save performed. Verified: Portal and source integration.
- `apps/web/src/ui/features/account-workflows/daily-checklist-screen.test.tsx` — Retains binary/eleven-check/noted-incomplete rendering/helper coverage. Test-only, no storage proof. Verified: Portal.
- `apps/web/src/ui/features/negative-keyword-sweeps/keyword-sweep-decision-table.tsx` — Retains existing reviewed-action explanatory copy and result toasts, not a recovery apply path. Risk: separate default-off writer remains outside this task. Verified: Portal; no action invoked.
- `apps/web/src/ui/features/negative-keyword-sweeps/keyword-sweep-decision-table.test.tsx` — Retains Search/PMax copy and confirmation/retry assertions. Test-only; no real transition. Verified: Portal.
- `apps/web/src/ui/features/negative-keyword-sweeps/manual-sweep-card.tsx` — Retains bounded form in the dedicated retained modal. Risk: draft/idempotency state and live capability gate must survive. Verified: Portal/original D-117 evidence; no run launched.
- `apps/web/src/ui/features/negative-keyword-sweeps/manual-sweep-card.test.tsx` — Retains title/account/form/confirmation checks. Static tests do not prove network acceptance. Verified: Portal.
- `apps/web/src/ui/features/today/guarantee-review-metrics.ts` — Retains exact selected-period totals with full paging and unavailable states. Risk: bounded source completeness/history assumptions. Verified: Portal controlled cases, no live facts.
- `apps/web/src/ui/features/today/guarantee-review-metrics.test.ts` — Retains cross-month/decimal/missing/first-day/paging tests. Test-only API doubles. Verified: Portal.
- `apps/web/src/ui/features/today/preview-operations.ts` — Retains fictitious issue-open timestamps for display. Fixture-only, not real history. Verified: Portal.
- `apps/web/src/ui/features/today/preview-operations.test.ts` — Retains critical fixture/eleven-module reconciliation. Test-only consistency. Verified: Portal.
- `apps/web/src/ui/features/today/today-briefing.tsx` — Retains main's delivery context, counts/help, progress/history and request-modal composition. No recovery execution bridge added. Risk: complex shared UI relies on original interaction proof beyond current recovery screenshots. Verified: Portal and original D-115–117 evidence.
- `apps/web/src/ui/features/today/today-briefing.test.tsx` — Retains main's composition, count/zero/error, modal/capability checks. Static/source test limits remain. Verified: Portal.
- `apps/web/src/ui/mocks/data.ts` — Retains optional fictional guarantee/duration fields. Changes preview only; not client data. Verified: Portal/fixture build.
- `design-system/components.css` — Retains main's canonical Today/tooltip/modal/checklist CSS together with recovery grid. Shared styling can regress other screens; no disconnected overrides added. Verified: Portal, existing main QA and fresh independently reviewed recovery screenshots.
- `design-system/product-component-requirements.md` — Retains incoming binary/count/help/modal acceptance semantics. Documentation-only, not additional capability admission. Verified: Docs/Portal contracts.
- `design-system/tokens.css` — Retains tooltip width/layer tokens. Shared stacking risk; no new recovery overlay. Verified: Portal/original D-117 QA and current fixture rendering.
- `packages/api/src/today/postgres-today-operations-repository.ts` — Retains scoped issue-open/checklist dates. Risk: dates are not continuous criticality/completion proof. Verified: Portal SQL-double tests, not live query scale.
- `packages/api/src/today/postgres-today-pace-history.ts` — Retains effective-goal/daily-history loader and safe absent-schema fallback. Risk: target live query performance/history completeness. Verified: Portal controlled repository tests.
- `packages/api/src/today/postgres-today-repository.ts` — Retains pace-history composition before compatibility probes. Prevents aborted-transaction ordering regression; real Today queries not exercised here. Verified: Portal repository tests.
- `packages/api/test/accounts/postgres-human-workflow-repository.test.ts` — Retains expanded-plan compatibility/management independence cases. Test-only doubles, not transaction execution. Verified: Portal.
- `packages/api/test/today/postgres-today-operations-repository.test.ts` — Retains progress/partial/history projections. Test-only SQL-double coverage. Verified: Portal.
- `packages/api/test/today/postgres-today-pace-history.test.ts` — Retains loader/date/schema-fallback regressions. Test-only; real query plans remain unproved. Verified: Portal.
- `packages/api/test/today/postgres-today-repository.test.ts` — Retains duration integration and42P01/42703 fallback ordering cases. Test-only; no live Today acceptance. Verified: Portal.
- `packages/db/migrations/0048_incomplete_check_notes.sql` — Retains main's narrow incomplete-note constraint and loss-refusing down guard. Changes no source rows; production applied state unverified. Verified: source tests and local full migration roundtrip, not production.
- `packages/db/test/migrate.test.ts` — Retains0048 constraint/source checks. Test-only; local chain roundtrip supplies separate execution evidence. Verified: Portal/PG setup.
- `packages/domain/src/checklist-work.ts` — Retains eleven-module critical plan and compatible noted-incomplete normalization. Risk: existing days can acquire required work, as approved. Verified: Portal domain tests; storage0048 separately gated.
- `packages/domain/src/index.ts` — Retains pace-duration export alongside recovery contract export. Public API compatibility risk is compile-time, not new runtime effects. Verified: Portal typechecks/build.
- `packages/domain/src/lead-pace-duration.ts` — Retains exact history-based behind duration with resets/unknown boundaries. Does not substitute issue age. Risk: input completeness/reconciliations affect reconstruction. Verified: Portal domain tests.
- `packages/domain/src/ui-contracts.ts` — Retains optional history/duration fields, preserving older consumers. No schema/backfill. Risk: missing values remain unknown. Verified: Portal typechecks/tests.
- `packages/domain/test/checklist-work.test.ts` — Retains noted-incomplete/history/expanded-plan regressions. Test-only domain proof. Verified: Portal.
- `packages/domain/test/lead-pace-duration.test.ts` — Retains fractional/calendar/reset/gap/duration cases. Test-only fixtures, not real history proof. Verified: Portal.

#### Ignored local evidence and cleanup

`qa/agent-e2e/runs/volume-recovery-20261019/report.md` records the observe-only
contract, each inspected result, console/network limits and cleanup. Its 12
PNGs are individually listed with purpose in that report; none is real client
data or source. They were opened by the main agent and independently reviewed.
The agent-owned preview server is stopped, emulation cleared and the QA tab
group retained for review. Disposable local PG cluster/fictional fixtures are
removed after verification, without touching the existing developer database.
Feature worktrees and useful evidence are retained; build/cache outputs are
generated, ignored and not source edits.

## 21 Code-only main publication — 19 October 2026

Shah explicitly requested merging both feature branches to main. Fresh fetch
confirmed Sweeper main `72b96f5` is contained in reviewed `378c40c`, and Ads
Manager main `1c41ddf` is contained in reviewed `98d0acc`. Both publications
can fast-forward without application changes or conflict resolution. The only
new commits record this authority/publication boundary; exact remote tips are
verified after pushing. Dirty primary checkouts remain untouched.

The workflows were inspected: Sweeper main runs repository/rule tests; portal
main runs repository/disposable-CI PostgreSQL checks. Both portal deployments
are manual-only with explicit approval. No deployment, production migration,
cloud execution, live model or Google Ads API call is authorized or performed
by the agent. Existing source tests/reviews below remain evidence, not proof
of live release readiness or a successful new GitHub CI run. Art City remains
on hold; Jira status is unchanged at last verified Work in progress.

File-by-file publication edits: this implementation plan records the approval,
ancestry and no-deployment boundary; portal `docs/status.md` records the same
checkpoint and `docs/what-we-use.md` aligns source-gate wording. They change no
application logic. Risk: code publication is not production acceptance.
Verified by fetched ancestry, docs/whitespace checks and final remote-tip
comparison; the complete source file report remains in section20 above.

## 22 Evidence corrections — 20 October 2026

### Review findings and changed behavior

Shah approved the traffic-first compact table and required Sweeper corrections.
DEV-52 and DEV-53 were read and remain **Work in progress**; Jira was not changed.
Independent source review found no remaining actionable correctness finding in
the changed paths. That review did not execute tests or providers.

The previous direct-account-keyword fix was based on an invalid v25 field
assumption. [Google's v25 CustomerNegativeCriterion fields](https://developers.google.com/google-ads/api/fields/v25/customer_negative_criterion)
provide `negative_keyword_list.shared_set`, not `.keyword.text`/`.match_type`.
Remove that unsupported query, rather than ignoring a legitimate account
inventory failure. Account-list attachments plus shared criteria still collect
account negatives and their full eligible campaign fan-out; both reads remain
required. The synthetic fixture no longer invents those nonexistent fields.
This corrects the technical representation in section 20, not its all-scope
coverage or no-Ads-write requirement. Public documentation is not a live query
acceptance test; no Google Ads API call was made.

Identical **existing** model inputs (text, scope, match type, under the same
account/pinned policy) now share one validated intent. Campaign facts and
recommendations stay separate. Groups prioritize observed qualified outcomes,
sales, raw events, clicks and impressions, then deterministic identity. The
2,000 bound now applies to unique inputs; batches remain 25, time 20 minutes,
report 10,000 items. No model fields, provider or higher limit is added. Safe
row explanations distinguish skipped input/time limits, invalid output,
provider failure and missing taxonomy. Coverage reports evaluated/rejected/
unevaluated counts. A future run can still be partial; no completion guarantee.

Blocker lookup indexes plain exact negatives and skips only proven exact
nonmatches. Punctuation, broad/phrase, brand and unknown-group semantics remain
conservative; the two-million actual-comparison and 200-detail bounds stay.
Exactly consuming the budget is not the same as skipping a comparison. Capped
campaign changes/action detail no longer falsely makes blocker matching
incomplete; omitted blocker or source attachment detail still does. **Every**
detail cap continues to veto potential-pilot labels and lower confidence.
No-outcome conversion fallback follows resolved campaign goals instead of an
arbitrary account-wide call action; positive attributed outcomes remain separate
and take precedence. Scoring formulas/version and monetary safeguards are unchanged.

### Evidence actually run and operational boundary

- `npm run check`, `npm test`, `npm run build`: passed; 216 passed, one existing
  optional integration test skipped (217 total). Focused recovery tests: 33/33.
- Regressions cover supported account-list mapping/fan-out/failures, 10,000 exact
  negatives against 1,000 witnesses inside a 1,000-comparison budget, punctuation,
  separate context/source byte caps, deduplication without metric sharing,
  outcome-first 2,001-input selection, skipped/time/invalid/provider reasons and
  goal-aware fallback. Injected collectors/providers only, not live accuracy,
  full-load certification, PostgreSQL/RLS/IAM or paid-run acceptance.
- Worker/portal v1 contract files remain byte-identical; no schema, migration,
  CSV projection, entry-point authorization or normal-sweep policy change.
- Work uses ordinary primary checkouts on `fix/volume-recovery-evidence` from
  fetched origin/main (Sweeper `11d56d08`, portal `adc307a`). No implicit worktree.
  The conflicting old README draft and untracked plan were preserved byte-for-
  byte in `/private/tmp/volume-recovery-sweeper-drafts.HdeCH5` before switching;
  other user changes remain untouched and excluded from commits. Local main
  was not reset, merged or forced forward.
- No push/merge/deployment, migration, grant/data repair, cloud execution,
  Google Ads API read/write, model call or Jira mutation. Existing saved reports
  remain immutable: new source cannot repair their missing evidence. A future
  approved worker/web rollout plus separately approved new review is required.
  The 20,000-row/source, 10,000-row report and runtime limits remain real risks.

### Complete Sweeper file-by-file handoff

- `src/volume-recovery/sources.ts`: Removes only the unsupported direct-account
  keyword query/coverage dependency. Keeps account-list/shared-criterion scope,
  attachment identity/fan-out and fail-closed missing reads. Operational effect:
  one fewer invalid read, no new permission. Risk: live GAQL compatibility remains
  unverified. Verified by v25 docs, injected collector regressions and full checks.
- `src/volume-recovery/scoring.ts`: Exports the existing normalization unchanged
  for exact indexing and priority lookup. No formula/score-version change.
  Risk: all callers must retain the same normalization. Verified by matching/
  decimal regressions, focused tests, full check/test/build and source review.
- `src/volume-recovery/blockers.ts`: Adds per-campaign-array exact indexes and an
  explicit skipped-comparison flag; keeps uncertainty, counts, witness paths and
  bounds. Effect: unrelated exact terms no longer consume the matching budget.
  Tradeoff: bounded in-memory indexes; no claim of arbitrary portfolio load.
  Verified by 10,000-entry regression, punctuation/scope cases and source review.
- `src/volume-recovery/analysis.ts`: Separates blocker/source truncation from
  context/action caps, accepts safe per-row missing-intent reasons and uses
  resolved goals for zero-outcome fallback. All caps still veto pilots; positive
  events and monetary rules stay intact. Compatibility: v1 fields unchanged,
  old stored reports unchanged. Verified by cap/null/goal/ranking tests, parser
  round-trips, contract comparison, full checks and independent source review.
- `src/volume-recovery/pipeline.ts`: Deduplicates identical semantic inputs,
  prioritizes historic evidence, validates every batch before fan-out and saves
  safe status reasons/counts. Effect: bounded provider budget reaches more
  campaign findings without sharing metrics or increasing caps. Risk: prioritizing
  observed history cannot establish future demand; live provider latency/quality
  untested. Verified by synthetic fan-out, 2,001-group, timeout/error cases and review.
- `test/volume-recovery-evidence.test.ts`: Replaces invented direct-keyword mocks
  with the supported attachment path and tests index/cap independence. Test-only;
  synthetic field fixtures do not prove Google accepts a query. Verified in all
  33 focused cases and the full 217-case test run (one existing skip).
- `test/volume-recovery.test.ts`: Adds dedup/priority/status/goal regressions and
  removes obsolete direct-source baseline. Test-only; fake services do not prove
  CRM truth or deployed integration. Verified by focused/full checks and review.
- `docs/VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md`: Records this correction,
  authority, exact proof, backups, limits and this report while preserving prior
  history. No runtime operation; documentation drift is the risk. Verified
  against source, actual test output, contract comparison and scoped diff checks.

Portal per-file report and responsive evidence are recorded in its canonical
`docs/status.md` D-120 entry. No deployment or rerun is implied by either report.

## 23. Authorized D-120 Dev recovery-image release — 20 October 2026

Review findings: no remaining actionable source finding was reported in the
preceding independent review. Clean [PR #8 CI](https://github.com/Built-by-Shah-LLC/google-ads-negative-keyword-sweeper-tool/actions/runs/39334152025)
and merged-main [Rule release CI](https://github.com/Built-by-Shah-LLC/google-ads-negative-keyword-sweeper-tool/actions/runs/39334397065)
passed check/test/rule integrity. These are offline checks, not provider or
database acceptance. The previously recorded optional integration skip remains.

Shah explicitly authorized push/merge and Dev deployment for both repos, with
no job executions, migrations or Google Ads API reads/writes. Published branch
`fix/volume-recovery-evidence` at `ad60a91`, then merged
[PR #8](https://github.com/Built-by-Shah-LLC/google-ads-negative-keyword-sweeper-tool/pull/8)
without conflicts as `ae61410ade37a71ffc4814f0b520f99960124e35`. The merge tree
matches the tested feature tree. The primary feature branch fast-forwarded to
that verified remote main; unrelated user files and draft backups are untouched.
DEV-52 was read and remains **Work in progress**; no Jira mutation.

Cloud Build `11e3e4e7-b86b-419d-8aae-302ef40861ac` built the existing standard
Dockerfile from a clean Cloud Shell clone pinned to the merged commit, not the
dirty developer checkout. It published
`us-west1-docker.pkg.dev/built-ads-manager-dev/negative-keyword-sweeper/sweeper:recovery-ae61410`,
digest `sha256:da431a070e4a7a2e2d6dc24eb967796111e7166b31593827f6d6619b0fff97a2`.
Only the existing Dev `negative-keyword-sweeper-recovery` Job image was updated
in `us-west1`; no broad deployment script was used. Before/after spec comparison
found only the image and generated `client.knative.dev/nonce` changed. Command,
args, service identity, resources, retries, timeout, environment/secret references
and network settings were unchanged. Generation advanced 1 to 2. Execution
count stayed **3**, with the identical latest historical execution. No job was
executed, secret value read/changed, migration/grant/data repair performed,
schedule/IAM changed or Google Ads/model API called by this release. Daily and
manual jobs/tags were not updated. Companion web rollout is recorded in Ads
Manager's canonical `docs/status.md`; it does not start a recovery request.

The new worker is available for a later explicitly approved review. Old saved
reports remain immutable and retain their original gaps. Live source/model
compatibility, latency, fresh claim/persistence and full-load behavior were not
verified by this image update. Rollback can restore the previous compatible pin
`sha256:8372fdd286e7bfa28c6f8977440824aa76ede4a3ffbdd8317ff2ddf367f1dc29`
without running work or deleting reports; no rollback or production deploy ran.

File-by-file release change: `docs/VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md`
alone records actual source publication, CI, build, immutable image update,
configuration/execution-count verification and remaining gates. Why: preserve
the earlier local-only handoff while recording what really deployed. No runtime,
schema or policy behavior is changed by this documentation follow-up. Risk is
record drift if another operator changes the job; no new compatibility impact.
Verified against Git ancestry/tree equality, GitHub merge/CI results, Cloud Build
metadata and before/after Cloud Run configuration. The eight implementation
files and their individual risks/proof remain reported in section 22.

## 24. Classification verification implementation — 20 October 2026

### Review findings and operating boundary

The initial red validator regression reproduced an array-valued category
passing as a string. Strict category/competitor types and nonblank reasons now
fail closed. Independent fallback correctness/security reviews both identified
one P2 in the new optional evaluator: normalized missing usage looked like a
zero-cost response. A second red test reproduced it; the fix preserves explicit
usage availability without changing existing normalized runtime totals. Missing
input/output usage means unknown cost/budget, and missing/invalid cache stays
unknown with conservative pricing. Explicit reported zero remains zero.

Both fallback reviews reported no remaining actionable findings after the
fix; security independently passed 42 Sweeper / 17 API tests and eight extra
in-memory usage-edge assertions. Requested native-bot/main publication gates
remain pending. These reviewers are **not** native Bugbot or
Security Review: their launchers are not exposed in this session. Shah was
asked whether independent reviews may substitute before merge; no waiver is
assumed. This entry does not claim a main merge, CI pass or deployment.

DEV-52 and DEV-53 were read as **Work in progress**; no Jira write. Current
authority permits implementation and source publication/merge after required
verification, not migration execution, Google Ads reads/writes, paid model
requests, live DB access/repairs, Cloud Run jobs or deployment. None of those
prohibited operations was performed. Existing user files remain excluded.

### Verification actually run

- Real prompt -> Moonshot fake HTTP -> parser -> validator -> production
  collection/orchestration/analysis -> in-memory saved contract is covered.
  The fixture has 26 CSV-grounded findings / 25 unique semantic inputs; policy,
  identities, attachments and query responses are explicitly synthetic, not an
  original-account replay. No earlier Sweeper run is assumed.
- Focused recovery suite: **71 passed**. Existing Moonshot tests plus new
  classifier/evaluator tests: **42 passed**. Full `npm run check`, `npm test`
  and `npm run build` passed: **254 passed, one optional DB integration skip**
  (255 total). DB integration was explicitly disabled/unconfigured.
- Portal: targeted API **17** and table **18** passed; all five typechecks and
  **1,012 tests** passed; optimized preview workspace build passed with DB
  variables removed. Portal docs gate remains blocked by the pre-existing
  unrelated untracked `agents/` directory, which was not hidden or removed.
  The user's generated `next-env.d.ts` was restored byte-for-byte after build.
- Worker/portal contract files and saved-finding fixtures compare
  byte-identically. Scoped whitespace checks passed. No production UI
  component/layout changed; no new responsive/browser/download check is claimed.
- Fake responses prove integration and fail-closed behavior, **not actual
  model semantic accuracy**, PostgreSQL grants/RLS/concurrency, real GAQL,
  Cloud Run IAM, latency, full-load behavior or deployed end-to-end success.
  The opt-in one-batch evaluator is prepared and tested offline, not run live.

### Complete Sweeper file-by-file change report

All verification below is local/offline unless a later publication record
explicitly says otherwise. No migration, deployment or live data repair is
implied by a code/test change.

1. `src/volume-recovery/classifier.ts`: adds the existing optional dispatcher
   seam, strict string validation and trimmed nonempty reasons, and forwards
   usage-availability flags. Why: exercise the real chain and reject coerced
   output. Consequence: malformed batches now remain unclassified; valid
   callers and report contracts are unchanged. Risk/tradeoff: stricter output
   can increase honest partial results; it never invents a fallback category.
   Verified by red/green malformed-shape, HTTP/parser and whole-pipeline tests.
2. `src/llm/moonshot-classifier.ts`: structured completion adds code-owned
   main/cache-usage availability flags while retaining normalized usage. Why:
   zero defaults are not billing evidence. Consequence: the evaluator can
   report unknown cost without exposing raw provider data; normal sweep
   classification/token normalization is unchanged. Additive internal return
   fields need no migration. Verified by existing Moonshot and new missing,
   malformed, partial, explicit-zero and invalid-cache response tests.
3. `scripts/evaluate-recovery-classification.ts`: prepares one opt-in reference
   batch through the real recovery adapter. It validates fixture/cost consent,
   budget and supplied pricing before provider construction, allows zero
   retries, imports no Ads/DB entrypoints, and reports hashes/settings/usage/
   estimated cost, clear versus ambiguous agreement and disagreements. Why:
   future semantic evaluation without rerunning an account. Risk: paid/data-
   sharing operation if separately approved and invoked; planning cost is not
   a billing cap, and explanation quality still needs human review. Real-model
   quality is unverified. Verified only with fake transport/refusal tests.
4. `test/fixtures/recovery-classification.json`: pins 26 selected CSV rows and
   25 unique inputs, values/nulls, expected meanings/allowed uncertainty and
   fictional body/paint policy. Why: realistic multilingual/service/employment/
   competitor/no-history regressions without private account identities.
   No runtime policy changes. Risk: narrow reference set, not all-account
   ground truth; original relationships/raw data are unavailable. Verified
   against selected CSV records and fixture/pipeline assertions.
5. `test/fixtures/recovery-classified-finding.json`: pins one actual serialized
   offline worker finding and mirrors it in the portal. Why: bridge report
   contracts without live DB/cloud. Test-only synthetic identity/context; must
   be updated intentionally if behavior changes. Verified by deep equality to
   whole-pipeline output and byte comparison with the portal fixture.
6. `test/helpers/recovery-classification.ts`: reconstructs explicitly synthetic
   source rows, real-parser fake HTTP replies, isolated campaign/list identities
   and an in-memory store. Why: reuse one bounded offline harness. Blank-channel
   terms stay unattached; per-campaign metrics never share semantic fan-out.
   Risk: cannot verify actual Ads resources or Postgres behavior. Verified by
   collection/request assertions and all focused pipeline tests.
7. `test/recovery-classifier-validation.test.ts`: small direct validator
   regression for coerced arrays and whitespace reasons. Why: preserve the
   reproduced trust-boundary bug. No runtime effect; only the named shapes are
   proved here. Failed before the fix and passes after it/full suite.
8. `test/volume-recovery-classification.test.ts`: adds real adapter/parser and
   whole-orchestration regressions for policy/input/schema/IDs, malicious
   synthetic data, usage, 25/26 batches, fan-out, 2,001 inputs/outcome priority,
   fake-clock limits, partial/all failures, taxonomy, no history and policy/
   evidence vetoes/accounting. Why: test delivery, not just injected accepted
   intents. No live endpoints/storage. Risk: synthetic success is not semantic
   accuracy or production capacity proof. Verified by focused and full runs.
9. `test/recovery-classification-evaluation.test.ts`: covers default refusal,
   consent/budget/no-retry gates, real-adapter fake trial, individual
   disagreement reporting, usage/cache/cost and missing-versus-zero cases.
   Why: keep optional paid tooling fail-closed and honest. No paid trial is run;
   provider pricing/billing remain unverified. All five tests pass offline.
10. `README.md`: documents focused checks, opt-in approval/configuration,
    pricing basis, sensitive output and uncertainty. Why: prevent accidental
    paid execution and inflated accuracy claims. Documentation only; operators
    must supply separately approved current rates/text/model. Verified against
    script guards and tests; no command with paid approval was executed.
11. `docs/VOLUME_RECOVERY_CLASSIFICATION_VERIFICATION_PLAN.md`: preserves the
    supplied plan and original observations, marks local acceptance evidence,
    and adds an implementation record. Why: distinguish the original planning
    turn from later work. No live report is repaired; private full CSV is not
    committed. Risk: evidence ages; review/publication status remains explicit.
    Verified against actual commands, source and fixture provenance.
12. `docs/VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md`: this canonical handoff links
    scope, findings, tests, file effects, limits and publication gates. Why:
    durable truthful DEV-52 evidence. Documentation only; no operational state
    changes. Risk: future releases must update state rather than infer from
    these offline results. Verified against the observed tests/review records.

Companion portal changes, their per-file risks and proof are recorded in its
`docs/status.md` D-121 entry. The compact table source is unchanged; CSV grows
from 36 to 41 columns, with fixed safe notes instead of arbitrary model prose.

## 25. Authorized D-121 main publication and Dev rollout — 20 October 2026

Release completed in Dev. Shah explicitly directed merging both PRs, deploying to
the established Dev targets and monitoring CI after the fallback-review
handoff. This accepts the completed independent reviews in context, not a
claim that native Bugbot/Security Review ran. No remaining actionable source
finding was reported. No migration, Google Ads API read/write, new paid model
request, recovery execution, IAM/grant change or database repair is authorized.

Sweeper [PR #10](https://github.com/Built-by-Shah-LLC/google-ads-negative-keyword-sweeper-tool/pull/10)
merged exact tested head `c404d675f28a840ac7441487bfe70cafbaf5300c` as
`71c9d47e6b1eec271af04e5b5e6654ee34c48e43`. Portal
[PR #42](https://github.com/Built-by-Shah-LLC/built-ads-manager/pull/42)
merged exact tested head `6f112f5f5b7e76762fddc2d0ec24b5cd2c9bee30` as
`4c5527077040ebf84909f6670106dc584fa03a3b`. PR CI passed; readback/tree
comparison confirms both merges equal their tested feature trees. Primary
feature checkouts fast-forwarded to remote main; unrelated dirty files remain
preserved and excluded. No conflict resolution, reset or linked worktree.

Sweeper main [CI](https://github.com/Built-by-Shah-LLC/google-ads-negative-keyword-sweeper-tool/actions/runs/39342188415)
passed, as did portal main
[CI](https://github.com/Built-by-Shah-LLC/built-ads-manager/actions/runs/39342196587).
The release captures existing web revision `bam-dev-web-00107-5cq` and recovery
digest `sha256:da431a070e4a7a2e2d6dc24eb967796111e7166b31593827f6d6619b0fff97a2`
before changes. Recovery execution count is three with the same historical
latest execution `negative-keyword-sweeper-recovery-lwrhn`.

A clean Cloud Shell clone pinned to merged Sweeper `71c9d47` built successfully
with the standard Dockerfile in Cloud Build
`08158345-6d4a-4286-973e-18709dde517d`. Only Dev Job
`negative-keyword-sweeper-recovery` was updated to immutable digest
`sha256:fbd361bace15661eca93b8f85d0d6a4b14573e4cf3a5cb67a33f66a87f0a41ac`.
Readback normalized only the image and generated client nonce; the remaining
complete Job spec matched exactly. Generation advanced 2 to 3. Execution count
stayed three and the latest historical execution was identical. Command/args,
identity, env/secret references, limits and private networking stayed unchanged.
No job was executed and no broad daily/manual deploy script was used. No other
job, schedule, IAM policy or secret value was changed. Normal daily/manual
images/tags were not updated.

The web-only [Dev workflow](https://github.com/Built-by-Shah-LLC/built-ads-manager/actions/runs/39342522502)
succeeded from merged portal `4c55270`. Readback shows ready revision
`bam-dev-web-00108-7h6` at 100% traffic, image digest
`sha256:4c8f098d272d6380191eb6e739921de849b5d591a00ae7bb656b9c4cb55af567`.
Identity, environment/secret references, resources, network, private-range
egress and invoker setting matched the preceding revision. All three recovery
target settings survived. An independent public `/api/health` returned `ok`;
source inspection confirms this checks only PostgreSQL `SELECT 1`, not Ads.

The deployment has one non-blocking GitHub annotation: the pinned Google auth/
setup actions declare Node 20 and were forced onto Node 24. Every step passed;
no action pin or workflow was changed here. Review their runtime compatibility
in a separate maintenance change, not as an unverified release modification.

Semantic accuracy, fresh worker collection/persistence, live GAQL/provider
compatibility, browser CSV download/SSO/RLS and production acceptance remain
unverified. No paid evaluation or fresh review was run. Existing reports are
immutable; the portal's new CSV projection does not reclassify them. DEV-52/
DEV-53 were read again as Work in progress; no Jira mutation. Rollback can
restore preceding web revision `bam-dev-web-00107-5cq` and the captured prior
Job pin without executing work; no rollback or production deployment ran.

### Release-only file-by-file report

No runtime source, SQL, rule, package or deployment workflow changed in this
release-record follow-up; those tested changes are reported in section 24.

- `README.md`: replaces the stale not-deployed sentence with the canonical
  release-state pointer. Why: offline proof and actual rollout are different.
  Documentation only; no new execution authority or compatibility impact.
  Risk is future record drift. Verified against the completed rollout records.
- `docs/VOLUME_RECOVERY_CLASSIFICATION_VERIFICATION_PLAN.md`: marks the approved
  source/Dev delivery and links actual evidence, preserving the original mock-
  versus-model distinction. Documentation only; no live report repair or
  semantic certification. Verified against merge/CI/config/health readback;
  future model evaluation remains separately approved.
- `docs/VOLUME_RECOVERY_IMPLEMENTATION_PLAN.md`: this section records exact
  commits, CI, build/digests, config comparison, no-execution proof, rollback
  targets and remaining limits. Why: durable truthful DEV-52 handoff. No runtime
  effect; later changes can age the snapshot. Verified against Git tree equality,
  GitHub results and Cloud Run/Build metadata. Scoped whitespace checks passed.

Companion portal release files and individual risks/proof are recorded in its
current `docs/status.md`. The owned Cloud Shell build checkout is temporary;
it is not a linked user worktree or the dirty developer source.
