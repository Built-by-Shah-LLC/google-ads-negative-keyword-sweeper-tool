# Controlling architecture decisions

These decisions reflect the current product direction. They supersede conflicting assumptions and instructions found in the historical handoff or legacy source comments.

## System boundary

The Google Ads MCC JavaScript is a collector and executor. It should:

1. Select managed accounts.
2. Pull search-term and related context through GAQL.
3. Send structured batches to a secure AI decision service.
4. Receive structured decisions.
5. Perform mechanical validation.
6. Apply accepted full-query exact campaign negatives.
7. Maintain an audit ledger and send manager reports.

The AI service is the semantic decision-maker. It should classify each term as:

- `KEEP`
- `NEGATIVE_EXACT`

Ambiguous, mixed, contradictory, or insufficiently supported intent resolves to `KEEP`. Only clearly irrelevant intent may resolve to `NEGATIVE_EXACT`.

## Minimal deterministic safeguards

The application layer may reject or skip a proposed mutation only when:

- The AI response is malformed or incomplete.
- Returned account or campaign identifiers do not match the submitted item.
- The proposed exact-negative text is not the submitted full search term after approved normalization.
- The identical exact negative already exists directly on the same campaign.
- The same decision was already successfully applied under the same idempotency key.
- Google rejects the mutation.
- The AI returned `KEEP`.

These are integrity and duplication controls, not a competing intent classifier.

The application layer must not veto an AI negative decision merely because:

- The term has conversions.
- The term is an existing positive keyword.
- Google reports an added or targeted status.
- A shared negative list already covers it.
- An existing phrase or broad negative appears to cover it.
- It contains an insurer, brand, city, competitor, cosmetic, or collision term.
- A legacy JavaScript rule would classify it differently.

## Existing-negative behavior

An AI-approved full-query exact negative should be added directly to the serving campaign even when a shared list, phrase negative, or broad negative already covers the query.

Only an identical exact negative that already exists directly on that campaign is treated as a duplicate.

## Context strategy

The initial version does not require manually maintained per-account business profiles. It should use automatically available context where practical, including:

- Account name and timezone
- Channel
- Search term
- Campaign and ad-group names and identifiers
- Matched keyword and match type when available
- Search-term status
- Recent and historical impressions, clicks, cost, conversions, and conversion value
- Landing-page context when reliably available
- Campaign geographic targets when practical
- Relevant prior reviewed decisions

The system uses one agency-wide collision-repair intent policy. Account-specific profiles may be added later if real-world evaluation shows they materially improve precision.

## Legacy implementation

The historical JavaScript is evidence and reference code, not the product specification. Components should be reused only after independent review.

Likely reusable areas include GAQL retrieval, child-account timezone handling, MCC parallelization, exact campaign-negative mutation, audit reconciliation, and email formatting.

The historical word/stem classifier, competitor lists, city heuristics, and automatic rule precedence should be replaced by the AI decision service.
