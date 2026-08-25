# Read this for the product requirements — what this system must do

**Project name:** Built by Shah – Enterprise Hub-and-Spoke Google Ads Automation

Open this file when you need the plain-language answer to: “What is this system supposed to do?”

Related guides:

- [Read this to understand the Hub Engine and Spoke sheets - system blueprint.md](./Read%20this%20to%20understand%20the%20Hub%20Engine%20and%20Spoke%20sheets%20-%20system%20blueprint.md)
- [Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md](./Read%20this%20for%20the%20technical%20plan%20to%20scale%20past%2050%20accounts%20with%20one%20Hub%20and%20one%20Engine.md)

---

## 1. What we are building

We are building a daily Google Ads MCC system that uses a **Hub-and-Spoke** design only.

In plain English, that means:

1. There is one central Hub spreadsheet for agency settings.
2. There is one MCC Engine script that reads the Hub and talks to Google Ads.
3. There is one separate Spoke spreadsheet for each body shop.
4. The Engine pulls performance numbers and writes them into each shop’s own Spoke Sheet.
5. The Engine can email managers a **Google Ads Account Status** briefing.

### What we must never build

Do not build one giant master spreadsheet that dumps every client’s campaign and keyword metrics into the same file.

That creates a mess, mixes clients together, and breaks the Hub-and-Spoke design.

---

## 2. The three main pieces

### A. The Hub

The Hub is the agency control panel.

The Engine must read the Hub to know:

- Which Google Ads accounts are active
- What the budgets and lead goals are
- Where each shop’s Spoke Sheet lives
- Who should get alerts and status emails

Important rule:

- People edit budgets, lead goals, and Target CPL on the **Hub only**.
- The Engine copies those goals into each spoke as green cells so formulas can work.
- People should not maintain a second editable copy of those goals on the spoke.

### B. The Engine

The Engine is the MCC Google Ads Script.

It must:

- Run at the MCC level
- Process many accounts with parallel execution
- Query Google Ads for daily and weekly performance data
- Sync Hub goals into each spoke Config
- Write metrics into the correct Spoke Sheet
- Catch errors one account at a time so one failure does not stop the whole batch
- Optionally send the Google Ads Account Status email

### C. The Spokes

Each active client gets one dedicated Google Sheet.

That Sheet should make it easy to see:

- Overall account health for the day
- Search campaign performance for the day
- Search keyword performance for the day
- Performance Max campaign performance for the day
- Weekly location performance
- Weekly device performance

Rules:

- Keep Search and Performance Max on separate tabs.
- Do not create a Search Ad Group Metrics tab.
- Do not create a PMax Asset Group Metrics tab.
- Do not create a PMax Keyword Metrics tab. PMax does not use classic keywords; campaign-level PMax metrics are enough.
- Newest daily and weekly metric rows must sit directly under the header (older history is pushed down).
- Each spoke includes a **Daily Checklist** tab (first tab) for the Google Ads manager’s manual daily checks. The Engine does not write that tab.

---

## 3. Core business rules

### Use the account’s own time zone

Never use UTC for “yesterday” or for pacing math.

Always use the Google Ads account time zone, which comes from:

`AdsApp.currentAccount().getTimeZone()`

Example: if a shop’s account time zone is America/Chicago, “yesterday” for that shop means Chicago yesterday, not UTC yesterday.

### Protect the math

When the system calculates CTR, CPC, CPL, or pacing, it must never divide by zero in a way that writes “NaN” into Sheets.

If there are no clicks or no conversions, the Sheet should show a safe blank or dash-style result instead of broken math.

### Daily and weekly cadence

The Engine runs every day.

- Write daily metrics on every successful run.
- Write weekly Location and Device roll-ups only on the configured weekday, usually Friday.

### Keep parallel writes safe

Because many accounts can process at the same time:

- Each account should write only to its own Spoke Sheet.
- Do not use one global lock that forces every shop to wait in a single line.
- Never overwrite yellow human-input cells or blue formula cells by accident.

### Stay polished and fail safely

- Sheets should look clean: frozen headers, currency formats, percent formats, readable layout.
- One failing account must never crash the whole batch.
- Failures must be logged and surfaced to managers.

---

## 4. Scale rule

If you grow past 50 accounts:

- Keep one Hub.
- Keep one Engine.
- Schedule that same Engine multiple times per day.
- Use the daily due queue described in the scale guide.

Do not create a new script or a new Hub for every group of 50 shops.

---

## 5. Who owns what

| Focus area | Main responsibility |
|---|---|
| Google Ads Script work | Engine logic, Google Ads queries, pacing, parallel runs, time zones, error handling |
| Google Sheets structure | Hub schema, spoke tabs, routing columns, generators |
| Google Sheets polish | Frozen headers, formats, clean dashboard layout |

Everyone working in this repo must keep Hub, Engine, and Spoke designs consistent with this requirements guide and the system blueprint.
