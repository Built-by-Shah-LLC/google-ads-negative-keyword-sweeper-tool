# Conditional phrase protection

This manually maintained list excuses specific evidence, never an entire rule.
All queries still go to the LLM for full-query classification. A matched phrase
is not an automatic KEEP. Remaining independent negative evidence still wins,
including additional evidence under the same rule. Never count rule IDs to decide.

Only search-term text activates entries. Matching uses contiguous whole Unicode
letter/number tokens after NFKC, case, punctuation and whitespace normalization.
Longer queries and location modifiers need no new entries. Substrings, plurals,
synonyms, reordered tokens and fuzzy variants do not match automatically.
`customerIds: []` applies globally; otherwise use ten-digit IDs without hyphens.
Each entry identifies one negative `ruleId` and the precise `excusedEvidence`.
Edit the JSON block and follow `docs/RULE_RELEASES.md` for release review.

```json
[
  {
    "id": "collision-experts",
    "phrase": "collision experts",
    "customerIds": [],
    "ruleId": "POL-COMPETITOR-NEGATIVE",
    "excusedEvidence": "Disregard competitor evidence caused solely by experts describing collision expertise within this phrase. Do not treat this generic descriptor as a business name. A separate name such as steve remains competitor evidence under the same rule."
  },
  {
    "id": "collision-service",
    "phrase": "collision service",
    "customerIds": [],
    "ruleId": "POL-MECHANICAL-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard mechanical-negative evidence caused solely by service describing collision repair within this phrase. Separate mechanical evidence, such as mechanic, oil change, or another service use outside the phrase, remains effective under the same rule."
  },
  {
    "id": "collision-services",
    "phrase": "collision services",
    "customerIds": [],
    "ruleId": "POL-MECHANICAL-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard mechanical-negative evidence caused solely by services describing collision repair within this phrase. Separate mechanical evidence, such as mechanic, oil change, or another service use outside the phrase, remains effective under the same rule."
  }
]
```
