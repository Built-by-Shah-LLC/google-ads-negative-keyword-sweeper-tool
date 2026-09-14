# Rule-conformance audit — Royal Auto Body & Erland Auto Body (30-day Moonshot runs)

Date: 2026-09-09. Method: deterministic replay of the explicit token locks in
`src/config/negative-keyword-rules.md` (rule set 2026-09-09.1, prompt collision-classifier-v7,
release `2026-09-09.3`) against the recorded kimi-k2.6 decisions from the two
30-day measurement runs. Each account is audited independently against the same policy;
no Google Ads or LLM calls are made by this audit. Hard checks encode only patterns the
policy names verbatim; indicative checks need human judgment for competitor leftovers.
Generator: `scripts/audit-rule-conformance.ts`. The "Analyst notes" subsections are
manual additions — re-running the generator reproduces the tables but not the notes.

## Headline summary

| Account | Decisions | KEEP / NEGATIVE | Contract violations | Hard-lock conformance | Own-brand KEEPs |
|---|---|---|---|---|---|
| Royal Auto Body (9803927293) | 1967 | 690 / 1277 | 0 | 99.8% | 0 |
| Erland Auto Body & Repair (5954806992) | 2285 | 797 / 1488 | 0 | 100.0% | 0 |

## Royal Auto Body (`9803927293`)

- Run: `runs/measure-royal-30day-kimi-20260909T085927172Z`
- Window: 2026-08-09 → 2026-09-07 | Model: kimi-k2.6 | Rules: 2026-09-09.1 / collision-classifier-v7
- Decisions: **1967** (690 KEEP, 1277 NEGATIVE_EXACT)
- Already excluded by existing negatives in Google Ads (targetingStatus EXCLUDED): 1165 of 1967
- Traffic on proposed negatives: 75 clicks, $598.55 spend, 6 conversions (30d)
- Confidence: p10 0.90, p50 0.95, p90 1.00 | below 0.70: 0

### Contract and exact-text integrity

All 1967 decisions satisfy the output contract: valid rule IDs, KEEP/NEGATIVE rule-citation rules, `negativeText` byte-identical to the full search term on every NEGATIVE_EXACT, null on KEEP, confidence within [0,1], reasons ≤ 240 chars.

### Explicit token-lock conformance

Checks below encode only patterns the policy names verbatim. **Hard** checks are always-win/always-KEEP token locks where a mismatch is a probable rule violation. **Indicative** checks flag mismatches for human review because competitor/leftover evidence the detector cannot see may justify them.

| Check | Rule | Expect | Matched | Conformant | Rate |
|---|---|---|---|---|---|
| Reviews / photos / ratings research | POL-REVIEWS-NEGATIVE | NEGATIVE_EXACT | 9 | 9 | 100% |
| 24/7 and 24-hour hours demand | POL-HOURS-247-NEGATIVE | NEGATIVE_EXACT | 2 | 2 | 100% |
| Quick / fast / minor / same-day / one-day small rush jobs | POL-SMALL-SPEED-NEGATIVE | NEGATIVE_EXACT | 5 | 5 | 100% |
| Mobile coming-to-you service (excl. Mobile AL geo) | POL-MOBILE-SERVICE-NEGATIVE | NEGATIVE_EXACT | 0 | 0 | — |
| Aluminum / steel / iron (always-win, even with body wording) | POL-METAL-MATERIAL-NEGATIVE | NEGATIVE_EXACT | 1 | 1 | 100% |
| Paint / color / repaint mention (always-win) | POL-PAINT-COLOR-NEGATIVE | NEGATIVE_EXACT | 113 | 113 | 100% |
| Salvage title / junk / rebuild-car demand | POL-SALVAGE-JUNK-NEGATIVE | NEGATIVE_EXACT | 4 | 4 | 100% |
| Inspection / inspector ask | POL-INSPECTION-NEGATIVE | NEGATIVE_EXACT | 2 | 2 | 100% |
| Towing / wrecker demand | POL-TOWING-NEGATIVE | NEGATIVE_EXACT | 0 | 0 | — |
| Trucks / RV / Sprinter / motorcycle / bike / scooter / ATV | POL-WRONG-VEHICLE-NEGATIVE | NEGATIVE_EXACT | 6 | 6 | 100% |
| Lucid vehicles (never OEM KEEP) | POL-WRONG-VEHICLE-NEGATIVE | NEGATIVE_EXACT | 1 | 1 | 100% |
| Fender-bender slang, dent/scratch ask, PDR, hole-fill | POL-COSMETIC-ONLY-NEGATIVE | NEGATIVE_EXACT | 87 | 87 | 100% |
| Informational question openers (not trailing ?) | POL-INFORMATIONAL-NEGATIVE | NEGATIVE_EXACT | 4 | 4 | 100% |
| Quote / price / cost / cheap / financing / how much | POL-PRICE-SHOPPER-NEGATIVE | NEGATIVE_EXACT | 52 | 51 | 98% |
| Website / domain / login navigation | POL-WEBSITE-NAV-NEGATIVE | NEGATIVE_EXACT | 4 | 4 | 100% |
| Custom body / fabrication shops | POL-CUSTOM-FABRICATION-NEGATIVE | NEGATIVE_EXACT | 0 | 0 | — |
| Contiguous auto/car repair, no body-shop or crash-event wording | POL-MECHANICAL-ONLY-NEGATIVE | NEGATIVE_EXACT | 91 | 91 | 100% |
| Mechanic / technician / standalone tech / service kill list | POL-MECHANICAL-ONLY-NEGATIVE | NEGATIVE_EXACT | 78 | 78 | 100% |
| Body-attached repair (auto body repair / body repair) with no always-win evidence *(indicative)* | POL-BODYWORK-KEEP | KEEP | 73 | 69 | 95% |
| best / top rated / highest rated / 5 star shop-finding with body/collision demand *(indicative)* | POL-BODYWORK-KEEP / POL-REVIEWS-NEGATIVE carve-out | KEEP | 30 | 30 | 100% |
| korean / german / italian / european / japanese + body-shop wording *(indicative)* | POL-BODYWORK-KEEP | KEEP | 5 | 5 | 100% |
| Origin adjective + collision without body-shop wording | POL-COMPETITOR-NEGATIVE | NEGATIVE_EXACT | 11 | 11 | 100% |
| Contiguous auto/car repair WITH body-shop wording present *(indicative)* | POL-BODYWORK-KEEP | KEEP | 7 | 6 | 86% |

### Hard-lock mismatches (probable rule violations)

#### Quote / price / cost / cheap / financing / how much — 1 of 52 mismatched

| Search term | Decision | Cited rules | Reason | Campaign | Imp | Clk |
|---|---|---|---|---|---|---|
| auto body repair time estimates | KEEP | POL-BODYWORK-KEEP | Body-shop repair wording present; time estimate is not a price-shop signal. | Retargeting (Search Campaign Visitors) – Built by Shah | 1 | 0 |

### Indicative mismatches (human review — may be justified by competitor evidence)

#### Body-attached repair (auto body repair / body repair) with no always-win evidence — 4 of 73 flagged

| Search term | Decision | Cited rules | Reason | Imp | Clk |
|---|---|---|---|---|---|
| royal auto body & repair center | NEGATIVE_EXACT | POL-OWN-BRAND-NEGATIVE | Query contains the advertised organization's distinctive name "Royal Auto Body". | 2 | 0 |
| royal auto body repair | NEGATIVE_EXACT | POL-OWN-BRAND-NEGATIVE | Query contains the advertised organization's distinctive name. | 1 | 0 |
| honda dealer auto body repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Explicit dealership reference (`dealer`) with body repair intent; dealer collision centers are named competitors. | 1 | 1 |
| royal auto body repair | NEGATIVE_EXACT | POL-OWN-BRAND-NEGATIVE | Query contains the advertised organization's distinctive name Royal Auto Body. | 1 | 0 |

#### Contiguous auto/car repair WITH body-shop wording present — 1 of 7 flagged

| Search term | Decision | Cited rules | Reason | Imp | Clk |
|---|---|---|---|---|---|
| nico's auto repair & bodywork shop | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Possessive personal/business name 'nico's' indicates a named competitor after stripping service vocabulary. | 1 | 0 |

### Own-brand suppression (`POL-OWN-BRAND-NEGATIVE`)

Queries containing the organization's distinctive name (`royal`): **28**. KEPT (hard violation): **0**. Negative without citing own-brand (soft note): **5**.

### Phrase-protection exercise (release 2026-09-09.3 feature)

4 queries matched a configured protection. The excused evidence applies only to the specified rule; remaining independent exclusions must still hold.

| Search term | Protection(s) | Decision | Cited rules | Reason |
|---|---|---|---|---|
| san leandro collision & service center | collision-service | KEEP | POL-GEO-LOCAL-KEEP | City plus collision-center demand; configured phrase protection excuses the service token within the matched phrase. |
| american collision services | collision-services | KEEP | POL-COLLISION-KEEP | Protected phrase excuses `services` mechanical evidence; remaining `collision` crash-event signal establishes generic collision demand. |
| san leandro collision & service center | collision-service | KEEP | POL-GEO-LOCAL-KEEP | City plus collision center demand; phrase protection excuses service token from mechanical-negative rule. |
| auto collision experts auto body shops in sunnyvale ca | collision-experts | KEEP | POL-GEO-LOCAL-KEEP | Geo plus auto body shops demand; protected collision experts phrase does not create competitor evidence. |

### Rule-citation distribution (primary rule per decision)

| Primary cited rule | Decisions | Share |
|---|---|---|
| POL-COMPETITOR-NEGATIVE | 562 | 28.6% |
| POL-BODYWORK-KEEP | 264 | 13.4% |
| POL-MECHANICAL-ONLY-NEGATIVE | 209 | 10.6% |
| POL-GEO-LOCAL-KEEP | 188 | 9.6% |
| POL-OEM-BODY-KEEP | 141 | 7.2% |
| POL-PAINT-COLOR-NEGATIVE | 118 | 6.0% |
| POL-PARTS-ONLY-NEGATIVE | 86 | 4.4% |
| POL-COSMETIC-ONLY-NEGATIVE | 84 | 4.3% |
| POL-COLLISION-KEEP | 78 | 4.0% |
| POL-NO-SERVICE-SIGNAL-NEGATIVE | 72 | 3.7% |
| POL-PRICE-SHOPPER-NEGATIVE | 45 | 2.3% |
| POL-FOREIGN-LANGUAGE-NEGATIVE | 36 | 1.8% |
| POL-OWN-BRAND-NEGATIVE | 23 | 1.2% |
| POL-INSURER-KEEP | 18 | 0.9% |
| POL-WRONG-VEHICLE-NEGATIVE | 7 | 0.4% |
| POL-REVIEWS-NEGATIVE | 5 | 0.3% |
| POL-SMALL-SPEED-NEGATIVE | 5 | 0.3% |
| POL-WEBSITE-NAV-NEGATIVE | 4 | 0.2% |
| POL-GLASS-TINT-NEGATIVE | 4 | 0.2% |
| POL-SALVAGE-JUNK-NEGATIVE | 4 | 0.2% |
| POL-BARE-VEHICLE-NEGATIVE | 3 | 0.2% |
| POL-INFORMATIONAL-NEGATIVE | 2 | 0.1% |
| POL-CUSTOM-FABRICATION-NEGATIVE | 2 | 0.1% |
| POL-INSPECTION-NEGATIVE | 2 | 0.1% |
| POL-HOURS-247-NEGATIVE | 2 | 0.1% |
| POL-AMBIGUOUS-KEEP | 1 | 0.1% |
| POL-DIY-HOWTO-NEGATIVE | 1 | 0.1% |
| POL-METAL-MATERIAL-NEGATIVE | 1 | 0.1% |

### Lowest-confidence decisions (< 0.70) — optional review

None.

### Analyst notes (manual review of the tables above)

1. **Single hard mismatch is a judgment call, not carelessness.** `auto body repair time estimates` was KEPT. The policy lists `estimate` under the price-shopper always-win tokens; the model read "time estimates" as duration research, not price shopping. If the owner wants duration-estimate queries negative, the lock needs explicit wording; otherwise this is a defensible interpretation.
2. **All indicative flags are justified overrides** the deterministic detector cannot see: `royal auto body repair` / `royal auto body & repair center` are own-brand suppressions (`POL-OWN-BRAND-NEGATIVE`, client-requested), and `honda dealer auto body repair` / `nico's auto repair & bodywork shop` are dealer/possessive-name competitor calls.
3. **Own-brand suppression is working.** 28 queries contained `royal`; zero were KEPT.
4. **Phrase protections behaved as designed** (4 exercised): `san leandro collision & service center` KEEP via geo with the `service` token excused, `american collision services` KEEP via crash-event signal, `auto collision experts auto body shops in sunnyvale ca` KEEP via geo with `experts` excused. Reasons explicitly cite the protection mechanics.

## Erland Auto Body & Repair (`5954806992`)

- Run: `runs/measure-erland-30day-kimi-20260909T085927172Z`
- Window: 2026-08-09 → 2026-09-07 | Model: kimi-k2.6 | Rules: 2026-09-09.1 / collision-classifier-v7
- Decisions: **2285** (797 KEEP, 1488 NEGATIVE_EXACT)
- Already excluded by existing negatives in Google Ads (targetingStatus EXCLUDED): 1413 of 2285
- Traffic on proposed negatives: 56 clicks, $519.84 spend, 4 conversions (30d)
- Confidence: p10 0.85, p50 0.95, p90 1.00 | below 0.70: 0

### Contract and exact-text integrity

All 2285 decisions satisfy the output contract: valid rule IDs, KEEP/NEGATIVE rule-citation rules, `negativeText` byte-identical to the full search term on every NEGATIVE_EXACT, null on KEEP, confidence within [0,1], reasons ≤ 240 chars.

### Explicit token-lock conformance

Checks below encode only patterns the policy names verbatim. **Hard** checks are always-win/always-KEEP token locks where a mismatch is a probable rule violation. **Indicative** checks flag mismatches for human review because competitor/leftover evidence the detector cannot see may justify them.

| Check | Rule | Expect | Matched | Conformant | Rate |
|---|---|---|---|---|---|
| Reviews / photos / ratings research | POL-REVIEWS-NEGATIVE | NEGATIVE_EXACT | 0 | 0 | — |
| 24/7 and 24-hour hours demand | POL-HOURS-247-NEGATIVE | NEGATIVE_EXACT | 4 | 4 | 100% |
| Quick / fast / minor / same-day / one-day small rush jobs | POL-SMALL-SPEED-NEGATIVE | NEGATIVE_EXACT | 11 | 11 | 100% |
| Mobile coming-to-you service (excl. Mobile AL geo) | POL-MOBILE-SERVICE-NEGATIVE | NEGATIVE_EXACT | 0 | 0 | — |
| Aluminum / steel / iron (always-win, even with body wording) | POL-METAL-MATERIAL-NEGATIVE | NEGATIVE_EXACT | 3 | 3 | 100% |
| Paint / color / repaint mention (always-win) | POL-PAINT-COLOR-NEGATIVE | NEGATIVE_EXACT | 92 | 92 | 100% |
| Salvage title / junk / rebuild-car demand | POL-SALVAGE-JUNK-NEGATIVE | NEGATIVE_EXACT | 6 | 6 | 100% |
| Inspection / inspector ask | POL-INSPECTION-NEGATIVE | NEGATIVE_EXACT | 2 | 2 | 100% |
| Towing / wrecker demand | POL-TOWING-NEGATIVE | NEGATIVE_EXACT | 2 | 2 | 100% |
| Trucks / RV / Sprinter / motorcycle / bike / scooter / ATV | POL-WRONG-VEHICLE-NEGATIVE | NEGATIVE_EXACT | 15 | 15 | 100% |
| Lucid vehicles (never OEM KEEP) | POL-WRONG-VEHICLE-NEGATIVE | NEGATIVE_EXACT | 1 | 1 | 100% |
| Fender-bender slang, dent/scratch ask, PDR, hole-fill | POL-COSMETIC-ONLY-NEGATIVE | NEGATIVE_EXACT | 49 | 49 | 100% |
| Informational question openers (not trailing ?) | POL-INFORMATIONAL-NEGATIVE | NEGATIVE_EXACT | 13 | 13 | 100% |
| Quote / price / cost / cheap / financing / how much | POL-PRICE-SHOPPER-NEGATIVE | NEGATIVE_EXACT | 4 | 4 | 100% |
| Website / domain / login navigation | POL-WEBSITE-NAV-NEGATIVE | NEGATIVE_EXACT | 1 | 1 | 100% |
| Custom body / fabrication shops | POL-CUSTOM-FABRICATION-NEGATIVE | NEGATIVE_EXACT | 0 | 0 | — |
| Contiguous auto/car repair, no body-shop or crash-event wording | POL-MECHANICAL-ONLY-NEGATIVE | NEGATIVE_EXACT | 147 | 147 | 100% |
| Mechanic / technician / standalone tech / service kill list | POL-MECHANICAL-ONLY-NEGATIVE | NEGATIVE_EXACT | 91 | 91 | 100% |
| Body-attached repair (auto body repair / body repair) with no always-win evidence *(indicative)* | POL-BODYWORK-KEEP | KEEP | 67 | 59 | 88% |
| best / top rated / highest rated / 5 star shop-finding with body/collision demand *(indicative)* | POL-BODYWORK-KEEP / POL-REVIEWS-NEGATIVE carve-out | KEEP | 23 | 23 | 100% |
| korean / german / italian / european / japanese + body-shop wording *(indicative)* | POL-BODYWORK-KEEP | KEEP | 5 | 5 | 100% |
| Origin adjective + collision without body-shop wording | POL-COMPETITOR-NEGATIVE | NEGATIVE_EXACT | 2 | 2 | 100% |
| Contiguous auto/car repair WITH body-shop wording present *(indicative)* | POL-BODYWORK-KEEP | KEEP | 8 | 4 | 50% |

### Hard-lock mismatches

None. Every always-win token-lock check conformed.

### Indicative mismatches (human review — may be justified by competitor evidence)

#### Body-attached repair (auto body repair / body repair) with no always-win evidence — 8 of 67 flagged

| Search term | Decision | Cited rules | Reason | Imp | Clk |
|---|---|---|---|---|---|
| proline collision auto body repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Distinctive leftover 'proline' after stripping service vocabulary indicates a named competitor. | 2 | 1 |
| hendrick auto body repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Leftover 'hendrick' is a recognized dealer/personal business name indicating a competing business. | 2 | 0 |
| big guy auto body repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Distinctive leftover "big guy" indicates a named competitor after stripping service vocabulary. | 2 | 0 |
| proline collision auto body repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Proline is a distinctive brand-like competitor leftover. | 5 | 0 |
| yoshi's auto body repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Possessive personal name 'yoshi's' indicates a named competitor. | 3 | 0 |
| vasken auto body & repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE, POL-FULL-QUERY-EXACT | Distinctive personal name 'vasken' remains after stripping body-shop and repair vocabulary. | 2 | 0 |
| abr auto body repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE, POL-FULL-QUERY-EXACT | Unclear leftover token "abr" after stripping body-shop vocabulary; defaults to competitor under the leftover-token test. | 1 | 0 |
| carlos auto body repair | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Personal name "carlos" remains as distinctive leftover after stripping service vocabulary. | 1 | 0 |

#### Contiguous auto/car repair WITH body-shop wording present — 4 of 8 flagged

| Search term | Decision | Cited rules | Reason | Imp | Clk |
|---|---|---|---|---|---|
| fred's auto repair and body shop | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Possessive personal name fred's is strong named-competitor evidence that overrides body-shop KEEP rules. | 2 | 0 |
| g & r auto repair & body | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE, POL-FULL-QUERY-EXACT | Distinctive personal-business name 'g & r' remains after stripping service vocabulary, indicating a named competitor. | 1 | 0 |
| rkc auto repair & body shop | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Distinctive initialism 'rkc' remains after stripping service vocabulary, indicating competitor. | 2 | 0 |
| a & g auto repair & body shop | NEGATIVE_EXACT | POL-COMPETITOR-NEGATIVE | Distinctive business initials 'a & g' remain after stripping service vocabulary, indicating a named competitor. | 3 | 0 |

### Own-brand suppression (`POL-OWN-BRAND-NEGATIVE`)

Queries containing the organization's distinctive name (`erland`): **0**. KEPT (hard violation): **0**. Negative without citing own-brand (soft note): **0**.

### Phrase-protection exercise (release 2026-09-09.3 feature)

1 query matched a configured protection. The excused evidence applies only to the specified rule; remaining independent exclusions must still hold.

| Search term | Protection(s) | Decision | Cited rules | Reason |
|---|---|---|---|---|
| proud auto collision service | collision-service | KEEP | POL-COLLISION-KEEP | Protected collision service phrase with crash-event wording and no always-win negatives. |

### Rule-citation distribution (primary rule per decision)

| Primary cited rule | Decisions | Share |
|---|---|---|
| POL-COMPETITOR-NEGATIVE | 707 | 30.9% |
| POL-MECHANICAL-ONLY-NEGATIVE | 300 | 13.1% |
| POL-GEO-LOCAL-KEEP | 266 | 11.6% |
| POL-BODYWORK-KEEP | 265 | 11.6% |
| POL-OEM-BODY-KEEP | 127 | 5.6% |
| POL-NO-SERVICE-SIGNAL-NEGATIVE | 121 | 5.3% |
| POL-COLLISION-KEEP | 120 | 5.3% |
| POL-PAINT-COLOR-NEGATIVE | 92 | 4.0% |
| POL-FOREIGN-LANGUAGE-NEGATIVE | 71 | 3.1% |
| POL-PARTS-ONLY-NEGATIVE | 53 | 2.3% |
| POL-COSMETIC-ONLY-NEGATIVE | 52 | 2.3% |
| POL-BARE-VEHICLE-NEGATIVE | 16 | 0.7% |
| POL-WRONG-VEHICLE-NEGATIVE | 14 | 0.6% |
| POL-INSURER-KEEP | 13 | 0.6% |
| POL-INFORMATIONAL-NEGATIVE | 11 | 0.5% |
| POL-PRICE-SHOPPER-NEGATIVE | 9 | 0.4% |
| POL-CUSTOM-FABRICATION-NEGATIVE | 8 | 0.4% |
| POL-SMALL-SPEED-NEGATIVE | 8 | 0.4% |
| POL-AMBIGUOUS-KEEP | 6 | 0.3% |
| POL-GLASS-TINT-NEGATIVE | 6 | 0.3% |
| POL-SALVAGE-JUNK-NEGATIVE | 5 | 0.2% |
| POL-HOURS-247-NEGATIVE | 5 | 0.2% |
| POL-TOWING-NEGATIVE | 3 | 0.1% |
| POL-INSPECTION-NEGATIVE | 2 | 0.1% |
| POL-DIY-HOWTO-NEGATIVE | 2 | 0.1% |
| POL-METAL-MATERIAL-NEGATIVE | 2 | 0.1% |
| POL-WEBSITE-NAV-NEGATIVE | 1 | 0.0% |

### Lowest-confidence decisions (< 0.70) — optional review

None.

### Analyst notes (manual review of the tables above)

1. **One probable miss worth owner review: `proud auto collision service` → KEEP (confidence 0.85).** The `collision service` protection excuses only the `service` token under `POL-MECHANICAL-ONLY-NEGATIVE`; it does not excuse competitor evidence. After stripping service vocabulary, the brand-like adjective `proud` remains — the same leftover class as `premier`, which this same run correctly negatives eight times (`premier body shop`, `premier collision center northridge`, etc.). Under decision-order step 4 ("unclear place/descriptor/business → negative"), this query should likely be `POL-COMPETITOR-NEGATIVE`. This is a leftover-test inconsistency in one decision, not a flaw in the phrase-protection design.
2. **All indicative flags are justified competitor overrides**: possessive/initialism business names (`fred's`, `g & r`, `rkc`, `a & g`, `yoshi's`, `vasken`, `carlos`, `proline`, `hendrick`, `big guy`, `abr`) correctly negative under the leftover-token test while keeping the body-repair demand intact elsewhere.
3. **Own-brand**: no queries containing `erland` appeared in this window, so the suppression path was not exercised here.
4. **Phrase protection**: the single exercised case (`proud auto collision service`) is the miss described in note 1 — the protection itself was applied correctly (it excused `service`); the questionable part is the untested `proud` leftover.

## Limitations

- The competitor leftover-token test, geo disambiguation, insurer recognition, and general intent judgment cannot be encoded deterministically; those decisions are covered only by the indicative listings and the low-confidence table, not by hard pass/fail.
- Detectors replay the policy's named token lists on the production normalization (NFKC, case, punctuation). Model judgments that hinge on context beyond the named tokens are intentionally out of scope for hard checks.
- Conformance here measures agreement with the written locks, not business outcomes; a conformant run can still contain individually debatable decisions.
