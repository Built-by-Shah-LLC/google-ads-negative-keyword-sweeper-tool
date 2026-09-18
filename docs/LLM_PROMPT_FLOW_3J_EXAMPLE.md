# How 3J's Policy + Positive Keywords Flow Into the LLM

Concrete example using real data from run `20260918T141254279Z-98557b07`
(3J Collision Center, customer `8500809656`).

## The whole flow (D-059, current code)

1. **Load static rules from DB** — the agency-wide rule set
   (`negative_keyword_static_rule_sets`, exactly one `active` row per org).
   Applies to all companies. Fails closed if none is active.
2. **Load dynamic account rules from DB** — company-specific rules
   (`negative_keyword_account_rules` for customer `8500809656`: 6 rules,
   e.g. `3J-*-KEEP` / `3J-*-NEGATIVE`). Compiled into the rules markdown as an
   account section → one effective rule set for this account.
3. **Load phrase protections from DB** — merged bundle:
   agency-wide rows (`customer_ids = '{}'`, 7 entries) **+** 3J-scoped rows
   (8 entries) = **15 effective protections**.
4. **At runtime, fetch positive keywords from Google Ads** — live inventory
   for the account (243 criteria for 3J, 40 ACTIVE). Not stored policy; a fresh
   snapshot every run.
5. **Build ONE prompt per batch** (not separate files). The prompt has ordered
   sections (see below): rules markdown, phrase-protection policy + JSON,
   matched-protection map, positive-keyword policy + inventory JSON, then the
   untrusted search-term data envelope.
6. **LLM returns KEEP / NEGATIVE_EXACT per search term**, citing rule IDs and
   any protection/keyword evidence it used.
7. **Decisions are honored as classified.** The old post-LLM
   positive-keyword exact-match guard is **removed** — protection now happens
   at classification time, inside the LLM's reasoning, using the trusted
   inventory in the prompt.

## Prompt section order (one prompt, trusted → untrusted)

```
1. Effective rules markdown              (static + 3J account section)
2. Phrase-protection policy text         (fixed instructions)
3. Configured phrase protections         (trusted policy JSON — 15 entries)
4. Matched protection IDs by item        (pre-computed phrase hits)
5. Positive keyword protection policy    (fixed instructions)
6. Configured positive keywords          (trusted Google Ads inventory JSON)
7. Untrusted classification data (JSON)  (the search terms being classified)
```

## 3J phrase protections (section 3 content)

### Agency-wide (7) — apply to every company

| entry_id | phrase | rule excused |
|---|---|---|
| collision-experts | collision experts | POL-COMPETITOR-NEGATIVE |
| collision-service | collision service | POL-MECHANICAL-ONLY-NEGATIVE |
| collision-services | collision services | POL-MECHANICAL-ONLY-NEGATIVE |
| auto-body-service | auto body service | POL-MECHANICAL-ONLY-NEGATIVE |
| auto-body-services | auto body services | POL-MECHANICAL-ONLY-NEGATIVE |
| body-shop-service | body shop service | POL-MECHANICAL-ONLY-NEGATIVE |
| body-shop-services | body shop services | POL-MECHANICAL-ONLY-NEGATIVE |

### 3J-specific (8) — customer `8500809656` only

| entry_id | phrase | rule excused |
|---|---|---|
| 3j-frame-repair-mechanical | frame repair | POL-MECHANICAL-ONLY-NEGATIVE |
| 3j-frame-repair-parts | frame repair | POL-PARTS-ONLY-NEGATIVE |
| 3j-frame-straightening-mechanical | frame straightening | POL-MECHANICAL-ONLY-NEGATIVE |
| 3j-frame-straightening-parts | frame straightening | POL-PARTS-ONLY-NEGATIVE |
| 3j-windshield-repair-glass | windshield repair | POL-GLASS-TINT-NEGATIVE |
| 3j-windshield-repair-parts | windshield repair | POL-PARTS-ONLY-NEGATIVE |
| 3j-windshield-replacement-glass | windshield replacement | POL-GLASS-TINT-NEGATIVE |
| 3j-windshield-replacement-parts | windshield replacement | POL-PARTS-ONLY-NEGATIVE |

Each entry also carries `excusedEvidence` text telling the LLM exactly which
evidence to disregard (e.g. "Disregard mechanical-negative evidence caused
solely by repair describing frame work within this phrase. 3J Collision Center
performs frame repair as an approved service...").

## 10 positive keywords with descriptions (section 6 content)

Real ACTIVE criteria from 3J's account. The `description` line is generated
per keyword so the LLM gets plain-language context, not just raw fields:

```json
[
  {
    "keyword": "collision repair",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"collision repair\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "car body repair",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"car body repair\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "car body shop",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"car body shop\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "best body shop near me",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"best body shop near me\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "auto body shop Woodbridge",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"auto body shop Woodbridge\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "European auto body repair",
    "matchType": "EXACT",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"European auto body repair\" (EXACT match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "body shops in Woodbridge NJ",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"body shops in Woodbridge NJ\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "best body shop New Jersey",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"best body shop New Jersey\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "Body Shop NJ",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"Body Shop NJ\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  },
  {
    "keyword": "body shops Middlesex County",
    "matchType": "PHRASE",
    "status": "ACTIVE",
    "campaignName": "Built by Shah - Google Ad Campaign",
    "adGroupName": "Generic Body Shop Search",
    "description": "Positive keyword \"body shops Middlesex County\" (PHRASE match) in campaign \"Built by Shah - Google Ad Campaign\" > ad group \"Generic Body Shop Search\"."
  }
]
```

## How the LLM is told to use them (section 5, fixed instruction)

- A search term that **exactly matches an ACTIVE positive keyword must not be
  made negative** — it is the strongest KEEP evidence (you would be negating
  your own live keyword).
- PAUSED keywords are weaker context, not an absolute veto.
- Independent negative evidence is still evaluated (a matching keyword does
  not excuse genuinely irrelevant/dangerous terms on its own).
- The LLM must **never invent keywords** — the inventory above is
  authoritative trusted data from Google Ads.

## What replaced the old exact-match guard

Before D-059, a post-LLM step re-fetched positives and force-flipped decisions
(`PROTECTED_BY_POSITIVE_KEYWORD`) when a term exactly matched an active
keyword. That step is **removed**: the LLM now sees the inventory up front and
makes the call itself with full context (citing the match in its reason), and
the writer honors every decision as classified. In the verified local run, all
4 exact active-positive matches were KEEPed by the LLM citing the match — same
outcome, but reasoned instead of hard-coded.
