# Give this to Codex — full product brief for Built Ads Manager

**Product name:** **Built Ads Manager**
**Type:** internal web application for the staff of one marketing agency
**Audience for this document:** an AI coding agent (ChatGPT Codex) or a software team that knows *nothing* about this business.
**Purpose:** define, completely and unambiguously, what the software must do — the goals, the domain, every rule, every number — while leaving **all** technical decisions to the builder.

---

## 0. How to use this document

You are building a **web application from scratch**. This document is the product specification. It describes outcomes, not implementations.

Five rules for reading it:

1. **Every formula, threshold, and business rule here is a hard requirement.** They come from years of running this business. Treat them as validated defaults, make them configurable, but ship them exactly as written.

2. **Every technical decision is yours.** Language, framework, database, hosting, job scheduling, front-end architecture, API style, testing approach — none of it is specified, on purpose. Choose what you can defend and be consistent. Section 3 sets the engineering bar you must clear, not the tools you must use.

3. **Do not assume anything about how this work is done today.** No existing system is described here and none should be inferred. Build the right thing from first principles.

4. **This is an internal employee tool.** There is no public sign-up, no marketing site, no billing, no free trial. Only employees of the company can sign in (Section 4).

5. **There is no email in version one.** All alerts, notifications, and briefings are delivered **inside the application**. The person logs in and sees what needs attention. Email or chat delivery may be added later, so build the notification layer with pluggable delivery channels — but do not build, design, or spend time on email in this version (Section 9).

**Suggested opening prompt when handing this to an agent:**

> Read the entire brief. Then produce (a) a proposed architecture with justification, including your database choice and why, (b) a complete data model, (c) a phased delivery plan with milestones, and (d) a list of every decision you had to make that the brief left open. Do not write application code until we have agreed on (a) through (d).

---

## 1. Executive summary

### 1.1 What the software is

**Built Ads Manager** is an internal web application used by the employees of a digital marketing agency to manage the Google Ads accounts they run for many small local businesses.

Every day it pulls performance data from every client's Google Ads account, compares that performance against the goals the agency promised that client, decides whether each account is healthy or in trouble, explains *why* in plain language, tells the account manager exactly what to do next, and presents all of it as a prioritized queue when the employee logs in.

Think of it as: **an automated account-health analyst that reviews 70 advertising accounts overnight, then hands each employee a triaged to-do list the moment they open the app.**

The people logging in are the agency's own staff — account managers, client success managers, and the owner. The client businesses are the *subjects* of the data, not users of the software.

### 1.2 The business it serves

The agency runs Google Ads for **auto body shops / collision repair centers** in the United States. Roughly **70 shops today**, scaling toward **200+**. Each shop pays a monthly fee, has an agreed advertising budget, and expects a certain number of leads (phone calls and form submissions) each month.

The domain shapes the product in specific ways:

- Each account is **small** — typically $50–$500 per day in ad spend — so one bad week is financially material to the client.
- Leads are **phone calls and form fills**, not online purchases. There is no revenue or return-on-ad-spend to optimize toward. The currency of success is **lead volume and cost per lead**.
- Clients are **non-technical small business owners**. They do not read dashboards. They judge the agency on "did my phone ring this week."
- The agency offers a **30-day minimum-lead money-back guarantee** to new clients. Every new account carries a hard commercial deadline, and the software must make it impossible to miss one (Section 8).
- Each account manager handles **many** shops. Without automatic triage, daily review of all of them is physically impossible.

### 1.3 The problem being solved

Without this software, an account manager would have to log into Google Ads, switch between 70 accounts one at a time, and manually check each for: budget pacing, lead pacing, cost per lead, whether the account spent anything yesterday, whether ads got disapproved, and whether money is leaking into keywords or geographic areas that never produce leads.

Nobody can do that daily. So problems go unnoticed for days or weeks, clients churn, and guarantee deadlines quietly pass.

**The software's job is to perform that review automatically for every account every day, and surface only what needs a human.**

### 1.4 What success looks like

- An employee logs in and immediately sees a **ranked list of the shops that need attention today**, each with a specific recommended action.
- Nothing important is silently missed: zero spend, spend with no leads, blown pacing, disapproved ads, wasted spend, and approaching guarantee deadlines all surface themselves.
- Every client's data lives in its **own dedicated view**, never mixed with other clients.
- The agency's promises — budget, lead goal, target cost per lead — are stored in **exactly one place** and flow everywhere automatically.
- Adding client #71 takes minutes.
- An employee signs in with their work Google account in one click, and nobody outside the company can get in at all.

### 1.5 Product name, company name, and branding

Three distinct things, and one of them is about to change.

| Thing | Value today | Notes |
|---|---|---|
| **Product name** | **Built Ads Manager** | Use this everywhere in the application: browser title, sign-in screen, navigation header, page titles, exports, and any generated documentation. |
| **Operating company** | **Built by Shah** | The agency's current name. It contains the owner's personal name. |
| **Planned future company name** | **Built for Body Shops** | The owner intends to rebrand. Timing undecided. |

Requirements this creates:

1. **The product is named "Built Ads Manager," not after the company.** This was deliberate so that the rebrand never touches the application.
2. **Never hard-code the company name.** Anywhere the *company* appears — report headers, confidentiality notices, client-facing exports, the logo — must read from configuration. Renaming the company must be an admin settings change plus a logo upload, never a code change.
3. **Company display name, logo, brand colors, and support contact are admin-editable settings.**
4. **Client-facing output is the highest-stakes surface.** Anything a client sees must carry current company branding. Documents generated before a rename may keep their original branding; everything generated after must use the new one.

---

## 2. Domain glossary

Assume no advertising knowledge. Every term below is used throughout this brief.

| Term | Meaning in this system |
|---|---|
| **Google Ads** | Google's advertising platform. Businesses pay to show ads in search results and across Google's network. |
| **Account / Customer ID** | One advertiser's Google Ads account, identified by a 10-digit ID conventionally displayed as `123-456-7890`. One body shop equals one account. |
| **Manager account (MCC)** | A Google Ads account that has administrative access to many client accounts. The agency has one, which is how the software can read all 70 clients' data through a single authorization. |
| **Campaign** | A container inside an account with its own budget and targeting. An account has several. |
| **Search campaign** | Ads shown on Google search results for chosen keywords. The primary campaign type in this business. |
| **Performance Max (PMax)** | An automated Google campaign type spanning Search, Display, YouTube, Maps, and more. It has **no keywords** — Google decides placement. Must be reported separately from Search because the available data is fundamentally different. |
| **Ad group** | A subdivision of a campaign containing keywords and ads. |
| **Keyword** | A search phrase the advertiser bids on, with a *match type* (exact, phrase, broad) controlling how loosely it matches real searches. |
| **Search term** | What a real person actually typed, as opposed to the keyword that matched it. Reviewing these is how wasted spend gets found. |
| **Negative keyword** | A phrase that prevents an ad from showing. Used to stop waste. |
| **Impression** | One instance of an ad being shown. |
| **Click** | One instance of someone clicking an ad. Costs money. |
| **CTR (click-through rate)** | Clicks ÷ impressions. |
| **CPC (cost per click)** | Spend ÷ clicks. |
| **Conversion** | A tracked valuable action. **In this business a conversion means a lead** — a phone call or a form submission. |
| **Primary vs. all conversions** | Google allows some conversion actions to be marked "primary" (counted in the headline conversions figure) and others as observation-only. All health math in this system uses **primary conversions**. |
| **CPL (cost per lead)** | Spend ÷ conversions. The single most important efficiency metric here. Called CPA in other industries. |
| **Target CPL** | The cost per lead the agency promised the client. |
| **Daily budget** | The average amount an account is approved to spend per day. |
| **Monthly budget** | The approved monthly spend. Roughly daily × 30.4 when not explicitly agreed. |
| **Monthly lead goal** | How many leads the client should receive in a calendar month. |
| **Pacing** | Whether actual spend or actual leads are on track versus where they should be at this point in the month. The analytical heart of this product. |
| **Disapproved ad** | An ad Google rejected on policy grounds. It stops serving. A silent revenue killer. |
| **Optimization score** | Google's 0–100% opinion of how well an account is configured. Informational only here. |
| **Recommendation** | A change Google suggests. **Some are dangerous** (raise budget, change bidding strategy, enable broad match). Must never be applied automatically. |
| **Experiment** | A Google Ads A/B test running on a campaign. |
| **Change history** | Google's log of what changed in an account, when, and by whom. |
| **Geographic report** | Performance broken out by the physical location of the searcher. Used to find towns and postal codes that waste money. |
| **Device report** | Performance broken out by mobile, desktop, and tablet. |
| **Call tracking** | Third-party software (CallRail is common) that records phone calls and imports them into Google Ads as conversions. Relevant because call conversions are often categorized inconsistently. |
| **Account manager** | Agency employee responsible for ad performance on a set of shops. The primary user of this software. |
| **CSM (client success manager)** | Agency employee who owns the client relationship. Secondary user; needs visibility when a shop is in trouble or inside its guarantee window. |
| **Money-back guarantee window** | The first 30 calendar days after a client's campaign start date, during which the agency has promised a minimum number of leads or the client may request a refund. |
| **Built Ads Manager** | The software described by this document. |
| **Google Workspace** | Google's business email and identity product. The agency runs on it, which is why employee sign-in is Google-based and restricted to company domains (Section 4). |

---

## 3. Engineering principles and the quality bar

You choose the stack. This section defines the standard the result must meet. The owner's explicit goal is software that is **bulletproof** — durable, trustworthy, and safe to run a business on.

### 3.1 A real database is mandatory

All application data lives in a **proper database with an enforced schema**. Specifically:

- **No spreadsheet, document, or file may serve as a system of record.** Nothing that a human can accidentally open and edit may be part of the data path. This is a firm requirement, not a preference.
- **Enforce integrity in the database**, not only in application code: primary keys, foreign keys, unique constraints, not-null constraints, and check constraints where a value has a legal range.
- **Schema changes happen through versioned, reviewable migrations** that can be applied and rolled back predictably.
- **Store raw facts, not only computed summaries.** When a formula changes or a bug is fixed, history must be recomputable without re-querying external services.
- **Money and metrics must be numerically exact.** Advertising platforms report currency in millionths of a unit; accumulating floating-point error into a client-facing spend figure is unacceptable. Choose types accordingly.
- **Every record that matters carries timestamps**, and mutable business records carry an audit trail of who changed what, when, and what the previous value was.

Pick the database you can most defend for this workload: a mix of configuration data, moderately heavy daily time-series ingestion, and analytical reads across accounts. Justify the choice.

### 3.2 Correctness over cleverness

This is a system whose entire value is being right about numbers. Ambiguity here causes bad decisions with real client money.

- **Time zones are a first-class concern.** Every performance date range must be computed in the *advertising account's own* time zone. Scheduling and internal timestamps use the *organization's* time zone. Never mix them, and label which is which wherever a date appears in the interface. This is the most common source of subtle, expensive bugs in this domain.
- **No unsafe arithmetic ever reaches a user.** Division by zero must never surface as `NaN`, `Infinity`, or an error artifact. Missing data renders as a dash or an explicit "no data" — **never as zero**, because zero is a meaningful value in this domain and confusing "no leads" with "no data" causes wrong decisions.
- **Idempotency everywhere.** Re-running an ingestion for a date must not duplicate data. Retrying a notification must not double-deliver.
- **Fault isolation.** One account failing to process must never prevent the other sixty-nine from completing. Partial success is a normal, first-class outcome that the interface must represent honestly.

### 3.3 Testing and verification

- Automated tests covering, at minimum: all pacing and health calculations, every alert trigger condition and its suppression rules, the guarantee window math, time-zone edge cases, month-boundary behavior, and access control.
- **Test the calendar edge cases explicitly.** The first day of a month, the last day of a month, months of different lengths, and daylight-saving transitions each break naive implementations.
- **Verification against known-good outputs.** The business can supply validated expected results — health status, pacing figures, and which alerts should fire — for a set of real accounts on specific historical dates. Match them exactly before going live. This is the highest-value validation available and should be treated as a release gate.
- Access control must be tested at the API layer, not merely assumed from the interface.

### 3.4 Operational maturity

- Separate environments for development, staging, and production, with no shared data.
- Automated backups with a **tested** restore procedure. Untested backups do not count.
- Structured logging, metrics, and tracing for all background work.
- Self-monitoring: the system must alert its operator when *it* is unhealthy — failed ingestion, expired credentials, backed-up job queues.
- Deployment that is repeatable and reversible.
- Configuration and secrets managed outside source code.

### 3.5 Architecture guidance (not prescription)

Some shape is implied by the requirements, though the implementation is yours:

- There is a **background processing tier** that ingests data on a schedule, independent of anyone being logged in.
- There is an **analysis layer** that evaluates health and generates alerts from stored data — ideally pure and independently testable, so it can be re-run over history.
- There is an **application tier** serving an authenticated interface.
- There is a **notification layer** that currently delivers in-app only, but is designed so additional channels can be added later without rework (Section 9).

Concurrency for data ingestion should be configurable and respectful of external API quotas. Nothing in the business logic may assume a limit on how many accounts exist — design for hundreds.

---

## 4. Access, authentication, users, roles, and permissions

**This section is a hard requirement.** Built Ads Manager holds ~70 clients' advertising performance data, the agency's internal thresholds, and candid internal commentary about client performance. Unauthorized access is a serious incident.

### 4.1 Authentication — employees only, Google sign-in only

**The rule in one sentence: the only way in is signing in with Google using a company work email address on an approved company domain.**

1. **Google OAuth ("Sign in with Google") is the only authentication method.** No passwords, no magic links, no username accounts. The company runs Google Workspace, so an employee's work Google account *is* their identity. This makes offboarding real: disabling someone's Workspace account removes their access immediately, with no separate password to revoke.

2. **The email address must be on an approved company domain.** A personal Gmail, a client's address, or any other domain is rejected with a clear, non-technical message such as: "Built Ads Manager is only available to company staff. Please sign in with your work email." Do not create a user record for a rejected attempt. Do log it for the administrator.

3. **Allowed domains are a configurable list, not a hard-coded value.** This detail matters:
   - Today the only allowed domain is **`builtbyshah.com`**.
   - The company plans to rebrand and will likely move to **`builtforbodyshops.com`**.
   - During the transition **both must work simultaneously**, and an employee must land in the *same* user account whether they sign in as `user@example.com` or `user@example.com`.

   Therefore: store allowed domains as admin-editable configuration, support multiple at once, and let an administrator link a second email address to an existing user so assignments, notes, and history survive the change. **Do not key users by email address.** Use a stable internal identifier with one or more verified emails attached. A provider's subject identifier helps but can change if a Workspace account is deleted and recreated, so allow an admin to re-link or merge.

4. **No self-service registration, ever.** No "create account" screen. Passing the domain check makes someone *eligible* to sign in; it does not by itself grant access to data (see 4.4).

5. **No public surface.** No marketing pages, trials, billing, or plan tiers. The only unauthenticated screen in the entire product is the sign-in page.

6. **Session management appropriate to financial data:** reasonable session lifetime, sign-out everywhere, and re-authentication before sensitive administrative actions (connecting or disconnecting the advertising data source, editing allowed domains, changing another user's role).

7. **Administrators can deactivate a user inside the application**, independently of Google Workspace. A deactivated user is refused even if their Google account is valid and on an allowed domain.

8. **Two separate Google connections exist and must never be conflated.** One is *employee sign-in* — who is using the app. The other is the *advertising data connection* to the agency's manager account — how the app reads client data. They use different scopes and serve different purposes. A regular user signing in must not be able to disturb the data connection; only an administrator manages it, through a deliberate, clearly-labeled action.

### 4.2 Who is not a user

- **Clients do not log in.** They are the subject of the data. If a client-facing portal is ever built, it must be a separately designed surface with its own authentication path, not a role attached to employee login. Out of scope (Section 15).
- **Contractors** either receive a company Workspace account or receive no access. There is no guest tier.

### 4.3 Tenancy

The application serves **one company** today. Even so, scope all data under an **Organization** entity rather than assuming a single global namespace. The organization owns settings, branding, allowed sign-in domains, the advertising data connection, client accounts, and users, and every query for client data should be scoped by it.

The reason is defensive: it costs almost nothing now, it prevents a stray query from becoming a data-leak bug, and it leaves the door open if the company ever operates a second brand. **Do not** build tenant self-signup, per-tenant billing, or anything resembling a marketplace.

### 4.4 Provisioning and first sign-in

Passing the domain check gets an employee in the door, not into everything.

- On a first successful sign-in from an allowed domain, create the user with a **minimal default role** — view-only, no accounts assigned — and notify an administrator that a new employee needs a role and assignments.
- Alternatively, an administrator may **pre-provision** a user by email so they arrive in the correct role with assignments already in place. Support both paths.
- The first user (the owner) is bootstrapped as an administrator during initial setup.

### 4.5 Roles

| Role | Can do |
|---|---|
| **Owner / Admin** | Everything: manage the advertising data connection, manage users and roles, edit allowed email domains, set company branding and product-wide defaults, view all accounts, delete accounts, view audit logs and system health. |
| **Account manager** | Sees accounts assigned to them, and optionally all accounts read-only if the administrator enables it. Edits goals, thresholds, and alert settings for their accounts. Works the alert queue. Writes notes and daily checklists. Cannot change the data connection, users, domains, or branding. |
| **CSM (client success)** | Read-mostly. Sees health, guarantee status, and client-facing summaries for their assigned accounts. Can add notes and generate client reports. Cannot change budgets, thresholds, or alert configuration. |
| **Read-only / Executive** | Portfolio-level views across all accounts. No editing anywhere. For the owner's at-a-glance use and for anyone needing visibility without responsibility. |
| **Deactivated** | Cannot sign in at all. Their historical notes, resolutions, and audit entries remain attributed to them. |

Permissions must be **enforced server-side on every request**, never merely by hiding controls in the interface.

### 4.6 Assignment model

Every client account has:

- One or more **account managers** — they own the account's alert queue and see it in their personal briefing
- Zero or more **CSMs** — they receive visibility under specific conditions (Section 9.5)

Support multiple people in each role per account, modeled as a proper many-to-many relationship.

---

## 5. Core domain model

These are the entities the business requires and the fields that carry meaning. Storage technology, naming, and normalization are yours.

### 5.1 Organization
Company display name (currently "Built by Shah," changing later — Section 1.5), time zone for scheduling and internal timestamps, branding (logo, colors, support contact), **the list of allowed sign-in email domains**, and the default thresholds new client accounts inherit.

Note the deliberate split: the **product name** is fixed in the application; the **company identity** is configuration.

### 5.2 User
Stable internal identifier, one or more **verified email addresses** (so a person survives the domain rename), display name, profile image, role, active/deactivated status, assigned client accounts, notification preferences, last sign-in, and the authentication provider reference. Never keyed by email string.

### 5.3 Advertising data connection
Reference to stored credentials, manager account identifier, connection health, last successful sync, and which administrator authorized it. Stored and scoped separately from employee sign-in credentials.

### 5.4 Client account
The central entity — one per body shop.

**Identity**
- Google Ads customer ID (stored canonically, displayed as `123-456-7890`)
- Google Ads account name, as it appears in the advertising platform
- Client name — the friendly business name shown to humans, which may differ from the account name
- Account time zone — must match the advertising account's time zone; used for all "yesterday" and pacing math
- Currency

**Lifecycle**
- Monitoring enabled or disabled — a paused client remains in the system but is skipped
- Priority (optional) — higher means processed and displayed first
- Campaign start date (optional) — drives lead-pace grace and the 30-day guarantee (Section 8)
- Onboarding status

**Goals — the promises made to the client**
- Daily budget
- Monthly budget (if absent, derive as daily × 30.4)
- Monthly lead goal
- Target CPL

**Thresholds — per-client tuning**
- High CPL multiplier — default **1.5** (CPL above `Target CPL × 1.5` is "too expensive")
- Zero-conversion spend threshold — default **$200** (this much monthly spend with zero leads is an emergency)
- Keyword waste threshold — default **$50** (a single keyword burning this much over 14 days with zero leads is waste)
- Budget pace tolerance — default **15%**
- Lead pace tolerance — default **15%**

**Alerting controls**
- Master alerting on/off for this account
- Individual on/off switches per alert category: budget off pace, leads off pace, high CPL, spend with no conversions, zero spend, unconfigured

**People and context**
- Assigned account manager(s)
- Assigned CSM(s)
- Client-facing report notes (free text used in client summaries)

### 5.5 Metric snapshots (time series)

Store raw daily facts so derived values can be recomputed. At minimum:

- **Account daily** — date, spend, impressions, clicks, conversions, all-conversions
- **Campaign daily** — date, campaign identifier, name, channel type (Search / Performance Max / other), status, its daily budget, spend, impressions, clicks, conversions
- **Keyword daily** (Search only) — date, campaign, ad group, keyword identifier, keyword text, match type, status, spend, impressions, clicks, conversions
- **Geographic** — period, campaign, location at the most specific level available (postal code, city, metro, region, county), location type, spend, impressions, clicks, conversions
- **Device** — period, campaign, device, spend, impressions, clicks, conversions
- **Search term volume** — count of distinct search terms with impressions in a window, used to evidence work performed in client summaries

Derived values — CTR, CPC, CPL, conversion rate, pace percentages — may be computed on read or materialized, but always with safe division.

### 5.6 Health evaluation
Per account per day: overall status, the inputs used, the individual findings, and a timestamp. Retain history so the interface can say "this account has been on Watch for six days."

### 5.7 Alert
Type, account, status, opened-at, a human-readable message containing the real numbers, structured next-step guidance, lifecycle state (open / acknowledged / snoozed / resolved), owner, resolution note, resolved-at, occurrence count, first-seen date, and whether it auto-resolved because the condition cleared.

### 5.8 Ingestion run record
When a run occurred, which accounts it covered, how many succeeded and failed, duration, and per-account error detail. This is the operational audit trail that answers "did it run this morning, and did anything break?"

### 5.9 Notification record
What was delivered, to which user, when, referencing which accounts and alerts, and its read/acknowledged state. Needed so the system can answer "why didn't I see this?"

### 5.10 Daily checklist entry
Per account per day, completed by a human. See Section 11.

### 5.11 Notes and activity
Free-text notes attachable to an account, a specific date, a campaign, a keyword, or a geographic/device row. Plus a system activity feed recording configuration changes and alert actions with attribution.

---

## 6. Data ingestion from Google Ads

Every enabled account is synchronized at least once daily, automatically, on a schedule, without anyone being logged in.

Authentication is through the agency's manager account, so a single authorization grants read access to all client accounts.

**Hard rule: read-only.** The software never modifies anything in Google Ads.

### 6.1 What to collect per account

**Account performance totals** — spend, impressions, clicks, conversions, and all-conversions for these windows, all computed in the **account's own** time zone:
- **Yesterday** — the most recent complete day
- **Month to date** — from the 1st of *yesterday's* month through yesterday. This subtlety matters: on the 1st of a month, "yesterday" belongs to the previous month, and naive logic produces zeros and false alarms. Handle it deliberately.
- **Last 7 days** — yesterday minus six through yesterday
- **Campaign start date through yesterday** — only when a campaign start date exists; required by the guarantee module

**Campaign performance (daily)** — per campaign: identifier, name, channel type, status, its daily budget, and yesterday's spend, impressions, clicks, and conversions. **Search and Performance Max must be kept separate throughout the system.**

**Keyword performance (daily, Search only)** — per keyword: campaign, ad group, identifier, text, match type, status, and yesterday's metrics. Store all of them; page the display.

**Geographic performance** — by the most specific location available, including the location's type. Use "location of presence" (where the person physically was), not "location of interest." Feeds both reporting and waste detection.

**Device performance** — by mobile, desktop, and tablet, per campaign.

**Account configuration and health signals**
- Optimization score (informational)
- Active recommendations with their types, for risk classification (Section 7.6)
- Count of active experiments
- Enabled campaign budgets — used to estimate a daily budget when the agency has not recorded one
- Change history for the last 7 days: what changed, when, by whom, categorized (budget and bidding, keywords, negative keywords, ads, assets, targeting, status changes). Cap retention at a sane volume per account per day — on the order of 2,000 events.
- Distinct search term count over the last 7 days
- Ad approval status — any enabled ad, in an enabled ad group, in an enabled campaign, whose approval status is not "approved"
- Whatever identifiers are needed to construct a direct link into the Google Ads interface for that account (see the caveat in 9.7)

### 6.2 Ingestion requirements

- **Fault isolation** — one account's failure is recorded as that account's failure and does not abort the run.
- **Retry with backoff** for transient errors, distinguished from permanent ones such as revoked access, a closed account, or an incorrect identifier. Permanent failures should raise a configuration problem to a human rather than retrying forever.
- **Respect external API quotas.** Concurrency must be configurable.
- **Idempotent writes** — re-running a date must not duplicate rows.
- **Backfill** — an operator can re-pull a date range for one account or all accounts, after fixing a bug or onboarding a client mid-month.
- **Data revision handling** — conversion data is not final immediately; Google attributes conversions retroactively. Support re-pulling recent days (a rolling three-to-seven-day re-sync is a reasonable default) and make it visible when a previously reported figure was revised.
- **Per-account sync state** — last success, last failure, last error, consecutive failure count.

---

## 7. The analysis engine — health, pacing, and alerts

This is the intellectual core of the product. Implement these rules exactly.

### 7.1 Pacing mathematics

Let:
- `daysInMonth` = number of days in the current month
- `elapsedDays` = today's day-of-month minus 1, so on the 1st this is `0`, correctly meaning no days of this month are yet complete
- `elapsedFraction = elapsedDays / daysInMonth`

Then:

```
expectedSpend = monthlyBudget × elapsedFraction
expectedLeads = monthlyLeadGoal × elapsedFraction

budgetPace = monthToDateSpend / expectedSpend
leadPace   = monthToDateConversions / expectedLeads

actualCPL  = monthToDateSpend / monthToDateConversions
```

All divisions must be safe. A zero or missing denominator yields "not applicable," never zero and never an error.

**Budget pace status**, using the account's budget pace tolerance (default 15%):
- `budgetPace > 1 + tolerance` → **Over pace**
- `budgetPace < 1 − tolerance` → **Under pace**
- otherwise → **On pace**

**Lead pace status** uses the same shape with the lead pace tolerance.

**Resolving the monthly budget** when not explicitly recorded:
1. Use the recorded monthly budget
2. Otherwise `dailyBudget × 30.4`
3. Otherwise sum the enabled campaign budgets from the advertising platform, and mark the value as *estimated* wherever it is displayed

If neither a daily nor a monthly budget can be determined, the account is **unconfigured** and must raise that alert rather than silently pacing against nothing.

**CPL status**, using the high-CPL multiplier (default 1.5):
- No conversions → **No conversions**
- `actualCPL > targetCPL × multiplier` → **Above target**
- `actualCPL < targetCPL × 0.90` → **Below target** (favorable)
- otherwise → **Near target**

**Daily budget utilization** — yesterday's spend ÷ daily budget — produces a human label:
- No daily budget → *Not configured*
- Zero spend → *No spend*
- Above ~205% → *Above twice daily average*
- Above ~115% → *Above daily average*
- Below 50% → *Below daily average*
- Otherwise → *Near daily average*

### 7.2 Health status

Every account receives one of three statuses each day. Begin at **Healthy** and escalate; never downgrade within a single evaluation.

| Condition | Resulting status |
|---|---|
| Budget over or under pace beyond tolerance | at least **Watch** |
| Leads under pace beyond tolerance, and past the grace window | at least **Watch** |
| Leads under pace but *inside* the grace window | record the finding, do **not** escalate |
| CPL above target beyond the multiplier | at least **Watch** |
| Zero conversions yesterday despite spending money | at least **Watch** |
| Failure to read change history | at least **Watch** (data integrity signal) |
| Month-to-date spend ≥ the zero-conversion threshold **and** zero conversions all month | **Needs attention** |
| No delivery yesterday at all — zero spend, zero impressions, and zero clicks — while a daily budget exists | **Needs attention** |

**Grace window:** for the first **7 days** after an account's campaign start date, never escalate or alert on lead pace. A brand-new campaign has not had time to produce leads, and alerting immediately trains people to ignore alerts.

Optimization score below 100% is recorded as an informational note only; it never changes status by itself.

Every evaluation must also produce **attention items** — short, human-readable findings containing the actual numbers, for example: "Month-to-date spend $1,240 versus expected $1,850 — 33% under pace." These become the explanatory bullets throughout the interface.

### 7.3 Alert catalog

Each alert carries a stable type code, the account, a human-readable message containing real, currency-formatted numbers, and structured next-step guidance.

| Alert | Fires when | Gate |
|---|---|---|
| **Zero spend** | Yesterday had zero cost, zero impressions, and zero clicks while a daily budget exists. The account has stopped serving entirely. | Master + own switch |
| **Unconfigured** | Required goals are missing — no daily budget, no monthly budget, and none derivable. | Master + own switch |
| **Budget off pace** | Budget pace status is Over or Under. | Master + own switch |
| **Leads off pace** | Lead pace is Under and the account is past the 7-day grace window. | Master + own switch |
| **High CPL** | CPL status is Above target. | Master + own switch |
| **Spend with no conversions (month to date)** | Month-to-date spend ≥ the zero-conversion threshold and month-to-date conversions are zero. | Master + own switch |
| **Zero conversions yesterday** | Yesterday had spend but zero conversions. | Shares the "spend, no conversions" switch |
| **Keyword waste (14 days)** | A single keyword spent ≥ the waste threshold over 14 days with zero conversions. | Master only |
| **Ad group waste (14 days)** | The same rule at ad-group level. | Master only |
| **Location waste (30 days)** | A location produced ≥ **20 clicks** and **zero conversions** over 30 days. Note this is a *click* threshold, not a spend threshold. | Master only |
| **Disapproved ad** | An enabled ad, in an enabled ad group, in an enabled campaign, is not approved. | Master only |
| **Device high cost per lead** | A device's cost per conversion exceeds **$100** over 30 days while having at least one conversion. | Master only |
| **Sync failure** | The account could not be processed. | Always raised |
| **Needs attention (catch-all)** | Health is "Needs attention" but no specific typed alert fired. | Always raised |

Design the catalog to be **extensible**. New alert types will be added. Do not hard-code the list into interface templates.

### 7.4 Alert guidance — the next steps

This is a differentiating feature and must not collapse into a one-line string. Every alert type carries structured guidance:

- **Title** — what happened, in about five words
- **What this means** — one or two plain sentences, no jargon
- **Checks** — a numbered list of specific things to examine, in the order a skilled practitioner would examine them
- **Remember** — the caveat or judgment call, for example: "before pausing anything expensive, verify conversion tracking is working — 'no leads' is frequently 'no tracking'"
- **Facts** — the actual numbers behind the alert, so nobody has to go find them

The tone should treat the reader as a competent professional who is busy, warn against destructive knee-jerk reactions, and repeatedly reinforce verifying measurement before concluding performance collapsed.

### 7.5 Alert lifecycle

- Alerts are **created** when a condition is detected.
- If the same condition persists tomorrow, **do not create a duplicate.** Update the existing open alert — occurrence count, latest figures, first-seen date — so the interface can say "third day in a row."
- An alert can be **acknowledged** (someone has it), **snoozed** (until a date, with a reason), or **resolved** (with a note).
- An alert **auto-resolves** when the underlying condition clears, recorded as auto-resolved so nobody believes a human fixed it.
- Full history is retained. "How long was this account bleeding money before we caught it?" must be answerable.

### 7.6 Google recommendations, classified by risk

Collect active recommendations and classify each by type into a risk tier. **Never apply them.**

- **High risk** — anything touching budgets, target cost-per-acquisition or return-on-ad-spend, maximize-conversions bidding, broad match, display expansion, moving unused budget, opting into Performance Max, or forecasting. These materially change spend, bidding, or traffic quality. Require explicit human review and state plainly that they should not be applied merely to raise an optimization score.
- **Medium risk** — keywords, responsive search ads, dynamic search ads, audiences, locations, ad strength, campaign or shopping structure. Requires operator approval supported by account evidence.
- **Low risk** — sitelinks, callouts, structured snippets, image assets, business name and logo, call assets, lead form assets. Generally safe completeness suggestions, but claims, URLs, and client details still need verification.
- **Unclassified** — anything unrecognized is flagged for manual classification rather than guessed at.

### 7.7 Change history

Surface what changed in the account over the last 24 hours and last 7 days, categorized. This answers the first question anyone asks when performance shifts: "did someone change something?"

---

## 8. The 30-day money-back guarantee module

This is a commercial commitment feature and warrants its own section because getting it wrong costs the agency real money.

### 8.1 The promise

When a new client starts, the agency guarantees a minimum number of leads within the first 30 days, or the client may request a refund. The window is anchored to that client's **campaign start date**.

### 8.2 Window mathematics

- **Day 1 is the campaign start date itself**, inclusive.
- The window runs **30 calendar days**, ending on `start date + 29 days`. Example: an August 1 start ends August 30.
- `dayNumber` is how many days into the window today is.
- `daysRemaining` is counted inclusively, so on the final day it equals 1.

### 8.3 Behavior while an account is in the window

**Make it impossible to miss.** Every surface that lists accounts must:

1. **Visually flag** in-window accounts distinctively, with a badge reading along the lines of "Day 12 of 30 · money-back." Use **one consistent treatment for every in-window account**. Do *not* introduce a louder, more alarming style for the final few days — that approach was tried and deliberately rejected, because it implicitly signals that the earlier days are safe, and they are not.

2. **Sort in-window accounts to the top** — both within the "needs attention" group and within the "healthy" group. They retain their true health classification; they simply rise to the top of their section. Among in-window accounts, **fewest days remaining comes first.**

3. **Show a lead progress strip** with exactly these four values, hidden entirely when no monthly lead goal is set:

   | Field | Definition |
   |---|---|
   | **Leads so far** | Conversions from the campaign start date through yesterday. Not calendar month-to-date — the window frequently crosses a month boundary. |
   | **Leads needed so far** | `round((dayNumber / 30) × monthlyLeadGoal)` — the prorated target as of today. |
   | **Current lead pace** | `leadsSoFar ÷ leadsNeededSoFar`, displayed as a percentage. |
   | **30-day lead target** | The monthly lead goal. Deliberately reuses the existing goal rather than adding another field for someone to maintain. |

4. **Color the pace value** on these bands:
   - below **100%** → red (behind)
   - **100%–105%** → yellow (barely on track)
   - above **105%** → green (comfortably on track)

   These bands are intentionally stricter than the general lead-pace tolerance of 15%. That is a known and accepted inconsistency — a guarantee deadline deserves less slack than an ordinary month. Explain it in the interface rather than silently "fixing" it.

5. **Show the key dates** — campaign start, guarantee end, and days remaining, rendered as "12 days" or "Last day" on the final day.

6. **Give the CSM visibility** — an in-window account appears in the client success manager's view **even when the account is perfectly healthy** (Section 9.5). The relationship owner should know a refund clock is running regardless of the metrics.

7. **Adjust the tone.** A healthy in-window account still gets a note that the client can claim a refund, so momentum matters. A struggling in-window account gets language treating every open issue as high priority.

### 8.4 After the window
The badge, the special sorting, and the guarantee-driven CSM visibility all stop. The account returns to normal handling.

### 8.5 A related but separate mechanism
The 7-day **lead-pace grace window** (Section 7.2) serves a different purpose: suppressing false alarms on brand-new accounts. Both are driven by the campaign start date. Keep them independent and independently configurable.

---

## 9. Alerts and notifications — delivered in the application

**Version one sends no email.** Everything an employee needs to know is presented inside Built Ads Manager when they sign in. This is a deliberate decision: the team is internal, they will be in the tool daily, and a single authoritative surface beats a parallel stream of messages that can be missed, filtered, or acted on out of date.

Design the notification layer so that **additional delivery channels can be added later without rework** — email, chat, or mobile push may come eventually. Build the abstraction; ship only the in-app channel.

### 9.1 The morning briefing (a screen, not a message)

The centerpiece is a **Today** view that answers "what needs me right now" the moment someone signs in. It is the default landing page for account managers.

It contains:

1. **A portfolio snapshot** — how many of my accounts are healthy, on watch, and needing attention; how many alerts are open; how many accounts are inside a guarantee window.
2. **The action queue** — my accounts requiring attention, most urgent first, with guarantee-window accounts pinned to the top of their group and ordered by nearest deadline.
3. **Watch-level accounts** — the same treatment, lower priority.
4. **Healthy accounts** — collapsed or muted by default, available on demand, so "everything is fine" is an explicit, visible statement rather than an absence of information.
5. **Data freshness** — when the most recent sync completed and whether anything failed. A stale or partially failed sync must be obvious, because acting on yesterday's stale data is worse than knowing the data is stale.

Each account in the queue is a **card** carrying:

- Client name, advertising account name, formatted customer ID
- Health status
- Guarantee badge and lead progress strip when applicable (Section 8)
- A **key metrics strip** of six values: yesterday's spend, yesterday's leads, budget pace, lead pace, month-to-date CPL, target CPL
- Plain-language findings explaining the status, with real numbers
- The **next-step guidance** for anything not healthy, fully visible without extra clicking
- Assigned CSM
- Direct links to open the account's full detail view, and to open the account in Google Ads

### 9.2 The notification center

Separate from the daily briefing, a persistent notification feed covering events the user should know about:

- New alerts on their accounts
- Alerts that escalated, or that have now persisted for several consecutive days
- Alerts auto-resolved because the condition cleared
- Accounts entering a guarantee window, and guarantee windows approaching their final week
- Sync failures affecting their accounts
- Assignment changes and mentions from teammates

Requirements: unread state per user, mark-as-read individually and in bulk, an unread count visible from anywhere in the application, filtering by account and by type, and retention long enough to review history rather than a transient toast.

**Never rely solely on an ephemeral pop-up to convey something important.** Anything worth interrupting someone about must also be durable in the feed.

### 9.3 The alert queue as a work surface

The alert queue is a workflow tool, not a log. From it a user can:

- Sort and filter by urgency, age, account, alert type, and assignee
- See full next-step guidance inline
- **Acknowledge** (I am on this), **snooze** (until a date, with a reason), and **resolve** (with a note)
- Act in bulk
- Filter to "mine," "unassigned," and "aging" — an alert that has sat open for days should visibly age
- See the alert's history, including how many consecutive days the condition has held

### 9.4 Real-time versus periodic

The interface should reflect current state without requiring a manual refresh — after a nightly sync, an open browser should update, or at minimum clearly indicate that newer data is available. Choose the mechanism.

### 9.5 CSM visibility rule

A client success manager sees an account surfaced in their view when either:

- the account has open problems, **or**
- the account is inside its 30-day money-back window — **including when it is healthy**

This mirrors the relationship reality: the person who owns the client conversation needs to know about trouble *and* about a running refund clock.

### 9.6 The "all clear" state must be explicit

When nothing needs attention, say so plainly and confidently — "All 23 of your accounts are healthy as of this morning's sync." Silence is ambiguous and erodes trust in the system. An empty screen makes people wonder whether the software ran.

### 9.7 Links into Google Ads — a known limitation

Links that open a specific account in the Google Ads interface frequently land on Google's account-chooser screen when the user is signed into multiple Google accounts. This is Google-side session behavior and **cannot be reliably solved** from the link. Do not spend time attempting it. Set expectations in the interface and offer a copyable customer ID as a fallback.

### 9.8 Per-user preferences

Even without external channels, users should control what surfaces to them: which alert types appear in their feed, whether they see only assigned accounts or all accounts, and their default landing view.

### 9.9 Explicitly deferred

Email, chat integrations, mobile push, SMS, and scheduled report delivery are **not** part of this version. Do not build them, design templates for them, or let them influence the architecture beyond keeping the notification layer channel-agnostic.

---

## 10. Application surfaces

You own the visual design. These are the jobs each screen must perform.

### 10.1 Today / morning briefing
The default landing view. Described in Section 9.1.

### 10.2 Portfolio view
All accounts the user can see, in a dense, scannable table: health, guarantee badge, yesterday's spend and leads, budget pace, lead pace, CPL versus target, open alert count, and last sync. Filterable by health, manager, CSM, guarantee status, and alert type. Sortable on every column. Portfolio totals across the top. Must be scannable in seconds by someone who manages seventy accounts.

### 10.3 Alert queue
Described in Section 9.3.

### 10.4 Account detail
Everything about one client, and only that client:

- **Overview** — health, pacing, guarantee status, month-to-date goal progress, trend charts
- **Daily history** — one row per day: date, overall status, budget status, expected spend, actual month-to-date spend, budget pace, lead status, expected leads, conversions, lead pace, actual CPL, target CPL, CPL status, active alerts, notes. Newest first.
- **Search campaigns (daily)** — per campaign per day: identifier, name, status, whether the agency is actively monitoring it, whether it is expected to spend, daily budget, spend, impressions, clicks, CTR, average CPC, conversions, conversion rate, CPL, target CPL, CPL status, spend status, alerts, notes
- **Performance Max campaigns (daily)** — the same, minus keyword-related concepts
- **Search keywords (daily)** — campaign, ad group, keyword text, match type, status, monitoring flag, spend, impressions, clicks, CTR, average CPC, conversions, conversion rate, CPL, target CPL, CPL status, alerts, notes. Sortable, searchable, paged — this table is large.
- **Locations** — weekly by default with rolling 7-day and 30-day options: campaign, location, location type, spend, impressions, clicks, CTR, conversions, conversion rate, CPL, CPL status, alert, a human-set **action status** (Keep / Review / Exclude / Insufficient data), and notes
- **Devices** — the same shape, by device
- **Change history** — recent account changes, categorized
- **Recommendations** — grouped by risk tier, never auto-applied
- **Daily checklist** — Section 11
- **Settings** — goals, thresholds, alert switches, assignments, campaign start date
- **Notes and activity** — the complete audit trail

**Monitoring flags:** users must be able to mark specific campaigns and ad groups as "monitored" and "expected to spend," and those flags govern whether alerts fire for unexpected activity. This is how a manager suppresses noise from campaigns they intentionally paused or are deliberately testing.

### 10.5 Client-facing report view
A clean summary safe to share with a body shop owner: spend, leads, cost per lead, trend, work performed, and the manager's notes. Exportable as a document. Carries current company branding (Section 1.5). No internal thresholds, no alert plumbing, no other clients, no internal commentary.

Note: *generating* and *downloading* a report is in scope. *Emailing* it on a schedule is not (Section 9.9).

### 10.6 Account settings and onboarding
See Section 12.

### 10.7 Organization administration
Administrator-only:

- **Advertising data connection** — status, who authorized it, health, reconnect
- **Users and access** — every employee, their role, assigned accounts, last sign-in; change roles; deactivate departed staff; pre-provision a new hire by email; link a second email address to an existing person for the domain rename
- **Allowed sign-in domains** — add, remove, and review the company email domains permitted to sign in. A sensitive action: require re-authentication, log it, and warn before removing a domain still in active use.
- **Rejected sign-in attempts** — a short log so the owner can see if anyone outside the company attempted access
- **Company branding** — display name, logo, colors, support contact. This is what makes a company rename a settings change rather than a deployment.
- **Defaults for new client accounts** — thresholds, tolerances, alert switches
- **Sync schedule and system defaults**

### 10.8 System health and run history
Every ingestion run: when it ran, accounts covered, succeeded, failed, duration, and per-account errors. An operator must answer "did it run this morning and did anything break?" at a glance. Includes manual re-run and backfill controls, and the health of the advertising data connection.

---

## 11. The daily checklist — human workflow, not automation

Each account has a daily checklist the manager completes by hand. **Automation must never write to it.** It exists because reviewing numbers is not the same as doing the work, and the agency wants a durable record that the work happened.

One entry per account per day, newest first:

| Field | Options |
|---|---|
| Date | automatic |
| Alerts reviewed | All clear / Follow-up needed / Critical alert |
| Budget pace | On pace / Soft miss / Off pace — fix |
| Lead pace | On pace / Soft miss / Off pace — fix |
| Conversions | Leads OK / Thin day / Zero leads with spend |
| Trend check | Stable / Watching a change / Big swing — dig in |
| Search terms | Clean / Cleanup done / Heavy waste |
| Negatives audit | Clean / Fixed a bad block / Critical false block |
| Client meeting | Not needed / Scheduled |
| Day status | Good / Needs attention / Urgent |
| Note type | Note / Follow-up / Experiment |
| Daily notes | Free text |

Each choice carries a green / yellow / red meaning visible at a glance. Users should see completion streaks, filter for accounts not checked recently, and find prior follow-ups later — a note marked "Follow-up" is a commitment, not a comment.

---

## 12. Onboarding a client account

Adding client #71 must be a guided flow, not tribal knowledge.

**Required**
- Business display name
- Google Ads account ID — validate it exists and is reachable through the connected manager account
- Google Ads account name
- Client name (friendly)
- Time zone — must match the advertising account; verify and warn on mismatch
- Daily budget, monthly lead goal, target CPL
- Assigned account manager
- Enabled or disabled at launch

**Defaulted, confirmable**
- Monthly budget (suggest daily × 30.4)
- High CPL multiplier (1.5)
- Zero-conversion spend threshold (organization default)
- Budget and lead pace tolerance (15%)
- Keyword waste threshold ($50)
- All alert switches on

**Optional**
- CSM assignment
- Priority
- **Campaign start date** — prompt explicitly and explain that it drives both the 7-day lead-pace grace and the 30-day guarantee tracking. This is easy to forget and expensive to forget.
- Client report notes
- Which campaigns and ad groups to actively monitor and expect to spend

On completion: validate access, run an immediate first sync, backfill a sensible history window, and open the account's detail view. If required information is missing, show an explicit "not ready" state rather than silently under-reporting.

**Bulk import is required.** Roughly 70 accounts already exist with their goals, thresholds, assignments, alert settings, and campaign start dates recorded in tabular form. Support importing them in bulk from a standard tabular file, with validation, a preview of what will be created, and a clear error report for rows that cannot be imported. Historical performance data should be backfilled from the advertising platform rather than imported, since the platform is the authoritative source.

---

## 13. Non-functional requirements

### 13.1 Correctness
The highest priority in this product. See Section 3.2 for the specific rules on time zones, safe arithmetic, exact currency handling, and recomputability.

### 13.2 Reliability
- One account's failure never affects another's
- Failures are visible, retryable, and surfaced to a human
- Partial success is a first-class, honestly represented outcome
- Background work is resumable after a crash or deploy

### 13.3 Scale
- 70 accounts today; 500+ without redesign
- A full daily sync of 500 accounts completes within a sane morning window — target well under an hour
- Interface remains responsive with years of daily history and very large keyword tables
- Nothing in the design may assume a small, fixed number of accounts

### 13.4 Security and privacy

This application holds ~70 clients' advertising performance, the agency's internal thresholds and commentary, and evidence of which clients are underperforming. Treat it as sensitive.

- **Employee-only access enforced at the authentication layer** (Section 4.1): Google sign-in only, approved company domains only, no self-service registration, no password to attack.
- **Domain verification happens server-side against the verified email from the identity provider.** Never trust a client-supplied claim; never accept an unverified email address.
- **Deactivation is immediate and total**, including active sessions.
- Credentials and tokens encrypted at rest, never logged, never exposed to the browser.
- Employee sign-in credentials and the advertising data connection stored and scoped separately.
- Strict organization and account isolation — a query bug must never leak across boundaries.
- Role checks enforced server-side on every request.
- Audit trail for every configuration change: who, what, when, and previous value. Includes role changes, domain-list changes, connection changes, and goal or threshold edits.
- Authentication events logged, including rejected sign-ins from unapproved domains.
- Client-facing output must never leak internal thresholds, other clients, or internal commentary.
- Defined data retention, plus export and deletion capability.

### 13.5 Observability
- Structured logs, metrics, and traces across background work
- Self-monitoring with operator alerting: ingestion failures, expiring credentials, notification failures, queue backlog
- An administrator view answering "is the system healthy right now?"

### 13.6 Configuration
Anything that would otherwise be a constant becomes organization-level configuration with sensible defaults, overridable per account where it makes sense: thresholds, tolerances, grace period, guarantee length, waste rules, notification behavior, sync schedule, and reporting week start.

---

## 14. Design principles

- **Triage first.** The default view answers "what needs me today," not "here is all the data."
- **Plain language everywhere.** Write for a capable person who does not know the jargon. This tone is a genuine competitive advantage in this business — do not let the interface drift into platform terminology.
- **Never show a number without its context.** Spend is meaningless without expected spend. CPL is meaningless without target CPL.
- **Distinguish kinds of data visually** — values pulled from the advertising platform, values a human entered, and values the system calculated should be recognizably different. Users must always know whether a number is fact, judgment, or derivation.
- **Traffic-light coloring on pace metrics** is familiar and expected here: green comfortably on track, yellow marginal, red behind. Suggested thresholds: green above 105%, yellow 95–105%, red below 95%.
- **Newest first** in every history view. Nobody scrolls to the bottom of four hundred rows.
- **Every problem shows its fix.** No dead-end alerts.
- **Fast.** People use this at 7:00 AM before they are fully awake. Every extra click costs adoption.
- **Accessible.** Never encode meaning in color alone; keyboard navigable; sufficient contrast.
- **Mobile-usable** at least for triage and alert acknowledgement.

---

## 15. Explicitly out of scope

Do not build these. Each is a deliberate decision.

- **Any write operation to Google Ads.** No bid changes, no budget changes, no pausing, no adding negative keywords, no applying recommendations. This is an observation and alerting product.
- **Email, chat, SMS, or push delivery of alerts and reports** in this version (Section 9.9). Keep the notification layer channel-agnostic; ship in-app only.
- **A single combined view mixing every client's campaigns and keywords together.** Per-client isolation is the design. Portfolio-level views show account-level roll-ups only.
- **Keyword or asset-group reporting for Performance Max.** It has no keywords; campaign level is the correct grain.
- **Ad-group-level reporting as a primary view for Search.** Keyword level is the useful grain. Ad-group waste exists as an *alert*, not a reporting surface.
- **Automated bidding or budget optimization.**
- **Any public or self-service surface** — no marketing site, sign-up page, trial, pricing, billing, subscription management, seat purchasing, or tenant self-onboarding.
- **Authentication other than Google sign-in on an approved company domain** (Section 4.1).
- **Client logins or a client portal.** Clients receive documents; they do not log in.
- **Automating the daily checklist.** It is intentionally human.
- **Hard-coding the company name.** Company identity is configuration (Section 1.5).
- **Any spreadsheet, document, or file acting as a system of record** (Section 3.1).

---

## 16. Open questions and future work

Flag these; do not silently decide them.

1. **Splitting conversions into phone calls versus form submissions.** Highly desired. The advertising platform can segment conversions by conversion action and by conversion action category — categories include phone-call leads and lead-form submissions — at both account and campaign level, while still reporting a total. The catch is that it only works when each client's conversion actions are categorized correctly, and call-tracking imports frequently arrive with a generic category. A robust implementation needs either reliance on the category when correctly set, or a per-account mapping of conversion action names to "call" / "form" / "other" maintained inside the application. **Design the conversion data model so this split can be added later without a migration.** This is the most-requested enhancement.
2. **Additional notification channels.** Email, chat, and mobile push are deferred, not rejected. The abstraction should make adding them straightforward.
3. **Client-facing access.** A portal would change the product's risk profile and support burden and would need an authentication path entirely separate from employee sign-in.
4. **The company rebrand.** Timing is undecided. The application must already support it as a settings change: both email domains valid simultaneously, second addresses linkable to existing users, and all company branding read from configuration. Note that identities appear throughout historical records — who resolved an alert, who wrote a note — which is precisely why users must not be keyed by email address.
5. **How much history to backfill at onboarding**, and how to present figures the advertising platform revises after the fact.
6. **Multi-currency and non-US accounts** — supported in the model, unproven in practice.
7. **Cross-account benchmarking.** With ~70 comparable businesses, portfolio insight such as "this account's CPL is 40% above the fleet median" becomes valuable, and is an argument for storing raw facts centrally.
8. **Anomaly detection beyond fixed thresholds.** Statistical detection of unusual drops would catch problems fixed rules miss.
9. **Attribution beyond the advertising platform.** Call tracking, CRM outcomes, and closed revenue would eventually let "leads" mean "good leads."

---

## 17. Acceptance criteria

The build is not complete until every item below is demonstrably true.

**Access and identity**
1. An employee with a `builtbyshah.com` address signs in with Google in one click and reaches their briefing.
2. A personal Gmail address, a client address, or any address outside the approved list is refused with a clear message, creates no user record, and is logged for the administrator.
3. There is no sign-up page, no password field, and no way to create an account from outside the application.
4. An administrator can add a second approved domain, and an employee signing in with the new address lands in their **existing** user account with all history, assignments, and notes intact.
5. Deactivating a user blocks sign-in immediately even though their Google account remains valid, while their past notes and resolutions stay attributed to them.
6. Role permissions are enforced server-side: a CSM cannot modify budgets or thresholds by calling the API directly.
7. The product displays as "Built Ads Manager" throughout, and changing the company display name and logo in settings updates client-facing output without a code change.

**Data**
8. Connecting the advertising manager account discovers the client accounts beneath it.
9. A scheduled daily sync populates account, campaign (Search and Performance Max separately), keyword, geographic, and device data for every enabled account, with no user logged in.
10. All date windows compute in each account's own time zone; two accounts in different zones can have different "yesterdays" in the same run.
11. On the first day of a month, month-to-date figures correctly reflect the previous month through yesterday, and no false pacing alerts fire.
12. One account failing does not prevent others from completing; the failure is visible, explained, and retryable.
13. Re-running a sync for the same date produces no duplicate data.
14. An operator can backfill a date range for one account or all accounts.

**Analysis**
15. Pacing, CPL, and health status match Section 7 exactly, verified against business-supplied expected results for real accounts on specific dates.
16. No screen or export ever renders `NaN`, `Infinity`, or a division-by-zero artifact, and missing data never displays as zero.
17. Every alert in Section 7.3 can be triggered with test data and produces a correct message plus next-step guidance.
18. Per-account and per-type alert switches suppress alerts as specified.
19. Lead-pace alerts are suppressed inside the 7-day grace window and resume afterward.
20. A persisting condition updates the existing alert rather than duplicating it, and auto-resolves when the condition clears.

**Guarantee module**
21. An account whose campaign start date was 12 days ago shows "Day 12 of 30," the correct end date, and correct days remaining.
22. In-window accounts sort to the top of their section, ordered by fewest days remaining.
23. The lead strip's four values and color bands match Section 8.3 exactly, and the strip is hidden when no lead goal exists.
24. A healthy in-window account still appears in its CSM's view.
25. On day 31, all guarantee treatment stops.

**In-app alerting**
26. Signing in presents a briefing covering only the user's accounts, with guarantee accounts first and then urgency order.
27. When nothing needs attention, the interface states so explicitly rather than showing an empty screen.
28. The notification feed retains unread state per user, supports mark-as-read individually and in bulk, and shows an unread count application-wide.
29. Alerts can be acknowledged, snoozed with a reason and date, and resolved with a note, with full history retained.
30. Sync failures and stale data are impossible to overlook on the briefing.
31. No email is sent by the application under any circumstance.

**Application**
32. An account manager can triage an entire 70-account portfolio in under two minutes.
33. Each client's data is fully isolated; no view mixes clients.
34. The daily checklist is human-editable and never written to by automation.
35. Goals and thresholds are edited in exactly one place and take effect everywhere immediately.
36. Onboarding a client account takes under five minutes and validates advertising-platform access before completing.
37. Roughly 70 accounts can be imported in bulk from a tabular file, with validation and a clear error report.

**Engineering**
38. All application data resides in a database with an enforced schema, constraints, and versioned migrations. No spreadsheet, document, or file is part of the data path.
39. Automated tests cover pacing, health, every alert condition, guarantee math, time-zone handling, month boundaries, and access control.
40. Backups exist and a restore has been performed successfully in a non-production environment.

---

## 18. Suggested delivery plan

Sequence matters. Each phase should be independently useful.

### Phase 0 — Foundations and access
Architecture decision record and data model, with the database choice justified in writing. **Authentication first:** Google sign-in, the approved-domain check, user records supporting multiple linked emails, server-side role enforcement, administrator bootstrap, and the admin screens for users and domains. Then organization settings and branding, the advertising data connection (kept strictly separate from sign-in), and a single client account ingesting end to end.

**Exit:** the owner and one employee sign in with work Google accounts, a personal Gmail is refused, and one real client account's data lands in the database on a schedule and is viewable.

*Build authentication before features. Retrofitting access control onto a finished application is where security bugs come from, and this application holds every client's performance data.*

### Phase 1 — Ingestion at scale
All data types: account totals, Search and Performance Max campaigns, keywords, geographic, device, change history, recommendations, ad approvals. Scheduling, configurable concurrency, retries, per-account fault isolation, run history, and backfill.

**Exit:** all 70 accounts ingest reliably every morning, and any failure is visible and explained.

### Phase 2 — The analysis engine
Pacing, health, the complete alert catalog with gates and thresholds, structured next-step guidance, and alert lifecycle with deduplication and auto-resolution.

**Exit:** health status and alerts for real accounts match the business-supplied expected results for specific historical dates. Treat this as a release gate.

### Phase 3 — The in-app experience
The Today briefing, portfolio view, alert queue as a working surface, notification center with unread state, and the explicit all-clear state.

**Exit:** an account manager can run their entire morning inside the application.

### Phase 4 — Account depth
Full account detail: daily history, campaigns, keywords, geographic, device, change history, recommendations, notes, monitoring flags, and per-account settings.

**Exit:** every question a manager asks about one client is answerable in the application.

### Phase 5 — Guarantee module and daily checklist
Complete 30-day guarantee treatment across every surface, plus the daily checklist.

**Exit:** no guarantee deadline can pass unnoticed without someone ignoring a screen they look at daily.

### Phase 6 — Onboarding, bulk import, and client reporting
Guided onboarding, bulk import of the existing ~70 accounts, and the client-facing report view with export.

**Exit:** the business runs entirely on this application.

### Phase 7 — Hardening and expansion
Performance work, additional notification channels if wanted, conversion type splitting (Section 16.1), benchmarking, and anomaly detection.

---

## 19. A closing note on why the details matter

Nearly every specific number in this document — the 1.5× CPL multiplier, the 7-day grace window, the 20-click location threshold, the decision not to make the final guarantee days visually louder, the insistence on verifying conversion tracking before concluding leads collapsed, the refusal to let missing data render as zero — exists because a real situation demanded it.

Treat them as field-tested defaults rather than arbitrary constants. Make them configurable, ship them as written, and be skeptical of simplifications that quietly discard one of them.

Three constraints deserve repeating, because they are the easiest to drift away from and the most expensive to retrofit:

- **Built Ads Manager is internal staff software.** Google sign-in only, approved company domains only, no self-service registration, no public surface beyond a sign-in screen. Build the access layer first.
- **Everything lives in a real database.** No spreadsheet, document, or file may sit in the data path where a person can accidentally break it. The whole point of this build is a system that cannot be corrupted by a stray edit.
- **The company name is data, not code.** The product stays "Built Ads Manager" while the company name changes around it. Anything displaying the company must be editable by a non-engineer in settings.

Beyond those, the architecture is yours. Choose deliberately, justify it, and build something the business can trust with seventy clients' money every morning.
