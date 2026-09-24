---
name: bbs-jira-delivery
description: Manages the BBS Jira-to-delivery workflow for bugs, tasks, updates, features, testing, review, and deployment work in the four BBS repositories.
---

# BBS Jira Delivery

Use Jira project **BBS Software Support** (`DEV`) as the delivery record for work across the four BBS repositories. This skill governs the complete sequence:

1. Intake and ticket triage
2. Jira ticket creation or refinement
3. Implementation plan
4. Execution
5. Review and testing
6. Deployment preparation and release handoff

Read [REPO-PROFILES.md](REPO-PROFILES.md) before selecting a repository-specific test, review, or deployment procedure.

## Automatic entry point

Apply this workflow at the start of every bug, task, feature, update, review, test, release, or deployment request involving this repository or another BBS repository.

If the user supplies a `DEV-…` key, start from that ticket. Otherwise, search for a likely existing issue and, when none exists, prepare a new Jira ticket.

Do not ask questions already answered by the repository or current request. Ask only when a material choice is missing, such as product area, reproduction and expected result, acceptance decision, or target deployment environment.

## Jira conventions

Use project `DEV` and apply the label matching the active repository:

| Repository | Product | Jira label |
| --- | --- | --- |
| `custom-widgets` | BBS Widgets Software | `bbs-widgets-software` |
| `agency-portal` | BBS Client Agency Portal | `bbs-client-agency-portal` |
| `built-ads-manager` | BBS Ads Manager Platform | `bbs-ads-manager-platform` |
| `google-ads-negative-keyword-sweeper-tool` | BBS Keyword Sweeper | `bbs-keyword-sweeper` |

Write Jira descriptions as native rich text, never as an unstructured pasted block. Use real headings, bold inline labels, bulleted lists, and numbered acceptance and verification lists.

### Description template

Use the smallest complete version of this structure:

## Goal

**Outcome:** [user or business result]

## Context / current behaviour

- **Observed:** [what happens now]
- **Impact:** [who or what is affected]
- **Evidence:** [reproduction, logs, screenshot/video, or issue link]

## Scope

- [included change]

## Out of scope

- [explicit boundary]

## Implementation plan

1. [safe, testable step]
2. [safe, testable step]

## Acceptance criteria

1. [observable success condition]

## Verification

1. [automated check]
2. [manual or end-to-end check]

## Release / rollback notes

- **Environment:** [local, preview, staging, production]
- **Risk / rollback:** [only when applicable]

For a bug, prioritize reproduction, expected versus actual behavior, impact, and a regression test. For a feature or update, prioritize user outcome, scope boundaries, design/security constraints, and acceptance criteria.

## Lifecycle

### 1. Intake and triage

- Identify the repository, product, change type, and affected user or account.
- Inspect the working tree before editing and preserve unrelated user changes.
- Read this repository's `AGENTS.md`, applicable product and operations docs, and relevant tests.
- Check whether an existing Jira issue already covers the work.

### 2. Create or refine the Jira issue

- Draft a concise title and rich-text description before creating or replacing a Jira description.
- Add the correct product label, appropriate priority, and explicit boundaries.
- Keep status truthful: do not move work to Testing, Review, or Resolved without the matching evidence.
- Obtain required action-time confirmation before a Jira cloud change.

### 3. Plan before implementation

Present a brief implementation plan containing:

- files or modules likely to change;
- product, security, data, and operational constraints;
- test and review evidence required; and
- deployment environment, risk, and rollback path when relevant.

For Built Ads Manager, obey its source-of-truth hierarchy, feature-admission gate, scope ledger, documentation requirements, and safety boundaries. Do not silently expand product scope.

### 4. Execute

- Work only within the ticket's approved scope.
- Keep Jira aligned with reality; record material decisions, blockers, and scope changes.
- Implement the smallest coherent change and update code, tests, and required documentation together.
- Do not overwrite unrelated changes, run production data operations, or make external mutations without explicit authority.

### 5. Review and test

- Inspect the final diff for correctness, regressions, security, and scope creep.
- Run the relevant repository checks from [REPO-PROFILES.md](REPO-PROFILES.md), plus targeted tests for changed behavior.
- For user-facing UI, perform visual and accessibility checks at relevant desktop and narrow viewport sizes. Use end-to-end testing for critical user flows.
- Report exactly what ran, what passed, and what did not run. A passing build is not a substitute for required evidence.

### 6. Deploy and close

- Prepare a deployment summary: change, environment, migration/configuration impact, verification, monitoring, and rollback plan.
- Never deploy to production, run migrations, mutate Google Ads, push, merge, or otherwise create external impact without explicit approval.
- After an approved deployment, verify the intended environment and update Jira with release evidence. Only then move the issue to Resolved.

## Completion handoff

Every completed ticket handoff must state:

- Jira key and current status;
- what changed and why;
- review findings and disposition;
- tests and visual/end-to-end evidence actually run;
- deployment status and rollback notes; and
- known risks, blockers, and the next user action, if any.

Do not claim that tests, review, deployment, or a Jira status transition occurred unless it was actually completed and verified.
