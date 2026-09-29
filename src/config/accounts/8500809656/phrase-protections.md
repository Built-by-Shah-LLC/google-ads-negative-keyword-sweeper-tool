# 3J Collision Center — account phrase protections

Account-scoped phrase protections for customer 8500809656 (3J Collision Center).
These excuse specific evidence, never an entire rule. All queries still go to
the LLM for full-query classification. A matched phrase is not an automatic
KEEP. Remaining independent negative evidence still wins, including additional
evidence under the same rule. Never count rule IDs to decide.

Only search-term text activates entries. Matching uses contiguous whole Unicode
letter/number tokens after NFKC, case, punctuation and whitespace normalization.
Longer queries and location modifiers need no new entries. Substrings, plurals,
synonyms, reordered tokens and fuzzy variants do not match automatically.
`customerIds: ["8500809656"]` scopes each entry to this account only.
Each entry identifies one negative `ruleId` and the precise `excusedEvidence`.
Edit the JSON block and follow `docs/RULE_RELEASES.md` for release review.

```json
[
  {
    "id": "3j-windshield-repair-glass",
    "phrase": "windshield repair",
    "customerIds": ["8500809656"],
    "ruleId": "POL-GLASS-TINT-NEGATIVE",
    "excusedEvidence": "Disregard glass-only evidence caused solely by windshield repair within this phrase. 3J Collision Center offers windshield repair as an approved service. Other glass or tint evidence outside this phrase, such as window tint, remains effective under the same rule."
  },
  {
    "id": "3j-windshield-replacement-glass",
    "phrase": "windshield replacement",
    "customerIds": ["8500809656"],
    "ruleId": "POL-GLASS-TINT-NEGATIVE",
    "excusedEvidence": "Disregard glass-only evidence caused solely by windshield replacement within this phrase. 3J Collision Center offers windshield replacement as an approved service. Other glass or tint evidence outside this phrase, such as window tint, remains effective under the same rule."
  },
  {
    "id": "3j-windshield-repair-parts",
    "phrase": "windshield repair",
    "customerIds": ["8500809656"],
    "ruleId": "POL-PARTS-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard named-part evidence caused solely by windshield repair within this phrase. 3J Collision Center performs this work, it is not a parts-sale query. Other named-part evidence outside this phrase, such as rocker panels or bumpers sold as parts, remains effective under the same rule."
  },
  {
    "id": "3j-windshield-replacement-parts",
    "phrase": "windshield replacement",
    "customerIds": ["8500809656"],
    "ruleId": "POL-PARTS-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard named-part evidence caused solely by windshield replacement within this phrase. 3J Collision Center performs this work, it is not a parts-sale query. Other named-part evidence outside this phrase remains effective under the same rule."
  },
  {
    "id": "3j-frame-repair-parts",
    "phrase": "frame repair",
    "customerIds": ["8500809656"],
    "ruleId": "POL-PARTS-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard named-part evidence caused solely by frame repair within this phrase. 3J Collision Center performs frame repair as an approved service. Other named-part evidence outside this phrase remains effective under the same rule."
  },
  {
    "id": "3j-frame-repair-mechanical",
    "phrase": "frame repair",
    "customerIds": ["8500809656"],
    "ruleId": "POL-MECHANICAL-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard mechanical-negative evidence caused solely by repair describing frame work within this phrase. 3J Collision Center performs frame repair as an approved service. Separate mechanical evidence, such as mechanic, oil change, or brakes outside the phrase, remains effective under the same rule."
  },
  {
    "id": "3j-frame-straightening-parts",
    "phrase": "frame straightening",
    "customerIds": ["8500809656"],
    "ruleId": "POL-PARTS-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard named-part evidence caused solely by frame straightening within this phrase. 3J Collision Center performs frame straightening as an approved service. Other named-part evidence outside this phrase remains effective under the same rule."
  },
  {
    "id": "3j-frame-straightening-mechanical",
    "phrase": "frame straightening",
    "customerIds": ["8500809656"],
    "ruleId": "POL-MECHANICAL-ONLY-NEGATIVE",
    "excusedEvidence": "Disregard mechanical-negative evidence caused solely by straightening describing frame work within this phrase. 3J Collision Center performs frame straightening as an approved service. Separate mechanical evidence outside the phrase remains effective under the same rule."
  }
]
```
