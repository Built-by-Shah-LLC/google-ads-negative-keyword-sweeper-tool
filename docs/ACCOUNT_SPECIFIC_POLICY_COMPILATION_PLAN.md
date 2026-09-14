# Account-specific rules and phrase-protection plan

Status: Proposed

## Goal

Generate an effective policy bundle for every selected Google Ads account. Each
bundle will contain:

1. A `rules.md` document composed from the agency-wide base rules and rules that
   apply only to that account.
2. A `phrase-protections.md` document composed from agency-wide protections and
   protections that apply only to that account.

The exact generated documents will be sent to the LLM and retained with the run
for auditability. Generated account documents are runtime artifacts; they are not
separate hand-maintained copies of the base policy.

This design supports:

- base policy shared by every account;
- account-specific approved services, such as windshield work, hail repair, and
  frame repair;
- account-specific custom rules;
- directional competitor relationships among companies under the same MCC;
- companies that opt in or out of appearing as a configured competitor for other
  MCC accounts; and
- narrow exceptions to a negative rule without disabling unrelated negative
  evidence.

## Current behavior

The current application loads one global Markdown rule set and one global phrase-
protection file before account discovery. A phrase-protection entry can already be
limited by `customerIds`, and the prompt filters those entries for the current
account. The rest of the rule set, its run artifact, its database snapshot, and the
workbook rule section are global for the entire run.

The proposed compiler moves account scoping earlier. It creates one complete,
validated effective policy bundle before fixed-token counting and classification
for each account.

## Terminology and identity

- **Tenant organization:** the Built Ads Manager tenant. This is distinct from a
  Google Ads client account.
- **Account/company:** an enabled leaf Google Ads account under the MCC.
- **Customer ID:** the canonical ten-digit Google Ads customer ID without hyphens.
- **Base policy:** rules and phrase protections that apply to every account.
- **Account policy:** trusted configuration keyed by customer ID.
- **Effective policy:** the deterministic combination of base policy and one
  account policy.

Account configuration must be keyed by customer ID, not company name. Account
names can change and are supplied by Google Ads, while the configured customer ID
is the stable policy identity.

## Proposed source configuration

Use a typed dictionary for company identity and another for account policy. Brand
aliases must be explicitly configured; they must not be inferred from an untrusted
Google Ads descriptive name.

```ts
interface CompanyProfile {
  policyKey: string;
  competitorAliases: string[];
  canAppearAsCompetitor: boolean;
}

interface AccountPolicyConfig {
  revision: string;
  approvedServices: ApprovedServiceKey[];
  competitorAccountIds: string[];
  nonCompetitorAccountIds: string[];
  customRules: AccountRuleDefinition[];
  phraseProtections: AccountPhraseProtectionDefinition[];
}

export const COMPANY_PROFILES: Record<string, CompanyProfile> = {
  "1111111111": {
    policyKey: "company-a",
    competitorAliases: ["Company A", "Company A Collision"],
    canAppearAsCompetitor: true
  },
  "2222222222": {
    policyKey: "company-b",
    competitorAliases: ["Company B"],
    canAppearAsCompetitor: false
  }
};

export const ACCOUNT_POLICIES: Record<string, AccountPolicyConfig> = {
  "3333333333": {
    revision: "2026-09-14.1",
    approvedServices: ["windshield", "hail-repair", "frame-repair"],
    competitorAccountIds: ["1111111111"],
    nonCompetitorAccountIds: ["2222222222"],
    customRules: [],
    phraseProtections: []
  }
};
```

The initial implementation may keep these dictionaries in a TypeScript module.
The release manifest must hash the exact source or its canonical serialized form.

## Directional MCC competitor relationships

Competitor membership is directional. If Company A is a configured competitor of
Company B, Company B does not automatically become a configured competitor of
Company A.

When compiling the effective policy for target account B, another MCC account A
is included as an explicit competitor only when all of the following are true:

1. A is not B itself.
2. A has `canAppearAsCompetitor: true`.
3. B lists A in `competitorAccountIds`.
4. A has at least one validated competitor alias.

The compiler expands A's aliases into a target-account competitor rule. Queries
that clearly contain those aliases can then be classified under an account-specific
`-NEGATIVE` rule or the existing `POL-COMPETITOR-NEGATIVE` policy, depending on the
final rule-template design.

The safe default is not to add an MCC company to another account's explicit
competitor list. A reference to a company whose `canAppearAsCompetitor` value is
false is a configuration error rather than a silently ignored relationship.

### Explicit non-competitor relationships

Omitting a company from `competitorAccountIds` means only that it is not explicitly
listed. The global competitor rule may still recognize a distinctive business name
from the query itself.

`nonCompetitorAccountIds` has stronger semantics. For each referenced company, the
compiler generates account-scoped phrase protections for its configured aliases
against `POL-COMPETITOR-NEGATIVE`. This prevents the alias alone from being used as
competitor evidence for the target account.

That protection is not an automatic `KEEP`. A brand-only query may still be
negative under `POL-NO-SERVICE-SIGNAL-NEGATIVE`, and any independent negative
evidence remains effective. If a protected brand must also establish positive
service intent, it needs an account-specific KEEP rule.

## Approved-service templates

Approved services should be declared through reviewed templates so an account
cannot accidentally add a KEEP rule without also neutralizing the relevant base
negative rule.

Conceptually:

```ts
const APPROVED_SERVICE_TEMPLATES = {
  windshield: {
    phrases: ["windshield repair", "windshield replacement"],
    keepRule: {
      title: "Approved windshield services",
      instruction: "KEEP clear demand for the account's approved windshield services."
    },
    protectsAgainst: ["POL-GLASS-TINT-NEGATIVE"]
  },
  "frame-repair": {
    phrases: ["frame repair", "frame straightening"],
    keepRule: {
      title: "Approved frame repair services",
      instruction: "KEEP clear demand for the account's approved frame-repair services."
    },
    protectsAgainst: [
      "POL-PARTS-ONLY-NEGATIVE",
      "POL-MECHANICAL-ONLY-NEGATIVE"
    ]
  }
};
```

The exact phrases and rules for hail repair must be reviewed against the current
cosmetic, paint, parts, and collision rules before its template is approved.
Templates must list phrase variants explicitly. Existing normalization covers case,
punctuation, whitespace, and Unicode normalization, but it intentionally does not
infer plurals, synonyms, fuzzy matches, or reordered terms.

## Phrase-protection semantics

A phrase protection excuses only specified evidence under one specified negative
rule. It never:

- creates a decision before the LLM runs;
- automatically forces `KEEP`;
- disables an entire rule;
- removes words from the submitted query; or
- suppresses independent evidence under the same or another negative rule.

For example, an account that offers windshield replacement needs both an approved
windshield KEEP rule and a protection against `POL-GLASS-TINT-NEGATIVE`. A query
such as `cheap windshield replacement` can still be negative under the price-
shopping rule.

One phrase may need multiple protection entries when multiple base rules would
otherwise reject it. Frame repair is a likely example because the current policy
can treat it as both named-part demand and generic repair without a collision/body
signal.

## Effective-policy compilation

Introduce a policy catalog loader and a pure account compiler:

```ts
loadPolicyCatalog(rootDirectory): Promise<PolicyCatalog>

compileAccountPolicy(
  catalog: PolicyCatalog,
  organization: Organization
): EffectiveAccountPolicy
```

Compilation will:

1. Select the account policy by canonical customer ID, using base-only behavior
   when no account entry exists.
2. Expand approved-service templates.
3. Resolve permitted directional competitor relationships and configured aliases.
4. Expand explicit non-competitor protections.
5. Add custom account rules and custom account protections.
6. Append generated account rule sections to the base rules in deterministic order.
7. Combine base and account phrase protections in deterministic order.
8. Parse and validate the two generated Markdown documents as one policy bundle.
9. Calculate an effective SHA-256 hash from canonical bundle content.

Generated rule IDs must be stable, uppercase, unique within the effective bundle,
and end in `-KEEP` or `-NEGATIVE` so existing response validation remains valid.
Account-specific rule IDs should include the stable `policyKey`, not the mutable
descriptive name.

## Pipeline integration

The run pipeline will load and validate the policy catalog once at startup. After
account discovery and selection, it will compile an effective policy for each
selected account before that account is processed.

Each account's effective bundle must be used consistently for:

- fixed-input token counting;
- prompt construction;
- response-schema rule-ID enumeration;
- decision validation;
- LLM batch request artifacts;
- decision artifacts and CSV output;
- mutation preparation and audit evidence;
- database persistence; and
- the account's workbook sheet.

The LLM prompt will receive the exact effective `rules.md`, the exact effective
`phrase-protections.md`, and the trusted per-item protection match map. Policy for
one account must never appear in another account's prompt.

Scripts that currently load the global rule set directly must either accept a
customer ID and compile that account's policy or explicitly select a base-only
evaluation mode. They must not silently evaluate an arbitrary account policy.

## Run artifacts

Every selected account will receive these policy artifacts, including an account
that has only base policy:

```text
runs/<run-id>/organizations/<customer-id>/
  rules.md
  phrase-protections.md
  policy-manifest.json
  decisions.json
  llm-decisions.csv
```

`policy-manifest.json` will record:

- base rule version and prompt version;
- policy release ID;
- account policy key and revision, or `null` for base-only;
- source paths;
- included approved-service keys;
- referenced competitor and non-competitor account IDs;
- rule and protection counts; and
- the effective policy hash.

The run-level artifact should preserve the base/catalog release rather than imply
that one effective account policy governed every account.

## Database persistence

The current schema links one rule snapshot to the entire sweep run. Because this
proposal allows different effective bundles in the same run, persistence must also
identify policy at the account-run level.

Add an organization-aware `rule_snapshot_id` foreign key to
`negative_keyword_sweep_account_runs`. During `prepareAccount`, upsert the effective
policy into `negative_keyword_rule_snapshots` by canonical content hash and attach
that snapshot to the account run.

The run-level snapshot can continue to identify the validated base/catalog release.
The account-level snapshot identifies the exact policy used for classification.
The migration and associated RLS, foreign-key, grants, and migration tests belong
in the Built Ads Manager database package.

## Release and integrity controls

Extend the release manifest to cover:

- base rules Markdown;
- base phrase-protection Markdown;
- company profiles;
- account-policy configuration;
- approved-service templates; and
- a compiler-format version.

Any source change must produce a new policy release ID. Each modified account entry
must also receive a new account-policy revision. Startup must reject a hash mismatch
before account discovery or LLM spend.

The release checker should retain the current global policy budgets and add scoped
budgets for account-policy changes. A change for one account must not require an
unrelated global rule-version change, but it must remain reviewable and auditable.

## Required validation

Compilation must fail closed on:

- malformed or noncanonical customer IDs;
- duplicate policy keys, rule IDs, or protection IDs;
- self-competitor relationships;
- unknown referenced accounts;
- competitor relationships to an opted-out source company;
- the same account in both competitor and non-competitor lists;
- empty, duplicate, or invalid competitor aliases;
- rule IDs whose suffix conflicts with their decision type;
- protections that reference an unknown or non-negative rule;
- account rules that collide with base rules; and
- release or effective-policy hash inconsistencies.

## Test plan

Add deterministic tests for:

1. Base-only account compilation.
2. Correct base-plus-account document ordering and repeatable hashes.
3. Directional competitor relationships.
4. Source-company competitor opt-in and opt-out behavior.
5. Self-reference, unknown-account, and contradictory relationship rejection.
6. Explicit non-competitor protections and whole-token boundaries.
7. No cross-account rules, aliases, or protections in prompts.
8. Approved-service rule/protection pairing.
9. Windshield KEEP eligibility for an enabled account and normal base behavior for
   another account.
10. Independent negative evidence such as `cheap windshield replacement` remaining
    effective.
11. Frame repair receiving every required protection rather than only one.
12. Dynamic rule IDs being accepted by response schema and decision validation.
13. Per-account artifact, workbook, and database snapshot correctness.
14. Release-manifest tamper detection and account revision enforcement.

Deterministic tests verify configuration, prompt construction, and pipeline
contracts; they do not prove model accuracy. New service and competitor behavior
must also be evaluated against labeled examples before production mutation is
enabled.

## Rollout

1. Implement the compiler and base-only compatibility path without changing
   production behavior.
2. Add account artifacts and prompt isolation tests.
3. Add database migration and per-account snapshot persistence.
4. Configure one approved service for one test or low-risk account.
5. Run read-only classification and compare it against the current base-only result.
6. Add one directional competitor relationship and review all changed decisions.
7. Expand to a small named cohort before enabling the configuration for all intended
   MCC accounts.
8. Keep production mutation disabled for every new policy release until its outputs,
   policy artifacts, and account scope have been reviewed.

## Acceptance criteria

- Every selected account has exactly one deterministic effective rules document and
  one deterministic effective phrase-protection document.
- The LLM, validator, artifacts, workbook, and database all use the same effective
  policy hash for an account.
- Base-only accounts retain current behavior.
- Account-specific services do not leak across accounts.
- Competitor relationships are directional, exclude self, and respect source-company
  opt-in.
- Explicit non-competitor relationships neutralize only competitor evidence and do
  not manufacture KEEP decisions.
- Independent negative evidence remains active after a phrase protection matches.
- Invalid or unapproved policy configuration fails before LLM spend or Google Ads
  mutation.
