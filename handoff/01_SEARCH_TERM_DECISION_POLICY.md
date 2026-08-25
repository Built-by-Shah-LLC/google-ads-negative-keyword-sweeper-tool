# 01 — Search-term decision policy

This is the primary policy file for a conservative rebuild. **CURRENT CODE BEHAVIOR is not policy.** Where the owner has not locked a rule, this file says **UNDEFINED** or **UNKNOWN** instead of inventing one.

**Canonical code citations** refer to `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` unless noted.

---

## Three concepts (do not collapse)

### A. Intent classification (rebuild vocabulary)

These names **do not exist** in the JavaScript. Mapping from code is interpretive.

| Class | Meaning for this business | Code analogue today |
|---|---|---|
| **QUALIFIED** | Likely a desired collision / body-shop customer | No rule matched, or every matched rule was exception/protected, **or** owner-labeled keep (e.g. “body work near me”) |
| **DISQUALIFIED** | Clear wrong-job / junk / competitor / mechanical / cosmetic-only (when that is actually locked) | `shouldExclude === true` |
| **UNCERTAIN** | Mixed, weak, or single-word cosmetic signal; human must decide | **Not implemented.** Oversize queries become `MANUAL_REVIEW` only |
| **PROTECTED** | Must not be auto-negatived even if a junk trigger is present | Global/account protected phrase hit, or (in code) all matched rules exception-blocked |

**CONFIRMED REQUIREMENT (this conversation):** Uncertain → human review, not auto-negative.

### B. Recommended operation (rebuild vocabulary)

| Operation | Meaning |
|---|---|
| **KEEP** | Do not propose or add a negative. Leave serving. |
| **HUMAN_REVIEW** | Queue for a person. Do not mutate Ads. |
| **PROPOSE_NEGATIVE** | Suggest negative text/match/scope; wait for approval. |
| **AUTO_NEGATIVE_ALLOWED** | System may write Ads without waiting. |

**CURRENT CODE BEHAVIOR:** Eligible rule + safety gates → implicit **AUTO_NEGATIVE_ALLOWED**. Length/word overflow → **HUMAN_REVIEW**. Protected / no rule → **KEEP** (no row on Hub spoke unless other decisions). Standalone CSV still records `NO_RULE` / `PROTECTED`.

**CONFIRMED REQUIREMENT (Hub plan):** After-the-fact Reviewed on spoke; adds are live immediately. **Contradicts** this conversation’s pre-add review requirement.

### C. Negative implementation (rebuild + current add path)

Must be specified separately from A and B.

| Field | CURRENT CODE BEHAVIOR (adds) | CURRENT CODE BEHAVIOR (coverage read) |
|---|---|---|
| **Negative text** | Full sanitized search term, not a extracted trigger word | Existing negatives’ text |
| **Match type** | **EXACT** only (`matchType: 'EXACT'`) | EXACT, PHRASE, or BROAD if already in Ads |
| **Scope** | **Campaign** that served the term | Campaign negatives + **attached shared lists** (read-only) |

Standalone mutation: `buildExactCampaignNegativeCreateOperation_` lines 2745–2757. Formatting: `inspectExactNegative_` / `prepareExactNegative_` lines 2983–3037. Hub Search uses `campaign.createNegativeKeyword(prepared.formatted)` (bracket syntax) at `built-by-shah-mcc-search-negatives-sweeper.js` line 1078.

**CONFIRMED REQUIREMENT (docs + Cursor rule):** Never auto-add a **bare trigger word** as phrase/broad. Full-query exact only.

**UNKNOWN:** Whether a future AI system may propose phrase negatives after human approval. Not allowed automatically today.

---

## Rule precedence

### CURRENT CODE BEHAVIOR (`evaluateRules_`, lines 2074–2126)

1. Skip any rule whose ID is in `disabledRuleIds` (global `DISABLED_RULE_IDS` + per-account overrides / Hub cell).
2. For each remaining rule, compute a **trigger**:
   - Most rules: `firstMatchingPhrase_(searchTerm, rule.triggers)` (token + stem).
   - `LOCAL_COMPETITOR`: competitor phrase list (seeds + CONFIG + account).
   - `NAMED_LOCAL_SHOP`, `BARE_MAKE_MODEL`, `DEALER_OR_AUTO_GROUP`, `LOW_INTENT_AUTO_GEO`: custom functions.
3. If no trigger, the rule does not match.
4. If a trigger matches:
   - If **any** global/account **protected phrase** matches the query **or** this rule’s **exception** list matches → this rule is recorded as protected, **not** eligible.
   - Else the rule ID is **eligible**.
5. **`shouldExclude` = (eligibleRules.length > 0).** One eligible rule wins even if other rules were exception-protected.
6. Protected phrases (insurers, account name, CONFIG `PROTECTED_PHRASES`) apply to **the whole query**: if `accountProtection` is set, **every** matched rule is treated as protected and `shouldExclude` is false.

Comment at lines 339–342: “An exception protects only the rule on which it appears; CONFIG / ACCOUNT_OVERRIDES protected phrases protect the entire query.”

### After classification, processAccount gates (lines 1304–1574) — still CURRENT CODE

Order for a Built-by-Shah campaign term:

1. `WRONG_CAMPAIGN_NAME` (standalone)
2. `NO_RULE` or `PROTECTED`
3. `GOOGLE_STATUS` (ADDED / EXCLUDED / ADDED_EXCLUDED)
4. `CONVERTED_ACTION_WINDOW` if conversions > `MAX_ACTION_CONVERSIONS` (0)
5. `CONVERTED_HISTORY` if history conversions > 0
6. Safety ceiling
7. `MANUAL_REVIEW` if >80 characters or >10 words
8. Campaign resolve / PMax API
9. `ALREADY_COVERED`
10. Else queue **ADDED**

**There is no step that asks: “does this query also look like a serious accident?”** unless that language appears on **that rule’s exception list**.

### Mixed-signal examples (do not invent a winner)

| Query | What code does | What policy says |
|---|---|---|
| `dent repair` | `DENT_MINOR` trigger `dent`, no exception → **exclude** | Owner: minor dent generally not desired. **CONFIRMED** as generally DISQUALIFIED, but this conversation also says single-word `dent` must not automatically decide. **CONTRADICTORY** with code’s single-token trigger. Conservative rebuild: treat as **UNCERTAIN** unless more context. **INFERRED** from this conversation, not a locked exception list. |
| `major collision with frame damage and dents` | `DENT_MINOR` and `FRAME_NON_COLLISION` both have exception `collision` → those rules not eligible. If no other rule fires → **keep** | Owner: serious accident should not die because of “dents.” Code happens to keep **if** the word `collision` is present. **If the query said “major accident with frame damage and dents”** without `collision`/`accident`/`crash`/`insurance`/`claim`, `DENT_MINOR` would still exclude. **UNKNOWN** whether `accident` vs `collision` is required. |
| `accident bumper repair` | Documented keep for `BUMPER_MINOR` exception | **EXPLICIT** in docs (`accident bumper repair`). |
| `paint and body shop near me` | `PAINT_MINOR` trigger `paint and body`, **empty exceptions** → **exclude**. Walkthrough even uses this as a “confirm the add landed” example | Owner 2026-08-25: body-shop / body-work searches are **QUALIFIED**. **CONTRADICTORY** |
| `collision repair payment plan` | `PAYMENT_OR_FINANCING` has **no** collision exception → **exclude** | Documented as intended junk. **EXPLICIT** in HTML walkthrough. Whether that should remain under “false positives worse” is **UNKNOWN** (open question). |
| `2022 camry rear end collision` | `YEAR_TOKEN` matches `2022`, **no** exceptions → **exclude** | Docs warn this false positive. Owner previously accepted aggressive years. This conversation prefers not blocking valuable terms. **CONTRADICTORY** |
| `aaa auto repair` vs `aaa collision center` | Tests: first exclude, second protect via `aaa collision` | **EXPLICIT** test + docs. |

**Do not decide** whether a serious-accident signal **always** overrides a cosmetic word unless the exception list (or a new owner lock) says so. Unresolved mixed queries are **UNKNOWN**.

---

## Cross-cutting construction rules

### Words that must never be negated **by themselves**

**CONFIRMED REQUIREMENT (docs + Cursor rule + standalone header):** The add path must not create a negative whose text is only a trigger like `paint`, `dent`, `bumper`.

**CURRENT CODE BEHAVIOR:** Adds the **full query**. Coverage matching can still treat an **existing** broad/phrase negative of a short word as covering many queries (`negativeBlocksSearchTerm_`, lines 3040–3062).

**CONFIRMED REQUIREMENT (this conversation):** `dent`, `scratch`, `bumper`, and similar cosmetic words **in a longer query** must not automatically determine DISQUALIFIED.

**CURRENT CODE BEHAVIOR:** Those tokens **are** sufficient triggers for `DENT_MINOR`, `SCRATCH_OR_KEYED`, `BUMPER_MINOR` unless that rule’s exception list hits.

### Phrases protected even when they contain an exclusion word

**CURRENT CODE BEHAVIOR — global (whole query):**

- Google Ads **account name** (standalone `mergeAccountOverride_` lines 1757–1761)
- Hub **Client Name** + **Account Name** (`built-by-shah-mcc-search-negatives-sweeper.js` ~997–1000)
- `SEED_INSURER_PROTECTED_PHRASES` (lines 266–299), including `aaa collision`, `aaa insurance`, not bare `aaa`
- CONFIG / Hub **Protected Phrases**

**CURRENT CODE BEHAVIOR — per-rule exceptions only** (examples): `accident`, `collision`, `crash`, `insurance`, `claim` on several minor-damage rules; `fiberglass` on `AUTO_GLASS`; `body` / `collision` / … on `GENERIC_CAR_REPAIR`; structural words on `FRAME_NON_COLLISION`.

**CONFIRMED REQUIREMENT (2026-08-25 owner):** Phrases whose core meaning is **body work / auto body / body shop**, including with **near me**, **city**, or **OEM brand**, are protected/qualified — even though code currently negatived them.

### Extract one word from a query as the negative?

**CURRENT CODE BEHAVIOR on add:** **No.**

**CONFIRMED REQUIREMENT:** **No** for auto-apply.

**UNKNOWN:** Human-approved phrase negatives built from a substring.

### Prefer full-query exact?

**CURRENT CODE BEHAVIOR:** **Yes** for writes.

**CONFIRMED REQUIREMENT (Hub plan + docs):** **Yes** for auto-apply.

### When are phrase negatives allowed?

**CURRENT CODE BEHAVIOR:** Never created. May already exist; used only to skip new exacts if they already cover the term.

**CONFIRMED REQUIREMENT (Cursor rule):** Do not auto-add phrase/broad of a bare trigger.

**UNKNOWN:** Human-approved phrase negatives.

### Are broad negatives ever allowed?

**CURRENT CODE BEHAVIOR:** Never created by these scripts.

**UNKNOWN** for a future approved workflow.

### Maximum automatic negatives per account / run

**CURRENT CODE BEHAVIOR (not a product “only N junk terms” cap):**

- Standalone: `RUNAWAY_SAFETY_CEILING_PER_CHANNEL` 2500, `RUNAWAY_SAFETY_CEILING_PER_ACCOUNT` 5000 (lines 245–246)
- Backfill: docs say 50,000 per channel
- Hub Search: 500 per account (`RUNAWAY_SAFETY_CEILING_PER_ACCOUNT`)

Scanning is described as uncapped. Hitting the ceiling means **not stamped done**.

**CONFIRMED REQUIREMENT (this conversation):** Does not specify a numeric cap. Prefers fewer false auto-applies.

### Required human-approval rules

**CONFIRMED REQUIREMENT (this conversation):** Uncertain → human review **before** negate.

**CURRENT CODE BEHAVIOR:** Human review only for 80-char / 10-word exacts. Hub Reviewed is **after** add.

**CONFIRMED REQUIREMENT (Hub plan):** After-the-fact review + Remove. **CONTRADICTORY** with this conversation.

---

## Category catalog

For each category: policy status, then rule table(s). Columns match the requested schema.

**Auto-application allowed?** in tables is **rebuild-oriented**: `No` when this conversation requires caution; `Code: yes` documents live behavior.

---

### Serious collision and accident intent

**Policy:** Desired customer. **CONFIRMED REQUIREMENT** (this conversation).

**CURRENT CODE BEHAVIOR:** There is **no** positive “QUALIFIED if collision” classifier. Collision language is only an **exception** on some rules. Other rules (`YEAR_TOKEN`, `CHEAP`, `ESTIMATE_OR_QUOTE`, `PAYMENT_OR_FINANCING`, `SPANISH_LANGUAGE`, `TOWING`, `PAINT_MINOR`, `LOCAL_COMPETITOR`, …) can still exclude a collision query.

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POL-COLLISION-KEEP | Serious collision / accident keep | Highest among intent rules (desired) | Query expresses collision, crash, accident, frame/unibody damage from a wreck | Context of the full query, not one token | QUALIFIED | KEEP | No | UNKNOWN if every collision-adjacent Spanish/English variant counts | `major collision with frame damage and dents` should not be lost to `dent` alone **if** collision language is present — **if not present, UNKNOWN** | n/a | n/a | n/a | Owner: desired lead is meaningful collision damage | `honda accord collision insurance claim` (docs keep) | Cosmetic-only `dent repair` (generally not desired) | This conversation; HTML keep list `docs/Open this in a browser - Standalone Negatives Sweeper explained.html` ~553–554 | EXPLICIT (keep goal); code incomplete |
| DENT_MINOR (exceptions) | Collision words spare dent rule only | Per-rule | See DENT_MINOR | Exception tokens on that rule only | QUALIFIED **for this rule**; other rules may still DISQUALIFY | KEEP for this rule | Code: N/A (exception) | `accident`, `collision`, `crash`, `insurance`, `claim` | `accident bumper repair` pattern | n/a | n/a | n/a | Exception does not create a global QUALIFIED class | `rear end collision dent repair` (has collision) | `dent repair` | Daily script 349–357 | EXPLICIT in code |

---

### Frame, structural, and unibody damage

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FRAME_NON_COLLISION | Frame without collision context | Among cosmetic/wrong-job rules | Token/phrase `frame` | Full query | DISQUALIFIED in code if no exception; **UNKNOWN** if “frame” in a collision shop search without exception words | Code: AUTO; rebuild: UNCERTAIN if mixed | Code: yes | `accident`, `collision`, `crash`, `insurance`, `claim`, `structural`, `unibody`, `chassis`, `straightening`, `frame repair`, `frame damage` | `frame damage` itself is an exception (so `frame damage` does **not** fire this rule) | Full query exact | EXACT | Campaign | Docs: disable rarely. Trigger is bare `frame` | UNKNOWN (no labeled “frame only” gold set) | `unibody collision frame repair` (exceptions) | Daily 451–457; Hub guide row FRAME_NON_COLLISION | EXPLICIT code; intended DISQUALIFIED only INFERRED |

**CONTRADICTORY:** Exception list includes `frame repair` and `frame damage`, so those phrases **cannot** be blocked by this rule. Whether a shop wants to block “frame” DIY vs keep structural collision jobs is **UNKNOWN**.

---

### Insurance claim and estimate intent

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POL-INSURER-KEEP | Major insurer names | High protect | Phrase in `SEED_INSURER_PROTECTED_PHRASES` | Token match of distinctive insurer phrases | PROTECTED | KEEP | No | Bare `aaa` is **not** in the list | `aaa insurance auto repair`, `aaa collision center` | n/a | n/a | n/a | Protects whole query | `geico collision repair` | `aaa auto repair` still eligible for other rules | Daily 266–299; tests 113–130 | EXPLICIT |
| ESTIMATE_OR_QUOTE | Estimate / quote / free estimate | High auto-block in code | `estimate`, `quote`, `free estimate`, `free quote`, … | None in code | Owner 2026: DISQUALIFIED if “free estimate”; this conversation: many real collision customers search this → **UNCERTAIN / CONTRADICTORY** | Code: AUTO; rebuild: HUMAN_REVIEW until re-locked | Code: yes | **None** | `free quote collision repair` is **blocked in docs**, not protected | Full query | EXACT | Campaign | Owner previously chose block (option 1A) | `free estimate body shop` (code/docs exclude) | None in code | Daily 533–539; conversation 97da38e7 | CONTRADICTORY |
| APPRAISAL_OR_ADJUSTER | Appraisal / adjuster | Medium | `appraisal`, `appraiser`, `adjuster`, `collision appraisal` | None | **UNKNOWN** if insurance-driven collision customers are desired | Code: AUTO | Code: yes | **None** | `collision appraisal` still matches | Full query | EXACT | Campaign | Live add example 2026-08-24 email not in this list; rule exists | HTML/docs | UNKNOWN if QUALIFIED | Daily 541–544 | EXPLICIT code; intent UNKNOWN |
| PUT_A_CLAIM_SCAMMY | “Put a claim” | Medium | Phrase `put a claim` only | Not bare `claim` | DISQUALIFIED (docs) | AUTO in code | Code: yes | None | Bare `claim` is **not** this rule; `claim` is an exception on minor-damage rules | Full query | EXACT | Campaign | Docs: not bare “claim” | `put a claim` | `insurance claim collision` | Daily 592–595; Hub guide | EXPLICIT |

---

### Towing or undrivable vehicles

**Policy: UNDEFINED** whether these are QUALIFIED (serious accident) or DISQUALIFIED (tow company).

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TOWING | Tow / towing | Medium | `tow`, `towing`, `tow truck` | None | UNDEFINED | Code: AUTO | Code: yes | **None** — collision language does **not** spare this rule | UNKNOWN | Full query | EXACT | Campaign | Hub guide: disable if shop offers towing | `tow truck near me` | UNKNOWN keep set | Daily 629–632 | EXPLICIT code; business UNDEFINED |

---

### Cosmetic scratches, dings, and dents

**CONFIRMED REQUIREMENT:** Small scratches, minor dings/dents generally **not** desired. **Also CONFIRMED:** those words in a serious-collision query must not auto-decide.

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples (code exclude) | Negative examples (code keep if exception) | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DENT_MINOR | Dent / dented | High in code | `dent`, `dented`, `dents`, suction/pull-out phrases, `dent fixer`, `chips and dents` | Code: none beyond exception list | Generally DISQUALIFIED if truly minor; UNCERTAIN if only the word `dent` | Code: AUTO | Code: yes | `accident`, `collision`, `crash`, `insurance`, `claim` | `major collision … dents` if `collision` present | Full query | EXACT | Campaign | Stem: dents≈dent | `dent repair near me`, `fix small dent in car` | Query with `collision` + dent | Daily 349–357 | CONTRADICTORY (token vs context) |
| DING_MINOR | Ding | High | `ding`, `dings`, `door ding` | Same exception family | Same tension | Code: AUTO | Code: yes | accident/collision/crash/insurance/claim | UNKNOWN mixed | Full query | EXACT | Campaign | Live add: `[car ding repair near me]` 2026-08-24 | `door ding repair` | With collision words | Daily 416–419 | EXPLICIT code |
| SCRATCH_OR_KEYED | Scratch / keyed / scrape | High | `scratch`, `keyed`, `scrape`, `buff out`, `fix scratch`, … | Exceptions include `vandalism` | Same tension | Code: AUTO | Code: yes | accident/collision/crash/insurance/claim/**vandalism** | UNKNOWN if vandalism collision shop work is wanted | Full query | EXACT | Campaign | Live: `[scratch on tesla]`, `[keyed car repair]` | `fix scratches on car` | With accident | Daily 386–394 | EXPLICIT code |
| SMALL_JOB | Token `small` | Aggressive | `small` | Same exceptions | **UNKNOWN** if “small collision” should keep | Code: AUTO | Code: yes | accident/collision/crash/insurance/claim | `small` in unrelated phrases | Full query | EXACT | Campaign | Very broad token | `fix small dent in car` | With collision | Daily 381–384 | EXPLICIT code; high FP risk |

---

### Paintless dent repair

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PAINTLESS_DENT | PDR | High | `paintless`, `dent specialist`, `pdr` | **No** collision exception | DISQUALIFIED in code even with `collision` | Code: AUTO | Code: yes | **Empty** | `paintless dent repair` after a crash still excludes | Full query | EXACT | Campaign | Disable if shop offers PDR | `paintless dent repair` | None | Daily 376–379 | EXPLICIT code; collision override UNKNOWN / absent |

---

### Minor bumps

**UNDEFINED** as its own category. `BUMPER_MINOR` and `DING_MINOR` / `SMALL_JOB` are the closest code. No trigger for English “bump” except bumper/ding.

---

### Bumper-only work

**CONFIRMED REQUIREMENT:** Bumper-only replacement inquiries generally not desired. **Also CONFIRMED:** bumper in a serious collision query must not auto-decide.

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BUMPER_MINOR | Bumper | High | `bumper`, `bumpers`, clips, `bumper solutions` | Exceptions only | DISQUALIFIED if bumper-only; UNCERTAIN if mixed | Code: AUTO | Code: yes | accident/collision/crash/insurance/claim | `accident bumper repair` | Full query | EXACT | Campaign | Live: `[can a rear bumper be repaired]` | `car rear bumper loose` (owner wanted this blocked 2026-08-24) | `accident bumper repair` | Daily 359–362; owner miss list | CONTRADICTORY vs context rule |
| BROKEN_PART | Broken bumper / lights | Medium | `broken bumper`, broken lights/mirrors, replacements | None | UNDEFINED vs collision | Code: AUTO | Code: yes | Empty | UNKNOWN | Full query | EXACT | Campaign | May overlap collision | `broken bumper` | UNKNOWN | Daily 602–612 | EXPLICIT code |

---

### Paint and refinishing

**CONFIRMED REQUIREMENT:** Cosmetic paint generally not desired. **CONTRADICTORY:** “paint and body” is how customers describe body shops; owner 2026-08-25 said body-work searches are QUALIFIED. `PAINT_MINOR` has **no** collision/body-shop exception.

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PAINT_MINOR | Paint / refinish / clear coat | Very high FP | `paint`, `repaint`, `paint and body`, `auto paint`, `clear coat`, `coloring`, `refinish`, … | None | Code: DISQUALIFIED; owner body-shop language: QUALIFIED for paint-and-body shop searches | Code: AUTO | Code: yes | **Empty** | `paint and body shop near me` is a **docs example of an added negative** | Full query | EXACT | Campaign | Stem: painting/repaint≈paint | `car painting dallas`, `places to get your car painted` (live add) | None in code | Daily 364–374; standalone doc line 123 | CONTRADICTORY |
| CUSTOM_BODY_OR_PAINT | Custom body/paint | High | `custom body`, `custom paint`, `custom shop`, `custom body shop` | None | Assistant plan: custom stays junk; plain body work does not | Code: AUTO | Code: yes | Empty | `custom body shop near me` (test expects exclude) | Full query | EXACT | Campaign | Owner A/C did not explicitly lock custom; plan inferred | `custom body shop near me` | `body work shop` (owner keep) | Daily 634–640; plan Keep body work | EXPLICIT code; custom vs plain INFERRED |
| DETAILING | Buff / polish / detail | Medium | `detailing`, `buff`, `buffing`, `polish`, … | None | Generally DISQUALIFIED (cosmetic) | Code: AUTO | Code: yes | Empty | UNKNOWN if post-collision refinish uses “buff” | Full query | EXACT | Campaign | Owner wanted `car buffing near me` blocked | `car buffing near me` | UNKNOWN | Daily 421–427 | EXPLICIT code |

---

### Auto glass and windshield work

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTO_GLASS | Glass / windshield / crack | High | `glass`, `window`, `safelite`, `windshield`, `windsheild`, `crack` | Exception `fiberglass` only | DISQUALIFIED if shop does not do glass; disable per Hub | Code: AUTO | Code: yes | `fiberglass` | Stem `cracked`→`crack` can hit dashboard queries | Full query | EXACT | Campaign | Live: `[cracked dashboard repair near me]` labeled AUTO_GLASS | `safelite windshield repair` | `fiberglass` | Daily 404–409; email 2026-08-24 | EXPLICIT code; crack stemming CONTRADICTORY vs intent |
| TINT | Window tint | Medium | `tint`, `tinting` | None | DISQUALIFIED unless shop does tint | Code: AUTO | Code: yes | Empty | UNKNOWN | Full query | EXACT | Campaign | Stem tints≈tint | `tints near me` (matcher test) | UNKNOWN | Daily 411–414 | EXPLICIT |

---

### Mechanical repair and maintenance

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MECHANICAL_REPAIR | Oil / brakes / engine / AC / … | High | `oil change`, `brakes`, `engine`, `engine repair`, `transmission`, … | **No** collision exception | DISQUALIFIED mechanical-only | Code: AUTO | Code: yes | Empty | `engine` as a token can be broad | Full query | EXACT | Campaign | Owner wanted `engine repair dallas` blocked | `oil change near me` | UNKNOWN collision+engine | Daily 555–564 | EXPLICIT code |
| GENERIC_CAR_REPAIR | Car/auto repair / mechanic | High | `car repair`, `auto repair`, `fix car`, `mechanic`, `service`, … | Exceptions: body/collision/accident/insurance/fender/panel | DISQUALIFIED general repair; QUALIFIED if body language | Code: AUTO if no exception | Code: yes | `body`, `autobody`, `auto body`, `collision`, `accident`, `crash`, `insurance`, `claim`, `fender`, `panel` | **`body work` is not listed**; stem `body works` was used as competitor instead | Full query | EXACT | Campaign | Live many `[car repair near me]` style adds | `car repair near me` | `auto body repair near me` (exception body) | Daily 495–510 | EXPLICIT; body-work gap CONTRADICTORY |
| CAR_KEY | Keys | Medium | `car key`, `lost key`, `key fob`, `spare key` | None | DISQUALIFIED | Code: AUTO | Code: yes | Empty | `keyed` is mapped to stay `keyed` (not `key`) | Full query | EXACT | Campaign | Distinct from keyed-car | `lost car key` | `keyed car` uses other rule | Daily 459; STEM map 4134–4137 | EXPLICIT |
| WHEELS_OR_EXHAUST | Tires / rims / alignment / weld | Medium | `rim`, `tire`, `exhaust`, `alignment`, `welder`, … | None | UNDEFINED vs collision wheel damage | Code: AUTO | Code: yes | Empty | UNKNOWN | Full query | EXACT | Campaign | Broad tokens `wheel`, `tire` | UNKNOWN | UNKNOWN | Daily 439–447 | EXPLICIT code; intent UNKNOWN |

---

### Parts, supplies, paint codes, and body kits

**Paint codes:** **UNDEFINED** (no rule).

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PARTS_OR_INSTALLATION | Parts / kits / interior / dash | Medium | `parts`, `kit`, `body kit`, `dashboard`, `install`, `upholstery`, … | None | DISQUALIFIED DIY/parts | Code: AUTO | Code: yes | Empty | `dashboard repair` owner wanted blocked | Full query | EXACT | Campaign | | `dashboard repair` | UNKNOWN collision interior | Daily 429–437 | EXPLICIT |
| AFTERMARKET_AERO | Carbon / splitter | Low | `carbon fiber`, `splitter` | None | DISQUALIFIED in code | Code: AUTO | Code: yes | Empty | UNKNOWN | Full query | EXACT | Campaign | Owner miss list `carbon fiber splitter repair` in older thread | UNKNOWN | UNKNOWN | Daily 614–617 | EXPLICIT code |
| REBUILD_OR_TRUCK_BODY | Rebuild / restomod / truck body | Medium | `rebuild`, `restomod`, `truck body`, `car rebuild` | None | UNDEFINED vs wrecked-car rebuild after collision | Code: AUTO | Code: yes | Empty | Live add `[wrecked car rebuild]` | Full query | EXACT | Campaign | May be QUALIFIED collision | `wrecked car rebuild` (live exclude) | UNKNOWN | Daily 619–622; email 2026-08-24 | EXPLICIT code; intent UNKNOWN |

---

### DIY and how-to searches

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GARAGE_DIY_BODY | DIY / garage body | Medium | `diy`, `do it yourself`, `home garage`, `garage body`, `garage body work` | None | DISQUALIFIED DIY | Code: AUTO | Code: yes | Empty | Phrase `garage body work` could collide with “body work” keep policy | Full query | EXACT | Campaign | | `diy dent repair` | Plain `body work near me` is different phrase | Daily 642–648 | EXPLICIT code; overlap with POL-BODYWORK UNKNOWN |

**Informational vs transactional “how to”:** **UNDEFINED** beyond listed DIY triggers. No general “how to” rule.

---

### Jobs, careers, salary, schools, and training

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CAREERS_OR_HIRING | Jobs / salary / internship | Medium | `hiring`, `career`, `salary`, `auto body tech`, … | None | DISQUALIFIED unless shop recruits via Ads | Code: AUTO | Code: yes | Empty | `auto body technician` is a trigger — **blocks job-seekers**, not customers | Full query | EXACT | Campaign | Disable if recruiting | `body shop hiring` | Customer `auto body` without job words | Daily 512–520 | EXPLICIT |

**Schools / training:** **UNDEFINED** except tokens that happen to match `career` / `internship`.

---

### Free or extremely price-sensitive searches

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CHEAP | Cheap / affordable | High | `cheap`, `cheapest`, `cheaply`, `affordable` | **No** collision exception | DISQUALIFIED in code even on collision queries | Code: AUTO | Code: yes | Empty | `cheap auto body near me` | Full query | EXACT | Campaign | Docs: almost never disable | `affordable car repair near me` (live) | UNKNOWN if affordable collision is still a wanted lead | Daily 475–478 | EXPLICIT code; this-conversation conservatism UNKNOWN vs cheap |
| COUPON | Coupon | Medium | `coupon` | None | DISQUALIFIED | Code: AUTO | Code: yes | Empty | UNKNOWN | Full query | EXACT | Campaign | | UNKNOWN | UNKNOWN | Daily 449 | EXPLICIT |
| PAYMENT_OR_FINANCING | Financing / BNPL | High | `payment plan`, `pay later`, `loan`, `affirm`, … | **No** collision exception | DISQUALIFIED in docs | Code: AUTO | Code: yes | Empty | `collision repair payment plan` **blocked on purpose** in HTML | Full query | EXACT | Campaign | | `fix now pay later` | Collision+financing still excluded | Daily 522–530 | EXPLICIT; whether still desired UNKNOWN |

---

### Competitor searches

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LOW_VALUE_COMPETITOR | National cheap chains | High | maaco, pep boys, earl scheib, fix auto, midas, … (not identical to seed list) | None | DISQUALIFIED | Code: AUTO | Code: yes | Empty | `fix auto collision` still excluded | Full query | EXACT | Campaign | Bare `earl` is on **seed competitor** list for LOCAL_COMPETITOR, and LOW_VALUE has scheib variants | `earl scheib` | `earl smith collision` FP warned | Daily 465–473, 301–326 | EXPLICIT |
| LOCAL_COMPETITOR | Seed + CONFIG + Hub phrases | High | `firstMatchingPhrase` on competitor list | Distinctive names intended | DISQUALIFIED if truly another shop; **QUALIFIED false hit** if seed is `body works` or `auto arena body shop` on the wrong account | Code: AUTO | Code: yes | Whole-query protect if phrase is own account name | `auto arena body shop` keep **only** when account name matches | Full query | EXACT | Campaign | Tests 100–110 | `ames collision center` (seed) | Own-account brand | Daily 480, 2088–2092 | CONTRADICTORY (`body works`) |
| NAMED_LOCAL_SHOP | Heuristic named shop | Medium conservative | Possessive + marker, or ≥2 leftover name tokens after stripping fillers/places | Markers: auto body / body shop / collision… | DISQUALIFIED if high-confidence other shop; KEEP if 0–1 leftover token | Code: AUTO when fires | Code: yes | Generic body intent / OEM collision keep / pure geo keep return '' | `dallas auto body shop` keep (test); `auto body shop new rochelle` **fired** (owner keep) | Full query | EXACT | Campaign | Incomplete city list | `harvey's body shop dallas` (live) | City-only collision | Daily 2229–2278 | CONTRADICTORY on unknown cities |

---

### Dealership and manufacturer searches

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DEALER_OR_AUTO_GROUP | Dealer / OEM service / `cadillac body` | High FP | Triggers include `dealership`, `auto group`, `bmw service`, **`cadillac body`**, plus OEM+service heuristic | OEM + collision/body shop: only if named-shop also fires | Owner 2026-08-25: Cadillac/BMW **body shop / body work** is QUALIFIED | Code: AUTO | Code: yes | Collision/body shop without named shop returns '' | `cadillac body shop near me` **currently excludes via `cadillac body`** | Full query | EXACT | Campaign | Plan: remove `cadillac body` — **not implemented** | `bmw service` | `bmw body work repairs` (owner keep) | Daily 484–493, 2328–2357 | CONTRADICTORY |

---

### Vehicle make/model searches

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BARE_MAKE_MODEL | Make/model only, ≤3 tokens | Medium | Entire term ⊆ `BARE_MAKE_MODEL_TOKENS` | No other tokens | DISQUALIFIED bare shopping | Code: AUTO | Code: yes | N/A (function returns '') if extra tokens | `honda accord collision…` has extra words | Full query | EXACT | Campaign | `sprinter` is both here and SPRINTER_VAN | `honda` | `honda accord collision insurance claim` | Daily 666–673, 2360–2370 | EXPLICIT |
| YEAR_TOKEN | Model year 1990–2026 | Aggressive | Any 4-digit year in range | **No** collision exception | Owner previously accepted FP; this conversation does not | Code: AUTO | Code: yes | **Empty** | `2022 camry rear end collision` **excludes** | Full query | EXACT | Campaign | Docs aggressive list | `2009 honda accord` | Collision+year still excluded | Daily 328–336, 650–654; Hub guide 111 | CONTRADICTORY |
| SPRINTER_VAN | Sprinter | Medium | `sprinter` | None | DISQUALIFIED unless shop does Sprinters | Code: AUTO | Code: yes | Empty | UNKNOWN | Full query | EXACT | Campaign | Also in bare make list | `sprinter van body` (docs smoke block) | UNKNOWN | Daily 580 | EXPLICIT |
| OEM keep helpers | Certified/generic OEM collision | Protect | `isOemCollisionKeepIntent_` | OEM token + collision/auto body/body shop + only allowed filler tokens | QUALIFIED | KEEP (prevents NAMED_LOCAL_SHOP) | No | Extra tokens fail keep | **Does not include `body work`** — so `bmw body work repairs` is **not** kept by this helper | n/a | n/a | n/a | Allowed set lines 2206–2210 omits `work` | `bmw body shop` may keep | `bmw body work repairs` owner keep but helper miss | Daily 2183–2219 | EXPLICIT code gap |

---

### Commercial, fleet, and specialty vehicles

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RV_OR_MOTORHOME | RV | Medium | `rv`, `motorhome`, … | None | DISQUALIFIED unless shop serves RVs | Code: AUTO | Code: yes | Empty | UNKNOWN | Full query | EXACT | Campaign | | UNKNOWN | UNKNOWN | Daily 624–627 | EXPLICIT |
| CLASSIC_OR_OLD_CAR | Classic / antique | Medium | `classic car`, `old car`, … | None | DISQUALIFIED unless shop does classics | Code: AUTO | Code: yes | Empty | UNKNOWN | Full query | EXACT | Campaign | | UNKNOWN | UNKNOWN | Daily 546–553 | EXPLICIT |

**Fleet:** **UNDEFINED**.

---

### Service-area cities / out-of-area cities / “near me”

**Service-area per shop:** **UNDEFINED**. No Hub column for service cities. Static US place lists are for **named-shop stripping**, not geo targeting.

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POL-NEAR-ME | Near me / local intent | High keep | `near me` plus body-shop language | Full query | QUALIFIED (owner 2026-08-25) | KEEP | No | Not a code rule | `body work near me` | n/a | n/a | n/a | Owner: near me and city names are good customers | `body work near me` | Competitor name + near me still may exclude | Conversation 0715bce9 | EXPLICIT_USER |
| isGeoBodyShopIntent_ | Listed city + body/collision | Protect vs named shop | Service phrases + **zero** leftover name bits | City must be in `US_PLACE_*` | QUALIFIED | KEEP (blocks NAMED_LOCAL_SHOP) | No | Leftover tokens fail | `collision repair dallas` keep; `new rochelle` **not listed** | n/a | n/a | n/a | Incomplete gazetteer | `yonkers auto body shop` | `auto body shop new rochelle` | Daily 2307–2324; tests 133–140 | EXPLICIT code; city coverage UNKNOWN |
| LOW_INTENT_AUTO_GEO | `car in dallas` | Low | Vehicle token + named place, **no** body/collision/repair/shop/near me | Narrow | DISQUALIFIED low intent | Code: AUTO | Code: yes | Returns '' if `near me` or `body`/`repair`/… | `car near me` keep (test); `car` keep | Full query | EXACT | Campaign | Owner wanted `car in dallas` blocked | `car in dallas` | `body shop in dallas` | Daily 2373–2437; tests 142–150 | EXPLICIT |

**Out-of-area cities:** **UNDEFINED** (no shop geo fence).

---

### Informational versus transactional intent

**UNDEFINED** as a general policy. No classifier for “what is collision repair” vs “collision shop near me” except fillers that include `what`/`how` in `NAMED_SHOP_FILLER_TOKENS` (those tokens are stripped for name-bit counting, not used as a DISQUALIFIED informational rule).

---

### Legal, accident attorney, and insurance-only searches

**UNDEFINED.** Insurer **names** are protected. Attorney / lawyer / “car accident attorney”: **no rule found**.

---

### Existing customer, phone number, directions, or navigational searches

**UNDEFINED.** No rule for phone, hours, directions, “login”, etc.

---

### Misspellings, abbreviations, and multilingual searches

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SPANISH_LANGUAGE | Spanish body/collision lexicon | High CONTRADICTION | Includes **collision words** `choque`, `colision`, plus `enderezado`, `pintura`, `cerca de mi`, `golpe`, `reparar`, … | None | Code: DISQUALIFIED all listed Spanish; business: collision Spanish may be QUALIFIED | Code: AUTO | Code: yes | **Empty** | Spanish collision seekers blocked | Full query | EXACT | Campaign | Docs smoke: `taller de enderezado y pintura cerca de mi` should block | Live `[talleres de pintura automotriz cerca de mi]` | UNKNOWN keep Spanish collision | Daily 581–590 | CONTRADICTORY |
| Stem / listed variants | earl shibe, windsheild | Low | Listed misspellings only | — | — | — | — | — | Docs: no general fuzzy match | — | — | — | | | Hub guide “cannot auto-detect” | EXPLICIT limit |

`normalizeText_` strips accents (NFKD) so `colisión` ≈ `colision`. **CURRENT CODE BEHAVIOR** lines 4151–4158.

---

### Converted search terms

**CURRENT CODE BEHAVIOR:** If `actionConversions` or `historyConversions` > 0 → **KEEP** (`CONVERTED_*` decisions), even if rules match.

**CONFIRMED REQUIREMENT (Hub plan / docs):** Do not auto-negative converters in those windows.

**UNKNOWN:** Whether a converted cosmetic query should still be reviewed. Code always keeps.

**Conversion lag beyond 30 days:** **UNKNOWN**; code will not see it.

---

### Existing targeted keywords

**UNDEFINED / not used.** Classification does not read the matched keyword except as part of the search-term view row. Hub Search GAQL selects `ad_group` but aggregation keys **campaign + term**, discarding ad group. **CURRENT CODE BEHAVIOR** daily 1958–1966 vs 2019.

Confusing search-term intent with keyword performance: **not implemented** (good). Also **not implemented:** never-negative if the term **is** an exact keyword. **UNKNOWN** if that should exist.

---

### Existing negative keywords

**CURRENT CODE BEHAVIOR:** If an existing campaign or attached shared-list negative already covers the term (exact/phrase/broad matching in `negativeBlocksSearchTerm_`) → `ALREADY_COVERED`, no new add. **Does not remove** conflicting negatives. **Does not write** shared lists.

---

### Search terms with insufficient data

**CURRENT CODE BEHAVIOR:** Requires `actionImpressions >= MIN_ACTION_IMPRESSIONS` (1). **No** minimum clicks or spend. Zero-conversion **is required** to add (`MAX_ACTION_CONVERSIONS` 0).

**CONFIRMED REQUIREMENT (this conversation):** Do not treat short-window zero conversions as sufficient for DISQUALIFIED. Code **does**. **CONTRADICTORY**.

---

### Ambiguous and mixed-intent queries

**CONFIRMED REQUIREMENT:** HUMAN_REVIEW, not AUTO.

**CURRENT CODE BEHAVIOR:** No UNCERTAIN class. First eligible rule wins.

**MANUAL_REVIEW:** only `MAX_NEGATIVE_KEYWORD_CHARACTERS` 80 and `MAX_NEGATIVE_KEYWORD_WORDS` 10 (CONFIG 239–240, `prepareExactNegative_` 2996–3029).

---

## Owner-locked keep policy: “body work” (2026-08-25)

Not a script Rule ID. **CONFIRMED REQUIREMENT** from owner-labeled false adds + A/C answers.

| Rule ID | Rule name | Priority | Trigger/condition | Required context | Intended classification | Permitted operation | Auto-application allowed? | Exceptions | Protected counterexamples | Recommended negative text | Match type | Scope | Explanation | Positive examples | Negative examples | Source | Evidence status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POL-BODYWORK-KEEP | Body work is the service | Highest vs LOCAL_COMPETITOR/DEALER for these shapes | Query is body work / auto body works / body work shop / automotive body work, optional near me / city / OEM | Full phrase, not competitor seed `body works` | QUALIFIED | KEEP | No | Plan: still block `custom body shop` — **INFERRED**, owner did not re-confirm custom | The 12 listed terms | n/a | n/a | n/a | Stem bug + cadillac body + missing city caused FPs | See CSV EX-001..012 | `custom body shop near me` still test-excluded | Conversation 0715bce9; tests still expect some competitor excludes | EXPLICIT_USER_LABEL on the 12; custom INFERRED |

**CURRENT CODE BEHAVIOR:** Still auto-negatives most of these. **Not implemented.**

---

## Exterior panels, rust, renovation, same-day (remaining script rules)

| Rule ID | Triggers (summary) | Exceptions | Code auto? | Policy | Evidence |
|---|---|---|---|---|---|
| EXTERIOR_PANEL_MINOR | hood, roof, door, mirror, plastic, undercarriage | accident/collision/crash/insurance/claim | Yes | Same token-vs-context tension as dent | Daily 396–402 EXPLICIT |
| RUST | rust | none | Yes | Disable if shop does rust; UNDEFINED vs collision rust | Daily 450 |
| RENOVATION | renovation, renovate | none | Yes | UNDEFINED (home renovation vs auto) | Daily 597–600 |
| SAME_DAY_OR_ONE_DAY | same day, 1 day, one day | none | Yes | Docs smoke `same day dent repair` block; may be QUALIFIED urgent collision **UNKNOWN** | Daily 575–578 |
| MOBILE_SERVICE | mobile app/repair/dent/mechanic | `automobile` | Yes | Disable if shop is mobile | Daily 460–463 |
| SALVAGE_OR_JUNKYARD | salvage, pick n pull, junkyard | none | Yes | Owner wanted salvage terms blocked 2026-08-24 | Daily 566–573 EXPLICIT |

---

## Summary: code vs conservative rebuild

| Topic | CURRENT CODE | CONFIRMED conservative rebuild (this conversation) |
|---|---|---|
| Decision unit | Any eligible trigger | Full-query context; no single cosmetic word |
| Default for overlap | Exclude if any eligible rule | UNKNOWN except collision should not lose to `dent` when collision is explicit — even that is only clearly coded when exception tokens appear |
| Uncertainty | Almost never | HUMAN_REVIEW |
| Body work / OEM body shop | Often AUTO_NEGATIVE | KEEP |
| Auto-apply | Default | Only when clearly DISQUALIFIED; **threshold UNDEFINED** |

Do not implement production changes from this file. Use it to ask the owner the open questions in `05_RISKS_BUGS_AND_OPEN_QUESTIONS.md`.
