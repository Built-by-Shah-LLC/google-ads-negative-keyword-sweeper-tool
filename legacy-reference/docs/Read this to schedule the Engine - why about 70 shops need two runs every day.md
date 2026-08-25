# Read this to schedule the Engine — why about 70 shops need two runs every day

Open this file when you paste the MCC Engine into Google Ads Scripts, or when you wonder why some shops did not update today.

Also read:

- [Open this when you are ready to go live - install checklist gotchas and how to smoke test.md](./Open%20this%20when%20you%20are%20ready%20to%20go%20live%20-%20install%20checklist%20gotchas%20and%20how%20to%20smoke%20test.md) for the full production checklist
- [Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md](./Read%20this%20for%20the%20technical%20plan%20to%20scale%20past%2050%20accounts%20with%20one%20Hub%20and%20one%20Engine.md) for the deeper technical plan

---

## The one thing to remember right now

Google only lets the Engine process **50 accounts in one run**.

You currently have about **70** body shops. That means one run is not enough.

Schedule the Engine **at least twice every day**.

Google Ads only lets each Scripts row hold **one** Frequency (one Daily time window). To get two runs, add a second Scripts row with the identical Engine + same Hub URL for the next hour.

### Example schedule

- First run at **6:00 AM**
- Second run at **7:00 AM**

### What happens with that schedule

- The first run updates about the first 50 shops that are still due today.
- The second run updates the remaining shops that still need today’s update.

### What happens if you only schedule it once

About 20 shops will not get updated that day.

### What you do not need

- You do **not** need a second Hub spreadsheet.
- You do **not** need a forked Engine with a different account list (“shops 51–100”).
- You **may** need a second Scripts **row** that pastes the identical Engine, only so Google Ads can hold a second Daily Frequency. That is a second schedule, not a second system.

---

## How the automatic process works

Think of the Hub as a checklist of every shop.

1. Keep **all** shops in **one Hub** Config tab.
2. Make sure each live shop is set to **Enabled** and has a **Spoke Spreadsheet URL**.
3. Keep **one** Engine script in the MCC. The file in this repo is `scripts/built-by-shah-mcc-engine.js`.
4. Each time the Engine runs, it asks: “Which Enabled shops have not succeeded today yet?”
5. It uses the Hub column called **Last Successful Run** to answer that question.
   - The script fills this column.
   - You do not need to split shops into Batch A and Batch B by hand.
6. It takes the next group of shops, up to 50.
7. It updates those shops’ Spoke Sheets.
8. When a shop succeeds, it writes today’s date into **Last Successful Run**.
9. The next scheduled run of the **same** script picks up whoever is still due.
10. When everyone due today is finished, Hub **Run Log** can show `DAILY_CYCLE_COMPLETE`.

### Optional Priority column

If one shop must run earlier in the morning, put a higher number in **Priority**.

- Example: Priority `100` runs before Priority `10`.
- If you leave Priority blank, the Engine treats it as `0`.

---

## A simple mental picture

Imagine a dishwasher that only fits 50 plates.

- All 70 plates live in one kitchen. That kitchen is the Hub.
- Each Engine run washes the next dirty group of up to 50 plates.
- You start the dishwasher a few times until every dirty plate is clean for the day.
- Tomorrow, the “needs washing today” list rebuilds automatically.

That is why more shops means more runs of the **same** script, not a new script.

---

## What to set up in Google Ads

1. Open your MCC.
2. Go to **Tools and settings → Bulk actions → Scripts**.
3. Paste the Engine script.
4. Confirm `HUB_SPREADSHEET_URL` points at your live Hub (already set in this repo’s Engine).
5. Open **Frequency / schedule** for that same script.
6. Schedule enough runs for your shop count.

| Number of Enabled shops | How often to schedule the same script |
|---|---|
| 50 or fewer | Once per day |
| About 70 (your current size) | At least twice per day |
| About 100 | Twice, or three times if you want extra safety |
| About 200 | About four times, for example once an hour for four hours |

### Important: Google only lets each Scripts row have one Frequency

In the Frequency popover you will only see **one** setting, for example:

- Left: **Daily**
- Right: **4:00 AM – 5:00 AM**

That is normal. Google Ads does **not** let one script row run at 6:00 and again at 7:00 from the same Frequency box.

### How to get two (or more) runs per day

Use **two Scripts rows that both contain the same Engine** and point at the **same Hub**.

They are not two different systems. They are two schedules that share one Hub due queue (`Last Successful Run`).

1. Keep your current script: **BUILT BY SHAH – MCC Hub-and-Spoke Engine**.
2. Set its Frequency to **Daily**, first window (example: **6:00 AM – 7:00 AM**). Click **Save**.
3. Click **+** to create another script.
4. Paste the **exact same** Engine code again (same `HUB_SPREADSHEET_URL`).
5. Name it clearly, for example: **BUILT BY SHAH – MCC Hub-and-Spoke Engine (wave 2)**.
6. Set Frequency to **Daily**, next window (example: **7:00 AM – 8:00 AM**). Click **Save**.
7. Enable both scripts.

What happens:

- Wave 1 updates about the first 50 shops still due today.
- Wave 2 updates the remaining shops still due today.
- Both write to the same Hub. Do not split shops into Batch A / Batch B by hand.

### What this is not

- Do **not** invent a second Hub spreadsheet.
- Do **not** put different account lists inside each script.
- Do **not** change `MAX_ACCOUNTS` above 50.

### Optional: one script on Hourly instead

If you prefer a single Scripts row, set Frequency to **Hourly**.

- Early hours process due shops (up to 50 per run).
- Later hours usually find nobody left due and exit quickly (`DAILY_CYCLE_COMPLETE`).
- This works, but it creates more script history noise than two Daily waves.

### How to prove every shop finished

- Check Hub **Run Log**.
- Check **Last Successful Run** on the Hub Config tab.
- After the day’s runs, most Enabled shops should show today’s date.

---

## What you should not do

- Do not create a new script every time you add 50 shops.
- Do not create a new Hub every time you add 50 shops.
- Do not manually maintain forever lists called Batch A, Batch B, and Batch C.

The 50-at-a-time limit is handled inside the Engine and Hub. Your recurring job is simple: schedule enough runs of the same Engine each day.
