# Ruleset v2 Review: Pre-implementation contradictions, precedence gaps, and LLM-trip hazards

**Review date:** 2026-08-28
**Spec reviewed:** `docs/superpowers/specs/2026-08-28-ruleset-v2-owner-review-locks.md`
**Baseline rules file:** `src/config/negative-keyword-rules.md` v2026-08-27.1
**Gold data inspected:** `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv`
**Mandate:** Do not implement or edit the spec/rules file. Only identify problems that an LLM classifier will trip over once Part A/B/C of the spec is translated into the new policy file.

---

## Executive summary

The owner locks are clear at a business level, but the spec as written contains several pairs of rules that can fire on the same query and produce opposite outcomes, plus wording that an LLM will interpret inconsistently. The two most dangerous problems are (1) the new "small-jobs override body/collision wording" rule would negative the gold KEEP examples `major collision with frame damage and dents` and `major accident with frame damage and dents`, and (2) the expanded competitor rule (A6) and the retained OEM-body rule (A7) directly contradict each other for make/model + service queries without a city. These must be resolved before the rules file is rewritten, or the eval will fail on high-value collision queries and on brand+service queries.

---

## Critical issues

### 1. A3 "small-jobs override body/collision wording" negatives gold collision-KEEP rows
- **Severity:** Critical
- **Location:** Part A row A3; Part C step 3; `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` EX-014, EX-015.
- **Description:** The spec says A3 (`POL-COSMETIC-ONLY-NEGATIVE`) now negatives "scratch/dent/ding/minor/small-job … even with body wording" and Part C places A3 at step 3 with the statement that A3 "override[s] body/collision wording." EX-014 (`major collision with frame damage and dents`) and EX-015 (`major accident with frame damage and dents`) are explicit owner-labeled KEEP rows whose notes say "serious collision must not be lost because of dents." Both contain the small-job token `dents` and body/collision wording. If A3 literally overrides body/collision wording, both rows become NEGATIVE.
- **Impact:** High-value collision queries will be incorrectly excluded, directly violating the benchmark requirement of "zero regressions on still-locked KEEP families" and the owner’s own EX-014/015 labels.
- **Suggested resolution before implementation:** Clarify that A3 negatives small-jobs **only when no severe crash/structural signal is present** (preserving the current `POL-COSMETIC-ONLY-NEGATIVE` carve-out for collision/accident/crash/wreck/frame/structural/insurance/claim), not when it "overrides" those signals.

### 2. A6 competitor expansion contradicts A7/OEM-body KEEP for make/model + service without city
- **Severity:** Critical
- **Location:** Part A rows A6 and A7; Part C step 2 ("always-win negatives: … A6 competitor"); `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` EX-009, EX-011, EX-112.
- **Description:** A6 locks "any `[name] collision center` / `[name] body shop` / `[name] auto body` / `[name] auto repair` pattern" as competitor NEGATIVE, explicitly including cases where the name token is a "make/model." The only exceptions listed are own brand and bare generic `city + service`. A7 then says make/model + service **without city** stays KEEP (e.g., `chevy body shop`). Because Part C puts A6 in the "always-win negatives" list before the KEEP rules in step 7, A6 will fire first and negative `bmw body work repairs` (EX-011), `cadillac body shop near me` (EX-009), and `bmw certified collision center` (EX-112). A7 cannot save them.
- **Impact:** The LLM will be told two opposite things for the same query shape. The gold examples that are currently KEEP will flip to NEGATIVE, and the eval on the existing CSV will regress.
- **Suggested resolution before implementation:** Either (a) exclude make/model without city from A6 and move that case fully to A7, or (b) remove A7 entirely and accept that all make/model + service queries are negative, updating the gold set accordingly. The current A6+A7 combination is mutually exclusive.

---

## Major issues

### 3. A4 paint rule reverses an existing POL-BODYWORK-KEEP example
- **Severity:** Major
- **Location:** Part A row A4; current `src/config/negative-keyword-rules.md` `POL-BODYWORK-KEEP` examples; `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` EX-072, EX-120.
- **Description:** The current policy file lists `paint and body shop near me` as a `POL-BODYWORK-KEEP` example. The spec now says any paint/painting/painter/repaint mention → NEGATIVE, including `paint and body`. EX-072 (`paint and body shop near me`) and EX-120 (`auto paint and body shop near me`) will flip from KEEP/HUMAN_REVIEW to NEGATIVE.
- **Impact:** This is an explicit owner reversal and not an internal contradiction, but it is not listed in Part E’s "reversed categories" as requiring a CSV update. If the eval map is not updated, the classifier will be penalized for matching the new owner lock.
- **Suggested resolution before implementation:** Add `paint and body` variants to Part E’s explicit CSV-expectation update list.

### 4. A5 parts-vs-collision ladder reverses an existing POL-COLLISION-KEEP example
- **Severity:** Major
- **Location:** Part A row A5; Part C steps 4–5; current `src/config/negative-keyword-rules.md` `POL-COLLISION-KEEP` examples; `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` EX-016.
- **Description:** The current policy file lists `accident bumper repair` as a `POL-COLLISION-KEEP` example. The new ladder says a single named part/zone with `accident` is NEGATIVE and confirms `accident bumper repair` → NEGATIVE.
- **Impact:** Another explicit reversal that must be reflected in the gold set. If the CSV is not updated, the eval will report a regression on a previously locked KEEP example.
- **Suggested resolution before implementation:** Update the expectation for EX-016 and any other `accident + named-part` rows in the gold set.

### 5. A6 treats superlatives, acronyms, and state names as competitor names with no disambiguation rule
- **Severity:** Major
- **Location:** Part A row A6; Part C step 2.
- **Description:** A6 says `[name] + collision center/body shop/auto body/auto repair` is negative "even when the name token is a superlative, acronym, state name, or make/model." There is no objective way for an LLM to know that `best collision center` is a competitor name but `top collision repair` is a comparison query, or that `dfw auto body` is an acronym competitor but `dallas auto body` is a city+service KEEP. The same applies to state names (`texas collision center` negative) vs city names (`houston collision center` KEEP).
- **Impact:** Massive over-negativing of comparison, regional, and generic service-intent queries. The LLM will be inconsistent because the boundary is example-driven, not rule-driven.
- **Suggested resolution before implementation:** Define a disambiguation test the LLM can apply, e.g., "treat the token as a competitor name only when it is capitalized/proper-noun-like AND not a known city/region in the query context" or maintain an explicit allowlist/blocklist.

### 6. A6 "place-or-name ambiguity" lacks a reproducible criterion
- **Severity:** Major
- **Location:** Part A row A6 edge lock; Part D Q4.
- **Description:** The spec locks `hurst auto body` and `ewing body shop` as competitor negatives because the token is "both a place and a plausible business name," while `dallas auto body repair` stays KEEP because the token is "only a place." An LLM has no reliable way to know whether "Hurst" or "Ewing" is "plausible" as a business name in a given account context.
- **Impact:** Inconsistent classification of city+service queries, especially for small/midsize cities that are also surnames (e.g., "Austin body shop" is both a city and a surname, and is also a known brand).
- **Suggested resolution before implementation:** Either treat all `[place] + service` as KEEP (reverting the edge lock) or require additional competitor signals (possessive, distinctive modifier, domain, known chain) before firing A6.

### 7. B8 default-negative contradicts current POL-AMBIGUOUS-KEEP examples
- **Severity:** Major
- **Location:** Part B row B8; Part A row A11; Part D Q4; current `src/config/negative-keyword-rules.md` `POL-AMBIGUOUS-KEEP`.
- **Description:** The current policy explicitly says "Specifically KEEP bare generic `car` and `car near me`." B8 says signal-less queries default NEGATIVE, and Q4’s approved KEEP signal list does not include bare `car`. Therefore `car` and `car near me` would become NEGATIVE under the new rules.
- **Impact:** The CSV rows EX-024 (`car`) and EX-025 (`car near me`) would need to flip from KEEP to NEGATIVE, or the spec needs to carve them out. The owner did not explicitly say to negative bare `car`, so this is likely an unintended side effect of the blanket default-negative.
- **Suggested resolution before implementation:** Either add bare generic `car` / `car near me` to the Q4 approved-signal list or explicitly state that low-intent vehicle-only queries remain KEEP.

### 8. Towing is removed from UNDEFINED-KEEP but no negative rule replaces it
- **Severity:** Major
- **Location:** Part A row A9; Part B; `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` EX-108.
- **Description:** A9 removes towing from `POL-UNDEFINED-KEEP`. No Part B rule (`B1`–`B11`) negatives towing specifically. Under B8, a bare towing query (`tow truck`) is signal-less and becomes NEGATIVE. However, `tow truck after accident` (EX-108) contains the approved crash-event token `accident`, so B8 does **not** fire and no other rule negatives it, leaving it as KEEP.
- **Impact:** The owner likely intended towing to be removed as a KEEP category, but the spec leaves a hole where accident-towing queries remain KEEP while bare towing queries become NEGATIVE. This is an inconsistent business outcome.
- **Suggested resolution before implementation:** Add a `POL-TOWING-NEGATIVE` always-win rule or clarify in A9 that towing is negative regardless of accompanying accident signal.

### 9. A8 "no shop/repair/body context" for collision is under-defined
- **Severity:** Major
- **Location:** Part A row A8; Part C steps 4 and 7.
- **Description:** A8 says bare `collision`, `service collision`, `car damage repair`, and `car broken` (no shop/repair/body context) → NEGATIVE. It is unclear what counts as "shop/repair/body context." For example:
  - `collision repair` has `repair` → KEEP?
  - `collision service` has `service` but no `shop/repair/body` → NEGATIVE per A8.
  - `collision center` has `center`; is `center` a "shop" equivalent?
  - `collision shop` has `shop` → KEEP?
- **Impact:** LLM will classify near-synonyms inconsistently (`center` vs `shop` vs `repair`).
- **Suggested resolution before implementation:** Provide an explicit list of context tokens that count as "service context" for A8 (e.g., `repair`, `shop`, `body`, `center`, `garage`) or keep the rule limited to truly bare tokens.

### 10. A5 parts ladder boundary between "broad/structural" and "single named part/zone" is subjective
- **Severity:** Major
- **Location:** Part C step 4; `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` EX-014, EX-016.
- **Description:** The ladder says KEEP when crash-event language indicates broad/structural damage, and NEGATIVE when the scope is a single named part/zone. It labels `rear end collision repair` KEEP but `fender bender repair` and `car front end damage repair` NEGATIVE. A "fender bender" is a type of accident, and "front end damage" is broad/structural in ordinary language. The distinction relies on hidden human judgment.
- **Impact:** The LLM will misclassify accident-type and zone-damage queries, leading to high variance on the parts ladder.
- **Suggested resolution before implementation:** Replace the subjective boundary with a token list (e.g., named parts = bumper, fender, door, hood, trunk, frame-by-itself-without-damage; broad damage = collision/crash/wreck/totaled + `damage`/`repair`) and test it on a held-out set.

### 11. `insurance claim bumper repair` insurer exception is fragile
- **Severity:** Major
- **Location:** Part C step 4 open edge; Part D Q1.
- **Description:** The confirmed rule is that insurer/claim intent keeps a query only when `collision`/`crash` is also present. Otherwise parts win. This means `insurance claim bumper repair` → NEGATIVE. However, the Q4 approved-signal list includes "insurer names" as a KEEP signal. The LLM may read "insurance claim" as an insurer signal and keep the query, or may read `bumper` as a part and negative it. The rule is correctable via precedence, but the spec text is easy to misread.
- **Impact:** Inconsistent handling of insurance+parts queries; risk of false positives or false negatives depending on how the prompt phrases the precedence.
- **Suggested resolution before implementation:** State explicitly in the rule text: "An insurer/claim signal keeps a query only if the query also contains `collision`, `crash`, or `wreck`; otherwise `POL-PARTS-ONLY-NEGATIVE` wins."

### 12. Foreign-language reversal needs explicit CSV re-labeling
- **Severity:** Major
- **Location:** Part A row A12; Part B row B11; current `src/config/negative-keyword-rules.md` `POL-SPANISH-SERVICE-KEEP`; `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` EX-067, EX-095, EX-109, EX-117.
- **Description:** The spec repeals `POL-SPANISH-SERVICE-KEEP`. All foreign-language queries become NEGATIVE. The current policy file and examples list Spanish service queries as KEEP (`choque cerca de mi`, `taller de enderezado y pintura cerca de mi`, `talleres de pintura automotriz cerca de mi`).
- **Impact:** Without updating the gold set, the eval will treat the new correct classifications as errors. Spanish DIY rows (EX-080, EX-117) already align with NEGATIVE, but service-intent Spanish rows must be flipped.
- **Suggested resolution before implementation:** Part E mentions Spanish rows, but the exact list of CSV IDs should be enumerated.

---

## Minor issues

### 13. A9 "general informational" vs "informational price queries" boundary is fuzzy
- **Severity:** Minor
- **Location:** Part A row A9.
- **Description:** A9 keeps "general informational" but removes "informational price queries." The distinction between `what is collision repair` (keep) and `can a rear bumper be repaired` (parts ladder → negative) is not obvious. Both are informational in form.
- **Impact:** Some LLM inconsistency on informational-form queries.
- **Suggested resolution before implementation:** Define "informational price queries" as queries whose primary object is cost/price (`how much`, `cost`, `price`) and treat other informational queries as KEEP unless a parts/mechanical rule applies.

### 14. Rule name `POL-COLLISION-KEEP` now primarily describes negatives
- **Severity:** Minor
- **Location:** Part A row A8.
- **Description:** A8 keeps the rule ID `POL-COLLISION-KEEP` but the change text describes when collision queries become NEGATIVE (bare collision, service collision, car damage repair, car broken). This is confusing naming.
- **Impact:** LLM may be confused by a KEEP rule that tells it to negative certain queries.
- **Suggested resolution before implementation:** Rename to `POL-COLLISION-SERVICE-CONTEXT-KEEP` or split into a negative rule `POL-BARE-COLLISION-NEGATIVE` and a narrower `POL-COLLISION-KEEP`.

### 15. A11/B8 leaves `POL-AMBIGUOUS-KEEP` with no examples of its shrunken scope
- **Severity:** Minor
- **Location:** Part A row A11; Part C step 8.
- **Description:** The spec says `POL-AMBIGUOUS-KEEP` now applies only to "signal-present-but-contradictory" cases, but gives no examples. The LLM will not know what this means without concrete cases.
- **Impact:** The shrunken fallback rule is unusable in practice.
- **Suggested resolution before implementation:** Add examples such as `car accident attorney near me` (accident signal + attorney signal) or `collision repair reviews` (collision signal + review signal).

### 16. A6 `thebodyshop com` domain pattern is not generalized
- **Severity:** Minor
- **Location:** Part A row A6.
- **Description:** The edge lock for `thebodyshop com` (brand + `com`) is listed as a one-off example. There is no general rule for `[brand] [domain]` queries.
- **Impact:** LLM will not know whether `maaco com`, `caliber com`, etc., should also be negative.
- **Suggested resolution before implementation:** Generalize to "a known competitor or brand name followed by a domain suffix (`com`, `org`, `net`) is a competitor/domain query."

### 17. A1 mechanical-token override is ambiguous for body-repair job titles
- **Severity:** Minor
- **Location:** Part A row A1.
- **Description:** A1 says `mechanic`/`technician`/`specialist`/`tech` tokens "override body wording." A query like `auto body technician` contains body wording and a tech token. The rule would negative it. A query like `body shop technician job` contains body + tech + job. The careers rule might also fire. The intent of `auto body technician` could be someone searching for a body-shop technician (employment) or a service (repair); either way it is arguably negative, but the rule text does not distinguish.
- **Impact:** Minor over-negativing of employment-related body-shop queries.
- **Suggested resolution before implementation:** Clarify whether A1 negatives all `tech`-containing queries or only queries where the service intent is mechanical (no explicit body/collision repair context).

### 18. B8 approved signal list is illustrative, not exhaustive
- **Severity:** Minor
- **Location:** Part D Q4.
- **Description:** Q4 lists approved KEEP signals but says "crash-event tokens incl. slang" and gives examples. It does not cover variants like `rear-ended` vs `rear ended`, `t boned`, `side impact`, `rollover`, `rear-ended accident`, etc.
- **Impact:** LLM may miss some crash-event signals and default-negative legitimate collision queries.
- **Suggested resolution before implementation:** Provide a normalized list of crash-event stems/tokens rather than an example-only list.

---

## Gold-set conflicts with the new locks

The following rows in `handoff/02_LABELED_SEARCH_TERM_EXAMPLES.csv` would produce an outcome under the spec that conflicts with their current expectation. These are not all spec bugs—some are explicit owner reversals—but all require an expectation update before `npm run eval:kimi` can pass.

| CSV ID | Search term | Current expectation | New spec outcome | Why it conflicts |
|--------|-------------|---------------------|------------------|------------------|
| EX-014 | `major collision with frame damage and dents` | KEEP | **NEGATIVE** if A3 literally overrides body/collision wording | Contains `dents` (small-job token) + body/collision wording |
| EX-015 | `major accident with frame damage and dents` | KEEP | **NEGATIVE** if A3 literally overrides body/collision wording | Same as EX-014 |
| EX-016 | `accident bumper repair` | KEEP | **NEGATIVE** under A5 parts ladder | `accident` + named part `bumper` |
| EX-009 | `cadillac body shop near me` | KEEP | **NEGATIVE** under A6 (make/model + body shop) or **KEEP** under A7 (no city) | A6/A7 contradiction |
| EX-011 | `bmw body work repairs` | KEEP | **NEGATIVE** under A6 or **KEEP** under A7 | A6/A7 contradiction |
| EX-112 | `bmw certified collision center` | KEEP | **NEGATIVE** under A6 or **KEEP** under A7 | A6/A7 contradiction |
| EX-072 | `paint and body shop near me` | HUMAN_REVIEW | **NEGATIVE** under A4 | `paint and body` now always negative |
| EX-120 | `auto paint and body shop near me` | HUMAN_REVIEW | **NEGATIVE** under A4 | Contains `paint and body` |
| EX-024 | `car` | KEEP | **NEGATIVE** under B8 unless carved out | Signal-less bare vehicle query |
| EX-025 | `car near me` | KEEP | **NEGATIVE** under B8 unless carved out | Signal-less bare vehicle query |
| EX-108 | `tow truck after accident` | HUMAN_REVIEW | **KEEP** (accident signal prevents B8) or **NEGATIVE** if towing rule added | Towing removed from UNDEFINED-KEEP but no replacement rule |
| EX-067 | `taller de enderezado y pintura cerca de mi` | AUTO_NEGATIVE_ALLOWED | **NEGATIVE** under B11 | Aligns with new rule; expectation can be hardened |
| EX-095 | `talleres de pintura automotriz cerca de mi` | AUTO_NEGATIVE_ALLOWED | **NEGATIVE** under B11 | Aligns with new rule; expectation can be hardened |
| EX-109 | `choque cerca de mi` | HUMAN_REVIEW | **NEGATIVE** under B11 | Spanish service query; explicit reversal |
| EX-117 | `como quitar golpes de granizo` | HUMAN_REVIEW | **NEGATIVE** under B11 and/or `POL-DIY-HOWTO-NEGATIVE` | Aligns with new rule |

---

## Recommendation

Do not implement the rules-file rewrite until the two **critical** issues (A3 collision-frame carve-out and A6/A7 make/model contradiction) are resolved and the gold-set expectation updates for the rows in the table above are drafted. Once those are settled, run a small held-out eval on the ambiguous zones (place-or-name, parts-vs-collision, paint-and-body, bare-vehicle) before any full P&C re-run.
