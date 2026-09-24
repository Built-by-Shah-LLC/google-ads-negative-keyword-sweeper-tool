# BBS repository delivery profiles

Use these as the default verification baseline. Add targeted checks for changed behavior and follow more specific repository documentation when it applies.

## BBS Widgets Software

- **Repository:** `custom-widgets`
- **Jira label:** `bbs-widgets-software`
- **Read first:** `AGENTS.md`; for Next.js work, read relevant installed Next.js documentation before changing APIs or conventions.
- **Default checks:**
  1. `npm run lint`
  2. `npm run test`
  3. `npm run build`
- **Targeted checks:** Use the relevant Playwright project for loader/canary behavior. Do not run mutation E2E or production-affecting refreshes without explicit approval.

## BBS Client Agency Portal

- **Repository:** `agency-portal`
- **Jira label:** `bbs-client-agency-portal`
- **Default checks:**
  1. `npm run lint`
  2. `npm run test` or `npm run ci:test` when the full CI suite is appropriate
  3. `npm run build`
- **User-flow checks:** Use the repository's `qa/agent-e2e` validation/run tooling or browser E2E for a client or team workflow.

## BBS Ads Manager Platform

- **Repository:** `built-ads-manager`
- **Jira label:** `bbs-ads-manager-platform`
- **Read first:** root `AGENTS.md` and the documents it routes for the task. The scope ledger is an admission gate.
- **Default checks:**
  1. `npm run docs:check`
  2. `npm run check`
  3. `npm run build`
- **Additional requirements:** User-facing UI needs documented design composition, independent review where required, and desktop plus 390px visual QA. Database, integration, and production work need applicable architecture, security, operations, and migration instructions.
- **Safety:** The current product contract is observation-only. Treat Google Ads write capability as a scope change requiring explicit founder approval and updated canonical docs.

## BBS Keyword Sweeper

- **Repository:** `google-ads-negative-keyword-sweeper-tool`
- **Jira label:** `bbs-keyword-sweeper`
- **Default checks:**
  1. `npm run check`
  2. `npm test`
  3. `npm run build`
- **Policy work:** Add `npm run rules:check` when rule releases or account policy compilation changes.
- **Safety:** Normal work stays non-mutating. Validation and test-account mutation tooling require explicit scoped authority; production Google Ads mutation requires separate live-operation approval.

## Shared release rules

1. Treat a local build/test pass as evidence, not deployment.
2. Ask before a production deployment, migration, backfill, live provider mutation, push, merge, or release promotion.
3. Keep Jira status truthful: In progress during implementation; Testing only while evidence is gathered; In review after review-ready evidence; Resolved only after approved deployment/verification or when the issue's resolution criteria explicitly permit it.
