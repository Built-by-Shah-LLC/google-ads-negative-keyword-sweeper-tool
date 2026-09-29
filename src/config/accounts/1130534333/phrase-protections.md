# Capital Collision — account phrase protections

These account-scoped entries prevent Capital Collision's approved brand names
from being treated as competitor evidence. They excuse only competitor-name
evidence; every query is still evaluated for independent negative evidence.

```json
[
  {
    "id": "capital-collision-own-brand",
    "phrase": "capital collision",
    "customerIds": ["1130534333"],
    "ruleId": "POL-COMPETITOR-NEGATIVE",
    "excusedEvidence": "Disregard competitor-name evidence caused solely by Capital Collision. It is this account's own approved brand. Independent negative evidence remains effective."
  },
  {
    "id": "capital-riverside-collision-center-own-brand",
    "phrase": "riverside collision center",
    "customerIds": ["1130534333"],
    "ruleId": "POL-COMPETITOR-NEGATIVE",
    "excusedEvidence": "Disregard competitor-name evidence caused solely by Riverside Collision Center. It is an approved Capital Collision location brand. Independent negative evidence remains effective."
  },
  {
    "id": "capital-woodcrest-collision-center-own-brand",
    "phrase": "woodcrest collision center",
    "customerIds": ["1130534333"],
    "ruleId": "POL-COMPETITOR-NEGATIVE",
    "excusedEvidence": "Disregard competitor-name evidence caused solely by Woodcrest Collision Center. It is an approved Capital Collision location brand. Independent negative evidence remains effective."
  }
]
```
