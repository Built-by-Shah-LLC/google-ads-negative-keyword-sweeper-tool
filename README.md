# Google Ads AI Negative Keyword Sweeper

This repository contains the sanitized handoff, documentation, labeled examples, and legacy reference code for rebuilding a Google Ads MCC negative-keyword sweeper around AI intent classification.

## Current direction

The target system separates responsibilities:

- Google Ads JavaScript selects MCC accounts, retrieves GAQL data, sends structured context to an AI service, applies validated decisions, records results, and emails managers.
- The AI service decides whether each complete search term should be kept, reviewed, or added as a full-query exact campaign negative.
- Deterministic safeguards validate identity, response structure, exact-text integrity, and idempotency. They do not overrule the AI on business intent.
- Existing shared-list, phrase, or broad-negative coverage does not prevent adding an AI-approved exact negative directly to the campaign.
- The initial version uses automatically available Google Ads context and one agency-wide collision-repair policy; it does not require manually maintained per-account business profiles.

See [Architecture decisions](docs/ARCHITECTURE_DECISIONS.md) for the controlling product decisions.

## Repository contents

- `handoff/` — evidence-backed documentation and labeled search-term examples.
- `handoff/source_code/` — sanitized copies of the previous Google Ads and Apps Script implementation.
- `docs/` — current architecture decisions that supersede conflicting legacy behavior.

## Legacy-code status

The code under `handoff/source_code/` is reference material. It is not the required foundation for the new product and should not be deployed as the AI-assisted sweeper. Useful collection, MCC orchestration, mutation, and reporting mechanics may be retained when they remain the safest implementation.

The legacy deterministic rule engine, stemming, competitor seeds, city heuristics, and `shouldExclude` behavior are not authoritative business policy.

## Data handling

The handoff copies replace live Google Ads customer IDs and recipient emails with stable placeholders. Do not commit API keys, OAuth tokens, service credentials, or unsanitized client identifiers.
