# Give this to Codex — every alert, its next steps, and the design language for the app UI

**Companion to:** `Give this to Codex - full product brief to rebuild this system as a web app.md`
**Product:** **Built Ads Manager** — an internal web application for the staff of one marketing agency that runs Google Ads for auto body shops.
**What this file is for:** two things, and they are separate.

1. **Part A (Sections 1–9) is a hard specification.** It is the complete alert catalog: every condition that must be detected, the exact numbers behind it, the message the account manager reads, and the full step-by-step guidance the software must give them. This copy is the product. It took years of running this business to write. Ship it as written.

2. **Part B (Sections 10–13) is a design reference, not a requirement.** Before this application existed, the same daily briefing was delivered as a formatted document. That document's visual language — its colors, hierarchy, and the way it made a long list of problems feel scannable and calm — is what the owner wants the web interface to feel like. **Do not rebuild that document. Do not build email.** Translate the design *theory* into a modern web interface.

> **A note on the word "email."** Part B refers to a design that was originally rendered as an email. Version one of Built Ads Manager sends **no email at all** — every alert below is delivered inside the application (see Section 9 of the main brief). The email framing is preserved here only because the owner may want an email channel someday and wants the design captured before it is lost. Build the interface. Ignore the delivery mechanism.

---

## Table of contents

**Part A — the alerts**

1. The alert data contract (non-negotiable shape)
2. Alert catalog at a glance
3. Alert-by-alert specification
4. Watch-level guidance (the softer variant)
5. The Healthy state
6. The 30-day guarantee surface
7. Alert lifecycle, deduplication, and history
8. Copy rules and tone
9. Things that must be configurable

**Part B — the design language**

10. Why the old design worked
11. The visual system (colors, type, layout, components)
12. An annotated example
13. What to steal, what to leave behind, and how to verify

---
---

# PART A — THE ALERTS

---

## 1. The alert data contract

Every alert in this system is an object with the same shape. **This is the single most important requirement in this document.** The reason the previous system was trusted is that no alert was ever allowed to be a bare sentence like *"CPL is high."* Every single one arrived with an explanation, the real numbers, an ordered checklist, and a warning about the most common wrong reaction.

```
Alert {
  type            stable machine code, e.g. ZERO_SPEND
  account         which client account
  severity        Needs attention | Watch
  message         one human sentence containing the real, formatted numbers
  guidance {
    title         what happened, in plain English, about five words
    meaning       one or two sentences explaining what it means and why it matters,
                  written for a competent person who is busy — no jargon
    facts         the actual numbers behind the alert, so nobody has to go look them up
    checks[]      an ORDERED list of specific things to examine, in the sequence a
                  skilled practitioner would examine them
    remember      the judgment call or the caveat — usually a warning against the
                  most common destructive knee-jerk reaction
  }
  firstSeenAt     when the condition was first detected
  lastSeenAt      most recent detection
  occurrenceCount how many consecutive days it has persisted
  state           open | acknowledged | snoozed | resolved | auto-resolved
}
```

### Rules that follow from this contract

1. **`guidance` is never optional and never collapses to a string.** If a new alert type is added without a full guidance block, that should be a build failure, not a runtime surprise. There is a generic fallback (Section 3.16) but it exists for defensive safety, not as an excuse to skip writing real guidance.

2. **`checks` is ordered and the order is meaningful.** It is diagnostic sequence, not a bag of ideas. In almost every alert below, verifying that measurement still works comes *before* changing anything, because in this business "we got no leads" turns out to be "our lead tracking broke" more often than it turns out to be "our advertising stopped working." Preserve the order exactly.

3. **`facts` must contain real, formatted numbers** — currency with a symbol and thousands separators, percentages to one decimal place, counts as integers. Never render a raw float. Never render `NaN`, `Infinity`, `undefined`, or `null`; when a value genuinely cannot be computed, render an em dash (`—`).

4. **`message` is a complete sentence with the numbers inline.** It has to survive being read out of context — in a notification, in a list, in a search result.

5. **The same alert type can render different guidance depending on context.** Budget-off-pace is the clearest case: being *over* budget and being *under* budget are the same alert type but almost opposite instructions. Design for guidance that varies on the alert's own data.

---

## 2. Alert catalog at a glance

Fifteen types. Every one of them was added because a real account lost real money while nobody was looking.

| # | Type code | Fires when | Default threshold | Severity |
|---|---|---|---|---|
| 1 | `ZERO_SPEND` | Yesterday had zero cost **and** zero impressions **and** zero clicks, while a daily budget exists | any daily budget > 0 | Needs attention |
| 2 | `ZERO_CONVERSIONS_YESTERDAY` | Yesterday had spend but zero conversions | — | Needs attention |
| 3 | `SPEND_NO_CONVERSIONS` | Month-to-date spend ≥ threshold **and** month-to-date conversions = 0 | **$200** | Needs attention |
| 4 | `BUDGET_OFF_PACE` | Spend pace outside tolerance, in either direction | **±15%** | Needs attention |
| 5 | `LEADS_OFF_PACE` | Lead pace below tolerance and past the new-campaign grace window | **−15%**, **7-day grace** | Needs attention |
| 6 | `HIGH_CPL` | Month-to-date cost per lead above target × multiplier | **1.5×** target CPL | Needs attention |
| 7 | `UNCONFIGURED` | Required goal fields are missing, so pacing cannot be trusted | — | Needs attention |
| 8 | `AD_DISAPPROVED` | An enabled ad in an enabled ad group in an enabled campaign is not approved | — | Needs attention |
| 9 | `WASTE_14D_KEYWORD` | One keyword spent ≥ threshold over 14 days with zero conversions | **$50 / 14 days** | Needs attention |
| 10 | `WASTE_14D_AD_GROUP` | Same rule at ad-group level | **$50 / 14 days** | Needs attention |
| 11 | `WASTE_14D` | Generic waste fallback when the pocket cannot be attributed precisely | **$50 / 14 days** | Needs attention |
| 12 | `LOCATION_WASTE` | A geographic target produced ≥ 20 clicks and zero conversions over 30 days | **20 clicks / 30 days** | Needs attention |
| 13 | `DEVICE_HIGH_CPA` | One device type's cost per lead exceeds the ceiling over 30 days | **$100** | Needs attention |
| 14 | `SYNC_FAILURE` | The nightly data pull could not complete for this account | — | Needs attention |
| 15 | `NEEDS_ATTENTION` | Health is red but no specific typed alert fired — the catch-all | — | Needs attention |

Two structural notes:

- **`LOCATION_WASTE` uses a click threshold, not a spend threshold.** This is deliberate and is not a mistake to "fix." Twenty clicks with zero leads is a meaningful signal regardless of how cheap those clicks were, because it says the geography is wrong, not that the bidding is wrong.
- **`NEEDS_ATTENTION` must always be able to fire.** Individual alert types can be switched off per account. If every switch is off and the account is still unhealthy, the catch-all is what prevents an account from going quietly dark. Never let configuration produce a red account with no alert.

Additionally, the system tracks several **Watch-level** conditions that are real signals but do not warrant a typed alert on their own: budgets that are being *estimated* rather than configured, change history that failed to load, and a soft Google optimization score. These are covered in Section 4.

---

## 3. Alert-by-alert specification

For each alert: the trigger, the math, the `facts` template, the `message` template, and the complete guidance block. **The guidance text below is the canonical copy. Use it verbatim.**

Placeholder convention: `{money}` renders as `$1,234.56`, `{percent}` as `87.3%`, `{count}` as an integer.

---

### 3.1 `ZERO_SPEND` — Ads did not run yesterday

**Trigger.** Yesterday's cost ≤ 0 **and** impressions ≤ 0 **and** clicks ≤ 0, while the account has a configured daily budget greater than zero. All three must be zero — an account that got impressions but no clicks is serving, and is not this alert.

**Why it exists.** This is the most urgent alert in the system. Every hour an account is dark is unrecoverable lead volume, and the client is still paying a management fee. It is also the alert most likely to have a stupid, fixable cause: an expired credit card.

**Facts:**
> Yesterday: {money} spend, {count} impressions, {count} clicks. Configured daily budget: {money}.

**Message:**
> No delivery yesterday — actual spend {money}, impressions {count}, clicks {count} (configured daily budget {money}).

**Guidance**

- **Title:** Ads did not run yesterday
- **What this means:** Google did not show ads for this shop yesterday, so nobody clicked and nothing was spent. That usually means something is paused, out of money, blocked, or not set up to show.
- **Check these things:**
  1. Open Google Ads for this account (use the button below).
  2. Look at Campaigns. Are the main Search / Performance Max campaigns set to Enabled? If any say Paused, find out why and turn the right ones back on.
  3. Click into each active campaign and check Budgets. Is the daily budget above $0? Did the campaign hit a shared budget cap?
  4. Check Billing (Tools & settings → Billing). Is there a payment problem, failed card, or unpaid invoice?
  5. Open Notifications / Policy manager. Are there account holds, payment holds, or policy bans that stop ads?
  6. Check targeting: location (still covering the shop's service area?), schedule (ads allowed to run yesterday?), and language.
  7. For Search: are keywords still Enabled? For Performance Max: are asset groups Enabled with enough assets?
  8. If everything looks on, check whether yesterday was a holiday/closure day or if the client asked to pause spend.
- **Remember:** Fix the blocker first (billing, pause, policy). Then watch spend today to confirm ads are showing again. Tell the CSM if the shop asked for a pause.

---

### 3.2 `ZERO_CONVERSIONS_YESTERDAY` — Spent money, got zero leads yesterday

**Trigger.** Yesterday's cost > 0 **and** yesterday's primary conversions = 0.

**Why it exists.** A single zero-lead day is often normal noise for a small account. But it is also the first visible symptom of broken conversion tracking, and broken tracking left alone for a week produces a catastrophic month. Surfacing it daily makes the difference between a one-day blip and a two-week disaster.

**Facts:**
> Yesterday spend: {money}. Clicks: {count}. Impressions: {count}. Conversions: 0.

**Message:**
> Spent yesterday with zero conversions — {money} spend, {count} clicks, {count} impressions, 0 conversions.

**Guidance**

- **Title:** Ads spent money but got zero leads yesterday
- **What this means:** People saw and/or clicked the ads, but Google did not count any phone calls or form leads yesterday. Either tracking broke, the landing page broke, or traffic was too weak/wrong.
- **Check these things:**
  1. Open Google Ads → Goals / Conversions. Are the phone and form conversion actions still Enabled and recording recently?
  2. Click a few ads and open the landing page yourself on phone and desktop. Does the page load? Do the call button and form still work?
  3. Check CallRail (or the call tracker). Did any calls come in yesterday? If yes in CallRail but zero in Google Ads, the link between CallRail and Google Ads is broken.
  4. Check GoHighLevel / the form CRM. Did any form leads arrive? If yes in the CRM but zero in Google Ads, the form conversion tag or webhook is broken.
  5. In Google Ads, open search terms / insights for yesterday. Was traffic clearly irrelevant (wrong city, wrong intent)?
  6. Confirm Built Ads Manager lists the correct Phone / Form conversion action names for this shop.
  7. Look at ad disapprovals or limited ads that may have sent weak traffic.
- **Remember:** If tracking is broken, pause big budget changes until leads count again. If tracking is fine, improve relevance (keywords, ads, landing page) next.

---

### 3.3 `SPEND_NO_CONVERSIONS` — Spent a lot this month with no leads yet

**Trigger.** Month-to-date cost ≥ the zero-conversion spend threshold (default **$200**, configurable per account) **and** month-to-date primary conversions = 0.

**Why it exists.** This is the escalated version of 3.2. One dead day is noise; $200 of dead spend is a crisis. This alert is the one that most often reveals that a conversion action was accidentally set to secondary, or that a landing page was redesigned without the tracking being reinstalled.

**Facts:**
> MTD spend: {money}. MTD conversions: 0. Alert threshold: {money}.

**Message:**
> Meaningful MTD spend with zero primary conversions — spent {money} with 0 conversions (threshold {money}).

**Guidance**

- **Title:** Spent a lot this month with no leads yet
- **What this means:** This shop has already spent enough money this month that we expect at least some leads, but Google still shows zero primary conversions. Treat this as urgent: either tracking is off or the funnel is not working.
- **Check these things:**
  1. Compare Google Ads conversions to CallRail and GoHighLevel for the same month-to-date window. Do outside tools show leads that Google is missing?
  2. Re-check every primary conversion action (calls + forms). Make sure they are primary, Enabled, and not accidentally removed or set to secondary-only.
  3. Test the live landing page: call tracking number, form submit, thank-you page, and tag firing (Tag Assistant / CallRail test).
  4. Confirm the phone/form conversion action names in Built Ads Manager match what exists inside this Google Ads account.
  5. Review search terms and PMax insights: is spend going to junk queries or wrong cities?
  6. Check whether campaigns recently restarted, changed landing pages, or swapped conversion goals.
  7. If spend is high and tracking is proven broken, pause or sharply cut budget until tracking is fixed so we stop flying blind.
- **Remember:** Do not "optimize keywords" first if conversions are not recording. Prove tracking works, then improve quality.

---

### 3.4 `BUDGET_OFF_PACE` — Spend is off plan

**Trigger.** Spend pace = month-to-date spend ÷ expected spend by today. Fires **over** when pace > 1 + tolerance, **under** when pace < 1 − tolerance. Default tolerance **0.15** (±15%), configurable per account.

**This alert has two completely different guidance blocks.** Select on direction. Getting this wrong — telling someone to raise budgets when they are already overspending — destroys trust in the whole system instantly.

**Facts (both directions):**
> Actual MTD spend: {money}. Expected by today: {money} ({percent} of pace). Configured monthly budget: {money}. Configured daily budget: {money}.

**Message:**
> Monthly spend is {over pace | under pace} — actual MTD {money} vs expected {money} by today ({percent} of pace); configured monthly budget {money}.

#### 3.4a Under pace

- **Title:** Spend is behind where it should be this month
- **What this means:** Based on the configured monthly budget and today's date, this shop should have spent more by now. Ads may be limited, under-budgeted, or not winning enough auctions.
- **Check these things:**
  1. Open the account's goal settings and confirm Monthly Budget / Daily Budget are still the agreed numbers.
  2. In Google Ads, check campaign daily budgets and shared budgets. Are they too low to hit the monthly plan?
  3. Look for "Limited by budget," learning limits, or payment issues that slow delivery.
  4. Check location, schedule, and bid strategy. Did someone narrow targeting or lower bids?
  5. Review impression share / lost IS (budget) and lost IS (rank) if available.
  6. Make sure key campaigns are Enabled and not stuck in a long learning reset.
  7. If the client reduced spend on purpose, update the budgets in Built Ads Manager so pacing matches reality.
- **Remember:** If you raise budgets, do it in controlled steps and tell the CSM. Do not blindly 2x spend in one day.

#### 3.4b Over pace

- **Title:** Spend is ahead of where it should be this month
- **What this means:** This shop is burning budget faster than the monthly plan for this point in the month. If nothing changes, it may run out of money early or overspend the agreement.
- **Check these things:**
  1. Open the account's goal settings and confirm the Monthly Budget is correct (sometimes the configured number is outdated).
  2. In Google Ads, lower daily budgets or shared budgets so the rest of the month is covered.
  3. Check for a recent bid strategy change, broad match expansion, or PMax spike that accelerated spend.
  4. Look at search terms / insights: is a wasteful theme driving the overspend?
  5. Confirm there is no duplicate campaign or unexpected Enabled campaign stacking spend.
  6. If overspend is already large, message the CSM and agree on a temporary daily cap today.
- **Remember:** Fix the configured number if the plan changed. Otherwise slow delivery now so the month finishes evenly.

---

### 3.5 `LEADS_OFF_PACE` — Lead count is behind the monthly goal

**Trigger.** Lead pace = month-to-date conversions ÷ expected leads by today, below 1 − tolerance, **and** the account is past its grace window.

**The grace window matters.** For the first **7 days** after an account's campaign start date, lead pace is measured and displayed but does **not** raise this alert. A brand-new campaign is in Google's learning phase and will always look behind. Alerting on it trains people to ignore alerts. The condition is still visible in the interface as a Watch-level note (Section 4) — it simply does not escalate.

**Facts:**
> Actual MTD leads: {count}. Expected by today: {count} ({percent} of pace). Monthly lead goal: {count}.

**Message:**
> Lead volume is under pace — actual {count} leads MTD vs expected {count} by today ({percent} of pace); monthly lead goal {count}.

**Guidance**

- **Title:** Lead count is behind the monthly goal
- **What this means:** Based on the monthly lead goal and today's date, this shop should have more leads by now. Something is limiting lead volume, lead quality tracking, or both.
- **Check these things:**
  1. Confirm the Monthly Lead Goal is still the real goal for this shop.
  2. Check conversion tracking first (CallRail + forms). Behind "leads" is sometimes just broken counting.
  3. Review yesterday and last-7-day search terms. Add negatives for junk; protect strong money terms.
  4. Check ad strength, landing page speed, and whether the offer/message still matches what people search.
  5. Look at impression share and budget limits — maybe the account cannot show enough to hit the goal.
  6. For PMax: review asset group strength, audience signals, and whether brand cannibalization is hiding true lead pace.
  7. If still behind after tracking is verified, schedule a short CSM meeting with a clear ask (budget, offer, or geo).
- **Remember:** New campaigns get a short grace window. After that, behind pace needs a real plan, not hope.

---

### 3.6 `HIGH_CPL` — Cost per lead is too high

**Trigger.** Month-to-date CPL > target CPL × high-CPL multiplier. Default multiplier **1.5**, configurable per account. The multiplier exists so that a shop with a $60 target does not get alerted at $62 — only at $90, where it is genuinely a problem.

**Facts:**
> Actual MTD CPL: {money}. Target CPL: {money}. From {money} spend / {count} conversions.

**Message:**
> CPL is above target — actual {money} vs Target CPL {money} (MTD {money} / {count} conversions).

**Guidance**

- **Title:** Cost per lead is too high
- **What this means:** Each counted lead is costing more than the Target CPL. We are paying too much for the leads we are getting, or counting weak leads.
- **Check these things:**
  1. Confirm the Target CPL on file is still what the shop agreed to.
  2. Split phone vs form CPL if possible. Which lead type is expensive?
  3. Open search terms. Pause or negative out expensive junk queries that rarely become real jobs.
  4. Review keyword match types and close variants that drag CPL up.
  5. Check ads and landing pages: clear offer, strong call button, form above the fold, correct city/service copy.
  6. Review location and schedule: late-night or out-of-area clicks often raise CPL.
  7. Check lead quality with the CSM/client. If Google "leads" are tire-kickers, fix messaging and targeting — not just bids.
- **Remember:** Lower CPL by cutting waste and improving conversion rate first. Cutting budget alone does not fix a high CPL.

---

### 3.7 `UNCONFIGURED` — Goals are missing for this shop

**Trigger.** Required goal fields are missing: no daily budget and/or no monthly budget on record, and none derivable.

**Why it exists.** Every pacing calculation in the system divides by these numbers. An account without them is not "fine," it is **unmeasured** — which looks identical to fine on a dashboard and is the most dangerous state an account can be in. This alert makes the absence of data as loud as bad data.

**Facts:**
> Daily Budget: {money | missing}. Monthly Budget: {money | missing}. Monthly Lead Goal: {count | missing}. Target CPL: {money | missing}.

**Message:**
> Budget goals are missing or incomplete for this account. {facts}

**Guidance**

- **Title:** Goals are missing for this shop
- **What this means:** This account is missing budget or lead goal numbers we need to judge pacing. Without those numbers, alerts and pacing can be wrong.
- **Check these things:**
  1. Open this account's settings in Built Ads Manager.
  2. Fill Daily Budget (average daily media budget).
  3. Fill Monthly Budget (true monthly media budget).
  4. Fill Monthly Lead Goal and Target CPL.
  5. Save. The numbers take effect on the next evaluation.
- **Remember:** Goals live in exactly one place. Never keep a second set of budgets anywhere else — two sources of truth means neither is trusted.

---

### 3.8 `AD_DISAPPROVED` — An ad is blocked by Google policy

**Trigger.** An **enabled** ad, in an **enabled** ad group, in an **enabled** campaign, has an approval status other than approved. Only enabled entities count — a disapproved ad inside a paused campaign is not costing anything and is not worth waking anyone up for.

**Facts / Message:**
> Ad {id} in {campaign name} / {ad group name} has approval status {status}.

**Guidance**

- **Title:** An ad is blocked by Google policy
- **What this means:** At least one ad is not fully approved, so it may not show (or may show in a limited way). That can kill delivery for a whole ad group or asset group.
- **Check these things:**
  1. Open Google Ads → Campaigns → Ads (or Policy manager).
  2. Find the disapproved / limited ad named in this alert.
  3. Read the policy reason in plain language (misrepresentation, trademark, restricted service, etc.).
  4. Edit the ad text, URL, or assets to remove the problem. Or create a clean replacement ad and keep the old one paused.
  5. If you believe Google is wrong, use Appeal — but still launch a safe backup ad so delivery does not sit at zero.
  6. After fixing, confirm status moves to Eligible / Approved and that the ad group still has another strong ad running.
- **Remember:** Never leave an ad group with only disapproved ads. Always have at least one approved ad live.

---

### 3.9 `WASTE_14D_KEYWORD` — A keyword spent money with no leads

**Trigger.** A single keyword spent ≥ the waste threshold (default **$50**) over a rolling **14-day** window with zero conversions.

**Why 14 days.** Long enough that a low-volume body shop keyword has had a genuine chance to convert; short enough that the waste is still current and worth acting on.

**Facts / Message:**
> Keyword "{keyword}" in {campaign} / {ad group} spent {money} with 0 conversions over the last 14 days (waste threshold {money}).

**Guidance**

- **Title:** A keyword spent money with no leads
- **What this means:** Over the last 14 days, this keyword spent past the waste threshold and got zero conversions. It may be irrelevant, too broad, or sending bad traffic.
- **Check these things:**
  1. Open the keyword from this alert and review its search terms for the same dates.
  2. Add negatives for clearly useless queries (jobs, DIY, wrong city, free, etc.).
  3. Check match type. If Broad is dumping junk, tighten to Phrase/Exact for the money terms.
  4. Confirm the landing page matches the keyword intent.
  5. If the keyword is off-offer for this body shop, pause it.
  6. Before pausing a big keyword, quick-check with an account lead if it is a strategic brand/conquest term.
- **Remember:** Fix search terms first. Pausing everything without negatives often just moves waste somewhere else.

---

### 3.10 `WASTE_14D_AD_GROUP` — An ad group spent money with no leads

**Trigger.** The same rule as 3.9, evaluated at ad-group level.

**Facts / Message:**
> Ad group "{ad group}" in {campaign} spent {money} with 0 conversions over the last 14 days (waste threshold {money}).

**Guidance**

- **Title:** An ad group spent money with no leads
- **What this means:** This whole ad group spent past the waste threshold over 14 days with zero conversions. The theme, ads, or landing page may be wrong.
- **Check these things:**
  1. Open the ad group and review search terms / keywords inside it.
  2. Check ads: are they approved, specific, and selling the right service?
  3. Click the landing page from the ad. Does it match the ad group theme?
  4. Look for one bad keyword driving most of the spend; fix or pause that first.
  5. If the whole theme is wrong for this shop, pause the ad group after a quick check with an account lead.
- **Remember:** Prefer surgical fixes (one keyword, one negative list) over pausing a whole ad group when part of it still works.

---

### 3.11 `WASTE_14D` — Generic waste fallback

**Trigger.** Waste is detected but cannot be cleanly attributed to a specific keyword or ad group.

**Facts / Message:** Whatever detail is available about the waste pocket.

**Guidance**

- **Title:** Spend with no leads in the last 14 days
- **What this means:** Part of this account spent money for two weeks without conversions. Find the waste pocket and clean it up.
- **Check these things:**
  1. Open the alert details and jump to the keyword or ad group named.
  2. Review search terms and add negatives.
  3. Confirm landing page and conversion tracking still work.
  4. Pause only after you know the traffic cannot become jobs for this shop.
- **Remember:** Ask an account lead before large pauses that change account structure.

---

### 3.12 `LOCATION_WASTE` — A location got clicks with no leads

**Trigger.** A geographic target (zip, city, metro, region) produced ≥ **20 clicks** with **zero conversions** over the last **30 days**. Measured on *physical presence*, not "interest in" — people who were actually there.

**Why a click threshold, not a spend threshold.** The question this alert answers is "are we advertising in the wrong place," and geography is about volume of wrong people, not dollars. Twenty clicks and no leads from a town says the shop does not serve that town, whether those clicks cost $40 or $400.

**Facts / Message:**
> Location "{location}" (people in that location) in {campaign} had {count} clicks and 0 conversions over the last 30 days (spend {money}).

**Guidance**

- **Title:** A location got clicks with no leads
- **What this means:** Over the last 30 days, people physically in this location (zip, city, metro, region, or other Google geo target) clicked at least 20 times and still got zero conversions. It may be outside the shop's real service area, or the offer/page is weak for that geo.
- **Check these things:**
  1. Confirm whether this location is inside the shop's true service area with the CSM/client.
  2. In Google Ads → Locations, open the zip/city/metro from this alert and confirm Presence (not only Interest).
  3. If clearly out of area, plan an exclusion — but get account-lead approval before excluding large geos.
  4. If in-area, check landing page/local messaging and call tracking for that geo instead of excluding.
  5. Compare nearby zips/cities to see if this is one bad pocket or a wider trend.
- **Remember:** Do not mass-exclude locations without a human check. Wrong exclusions can wipe good coverage.

---

### 3.13 `DEVICE_HIGH_CPA` — One device type is too expensive

**Trigger.** A device segment's cost per conversion exceeds **$100** over 30 days, while having at least one conversion. (Zero-conversion devices are covered by the spend-with-no-conversions alerts; this one is specifically about *expensive* leads, which requires a denominator.)

**Facts / Message:**
> Device {device} CPA {money} is above $100 (last 30 days ({start} → {end})).

**Guidance**

- **Title:** One device type is too expensive
- **What this means:** On this device (mobile, desktop, or tablet), cost per lead is above our threshold. The page or bids may work badly on that device.
- **Check these things:**
  1. Open the landing page on that device yourself. Is the call button easy? Is the form hard to use?
  2. Compare conversion rate by device for the last 30 days.
  3. Check if a device bid adjustment is already too aggressive.
  4. Fix the page/experience first when mobile is weak.
  5. Only change device bids after review with an account lead if the gap stays large.
- **Remember:** A bad mobile page looks like a "bid problem." Fix the page before cutting mobile hard.

---

### 3.14 `SYNC_FAILURE` — The account could not be processed

**Trigger.** The nightly data pull failed for this account, or the account was scheduled for processing and produced no result at all.

**Why it exists.** The single worst failure mode for a monitoring system is silently monitoring nothing. An account whose data did not refresh will render as "no problems" unless the absence of data is itself an alert. **This alert must fire regardless of any per-account alert switches** — an operator turning off alerts must never be able to hide a broken pipeline.

**Facts / Message:** The underlying error text, or:
> Selected for processing but returned no result. Confirm the account is still active and correctly linked.

**Guidance**

- **Title:** Data sync failed on this account
- **What this means:** The nightly refresh could not finish updating this shop. Its numbers and alerts may be stale until it succeeds.
- **Check these things:**
  1. Read the error message on the run history screen.
  2. Confirm the account is still correctly linked and that Built Ads Manager still has read access.
  3. Confirm the account is still active under the manager account and has not been cancelled.
  4. Re-run the sync for this account after fixing access issues.
  5. If it keeps failing, send the error to the technical owner before tomorrow's briefing.
- **Remember:** One failed account should not stop the rest of the batch — but this shop still needs a manual look today.

---

### 3.15 `NEEDS_ATTENTION` — Catch-all

**Trigger.** Health evaluates to "Needs attention" but no typed alert fired. Usually because the specific alert types were switched off, or a condition was detected that has no dedicated type yet.

**Facts / Message:** The detected attention items, joined. Falls back to the literal text `Needs attention`.

**Guidance**

- **Title:** This shop needs a human look today
- **What this means:** The health checks flagged a problem even if a more specific alert type did not fire. Start with the account's own numbers, then Google Ads.
- **Check these things:**
  1. Open the account page and read the current metrics and active alerts.
  2. Compare yesterday's spend, clicks, and conversions to a normal day for this shop.
  3. Open Google Ads Overview and scan Notifications, policy, and campaign status.
  4. Check CallRail / forms if conversions look wrong.
  5. Write what you found and the fix in the resolution note when you close this out.
- **Remember:** Use the quick links on this card so you do not hunt for the account.

---

### 3.16 Generic fallback — unknown alert type

Defensive only. If an alert type ever reaches the interface without registered guidance, render this rather than an empty box. **Log it as a defect.**

- **Title:** Review this account today
- **What this means:** Something needs a human check. Open the account, find what changed, and fix the root cause.
- **Check these things:**
  1. Open Google Ads for this shop.
  2. Open the account page and read the latest metrics.
  3. Fix tracking, delivery, or waste based on what you find.
  4. Tell the CSM if the client needs an update.
- **Remember:** Mark the alert resolved only after you actually handled it.

---

## 4. Watch-level guidance — the softer variant

Not everything that is off is on fire. Accounts sitting at **Watch** get guidance too, but with a different voice: investigate soon, do not panic, do not make big changes yet.

Watch guidance is **composed**, not selected. An account can be drifting in several ways at once, and the guidance assembles from whichever conditions are present.

### 4.1 Composition rules

1. Evaluate every condition below. For each one present, append its title, its meaning sentence, and its checks.
2. **Deduplicate checks while preserving first-appearance order.** Overlapping conditions produce overlapping advice, and a checklist that says the same thing three times is a checklist nobody finishes.
3. Build the combined title:
   - one condition → use its title
   - two conditions → join with a middle dot: `Title one · Title two`
   - three or more → collapse to a summary title: **"This shop has a few Watch issues"**, or **"This shop has a few issues that need a look"** if the account is actually red
4. Join the meaning sentences with a space.
5. Select one `remember` line by the priority ladder in 4.4.

### 4.2 The Watch conditions and their copy

| Condition | Title | What this means |
|---|---|---|
| No delivery | Ads may not have run yesterday | This shop shows no spend, impressions, or clicks yesterday. Something may be paused, out of money, or blocked. |
| Spent MTD, no leads | Spent a lot this month with no leads yet | This shop has already spent enough money this month that we expect at least some leads, but Google still shows zero primary conversions. Tracking may be broken or the funnel is not working. |
| Zero leads yesterday | Spend happened with zero leads yesterday | Ads spent money yesterday, but Google counted no conversions. Tracking may be broken, or traffic quality was weak. |
| Under spend | Monthly spend is behind plan | Based on the monthly budget and today's date, this shop should have spent more by now. Ads may be limited or not winning enough auctions. |
| Over spend | Monthly spend is ahead of plan | This shop is burning budget faster than the monthly plan. If nothing changes, it may run out of money early. |
| Lead behind (past grace) | Lead count is behind the monthly goal | Based on the monthly lead goal and today's date, this shop should have more leads by now. |
| Lead behind (in grace) | Lead count is behind the monthly goal | Lead pace is behind goal, but this shop is still inside the 7-day new-campaign grace window — watch closely, do not panic-change everything yet. |
| High CPL | Cost per lead is too high | Each counted lead is costing more than the Target CPL. We are paying too much for the leads we are getting. |
| Unconfigured | Goals are incomplete | Budget or lead goal fields are missing, so pacing can be wrong. |
| Estimated budget | Budgets are estimated, not configured | Daily or monthly budget is being estimated from campaign settings instead of the agreed numbers. Pacing alerts may not match the real client agreement. |
| Change history unavailable | Change history could not be loaded | We could not pull recent Google Ads change history for this shop, so we may be missing who changed bids, budgets, or status. |
| Soft optimization score | Optimization Score is soft | Google's Optimization Score for this account is below 100%. Treat recommendations as ideas — not automatic to-dos. |

Note the last three are **Watch-only**. They never escalate to a typed alert on their own, but they are real and must be visible.

### 4.3 Watch checks, verbatim

**No delivery**
1. Open Google Ads and confirm the main campaigns are Enabled.
2. Check daily budgets and shared budgets are above $0.
3. Check Billing for payment problems.
4. Open Notifications / Policy manager for holds or bans.
5. Confirm location, schedule, and keywords/asset groups are still set to show.
6. If the client asked for a pause, tell the CSM and add an account note.

**Spent MTD, no leads**
1. Compare Google Ads conversions to CallRail and GoHighLevel for the same month-to-date window.
2. Re-check every primary conversion action (calls + forms) — Enabled, primary, and recording.
3. Test the live landing page: call tracking number, form submit, and thank-you page.
4. Confirm the phone/form conversion action names on file match this Google Ads account.
5. Review search terms / PMax insights for junk traffic.
6. If tracking is proven broken, pause or cut budget until it is fixed.

**Zero leads yesterday** *(only when no-delivery and spent-MTD-no-leads are both absent)*
1. Open Goals / Conversions and confirm phone + form actions still record.
2. Test the landing page call button and form on phone and desktop.
3. Compare CallRail / GoHighLevel leads to Google Ads for yesterday.
4. Skim search terms for junk or wrong-city traffic.
5. Confirm the correct Phone / Form conversion action names are on file.

*When zero-leads-yesterday coexists with spent-MTD-no-leads, skip the block above and append just these two:*
- Also check yesterday alone: CallRail / forms vs Google Ads for that day.
- Skim yesterday search terms for junk or wrong-city traffic.

**Under spend**
1. Confirm Monthly Budget / Daily Budget are still the agreed numbers.
2. In Google Ads, check campaign daily budgets and shared budgets.
3. Look for "Limited by budget," learning limits, or payment issues.
4. Check location, schedule, and bid strategy for recent narrowing.
5. Review impression share lost to budget or rank if available.
6. If the client reduced spend on purpose, update the budgets on file.

**Over spend**
1. Confirm the Monthly Budget is still correct.
2. Lower daily or shared budgets so the rest of the month is covered.
3. Check for a recent bid or broad-match change that sped up spend.
4. Review search terms for wasteful themes driving the spike.
5. Tell the CSM if overspend is already large and agree on a daily cap.

**Lead behind**
1. Confirm the Monthly Lead Goal is still the real goal.
2. Check conversion tracking first (CallRail + forms) before changing bids.
3. Review search terms and add negatives for junk queries.
4. Check ad strength and landing-page offer/message fit.
5. Look at impression share and budget limits that may block volume.
6. *In grace:* If still far behind after the grace window, schedule a short CSM check-in.
   *Past grace:* If still behind after tracking is verified, schedule a short CSM check-in.

**High CPL**
1. Confirm the Target CPL on file is still what the shop agreed to.
2. Open search terms and negative out expensive junk queries.
3. Tighten weak match types and protect strong money terms.
4. Check ads and landing pages for clear offer and easy call/form.
5. Review location and schedule for out-of-area or late-night waste.
6. Ask the CSM about lead quality if "leads" are not becoming jobs.

**Unconfigured**
1. Open this account's settings.
2. Fill Daily Budget, Monthly Budget, Monthly Lead Goal, and Target CPL.
3. Save so the next evaluation uses real numbers.

**Estimated budget** *(only when Unconfigured is not already firing)*
1. Open this account's settings.
2. Enter the real agreed Daily Budget and Monthly Budget (do not leave blank).
3. Confirm Monthly Lead Goal and Target CPL while you are there.
4. Save so the next evaluation stops using estimates.

**Change history unavailable**
1. Open Google Ads → Change history manually and scan the last 24–48 hours.
2. Look for unexpected pauses, budget cuts, bid changes, or conversion-goal edits.
3. Confirm the account is still active and that API access is intact.
4. If this keeps failing across many accounts, tell the technical owner — it may be an access issue.

**Soft optimization score**
1. Open Google Ads Recommendations and read only High/Medium items that match our strategy.
2. Ignore broad auto-apply suggestions that fight brand, geo, or conversion setup.
3. Apply only recommendations you understand; skip the rest and note why.

**Generic Watch fallback** *(no condition matched but the account is still on Watch)*
- **Title:** Keep an eye on this shop
- **What this means:** Something drifted enough to land on Watch. Confirm the numbers, then fix the root cause before it becomes Needs attention.
- **Checks:**
  1. Open Google Ads and the account page using the links on this card.
  2. Compare yesterday and MTD to a normal week for this shop.
  3. Fix tracking, budgets, or waste based on what you find.
  4. Tell the CSM if the client needs an update.
- **Remember:** Watch means "nudge soon," not "ignore until it breaks."

### 4.4 Selecting the `remember` line

Evaluate in this order and take the first match. The ordering encodes real priorities: measurement problems outrank optimization problems, and overspending outranks underperforming.

1. Account is actually red → *"This is already Needs attention — handle it today, then resolve the alert with a note when done."*
2. Spent-MTD-no-leads **or** no-delivery → *"Delivery and tracking problems come first. Do not 'optimize keywords' while flying blind."*
3. High CPL **and** under spend → *"Fix delivery and waste together. Raising spend into a high CPL usually makes the month worse."*
4. Over spend → *"Slow spend carefully so the month finishes evenly. Update the budgets on file if the plan changed."*
5. Change-history failure is the *only* condition → *"Manual change-history review is enough for today if metrics otherwise look normal."*
6. Default → *"If the same Watch issue is still here tomorrow, treat it like Needs attention."*

---

## 5. The Healthy state

**A healthy account must still say something.** An empty card reads as "we did not check." A card that states what was verified reads as "we checked, and here is proof." This distinction is worth more than it sounds — it is what makes the daily briefing credible on a day when nothing is wrong.

- **Section label:** Why this shop is Healthy
- **Explanation:** Ads ran yesterday, budget and lead pace are inside tolerance, and MTD CPL is within the high-CPL multiplier of Target CPL. No open alerts for this shop.

Healthy accounts still display their metric tiles. Nobody has to trust the word "Healthy" — they can see the six numbers behind it.

Corollary for the interface: the **all-clear state must be explicit**. When no account needs attention, say so directly. Never render an empty screen and let the user wonder whether the system ran.

---

## 6. The 30-day guarantee surface

Not an alert type, but the highest-stakes thing on the screen. New clients get a **30-day minimum-lead money-back guarantee**, so every new account carries a hard commercial deadline. Full mechanics are in Section 8 of the main brief; what matters here is the presentation contract.

While an account is inside its window it carries **two** persistent surfaces that are always visible regardless of health status:

**1. A compact badge** on the account card: `Day 12 of 30 · money-back`

**2. A prominent banner** with:
- an eyebrow: *First 30 days — minimum lead money-back guarantee*
- a headline and one or two sentences of context, in a tone that varies by whether the account is on track
- a **four-field lead strip**: Leads so far · Leads needed so far · Current lead pace · 30-day lead target
- a **three-field date row**: Campaign start · Guarantee ends · Days left

**The lead strip is independently color-coded**, on its own thresholds, separate from overall account health:

| Band | Condition | Meaning |
|---|---|---|
| Red | pace < 100% | Behind the guarantee — money is genuinely at risk |
| Yellow | 100%–105% | Close — no cushion |
| Green | > 105% | On track with margin |

Why independent: an account can be *Healthy* on every ordinary metric and still be about to fail its guarantee, because the guarantee is a lead **count** commitment, not an efficiency commitment. Coloring the strip by account health would hide exactly the case the strip exists to catch.

**Sorting rule.** Within any group, accounts inside a guarantee window sort first, ordered by fewest days remaining. Deadlines outrank everything.

---

## 7. Alert lifecycle, deduplication, and history

- **Created** when the condition is first detected.
- **Not duplicated.** If the same condition on the same account persists tomorrow, update the existing open alert: bump `occurrenceCount`, refresh `lastSeenAt` and the current figures, keep the original `firstSeenAt`. The interface must be able to say **"third day in a row"** — that phrase changes how urgently a person responds, and it is impossible to render if every day creates a new row.
- **Acknowledged** — someone has taken it.
- **Snoozed** — until a date, with a required reason.
- **Resolved** — with a required note describing what was actually done.
- **Auto-resolved** — the condition cleared on its own. Record this distinctly. Never let an auto-resolution look like a human fixed something.
- **History is retained permanently.** "How long was this account bleeding money before we caught it?" must be answerable, per account and across the portfolio.

---

## 8. Copy rules and tone

The guidance copy is a product feature, not filler. Its voice is consistent and deliberate:

1. **Assume competence, assume no time.** The reader knows Google Ads. They do not know what happened to *this* account today. Explain the situation, not the platform.
2. **No jargon in the "what this means" line.** Metric names are fine. Acronyms without expansion, internal shorthand, and platform trivia are not.
3. **Order the checks by diagnostic sequence.** Cheapest and most likely first. Verify measurement before concluding performance collapsed.
4. **Every `remember` warns against a specific wrong reaction.** Not generic encouragement — the actual mistake a rushed person makes with this alert. *"Cutting budget alone does not fix a high CPL."* *"A bad mobile page looks like a bid problem."* *"Do not 'optimize keywords' while flying blind."*
5. **Name the outside tools.** CallRail and GoHighLevel appear by name because that is what the team actually opens. Vague advice to "check tracking" gets skipped; "open CallRail and compare yesterday" gets done.
6. **Require human approval before destructive or structural changes.** Pausing large keywords, excluding geographies, and cutting device bids all route through an account lead first. The software recommends; it never acts on the ad account.
7. **Numbers are always formatted and always present.** The reader should never have to leave the alert to find out how bad it is.

---

## 9. Things that must be configurable

Per account, with sensible defaults, without a code change:

| Setting | Default |
|---|---|
| Daily budget, Monthly budget, Monthly lead goal, Target CPL | none — absence triggers `UNCONFIGURED` |
| Budget pace tolerance | 0.15 (±15%) |
| Lead pace tolerance | 0.15 |
| High CPL multiplier | 1.5 |
| Zero-conversion spend alert threshold | $200 |
| Keyword/ad-group waste spend threshold | $50 |
| Waste lookback window | 14 days |
| Location waste minimum clicks | 20 |
| Location waste lookback | 30 days |
| Device high-CPA ceiling | $100 |
| New-campaign lead-pace grace window | 7 days |
| Master alert switch | on |
| Per-type alert switches (zero spend, unconfigured, budget pace, lead pace, high CPL, spend-no-conversions) | on |
| Campaign start date | optional — drives grace window and guarantee math |

Also configurable, at the organization level: the **escalation contacts**. Several guidance items say "check with an account lead" before a destructive change. In the original system these were two named individuals. Model them as a configurable role so the copy stays accurate as the team changes.

Two hard rules on switches:
- `SYNC_FAILURE` ignores every switch. A broken pipeline can never be silenced by configuration.
- `NEEDS_ATTENTION` ignores every switch. An unhealthy account can never end up with no alert at all.

---
---

# PART B — THE DESIGN LANGUAGE

> Everything below describes a **document design**, captured as reference. **Do not build an email. Do not recreate this layout.** Extract the principles and express them natively on the web — with the interactivity, filtering, and state that a real application can offer and a static document never could.

---

## 10. Why the old design worked

The old briefing had one job: let a person open it at 7am, holding coffee, and know within about eight seconds whether their day was on fire. It did that through six decisions worth keeping.

1. **Severity is the primary sort, always.** Problems first, watch second, healthy last. Never alphabetical, never by account size. The first thing on screen is the thing that matters most.

2. **Color carries meaning consistently, and only meaning.** Red, amber, and green appear *only* to convey account health. Nothing decorative is ever red. The palette therefore stays trustworthy — if something is red, something is wrong, every time.

3. **Every claim shows its evidence.** Behind every status badge sat a strip of six metric tiles. Nobody had to take "Needs attention" on faith. This is the single biggest reason the system was trusted.

4. **Nothing was hidden behind a click.** No accordions, no "show more," no collapsed sections. Every problem and its full guidance was visible in one scroll. Longer, but a person scanning fast never missed anything. **This is the principle most at risk in a web rebuild** — resist the urge to collapse guidance behind a disclosure triangle just because the page gets long.

5. **The number and the meaning always sit together.** Never a bare figure. `$847.22` was always accompanied by *"above plan"* or *"on pace."* Interpretation is not the reader's job.

6. **Deadlines override the normal hierarchy.** Accounts inside a guarantee window jumped to the top of their group in a distinct orange that was reserved for exactly that purpose and used nowhere else.

---

## 11. The visual system

Use this as inspiration and a starting palette, not as a spec to match pixel for pixel. Modernize freely — this was constrained by 2005-era email rendering, and you are not.

### 11.1 Color

**Surfaces and text**

| Hex | Role |
|---|---|
| `#e8eef4` | Page background |
| `#ffffff` | Card and content surface |
| `#172b4d` | Primary text |
| `#344054` | Body copy in lists |
| `#475467` | Secondary explanatory copy |
| `#667085` | Labels, muted text |
| `#718096` | Sublines, hints |
| `#98a2b3` | Placeholder / missing value |
| `#e4eaf0` | Standard border |
| `#f8fafc` | Inset panel background |

**Brand / header**

| Hex | Role |
|---|---|
| `#17324d` | Deep navy header block |
| `#d9e8f5` | Header subtitle |
| `#9eb4c7` | Header meta labels |
| `#e8f0f7` | Header meta values |

**Needs attention (red)**

| Hex | Role |
|---|---|
| `#b42318` | Text, labels, primary button fill |
| `#f04438` | Border, left accent |
| `#fecdca` | Divider, section header border |
| `#fef3f2` | Tinted background |
| `#7a271a` | Deep text on tinted background |

**Watch (amber)**

| Hex | Role |
|---|---|
| `#8a5a00` | Badge text |
| `#dc6803` | Accent, primary button fill |
| `#f79009` | Border, left accent |
| `#fff4d6` | Badge background |
| `#fffaeb` | Tinted background |
| `#7a4d00` | Deep text on tinted background |

**Healthy (green)**

| Hex | Role |
|---|---|
| `#1e7a45` | Badge text |
| `#087443` | Section label, button fill |
| `#12b76a` | Strong accent |
| `#abefc6` | Border, left accent |
| `#e9f7ef` | Badge background |
| `#ecfdf3` | Tinted background |
| `#085d3a` | Deep text on tinted background |

**Guarantee window (orange — reserved, used nowhere else)**

| Hex | Role |
|---|---|
| `#ea580c` | Banner border |
| `#fb923c` | Badge border |
| `#fff7ed` | Background |
| `#9a3412` | Body text, eyebrow |
| `#7c2d12` | Headline, values |
| `#c2410c` | Field labels |

**Client-facing accent**

| Hex | Role |
|---|---|
| `#1a73e8` | Left accent and label on the copy-to-client summary block — deliberately outside the health palette so internal diagnosis and client-facing language are never confused |

### 11.2 Typography

Original stack was `Arial, Helvetica, sans-serif` purely for email compatibility. **Choose a better typeface.** What matters is the scale and the role assignments.

| Role | Size / line-height | Weight | Treatment |
|---|---|---|---|
| Hero title | 26 / 34 | 700 | — |
| Section title | 18 / 26 | 700 | — |
| Card title (shop name) | 17 / 24 | 700 | — |
| Metric tile value | 16 / 22 | 700 | — |
| Guidance title | 15 / 21 | 700 | — |
| Body copy | 13 / 19–20 | 400 | — |
| Card subline | 11 / 16 | 400 | — |
| Section label | 11 / 16 | 800 | uppercase, +0.8px tracking |
| Metric tile label | 10 / 14 | 700 | uppercase, +0.5px tracking |
| Badge / pill | 10–11 / 14–16 | 700–800 | uppercase for pills |

The pattern worth keeping: **small uppercase tracked labels above large bold values.** It makes a dense grid of numbers scannable without borders everywhere.

### 11.3 Layout

| Token | Value | Use |
|---|---|---|
| Container | 760px max | Single readable column — resist widening; scanning speed comes from short line length |
| Section padding | 26–28px horizontal | — |
| Card padding | 15–17px | — |
| Card gap | 18px | — |
| Radius | 8px standard, 9px cards, 6px inset panels, 999px pills | — |
| Border | 1px standard | — |
| Left accent | **6px** for problems, **4px** for healthy | Urgency is legible in peripheral vision |
| Guarantee banner border | 2px | Only element with a heavy border |
| Guidance box border | 1px **dashed** | Marks guidance as instruction, not data |

Two details that punched above their weight: the **thicker left accent bar on problem cards** (a reader scrolling fast registers bar thickness before they read anything), and the **dashed border on the guidance box** (instantly separates "here is what happened" from "here is what to do").

### 11.4 Component anatomy

**Header block** — navy, logo, report date, reference identifier, audience, an "about this batch" note, and a single bold summary line: *"3 shops have open issues (4 total) that need action."* One sentence, before anything else, answering the only question that matters on open.

**Portfolio snapshot** — four tinted count tiles across the top: Accounts · Healthy · Watch · Needs attention. Large number above small label. Neutral blue-gray, green, amber, red. In the web app this becomes the natural filter control.

**Section header** — a full-width tinted bar above each group, with a small uppercase label and a bold subtitle: *"Needs attention — account detail"* / *"3 shops with 4 open issues."*

**Account card**
```
┌ 6px left accent ─────────────────────────────────┐
│ TINTED HEADER                                     │
│  Shop Display Name              [Needs attention  │
│  Account Name · 123-456-7890     · 2 issues]      │
│  CSM: Name · email               [Day 12 of 30]   │
├───────────────────────────────────────────────────┤
│ WHITE BODY                                        │
│  [guarantee banner, if in window]                 │
│  [metric tiles]                                   │
│  Issue 1 of 2                                     │
│  ZERO_SPEND                                       │
│  No delivery yesterday — actual spend $0.00…      │
│  ┌ dashed ─────────────────────────────────────┐  │
│  │ NEXT STEP                                    │  │
│  │ Ads did not run yesterday                    │  │
│  │ Google did not show ads for this shop…       │  │
│  │ ┌ The numbers: …                          ┐  │  │
│  │ CHECK THESE THINGS                           │  │
│  │  1. …  2. …  3. …                            │  │
│  │ ─────────────────────────────────────────    │  │
│  │ Remember: …                                  │  │
│  └──────────────────────────────────────────────┘  │
│  ── divider ──                                    │
│  Issue 2 of 2 …                                   │
│  [Open Google Ads]  [Open account]                │
└───────────────────────────────────────────────────┘
```

**Metric tiles** — six, in two rows of three: Yesterday spend · Yesterday leads · Budget pace · Lead pace · MTD CPL · Target CPL. Each is uppercase label → bold value → interpretive hint (*"Ads delivering," "On pace"*). The hint line is what turns a number into information.

**Guidance box** — the heart of it. Dashed border in the status color. Label, title, meaning paragraph, an inset "The numbers" panel, the uppercase "Check these things" header, the numbered list, a hairline divider, and the "Remember" line with its lead word emphasized in the status color.

**Issue separation** — when a card holds multiple issues, each is labeled *"Issue 1 of 2"* and separated by a tinted rule. Counted, not merged.

**Client-ready summary** — an optional block in Google-blue, structured as Results / Budget / Work completed / Next focus. Written in client-safe language and meant to be copied straight into an email to the shop owner. Visually distinct from everything else because using internal diagnostic language with a client is a real and expensive mistake.

**Action buttons** — filled primary in the status color plus an outlined secondary. Two, never more.

**Footer** — confidentiality notice and an always-expanded troubleshooting checklist.

### 11.5 Status badges

| Status | Background | Text | Border | Label |
|---|---|---|---|---|
| Healthy | `#e9f7ef` | `#1e7a45` | `#abefc6` | `Healthy` |
| Watch | `#fff4d6` | `#8a5a00` | `#f79009` | `Watch` |
| Needs attention | `#fdecec` | `#b42318` | `#f04438` | `Needs attention` or `Needs attention · 2 issues` |
| Guarantee window | `#fff7ed` | `#9a3412` | `#fb923c` | `Day 12 of 30 · money-back` |

Fully rounded, 5×9px padding, 11px bold. Note that the needs-attention badge **carries the issue count** — one glance distinguishes a one-problem account from a five-problem account.

---

## 12. An annotated example

A single needs-attention card, trimmed to structure. Included so the proportions and relationships are concrete. **This is a design artifact. Do not ship this markup.**

```html
<!-- Card: 6px left accent signals a problem before any text is read -->
<div style="border:1px solid #f04438; border-left:6px solid #f04438;
            border-radius:9px; margin-bottom:18px; overflow:hidden;">

  <!-- Tinted header: identity left, status right -->
  <div style="background:#fef3f2; border-bottom:1px solid #f04438; padding:15px 17px;">
    <div style="float:left;">
      <div style="font-size:17px; line-height:24px; font-weight:700; color:#172b4d;">
        Riverside Collision Center
      </div>
      <div style="font-size:11px; line-height:16px; color:#718096;">
        Riverside Collision — Google Ads · 123-456-7890
      </div>
      <div style="font-size:12px; line-height:17px; color:#475467;">
        CSM: Dana Whitfield · user@example.com
      </div>
    </div>
    <div style="float:right; text-align:right;">
      <!-- Badge carries the issue COUNT, not just the state -->
      <span style="display:inline-block; background:#fdecec; color:#b42318;
                   border:1px solid #f04438; border-radius:999px;
                   padding:5px 9px; font-size:11px; font-weight:700;">
        Needs attention · 2 issues
      </span>
      <!-- Guarantee pill: reserved orange, never used for anything else -->
      <div style="margin-top:6px;">
        <span style="display:inline-block; background:#fff7ed; color:#9a3412;
                     border:1px solid #fb923c; border-radius:999px;
                     padding:4px 8px; font-size:10px; font-weight:800;
                     letter-spacing:.3px; text-transform:uppercase;">
          Day 21 of 30 · money-back
        </span>
      </div>
    </div>
    <div style="clear:both;"></div>
  </div>

  <div style="background:#ffffff; padding:15px 17px 17px;">

    <!-- Evidence before assertion: six tiles, label / value / interpretation -->
    <div style="font-size:11px; font-weight:700; letter-spacing:.8px;
                text-transform:uppercase; color:#60758a; margin-bottom:8px;">
      Health KPIs (same checks that raised these alerts)
    </div>
    <table width="100%" style="border-collapse:separate;"><tr>
      <td width="33%" style="padding:4px;">
        <div style="background:#f8fafc; border:1px solid #e4eaf0; border-radius:8px;
                    padding:10px 10px 9px; text-align:center;">
          <div style="font-size:10px; font-weight:700; letter-spacing:.5px;
                      text-transform:uppercase; color:#667085;">Yesterday spend</div>
          <div style="font-size:16px; font-weight:700; color:#172b4d;
                      margin-top:4px;">$0.00</div>
          <!-- The hint turns a number into a judgment -->
          <div style="font-size:11px; color:#718096; margin-top:3px;">Not delivering</div>
        </div>
      </td>
      <!-- …five more tiles… -->
    </tr></table>

    <!-- Issues are counted, never merged -->
    <div style="font-size:11px; font-weight:700; letter-spacing:.8px;
                text-transform:uppercase; color:#60758a; margin-top:14px;">
      Issue 1 of 2
    </div>
    <div style="font-size:13px; font-weight:800; color:#b42318;">ZERO_SPEND</div>
    <div style="font-size:13px; line-height:20px; color:#263b50;">
      No delivery yesterday — actual spend $0.00, impressions 0, clicks 0
      (configured daily budget $180.00).
    </div>

    <!-- Dashed border = instruction, not data. This distinction is the whole trick. -->
    <div style="border:1px dashed #f04438; border-radius:8px;
                padding:16px 16px 14px; margin-top:12px; background:#ffffff;">
      <div style="font-size:10px; font-weight:800; letter-spacing:.9px;
                  text-transform:uppercase; color:#b42318;">Next step</div>
      <div style="font-size:15px; line-height:21px; font-weight:700;
                  color:#172b4d;">Ads did not run yesterday</div>
      <div style="font-size:13px; line-height:19px; color:#475467;">
        Google did not show ads for this shop yesterday, so nobody clicked and
        nothing was spent. That usually means something is paused, out of money,
        blocked, or not set up to show.
      </div>

      <!-- Facts in an inset panel: no one should leave to find the numbers -->
      <div style="background:#f8fafc; border:1px solid #e4eaf0; border-radius:6px;
                  padding:10px 12px; margin-top:10px; font-size:13px; color:#263b50;">
        <strong style="color:#b42318;">The numbers:</strong>
        Yesterday: $0.00 spend, 0 impressions, 0 clicks.
        Configured daily budget: $180.00.
      </div>

      <div style="font-size:11px; font-weight:700; letter-spacing:.5px;
                  text-transform:uppercase; color:#60758a; margin-top:12px;">
        Check these things
      </div>
      <!-- Ordered by diagnostic sequence, never alphabetical, never by ease -->
      <ol style="margin:6px 0 0 19px; padding:0; font-size:13px;
                 line-height:19px; color:#344054;">
        <li style="margin-bottom:8px;">Open Google Ads for this account.</li>
        <li style="margin-bottom:8px;">Look at Campaigns. Are the main Search /
            Performance Max campaigns set to Enabled?</li>
        <li style="margin-bottom:8px;">Check Budgets. Is the daily budget above $0?
            Did the campaign hit a shared budget cap?</li>
        <li style="margin-bottom:8px;">Check Billing. Is there a payment problem,
            failed card, or unpaid invoice?</li>
      </ol>

      <!-- Every alert ends by naming the specific wrong reaction -->
      <div style="border-top:1px solid #eef2f6; margin-top:12px; padding-top:10px;
                  font-size:13px; line-height:19px; color:#667085;">
        <strong style="color:#b42318;">Remember:</strong>
        Fix the blocker first (billing, pause, policy). Then watch spend today to
        confirm ads are showing again. Tell the CSM if the shop asked for a pause.
      </div>
    </div>

    <div style="margin-top:14px;">
      <a href="#" style="display:inline-block; background:#b42318; color:#ffffff;
                         border:1px solid #f04438; border-radius:8px; padding:8px 12px;
                         font-size:12px; font-weight:700; text-decoration:none;
                         margin-right:8px;">Open Google Ads</a>
      <a href="#" style="display:inline-block; background:#ffffff; color:#b42318;
                         border:1px solid #f04438; border-radius:8px; padding:8px 12px;
                         font-size:12px; font-weight:700;
                         text-decoration:none;">Open account</a>
    </div>
  </div>
</div>
```

---

## 13. What to steal, what to leave behind, and how to verify

### Keep

- **Severity-first ordering, everywhere.** Never default to alphabetical.
- **Semantic-only color.** Red, amber, and green mean health and nothing else. Orange is reserved for guarantee windows. Blue marks client-facing content.
- **Evidence beside every claim.** The six metric tiles ship with the status badge, on healthy accounts too.
- **The guidance box as a distinct visual object.** Title, meaning, facts, ordered checks, remember. Visually separated from the data that triggered it.
- **Issues counted and separated,** never merged into one paragraph.
- **The interpretive hint under every number.**
- **Thicker accent bars for higher severity.**
- **Guarantee windows breaking the normal hierarchy,** in their own reserved color.
- **The explicit all-clear.** Say "nothing needs attention today" out loud.
- **Client-facing language visually quarantined** from internal diagnostic language.

### Leave behind

- **Table-based layout and inline styles.** Artifacts of email rendering. Use a real styling system.
- **The 760px hard ceiling** as a page constraint — though keep the *reading column* around that width. Wide screens should gain sidebars, filters, and detail panes, not longer lines of text.
- **`Arial, Helvetica`.** Pick a real typeface.
- **Static everything.** This is the big one. The old design could not filter, sort, acknowledge, snooze, search, or remember that you already looked at something. Build all of that.
- **"Batch" framing.** The old artifact covered whatever subset had been processed. The app has the whole portfolio, always.

### Add, because you can

- Filter and sort by status, manager, guarantee window, alert type
- Acknowledge / snooze / resolve inline, without leaving the queue
- **"Third day in a row"** rendered directly on the alert, using `occurrenceCount`
- Trend sparklines beside the metric tiles — the old design could only show one day
- Real-time status without a reload
- Keyboard navigation through the queue; this is a daily-repeated workflow and speed compounds
- Per-user views: an account manager sees their accounts first
- One-click copy of the client-ready summary

### How to know you got it right

The interface passes if all of these are true:

1. A manager opens the app and knows within **eight seconds** whether today is a problem day.
2. **No alert anywhere** renders without its full guidance block — title, meaning, facts, ordered checks, remember.
3. **No number renders without interpretation** next to it.
4. Guarantee-window accounts are **impossible to overlook**, whatever their health status.
5. Every status claim has **visible supporting evidence** on the same card.
6. Nothing important requires a **click to reveal**.
7. The **all-clear state is explicit**, never an empty screen.
8. Color is **never decorative** — a red pixel always means something is wrong.

---

## Cross-references

- Full product specification: `Give this to Codex - full product brief to rebuild this system as a web app.md`
- Alert catalog summary and lifecycle: Sections 7.3–7.5 of that brief
- In-app notification model: Section 9 of that brief
- Guarantee module mechanics: Section 8 of that brief
