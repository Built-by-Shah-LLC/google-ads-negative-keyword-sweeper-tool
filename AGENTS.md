# BBS Keyword Sweeper — agent operating contract

## BBS Jira delivery workflow

**Mandatory for every bug, task, feature, update, review, test, release, or
deployment request:** read and apply
[.agents/skills/bbs-jira-delivery/SKILL.md](.agents/skills/bbs-jira-delivery/SKILL.md)
before planning or editing. Read its
[repository profile](.agents/skills/bbs-jira-delivery/REPO-PROFILES.md) before
choosing verification, review, or release steps.

Use Jira project **BBS Software Support** (`DEV`) with the
`bbs-keyword-sweeper` label. Write Jira descriptions as structured rich text,
keep issue status truthful, and preserve unrelated working-tree changes.

## Repository safeguards

- Read applicable architecture, policy, deployment, and test documentation
  before changing an affected workflow.
- Run the profile's relevant checks and targeted tests. Add
  `npm run rules:check` for rule-release or account-policy compilation work.
- Treat normal work as non-mutating. Do not run validation or test-account
  mutation tooling without scoped approval; production Google Ads mutations
  require separate live-operation approval.
- Do not create Jira cloud changes, push, merge, deploy, run migrations, or
  make other external mutations without explicit approval.
- At handoff, state the Jira key/status, changed behavior, review findings,
  evidence actually run, deployment status, and any remaining risks.
