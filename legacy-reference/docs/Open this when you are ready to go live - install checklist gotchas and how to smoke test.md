# Open this when you are ready to go live — install checklist, gotchas, and how to smoke test

Open this file when you are about to turn the system on for real.

Also open this file later if emails stop arriving, if shops stop updating, or if you are not sure what to check first.

This guide uses plain language and full sentences on purpose. Follow the steps in order the first time.

---

## Other guides you may need

- [Start here - what does each of these guides do.md](./Start%20here%20-%20what%20does%20each%20of%20these%20guides%20do.md) — map of what each guide does
- [Read this for the product requirements - what this system must do.md](./Read%20this%20for%20the%20product%20requirements%20-%20what%20this%20system%20must%20do.md) — what the system is supposed to do
- [Read this to understand the Hub Engine and Spoke sheets - system blueprint.md](./Read%20this%20to%20understand%20the%20Hub%20Engine%20and%20Spoke%20sheets%20-%20system%20blueprint.md) — how Hub, Engine, and Spoke Sheets fit together
- [Read this to schedule the Engine - why about 70 shops need two runs every day.md](./Read%20this%20to%20schedule%20the%20Engine%20-%20why%20about%2070%20shops%20need%20two%20runs%20every%20day.md) — why about 70 shops need two Engine runs each day
- [Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md](./Read%20this%20for%20the%20technical%20plan%20to%20scale%20past%2050%20accounts%20with%20one%20Hub%20and%20one%20Engine.md) — how to grow past 50 accounts without making a second Hub
- [Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md](./Read%20this%20for%20the%20Search%20negatives%20sweeper%20-%20auto-add%20review%20and%20remove%20on%20the%20spoke.md) — Search / PMax negatives sweeper (sibling of the Engine)
- [Read this for the standalone MCC negatives sweeper - allowlist no Hub.md](./Read%20this%20for%20the%20standalone%20MCC%20negatives%20sweeper%20-%20allowlist%20no%20Hub.md) — optional sheet-free MCC allowlist sweeper (run 90-day backfill once first for existing shops; do not overlap Hub-enabled shops)
- [Open this in a browser to preview the Google Ads Account Status email.html](./Open%20this%20in%20a%20browser%20to%20preview%20the%20Google%20Ads%20Account%20Status%20email.html) — visual preview of the status email

---

## What you should already have before go-live

| Piece | Where it comes from in this repo | What it looks like in real life |
|---|---|---|
| **Hub** | `apps-script/create-hub-workbook.gs` | One agency Google Sheet with Config, Alerts, and Run Log |
| **Spokes** | `apps-script/create-body-shop-workbook.gs` | One Google Sheet for each body shop |
| **Engine** | `scripts/built-by-shah-mcc-engine.js` | One Google Ads Script inside your MCC |
| **Search negatives sweeper** (optional but recommended) | `scripts/built-by-shah-mcc-search-negatives-sweeper.js` | Separate MCC Script; Hub Negatives columns + spoke Negatives Audit |
| **PMax negatives sweeper** (optional) | `scripts/built-by-shah-mcc-pmax-negatives-sweeper.js` | Separate MCC Script; same Hub flags; Channel = PMAX on spoke |
| **Standalone MCC negatives** (optional alternative) | `scripts/built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js` (+ one-time `…-backfill.js`) | No Hub/Spoke; in-script allowlist + morning email/CSV; Search+PMax; run 90-day backfill once before daily. **v1.3.0+** retries seven completed days, records a terminal decision for every unique term, and keeps city+body-shop geo intent — see the standalone allowlist guide. |
| **Status email** | Built into the Engine | An email titled **Google Ads Account Status** |

If Hub, Spokes, or Engine is missing, stop and finish setup before you turn on production. Negatives sweepers can be added after the Engine is healthy.

---

## Must-do checklist before the first real production day

Do these steps in order.

### Step 1 — Finish every live shop row on the Hub Config tab

Open the Hub spreadsheet. Go to the **Config** tab. For every shop that should run in production, fill in the row carefully.

- Set **Enabled** to `Enabled`. If this says `Disabled`, the Engine will skip that shop.
- Confirm **Account ID** and **Account Name** match the real Google Ads account.
- Fill the goals:
  - **Daily Budget**
  - **Monthly Lead Goal**
  - **Target CPL**
  - **Monthly Budget** if your team uses it for planning
- Paste the shop’s spoke Sheet link into **Spoke Spreadsheet URL**.
- Put the manager’s address in **Account Manager Email**.
  - Example for one person: `user@example.com`
  - Example for several people on the same shop: `user@example.com, user@example.com`
  - If this cell is blank, that shop will never appear in the status email.
  - Different managers for different shops: put each manager’s email on their own shop rows.
- Put the main owner’s name in **Account Manager Name**.
  - Example: `Alex Rivera`
  - If several people get the email, this is still the main owner label for that shop.
- Put the CSM address in **CSM Email** if the CSM should get copied when that shop has problems, or when the shop is still inside the first 30-day money-back guarantee window (including Healthy shops). For several CSMs on one shop, comma-separate names and emails in matching order.
- Set **Alerts Enabled** to `Enabled` unless you intentionally want no Hub alerts for that shop.
- Set each **Alert: …** column to `Enabled` for the problems you want flagged.
  - Example: if you want zero-spend alerts, set **Alert: Zero Spend** to `Enabled`.
- Optional: set **Keyword Waste Spend Threshold** (dollar amount for 14-day keyword/ad group waste alerts). Blank uses $50. Location waste uses a separate Engine rule: 20+ clicks and 0 conversions over 30 days.
- Optional: set **Priority** to a higher number if this shop should run earlier in the day.
- Optional: set **Campaign Start Date** (lead-pace grace + 30-day money-back email callout). On newer Hubs this column sits right after **Priority** with the same green ops header. On an older Hub where it is still near the right, run `apps-script/move-hub-campaign-start-date-next-to-priority.gs` once on that spreadsheet — it also reorders the Definitions tab to match. Do not rebuild the whole Hub.
- Leave **Last Successful Run** blank unless you are forcing the Engine to re-run that shop today.
- Remove or disable any sample / example row before production.

### Step 2 — Make sure every spoke exists and is linked

- Create one spoke workbook per body shop using `create-body-shop-workbook.gs`.
- Paste that spoke’s URL into the matching Hub Config row.
- On the spoke, only edit the **yellow** Config cells for local campaign and ad group monitoring.
- Do not type budgets, lead goals, or Target CPL on the spoke.
  - Those green cells are copies from the Hub.
  - The Engine will overwrite them on the next successful run.
- Script, formula, ID, and Hub-synced Config cells use a **warning-only edit lock**. Google Sheets asks you to confirm before changing them. Yellow campaign / ad group tables and weekly **Action Status** stay freely editable.
- If someone clicks through and still changes a locked metrics cell, that row’s **Notes** get a `MANUAL EDIT` stamp and **Active Alerts** / **Alert** shows **Manual edit detected**. Engine rewrites keep that stamp so you can still see it later.
- On a live spoke, run **`refreshSpokeProtections`** (Built by Shah menu, or from the spoke Apps Script project) after authorizing once so the edit warnings and manual-edit watch are installed. A full `createBodyShopWorkbook` rebuild also installs them.
- On metrics tabs, **peach** columns are spend/budget and **lavender** columns are leads/CPL/conversions. **Budget Pace %** and **Lead Pace %** use traffic lights (green above 105%, yellow 95–105%, red below 95%). **Impressions / Clicks / Conversions / Expected Leads** should be whole numbers (not percent, not long decimals). **Expected Spend / Actual Spend / Daily Budget** should show as dollars. **Budget Pace % / Lead Pace % / CTR** should show as whole percents (for example `93%`, not `0.925…`). Data row text must be **dark/black** on pastel backgrounds (never white — white is only for the dark header row). To refresh colors, dark body text, and those number formats on an existing spoke without wiping data, run **`refreshSpokeVisualFormatting`** from the spoke Apps Script (Built by Shah menu on newer spokes). That refresh updates Account, Search Campaign, Search Keyword, PMax, Location, and Device tabs. Engine **1.2.1+** also restores pastel body colors, dark text, and number formats on every metrics write.
- Spoke tab order: **Daily Checklist** first (add with `apps-script/add-daily-checklist-tab.gs` — that script only touches this one tab), then metrics, then Instructions, Definitions, and **Config last**.
- On the Daily Checklist tab, managers review each day they work the shop. New days are **not** created by the MCC Engine or by Sheet formulas. Look at the **very top menu bar** (same row as File, Edit, View, Insert) and click **Daily Checklist** (or **Built by Shah** on newer spokes) → **Add today’s checklist row**. That inserts a blank row dated **today** with weekday + date (example: Wed 8/12/2026), **newest on top**. Every review column (Status emails through Day status) is a dropdown starting as **— Select —**. Answers are traffic-light colored: **green** = healthy, **yellow** = watching, **red** = fix / escalate. Note type and Daily notes share Follow-up orange / Experiment green. You still review yesterday’s Ads numbers on the metrics tabs.

### Step 3 — Paste and configure the Engine script

In Google Ads MCC:

1. Go to **Tools and settings → Bulk actions → Scripts**.
2. Create or open your Engine script.
3. Paste the full current file from `scripts/built-by-shah-mcc-engine.js`.
4. Confirm `ENGINE_CONFIG.HUB_SPREADSHEET_URL` still points at your live Hub (this repo’s Engine already has it filled in).
   - If this is empty, the Engine will stop and do nothing useful.
5. Keep these settings for normal production:
   - `MAX_ACCOUNTS: 50`  
     This is Google’s hard limit. One Engine run can process at most 50 shops.
   - `AUTO_SHARD: true`  
     Each run picks the next shops that still need today’s update, instead of always repeating the same first 50.
   - `WRITE_WEEKLY_EVERY_RUN: false`  
     This is **not about email**. It controls the weekly Location and Device tabs on each spoke.  
     With `false`, those weekly tabs update on the normal weekly day only (usually Friday).  
     With `true`, the Engine would rewrite those weekly tabs on every run, which is only for testing.
6. Keep `SEND_INTERNAL_EMAILS: true` for normal production so managers get Google Ads Account Status emails after each finished batch.
   - Only set this to `false` if you temporarily need to stop emails.
   - Status emails send as soon as each Engine batch finishes. There is no separate “wait until the whole day is done” switch.
7. Prefer `EMAIL_SEND_ALL_CLEAR: true` so managers still get an email on healthy days, not only when there are problems.

### How to send emails to more than one person

The Engine groups shops by **Account Manager Email** on the Hub Config row.

- **One manager for a shop:**  
  Put one email in **Account Manager Email**.  
  Example: `user@example.com`  
  Put that person’s name in **Account Manager Name**.  
  Example: `Alex Rivera`

- **Several people should all get the same shop’s email:**  
  Put all of their emails in **Account Manager Email**, separated by commas.  
  Example: `user@example.com, user@example.com`  
  Put the main owner’s name in **Account Manager Name**.  
  Example: `Alex Rivera`  
  Everyone on that email list gets the same status email for that shop.

- **Different managers own different shops:**  
  Put each manager’s email on their own shop rows.  
  Example: Auto Arena row has `user@example.com`. Body Shop B row has `user@example.com`.  
  Alex gets an email covering Alex’s shops. Sam gets a separate email covering Sam’s shops.

- **CSM should also see problem shops and 30-day guarantee shops:**
  Put the CSM email in **CSM Email**.
  The CSM can be copied when that shop has open problems, **or** when it is still inside the first 30-day money-back guarantee window (even if the shop is Healthy).

- **Several CSMs on the same shop:**  
  Put every CSM name in **CSM Name**, separated by commas, and every matching email in **CSM Email** in the **same order**.  
  Example names: `Jordan Lee, Sam Rivera`  
  Example emails: `user@example.com, user@example.com`  
  The status email card will list both CSMs for the Google Ads manager.  
  When that shop needs attention, or is still in the 30-day money-back window, both CSM emails can be copied on the status email.

Important: blank **Account Manager Email** means that shop will not appear in any status email.

### Step 4 — Share the Sheets with the right Google account

The Google account that authorizes the Ads Script must be able to:

- Open and **edit** the Hub
- Open and **edit** every spoke Spreadsheet

If the script cannot open a Sheet, that shop will fail. You will see it in Hub **Run Log** and sometimes in Hub **Alerts**.

### Step 5 — Authorize the script and schedule it

1. Click **Preview** first and authorize when Google asks.
2. After your smoke test passes, use a real **Run**.
   - Preview checks access and reads Ads data.
   - Preview does **not** write spoke metrics, Hub Run Log / Alerts, Last Successful Run, or email.
3. Schedule enough Engine runs each day for your shop count.

| How many Enabled shops you have | How often to schedule the Engine |
|---|---|
| 50 or fewer | Once per day is enough |
| About 70 (current size) | At least twice per day, for example 6:00 and 7:00 |
| About 200 | About four times per day |

Simple rule: divide the number of Enabled shops by 50, then round up. That is how many runs you need each day.

**Google Ads UI note:** one Scripts row only gets **one** Frequency (one Daily time window). To run at 6:00 and again at 7:00, add a second Scripts row with the **exact same** Engine code and the **same** Hub URL, then schedule that row for the next hour. Name it something like “Engine (wave 2)”. That is two schedules sharing one Hub — not a second Hub, and not a Batch A / Batch B fork.

Do **not** create a second Hub. Do **not** put different account lists in each script.

More detail: [Read this to schedule the Engine - why about 70 shops need two runs every day.md](./Read%20this%20to%20schedule%20the%20Engine%20-%20why%20about%2070%20shops%20need%20two%20runs%20every%20day.md).

### Step 6 — Confirm daily status emails are on

The Engine defaults to `SEND_INTERNAL_EMAILS: true`, so finished batches send Google Ads Account Status emails automatically.

Before you rely on email in production:

1. Confirm `SEND_INTERNAL_EMAILS: true` in the pasted Engine script.
2. Keep `EMAIL_SEND_ALL_CLEAR: true` so healthy days still get an email.
3. Confirm every shop that should get mail has an **Account Manager Email**.
4. Expect a subject that starts like this:  
   `Built by Shah | Google Ads Account Status`  
   Example when one shop has several alerts: `… — 1 account needs action (4 issues) — …`  
   The subject counts **shops**, not individual alert rows.
5. Remember that each email is only **one Built by Shah Google Ads Script Engine batch**.
   - One batch can cover up to 50 shops.
   - If more shops are still due later that day, another scheduled run may send another email.
6. In the email body, each shop appears **once** under Needs attention. Multiple issues stack inside that shop’s card. Click **Next step** to expand the checklist for each issue.

### Step 7 — Install negatives sweepers (after Engine is healthy)

Negatives are **not** inside the Engine. Full guide: [Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md](./Read%20this%20for%20the%20Search%20negatives%20sweeper%20-%20auto-add%20review%20and%20remove%20on%20the%20spoke.md).

1. Upgrade Hub Config so Negatives columns exist (Hub template V 1.6.0+).
2. Ensure each spoke has a **Negatives Audit** tab (spoke template V 1.10.0+, or `apps-script/add-negatives-audit-tab.gs`).
3. Paste `scripts/built-by-shah-mcc-search-negatives-sweeper.js`, set `HUB_SPREADSHEET_URL`, and schedule Daily at **7:00 AM Pacific or later** (two identical rows, for example 7:00 and 8:00, if ~70 shops).
4. Optionally paste the PMax sweeper the same way (separate Scripts rows; stamps **Negatives PMax Last Successful Run**).
5. Per shop: set **Negatives Sweeper Enabled** = Enabled only when you want that shop swept (keep **Enabled** = Enabled too).
6. AMs review spoke **Negatives Audit** (Reviewed / Remove) and set Daily Checklist → Negatives audit.

For the standalone alternative, paste the v1.3.0+ daily script and keep `ACTION_WINDOW_DAYS: 7`. Its summary email must show raw Search/PMax rows, unique terms, and terminal decisions that reconcile. Open the attached CSV to inspect `NO_RULE`, protected, converted, Google-status, already-covered, wrong-campaign, manual-review, failed, and safety-ceiling reasons.

---

## Easy-to-miss gotchas

These mistakes are common. Read each one carefully.

### The Engine URL is still empty

If `HUB_SPREADSHEET_URL` is blank, the Engine cannot find the Hub. Nothing useful will run.

### Emails are still turned off in the script

If `SEND_INTERNAL_EMAILS` is set to `false`, no status emails will go out, even if the Sheets look perfect. Normal production keeps this set to `true`.

### Someone turned email off while testing

If you temporarily set `SEND_INTERNAL_EMAILS` to `false` during testing, turn it back to `true` before you expect daily status emails again.

### The manager email cell is blank

If **Account Manager Email** is blank on a shop row, that shop will not be included in the status email. That includes Engine failures for that shop — they still land on Hub **Alerts**, but they will not show in the morning digest without a manager email.

### CSM emails cover problems and 30-day money-back shops

**CSM Email** is added when `EMAIL_INCLUDE_CSM_ON_PROBLEMS` is `true` and that CSM’s shop either:

- has open problems (Needs attention / Watch / typed Hub alerts), **or**
- is still inside the first **30-day** minimum lead money-back guarantee window (including **Healthy** shops)

CSMs are not copied for older Healthy shops outside that window on a quiet all-clear day (unless another of their shops on the same manager digest qualifies).

Each account card in the email also shows that shop’s **CSM Name** and **CSM Email** from the Hub (even when the CSM is not CC’d), so Google Ads managers can see who owns the client relationship without looking it up.

If one shop has several CSMs, list them in both columns in the same order (comma-separated). Example: **CSM Name** `Jordan Lee, Sam Rivera` with **CSM Email** `user@example.com, user@example.com`. The card lists every CSM, and every listed CSM email can be copied when that shop has problems or is in the 30-day money-back window.

### New metric rows look like the dark header (or show 0.925 instead of 92.6%)

Google Sheets makes brand-new rows under the header inherit the **header** row’s dark colors and plain number formats. Older Engine builds copied formulas only and left that inherited look in place, and they also skipped formats for **Expected Spend**, **Expected Leads**, **Budget Pace %**, **Lead Pace %**, and **Actual CPL**.

Engine **1.2.1+** fixes this on every write: it re-applies pastel body colors by column name and the full number-format map. If a live spoke still shows dark rows from earlier runs:

1. Paste/update `scripts/built-by-shah-mcc-engine.js` to **1.2.1+** in the MCC Script.
2. On the spoke, run **`refreshSpokeVisualFormatting`** once (repairs existing history colors/formats and forces dark body text on Account, Search Campaign, Search Keyword, PMax, Location, and Device — without wiping values).
3. Preview/Run the Engine for that shop and confirm the newest rows under the header are pastel with **black text**, with `$` / whole `%` / whole Expected Leads.

Do **not** “fix” this by pasting full cell formats from a neighbor row alone — that previously turned Clicks/Impressions into percents when a template row was wrong.

#### If the repair “did nothing,” you are almost certainly running old code

The most common cause of “I ran the refresh and it still looks broken” is that the Apps Script project attached to that spoke still contains an **older copy** of `create-body-shop-workbook.gs`. Running a script does not update the script — you have to paste the new file in first.

Two quick ways to check which version a spoke is actually running:

1. **Look at the spreadsheet file name.** Every run renames the file to `{Body Shop Name} — Google Ad Management Sheet (V {TEMPLATE_VERSION})`. If the title still says `(V 1.9.0)` after you ran the refresh, the project is on 1.9.0 and never received the fix.
2. **Read the confirmation dialog.** The refresh now opens a popup titled `Metric formatting refreshed (V 1.9.5)`. If that number is lower than 1.9.5, paste the current file and run again.

To update a live spoke: open the spoke Sheet, go to **Extensions → Apps Script**, select all of the existing code in the editor and delete it, paste the full current `apps-script/create-body-shop-workbook.gs`, press **Save**, reload the Sheet so the menu rebuilds, then run **Built by Shah → Refresh metric colors + pace lights**.

Watch out for the menu name. If the spoke's menu bar says **Daily Checklist** instead of **Built by Shah**, the bound project is still the small `add-daily-checklist-tab.gs` file, which has no refresh function at all. Do not keep both files in one project: they both define `onOpen`, `refreshDailyChecklistTab`, `addTodaysChecklistRow`, and `writeDailyChecklistSheet_`, and Apps Script keeps only one copy of each, so the menu you get is unpredictable. `create-body-shop-workbook.gs` V 1.9.5 already contains the full checklist logic, so delete the checklist file once you paste the generator.

#### Fastest repair when pasting the full generator is not practical

`apps-script/fix-metric-row-colors.gs` is a small self-contained repair script (about 240 lines) for exactly this problem. It needs no `SETUP_CONFIG`, does not rename the workbook, does not rebuild any tab, and defines no `onOpen`, so it can be added as an extra file next to whatever script the spoke already has without clashing.

Add it as a new script file in the spoke's Apps Script project, save, pick **`fixMetricRowColorsNow`** in the function dropdown, and click **Run**. It repaints all six metrics tabs with the correct pastel fills, black body text, dark white-bold header row, standard row heights, and the full number-format map, and it rebuilds the status and pace traffic-light rules so every row is covered. Cell values and formulas are never touched.

#### Column colors come from a per-tab table, never from header names

Engine **1.2.2+**, generator **V 1.9.5+**, and the repair script all decide body colors from the same per-tab, per-column table: `SPOKE_METRIC_COLUMN_ROLES` in the Engine, `METRIC_COLUMN_ROLES` in `create-body-shop-workbook.gs`, and `FIX_METRIC_COLUMN_ROLES` in the repair script. Each entry lists the script-written columns (green), ID columns (gray), and human dropdown columns (cream) by column number; everything else is a sheet formula (blue), with the peach spend and lavender lead tints layered on top.

An earlier build guessed these roles from header names, which mispainted 23 columns across the six tabs. The worst cases were the **Action Status** dropdowns on the two weekly tabs, which are meant to be cream so operators can see where to type but were painted formula blue, and the **Notes** columns, which are script-written and should be green. It also painted **CTR** and **Avg. CPC** green on the campaign tabs even though those are sheet formulas.

If you add, remove, or reorder a column on a metrics tab, update the tab spec in `create-body-shop-workbook.gs` **and** all three role tables in the same change, or a later Engine run will repaint that tab differently from a fresh build.

### Status and Pace columns stopped showing green / yellow / red on recent rows

If **Budget Status**, **Budget Pace %**, **Lead Status**, **Lead Pace %**, or **CPL Status** color correctly on older rows but stay plain on the newest ones, the conditional formatting ranges drifted.

Those colors are conditional formatting created by the spoke generator, not by the Engine — the Engine only writes values, and the sheet decides the color. When the Engine calls `insertRowsAfter(headerRow)` to put the newest day on top, Google Sheets **shifts** existing conditional-format ranges down rather than growing them. A rule covering rows 5–104 becomes 6–105, so the brand-new row sits outside every rule. Repeat this daily and the untinted band at the top keeps growing.

Engine **1.2.3+** fixes this going forward: after each daily and weekly block write it calls `reanchorSpokeMetricConditionalFormats_`, which stretches every data-row range back to the first data row across the whole used block, preserving each rule's condition and color.

To repair a sheet that already drifted, run either the generator's **Built by Shah → Refresh metric colors + pace lights** (V 1.9.5+) or the standalone `apps-script/fix-metric-row-colors.gs` (V 1.2.0+). Both now rebuild the full rule set from `METRIC_CF_COLUMNS` / `FIX_METRIC_CF_COLUMNS` instead of trying to patch the drifted ranges.

Be aware that this rebuild **replaces all conditional formatting on the six metrics tabs**. That is safe because the status text rules, the non-empty Alert highlight, and the Pace % traffic lights are the only rules those tabs are meant to have. If you hand-added your own conditional formatting to a metrics tab, it will be removed and you should re-add it. The Daily Checklist, Config, Instructions, and Definitions tabs are never touched.

### All-clear emails got turned off

If `EMAIL_SEND_ALL_CLEAR` is `false`, managers with no open problems get no email that wave. That can look like “emails stopped,” even though the system is working.

### Alert switches are off

If **Alerts Enabled** is `Disabled`, or if an individual **Alert: …** gate is `Disabled`, that shop will create fewer Needs attention cards.

### The shop already succeeded today

If **Last Successful Run** already shows today’s date, the Engine will skip that shop until tomorrow. Failed shops stay due and can retry on the next run.

### Wave size and Success count can disagree

The Logs line `this wave: 2` means the Hub selected two shops. `Success: 1, failed: 0` can still happen when Google Ads returns no parallel result for one shop (wrong Account ID, not ENABLED under this MCC, or not linked). Engine **1.1.4+** treats that as a failure and logs `Wave account IDs` plus each `Succeeded:` name. Check Hub **Alerts** for `ENGINE_FAILURE` and confirm the Hub Account ID matches the live Ads account under your MCC.

### A temporary test list was left in the script

If `ACCOUNT_IDS` still has forced account IDs, the Engine will keep focusing on that list. Clear it after smoke testing so the normal due queue can work.

### Account Metrics look empty or “wrong” next to Search/PMax

- **Actual Spend** and **Google Ads Conversions** on Account Metrics (Daily) are **month-to-date through yesterday**, not yesterday-only. Search and PMax campaign tabs are true daily totals, so the dollars will not match a single Search row.
- Newest Account rows sit **directly under the header** (row 5). Scroll up if you sorted the tab or still have older history lower down.
- Use **Run**, not Preview, or the Engine will not write the Sheet.
- Engine **1.1.6+** clears Sheet filters before writing and uses yesterday’s month for MTD (so the 1st of the month no longer writes $0 by mistake).

### Time zones can differ

- “Yesterday” metrics use the **Google Ads account** time zone.
- “Today” for the due queue, Run Log stamps, and the weekly weekday gate use `REPORT_TIME_ZONE` in the Engine. The default is `America/New_York`.

### A negatives sweeper can run before Search terms are ready

Google normally finishes prior-day Search-term reporting around **6:00 AM in each Ads account’s local time**. A 3:00–4:00 AM Pacific sweep is too early for Pacific accounts and can also be early for Central accounts.

- Schedule daily negatives sweepers at **7:00 AM Pacific or later** for the current Eastern/Central/Pacific mix.
- The current sweepers re-read the **last seven completed days**, so late-published terms are retried on later runs.
- With about 70 shops, use identical schedule rows around **7:00 and 8:00 AM Pacific**. Keep one Hub/allowlist; do not split shops into permanent batches.
- The standalone done label is only that day’s queue marker. Existing Google status and negative coverage checks make the seven-day overlap safe.

### Weekly Location and Device tabs only update on one weekday

By default, Location Metrics (Weekly) and Device Metrics (Weekly) update on Friday. They do not update every day unless you temporarily turn on `WRITE_WEEKLY_EVERY_RUN` for testing.

### Waste and disapproved-ad checks are not Friday-only

Keyword waste checks, location waste checks (cities with spend/clicks and zero conversions), and disapproved-ad checks can run on successful processing days when alerts are enabled.

### New campaigns get a short lead-pace grace period

If **Campaign Start Date** is set on the Hub, lead-pace pressure is softer for the first several days. The default grace window is 7 days.

### First 30 days show a money-back guarantee callout on the status email

When **Campaign Start Date** is filled and the shop is still inside the first **30 calendar days** (day 1 = start date; guarantee ends on start + 29 days), the Google Ads Account Status email:

- Puts an orange **minimum lead money-back guarantee** banner on that shop’s card (campaign start, guarantee end, and **days left** until the window ends)
- Inside that banner, shows a compact lead strip when **Monthly Lead Goal** is set:
  - **Leads so far** = conversions from Campaign Start Date through yesterday (not calendar-month MTD)
  - **Leads needed so far** = prorated target for the current day in the 30-day window (rounded)
  - **Current lead pace** = leads so far ÷ leads needed so far  
    (red below 100%, yellow 100–105%, green above 105%)
  - **30-day lead target** = Hub **Monthly Lead Goal** (no new Hub column)
- Adds a small **Day X of 30 · money-back** pill next to Healthy / Needs attention
- Sorts those shops to the **top of Needs attention** and the **top of Healthy** (they stay in the correct health section), with shops **closest to the guarantee end date first**

The banner design is the same for every shop in the window. The lead strip is hidden if Monthly Lead Goal is blank. After day 30, the banner and special sort stop. Blank **Campaign Start Date** means no money-back callout for that shop.

### The Ads account itself must be Enabled under the MCC

Even if the Hub says Enabled, the Google Ads client account must also be Enabled under the MCC. Otherwise the Engine cannot select it.

### Do not edit green goal cells on the spoke

If you change green budget or CPL cells on the spoke, the next Engine sync can overwrite them from the Hub. Edit goals on the Hub only. The spoke also warns before you edit Hub-synced Config cells and script/formula metrics cells. Prefer Cancel on that warning unless you are intentionally overriding.

### Fill the Hub zero-conversion threshold

If Hub **Zero Conversion Spend Alert** is blank, the Engine falls back to 200. Fill the Hub cell so every shop uses the number you actually want.

### Fill the Hub keyword waste threshold

**Keyword Waste Spend Threshold** controls the 14-day **keyword / Search ad group** waste alerts (`WASTE_14D_KEYWORD`, `WASTE_14D_AD_GROUP`).

Example: `50` means about $51 spent with 0 conversions in 14 days can create an alert.

**Location waste** (`LOCATION_WASTE`) is separate. It notifies when a zip, city, metro, region, or other Google geo gets **20 or more clicks** and **0 conversions** over the **last 30 days**. That click rule lives in the Engine (`LOCATION_WASTE_MIN_CLICKS` / `LOCATION_WASTE_LOOKBACK_DAYS`), not in this Hub dollar cell.

If the keyword waste cell is blank, the Engine uses $50. The next Engine run can also add this column to older Hubs automatically and fill existing rows with 50 — then change Auto Arena (or any shop) to the number you want.

### Preview is not the same as Run

Preview can check Hub and spoke access and read Ads data. Preview does **not** write spoke metrics, does **not** sync Hub goals into spoke Config, does **not** append Hub Run Log or Alerts rows, does **not** stamp **Last Successful Run**, and does **not** send email. Use Preview to prove access first; use **Run** for the first real write.

### More than one status email in one day can be normal

With about 70 shops and two or more schedules, managers may get more than one Google Ads Account Status email in a day. The email header explains that this is one Built by Shah Google Ads Script Engine batch.

### If emails stop arriving

Open any older HTML status email. Scroll to the bottom. Use the **Save this tip** checklist. It tells you what to check in the Google Ads Hub Config tab, Run Log, Scripts schedule, Engine settings, and your inbox.

---

## Things this system intentionally does not do

These are not missing features. They are out of scope on purpose.

- **Negatives automation** lives in sibling MCC scripts (`built-by-shah-mcc-search-negatives-sweeper.js` and `built-by-shah-mcc-pmax-negatives-sweeper.js`). It is **not** part of the Built by Shah Google Ads Script Engine. Install and operate it with [Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md](./Read%20this%20for%20the%20Search%20negatives%20sweeper%20-%20auto-add%20review%20and%20remove%20on%20the%20spoke.md). There is also a sheet-free alternative (`built-by-shah-mcc-standalone-daily-negatives-sweeper-final-v1.1.0.js`, plus one-time `built-by-shah-mcc-standalone-backfill-negatives-sweeper-final-v1.1.0.js` for a 90-day catch-up) — see [Read this for the standalone MCC negatives sweeper - allowlist no Hub.md](./Read%20this%20for%20the%20standalone%20MCC%20negatives%20sweeper%20-%20allowlist%20no%20Hub.md). Do not run both on the same Account ID.
- There is **no giant shared Sheet** that dumps every client’s campaign and keyword metrics together.
- There is **no Search Ad Group Metrics** tab. Use Search Keyword Metrics (Daily) instead.
- There is **no PMax Asset Group Metrics** tab, and **no PMax Keyword Metrics** tab. PMax does not use classic keywords; use **PMax Campaign Metrics (Daily)** for PMax performance.
- On each metrics tab, the Engine writes the **newest day (or week) directly under the header** and pushes older rows down, so you do not have to scroll to the bottom for the latest data.
- The Engine does **not** change Google Ads campaigns, bids, or ads. It reads Ads data and writes Google Sheets.
- You should **not** create a second Hub, or a forked Engine with a different account list, just because you passed 50 shops. For two Daily times in Google Ads, use two identical Engine Scripts rows that share the same Hub (see the scheduling guide).
- The Engine does **not** write the spoke **Daily Checklist** tab. Managers add a row with the Built by Shah (or Daily Checklist) menu when they work that shop.
- There are **no separate per-issue alert emails**. The Google Ads Account Status email is the action queue.
- **Monthly Budget** is mainly a Hub planning field. The Engine syncs the Hub goal fields that spoke formulas need. See the system blueprint for the exact sync list.

---

## How to smoke-test on day one

Do not turn on all 70 shops on the first try. Test small first.

### A. Narrow the scope

1. Set only 1 or 2 Hub rows to **Enabled**, and set the rest to **Disabled**.
   - Or temporarily put those Account IDs into `ACCOUNT_IDS`, then clear that list after testing.
2. Confirm those test shops have Spoke Spreadsheet URLs and Account Manager Emails.
3. Keep `SEND_INTERNAL_EMAILS: true` unless you temporarily want to silence email during a test.

### B. Preview

1. Click **Preview** in Ads Scripts.
2. Confirm the script can open the Hub and the spoke.
3. Confirm the logs look normal.
4. Confirm no spoke metric writes and no email were sent.

### C. Real Run with email still off

1. Click **Run**.
2. On the spoke, check:
   - **Daily Checklist** is the first tab (add with `add-daily-checklist-tab.gs` if it is missing)
   - Green Config goals match the Hub
   - Account, Search, and PMax daily tabs have yesterday’s data
   - The **newest row under the header** uses pastel body colors with **dark/black text** (not the dark header colors, and not white text)
   - On Account Metrics: **Expected Spend** shows `$…`, **Expected Leads** is a whole number, **Budget Pace %** / **Lead Pace %** show like `93%` (not `0.925…`)
   - **Impressions / Clicks** stay whole numbers (not percent)
   - Search Campaign / Search Keyword / PMax tabs match the same pastel + black-text look
   - On the **newest** row (not just older rows), **Budget Status**, **Lead Status**, and **CPL Status** are tinted green or red, and **Budget Pace % / Lead Pace %** show their green/yellow/red traffic light. If the newest rows are plain while older rows are colored, the conditional-format ranges drifted — see the Status and Pace troubleshooting section above
   - On the weekly Location and Device tabs, the **Action Status** dropdown column is cream (that is where humans type), and **Notes** is green
3. On the Hub, check:
   - **Run Log** shows SUCCESS or PARTIAL
   - **Last Successful Run** is stamped for shops that succeeded
   - **Alerts** appear only when real issues fired and the alert gates are on

### D. Check the due queue

1. Enable a few more shops, or wait for the second scheduled run.
2. Confirm the Engine picks shops that are still due today.
3. Confirm it is not stuck on the same first group forever.
4. When every due shop is done for the day, Run Log can show `DAILY_CYCLE_COMPLETE`.

### E. Confirm email for the test shops

1. Confirm `SEND_INTERNAL_EMAILS: true`.
2. Run again for the smoke-test managers.
3. Confirm:
   - The subject uses **Google Ads Account Status**
   - The email goes to the Account Manager Email
   - CSM is copied when that shop has problems or is in the 30-day money-back window, if you configured that
   - The header explains this is one Built by Shah Google Ads Script Engine batch
   - Needs attention, Watch, and Healthy sections look right

### F. Check weekly tabs once

On Friday, or during a short test with `WRITE_WEEKLY_EVERY_RUN: true`, confirm Location Metrics (Weekly) and Device Metrics (Weekly) update. Then set `WRITE_WEEKLY_EVERY_RUN` back to `false`.

### G. Scale up

1. Set the remaining shops to **Enabled**.
2. Schedule the **same** Engine at least twice per day for about 70 shops.
3. After both waves finish, most Enabled rows should show today’s date in **Last Successful Run**.

### H. Verify the standalone negatives recovery run

Do this after pasting the v1.3.0+ standalone daily script:

1. Remove that day’s `BbsStandaloneNeg:yyyy-MM-dd` account labels, or wait until the next day.
2. Run after **7:00 AM Pacific**.
3. Confirm each account’s decision total equals its unique terms evaluated.
4. Open the attached CSV and confirm `NO_RULE` rows are present instead of disappearing.
5. Check the supplied regression phrases. Each must be added or have an explicit safe reason such as own-account protection, conversion, Google status, or existing negative coverage.
6. If you need to recover vocabulary gaps older than seven days, rerun the separate 90-day backfill. Do not leave backfill scheduled Daily.

---

## Engine settings quick reference

| Setting | Usual production value | Plain-English meaning |
|---|---|---|
| `HUB_SPREADSHEET_URL` | Live Hub URL (pre-filled in this repo’s Engine) | Required. Tells the Engine which Hub to read. Confirm it still matches your Hub if you ever replace the Sheet. |
| `ACCOUNT_IDS` | `[]` empty list | Empty means use the automatic due queue. |
| `MAX_ACCOUNTS` | `50` | Google’s hard cap. Never raise this above 50. |
| `AUTO_SHARD` | `true` | Process the next due shops, not the same first 50 forever. |
| `REPORT_TIME_ZONE` | `America/New_York` | Used for Run Log time, weekly day gate, and due-queue “today.” |
| `WEEKLY_SEGMENT_DAY` | `5` which means Friday | Day when weekly Location and Device tabs update. |
| `WRITE_WEEKLY_EVERY_RUN` | `false` | Keep false in production. True is only for testing. |
| `SEND_INTERNAL_EMAILS` | `true` | Master switch for Google Ads Account Status emails. Emails send when each batch finishes. |
| `EMAIL_SEND_ALL_CLEAR` | `true` | Still email managers on healthy days. |
| `EMAIL_INCLUDE_CSM_ON_PROBLEMS` | `true` | Copy CSM Email for shops with problems and for shops still in the 30-day money-back guarantee window. |

---

## When this file must be updated

If someone changes install steps, Hub Config fields operators must fill, alert gates, email send rules, Preview behavior, due-queue behavior, or what is intentionally out of scope, they must update this file in the same change.

If a guide is added, renamed, or removed, also update [Start here - what does each of these guides do.md](./Start%20here%20-%20what%20does%20each%20of%20these%20guides%20do.md).

Cursor agents are reminded by `.cursor/rules/keep-the-go-live-guide-in-sync.mdc`.
