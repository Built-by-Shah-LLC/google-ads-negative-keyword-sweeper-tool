# Review: rust-restoration-always-negative spec (2026-09-15.1)

**Spec reviewed:** `docs/superpowers/specs/2026-09-15-rust-restoration-always-negative.md`
**Against:** `src/config/negative-keyword-rules.md` (885 lines), `src/config/rule-release.json`,
`src/config/rule-set.ts`, `scripts/check-rule-release.ts`, `scripts/audit-rule-conformance.ts`,
`docs/RULE_RELEASES.md`, `test/rule-release.test.ts`.

**Verdict:** Plan is directionally sound and release-budget compliant, but has **2 major
findings** (one stale cross-reference that becomes actively contradictory inside the same
prompt, and an underspecified closed-up-compound tokenization strategy) plus several minor
items. Resolve the majors before implementation.

---

## 1. Rule-text consistency after the edit

### MAJOR — `classic`-carve-out in `POL-COMPETITOR-NEGATIVE` becomes dead, misleading text

`POL-COMPETITOR-NEGATIVE` lines 779–781 (verified at 779–781):

> `classic` plus collision or body-shop wording is a shop name, not classic-car
> restoration, **unless restoration, antique, or vintage-vehicle words are present**.

After the edit, `restoration` is an always-win token under `POL-WRONG-VEHICLE-NEGATIVE`,
and decision-order step 2 (lines 57–73) applies always-win negatives **before**
`POL-COMPETITOR-NEGATIVE`. So for `classic collision restoration`, the new clause fires
first and the competitor carve-out ("unless restoration … words are present") is
**unreachable** — dead text that points the model at a KEEP path that no longer exists.
This is worse than stale: it is contradictory guidance inside the same prompt, of exactly
the kind that degrades LLM rule compliance.

The spec's "Out of scope" keeps the carve-out text and asserts "no contradiction." That
is wrong in the decision-order sense. Fix without violating the one-section budget: add
one sentence **inside the new `POL-WRONG-VEHICLE-NEGATIVE` clause** (the only section
being edited), e.g. "the `classic`-car-restoration carve-out in `POL-COMPETITOR-NEGATIVE`
does not apply to restoration-token queries." Costs ~1 line of the 40-line budget.

Related, lower severity: `POL-SALVAGE-JUNK-NEGATIVE` lines 543–544 ("Classic/antique
restoration without salvage or rebuild-car wording stays `POL-WRONG-VEHICLE-NEGATIVE`")
remains literally true (same rule ID) and is not contradictory — but its framing assumed
restoration alone was not an always-win trigger. No edit needed (it's a second section);
consider one clarifying sentence in the `RULE_RELEASES.md` entry instead.

### MINOR — Decision-order preamble parenthetical goes stale (known pattern)

Lines 71–72 list `POL-WRONG-VEHICLE-NEGATIVE` as "(trucks, semis, RV, Sprinter,
motorcycle, bike, scooter, ATV, Lucid)" — no rust/restoration mention. The spec defers
this, which is the same drift that forced follow-up release `2026-09-10.4` for
`POL-CAREERS-NEGATIVE` (see `RULE_RELEASES.md` lines 37–47). Acceptable, but the
`RULE_RELEASES.md` entry for `2026-09-15.1` should explicitly record "preamble
parenthetical not yet updated" so the next release refreshes it.

### MINOR — Redundant `rust hole` / `rust holes` overlap is fine, but note detector overlap

Spec correctly defers removing the `rust hole` / `rust holes` clause from
`POL-COSMETIC-ONLY-NEGATIVE` (lines 720–724) on budget grounds. Confirmed harmless:
both rules are `-NEGATIVE`, the output contract (lines 45–48) permits citing multiple
`-NEGATIVE` rules, and decision outcome is identical. In the audit script, the existing
`rust hole` sequence check (detector index 9, line 137) and the new detector will both
fire on `rust hole …` terms — overlapping hard checks are fine, just don't "clean up"
detector 9 in this release.

### Verified OK

- Spec's line citations are accurate: replacement target is exactly lines 863–867;
  `POL-SALVAGE-JUNK-NEGATIVE` 522–548; `POL-COSMETIC-ONLY-NEGATIVE` 696–725;
  `POL-COMPETITOR-NEGATIVE` 752–822.
- Rollback claim verified: current manifest `rulesSha256` is
  `9b25199bf1a16b36044dab662d7a136a24cbd26f0614f2430b417b28cfe42d13` — matches the
  spec's `9b25199b…` prefix. `protectionsSha256` unchanged is consistent with no
  phrase-protection edits.

---

## 2. Release budget compliance

Verified against `scripts/check-rule-release.ts`:

- **Section count:** the section diff (line 28–30) splits on `^### \`` and strips the
  `Rule set version:` line before comparing. Keeping all new text inside the
  `POL-WRONG-VEHICLE-NEGATIVE` block = **one changed section**. Compliant. Do not touch
  `POL-COMPETITOR-NEGATIVE` to fix finding 1 — edit only the new clause's own wording.
- **Line budget:** `git diff --numstat` counts **added + deleted** lines, and per
  `RULE_RELEASES.md` line 59 version metadata is *included in the line budget* (the
  version line is only excluded from the *section* count). So: 5 deleted (863–867) +
  version-line change (+2) + new clause. The clause must fit in ~33 lines including the
  recommended cross-reference sentence from finding 1. The spec's token lists
  (4 rust + 5 restoration tokens + compound + blocklist + precedence note + examples)
  will run close to but under the limit — keep examples terse (2–3 lines).
- **Version/releaseId:** spec sets both `releasedVersion` and `releaseId` to
  `2026-09-15.1`. Equal values are consistent with the `2026-09-10.x` releases
  (only `2026-09-09.2` separated them). `rule-set.ts` requires
  `rules.version === release.releasedVersion` (line 21) — spec satisfies this.
- **Prompt version unchanged:** the policy markdown is embedded in the prompt (line 11:
  "This is the authoritative policy sent to the LLM"), so prompt *content* changes while
  `collision-classifier-v7` stays fixed. Precedent exists (`2026-09-10.1`–`.3`), and
  `prompt.test.ts` uses a synthetic `2026-08-31.2` ruleset, so no test breakage — but
  note the released prompt bytes change under an unchanged prompt version.

---

## 3. Tokenization edge cases

### MAJOR — Closed-up compound detection is underspecified and `rust` substring scanning is a trap

Production normalization (`normalizeTerm`, used by `tokensOf` in the audit script) is
NFKC + lowercase + punctuation/whitespace collapse; `carrustrepair` normalizes to the
**single token** `carrustrepair`. Exact-token matching (`hasToken`) will not fire on it.

Two implementation strategies, and the spec doesn't choose:

1. **Substring scan** (`token.includes("rust")`): false-positives beyond the spec's
   `trust` / `crust` examples. Confirmed collisions in English: `crusted`, `crusty`,
   `entrust`, `distrust`, `trusted`, `trusting`, `thruster`, `antitrust`, `rustproof`,
   `rustproofing` (last two arguably *should* fire — the spec is silent on rustproofing).
   A "blocklist of unrelated words" is open-ended and cannot be made deterministic-safe.
2. **Closed token list + enumerated compounds** (the existing convention in
   `alwaysWinDetectors`: `24hour`, `fenderbender`, `restomod` are listed explicitly):
   fire on `{rust, rusted, rusty, rusting}` and `{restoration, restorations, restore,
   restored, restoring}` as standalone tokens, plus an explicit compound list
   (`carrustrepair`, `carrestoration`, and whatever other closed-up forms the run data
   actually shows). Deterministic, auditable, matches "encode only patterns the policy
   names verbatim" (script header, lines 109–111).

**Recommendation:** strategy 2, and the policy clause should say "standalone tokens and
the closed-up forms `carrustrepair` / `carrestoration`" verbatim so the detector and the
policy text stay in lockstep. Note `restoration` family is much safer as a substring
(`restaurant`, `forest`, `interest` don't collide), but use the same explicit mechanism
for consistency. Also decide and record: `rustproof`/`rustproofing` (recommend: in
scope, same owner intent), and `headlight restoration` / `wheel restoration` — these
are real cosmetic-service queries that will flip to NEGATIVE_EXACT under an
unconditional `restoration` rule; that follows the owner directive but is worth one
line in the spec's Consequences table.

### MINOR — `restore` word-family scope (spec open question 1)

Spec includes `restore` / `restored` / `restoring`. Domain check: `restore headlights`,
`restore leather seats`, `restore faded paint` (paint rule already fires) — plausible
search phrasings that will now negative. The owner directive says "any mention of
restoration," and restoration-of-parts is arguably the same disqualifier (not collision
demand), but the spec should state this consequence explicitly rather than leave it in
open questions at implementation time.

---

## 4. Tests / integrity checks

### MINOR — `test/rule-release.test.ts` hard-codes the current version string

Line 32:

```ts
originalRules.replace("2026-09-10.4", "2026-09-10.5")…
```

After the bump to `2026-09-15.1`, this replace becomes a **no-op**. The test still
passes *incidentally* (the two phrase edits change two sections, so the
"maximum one rule section" throw fires first, before the "new rule version" check at
`check-rule-release.ts` line 34), but the version-bump path silently stops being
exercised. Update the test to derive the version from the file (same regex used at line
26) or bump the literal. Tests are outside the policy line budget, so this is allowed
in the same release.

### MINOR — Audit replay against pre-release decisions needs a stated expectation

The new hard check replays against `decisions.json` recorded under `2026-09-10.4`. Any
rust/restoration term previously decided `KEEP` (or NEGATIVE under a different rule)
will now surface as a hard-lock mismatch. The spec's Benchmark (line 33) says "all 8
rust/restoration terms → NEGATIVE_EXACT" while simultaneously stating the re-run is
blocked on Kimi API quota (line 70) — these conflict. Clarify: the audit over the last
run is expected to show exactly N documented mismatches on the 8 terms (not a
regression), and full conformance evidence waits for the unblocked re-run. Without this,
a future reader will see a sub-100% hard-lock rate and misread it as rule violation.

### Verified OK

- `rule-set.ts` integrity gate (lines 19–23): version + both hashes must match the
  manifest; spec's change items 1–2 cover all three.
- `check-rule-release.ts` version-staleness gate (line 34): spec bumps the version, so
  no "Policy changes require a new rule version" failure.
- Phrase-protection budget: untouched; `protectionsSha256` unchanged — consistent.
- `npm run check` / `npm test`: no fixture or snapshot found embedding `2026-09-10.4`
  except `rule-release.test.ts` above; `rule-set.test.ts` uses a regex
  (`/^\d{4}-\d{2}-\d{2}\./`) and synthetic versions; `prompt.test.ts` uses a synthetic
  `2026-08-31.2` ruleset. No other expected breakage.

### Positional-index hazard in the audit script (instruction for implementation)

`buildChecks()` references `alwaysWinDetectors` by **numeric index** (`[5]!` … `[12]!`,
lines 225–245). The new rust/restoration detector **must be appended at the end** of the
array. Inserting it earlier silently shifts every subsequent index — no compile error,
no runtime throw (non-null assertions), just misattributed KEEP guards and wrong check
detectors. The spec should state "append" explicitly.

---

## Summary of required actions before implementation

| # | Severity | Action |
|---|---|---|
| 1 | Major | Neutralize the `classic`-carve-out contradiction from within the new clause (1 line, same section) |
| 2 | Major | Specify closed-token + enumerated-compound detection; name compounds verbatim in policy; decide `rustproofing` |
| 3 | Minor | Fix the blocked-re-run vs. re-adjudicated-8-terms benchmark contradiction |
| 4 | Minor | Update `test/rule-release.test.ts` version literal |
| 5 | Minor | Append (never insert) the new detector; keep under ~33 new lines for budget |
| 6 | Minor | Record preamble-parenthetical deferral and `headlight/wheel restoration` consequence in `RULE_RELEASES.md` entry |

*Reviewer note: no code was implemented, per instructions.*
