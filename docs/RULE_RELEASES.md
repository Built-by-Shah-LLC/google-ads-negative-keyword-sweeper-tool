# Rule stability and controlled releases

## Stable baseline

The owner designated `2026-09-04.3` stable on 2026-09-09 based on their existing
accuracy assessment. `src/config/stable/2026-09-04.3.md` preserves the exact
original bytes. This is an owner designation, not a new measured accuracy claim.
`src/config/rule-release.json` records the baseline hash and released policy and
phrase-protection hashes. Candidate release `2026-09-09.2` uses rule version
`2026-09-09.1` and prompt version `collision-classifier-v7`. Only the active rule
preamble and version metadata changed; all individual rule sections remain intact.
It replaces the earlier, undeployed unconditional KEEP design with two conditional
phrase exceptions in `src/config/phrase-protections.md`.
The baseline must never be edited; future stable snapshots get new filenames.

Candidate release `2026-09-09.3` adds the explicitly configured plural phrase
`collision services` globally with the same narrowly scoped mechanical-evidence
exception as `collision service`. Other exclusions still apply. The rule and
prompt versions are unchanged. Updated fixture labels describe intended behavior;
the earlier live comparison does not evaluate this new release.

## Enforced locally

- Application startup rejects policy or phrase-protection content that differs from the
  release manifest. Malformed phrase-protection entries also stop loading.
- Container builds verify the same release integrity. The deployment script checks
  integrity and cumulative change limits against its required `-ApprovedBaseCommit`
  before its first cloud action. That commit must identify the previous approved
  release; repository review must verify it.
- `npm run rules:check -- <base-commit>` checks cumulative changes against a base:
  at most one rule section or preamble, 40 added/deleted policy lines, and five
  phrase-protection additions/edits/removals. Version metadata is excluded from the section
  count, but included in the line budget. Rule text changes require a new version; policy bundle changes require a new
  releaseId.
- The GitHub workflow runs type checking, tests, integrity, and change budgets.
  These are size guardrails, not evidence of business safety: one word can change
  many decisions. Updating a hash is not an independent approval.

## Conditional evidence exceptions

Each manually maintained entry specifies a phrase, a negative rule ID, the exact
evidence it excuses, and optional customer IDs. Empty IDs means all accounts.
Code matches contiguous whole tokens after case, punctuation, whitespace, and
Unicode NFKC normalization. Longer queries and location modifiers need no extra
entries. Substrings, plurals, reordered words, and synonyms are not expanded.
Only search terms activate entries, never campaign or matched-keyword text.

The prompt includes account-scoped definitions and a trusted per-item match map.
Only matched entries apply. Every candidate still reaches the LLM with its complete
original text. The model must evaluate all remaining independent exclusions,
including additional evidence under the same rule. It must not count rule IDs,
skip a whole rule, remove the phrase, or force KEEP. Decisions cite existing rule
IDs; there is no synthetic KEEP rule or deterministic confidence.

- `collision service` excuses only `service` describing collision repair under
  `POL-MECHANICAL-ONLY-NEGATIVE`. `mechanic collision service` and `collision
  service and brake service` still have independent mechanical evidence.
- `collision experts` excuses only `experts` describing collision expertise under
  `POL-COMPETITOR-NEGATIVE`. `steve collision experts` still has competitor evidence.
- `mobile collision service` and `collision experts reviews` retain their mobile
  and reviews exclusions. Unambiguous locations such as NYC and Texas do not
  require new phrase entries.

The standard per-batch input/output artifacts retain rules, configured entries,
provider requests, and model decisions. `decisions.json` includes the release ID.
The removed `always-keep-decisions.json` is no longer written. Existing consumers
of that special artifact must use ordinary model outputs instead. Scripts using
`loadRuleSet` and the shared prompt builder now receive protections too. Callers
that only parse raw Markdown must explicitly load the full release bundle.
On provider failure, matched candidates fail normally; no KEEP is manufactured.
Fixed-token counts include configured definitions; per-item matches are variable
input. This design costs model tokens for every candidate and relies on model
compliance, not a deterministic guarantee of the final classification.

## Verification and live evaluation

Unit tests cover phrase selection, boundaries, account scope, strict config,
release integrity, complete LLM submission, failure behavior and prompt contract.
They do not establish classification accuracy. Synthetic examples and expected
outcomes live in `test/fixtures/phrase-protection-cases.json`; extra diagnostic
examples extend the owner's seven required cases.

Run `node --import tsx scripts/evaluate-phrase-protections.ts --live` explicitly
for paid evaluation on the configured provider. It sends only synthetic fixtures,
runs stable and candidate conditions twice, and writes exact prompts, model
responses, usage, and fixture agreement under `runs/phrase-protection-eval-*`.
The stable condition uses the unchanged stable Markdown with the current prompt
scaffold and no protections, so it is not a historical prompt replay. Synthetic
agreement does not establish production accuracy or authorize promotion.

## Required external enforcement — not configured by this change

Configure the repository's actual default branch to require the `policy-check`
job, owner review, dismissal of stale approvals and approval after the last push.
Protect policy files, manifest, tests, workflow, Dockerfile, pipeline and deployment
scripts with real business-owner and engineering-owner reviewers. Restrict direct
pushes and bypass permissions, including administrators where supported. No
placeholder CODEOWNERS identity is supplied because reviewer handles are unknown.
Restrict cloud deployment credentials to an approved release process. A developer
who can edit both the check and manifest or deploy arbitrary images can bypass
repository-only controls. Review the workflow branch name if the default is not
`main`. Avoid merging several policy releases before the preceding one is observed.

## Rollout procedure

1. Propose one business hypothesis per PR. Add explicit positive, negative, boundary,
   and account-scope examples. Start phrase exceptions with narrow evidence and account scope
   unless global application was explicitly approved. Keep unrelated model or
   prompt changes out of policy releases.
2. Compare stable and candidate outputs over the same saved terms, model settings,
   and account distribution. Review every changed decision, spend and conversions
   affected, and conflicts with existing negative rules. Run repeated evaluations
   where stochastic outputs matter. Owner defines acceptable error thresholds;
   there is no numeric business threshold established by this implementation.
3. Record evidence and owner signoff in the PR. Update the manifest hashes for the
   exact approved files and give every combined release a unique releaseId. Run
   `npm run rules:check -- <base-commit>`, `npm run check`, and `npm test`.
4. First run manually for one explicitly selected account/date. Existing
   `ACCOUNT_ALLOWLIST` can restrict a separate canary job; verify its resolved scope
   before execution. Keep candidate outputs out of any downstream negative upload.
   Do not use the all-organization production scheduler for first exposure.
5. After owner review, expand to a small named account cohort, observe a complete
   run, then expand deliberately. Record account IDs, run IDs, releaseId, image
   digest, counts and changed-decision evidence at each stage. Stop on unexplained
   changes or incomplete output. There is no automatic promotion in this change.
6. Roll back by restoring the previous reviewed image digest and its policy bundle,
   or reverting the release commit as a reviewed emergency change. Pause downstream
   imports first. This application is read-only: rollback cannot remove negatives
   already imported by another system; those require a separate reviewed repair.

Do not use mutable `latest` as a rollback identifier. The existing deployment
script still uses `latest`; record the built image digest from the deployment and
retain that artifact before rollout. This change did not deploy, alter cloud IAM,
configure branch protection, run business evaluations, or apply Google Ads changes.
