# Conditional phrase protection

This manually maintained list ordinarily excuses specific evidence, never an
entire rule. All ordinary phrase matches still go to the LLM for full-query
classification. A matched ordinary phrase is not an automatic KEEP. Remaining
independent negative evidence still wins, including additional evidence under the
same rule. Never count rule IDs to decide.

`forceKeep: true` is reserved for a short-lived, owner-approved emergency
exception. It must name at least one ten-digit customer ID and an existing
`-KEEP` rule. It is enforced deterministically after LLM response validation,
so its phrase and metadata are never included in provider prompts. It turns every
matching full search term into `KEEP`, including a longer query with a location
modifier. Do not use it for ordinary evidence exceptions.

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
  },
  {
    "id": "auto-body-service",
    "phrase": "auto body service",
    "customerIds": [],
    "ruleId": "POL-MECHANICAL-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard mechanical-negative evidence caused solely by service describing auto body repair within this phrase. Separate mechanical evidence, such as mechanic, oil change, or another service use outside the phrase, remains effective under the same rule."
  },
  {
    "id": "auto-body-services",
    "phrase": "auto body services",
    "customerIds": [],
    "ruleId": "POL-MECHANICAL-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard mechanical-negative evidence caused solely by services describing auto body repair within this phrase. Separate mechanical evidence, such as mechanic, oil change, or another service use outside the phrase, remains effective under the same rule."
  },
  {
    "id": "body-shop-service",
    "phrase": "body shop service",
    "customerIds": [],
    "ruleId": "POL-MECHANICAL-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard mechanical-negative evidence caused solely by service describing body-shop repair within this phrase. Separate mechanical evidence, such as mechanic, oil change, or another service use outside the phrase, remains effective under the same rule."
  },
  {
    "id": "body-shop-services",
    "phrase": "body shop services",
    "customerIds": [],
    "ruleId": "POL-MECHANICAL-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard mechanical-negative evidence caused solely by services describing body-shop repair within this phrase. Separate mechanical evidence, such as mechanic, oil change, or another service use outside the phrase, remains effective under the same rule."
  },
  {
    "id": "capital-collision-emergency-keep",
    "phrase": "capital collision",
    "customerIds": ["1130534333"],
    "ruleId": "POL-COLLISION-KEEP",
    "excusedEvidence": "Owner-approved emergency protection for Capital Collision while account-specific dynamic rules are being completed.",
    "forceKeep": true
  },
  {
    "id": "riverside-collision-center-emergency-keep",
    "phrase": "riverside collision center",
    "customerIds": ["1130534333"],
    "ruleId": "POL-COLLISION-KEEP",
    "excusedEvidence": "Owner-approved emergency protection for Capital Collision while account-specific dynamic rules are being completed.",
    "forceKeep": true
  },
  {
    "id": "woodcrest-collision-center-emergency-keep",
    "phrase": "woodcrest collision center",
    "customerIds": ["1130534333"],
    "ruleId": "POL-COLLISION-KEEP",
    "excusedEvidence": "Owner-approved emergency protection for Capital Collision while account-specific dynamic rules are being completed.",
    "forceKeep": true
  }
]
```
