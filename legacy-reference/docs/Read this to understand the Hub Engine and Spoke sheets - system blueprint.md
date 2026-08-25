# Read this to understand the Hub, Engine, and Spoke sheets — system blueprint

Open this file when you need to understand how the pieces fit together:

- What the Hub is for
- What the Engine does
- What each Spoke Sheet contains
- Which values people edit, and which values the Engine writes

Related guides:

- [Read this for the product requirements - what this system must do.md](./Read%20this%20for%20the%20product%20requirements%20-%20what%20this%20system%20must%20do.md)
- [Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md](./Read%20this%20for%20the%20technical%20plan%20to%20scale%20past%2050%20accounts%20with%20one%20Hub%20and%20one%20Engine.md)
- [Read this to schedule the Engine - why about 70 shops need two runs every day.md](./Read%20this%20to%20schedule%20the%20Engine%20-%20why%20about%2070%20shops%20need%20two%20runs%20every%20day.md)

---

## 1. Big picture

This system has only one supported shape: **Hub-and-Spoke**.

```text
Agency team
    |
    | edits goals and routing only on the Hub
    v
One Hub spreadsheet
    |
    | Engine reads the Hub
    | Engine copies goals into each spoke
    v
One MCC Engine script
    |
    | writes each shop’s metrics into that shop’s own Sheet
    v
Many Spoke spreadsheets
(one Sheet per body shop)
```

### Simple analogy

- The **Hub** is the master checklist for every shop.
- The **Engine** is the morning worker that follows that checklist.
- Each **Spoke** is one shop’s private report binder.

### Important scale reminder

Google lets the Engine process only 50 accounts in one run.

If you have about 70 shops, schedule the Engine at least twice per day. Google Ads only allows one Frequency per Scripts row, so use two identical Engine rows (same code, same Hub) at adjacent hours — not a second Hub and not a Batch A / Batch B fork.

---

## 2. One source of truth for goals

People edit goals and routing on the **Hub only**.

The spoke can store copies of those goals so formulas keep working. Those copies are green and owned by the Engine.

| Kind of information | Where people should edit it | What happens on the spoke |
|---|---|---|
| Account ID and account name | Hub | Engine copies it into green cells |
| Enabled or Disabled | Hub | Engine copies monitoring on/off |
| Time zone for Sheet dates | Hub | Engine copies it |
| Daily Budget, Monthly Lead Goal, Target CPL | Hub | Engine copies them into green cells used by formulas |
| Monthly Budget | Hub | Kept on the Hub for agency planning |
| Spoke Spreadsheet URL | Hub | Used by the Engine to find the right Sheet |
| Account Manager Email and CSM Email | Hub | Used for status emails and alerts |
| Campaign and ad group monitoring lists | Spoke yellow cells | Local only. Not a second Hub goal list |
| Daily and weekly performance numbers | Nobody types these by hand | Engine writes them into spoke metric tabs |

### Bad habit to avoid

Do not ask someone to change Daily Budget on both the Hub and the spoke. Edit the Hub. Let the Engine copy it.

---

## 3. The Hub spreadsheet

**Purpose:** Control plane and goal source of truth.  
**Not for:** Detailed campaign, keyword, location, or device metrics for every client.  
**Created by:** `apps-script/create-hub-workbook.gs`

### Hub tabs

| Tab | Who uses it | What it is for |
|---|---|---|
| **Config** | People edit it. Engine reads it. | Active shops, goals, spoke URLs, alert switches, emails |
| **Run Log** | Engine writes it. People read it. | Did today’s batch succeed, partially succeed, or fail? |
| **Alerts** | Engine writes it. People work it. | Needs-attention queue for open issues |
| **Instructions** | People read it. | How to use the Hub |
| **Definitions** | People read it. | Plain-English meaning of every Config column |

Tab order rule: working tabs first. Instructions and Definitions stay near the end.

### Important Config columns

| Column | Plain-English meaning |
|---|---|
| **Account ID** | The Google Ads customer ID, stored as plain text |
| **Account Name** | The display name |
| **Enabled** | `Enabled` means process this shop. `Disabled` means skip it |
| **Priority** | Optional. Higher number means run earlier in the daily due queue |
| **Campaign Start Date** | Optional. Lead-pace grace window and 30-day money-back email callout. Sits next to Priority in the ops block |
| **Last Successful Run** | Engine-written date. Blank or not today means the shop is still due |
| **Negatives Sweeper Enabled** | Per-shop on/off for the Search/PMax negatives sweepers (also requires **Enabled**) |
| **Negatives Last Successful Run** | Search sweeper-written date (due queue) |
| **Negatives PMax Last Successful Run** | PMax sweeper-written date (separate due queue so both can run daily) |
| **Negatives Disabled Rule IDs** | Comma-separated rule IDs to skip for this shop only |
| **Negatives Protected Phrases** | Phrases never auto-negatived for this shop |
| **Negatives Competitor Phrases** | Local competitor names for LOCAL_COMPETITOR |
| **Client Name** | Body shop or client label |
| **Spoke Spreadsheet URL** | Link to that shop’s Spoke Sheet |
| **Time Zone** | Time zone used for that shop’s Sheet dates |
| **Daily Budget** | Approved average daily media budget |
| **Monthly Budget** | True monthly media budget for planning |
| **Monthly Lead Goal** | How many primary leads the shop should get this month |
| **Target CPL** | Target cost per primary lead |
| **Alerts Enabled** | Master switch for creating Hub alerts for that shop |
| **High CPL Multiplier** | How far above Target CPL counts as high CPL |
| **Zero Conversion Spend Alert** | How much spend with zero conversions should raise a flag |
| **Keyword Waste Spend Threshold** | How much one keyword or Search ad group can spend over 14 days with zero conversions before a waste alert (Hub-only; blank uses Engine default $50). Location waste is separate: 20+ clicks and 0 conversions over 30 days. |
| **Budget Pace Tolerance** and **Lead Pace Tolerance** | How far off pace is still acceptable |
| **Alert: Budget Off Pace** | Whether budget pacing issues should create alerts |
| **Alert: Leads Off Pace** | Whether lead pacing issues should create alerts |
| **Alert: High CPL** | Whether high CPL should create alerts |
| **Alert: Spend No Conversions** | Whether spend with no conversions should create alerts |
| **Alert: Zero Spend** | Whether no delivery yesterday should create alerts |
| **Alert: Unconfigured** | Whether missing Hub goals should create alerts |
| **Account Manager Name / Email** | Who gets the status email |
| **CSM Name / Email** | Who can be copied when there are problems or the shop is in the 30-day money-back window; also shown on account cards. Several CSMs on one shop: comma-separate both columns in the same order |
| **Client Report Notes** | Optional notes for client-facing language |

### Example

If Auto Arena should spend about $100 per day and get 20 leads this month at a $150 Target CPL:

1. Put those numbers on the Hub Config row.
2. Paste Auto Arena’s spoke URL.
3. Put the manager email on that same row.
4. Let the Engine copy the goals into Auto Arena’s spoke.

---

## 4. The Spoke spreadsheets

**Purpose:** One isolated dashboard per Google Ads account.  
**Created by:** `apps-script/create-body-shop-workbook.gs`

### Spoke tabs

| Tab | When it updates | What it shows |
|---|---|---|
| **Daily Checklist** | Human only (not the Engine) | Manager daily review dropdowns (green / yellow / red), meeting status, day status, and notes |
| **Account Metrics (Daily)** | Every successful Engine run | Overall health, spend, conversions, CPL, pacing |
| **Search Campaign Metrics (Daily)** | Every successful Engine run | Search campaign performance only |
| **Search Keyword Metrics (Daily)** | Every successful Engine run | Search keywords and terms |
| **Negatives Audit** | Search / PMax negatives sweepers | Exact negatives added for this shop; AM Reviewed / Remove checkboxes; spend context |
| **PMax Campaign Metrics (Daily)** | Every successful Engine run | Performance Max campaigns only |
| **Location Metrics (Weekly)** | Usually Friday only | Location performance over about the last week |
| **Device Metrics (Weekly)** | Usually Friday only | Device performance over about the last week |
| **Instructions** | Static | How people should use the Sheet |
| **Definitions** | Static | Plain-English meaning of Config keys and metric columns |
| **Config** | Hub sync plus local yellow edits | Green Hub copies plus yellow local monitoring tables |

Spoke tab order: **Daily Checklist** first, then metrics, then Instructions, then Definitions, then **Config last**.

For an existing spoke that does not have Daily Checklist yet, paste and run [`apps-script/add-daily-checklist-tab.gs`](../apps-script/add-daily-checklist-tab.gs) (it only adds/refreshes that one tab). New spokes from `create-body-shop-workbook.gs` (V 1.9.4+) include it automatically.

### Colors on spoke Config

- **Green cells** = copied from the Hub. Do not treat them as your main editing place.
- **Yellow cells** = local human input, such as campaign monitoring lists.

### What the Engine copies from Hub into spoke Config

| Hub column | Spoke Config key | Notes |
|---|---|---|
| Account ID | `ACCOUNT_ID` | Plain text |
| Account Name | `ACCOUNT_NAME` | Display name |
| Enabled | `ACCOUNT_MONITORING_ENABLED` | Enabled or Disabled |
| Time Zone | `TIME_ZONE` | Sheet time zone |
| Daily Budget | `DAILY_BUDGET` | Currency |
| Monthly Lead Goal | `MONTHLY_LEAD_GOAL` | Number |
| Target CPL | `TARGET_CPL` | Currency |
| Alerts Enabled | `ALERTS_ENABLED` | Master switch copy |
| High CPL Multiplier | `HIGH_CPL_MULTIPLIER` | Used by formulas |
| Zero Conversion Spend Alert | `ZERO_CONVERSION_SPEND_ALERT` | Used by formulas |
| Budget Pace Tolerance | `BUDGET_PACE_TOLERANCE` | Used by formulas |
| Lead Pace Tolerance | `LEAD_PACE_TOLERANCE` | Used by formulas |
| Account Manager Name | `ACCOUNT_MANAGER_NAME` | |
| Account Manager Email | `ALERT_RECIPIENT_EMAILS` and `ACCOUNT_MANAGER_EMAIL` | Same value into both keys |
| CSM Name / Email | `CSM_NAME` / `CSM_EMAIL` | |
| Campaign Start Date | `CAMPAIGN_START_DATE` | Lead-pace grace + money-back email window |

The Hub-only email gates such as **Alert: Zero Spend** stay on the Hub. They control whether the Engine creates emailable alerts. They are not a second place to store goals.

### Spoke design rules

- Keep Search and Performance Max separated.
- Newest daily and weekly metric rows sit directly under the header (older days are pushed down).
- Do not overwrite yellow input cells or blue formula cells.
- Treat green Hub-synced cells as Engine-owned.
- Keep the Sheet polished and easy to read.
- **Daily Checklist** is human-owned. The Engine never writes it. New checklist days are added from the Built by Shah menu.
- **Negatives Audit** is written by the sibling negatives sweepers (not the Engine). Cream columns Reviewed / Remove / AM Notes are human-owned.

### Explicitly out of scope on spokes and Hub

Do not put every client’s detailed metrics into the Hub.  
Do not put every client into one shared metrics Sheet.  
Do not fold negative-keyword mutations into the Engine — use the Search / PMax sweeper scripts.

---

## 5. What the Engine is responsible for

| Job | Plain-English meaning |
|---|---|
| Read the Hub | Load Enabled shops, goals, alert switches, spoke URLs, and emails |
| Sync Hub goals into spokes | Write the green Config values before metrics |
| Choose the due queue | Process up to 50 shops that still need today’s update |
| Run accounts in parallel | Work several shops at once inside the 50 limit |
| Use the right time zone | Calculate yesterday and month-to-date in the account time zone |
| Pull Google Ads data | Account, Search, PMax, keywords, and weekly location/device when due |
| Write spoke metrics | Append or update the right tabs without breaking formulas |
| Respect daily vs weekly cadence | Daily every run. Weekly only on the configured weekday |
| Catch errors safely | One bad shop should not stop the rest |
| Log and alert | Write Run Log and Alerts, and send status email when enabled |

Runnable Engine file:

- `scripts/built-by-shah-mcc-engine.js`

Sibling negatives sweepers (mutations; not the Engine):

- `scripts/built-by-shah-mcc-search-negatives-sweeper.js`
- `scripts/built-by-shah-mcc-pmax-negatives-sweeper.js`
- Guide: `docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md`

Contract notes:

- `scripts/_engine-hub-spoke-contract.js`

---

## 6. Cadence, time zone, and safe math

| Topic | Rule |
|---|---|
| Hub goal sync | Every Engine run, before metrics writes |
| Daily metrics | Every successful Engine run |
| Weekly Location and Device | Only on the configured weekday, usually Friday |
| Failures | Log them and continue with the rest of the batch |
| Yesterday and pacing dates | Use the Google Ads account time zone, never UTC |
| CTR, CPC, CPL, pacing | Always use safe division so Sheets never get NaN |

---

## 7. Final mental model

- **Hub** = who is active, what the goals are, where the spoke lives, who to email, and per-shop negatives overrides
- **Engine** = sync goals, fetch Ads data, write the right spoke, log problems, send status email
- **Negatives sweepers** = separate MCC scripts that add exact campaign negatives and write Negatives Audit on each spoke
- **Spoke** = one shop’s dashboard, checklist, and negatives review tab
- **Spoke** = one shop’s dashboard and local monitoring list

Do not reintroduce one master metrics workbook for every client.  
Do not maintain two human-edited sources of truth for budgets or CPL.
