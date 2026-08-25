/**
 * BUILT BY SHAH - Hub Workbook Generator
 * Version: 1.6.0
 *
 * Creates ONE agency Hub Google Sheet for ALL body shops you manage.
 * Add one Config row per body shop / Google Ads account. Each shop still gets
 * its own spoke Sheet (create-body-shop-workbook.gs); paste those URLs here.
 *
 * How to use:
 *   1. Open https://script.google.com → New project
 *   2. Paste this entire file (replace any default Code.gs contents)
 *   3. Optionally edit SETUP_CONFIG.WORKBOOK_BASE_NAME
 *   4. Select createHubWorkbook → Run (authorize when prompted)
 *   5. Copy the spreadsheet URL from Execution log / alert popup
 *   6. On the Config tab: one row per body shop (goals, alerts, spoke URL)
 *   7. Create each spoke with create-body-shop-workbook.gs, then paste its URL
 *      into that shop's Spoke Spreadsheet URL cell
 *
 * Naming rule: the Google Sheet file name always includes the template version,
 * e.g. "Built by Shah - Google Ads Hub (V 1.6.0)".
 *
 * Tab order: working tabs first (Config, Alerts, Run Log); Instructions and
 * Definitions always last on the tab bar.
 * Existing Hubs: to move Campaign Start Date next to Priority without
 * rebuilding, run apps-script/move-hub-campaign-start-date-next-to-priority.gs.
 *
 * Whenever Hub tabs are added, renamed, or their purpose changes, update
 * writeInstructionsSheet_ so Instructions always explain every tab.
 * Whenever a Config column is added or renamed, add/update its entry in
 * CONFIG_COLUMN_DEFINITIONS (Definitions tab is built from that map).
 */

var TEMPLATE_VERSION = '1.6.0';

var SETUP_CONFIG = {
  EXISTING_SPREADSHEET_URL: '',
  WORKBOOK_BASE_NAME: 'Built by Shah - Google Ads Hub',
  INCLUDE_SAMPLE_CONFIG_ROW: true
};

// Calm, readable agency palette (not bright Google blue / neon yellow).
var COLORS = {
  TITLE: '#17324D',
  HEADER: '#243B55',
  HEADER_OPS: '#2F5D50',
  HEADER_GOALS: '#3A5A78',
  HEADER_THRESHOLDS: '#4A6A82',
  HEADER_ALERT: '#3D4F66',
  HEADER_PEOPLE: '#5A6E82',
  HEADER_NEGATIVES: '#5C4A3A',
  USER_INPUT: '#F7F3E8',
  SCRIPT: '#E6EEE9',
  LABEL: '#EEF2F5',
  WHITE: '#FFFFFF',
  TEXT: '#1A1A1A',
  WARN_SOFT: '#FCE8E6',
  SAMPLE: '#E8F0FE'
};

var SHEETS = {
  INSTRUCTIONS: 'Instructions',
  DEFINITIONS: 'Definitions',
  CONFIG: 'Config',
  RUN_LOG: 'Run Log',
  ALERTS: 'Alerts'
};

// Human-readable headers (spaces, no underscores). Engine must match these exactly.
var CONFIG_HEADERS = [
  'Account ID',
  'Account Name',
  'Enabled',
  'Priority',
  'Campaign Start Date',
  'Last Successful Run',
  'Negatives Sweeper Enabled',
  'Negatives Last Successful Run',
  'Negatives PMax Last Successful Run',
  'Negatives Disabled Rule IDs',
  'Negatives Protected Phrases',
  'Negatives Competitor Phrases',
  'Client Name',
  'Spoke Spreadsheet URL',
  'Time Zone',
  'Daily Budget',
  'Monthly Budget',
  'Monthly Lead Goal',
  'Target CPL',
  'Alerts Enabled',
  'High CPL Multiplier',
  'Zero Conversion Spend Alert',
  'Keyword Waste Spend Threshold',
  'Budget Pace Tolerance',
  'Lead Pace Tolerance',
  'Alert: Budget Off Pace',
  'Alert: Leads Off Pace',
  'Alert: High CPL',
  'Alert: Spend No Conversions',
  'Alert: Zero Spend',
  'Alert: Unconfigured',
  'Account Manager Name',
  'Account Manager Email',
  'CSM Name',
  'CSM Email',
  'Client Report Notes'
];

/**
 * Header background bands so managers can scan Config groups quickly.
 * Keys must match CONFIG_HEADERS exactly.
 */
var CONFIG_HEADER_BANDS = {
  'Account ID': 'HEADER',
  'Account Name': 'HEADER',
  Enabled: 'HEADER_OPS',
  Priority: 'HEADER_OPS',
  'Campaign Start Date': 'HEADER_OPS',
  'Last Successful Run': 'HEADER_OPS',
  'Negatives Sweeper Enabled': 'HEADER_NEGATIVES',
  'Negatives Last Successful Run': 'HEADER_NEGATIVES',
  'Negatives PMax Last Successful Run': 'HEADER_NEGATIVES',
  'Negatives Disabled Rule IDs': 'HEADER_NEGATIVES',
  'Negatives Protected Phrases': 'HEADER_NEGATIVES',
  'Negatives Competitor Phrases': 'HEADER_NEGATIVES',
  'Client Name': 'HEADER',
  'Spoke Spreadsheet URL': 'HEADER',
  'Time Zone': 'HEADER',
  'Daily Budget': 'HEADER_GOALS',
  'Monthly Budget': 'HEADER_GOALS',
  'Monthly Lead Goal': 'HEADER_GOALS',
  'Target CPL': 'HEADER_GOALS',
  'Alerts Enabled': 'HEADER_THRESHOLDS',
  'High CPL Multiplier': 'HEADER_THRESHOLDS',
  'Zero Conversion Spend Alert': 'HEADER_THRESHOLDS',
  'Keyword Waste Spend Threshold': 'HEADER_THRESHOLDS',
  'Budget Pace Tolerance': 'HEADER_THRESHOLDS',
  'Lead Pace Tolerance': 'HEADER_THRESHOLDS',
  'Alert: Budget Off Pace': 'HEADER_ALERT',
  'Alert: Leads Off Pace': 'HEADER_ALERT',
  'Alert: High CPL': 'HEADER_ALERT',
  'Alert: Spend No Conversions': 'HEADER_ALERT',
  'Alert: Zero Spend': 'HEADER_ALERT',
  'Alert: Unconfigured': 'HEADER_ALERT',
  'Account Manager Name': 'HEADER_PEOPLE',
  'Account Manager Email': 'HEADER_PEOPLE',
  'CSM Name': 'HEADER_PEOPLE',
  'CSM Email': 'HEADER_PEOPLE',
  'Client Report Notes': 'HEADER_PEOPLE'
};

/**
 * Plain-language meaning for every Config column, same order as CONFIG_HEADERS.
 * Write these like you are explaining to a new teammate (simple words + examples).
 * When you add a Config column, add a definition here too - Definitions tab is built from this.
 */
var CONFIG_COLUMN_DEFINITIONS = {
  'Account ID':
      'This is the ID number Google Ads gives this body shop\'s ad account. ' +
      'It looks like 123-456-7890. Copy it exactly from Google Ads. ' +
      'Important: leave it as text. If Sheets turns it into a regular number, the dashes can disappear and the ID can break.',

  'Account Name':
      'This is the nickname for the Google Ads account, usually the same name you see inside Google Ads. ' +
      'Example: "Auto Arena Body Shop - Search." ' +
      'We use this name in Run Log, Alerts, and emails so you can tell shops apart quickly.',

  'Enabled':
      'Turns Engine monitoring on for this shop. ' +
      'Choose Enabled if the Engine should check this account. ' +
      'Choose Disabled if you want to keep the row here but skip this account for now. ' +
      'If this is Disabled, the negatives sweeper also skips this shop. ' +
      'Example: a shop that is not live yet can stay Disabled until launch day.',

  'Negatives Sweeper Enabled':
      'Turns the daily auto-negative script on for this shop. ' +
      'Needs Enabled = Enabled too, plus a Spoke Spreadsheet URL. ' +
      'Example: Enabled + Negatives Sweeper Enabled + Spoke URL → this shop is swept. ' +
      'Choose Disabled to keep Engine metrics but stop auto-negatives for this shop only.',

  'Negatives Last Successful Run':
      'Filled by the Search negatives sweeper (soft green). ' +
      'Shows the last date this shop finished a full Search negatives sweep successfully. ' +
      'Blank or not today means the shop is still due for today\'s Search negatives queue. ' +
      'Do not edit this by hand unless you are intentionally forcing a re-run.',

  'Negatives PMax Last Successful Run':
      'Filled by the PMax negatives sweeper (soft green). ' +
      'Separate from the Search stamp so both scripts can run on the same day. ' +
      'Blank or not today means the shop is still due for today\'s PMax negatives queue. ' +
      'Do not edit this by hand unless you are intentionally forcing a re-run.',

  'Negatives Disabled Rule IDs':
      'Comma-separated rule IDs to skip for this shop only. ' +
      'Example: AUTO_GLASS, PAINTLESS_DENT, YEAR_TOKEN, FREE_ESTIMATE if they sell glass/PDR, want model-year queries, or want free-estimate traffic. ' +
      'Full ID list is in the Search negatives sweeper guide (same rules for PMax). ' +
      'Official IDs are listed in docs/Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md ' +
      'and on the Hub Instructions tab.',

  'Negatives Protected Phrases':
      'Comma-separated phrases; search queries containing them are never auto-negatived. ' +
      'Example: mobile repair, ceramic coating. ' +
      'Client Name and Account Name are protected automatically — you do not need to re-type the shop brand here.',

  'Negatives Competitor Phrases':
      'Comma-separated local or competitor names to treat as junk search intent for this shop. ' +
      'Example: caliber collision, service king. ' +
      'These feed the LOCAL_COMPETITOR rule. Seed national chains also live in the sweeper script.',

  'Client Name':
      'This is the body shop\'s business name for people (not the computer). ' +
      'It can be different from the Account Name. ' +
      'Example: Account Name might be "Auto Arena Ads," while Client Name is "Auto Arena Body Shop." ' +
      'This is for you and your team. The script does not need it to find the right Sheet.',

  'Spoke Spreadsheet URL':
      'Paste the full web link to this shop\'s own Google Sheet (the "spoke"). ' +
      'That spoke Sheet is where daily numbers for this one shop live. ' +
      'Example: https://docs.google.com/spreadsheets/d/abc123/edit ' +
      'If this is blank and Enabled is on, the script cannot know where to write the shop\'s data.',

  'Time Zone':
      'The time zone for this shop\'s Google Sheet dates (and synced onto the spoke). ' +
      'Pick the same zone the Google Ads account uses. ' +
      'Example: America/New_York or America/Los_Angeles. ' +
      'Edit it here on the Hub only. The Engine copies it into the spoke and can set the spoke Sheet time zone. ' +
      'Ads pacing still uses the live Google Ads account time zone for yesterday / month-to-date math.',

  'Daily Budget':
      'How much money this shop is approved to spend on ads on an average day. ' +
      'Example: if Daily Budget is $100, we expect about $100 of ad spend per day. ' +
      'We use this to check whether spend is too high or too low. ' +
      'This number is also copied into the spoke Sheet so formulas can use it.',

  'Monthly Budget':
      'How much money this shop is approved to spend on ads for the whole month. ' +
      'Example: Daily Budget $100 and a 30-day month is often about $3,000 - but type the real approved monthly number. ' +
      'We use this for month-level planning and pacing checks.',

  'Monthly Lead Goal':
      'How many leads (phone calls or form fills that count as wins) this shop should get this month. ' +
      'Example: 40 means "we want about 40 leads this month." ' +
      'We use this to see if lead volume is on track. This number is copied into the spoke Sheet.',

  'Target CPL':
      'CPL means "cost per lead" - how much you pay, on average, for one lead. ' +
      'Target CPL is the goal price per lead. ' +
      'Example: Target CPL $100 means "we hope each lead costs about $100." ' +
      'If real CPL gets much higher than this, we may flag High CPL. This number is copied into the spoke Sheet.',

  'Alerts Enabled':
      'This is the master switch for alert emails on this shop. ' +
      'Enabled = the script may email you when something looks wrong (if that alert\'s own switch is also on). ' +
      'Disabled = the script still updates the Sheets, but it will not send alert emails for this shop. ' +
      'Example: turn this off while you are still setting up a new account so you do not get noisy emails.',

  'High CPL Multiplier':
      'This tells us how much higher than Target CPL is "too expensive." ' +
      'We multiply Target CPL × this number. ' +
      'Example: Target CPL is $100 and this is 1.5. Then $100 × 1.5 = $150. ' +
      'If real CPL goes above about $150, that can count as High CPL. ' +
      'This number is copied into the spoke Sheet.',

  'Zero Conversion Spend Alert':
      'This answers: "How much money can we spend with ZERO leads before we worry?" ' +
      'Type a dollar amount. ' +
      'Example: if this is 100, and the shop spends $100 (or more) but gets 0 leads, that is a warning sign. ' +
      'Spending $20 with 0 leads might be fine early on; spending $100+ with 0 leads is more serious. ' +
      'If Alert: Spend No Conversions is also Enabled, we can email about it. This number is copied into the spoke Sheet.',

  'Keyword Waste Spend Threshold':
      'This answers: "How much can one keyword or Search ad group spend over the last 14 days with ZERO conversions before we flag waste?" ' +
      'Type a dollar amount. Leave blank to use the Engine default ($50). ' +
      'Example: 50 means a keyword that spent $51 with 0 leads in 14 days can create a WASTE_14D_KEYWORD alert in the status email. ' +
      'Location waste alerts are separate: they fire when a zip/city/metro/etc. gets 20+ clicks and 0 conversions over the last 30 days (Engine setting, not this dollar cell). ' +
      'Raise this dollar amount for bigger shops; lower it for tighter spend control. ' +
      'This stays on the Hub only (not copied to the spoke Sheet).',

  'Budget Pace Tolerance':
      '"Pace" means: are we spending about as fast as we planned for this point in the month? ' +
      'Tolerance is how much wiggle room is okay before we say "off pace." ' +
      'Enter it as a percent (15% looks like 0.15 or 15% in the cell). ' +
      'Example: 15% means if we expected $1,000 spent so far, spending about $850-$1,150 is still okay. ' +
      'Outside that range can count as Budget Off Pace. This number is copied into the spoke Sheet.',

  'Lead Pace Tolerance':
      'Same idea as budget pace, but for leads. ' +
      'How far behind (or off track) can lead count be before we worry? ' +
      'Example: 15% means if we expected 20 leads by today, getting about 17-23 can still be okay. ' +
      'This number is copied into the spoke Sheet.',

  'Alert: Budget Off Pace':
      'This is only an email on/off switch for one problem type: budget pacing. ' +
      'Enabled = okay to email when spend is too far ahead or behind plan. ' +
      'Disabled = do not email for this issue (you can still see it in Sheets). ' +
      'This switch lives only on the Hub. It is not copied to the spoke.',

  'Alert: Leads Off Pace':
      'Email on/off switch for lead pacing problems. ' +
      'Enabled = okay to email when leads are too far off plan. ' +
      'Disabled = do not email for this issue. Hub-only switch.',

  'Alert: High CPL':
      'Email on/off switch for expensive leads. ' +
      'Enabled = okay to email when cost per lead is above Target CPL × High CPL Multiplier. ' +
      'Example: Target CPL $100 and multiplier 1.5 → email if CPL is above about $150. ' +
      'Disabled = do not email for this issue. Hub-only switch.',

  'Alert: Spend No Conversions':
      'Email on/off switch for "we spent money but got zero leads." ' +
      'Enabled = okay to email when spend reaches the Zero Conversion Spend Alert amount with 0 leads. ' +
      'Example: Zero Conversion Spend Alert is $100, and spend hits $100 with 0 leads → email if this is Enabled. ' +
      'Disabled = do not email for this issue. Hub-only switch.',

  'Alert: Zero Spend':
      'Email on/off switch for "ads did not deliver yesterday." ' +
      'Enabled = okay to email when yesterday had $0 spend, 0 impressions, and 0 clicks. ' +
      'Disabled = do not email for this issue. Hub-only switch.',

  'Alert: Unconfigured':
      'Email on/off switch for setup problems. ' +
      'Enabled = okay to email when something required is missing (like a blank spoke link, or goals not filled in). ' +
      'Disabled = do not email for this issue. Hub-only switch.',

  'Account Manager Name':
      'The first and last name (or team name) of the person who owns this shop day to day. ' +
      'Example: "Alex Rivera." ' +
      'If several people get the email for this shop, put the main owner\'s name here. ' +
      'This helps humans know who owns the account. It can be copied to the spoke Sheet.',

  'Account Manager Email':
      'The inbox (or inboxes) that should get the Google Ads Account Status email for this shop. ' +
      'Example for one person: alex@agency.com ' +
      'Example for several people on the same shop: alex@agency.com, sam@agency.com ' +
      'Separate multiple emails with commas. ' +
      'Different managers for different shops: put each manager\'s email on their own shop rows — ' +
      'each manager gets a separate email covering only their shops. ' +
      'Blank = this shop will not appear in any status email.',

  'CSM Name':
      'Optional. Customer success / client-facing contact name(s) for this shop. ' +
      'Shown on each account card in the Google Ads Account Status email so managers know who the CSM is. ' +
      'One CSM example: "Jordan Lee." ' +
      'Several CSMs on the same shop: list names in the same order as CSM Email, separated by commas. ' +
      'Example: "Jordan Lee, Sam Rivera" with CSM Email "jordan@agency.com, sam@agency.com". ' +
      'Leave blank if you do not need a second contact.',

  'CSM Email':
      'Optional. Email address(es) for the CSM(s) on this shop. ' +
      'Shown on each account card in the status email (paired with CSM Name in the same order). ' +
      'Every address listed here can be copied on the status email when this shop has open problems, ' +
      'or when it is still inside the first 30-day money-back guarantee window (including Healthy shops), ' +
      'if the Engine allows CSM CC. ' +
      'One CSM example: jordan@agency.com ' +
      'Several CSMs: jordan@agency.com, sam@agency.com ' +
      'Leave blank if the account manager email alone is enough.',

  'Campaign Start Date':
      'The date this shop\'s measured campaign period started (when paid ads / tracking for this plan began). ' +
      'Example: March 1, 2026. ' +
      'We use this so we do not judge lead pace too harshly in the first days (default grace is about 7 days). ' +
      'It is also used on the Google Ads Account Status email: for the first 30 calendar days after this date, ' +
      'the shop gets a clear minimum lead money-back guarantee banner (start date, end date, day X of 30) ' +
      'and is sorted to the top of Needs attention or Healthy, with shops closest to the guarantee deadline first. ' +
      'It is copied to the spoke Sheet.',

  'Client Report Notes':
      'Optional notes for people. The Engine can include this text in the client section of status emails. ' +
      'Use this for extra context, like "Shop remodeled in April," "Holiday hours," or "Guarantee ends May 15." ' +
      'This also helps when handing the account to another teammate.',

  Priority:
      'Optional number that controls who gets processed first each day. ' +
      'Higher number = earlier in the queue. Leave blank for normal priority (treated as 0). ' +
      'Example: put 100 on a VIP shop so it runs in the first wave of up to 50 accounts. ' +
      'You do not need separate scripts or Hubs for every 50 shops — see docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md.',

  'Last Successful Run':
      'Filled by the Ads Script (soft green). Shows the last date this shop finished successfully. ' +
      'Blank or not today means the shop is still due for today\'s queue. ' +
      'Do not edit this by hand unless you are intentionally forcing a re-run. ' +
      'Example: if today is Aug 10 and this cell says Aug 10, the shop is done until tomorrow.'
};

var CONFIG_WIDTHS = {
  'Account ID': 130,
  'Account Name': 220,
  'Enabled': 100,
  'Client Name': 180,
  'Spoke Spreadsheet URL': 320,
  'Time Zone': 170,
  'Daily Budget': 110,
  'Monthly Budget': 120,
  'Monthly Lead Goal': 130,
  'Target CPL': 100,
  'Alerts Enabled': 120,
  'High CPL Multiplier': 140,
  'Zero Conversion Spend Alert': 170,
  'Keyword Waste Spend Threshold': 180,
  'Budget Pace Tolerance': 150,
  'Lead Pace Tolerance': 140,
  'Alert: Budget Off Pace': 150,
  'Alert: Leads Off Pace': 150,
  'Alert: High CPL': 130,
  'Alert: Spend No Conversions': 170,
  'Alert: Zero Spend': 130,
  'Alert: Unconfigured': 140,
  'Account Manager Name': 160,
  'Account Manager Email': 220,
  'CSM Name': 200,
  'CSM Email': 260,
  'Campaign Start Date': 140,
  'Client Report Notes': 280,
  Priority: 90,
  'Last Successful Run': 140,
  'Negatives Sweeper Enabled': 160,
  'Negatives Last Successful Run': 160,
  'Negatives PMax Last Successful Run': 170,
  'Negatives Disabled Rule IDs': 200,
  'Negatives Protected Phrases': 220,
  'Negatives Competitor Phrases': 220
};

var RUN_LOG_HEADERS = [
  'Run Date Time',
  'Status',
  'Accounts Selected',
  'Accounts Succeeded',
  'Accounts Failed',
  'Hub Spreadsheet URL',
  'Message'
];

var ALERTS_HEADERS = [
  'Alert Date Time',
  'Account ID',
  'Account Name',
  'Status',
  'Alert Type',
  'Message',
  'Resolved'
];

function createHubWorkbook() {
  var spreadsheet = getOrCreateTargetSpreadsheet_();
  initializeHubWorkbook_(spreadsheet);

  var url = spreadsheet.getUrl();
  Logger.log('Hub workbook ready: ' + url);
  Logger.log('Edit goals and Spoke Spreadsheet URL only in Hub Config. Engine syncs goals into each spoke.');

  try {
    SpreadsheetApp.getUi().alert(
        'Hub workbook ready',
        'Built by Shah Hub is ready:\n\n' + url +
        '\n\nFill Config (one row per body shop). Paste each spoke URL into Spoke Spreadsheet URL.\n' +
        'Edit budgets, alert thresholds, and per-alert send toggles here only.',
        SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // Standalone projects without a UI still succeed; URL is in the log.
  }

  return url;
}

function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('Built by Shah')
      .addItem('Apply / refresh Hub schema', 'createHubWorkbook')
      .addToUi();
}

function getOrCreateTargetSpreadsheet_() {
  var url = String(SETUP_CONFIG.EXISTING_SPREADSHEET_URL || '').trim();
  var workbookName = workbookName_();

  if (url) {
    var existing = SpreadsheetApp.openByUrl(url);
    if (existing.getName() !== workbookName) {
      existing.rename(workbookName);
    }
    return existing;
  }

  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      if (active.getName() !== workbookName) {
        active.rename(workbookName);
      }
      return active;
    }
  } catch (e) {
    // Standalone project - create below.
  }

  return SpreadsheetApp.create(workbookName);
}

function workbookName_() {
  return String(SETUP_CONFIG.WORKBOOK_BASE_NAME || 'Built by Shah - Google Ads Hub').trim() +
      ' (V ' + TEMPLATE_VERSION + ')';
}

function initializeHubWorkbook_(spreadsheet) {
  writeInstructionsSheet_(ensureSheet_(spreadsheet, SHEETS.INSTRUCTIONS));
  writeDefinitionsSheet_(ensureSheet_(spreadsheet, SHEETS.DEFINITIONS));
  writeConfigSheet_(ensureSheet_(spreadsheet, SHEETS.CONFIG));
  writeRunLogSheet_(ensureSheet_(spreadsheet, SHEETS.RUN_LOG));
  writeAlertsSheet_(ensureSheet_(spreadsheet, SHEETS.ALERTS));

  // Remove old all-caps tab names from earlier Hub versions.
  removeSheetIfPresent_(spreadsheet, 'CONFIG');
  removeSheetIfPresent_(spreadsheet, 'RUN_LOG');
  removeSheetIfPresent_(spreadsheet, 'ALERTS');

  orderSheets_(spreadsheet, [
    SHEETS.CONFIG,
    SHEETS.ALERTS,
    SHEETS.RUN_LOG,
    SHEETS.INSTRUCTIONS,
    SHEETS.DEFINITIONS
  ]);
  removeDefaultSheetIfPresent_(spreadsheet);

  var configSheet = spreadsheet.getSheetByName(SHEETS.CONFIG);
  if (configSheet) {
    spreadsheet.setActiveSheet(configSheet);
  }

  colorHubTabs_(spreadsheet);
}

function ensureSheet_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  // clear() does not always remove validations / filters — leftovers from an
  // older Hub layout (different column order) can reject sample / restored values.
  try {
    var filter = sheet.getFilter();
    if (filter) {
      filter.remove();
    }
  } catch (e) {
    // No filter.
  }
  try {
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  } catch (eClearVal) {
    // Ignore if empty.
  }
  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.clearNotes();
  try {
    sheet.setFrozenRows(0);
    sheet.setFrozenColumns(0);
  } catch (eFreeze) {
    // Ignore.
  }
  return sheet;
}

function orderSheets_(spreadsheet, names) {
  for (var i = 0; i < names.length; i++) {
    var sheet = spreadsheet.getSheetByName(names[i]);
    if (!sheet) {
      continue;
    }
    spreadsheet.setActiveSheet(sheet);
    spreadsheet.moveActiveSheet(i + 1);
  }
}

function removeSheetIfPresent_(spreadsheet, name) {
  // getSheetByName is case-insensitive, so "CONFIG" would also match "Config".
  // Only delete when the tab's exact displayed name matches (old all-caps names).
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() !== name) {
      continue;
    }
    if (sheets.length <= 1) {
      return;
    }
    spreadsheet.deleteSheet(sheets[i]);
    return;
  }
}

function removeDefaultSheetIfPresent_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Sheet1');
  if (!sheet || spreadsheet.getSheets().length <= 1) {
    return;
  }
  if (sheet.getLastRow() <= 1 && sheet.getLastColumn() <= 1) {
    spreadsheet.deleteSheet(sheet);
  }
}

function headerIndex_(headers) {
  var index = {};
  for (var i = 0; i < headers.length; i++) {
    index[headers[i]] = i + 1;
  }
  return index;
}

/* -------------------------------------------------------------------------- */
/* INSTRUCTIONS                                                               */
/* -------------------------------------------------------------------------- */

function writeInstructionsSheet_(sheet) {
  sheet.getRange('A1:B1').merge()
      .setValue('Built by Shah - Agency Hub');
  styleTitleRow_(sheet, 1, 2);

  // Keep this list in sync with SHEETS / tab roles whenever Hub tabs change.
  var rows = [
    ['Template version', TEMPLATE_VERSION],
    ['What this Sheet is', 'One Hub for every body shop you manage. Add one Config row per Google Ads account. The MCC Engine reads this Hub, syncs goals into each spoke Sheet, then writes that account\'s performance metrics into its spoke.'],
    ['Tab: Config', 'Your control plane and source of truth. One row per body shop / Google Ads account. Left side: identity + ops (Enabled, Priority, Campaign Start Date, Last Successful Run), then brown Negatives columns (Negatives Sweeper Enabled, Negatives Last Successful Run, Disabled Rule IDs, Protected Phrases, Competitor Phrases). Then goals, thresholds, per-alert email toggles, and manager / CSM contacts. Edit goals, time zone, alert controls, and negatives overrides only here - never on the spoke. Header colors group columns; Account ID, Account Name, and Enabled stay locked on the left.'],
    ['Negatives (per shop)', 'Auto-negatives are sibling MCC scripts (Search and PMax — not the Engine). To sweep a shop: Enabled = Enabled AND Negatives Sweeper Enabled = Enabled AND Spoke URL filled. Disable Negatives Sweeper Enabled to keep Engine metrics without auto-negatives. Put shop-only rule skips in Negatives Disabled Rule IDs (examples: AUTO_GLASS, PAINTLESS_DENT, YEAR_TOKEN, FREE_ESTIMATE, MECHANICAL_REPAIR). Protect specialty phrases in Negatives Protected Phrases. Add local competitors in Negatives Competitor Phrases (the script cannot invent local shop names or spare city names). Client Name and Account Name are protected automatically. Search stamps Negatives Last Successful Run; PMax stamps Negatives PMax Last Successful Run. Review and Remove happen on the spoke Negatives Audit tab — not here.'],
    ['Where do I edit negatives?', 'Turn Engine off (also stops negatives): Enabled = Disabled. Turn auto-negatives off only: Negatives Sweeper Enabled = Disabled. Disable a rule for one shop: Negatives Disabled Rule IDs. Protect a phrase: Negatives Protected Phrases. Block a local competitor: Negatives Competitor Phrases. See adds / mark Reviewed / Remove: that shop\'s spoke → Negatives Audit. Full rule ID list (including PAYMENT_OR_FINANCING, SPANISH_BODY_SHOP, YEAR_TOKEN, and aggressive earl/a1/f1 tokens): repo doc "Read this for the Search negatives sweeper - auto-add review and remove on the spoke.md".'],
    ['Tab: Alerts', 'Morning action queue. Written by the Ads Script when an account needs attention. Filter is on by default — mark Resolved = Yes when you have handled an item. Soft green cells are script-owned; cream Resolved cells are for you.'],
    ['Tab: Run Log', 'Written by the Ads Script after each wave (up to 50 accounts). Shows status, how many accounts were selected / succeeded / failed, remaining due today, and DAILY_CYCLE_COMPLETE when the day is done. Do not edit this tab by hand. (Negatives sweeper does not write here — it stamps Negatives Last Successful Run on Config and logs on each spoke.)'],
    ['Tab: Instructions', 'This guide (kept at the end of the tab bar). Read it when you need orientation. It explains what each Hub tab is for, how humans should use this workbook, and how to upgrade later without losing Config.'],
    ['Tab: Definitions', 'Glossary for every Config column, in the same left-to-right order as the Config tab (kept at the end of the tab bar, after Instructions). Open this when a header is unclear (for example Zero Conversion Spend Alert or Negatives Sweeper Enabled). When a new Config column is added, its definition is added here too.'],
    ['Scaling past 50 shops', 'Google only allows 50 accounts per parallel run. Keep ONE Hub and ONE Engine script. Schedule that same script several times per day; each run processes the next due shops (Last Successful Run blank or not today). Optional Priority puts VIP shops first. Never create a new script or Hub for every 50 shops. The negatives sweeper uses the same 50-account rule with Negatives Last Successful Run — schedule it at least twice per day when ~70 shops have Negatives Sweeper Enabled.'],
    ['~70 shops right now', 'Schedule the SAME Engine at least TWICE per day (example: 6:00 AM and 7:00 AM). First run covers ~50 shops; second run covers the rest. If you only schedule once, some shops will not update that day. Do the same for the Search (and later PMax) negatives sweeper scripts.'],
    ['What to edit day to day', 'Only Config (and Resolved on Alerts when you clear an item). Goals, Time Zone, thresholds, recipients, Spoke Spreadsheet URL, optional Priority, Campaign Start Date, and Negatives columns belong on Config only. Do not hand-edit Last Successful Run or Negatives Last Successful Run unless you are forcing a re-run. Definitions is read-only reference.'],
    ['Spoke sheets', 'Each body shop gets its own spoke workbook (create-body-shop-workbook.gs). Paste that URL into Spoke Spreadsheet URL on Config. Campaign, keyword, location, device detail, and Negatives Audit live only on the spoke - not here.'],
    ['Colors', 'Cream cells = type here. Soft green cells = filled by scripts (Run Log / Alerts / Last Successful Run / Negatives Last Successful Run). Config header colors: green ops, brown negatives, blue goals, slate thresholds, gray alert gates, steel people.'],
    ['First step', 'Add a Config row for each account. Create the spoke Sheet, paste its URL, set Enabled, fill budgets and alert controls. Leave Negatives Sweeper Enabled = Disabled until the spoke has a Negatives Audit tab, then turn it Enabled per shop. With ~70 Enabled rows, schedule the Engine at least twice per day (ceil(enabled / 50) waves).'],
    ['HOW TO CHANGE THINGS LATER', 'Read this section before you rebuild the Hub. Longer guide in the repo doc: "Read this before you change Hub or Spoke Sheets - how to upgrade without losing your work.md".'],
    ['Everyday change (safe)', 'Want a new budget, alert on/off, negatives override, or spoke URL? Just edit the cream Config cells. Do NOT re-run the Hub Apps Script generator for normal edits.'],
    ['Big layout upgrade (careful)', 'Want new columns, new colors, or a rebuilt template from create-hub-workbook.gs? That is a rebuild. Today a rebuild WIPES Config and rebuilds it. Back up first. Prefer keeping the SAME Hub URL.'],
    ['What to protect on Hub', 'Protect every Config row: Account ID, Enabled, Negatives Sweeper Enabled, Spoke Spreadsheet URL, budgets, lead goal, Target CPL, alert switches, manager/CSM emails, Priority, negatives override phrases, notes. That is the brain of the system.'],
    ['Okay to lose on Hub', 'Run Log history and old Alerts rows can be rebuilt. Pretty formatting comes back from the generator. Metric detail and Negatives Audit history live on spokes, not here.'],
    ['Hub upgrade steps', '1) Copy all real Config rows into a backup Sheet (or File → Make a copy of the whole Hub). 2) Paste new create-hub-workbook.gs into Apps Script. 3) Put this Hub URL in EXISTING_SPREADSHEET_URL. 4) Run createHubWorkbook. 5) Paste Config rows back (keep Account IDs as text). 6) Update the Engine the same day so column names still match. 7) Test-run 1–2 shops.'],
    ['Brand-new Hub only if needed', 'Only make a brand-new Hub if the old one is too broken to rebuild. Then paste Config into the new Hub and change ONE Engine setting: HUB_SPREADSHEET_URL (and the same URL on the negatives sweeper scripts). Keep the old Hub as an archive for a while.'],
    ['Do not mess up (Hub)', 'Do not invent a second Hub for more shops. Do not leave Spoke Spreadsheet URL blank on Enabled shops. Do not change Account IDs lightly. Do not update Hub columns without updating the Engine. Do not fold negatives into the Engine. Do not delete the old Hub the same day you cut over.']
  ];
  sheet.getRange(3, 1, rows.length, 2).setValues(rows);
  sheet.getRange(3, 1, rows.length, 1)
      .setFontWeight('bold')
      .setFontColor(COLORS.TEXT)
      .setBackground(COLORS.LABEL)
      .setVerticalAlignment('top');
  sheet.getRange(3, 2, rows.length, 1)
      .setFontColor(COLORS.TEXT)
      .setWrap(true)
      .setVerticalAlignment('top');
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 860);
  sheet.setRowHeights(3, rows.length, 64);
  sheet.setRowHeight(3 + 18, 120); // Hub upgrade steps
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(false);
}

/* -------------------------------------------------------------------------- */
/* DEFINITIONS                                                                */
/* -------------------------------------------------------------------------- */

function writeDefinitionsSheet_(sheet) {
  sheet.getRange('A1:C1').merge()
      .setValue('Config column definitions - plain English, with examples (same order as Config)');
  styleTitleRow_(sheet, 1, 3);

  sheet.getRange(2, 1, 1, 3).setValues([['#', 'Config column', 'What this means']]);
  styleHeaderRow_(sheet, 2, 3);

  var missing = [];
  var rows = [];
  for (var i = 0; i < CONFIG_HEADERS.length; i++) {
    var header = CONFIG_HEADERS[i];
    var definition = CONFIG_COLUMN_DEFINITIONS[header];
    if (!definition) {
      missing.push(header);
      definition = 'DEFINITION MISSING - add this header to CONFIG_COLUMN_DEFINITIONS.';
    }
    rows.push([i + 1, header, definition]);
  }
  if (missing.length) {
    throw new Error(
        'CONFIG_COLUMN_DEFINITIONS is missing entries for: ' + missing.join(', ') +
        '. Add a plain-language definition for every Config header.');
  }

  sheet.getRange(3, 1, rows.length, 3).setValues(rows);
  sheet.getRange(3, 1, rows.length, 1)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('top')
      .setFontColor(COLORS.TEXT)
      .setBackground(COLORS.LABEL);
  sheet.getRange(3, 2, rows.length, 1)
      .setFontWeight('bold')
      .setVerticalAlignment('top')
      .setFontColor(COLORS.TEXT)
      .setBackground(COLORS.LABEL)
      .setWrap(true);
  sheet.getRange(3, 3, rows.length, 1)
      .setWrap(true)
      .setVerticalAlignment('top')
      .setFontColor(COLORS.TEXT)
      .setBackground(COLORS.WHITE);

  sheet.setColumnWidth(1, 50);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 820);
  sheet.setRowHeights(3, rows.length, 96);
  // Freeze header rows only. Do not freeze columns - the title merges A1:C1,
  // and Sheets rejects a freeze line that cuts through a merged cell.
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(0);
  sheet.setHiddenGridlines(false);
}

/* -------------------------------------------------------------------------- */
/* CONFIG                                                                     */
/* -------------------------------------------------------------------------- */

function writeConfigSheet_(sheet) {
  var colCount = CONFIG_HEADERS.length;
  var index = headerIndex_(CONFIG_HEADERS);
  var dataRows = 200;

  // Extra clear: old Hub layouts leave Enabled/Disabled rules on the wrong columns.
  try {
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  } catch (eClear) {
    // Ignore.
  }

  sheet.getRange(1, 1, 1, colCount).setValues([CONFIG_HEADERS]);
  styleHeaderRow_(sheet, 1, colCount);
  applyConfigHeaderBands_(sheet, index);
  sheet.setRowHeight(1, 52);
  sheet.setFrozenRows(1);
  // Freeze Account ID + Account Name + Enabled for daily triage while scrolling.
  sheet.setFrozenColumns(3);

  sheet.getRange(2, 1, dataRows, colCount)
      .setBackground(COLORS.USER_INPUT)
      .setFontColor(COLORS.TEXT)
      .setVerticalAlignment('middle');

  sheet.getRange(2, index['Account ID'], dataRows, 1).setNumberFormat('@');

  // Number formats first (no dropdowns yet).
  sheet.getRange(2, index['Daily Budget'], dataRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(2, index['Monthly Budget'], dataRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(2, index['Target CPL'], dataRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(2, index['Zero Conversion Spend Alert'], dataRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(2, index['Keyword Waste Spend Threshold'], dataRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(2, index['Monthly Lead Goal'], dataRows, 1).setNumberFormat('0');
  sheet.getRange(2, index['High CPL Multiplier'], dataRows, 1).setNumberFormat('0.0');
  sheet.getRange(2, index['Budget Pace Tolerance'], dataRows, 1).setNumberFormat('0%');
  sheet.getRange(2, index['Lead Pace Tolerance'], dataRows, 1).setNumberFormat('0%');
  sheet.getRange(2, index['Campaign Start Date'], dataRows, 1).setNumberFormat('mmm d, yyyy');
  sheet.getRange(2, index.Priority, dataRows, 1).setNumberFormat('0');
  sheet.getRange(2, index['Last Successful Run'], dataRows, 1)
      .setBackground(COLORS.SCRIPT)
      .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, index['Negatives Last Successful Run'], dataRows, 1)
      .setBackground(COLORS.SCRIPT)
      .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, index['Negatives PMax Last Successful Run'], dataRows, 1)
      .setBackground(COLORS.SCRIPT)
      .setNumberFormat('yyyy-mm-dd');

  // Sample row BEFORE dropdown rules so leftover validators cannot reject text cells.
  if (SETUP_CONFIG.INCLUDE_SAMPLE_CONFIG_ROW) {
    var sample = {};
    sample['Account ID'] = '123-456-7890';
    sample['Account Name'] = 'Example Body Shop Ads Account';
    sample['Enabled'] = 'Enabled';
    sample.Priority = '';
    sample['Last Successful Run'] = '';
    sample['Negatives Sweeper Enabled'] = 'Disabled';
    sample['Negatives Last Successful Run'] = '';
    sample['Negatives PMax Last Successful Run'] = '';
    sample['Negatives Disabled Rule IDs'] = '';
    sample['Negatives Protected Phrases'] = '';
    sample['Negatives Competitor Phrases'] = '';
    sample['Client Name'] = 'Example Body Shop';
    sample['Spoke Spreadsheet URL'] = 'https://docs.google.com/spreadsheets/d/SPEAK_SHEET_ID/edit';
    sample['Time Zone'] = 'America/New_York';
    sample['Daily Budget'] = 100;
    sample['Monthly Budget'] = 3000;
    sample['Monthly Lead Goal'] = 40;
    sample['Target CPL'] = 100;
    sample['Alerts Enabled'] = 'Enabled';
    sample['High CPL Multiplier'] = 1.5;
    sample['Zero Conversion Spend Alert'] = 100;
    sample['Keyword Waste Spend Threshold'] = 50;
    sample['Budget Pace Tolerance'] = 0.15;
    sample['Lead Pace Tolerance'] = 0.15;
    sample['Alert: Budget Off Pace'] = 'Enabled';
    sample['Alert: Leads Off Pace'] = 'Enabled';
    sample['Alert: High CPL'] = 'Enabled';
    sample['Alert: Spend No Conversions'] = 'Enabled';
    sample['Alert: Zero Spend'] = 'Enabled';
    sample['Alert: Unconfigured'] = 'Enabled';
    sample['Account Manager Name'] = 'Example Manager';
    sample['Account Manager Email'] = 'manager@example.com';
    sample['CSM Name'] = '';
    sample['CSM Email'] = '';
    sample['Campaign Start Date'] = '';
    sample['Client Report Notes'] = 'SAMPLE ROW — replace with a real account.';

    var row = [];
    for (var c = 0; c < CONFIG_HEADERS.length; c++) {
      var key = CONFIG_HEADERS[c];
      row.push(sample[key] !== undefined ? sample[key] : '');
    }
    sheet.getRange(2, 1, 1, colCount).setValues([row]);
    sheet.getRange(2, 1, 1, colCount).setBackground(COLORS.SAMPLE);
    sheet.getRange(2, index['Account ID']).setNumberFormat('@');
    sheet.getRange(2, index['Last Successful Run']).setBackground(COLORS.SAMPLE);
    sheet.getRange(2, index['Negatives Last Successful Run']).setBackground(COLORS.SAMPLE);
    sheet.getRange(2, index['Negatives PMax Last Successful Run']).setBackground(COLORS.SAMPLE);
    sheet.getRange(2, 1).setNote(
        'Sample row only. Replace with a real account or delete this row before go-live.');
  }

  var enabledCols = [
    'Enabled',
    'Negatives Sweeper Enabled',
    'Alerts Enabled',
    'Alert: Budget Off Pace',
    'Alert: Leads Off Pace',
    'Alert: High CPL',
    'Alert: Spend No Conversions',
    'Alert: Zero Spend',
    'Alert: Unconfigured'
  ];
  var enabledRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Enabled', 'Disabled'], true)
      .setAllowInvalid(false)
      .build();
  for (var e = 0; e < enabledCols.length; e++) {
    sheet.getRange(2, index[enabledCols[e]], dataRows, 1).setDataValidation(enabledRule);
  }

  sheet.getRange(2, index['Time Zone'], dataRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
          .requireValueInList([
            'America/New_York', 'America/Chicago', 'America/Denver',
            'America/Los_Angeles', 'America/Phoenix'
          ], true)
          .setAllowInvalid(true)
          .setHelpText('Use the same time zone as the Google Ads account.')
          .build()
  );

  for (var w = 0; w < CONFIG_HEADERS.length; w++) {
    var header = CONFIG_HEADERS[w];
    sheet.setColumnWidth(w + 1, CONFIG_WIDTHS[header] || 140);
  }

  applyConfigConditionalFormatting_(sheet, index, dataRows);
  ensureFilter_(sheet, 1, 1, dataRows + 1, colCount);
  sheet.setHiddenGridlines(false);
}

function applyConfigHeaderBands_(sheet, index) {
  for (var i = 0; i < CONFIG_HEADERS.length; i++) {
    var header = CONFIG_HEADERS[i];
    var bandKey = CONFIG_HEADER_BANDS[header] || 'HEADER';
    var color = COLORS[bandKey] || COLORS.HEADER;
    sheet.getRange(1, index[header])
        .setBackground(color)
        .setFontColor(COLORS.WHITE)
        .setFontWeight('bold')
        .setWrap(true)
        .setVerticalAlignment('middle');
  }
}

function applyConfigConditionalFormatting_(sheet, index, dataRows) {
  var rules = [];
  // Sheet.getRange(r, c, numRows, numColumns) — use A1 to avoid end-row confusion.
  var lastDataRow = 1 + dataRows;
  var enabledA1 = columnToLetter_(index.Enabled) + '2:' +
      columnToLetter_(index.Enabled) + lastDataRow;
  var lastRunA1 = columnToLetter_(index['Last Successful Run']) + '2:' +
      columnToLetter_(index['Last Successful Run']) + lastDataRow;

  rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Disabled')
      .setBackground(COLORS.WARN_SOFT)
      .setRanges([sheet.getRange(enabledA1)])
      .build());

  rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenCellEmpty()
      .setBackground('#FFF2CC')
      .setRanges([sheet.getRange(lastRunA1)])
      .build());

  sheet.setConditionalFormatRules(rules);
}

/** 1-based column index → A1 letter(s). */
function columnToLetter_(column) {
  var col = Number(column);
  var letter = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

function colorHubTabs_(spreadsheet) {
  var config = spreadsheet.getSheetByName(SHEETS.CONFIG);
  var alerts = spreadsheet.getSheetByName(SHEETS.ALERTS);
  var runLog = spreadsheet.getSheetByName(SHEETS.RUN_LOG);
  var instructions = spreadsheet.getSheetByName(SHEETS.INSTRUCTIONS);
  var definitions = spreadsheet.getSheetByName(SHEETS.DEFINITIONS);
  if (config) {
    config.setTabColor('#2F5D50');
  }
  if (alerts) {
    alerts.setTabColor('#B85C38');
  }
  if (runLog) {
    runLog.setTabColor('#5A6E82');
  }
  if (instructions) {
    instructions.setTabColor('#8A9099');
  }
  if (definitions) {
    definitions.setTabColor('#8A9099');
  }
}

function ensureFilter_(sheet, startRow, startCol, numRows, numCols) {
  try {
    var existing = sheet.getFilter();
    if (existing) {
      existing.remove();
    }
  } catch (e) {
    // No filter.
  }
  sheet.getRange(startRow, startCol, numRows, numCols).createFilter();
}

/* -------------------------------------------------------------------------- */
/* RUN LOG / ALERTS                                                           */
/* -------------------------------------------------------------------------- */

function writeRunLogSheet_(sheet) {
  var headers = RUN_LOG_HEADERS;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleHeaderRow_(sheet, 1, headers.length);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  var rows = 500;
  sheet.getRange(2, 1, rows, headers.length)
      .setBackground(COLORS.SCRIPT)
      .setFontColor(COLORS.TEXT);
  sheet.getRange(2, 1, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  setColumnWidthsPx_(sheet, [160, 110, 140, 150, 130, 360, 420]);
  ensureFilter_(sheet, 1, 1, rows + 1, headers.length);
}

function writeAlertsSheet_(sheet) {
  var headers = ALERTS_HEADERS;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleHeaderRow_(sheet, 1, headers.length);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
  // Freeze through Account Name for triage while reading the message.
  sheet.setFrozenColumns(3);

  var rows = 500;
  sheet.getRange(2, 1, rows, headers.length)
      .setBackground(COLORS.SCRIPT)
      .setFontColor(COLORS.TEXT);
  sheet.getRange(2, 1, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(2, 2, rows, 1).setNumberFormat('@');
  sheet.getRange(2, 7, rows, 1).setBackground(COLORS.USER_INPUT);
  sheet.getRange(2, 7, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
          .requireValueInList(['Yes', 'No'], true)
          .setAllowInvalid(true)
          .build()
  );

  var openRange = sheet.getRange(2, 7, rows, 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('No')
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([openRange])
        .build()
  ]);

  setColumnWidthsPx_(sheet, [160, 130, 220, 100, 180, 420, 100]);
  ensureFilter_(sheet, 1, 1, rows + 1, headers.length);
}

/* -------------------------------------------------------------------------- */
/* STYLING                                                                    */
/* -------------------------------------------------------------------------- */

function styleTitleRow_(sheet, row, colCount) {
  sheet.getRange(row, 1, 1, colCount)
      .setBackground(COLORS.TITLE)
      .setFontColor(COLORS.WHITE)
      .setFontWeight('bold')
      .setFontSize(16)
      .setVerticalAlignment('middle');
  sheet.setRowHeight(row, 42);
}

function styleHeaderRow_(sheet, row, colCount) {
  sheet.getRange(row, 1, 1, colCount)
      .setBackground(COLORS.HEADER)
      .setFontColor(COLORS.WHITE)
      .setFontWeight('bold')
      .setFontSize(10)
      .setWrap(true)
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('center');
}

function setColumnWidthsPx_(sheet, widths) {
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }
}
