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
- `legacy-reference/` — original Cursor project Markdown, Cursor rules, negative-sweeper operator documents, walkthrough assets, and a sanitized copy of the related MCC Engine.

## Legacy-code status

The code under `handoff/source_code/` is reference material. It is not the required foundation for the new product and should not be deployed as the AI-assisted sweeper. Useful collection, MCC orchestration, mutation, and reporting mechanics may be retained when they remain the safest implementation.

The legacy deterministic rule engine, stemming, competitor seeds, city heuristics, and `shouldExclude` behavior are not authoritative business policy.

## Read-only TypeScript classifier

The new application under `src/` is isolated from `legacy-reference/`. It currently performs only:

1. Discover enabled leaf organizations under the configured MCC.
2. Fetch Search and Performance Max reported search terms for one completed day.
3. Aggregate organization- and campaign-scoped candidates.
4. Send bounded organization-specific batches plus `src/config/negative-keyword-rules.json` to Gemini.
5. Validate the structured result and write ignored JSON artifacts under `runs/`.

Each selected organization also receives one spreadsheet-safe aggregate file at:

```text
runs/{run_id}/organizations/{customer_id}/llm-decisions.csv
```

The CSV contains candidate context and validated decisions from every LLM batch. JSON remains the exact-fidelity source artifact; CSV cells that could execute as spreadsheet formulas are intentionally neutralized.

It contains no Google Ads mutation code.

Install and check it:

```powershell
npm install
npm run check
npm test
```

Add a separately created Gemini key to the ignored `.env`, then run one organization first:

```powershell
npm run sweep -- --date 2026-08-25 --organization-limit 1
```

Use a specific customer or deliberately select the entire MCC:

```powershell
npm run sweep -- --date 2026-08-25 --customer 1234567890
npm run sweep -- --date 2026-08-25 --all-organizations
```

If `--date` is omitted, each organization uses its own previous local calendar day. Free-tier Gemini input may be used by Google to improve its products; never put credentials or unnecessary customer data into rules or prompts.

Files in `legacy-reference/` are provided for complete project context. When they conflict with `docs/ARCHITECTURE_DECISIONS.md`, the current architecture decisions control.

## Data handling

The handoff copies replace live Google Ads customer IDs and recipient emails with stable placeholders. Do not commit API keys, OAuth tokens, service credentials, or unsanitized client identifiers.
