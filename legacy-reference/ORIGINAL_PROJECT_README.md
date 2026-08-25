# Built by Shah — Google Ads Management Scripts

Plain JavaScript scripts for [Google Ads Scripts](https://developers.google.com/google-ads/scripts). Each file under `scripts/` is meant to be pasted into the Google Ads Scripts editor (or linked from a managed account setup).

## How to use

1. Open [Google Ads](https://ads.google.com) → **Tools & settings** → **Bulk actions** → **Scripts** (or search “Scripts”).
2. Create a new script and paste the contents of a file from `scripts/`.
3. Update any `CONFIG` values at the top of the file.
4. **Preview**, then **Authorize** and **Run** / schedule as needed.

Google Ads Scripts run in Google’s environment (not Node). Do not use `require`, `import`, or npm packages unless you wire them through a supported pattern.

## Architecture (required)

This project uses **Hub-and-Spoke only**:

| Piece | What it is |
|---|---|
| **Hub** | One agency Sheet — accounts on/off, **goal SoT** (budgets, lead goals, Target CPL), spoke URLs, alerts, run log |
| **Engine** | MCC Google Ads Script — reads Hub, **syncs goals into each spoke Config**, pulls Ads data, writes metrics |
| **Spokes** | One Sheet per body shop — Hub-synced goal copies (green) + local monitoring (yellow) + metrics |

**Edit budgets / lead goals / Target CPL on the Hub only.** Spokes keep green copies for formulas; do not maintain a second editable source of truth.

Shared product docs (filenames say when to open them):

- [`docs/Start here - what does each of these guides do.md`](docs/Start here - what does each of these guides do.md) — **map of what each guide does**
- [`docs/Watch this for a full walkthrough - Shah explains Hub Spoke Engine Cursor Sheets and how to edit.md`](docs/Watch this for a full walkthrough - Shah explains Hub Spoke Engine Cursor Sheets and how to edit.md) — **Shah’s video walkthrough** (Cursor + Sheets + Hub/Spoke/Engine, how to edit later; `.mp4` in `docs/`, stored with Git LFS)
- [`docs/Open this when you are ready to go live - install checklist gotchas and how to smoke test.md`](docs/Open this when you are ready to go live - install checklist gotchas and how to smoke test.md) — install, gotchas, smoke test, production checklist
- [`docs/Read this before you change Hub or Spoke Sheets - how to upgrade without losing your work.md`](docs/Read this before you change Hub or Spoke Sheets - how to upgrade without losing your work.md) — how to upgrade Hub/spoke later without losing Config
- [`docs/Read this for the product requirements - what this system must do.md`](docs/Read this for the product requirements - what this system must do.md) — what the system must do
- [`docs/Give this to Codex - full product brief to rebuild this system as a web app.md`](docs/Give this to Codex - full product brief to rebuild this system as a web app.md) — **hand this to ChatGPT Codex / a dev team** to build **Built Ads Manager**, an internal web app for agency staff. Self-contained product spec: real database required, in-app alerts (no email in v1), employee-only Google sign-in, and every technical decision left to the builder. Written standalone — it deliberately does not describe the Hub/Spoke/Engine setup.
- [`docs/Give this to Codex - every alert its next steps and the design language for the app UI.md`](docs/Give this to Codex - every alert its next steps and the design language for the app UI.md) — **companion to the brief above.** Part A is the full alert catalog: every trigger, threshold, message, and the complete verbatim next-step guidance for each alert (plus the softer Watch variants). Part B captures the status email’s visual design language — colors, type scale, component anatomy, and an annotated example — as inspiration for the web app UI, explicitly **not** as an instruction to build email.
- [`docs/Read this to understand the Hub Engine and Spoke sheets - system blueprint.md`](docs/Read this to understand the Hub Engine and Spoke sheets - system blueprint.md) — Hub / Engine / Spoke blueprint
- [`docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md`](docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md) — **Search / PMax negatives sweeper** (sibling of the Engine; Hub overrides + spoke Reviewed/Remove)
- [`docs/Read this for the standalone MCC negatives sweeper - allowlist no Hub.md`](docs/Read this for the standalone MCC negatives sweeper - allowlist no Hub.md) — **standalone MCC negatives** (no Hub/Spoke; allowlist + morning email; run 90-day backfill once first for existing shops)
- [`docs/Daily Negatives Sweeper Walkthrough.pdf`](docs/Daily Negatives Sweeper Walkthrough.pdf) — printable daily walkthrough of what the negatives sweeper does
- [`docs/Read this to schedule the Engine - why about 70 shops need two runs every day.md`](docs/Read this to schedule the Engine - why about 70 shops need two runs every day.md) — why ~70 shops need two Engine runs/day
- [`docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md`](docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md) — scale past 50 accounts (due-queue)
- [`docs/Open this in a browser to preview the Google Ads Account Status email.html`](docs/Open this in a browser to preview the Google Ads Account Status email.html) — visual email preview

Cursor agents load these via `.cursor/rules/enterprise-hub-spoke-prd.mdc` and keep the go-live guide current via `.cursor/rules/keep-the-go-live-guide-in-sync.mdc`.

## Project layout

```
docs/             # PRD + architecture + go-live/ops + scale + Shah walkthrough video (.mp4 via Git LFS)
scripts/          # MCC / account Ads Scripts (paste into Ads Scripts editor)
  built-by-shah-mcc-engine.js    # MCC Engine — paste into Ads Scripts (Hub→Spoke)
  built-by-shah-mcc-search-negatives-sweeper.js  # Search exact-negative sweeper (sibling)
  built-by-shah-mcc-pmax-negatives-sweeper.js    # PMax exact-negative sweeper (sibling)
  sync-negative-sweeper-rule-blocks.js           # Maintainer codegen: copy canonical rules into paste-ready siblings
  test-negative-sweeper-contract.js               # Node parity + 23-term regression contract
  _engine-hub-spoke-contract.js  # Sync contract reference (not runnable)
  _template.js
  account-summary.js
lib/              # Optional shared helpers to copy into scripts
apps-script/      # Google Apps Script helpers (Sheets setup)
  create-hub-workbook.gs         # Agency Hub generator
  create-body-shop-workbook.gs   # Spoke workbook generator (one per body shop)
  add-daily-checklist-tab.gs     # Optional: add Daily Checklist only on an existing spoke
  add-negatives-audit-tab.gs     # Optional: add Negatives Audit only on an existing spoke
  move-hub-campaign-start-date-next-to-priority.gs  # One-time live Hub column move (no rebuild)
.cursor/rules/    # Always-on agent guidance
```

## Go live (production checklist)

Follow **[`docs/Open this when you are ready to go live - install checklist gotchas and how to smoke test.md`](docs/Open this when you are ready to go live - install checklist gotchas and how to smoke test.md)** for:

- Must-do before first production day  
- Easy-to-miss gotchas  
- What is intentionally not in this system  
- Day-1 smoke test plan  

Not sure which doc to open? Start with [`docs/Start here - what does each of these guides do.md`](docs/Start here - what does each of these guides do.md).
## Install the Search negatives sweeper (optional sibling)

1. Hub Config must include Negatives columns (Hub generator V 1.6.0+).
2. Each spoke needs a **Negatives Audit** tab (spoke V 1.10.0+ or `apps-script/add-negatives-audit-tab.gs`).
3. MCC Scripts → paste `scripts/built-by-shah-mcc-search-negatives-sweeper.js` → set `HUB_SPREADSHEET_URL`.
4. Per shop: **Enabled** + **Negatives Sweeper Enabled** + Spoke URL.
5. Schedule Daily at **7:00 AM Pacific or later**; with ~70 shops add a second identical Scripts row (same Hub URL), for example 7:00 and 8:00.
6. Optional PMax: paste `scripts/built-by-shah-mcc-pmax-negatives-sweeper.js` the same way (separate schedule).

Full guide: [`docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md`](docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md).

## Install the standalone MCC negatives sweeper (optional, no Hub)

Sheet-free alternative: for existing shops, run `scripts/built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js` once (90-day catch-up; two waves if >50 IDs), then paste `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js`, fill `ACCOUNT_ALLOWLIST` + `EMAIL_RECIPIENTS`, and schedule Daily at **7:00 AM Pacific or later** (two identical rows, for example 7:00 and 8:00, if >50 allowlisted IDs). The daily script re-reads seven completed days and emails a reconciled per-term decision audit with a bounded CSV attachment. Do not leave backfill on Daily. Do not overlap Account IDs with Hub **Negatives Sweeper Enabled**.

Guide: [`docs/Read this for the standalone MCC negatives sweeper - allowlist no Hub.md`](docs/Read this for the standalone MCC negatives sweeper - allowlist no Hub.md).

Rule/behavior regression check (Node only; no package install):

```bash
node scripts/test-negative-sweeper-contract.js
```

## Install the MCC Engine (Ads Script)

1. Create Hub + at least one Spoke (sections below).
2. In Google Ads MCC → **Scripts**, create a script and paste `scripts/built-by-shah-mcc-engine.js`.
3. Set `ENGINE_CONFIG.HUB_SPREADSHEET_URL` to your Hub URL.
4. Confirm each Hub CONFIG row is **Enabled** and has a **Spoke Spreadsheet URL**.
5. Preview → Authorize → Run.
6. **Schedule that same script enough times per day** (see below — do not create a second script).

### Scheduling reminder (important)

Google allows **50 accounts per run**. The Engine auto-picks the next due shops each time.

| Your shop count | Schedule the **same** Engine |
|---|---|
| ≤ 50 | Once daily |
| **~70 (current)** | **At least twice daily** (e.g. 6:00 + 7:00) |
| ~200 | About four times |

Plain-English walkthrough: [`docs/Read this to schedule the Engine - why about 70 shops need two runs every day.md`](docs/Read this to schedule the Engine - why about 70 shops need two runs every day.md) · Technical plan: [`docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md`](docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md)

The Engine reads the Hub, syncs goals into each spoke, writes per-account metrics, logs to Hub Run Log / Alerts, and can email managers. Metrics always live on spokes — never in one shared client-metrics workbook.

## Create the Hub Google Sheet (agency — one workbook)

1. Open [Google Apps Script](https://script.google.com) → **New project**.
2. Paste `apps-script/create-hub-workbook.gs`.
3. Run **`createHubWorkbook`** (authorize when prompted).
4. Fill **Config** — one row per account (budgets, goals, manager email).
5. After each spoke exists, paste its URL into **Spoke Spreadsheet URL**.

File name example: `Built by Shah — Google Ads Hub (V 1.5.1)`.

## Create a body shop Google Sheet (spoke — one account)

1. Open [Google Apps Script](https://script.google.com) → **New project**.
2. Paste `apps-script/create-body-shop-workbook.gs`.
3. Edit `SETUP_CONFIG` (`BODY_SHOP_NAME`; optional temporary seeds until Hub sync).
4. Run **`createBodyShopWorkbook`**.
5. Paste the spoke URL into the Hub **Spoke Spreadsheet URL** cell.
6. Fill **yellow** Config cells only (campaigns, ad groups, local alert tuning).
7. Leave **green** goal cells alone — the Engine syncs them from the Hub.

File name example: `{Body Shop Name} — Google Ad Management Sheet (V 1.7.1)`.

Spoke metrics tabs:

- **Daily Checklist** first (human to-do list; Engine does not write it)
- Daily metrics: Account, Search Campaign, Search Keyword, PMax Campaign
- Weekly: Location, Device
- Then Instructions, Definitions, **Config last**
- No Search Ad Group Metrics tab; no PMax Asset Group Metrics tab; no PMax Keyword Metrics tab (PMax has no classic keywords)
- Newest Engine writes land directly under the header (older days are pushed down)

For an **existing** spoke without Daily Checklist, paste [`apps-script/add-daily-checklist-tab.gs`](apps-script/add-daily-checklist-tab.gs) and run `refreshDailyChecklistTab` (only that tab). New spokes from `create-body-shop-workbook.gs` V **1.9.1+** already include it.

Config toggles use **Enabled / Disabled** (not TRUE / FALSE).  
Alert thresholds and per-alert email gates are edited on the **Hub** only.

## Conventions

- Entry point: `function main() { ... }`
- Put tunables in a top-level `CONFIG` object
- Prefer `Logger.log(...)` for debugging in Preview / logs
- Keep each script self-contained so it pastes cleanly into the editor
- One Google Ads account → one spoke Sheet; Hub = goals + routing only
- Google Sheet file names always include the template version (`V x.y.z`)

## Author

Built by Shah
