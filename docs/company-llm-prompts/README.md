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

Fourteen snapshots were generated with `--allow-historical-fallback` because
Google Ads rejected the configured OAuth identity after its 2-Step Verification
settings changed. Their positive lists therefore contain only keywords observed
in retained Google Ads search-term facts. CARSTAR Santa Maria and TRI STATE have
no retained matched-keyword facts, so their fallback inventories are empty.
Those files carry a warning and must be refreshed from live Google Ads before
being treated as production-complete.

The 3J Collision Center snapshot was generated from the complete live Google Ads
inventory captured by run `20260918T141254279Z-98557b07`: 243 non-removed
criteria, including 40 active criteria. It records that run as its source and,
like every committed prompt snapshot, is not runtime configuration.

After Google Ads authentication is restored, regenerate all 15 without the
fallback flag:

```powershell
npm run policy:render-completed-prompts
```

The generator performs reads and local file writes only. It does not call an
LLM, start a sweep, mutate Google Ads, seed PostgreSQL, or send email.
