# Read this before you change Hub or Spoke Sheets — how to upgrade without losing your work

Open this file **before** you rebuild a Hub Sheet or a Spoke Sheet.

The big idea is simple:

- Your important typed work lives in **Config**.
- Metric numbers can come back from Google Ads.
- Keep the **same Hub link** and the **same spoke links** whenever you can.
- Back up Config before any rebuild.

---

## What each piece does

| Piece | What it is | What you type by hand |
|---|---|---|
| **Hub Sheet** | One control panel for every body shop | Goals, alert switches, spoke links, manager emails |
| **Spoke Sheet** | One dashboard for one body shop | Yellow campaign and ad group checklist, plus **Daily Checklist** history. Green cells come from the Hub |
| **Engine** | The MCC Google Ads Script | You paste code updates here. It reads the Hub and fills the spokes |

---

## Two kinds of change

### A. Everyday edits

These are safe. You do not need to rebuild anything.

Examples:

- Change Daily Budget on the Hub
- Turn an alert switch on or off
- Add a campaign ID to a spoke yellow table
- Mark a Hub Alert as Resolved

What to do:

- Edit the Hub Config cells, or the yellow spoke cells, as usual.
- Do **not** re-run the Apps Script generator for everyday edits.

### B. Template or layout upgrades

These need care.

Examples:

- New columns
- New tabs
- A big rebuild from `create-hub-workbook.gs` or `create-body-shop-workbook.gs`

Prefer a small migration script when one exists. Example: to move **Campaign Start Date** next to **Priority** on an existing Hub without rebuilding, run `apps-script/move-hub-campaign-start-date-next-to-priority.gs` once.

Warning:

- Running the generator on an existing Sheet can wipe and rebuild tabs.
- Even if the URL stays the same, data inside can be cleared.
- Back up first.

---

## If you must upgrade the Hub Sheet

### What you must protect

1. Every real **Config** row, including:
   - Account ID
   - Enabled
   - Spoke Spreadsheet URL
   - Budgets and goals
   - Alert switches
   - Emails
   - Priority
   - Campaign Start Date
   - Notes
2. The Hub spreadsheet URL used by the Engine in `HUB_SPREADSHEET_URL`

### What is okay to lose and rebuild

- Old Run Log history
- Old Alerts rows
- Pretty formatting, because the generator puts formatting back

### Preferred method: keep the same Hub URL

1. Pause big Engine changes for a quiet moment, or wait until after the morning runs.
2. Back up Config.
   - Open Hub → **Config**
   - Select all real account rows
   - Copy them into a backup Sheet named something like `Hub Config backup — August 10 2026`
   - Or use **File → Make a copy** of the whole Hub and rename it `Hub ARCHIVE — date`
3. Open the Apps Script project that builds the Hub.
4. Paste the new `create-hub-workbook.gs` code.
5. Put your live Hub URL into `SETUP_CONFIG.EXISTING_SPREADSHEET_URL`.
6. Run `createHubWorkbook`.
7. Check that the Config headers look right.
8. Paste your backup Config rows back under the header.
   - Keep Account IDs as plain text, not numbers that turn into scientific notation.
9. Delete or clearly mark any leftover sample row.
10. Update the Engine script to the matching version so column names still match.
11. Preview or run the Engine on 1 or 2 test accounts.
12. Confirm goals synced, metrics still write, and emails still make sense.

### When to make a brand-new Hub instead

Only do this if the old sheet is too messy to rebuild, or you truly need a clean start.

Then:

1. Create a new Hub with the generator and leave `EXISTING_SPREADSHEET_URL` blank.
2. Paste Config from your backup.
3. Change one Engine setting: `HUB_SPREADSHEET_URL` to the new Hub URL.
4. Keep the old Hub as an archive for a while. Do not delete it on day one.

### Hub checklist: do not mess these up

- Do not casually change Account IDs. They must match Google Ads.
- Do not leave Spoke Spreadsheet URL blank on Enabled shops.
- Do not invent a second Hub “for the next 50 shops.”
- Do not change Hub columns without updating the Engine the same day.
- Do not hand-edit Last Successful Run unless you mean to force a re-run.
- Keep scheduling the same Engine at least twice per day for about 70 shops.

---

## If you must upgrade a spoke Sheet

### What you must protect

1. Yellow **Campaign** table rows
2. Yellow **Ad Group** table rows, especially Monitor settings
3. Optional keyword override rows, if you used any
4. The spoke URL that sits on the Hub Config row for that shop

### What is okay to lose and rebuild

- Account, Search, PMax, Location, and Device metric rows, because the Engine can refill them from Google Ads
- Green Hub-synced Config values, because the Engine can copy them again from the Hub
- Instructions and Definitions text, because the generator rewrites them

### Colors / pace lights only (no wipe)

If you only need peach/lavender column bands and Budget/Lead Pace % traffic lights:

1. Paste the current spoke generator Apps Script.
2. Run **`refreshSpokeVisualFormatting`**.
3. Confirm peach = spend/budget, lavender = leads/CPL, and pace % cells show green (>105%), yellow (95–105%), or red (<95%).

### Preferred method: keep the same spoke URL

1. Open that shop’s Spoke Sheet.
2. Back up the yellow Config tables.
   - Copy Campaign rows
   - Copy Ad Group rows
   - Copy keyword overrides if any
   - Paste them into a backup Sheet named like `Spoke Config backup — Auto Arena — August 10 2026`
   - Or make a full archive copy of the spoke
3. Open the Apps Script project that builds spokes.
4. Paste the new `create-body-shop-workbook.gs` code.
5. Set `SETUP_CONFIG.BODY_SHOP_NAME`.
6. Paste the live spoke URL into `EXISTING_SPREADSHEET_URL`.
7. Run `createBodyShopWorkbook`.
8. Paste the yellow Campaign, Ad Group, and keyword override rows back into Config.
9. Confirm the Hub still has this exact spoke URL on that shop’s Config row.
10. Run the Engine for that account, or wait for the next scheduled wave.
11. Check Account Metrics (Daily) and confirm green Config cells updated from the Hub.

### When to make a brand-new spoke instead

This should be rare. Example reasons:

- The Sheet is corrupted
- You want a completely clean file

Then:

1. Create a new spoke with the generator.
2. Paste yellow Config from backup.
3. On the Hub, replace **Spoke Spreadsheet URL** for that shop with the new link.
4. Keep the old spoke as an archive for a while.

### Spoke checklist: do not mess these up

- Do not type budgets or Target CPL on the spoke. Edit the Hub only.
- Do not overwrite green Hub-synced cells by hand and expect them to stay forever.
- Do not change the spoke URL on the Hub without also updating the real Sheet link.
- Keep Google Ads IDs as plain text.
- Do not merge Search and Performance Max onto one tab.
- After a rebuild, put the Campaign and Ad Group checklist back, or monitoring can look unconfigured.
- Back up **Daily Checklist** rows before a full spoke rebuild. That tab is human-owned (the Engine will not refill it).

---

## Easy “Did I break anything?” checklist

After any template upgrade, answer yes to all of these:

1. Does Hub Config still have every shop row?
2. Does every Enabled shop still have a working Spoke Spreadsheet URL?
3. Does the Engine version match the Hub column names?
4. Does Engine Preview or Run succeed for a test shop?
5. Does that shop’s spoke show fresh Account Metrics (Daily)?
6. Do the green spoke goals match the Hub for Daily Budget, Lead Goal, and Target CPL?
7. Do the next morning’s status email and alerts still look normal?
8. Is **Daily Checklist** still the first tab, and are recent checklist rows still there?

---

## Simple memory line

**Config is precious. Daily Checklist is precious. Metrics come back. Same links are best. Back up before you rebuild.**
