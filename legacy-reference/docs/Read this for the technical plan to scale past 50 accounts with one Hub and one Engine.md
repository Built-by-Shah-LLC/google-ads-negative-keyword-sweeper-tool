# Read this for the technical plan to scale past 50 accounts with one Hub and one Engine

Open this file when you need the deeper plan for growing from 50 shops to 70, 200, or more, while still using one Hub and one Engine.

If you only need the plain-English scheduling answer for about 70 shops, start here instead:

[Read this to schedule the Engine - why about 70 shops need two runs every day.md](./Read%20this%20to%20schedule%20the%20Engine%20-%20why%20about%2070%20shops%20need%20two%20runs%20every%20day.md)

Related guides:

- [Read this for the product requirements - what this system must do.md](./Read%20this%20for%20the%20product%20requirements%20-%20what%20this%20system%20must%20do.md)
- [Read this to understand the Hub Engine and Spoke sheets - system blueprint.md](./Read%20this%20to%20understand%20the%20Hub%20Engine%20and%20Spoke%20sheets%20-%20system%20blueprint.md)

---

## The problem in plain English

Google Ads Scripts has a hard limit:

- One Engine run can process at most **50 accounts** with parallel processing.
- One MCC run also has a time limit, often around one hour.
- You cannot fix this by raising `MAX_ACCOUNTS` above 50. Google will not allow it.

So if you have 70 shops, one morning run cannot finish everyone.

### Bad solutions we reject

- Making a second Engine script for “shops 51 to 100”
- Making a second Hub spreadsheet for “the next 50 shops”
- Asking a person to rebuild Batch A / Batch B lists every week

Those approaches create duplicate work and break the single source of truth.

---

## The required solution: one Hub, one Engine, a daily due queue

Use this plan:

1. Keep **one Hub**.
2. Keep **one Engine script**.
3. Schedule that **same** script enough times each day.

### What each run does

1. Reads every Enabled row on the Hub Config tab.
2. Builds a “due today” list.
   - A shop is due if **Last Successful Run** is blank or not today’s date.
3. Sorts that list.
   - Higher **Priority** comes first.
   - Then Account ID is used as a tie-breaker.
4. Takes the next group of up to 50 due shops.
5. Runs those shops in parallel.
6. When a shop succeeds, writes today’s date into **Last Successful Run**.
7. The next scheduled run picks the next unpaid shops.
8. When nobody is left due today, Run Log can record `DAILY_CYCLE_COMPLETE`.

### Picture of the flow

```text
Hub Config has many Enabled shops
            |
            v
Is this shop due today?
   no  -> skip until tomorrow
   yes -> keep it on the due list
            |
            v
Sort by Priority, then Account ID
            |
            v
Take the first 50
            |
            v
Update those Spoke Sheets
            |
            v
Stamp Last Successful Run = today
            |
            v
Next scheduled run takes the next due shops
```

### What you do need

- One Hub with one Config row per body shop
- One Engine script
- Enough schedules to finish `ceil(number of Enabled shops / 50)` waves each day

### What you do not need

- A new script copy for every group of 50 shops
- A new Hub for every group of 50 shops
- A forever manual Batch column

### Suggested schedule sizes

| Enabled accounts | Waves needed | Suggested schedule |
|---|---|---|
| 50 or fewer | 1 | Once daily |
| 51 to 100 | 2 | Twice daily, for example 6:00 and 7:00 |
| 101 to 200 | 4 | About four times across the morning |
| 201 to 500 | 5 to 10 | Every 30 to 60 minutes through the morning |

### Example

If you add shop number 201:

1. Create one new Spoke Sheet for that shop.
2. Add one new Hub Config row.
3. Paste the spoke URL.
4. Keep using the same Engine.

You do not fork the Engine.

---

## Hub columns that make scaling work

| Column | Who edits it | What it means |
|---|---|---|
| **Priority** | A person, optional | Higher number means “run this shop earlier today.” Blank means 0. |
| **Last Successful Run** | The Engine | The date of the last successful update. Blank or not today means the shop is still due. |

Failed shops stay due because the Engine only stamps success. The next run can retry them automatically.

Existing Hubs can gain these columns without making a second Hub. The Engine can append them if they are missing.

---

## Engine behavior rules that must stay locked

| Rule | Why it matters |
|---|---|
| Keep `MAX_ACCOUNTS` at 50 | That is Google’s hard limit. |
| Keep `AUTO_SHARD` true | The Engine must choose the next due shops, not always the first 50 Hub rows. |
| Empty due queue means stop cleanly | Write `DAILY_CYCLE_COMPLETE` and return. Do not force a useless parallel call. |
| Email each finished wave | When `SEND_INTERNAL_EMAILS` is true, each batch emails as soon as it finishes. |
| Write Hub Alerts during each wave | Failures and gated alerts should still be recorded. |
| Do not use one global script lock across all parallel shops | Different spokes do not need to wait on each other. A global lock can slow everything down and time out. |

For testing only, you may temporarily force `ACCOUNT_IDS`. Clear that list when testing is done.

---

## Operations checklist for growing from 70 to 200+

1. Keep one Hub and one row per body shop.
2. Keep one Engine and set `HUB_SPREADSHEET_URL` once.
3. Make sure the authorizing Google account can edit the Hub and every spoke.
4. Schedule enough runs so `ceil(Enabled shops / 50)` waves can finish before you need today’s data.
5. Keep `WRITE_WEEKLY_EVERY_RUN: false` in production.
6. Watch Hub **Run Log** for `PARTIAL` or `FAILED`.
7. Watch Hub **Alerts** for shop-level problems.
8. After the day’s waves, check **Last Successful Run**.
   - If a shop is still blank after all waves, that shop is still due or something is broken in routing or permissions.

---

## Alternatives we rejected, and why

| Approach | Why we reject it |
|---|---|
| Multiple Engine script copies | The code drifts. Schedules multiply. Bugs get fixed in one place and missed in another. |
| Multiple Hub sheets for every 50 shops | You lose one source of truth. Operators have to hunt across workbooks. |
| Trying to process more than 50 accounts in one parallel call | Google blocks it. |
| Only a manual Batch column | It can work, but people have to rebalance it every time shops are added. The due queue is automatic. |

A manual Batch column is not required. Priority is enough when a few VIP shops must run in the first wave.

---

## Final mental model

Use the same Hub. Use the same Engine script. Run that script more often as you grow. The Engine walks the due queue 50 shops at a time until the day is done.

Implementation lives in:

- `scripts/built-by-shah-mcc-engine.js`
- `apps-script/create-hub-workbook.gs`
