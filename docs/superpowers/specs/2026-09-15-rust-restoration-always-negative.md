# Rust & restoration → always-win negative (rule release 2026-09-15.1)

- **Date:** 2026-09-15
- **Owner directive (2026-09-15, this session):** "any mention of rust or restoration is an immediate negative"
- **Prior owner lock:** A10 (2026-08-28, ACCEPTED) — `POL-WRONG-VEHICLE-NEGATIVE` "add rust / older-vehicle intent"; owner labels `carrustrepair`, `rusted car frame repair` = DISQUALIFIED, "rust repairs not catered"

## Intent

Any search term mentioning rust or restoration demand is immediately proposed as
`NEGATIVE_EXACT`, regardless of collision, body-shop, OEM, insurer, or geo wording.

## Problem

The active ruleset `2026-09-10.4` has **no general rust rule** (only the literal
phrases `rust hole` / `rust holes` inside `POL-COSMETIC-ONLY-NEGATIVE`) and only a
narrow restoration clause (classic/antique restoration with no collision/body
service, `POL-WRONG-VEHICLE-NEGATIVE`). The A10 owner lock was never merged into
the Markdown policy. Live terms `car restorations`, `car restorations near me`,
`carrestoration` (Akins 8402372674, Anderson 2305040084, 30-day window ending
2026-09-15) had `targetingStatus: NONE` and no rule that clearly fires.

## Goal

One-section policy edit, release-budget compliant (≤1 rule section, ≤40 changed
policy lines), that makes rust and restoration always-win negatives under
`POL-WRONG-VEHICLE-NEGATIVE`, with a new rule version `2026-09-15.1` and updated
release manifest hashes.

## Benchmark

- Deterministic: `scripts/audit-rule-conformance.ts` gains a rust/restoration
  always-win detector so conformance of the new clause is auditable without an
  LLM. Replaying the audit over the blocked 2026-09-15 runs is expected to show
  documented mismatches on the affected terms (decisions there are MISSING under
  `2026-09-10.4`) — that is evidence of the rule change, not a regression.
- The 8 last-run rust/restoration terms are re-adjudicated by the deterministic
  detector (LLM re-classification waits on Kimi quota — owner billing action).
- `npm run check`, `npm test`, `npm run rules:check -- <base-commit>` all pass.

## Critique resolutions (2026-09-15 review, see reviews/2026-09-15-…-review.md)

1. **MAJOR — stale `classic` carve-out:** the new clause explicitly states the
   `POL-COMPETITOR-NEGATIVE` classic-car-restoration carve-out does not apply to
   restoration-token queries (handled inside the edited section, budget-safe).
2. **MAJOR — tokenization:** closed token list + enumerated closed-up compounds
   named verbatim in the policy. No substring scanning (`trust`/`crust`/
   `entrust`/`thruster` blocklisted). `rustproof`/`rustproofing` are IN scope
   (same owner intent). `headlight restoration` / `wheel restoration` flip to
   NEGATIVE_EXACT — intended per the directive, recorded as a consequence.
3. `restore` / `restored` / `restoring` are IN scope (same disqualifier;
   consequences stated, owner can trim in a follow-up release).
4. `test/rule-release.test.ts` version literal updated (derive or bump).
5. New audit detector is APPENDED to `alwaysWinDetectors` (positional indexes
   `[5]`–`[12]` must not shift).
6. `RULE_RELEASES.md` entry records: preamble-parenthetical deferral, part-
   restoration consequence, and the unchanged redundant `rust hole` clause.

## Proposed changes

1. **`src/config/negative-keyword-rules.md`** — edit ONLY the
   `POL-WRONG-VEHICLE-NEGATIVE` section: replace the closing paragraph
   (lines 863–867) with an always-win rust + restoration clause:
   - Rust tokens (standalone): `rust`, `rusted`, `rusty`, `rusting`,
     `rustproof`, `rustproofing`; plus enumerated closed-up forms
     `carrustrepair`, `rustrepair`. Do NOT fire on those letters inside
     unrelated words (`trust`, `crust`, `entrust`, `thruster`).
   - Restoration tokens (standalone): `restoration`, `restorations`, `restore`,
     `restored`, `restoring`; plus enumerated closed-up forms `carrestoration`,
     `carrestorations`. Includes part restoration (`headlight restoration`,
     `wheel restoration`) — not collision demand.
   - Keep the `POL-SALVAGE-JUNK-NEGATIVE` (`restomod`, salvage, rebuild)
     precedence note; state the `POL-COMPETITOR-NEGATIVE` classic carve-out
     does not apply to restoration-token queries; keep the `classic collisions`
     brand pattern routing to `POL-COMPETITOR-NEGATIVE` when no restoration
     token is present.
   - New clause must keep the whole release ≤40 changed policy lines
     (5 deleted + version line + ~20–25 new lines).
   - Bump `Rule set version:` to `2026-09-15.1`. Prompt version unchanged
     (`collision-classifier-v7` — prompt scaffold untouched).
2. **`src/config/rule-release.json`** — `releasedVersion`/`releaseId` →
   `2026-09-15.1`, `rulesSha256` → hash of new policy bytes. `protectionsSha256`,
   stable baseline fields unchanged.
3. **`docs/RULE_RELEASES.md`** — add candidate-release entry for `2026-09-15.1`
   recording the deferrals/consequences from critique resolution 6.
4. **`scripts/audit-rule-conformance.ts`** — APPEND one rust/restoration
   always-win detector at the END of `alwaysWinDetectors` (token list +
   enumerated compounds, mirroring the policy verbatim) and register a hard
   `negative(...)` check citing `POL-WRONG-VEHICLE-NEGATIVE`. Code, not policy;
   appending keeps KEEP-checks' `anyAlwaysWinDetectorFires` guards correct.
5. **`test/rule-release.test.ts`** — update the hard-coded `2026-09-10.4`
   literal so the version-bump path stays exercised.

## Out of scope

- Preamble / decision-order edits (`POL-WRONG-VEHICLE-NEGATIVE` is already listed
  among always-win negatives; the parenthetical example list is non-exhaustive —
  no contradiction, follow-up release may refresh it).
- Removing the now-redundant `rust hole` / `rust holes` clause from
  `POL-COSMETIC-ONLY-NEGATIVE` (would be a second section — violates the
  one-section release budget; behavior identical since both rules are negative).
- Phrase protections (unchanged).
- Re-running the sweep: blocked on Kimi API quota (HTTP 429, account suspended) —
  owner billing action required before any live evidence.

## Consequences (to verify post-implementation)

| Term (last run) | Old rule coverage | New decision |
|---|---|---|
| `car restorations` (Akins, live) | none clear | NEGATIVE_EXACT / POL-WRONG-VEHICLE-NEGATIVE |
| `car restorations near me` (both, live) | none clear | NEGATIVE_EXACT / POL-WRONG-VEHICLE-NEGATIVE |
| `carrestoration` (Anderson, live) | none (closed-up) | NEGATIVE_EXACT / POL-WRONG-VEHICLE-NEGATIVE |
| `repair rusted quarter panel` | none (only `rust hole`) | NEGATIVE_EXACT / POL-WRONG-VEHICLE-NEGATIVE |
| `rust hole repair on car`, `repair small rust hole in car` | POL-COSMETIC-ONLY-NEGATIVE | still negative (either rule) |
| `how do you repair rust on a car` | POL-INFORMATIONAL/DIY | still negative (either rule) |
| `headlight restoration`, `wheel restoration` (future) | cosmetic KEEP path | NEGATIVE_EXACT — intended per directive |
| `rustproofing a car` (future) | none | NEGATIVE_EXACT — in scope |
| `trust auto body`, `crust` hypotheticals | — | NOT fired (explicit blocklist) |

## Resolved questions

1. `restore` / `restored` / `restoring` are IN scope per critique resolution 3.
2. The legacy per-shop carve-out ("disable if shop does rust") is dropped per
   the new unconditional directive; no configured account offers rust or
   restoration work (owner: "rust repairs not catered", 2026-08-28).

## Rollback

Revert the release commit; previous released bundle `2026-09-10.4`
(rulesSha256 `9b25199b…`) is untouched in git history. Application is read-only;
no imported negatives can be removed by rollback.
