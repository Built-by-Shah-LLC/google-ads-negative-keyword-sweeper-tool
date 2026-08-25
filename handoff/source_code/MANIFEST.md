# Source code copies

Original project files were **not** modified. These copies live only under `handoff/source_code/` and preserve each file’s original relative path.

**Scan:** After copy, files were searched for emails, dashed Google Ads account IDs (except the documented example `123-456-7890`), and common API-key/password patterns. Remaining hits: **none**.

Placeholders used when PII was present:

| Placeholder | Original class of value |
|---|---|
| `ACCOUNT_01` … `ACCOUNT_04` | Live allowlist Google Ads customer IDs |
| `EMAIL_01` … `EMAIL_04` | Live `EMAIL_RECIPIENTS` addresses |

Shop names, rule lists, GAQL, functions, comments, and CONFIG **structure** were left intact.

| Copied path | Original path | Sanitized? |
|---|---|---|
| `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` | `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` | **Yes** (allowlist IDs + recipient emails) |
| `scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js` | same | No (allowlist/emails already empty comments only) |
| `scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-kc-today-v1.1.0.js` | same | **Yes** (same IDs + emails as daily) |
| `scripts/built-by-shah-mcc-search-negatives-sweeper.js` | same | No (`HUB_SPREADSHEET_URL` empty) |
| `scripts/built-by-shah-mcc-pmax-negatives-sweeper.js` | same | No |
| `scripts/sync-negative-sweeper-rule-blocks.js` | same | No |
| `scripts/test-negative-sweeper-contract.js` | same | No |
| `scripts/_engine-hub-spoke-contract.js` | same | No |
| `apps-script/add-negatives-audit-tab.gs` | same | No |
| `apps-script/create-hub-workbook.gs` | same | No |
| `apps-script/create-body-shop-workbook.gs` | same | No (`SETUP_CONFIG` IDs/emails empty) |
| `.cursor/rules/negatives-sweeper-separate-from-engine.mdc` | same | No |

Complete MCC daily script is included in full (not excerpts).
