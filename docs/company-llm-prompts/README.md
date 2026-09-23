# Completed-company LLM prompt snapshots

The 14 company files in this directory are generated views of the exact fixed
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

The current snapshots were generated with
`--allow-historical-fallback` because Google Ads rejected the configured OAuth
identity after its 2-Step Verification settings changed. Their positive lists
therefore contain only keywords observed in retained Google Ads search-term
facts. CARSTAR Santa Maria and TRI STATE have no retained matched-keyword facts,
so their fallback inventories are empty. Every file carries a warning and must
be refreshed from live Google Ads before being treated as production-complete.

After Google Ads authentication is restored, regenerate all 14 without the
fallback flag:

```powershell
npm run policy:render-completed-prompts
```

The generator performs reads and local file writes only. It does not call an
LLM, start a sweep, mutate Google Ads, seed PostgreSQL, or send email.
