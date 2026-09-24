# Completed-company LLM prompt snapshots

The 15 company files in this directory are generated views of the exact fixed
context produced by the shared LLM prompt builder. They contain the effective
agency rules, company dynamic rules, effective phrase protections, positive
keyword policy and inventory, and an empty candidate envelope. At runtime the
sweeper fills the candidate envelope and per-item phrase matches for each batch.

The Markdown files are audit/review artifacts, not runtime configuration:

- agency rules are read from `negative_keyword_static_rule_sets`;
- company dynamic rules are read from `negative_keyword_account_rules`;
- phrase protections are read from `negative_keyword_phrase_protections`;
- positive keywords are fetched read-only from Google Ads immediately before
  classification and stored as immutable rows in
  `negative_keyword_positive_keyword_snapshots` and
  `negative_keyword_positive_keyword_snapshot_entries`.

All 15 snapshots were refreshed from live Google Ads on 2026-09-24. Each
positive-keyword inventory contains the complete set of non-removed keyword
criteria from campaigns that pass the daily campaign filters: the configured
campaign-name substring (currently `Built by Shah`), `ENABLED` campaign status,
and an allowed primary status/reason combination. Zero-impression, paused, and
newly added keyword criteria are included when their campaign qualifies. The
generated files and manifest record `live-google-ads` as their source and do
not carry historical-fallback warnings.

The cross-company rules-conflict audit is in
[`POSITIVE_KEYWORD_CONTRADICTION_FINDINGS.md`](./POSITIVE_KEYWORD_CONTRADICTION_FINDINGS.md).

To refresh all 15 snapshots again, run:

```powershell
npm run policy:render-completed-prompts
```

The generator performs reads and local file writes only. It does not call an
LLM, start a sweep, mutate Google Ads, seed PostgreSQL, or send email.
