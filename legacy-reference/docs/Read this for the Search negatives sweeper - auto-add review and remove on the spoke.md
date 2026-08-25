# Read this for the Search negatives sweeper — auto-add, review, and remove on the spoke

This guide is for the **Built by Shah MCC Search Negatives Sweeper**. It is a **sibling** of the Engine. It is **not** inside `built-by-shah-mcc-engine.js`.

There is a matching **PMax** sweeper (`built-by-shah-mcc-pmax-negatives-sweeper.js`) that uses the same Hub overrides and the same spoke **Negatives Audit** tab.

---

## Where do I edit what?

| I want to… | Go here | Do not |
|---|---|---|
| Turn Engine monitoring off for a shop (also stops negatives) | Hub Config → **Enabled** = Disabled | Remember: both flags are required for the sweep |
| Turn auto-negatives off but keep Engine metrics | Hub → **Negatives Sweeper Enabled** = Disabled (leave **Enabled** on) | — |
| Turn negatives sweeper on for one shop | Hub → **Enabled** = Enabled **and** **Negatives Sweeper Enabled** = Enabled + Spoke URL | One flag alone is not enough |
| Turn off a rule for one shop (example: they sell glass) | Hub → **Negatives Disabled Rule IDs** | Do not edit the script; not on the spoke |
| Protect a brand or specialty phrase | Hub → **Negatives Protected Phrases** | — |
| Block local competitor names | Hub → **Negatives Competitor Phrases** | — |
| See what was added + spend context | That shop’s spoke → **Negatives Audit** | No third MCC audit workbook |
| Confirm a negative is OK | Spoke → check **Reviewed** | — |
| Undo a bad auto-negative | Spoke → check **Remove** (next sweeper run deletes it in Ads) | Do not only delete in Ads and leave the spoke row as ADDED |
| Change budgets / CPL / lead goals | Hub goals columns | Never long-term on spoke green cells |
| New agency-wide junk trigger for all shops | Ask for a **script update** | Do not invent a spoke rules tab |

**Client Name** and **Account Name** on the Hub are protected automatically. You do not need to re-type the shop brand into Protected Phrases.

Major national / regional **auto insurer names** (State Farm, GEICO, Progressive, Allstate, USAA, Farmers Insurance, Liberty Mutual, Travelers, Nationwide, American Family, Auto-Owners, Erie Insurance, Mercury Insurance, The Hartford, Amica, Safeco, Chubb, MetLife, and close variants) are also protected automatically in the script seed list. AAA is context-aware: `AAA insurance`, claim, approved-body, and collision intent stays protected, while mechanical junk such as `aaa auto repair` can still match the repair rules. Add any extra carriers on Hub → **Negatives Protected Phrases**.

---

## What the sweeper does (plain English)

1. Reads the Hub for shops where **Enabled** and **Negatives Sweeper Enabled** are both on, and Spoke URL is filled.
2. Each run processes up to **50** of those shops still due today (`Negatives Last Successful Run` blank or not today).
3. For each shop, looks at the **last seven completed days** of Search terms (account time zone) that had impressions. The window ends yesterday and overlaps safely so Google terms published late get retried.
4. Matches them against the shared rule list (dent, glass, **cheap**, competitors, and so on).
5. Skips anything that converted in the seven-day action window or the ~30-day lookback, anything Google already marked added/excluded, or anything already covered by an existing campaign or shared-list negative.
6. Adds the **full search term** as an **exact-match campaign negative** `[like this]`.
7. Writes a row on that shop’s spoke **Negatives Audit** tab (with spend yesterday + lookback).
8. At the start of each shop run, processes **Remove** checkboxes: deletes that exact negative from the campaign and marks the row **REMOVED**.

There is **no DRY_RUN / LIVE switch** in the script. If the Hub columns say the shop is on, adds are real. Google’s **Preview** button still never changes Ads if you click Preview once while testing.

---

## Official rule IDs (for Negatives Disabled Rule IDs)

Type these exactly (comma-separated) on the Hub when a shop should skip a rule.

| Rule ID | Triggers (summary) | Typical when to disable |
|---|---|---|
| `DENT_MINOR` | dent, dented | Shop wants minor dent traffic |
| `BUMPER_MINOR` | bumper | Bumper-only jobs |
| `PAINT_MINOR` | paint, repaint, clear coat, coloring, refinish, … | Paint / refinish leads |
| `PAINTLESS_DENT` | paintless, dent specialist, pdr | Shop offers PDR |
| `SMALL_JOB` | small | — |
| `SCRATCH_OR_KEYED` | scratch, keyed | — |
| `EXTERIOR_PANEL_MINOR` | hood, roof, door, mirror, plastic | — |
| `AUTO_GLASS` | glass, window, safelite, windshield, crack | Shop does glass |
| `TINT` | tint, tinting | Shop does tint |
| `DING_MINOR` | ding, dings | — |
| `DETAILING` | detailing, buffing, polishing, … | Shop does detailing |
| `PARTS_OR_INSTALLATION` | install, parts, kit, upholstery, interior, dashboard / dash repair, … | Shop does interior / kits |
| `WHEELS_OR_EXHAUST` | curb, rim, rims, exhaust, dr rim | — |
| `COUPON` | coupon | — |
| `RUST` | rust | Shop does rust repair |
| `FRAME_NON_COLLISION` | frame (with collision-related exceptions) | — |
| `CAR_KEY` | car key, lost key, key fob, spare key | — |
| `MOBILE_SERVICE` | mobile app, mobile repair, mobile dent, mobile mechanic | Shop is mobile |
| `LOW_VALUE_COMPETITOR` | maaco, pep boys, dent doctor, earl scheib/shibe, earl, fix auto, a1, f1, … | Rare |
| `CHEAP` | cheap, cheapest, cheaply, affordable | Almost never disable |
| `LOCAL_COMPETITOR` | Hub competitor phrases + seed chains | Rare |
| `NAMED_LOCAL_SHOP` | Conservative high-confidence named-shop evaluator | Rare |
| `BARE_MAKE_MODEL` | Make/model-only query with no repair intent | Rare |
| `LOW_INTENT_AUTO_GEO` | Narrow vehicle + named-place query such as `car in dallas` | Rare |
| `DEALER_OR_AUTO_GROUP` | Dealer, service, and auto-group intent | Shop wants dealer traffic |
| `GENERIC_CAR_REPAIR` | car/auto repair, fix car(s), mechanic, service — protected if body/collision/insurance language | Shop wants general repair leads |
| `CAREERS_OR_HIRING` | technician jobs, hiring, career, salary, internship, … | Shop is recruiting through Ads |
| `PAYMENT_OR_FINANCING` | payment plan, pay later, financing, loan, affirm, … | — |
| `ESTIMATE_OR_QUOTE` | estimate, quote, free estimate, free quote, … | Shop wants estimate shoppers |
| `APPRAISAL_OR_ADJUSTER` | appraisal, appraiser, adjuster | — |
| `CLASSIC_OR_OLD_CAR` | classic car, old car, antique, vintage | Shop does classics |
| `MECHANICAL_REPAIR` | oil change, brakes, radiator, AC, transmission, … | — |
| `SALVAGE_OR_JUNKYARD` | salvage, pick n pull, pick a part, junkyard, … | — |
| `SAME_DAY_OR_ONE_DAY` | same day, 1 day, one day | Shop does same-day work |
| `SPRINTER_VAN` | sprinter | Shop works on Sprinters |
| `SPANISH_LANGUAGE` | reparar, enderezado, hojalateria, latoneria, … | Spanish-market shops |
| `PUT_A_CLAIM_SCAMMY` | put a claim (not bare “claim”) | — |
| `RENOVATION` | renovation, renovate | — |
| `BROKEN_PART` | broken tail light / mirror / headlight phrases; replacements | — |
| `AFTERMARKET_AERO` | carbon fiber, splitter | — |
| `REBUILD_OR_TRUCK_BODY` | rebuild, restomod, truck body | — |
| `RV_OR_MOTORHOME` | RV, motorhome | Shop serves RVs |
| `TOWING` | tow, towing, tow truck | Shop offers towing |
| `CUSTOM_BODY_OR_PAINT` | custom body, custom paint, custom shop | Shop wants custom work |
| `GARAGE_DIY_BODY` | garage body work, DIY, home garage | — |
| `YEAR_TOKEN` | every year 1990–2026 | Very aggressive — disable if model-year queries are valuable |

Example Hub cell: `AUTO_GLASS, PAINTLESS_DENT`

### What this script cannot auto-detect

- It uses a conservative city-vs-shop heuristic. Pure geo intent such as `dallas auto body shop` stays eligible, while possessive and multi-word named businesses can match. Put known local competitors in Hub **Negatives Competitor Phrases** for deterministic handling.
- It does **not** fuzzy-match every misspelling beyond listed variants (for example earl scheib / earl shibe).

### Aggressive tokens (false-positive risk)

These can block real customers; AMs undo via spoke **Remove**:

- Bare `earl`, `a1`, `f1`
- Any model year token **1990–2026** (example: `2022 camry rear end collision` can match `YEAR_TOKEN`)
- `free estimate` / `free quote`

Smoke examples that should block: `car repair near me`, `collision repair payment plan`, `free estimate body shop`, `earl scheib`, `taller de enderezado y pintura cerca de mi`, `2009 honda accord`, `oil change near me`, `pick n pull`, `same day dent repair`, `sprinter van body`, `a1 body shop`, `fix now pay later`.

Examples that should still survive common exceptions: `honda accord collision insurance claim`, `accident bumper repair` (existing minor-damage exceptions), a city-only query with no junk triggers.

---

## Install (Search sweeper)

1. Upgrade or rebuild the Hub so Config has the Negatives columns (see Hub generator `create-hub-workbook.gs`).
2. Add the **Negatives Audit** tab on each spoke (new spokes get it from `create-body-shop-workbook.gs`; live spokes can run `apps-script/add-negatives-audit-tab.gs`).
3. In Google Ads MCC → Scripts, create a script and paste `scripts/built-by-shah-mcc-search-negatives-sweeper.js`.
4. Set `CONFIG.HUB_SPREADSHEET_URL` to your Hub URL.
5. On each shop row: set **Negatives Sweeper Enabled** = Enabled only when you want that shop swept (and keep **Enabled** = Enabled).
6. Schedule **Daily at 7:00 AM Pacific or later**. Google says prior-day Search terms are normally ready around 6:00 AM in each account’s local time. With about **70** shops, add a **second** Scripts row with the **identical** code and the **same** Hub URL (for example 7:00 and 8:00 AM Pacific). Google only allows **50 accounts per run**.
7. Do **not** fold this into the Engine script or the Engine schedule row.

PMax: paste `scripts/built-by-shah-mcc-pmax-negatives-sweeper.js` the same way (its own schedule rows). Same Hub **Negatives Sweeper Enabled** flag and spoke tab; rows show `Channel = PMAX`. PMax stamps **Negatives PMax Last Successful Run** (separate from Search) so both scripts can finish the same day.

---

## Account manager daily loop

1. Open the spoke → **Daily Checklist** → **Negatives audit**.
2. Open **Negatives Audit**. Newest rows are under the header.
3. Check **Reviewed** when you are satisfied.
4. Check **Remove** if the negative was a mistake. The next sweeper run deletes it in Google Ads.
5. Shop-specific rule tweaks stay on the **Hub**, not on this tab.

---

## Safety notes

- Exact match of the **full query** only — never auto broad/phrase of a bare trigger word like `paint` as the negative itself (the trigger only selects which full query to exact-negative).
- Process **all** eligible matching terms each run (sorted by spend). A high runaway safety ceiling exists only so a broken rule cannot melt the clock; if it trips, that shop is not stamped done and is retried next wave.
- Shared negative lists are **read** for coverage checks but never written by this sweeper.
- The named-shop heuristic intentionally stays conservative so city-only body-shop intent is spared. Add important known local shops on the Hub (**Negatives Competitor Phrases**) instead of loosening that heuristic.

---

## Related guides

- [Start here - what does each of these guides do.md](./Start%20here%20-%20what%20does%20each%20of%20these%20guides%20do.md)
- [Open this when you are ready to go live - install checklist gotchas and how to smoke test.md](./Open%20this%20when%20you%20are%20ready%20to%20go%20live%20-%20install%20checklist%20gotchas%20and%20how%20to%20smoke%20test.md)
- [Read this to schedule the Engine - why about 70 shops need two runs every day.md](./Read%20this%20to%20schedule%20the%20Engine%20-%20why%20about%2070%20shops%20need%20two%20runs%20every%20day.md) (same 50-account idea applies to the sweeper)
