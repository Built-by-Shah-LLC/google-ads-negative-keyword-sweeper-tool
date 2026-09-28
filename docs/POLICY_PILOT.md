# Controlled dynamic-policy pilot

This is the DEV-6 evidence workflow. It is source documentation, not approval to
run a provider, database migration, deployment, or Google Ads command.

## Declaration and runs

Create a reviewed JSON declaration for one named account containing the exact
canonical customer ID, requested date, candidate limit, `mutationMode` set to
`disabled`, and the current phase. Select the same explicit `--customer`,
`--date`, and `--candidate-limit-per-organization` for both runs.

Run the baseline with `--policy-mode base-only --pilot-declaration <path>` and
the candidate with `--policy-mode effective --pilot-declaration <path>`. Do not
use MCC-wide discovery, the scheduler, or an armed mutation writer. Preserve each
manifest, `rules.md`, phrase-protection JSON/Markdown, decisions, safe logs, and
durable evidence identifiers.

## Offline review

Use `npm run pilot:review -- --declaration <completed-evidence.json> --baseline
<baseline-decisions.json> --policy <policy-decisions.json> --output
<review.json>`. The completed evidence declaration must include both durable
account-run IDs and affirmative persistence, artifact, and token-reconciliation
checks. Review every delta and assign one
of: `expected`, `defect`, `policy_clarification`, or `model_concern`. The report
remains review-required until none are unclassified.

Stop for any account/date/candidate-bound mismatch, mutation evidence, missing
artifact or database evidence, revision/hash mismatch, phrase-protection leakage,
unexpected candidate inflation, or unexplained decision change. Go-live requires
zero unresolved defects or leakage, reconciled totals, documented cohort/risk/
rollback, and explicit Owner signoff.

No pilot or Sweeper test was executed while this workflow was implemented.
