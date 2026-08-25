# Watch this for a full walkthrough — Shah explains Hub, Spoke, Engine, Cursor, Sheets, and how to edit

If you want to **see** how this system is connected — not only read about it — start with Shah’s video walkthrough.

## The video (in this repo)

**File:** [Watch this for a full walkthrough - Shah explains Hub Spoke Engine Cursor Sheets and how to edit.mp4](./Watch%20this%20for%20a%20full%20walkthrough%20-%20Shah%20explains%20Hub%20Spoke%20Engine%20Cursor%20Sheets%20and%20how%20to%20edit.mp4)

Open that file on your computer (Finder, VLC, QuickTime, or download from GitHub / Git LFS). It stays with this repository so the walkthrough does not get lost in someone’s Downloads folder.

## What Shah covers

This is Shah walking through the real Hub-and-Spoke Google Ads infrastructure end to end, including:

- How **Cursor**, the **repo**, **Google Sheets** (Hub + Spoke generators), and the **MCC Engine** script fit together
- How the pieces talk to each other in day-to-day operation
- How to make **adjustments, edits, and changes** later when the business needs them
- Things to **look out for** so you do not break Hub goals, spoke templates, or Engine scheduling by accident

## When you should watch it

Watch this video when you (or a teammate) are asking questions like:

- “How does Cursor and the Sheets infrastructure actually work together?”
- “Where do I change X later?”
- “What happened / how was this built?”
- “I need to edit Hub columns, spoke tabs, or Engine behavior — where do I start?”

After watching, use the written guides in this folder for precise install steps, scheduling rules, and checklists. The video is the big-picture tour; the markdown guides are the operator runbooks.

## Related written guides

- [Start here - what does each of these guides do.md](./Start%20here%20-%20what%20does%20each%20of%20these%20guides%20do.md) — map of every guide
- [Read this to understand the Hub Engine and Spoke sheets - system blueprint.md](./Read%20this%20to%20understand%20the%20Hub%20Engine%20and%20Spoke%20sheets%20-%20system%20blueprint.md) — written blueprint
- [Open this when you are ready to go live - install checklist gotchas and how to smoke test.md](./Open%20this%20when%20you%20are%20ready%20to%20go%20live%20-%20install%20checklist%20gotchas%20and%20how%20to%20smoke%20test.md) — go-live checklist
- [Read this before you change Hub or Spoke Sheets - how to upgrade without losing your work.md](./Read%20this%20before%20you%20change%20Hub%20or%20Spoke%20Sheets%20-%20how%20to%20upgrade%20without%20losing%20your%20work.md) — safe Sheet upgrades

## Note for clones / GitHub

The `.mp4` is stored with **Git LFS** because it is large (~543 MB). Anyone who clones the repo needs [Git LFS](https://git-lfs.com) installed so the real video downloads instead of a tiny pointer file.
