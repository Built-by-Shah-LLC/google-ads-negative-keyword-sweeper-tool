# Start here — what does each of these guides do?

This folder has guides that explain how to install and run the Built by Shah Hub-and-Spoke system.

You do not need to read every file at once. Open the one that matches what you need right now. The file name itself tells you when to open it.

---

## Quick map

| If you need this… | Open this file |
|---|---|
| A simple map of what each guide is for | **This file** (you are already here) |
| To **watch** Shah walk through how Cursor, Sheets, Hub, Spoke, and the Engine connect — and how to make edits later | [Watch this for a full walkthrough - Shah explains Hub Spoke Engine Cursor Sheets and how to edit.md](./Watch%20this%20for%20a%20full%20walkthrough%20-%20Shah%20explains%20Hub%20Spoke%20Engine%20Cursor%20Sheets%20and%20how%20to%20edit.md) (links to the `.mp4` in this folder) |
| To turn the system on for real, avoid common mistakes, and test safely | [Open this when you are ready to go live - install checklist gotchas and how to smoke test.md](./Open%20this%20when%20you%20are%20ready%20to%20go%20live%20-%20install%20checklist%20gotchas%20and%20how%20to%20smoke%20test.md) |
| To change or upgrade Hub or Spoke Sheets later without losing your typed work | [Read this before you change Hub or Spoke Sheets - how to upgrade without losing your work.md](./Read%20this%20before%20you%20change%20Hub%20or%20Spoke%20Sheets%20-%20how%20to%20upgrade%20without%20losing%20your%20work.md) |
| To understand why Google only updates 50 shops at a time, and why about 70 shops need two Engine runs each day | [Read this to schedule the Engine - why about 70 shops need two runs every day.md](./Read%20this%20to%20schedule%20the%20Engine%20-%20why%20about%2070%20shops%20need%20two%20runs%20every%20day.md) |
| To understand the technical plan for growing past 50 accounts while keeping one Hub and one Engine | [Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md](./Read%20this%20for%20the%20technical%20plan%20to%20scale%20past%2050%20accounts%20with%20one%20Hub%20and%20one%20Engine.md) |
| To understand what the Hub is, what the Engine is, and what each Spoke Sheet is for | [Read this to understand the Hub Engine and Spoke sheets - system blueprint.md](./Read%20this%20to%20understand%20the%20Hub%20Engine%20and%20Spoke%20sheets%20-%20system%20blueprint.md) |
| To understand what this whole system is supposed to do | [Read this for the product requirements - what this system must do.md](./Read%20this%20for%20the%20product%20requirements%20-%20what%20this%20system%20must%20do.md) |
| To install or operate the **Search / PMax negatives sweeper** (Hub on/off, spoke Reviewed/Remove, rule IDs) | [Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md](./Read%20this%20for%20the%20Search%20negatives%20sweeper%20-%20auto-add%20review%20and%20remove%20on%20the%20spoke.md) |
| To install the **standalone MCC negatives sweeper** (no Hub/Spoke — allowlist + morning email; run 90-day backfill once first for existing shops) | [Read this for the standalone MCC negatives sweeper - allowlist no Hub.md](./Read%20this%20for%20the%20standalone%20MCC%20negatives%20sweeper%20-%20allowlist%20no%20Hub.md) |
| To read a **plain-language HTML walkthrough** of the standalone negatives sweeper (rules + keyword examples) | [Open this in a browser - Standalone Negatives Sweeper explained.html](./Open%20this%20in%20a%20browser%20-%20Standalone%20Negatives%20Sweeper%20explained.html) |
| To read a printable **daily walkthrough PDF** of what the negatives sweeper does | [Daily Negatives Sweeper Walkthrough.pdf](./Daily%20Negatives%20Sweeper%20Walkthrough.pdf) (HTML source: [Daily Negatives Sweeper Walkthrough.html](./Daily%20Negatives%20Sweeper%20Walkthrough.html)) |
| To hand this to an AI coding agent (ChatGPT Codex) or a dev team and have them build **Built Ads Manager** — a real internal web app on a real database, with in-app alerts instead of email, employee-only Google login, and the architecture left entirely up to them | [Give this to Codex - full product brief to rebuild this system as a web app.md](./Give%20this%20to%20Codex%20-%20full%20product%20brief%20to%20rebuild%20this%20system%20as%20a%20web%20app.md) |
| To hand that same agent **every alert** — each trigger, threshold, and the full step-by-step next-step guidance — plus the visual design language of the status email to use as inspiration for the app’s interface | [Give this to Codex - every alert its next steps and the design language for the app UI.md](./Give%20this%20to%20Codex%20-%20every%20alert%20its%20next%20steps%20and%20the%20design%20language%20for%20the%20app%20UI.md) |
| To see what the morning status email looks like in a browser | [Open this in a browser to preview the Google Ads Account Status email.html](./Open%20this%20in%20a%20browser%20to%20preview%20the%20Google%20Ads%20Account%20Status%20email.html) |
| To show someone a simple sample (10 shops, 3 Needs attention, 7 Healthy) | [Sample status email - 10 shops with 3 needing attention.html](./Sample%20status%20email%20-%2010%20shops%20with%203%20needing%20attention.html) |

---

## Older file you should usually ignore

| File | Why it is here |
|---|---|
| [Older status email preview - superseded by the Google Ads Account Status preview.html](./Older%20status%20email%20preview%20-%20superseded%20by%20the%20Google%20Ads%20Account%20Status%20preview.html) | This is an old email design. Use the newer “Google Ads Account Status” preview instead. |

---

## Best order if this is your first time

Read the guides in this order:

1. **Shah’s video walkthrough** — watch how Cursor, Google Sheets, Hub, Spoke, and the Engine fit together, how to make changes later, and what to watch out for. Start with [Watch this for a full walkthrough…](./Watch%20this%20for%20a%20full%20walkthrough%20-%20Shah%20explains%20Hub%20Spoke%20Engine%20Cursor%20Sheets%20and%20how%20to%20edit.md).
2. **Product requirements** — learn what the system is supposed to do.
3. **System blueprint** — learn how Hub, Engine, and Spoke Sheets fit together (written detail after the video).
4. **Scheduling** — learn why you must schedule the Engine more than once if you have more than 50 shops.
5. **Go live checklist** — set everything up, test with 1 or 2 shops, then turn on production.
6. **Email preview** — optional. Open it in a browser if you want to see the email layout.
7. **Upgrade guide** — save this for later, when you need to change Sheet templates without losing Config work.

---

## Tiny picture of the system

Think of it like a school office:

- The **Hub** is the main office list. It says which shops are active, what their budgets and lead goals are, and where each shop’s Sheet lives.
- The **Engine** is the worker that reads that list every morning, updates each shop’s Sheet, and emails managers.
- Each **Spoke** is one shop’s own binder. It holds that shop’s numbers only.

Do not put every shop’s detailed keyword numbers into one giant shared Sheet. That is not how this system works.
