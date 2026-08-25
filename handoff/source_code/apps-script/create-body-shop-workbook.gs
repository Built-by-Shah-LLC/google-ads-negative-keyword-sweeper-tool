/**
 * BUILT BY SHAH — Body Shop (Spoke) Workbook Generator
 * Version: 1.10.0
 *
 * Creates one Google Sheet per body shop / Google Ads account, matching the
 * Account Configuration layout (Daily Checklist first; metrics tabs; then
 * Instructions, Definitions; Config last).
 *
 * This is a Spoke workbook only (one Ads account → one Sheet).
 * Agency routing + goal source of truth live in the Hub Sheet
 * (create-hub-workbook.gs). The MCC Engine syncs Hub goals into this Config.
 *
 * Tab order: Daily Checklist first; then metrics + Negatives Audit; then
 * Instructions, Definitions; Config last.
 * When columns/settings change, update buildSpokeDefinitionRows_().
 *
 * How to use:
 *   1. Open https://script.google.com → New project
 *   2. Paste this entire file
 *   3. Edit SETUP_CONFIG (body shop name; optional seed values until first Hub sync)
 *   4. Run createBodyShopWorkbook() and authorize
 *   5. Copy the spreadsheet URL from the log / alert
 *   6. Paste that URL into the Hub Config → Spoke Spreadsheet URL cell
 *   7. Edit budgets / lead goals / Target CPL / Time Zone on the Hub only
 *
 * To refresh an existing spoke sheet, paste its URL into
 * SETUP_CONFIG.EXISTING_SPREADSHEET_URL and run again.
 * To refresh lead/budget column colors, pace traffic lights, and metric
 * number formats (fixes Clicks showing as percent, etc.), run
 * refreshSpokeVisualFormatting().
 * To re-apply edit warnings + manual-edit detection, run refreshSpokeProtections().
 * To refresh only Daily Checklist (keeps checklist history), run refreshDailyChecklistTab().
 * To add a blank row for today on Daily Checklist, run addTodaysChecklistRow().
 * To add only Negatives Audit on an older live spoke, use add-negatives-audit-tab.gs.
 *
 * Naming rule: the Google Sheet file name always includes the template version,
 * e.g. "Auto Arena Body Shop — Google Ad Management Sheet (V 1.10.0)".
 */

// Bump this when the spoke workbook schema/layout changes.
// Always included in the Google Sheet project/file name.
var TEMPLATE_VERSION = '1.10.0';

/**
 * Default number formats by header name (ASCII exact match).
 * Applied after letter-based spec.numberFormats so count columns like Clicks
 * cannot accidentally display as percent (e.g. 4 → 400%).
 */
var METRIC_HEADER_NUMBER_FORMATS = {
  'Date': 'm/d/yyyy',
  'Week Ending': 'm/d/yyyy',
  'Daily Budget': '$#,##0.00',
  'Spend': '$#,##0.00',
  'Actual Spend': '$#,##0.00',
  'Expected Spend': '$#,##0.00',
  'Impressions': '#,##0',
  'Clicks': '#,##0',
  'Conversions': '#,##0',
  'Google Ads Conversions': '#,##0',
  'Expected Leads': '#,##0',
  'CTR': '0%',
  'Conv. Rate': '0%',
  'Budget Pace %': '0%',
  'Lead Pace %': '0%',
  'Avg. CPC': '$#,##0.00',
  'CPL': '$#,##0.00',
  'Actual CPL': '$#,##0.00',
  'Target CPL': '$#,##0.00'
};

/**
 * Hub-synced Config keys (column A). Values in column B are Engine-owned (green).
 * Humans must edit these on the Hub, not here.
 */
var HUB_SYNCED_SETTING_KEYS = {
  ACCOUNT_ID: true,
  ACCOUNT_NAME: true,
  ACCOUNT_MONITORING_ENABLED: true,
  ALERTS_ENABLED: true,
  TIME_ZONE: true,
  DAILY_BUDGET: true,
  MONTHLY_LEAD_GOAL: true,
  TARGET_CPL: true,
  HIGH_CPL_MULTIPLIER: true,
  ZERO_CONVERSION_SPEND_ALERT: true,
  BUDGET_PACE_TOLERANCE: true,
  LEAD_PACE_TOLERANCE: true,
  ALERT_RECIPIENT_EMAILS: true,
  ACCOUNT_MANAGER_NAME: true,
  ACCOUNT_MANAGER_EMAIL: true,
  CSM_NAME: true,
  CSM_EMAIL: true,
  CAMPAIGN_START_DATE: true
};

var SETUP_CONFIG = {
  // Leave blank to create a new workbook. Paste a Sheet URL to re-apply schema.
  EXISTING_SPREADSHEET_URL: '',

  // Shown in the workbook title. Also used as a temporary ACCOUNT_NAME seed
  // until the Engine syncs Account Name from the Hub.
  BODY_SHOP_NAME: 'Body Shop Name',

  // Temporary seeds until the first Hub → Spoke sync. Prefer editing on Hub.
  ACCOUNT_ID: '',
  TIME_ZONE: 'America/New_York',
  DAILY_BUDGET: 100,
  MONTHLY_LEAD_GOAL: 40,
  TARGET_CPL: 100,
  HIGH_CPL_MULTIPLIER: 1.5,
  ZERO_CONVERSION_SPEND_ALERT: 100,
  BUDGET_PACE_TOLERANCE: 0.15,
  LEAD_PACE_TOLERANCE: 0.15,
  ALERT_RECIPIENT_EMAILS: '',
  ACCOUNT_MANAGER_NAME: '',
  ACCOUNT_MANAGER_EMAIL: '',

  // When true, seeds sample campaign/ad group rows for demos.
  INCLUDE_SAMPLE_ENTITIES: false,

  // Prefill formula rows so scripts can write into green columns safely.
  FORMULA_ROWS: {
    ACCOUNT: 100,
    SEARCH_CAMPAIGN: 150,
    SEARCH_KEYWORD: 300,
    PMAX_CAMPAIGN: 100,
    LOCATION: 200,
    DEVICE: 100
  }
};

var COLORS = {
  TITLE: '#17324D',
  SECTION: '#243B55',
  HEADER: '#3A5A78',
  USER_INPUT: '#F7F3E8',
  FORMULA: '#E8F1F8',
  SCRIPT: '#E6EEE9',
  ID_KEY: '#EEF2F5',
  GUIDE: '#FFF8E7',
  WHITE: '#FFFFFF',
  FONT_BODY: '#202124',
  WARN_SOFT: '#FCE8E6',
  OK_SOFT: '#E6F4EA',
  // Soft column bands so spend/budget vs leads/conversions read apart.
  BUDGET_HEADER: '#6B5344',
  BUDGET_FORMULA: '#F5EDE6',
  BUDGET_SCRIPT: '#EFE4DA',
  LEAD_HEADER: '#554B6D',
  LEAD_FORMULA: '#EDE8F5',
  LEAD_SCRIPT: '#E4DDF0',
  // Pace % traffic lights (±5% around 100%).
  PACE_GREEN: '#D7F0DB',
  PACE_YELLOW: '#FFF3BF',
  PACE_RED: '#F8D0CC',
  TAB_DAILY: '#3A5A78',
  TAB_WEEKLY: '#5A6E82',
  TAB_HELP: '#8A9099',
  TAB_CONFIG: '#2F5D50',
  TAB_CHECKLIST: '#2F5D50',
  FOLLOW_UP: '#FFE0B2',
  EXPERIMENT: '#C8E6C9',
  // Daily Checklist traffic-light statuses (green / yellow / red).
  CHECKLIST_SELECT: '#E8E8E8',
  STATUS_GOOD: '#C8E6C9',
  STATUS_ATTENTION: '#FFE082',
  STATUS_URGENT: '#EF9A9A'
};

// Header-name maps for column banding + pace traffic lights (ASCII exact match).
var METRIC_BUDGET_HEADERS = {
  'Budget Status': true,
  'Expected Spend': true,
  'Actual Spend': true,
  'Budget Pace %': true,
  'Daily Budget': true,
  'Spend': true
};
var METRIC_LEAD_HEADERS = {
  'Lead Status': true,
  'Expected Leads': true,
  'Google Ads Conversions': true,
  'Lead Pace %': true,
  'Actual CPL': true,
  'Target CPL': true,
  'CPL Status': true,
  'Conversions': true,
  'Conv. Rate': true,
  'CPL': true
};
var METRIC_PACE_HEADERS = {
  'Budget Pace %': true,
  'Lead Pace %': true
};

var METRIC_ID_HEADERS = {
  'Campaign ID': true,
  'Ad Group ID': true,
  'Keyword ID': true,
  'Account ID': true
};

// Fallback only, for tabs missing from METRIC_COLUMN_ROLES.
var METRIC_SCRIPT_HEADERS = {
  'Date': true,
  'Week Ending': true,
  'Actual Spend': true,
  'Spend': true,
  'Impressions': true,
  'Clicks': true,
  'Conversions': true,
  'Google Ads Conversions': true,
  'Campaign Name': true,
  'Campaign Type': true,
  'Ad Group Name': true,
  'Keyword Text': true,
  'Match Type': true,
  'Google Status': true,
  'Location': true,
  'Location Type': true,
  'Device': true,
  'Notes': true
};

/**
 * Authoritative per-tab column roles, 1-based column numbers.
 *
 * These mirror scriptCols / idCols / the cream dropdown columns in each
 * write*MetricsSheet_ spec below, and they are the source of truth for body
 * colors. Header names alone cannot decide this and get it wrong: CTR is a
 * sheet formula on campaign tabs (blue) but reads like a script metric, Notes
 * is script-written (green), and Action Status is a human dropdown that must
 * stay cream. Anything not listed is a formula column (blue).
 *
 * Keep in sync with the specs whenever a metrics tab gains or loses a column.
 */
var METRIC_COLUMN_ROLES = {
  'Account Metrics (Daily)':
      { script: [1, 5, 9, 15], id: [], user: [] },
  'Search Campaign Metrics (Daily)':
      { script: [1, 3, 4, 5, 8, 9, 10, 11, 14, 21], id: [2], user: [] },
  'Search Keyword Metrics (Daily)':
      { script: [1, 3, 5, 7, 8, 9, 11, 12, 13, 16, 22], id: [2, 4, 6], user: [] },
  'PMax Campaign Metrics (Daily)':
      { script: [1, 3, 4, 7, 8, 9, 10, 13, 20], id: [2], user: [] },
  'Location Metrics (Weekly)':
      { script: [1, 3, 4, 5, 7, 8, 9, 11, 18], id: [2], user: [17] },
  'Device Metrics (Weekly)':
      { script: [1, 3, 4, 6, 7, 8, 10, 17], id: [2], user: [16] }
};

/**
 * Role of one metrics column: 'script', 'id', 'user', or 'formula'.
 * Falls back to header-name guessing only for tabs we do not have a spec for.
 */
function metricColumnRole_(tabName, col, headerName) {
  var roles = METRIC_COLUMN_ROLES[tabName];
  if (roles) {
    if (numberInList_(roles.user, col)) {
      return 'user';
    }
    if (numberInList_(roles.id, col)) {
      return 'id';
    }
    if (numberInList_(roles.script, col)) {
      return 'script';
    }
    return 'formula';
  }
  if (METRIC_ID_HEADERS[headerName]) {
    return 'id';
  }
  if (METRIC_SCRIPT_HEADERS[headerName]) {
    return 'script';
  }
  return 'formula';
}

/**
 * Body background for one metrics column. Budget/lead tints win over the base
 * role color, matching applyColumnBandColors_ which runs last on a fresh build.
 */
function metricBodyBackground_(role, headerName) {
  if (METRIC_BUDGET_HEADERS[headerName]) {
    return role === 'script' ? COLORS.BUDGET_SCRIPT : COLORS.BUDGET_FORMULA;
  }
  if (METRIC_LEAD_HEADERS[headerName]) {
    return role === 'script' ? COLORS.LEAD_SCRIPT : COLORS.LEAD_FORMULA;
  }
  if (role === 'user') {
    return COLORS.USER_INPUT;
  }
  if (role === 'id') {
    return COLORS.ID_KEY;
  }
  if (role === 'script') {
    return COLORS.SCRIPT;
  }
  return COLORS.FORMULA;
}

/**
 * Columns that carry conditional formatting on each metrics tab, 1-based.
 * Mirrors statusHighlightCols / alertHighlightCols / pacePercentCols in the
 * tab specs below. Used to rebuild the rules from scratch on a live sheet.
 */
var METRIC_CF_COLUMNS = {
  'Account Metrics (Daily)':
      { status: [2, 3, 7, 13], alert: [14], pace: [6, 10] },
  'Search Campaign Metrics (Daily)':
      { status: [18, 19], alert: [20], pace: [] },
  'Search Keyword Metrics (Daily)':
      { status: [20], alert: [21], pace: [] },
  'PMax Campaign Metrics (Daily)':
      { status: [17, 18], alert: [19], pace: [] },
  'Location Metrics (Weekly)':
      { status: [15], alert: [16], pace: [] },
  'Device Metrics (Weekly)':
      { status: [14], alert: [15], pace: [] }
};

var METRIC_STATUS_WARN_VALUES = [
  'Needs Attention',
  'Off Pace',
  'High CPL',
  'Spend / No Conversions',
  'Unexpected Spend',
  'Unexpected Status',
  'Zero Spend'
];

var METRIC_STATUS_OK_VALUES = ['On Pace', 'On Target'];

function numberInList_(list, value) {
  if (!list) {
    return false;
  }
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) {
      return true;
    }
  }
  return false;
}

var SHEETS = {
  DAILY_CHECKLIST: 'Daily Checklist',
  INSTRUCTIONS: 'Instructions',
  DEFINITIONS: 'Definitions',
  CONFIG: 'Config',
  ACCOUNT: 'Account Metrics (Daily)',
  SEARCH_CAMPAIGN: 'Search Campaign Metrics (Daily)',
  SEARCH_KEYWORD: 'Search Keyword Metrics (Daily)',
  NEGATIVES_AUDIT: 'Negatives Audit',
  PMAX_CAMPAIGN: 'PMax Campaign Metrics (Daily)',
  LOCATION: 'Location Metrics (Weekly)',
  DEVICE: 'Device Metrics (Weekly)'
};

// Old tab names removed/renamed in V 1.2.0 — deleted on refresh.
var OBSOLETE_SHEETS = [
  'Charts',
  'PMax Keyword Metrics (Daily)',
  'Account Metrics',
  'Search Campaign Metrics',
  'Search Ad Group Metrics',
  'Keyword Metrics',
  'PMax Campaign Metrics',
  'PMax Asset Group Metrics'
];

// Fixed Config table ranges used by VLOOKUP formulas (must match writeConfigSheet_).
var CONFIG_RANGES = {
  CAMPAIGNS: 'Config!$A$24:$F$33',
  AD_GROUPS: 'Config!$A$39:$F$58',
  KEYWORDS: 'Config!$A$64:$F$83'
};

/**
 * Primary entry point. Run from the Apps Script editor.
 */
function createBodyShopWorkbook() {
  var spreadsheet = getOrCreateTargetSpreadsheet_();
  initializeBodyShopWorkbook_(spreadsheet);

  var url = spreadsheet.getUrl();
  Logger.log('Body shop workbook ready: ' + url);
  Logger.log('Paste this URL into Hub Config → Spoke Spreadsheet URL. Edit budgets/CPL/lead goals on the Hub only.');

  try {
    SpreadsheetApp.getUi().alert(
        'Body shop workbook ready',
        'Built by Shah spoke workbook is ready:\n\n' + url +
        '\n\n1) Paste this URL into the Hub Config Spoke Spreadsheet URL cell.\n' +
        '2) Edit budgets / lead goals / Target CPL on the Hub only.\n' +
        '3) Fill yellow Config cells here for campaigns / ad groups (and optional keyword overrides).',
        SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // Standalone projects without a UI still succeed; URL is in the log.
  }

  return url;
}

/**
 * Optional: custom menu when this script is bound to a Sheet.
 */
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('Built by Shah')
      .addItem('Apply / refresh body shop schema', 'createBodyShopWorkbook')
      .addItem('Refresh metric colors + pace lights', 'refreshSpokeVisualFormatting')
      .addItem('Refresh edit warnings + manual-edit watch', 'refreshSpokeProtections')
      .addItem('Refresh Daily Checklist tab', 'refreshDailyChecklistTab')
      .addItem('Add today’s checklist row', 'addTodaysChecklistRow')
      .addToUi();
}


function spokeTabOrder_() {
  return [
    SHEETS.DAILY_CHECKLIST,
    SHEETS.ACCOUNT,
    SHEETS.SEARCH_CAMPAIGN,
    SHEETS.SEARCH_KEYWORD,
    SHEETS.NEGATIVES_AUDIT,
    SHEETS.PMAX_CAMPAIGN,
    SHEETS.LOCATION,
    SHEETS.DEVICE,
    SHEETS.INSTRUCTIONS,
    SHEETS.DEFINITIONS,
    SHEETS.CONFIG
  ];
}


/**
 * Re-apply lead/budget column banding and Budget/Lead Pace % traffic lights on
 * existing metrics tabs without wiping values. Prefer this over a full rebuild
 * when you only need the visual readability update.
 *
 * Also restores dark body text on every data column. Engine inserts can leave
 * white header font on new rows; peach/lavender alone is not enough to read.
 */
function refreshSpokeVisualFormatting() {
  var spreadsheet = getOrCreateTargetSpreadsheet_();
  var names = [
    SHEETS.ACCOUNT,
    SHEETS.SEARCH_CAMPAIGN,
    SHEETS.SEARCH_KEYWORD,
    SHEETS.PMAX_CAMPAIGN,
    SHEETS.LOCATION,
    SHEETS.DEVICE
  ];
  var updated = 0;
  var skipped = [];
  var updatedNames = [];
  for (var i = 0; i < names.length; i++) {
    var sheet = spreadsheet.getSheetByName(names[i]);
    if (!sheet) {
      skipped.push(names[i]);
      continue;
    }
    applyMetricColumnBandsAndPaceLights_(sheet);
    updated++;
    updatedNames.push(names[i]);
  }
  Logger.log(
      'Refreshed visual formatting (template V ' + TEMPLATE_VERSION + ') on ' +
      updated + ' metrics tab(s).' +
      (skipped.length ? ' Missing: ' + skipped.join(', ') : ''));
  try {
    SpreadsheetApp.getUi().alert(
        'Metric formatting refreshed (V ' + TEMPLATE_VERSION + ')',
        'Script version that just ran: V ' + TEMPLATE_VERSION + '\n' +
        'If this does not say V 1.9.5 or newer, this Apps Script project still ' +
        'has the OLD code. Paste the current create-body-shop-workbook.gs and run again.\n\n' +
        'Updated ' + updated + ' metrics tab(s): ' + updatedNames.join(', ') +
        (skipped.length ? '\nNot found: ' + skipped.join(', ') : '') + '\n\n' +
        'Data rows now use pastel backgrounds with dark (black) text.\n' +
        'Header row 4 stays dark with white bold text.\n\n' +
        'Spend/budget = peach. Leads/CPL = lavender. IDs = gray.\n' +
        'Pace % traffic lights: green >105%, yellow 95–105%, red <95%.',
        SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // Standalone projects without a UI still succeed.
  }
  return spreadsheet.getUrl();
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
    // Standalone project — create below.
  }

  return SpreadsheetApp.create(workbookName);
}

function workbookName_() {
  return String(SETUP_CONFIG.BODY_SHOP_NAME || 'Body Shop').trim() +
      ' — Google Ad Management Sheet (V ' + TEMPLATE_VERSION + ')';
}

function initializeBodyShopWorkbook_(spreadsheet) {
  spreadsheet.setSpreadsheetTimeZone(SETUP_CONFIG.TIME_ZONE || 'America/New_York');

  var checklistPreserved = snapshotDailyChecklistRows_(spreadsheet);

  writeInstructionsSheet_(ensureSheet_(spreadsheet, SHEETS.INSTRUCTIONS));
  writeDefinitionsSheet_(ensureSheet_(spreadsheet, SHEETS.DEFINITIONS));
  writeConfigSheet_(ensureSheet_(spreadsheet, SHEETS.CONFIG));
  writeDailyChecklistSheet_(
      ensureSheet_(spreadsheet, SHEETS.DAILY_CHECKLIST),
      spreadsheet,
      checklistPreserved
  );
  writeAccountMetricsSheet_(ensureSheet_(spreadsheet, SHEETS.ACCOUNT));
  writeSearchCampaignMetricsSheet_(ensureSheet_(spreadsheet, SHEETS.SEARCH_CAMPAIGN));
  writeSearchKeywordMetricsSheet_(ensureSheet_(spreadsheet, SHEETS.SEARCH_KEYWORD));
  writeNegativesAuditSheet_(ensureSheet_(spreadsheet, SHEETS.NEGATIVES_AUDIT));
  writePmaxCampaignMetricsSheet_(ensureSheet_(spreadsheet, SHEETS.PMAX_CAMPAIGN));
  writeLocationMetricsSheet_(ensureSheet_(spreadsheet, SHEETS.LOCATION));
  writeDeviceMetricsSheet_(ensureSheet_(spreadsheet, SHEETS.DEVICE));

  orderSheets_(spreadsheet, spokeTabOrder_());
  removeObsoleteSheets_(spreadsheet);
  removeDefaultSheetIfPresent_(spreadsheet);
  colorSpokeTabs_(spreadsheet);
  protectSpokeLockedRanges_(spreadsheet);
  ensureSpokeManualEditTrigger_(spreadsheet);

  spreadsheet.setActiveSheet(spreadsheet.getSheetByName(SHEETS.DAILY_CHECKLIST));
}

function colorSpokeTabs_(spreadsheet) {
  var daily = [
    SHEETS.ACCOUNT, SHEETS.SEARCH_CAMPAIGN, SHEETS.SEARCH_KEYWORD,
    SHEETS.PMAX_CAMPAIGN
  ];
  var weekly = [SHEETS.LOCATION, SHEETS.DEVICE];
  var help = [SHEETS.INSTRUCTIONS, SHEETS.DEFINITIONS];
  var i;
  for (i = 0; i < daily.length; i++) {
    var d = spreadsheet.getSheetByName(daily[i]);
    if (d) {
      d.setTabColor(COLORS.TAB_DAILY);
    }
  }
  for (i = 0; i < weekly.length; i++) {
    var w = spreadsheet.getSheetByName(weekly[i]);
    if (w) {
      w.setTabColor(COLORS.TAB_WEEKLY);
    }
  }
  for (i = 0; i < help.length; i++) {
    var h = spreadsheet.getSheetByName(help[i]);
    if (h) {
      h.setTabColor(COLORS.TAB_HELP);
    }
  }
  var checklist = spreadsheet.getSheetByName(SHEETS.DAILY_CHECKLIST);
  if (checklist) {
    checklist.setTabColor(COLORS.TAB_CHECKLIST);
  }
  var negatives = spreadsheet.getSheetByName(SHEETS.NEGATIVES_AUDIT);
  if (negatives) {
    negatives.setTabColor(COLORS.TAB_DAILY);
  }
  var config = spreadsheet.getSheetByName(SHEETS.CONFIG);
  if (config) {
    config.setTabColor(COLORS.TAB_CONFIG);
  }
}

function ensureSheet_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  // clear() does not always remove validations / filters / hidden rows — those
  // leftovers cause "random" dropdown arrows and missing Config sections.
  try {
    var filter = sheet.getFilter();
    if (filter) {
      filter.remove();
    }
  } catch (e) {
    // No filter / cannot remove.
  }
  try {
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  } catch (eClearVal) {
    // Ignore if the sheet is empty / cannot clear validations.
  }
  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.clearNotes();
  try {
    sheet.showRows(1, sheet.getMaxRows());
    sheet.showColumns(1, sheet.getMaxColumns());
  } catch (e2) {
    // Ignore if the sheet has no hidden rows/columns.
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

function removeObsoleteSheets_(spreadsheet) {
  for (var i = 0; i < OBSOLETE_SHEETS.length; i++) {
    var name = OBSOLETE_SHEETS[i];
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      continue;
    }
    // Never delete a sheet that is still part of the current schema.
    var stillUsed = false;
    Object.keys(SHEETS).forEach(function(key) {
      if (SHEETS[key] === name) {
        stillUsed = true;
      }
    });
    if (stillUsed || spreadsheet.getSheets().length <= 1) {
      continue;
    }
    spreadsheet.deleteSheet(sheet);
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

/* -------------------------------------------------------------------------- */
/* INSTRUCTIONS                                                               */
/* -------------------------------------------------------------------------- */

function writeInstructionsSheet_(sheet) {
  var title = 'Account Workbook — Setup & Operating Rules';
  sheet.getRange('A1:H1').merge().setValue(title);
  styleTitleRow_(sheet, 1, 8);

  writeLegendRow_(sheet, 2);

  var headers = ['RULE', 'INSTRUCTION', 'REASON'];
  sheet.getRange(4, 1, 1, 3).setValues([headers]);
  styleHeaderRow_(sheet, 4, 3);

  var rows = [
    ['1', 'This workbook is for one Google Ads account only.',
     'It keeps account-specific controls and history separate and easy to audit.'],
    ['2', 'Cream / yellow cells are the only cells intended for local user input on this spoke. Green / blue / gray metric cells and Hub-synced Config values show an edit warning — click through only if you intentionally override.',
     'Blue cells contain formulas; green cells are script outputs (including Hub-synced goals); gray cells are IDs or keys. Accidental edits on locked cells stamp Notes with MANUAL EDIT and show Manual edit detected in Active Alerts / Alert.'],
    ['3', 'Edit goals, alert thresholds, alert send toggles, and recipients on the Hub Sheet only.',
     'The MCC Engine syncs Hub values into green Config cells here for formulas. Per-alert email gates stay on the Hub (Engine reads them when sending).'],
    ['4', 'On Config: read the cream guide row under each table header, then fill yellow rows below it. Start with Campaign + Ad Group tables. Skip Keyword overrides unless you need a rare exception. Green Hub-synced cells are filled by the Engine.',
     'Guide rows explain exactly what to type. Campaign/ad group tables are your expected setup checklist. Keyword overrides are optional.'],
    ['5', 'Set Monitor or Expected to Spend to Disabled before intentionally pausing an item.',
     'This prevents false zero-spend / unexpected-spend flags on the metrics tabs.'],
    ['6', 'A CPL alert triggers above Target CPL × HIGH_CPL_MULTIPLIER (default 1.5).',
     'The multiplier is editable on the Hub (synced into Config) without changing code.'],
    ['7', 'Zero conversions use a separate spend threshold instead of dividing by zero.',
     'Small amounts of spend do not create premature alerts.'],
    ['8', 'The newest daily or weekly data is written directly under the header (newest on top). Older days are pushed down.',
     'Open any metrics tab and the first data row is the most recent Engine write. Same-day re-runs update that day in place.'],
    ['9', 'New campaigns or Search ad groups not in Config should be marked UNCONFIGURED. Keywords are auto-discovered and inherit parent monitoring.',
     'This prevents silent unexpected spend without requiring manual keyword inventories.'],
    ['10', 'Google Ads conversions are the sole lead source in this workbook.',
     'CallRail, GHL, manual overrides, and tracking-difference fields are intentionally excluded.'],
    ['11', 'Daily Checklist is the first tab. Look at the VERY TOP menu bar (same row as File, Edit, View, Insert). Click Built by Shah → Add today’s checklist row each day you work this shop. Then metrics tabs. Instructions and Definitions come near the end; Config is last.',
     'Checklist is human-owned (the Engine does not write it). Day / Date shows weekday + date. Every review column is a green / yellow / red dropdown starting as — Select —.'],
    ['11b', 'On Daily Checklist: pick a status for Status emails, Budget pace, Lead pace, Conversions, Trend check, Search terms, and Negatives audit. Green = healthy, yellow = watching, red = fix / escalate. Day status uses the same colors. Note type and Daily notes share Follow-up orange / Experiment green.',
     'The cream guide row under the headers explains each dropdown in plain English. Daily notes wrap in taller rows. For Negatives audit: open Negatives Audit → Reviewed / Remove as needed. Shop rule overrides stay on the Hub.'],
    ['11c', 'Negatives Audit tab: Search / PMax negatives sweeper writes rows under the header (Channel SEARCH or PMAX). Cream = Reviewed, Remove, AM Notes only. Cost Yesterday / Cost Lookback / Spend Summary show waste context. Configure Negatives Sweeper Enabled and overrides on the Hub — not here.',
     ''],
    ['12', 'Open the Definitions tab whenever a column or Config setting is unclear.',
     'Definitions explains every important column in plain English, with examples, grouped by tab.'],
    ['13', 'Do not type keyword rows into Search Keyword Metrics (Daily).',
     'The script populates Search keywords automatically; use Keyword Overrides only for exceptions. PMax has no keyword tab (PMax does not use classic keywords).'],
    ['14', 'All Google Ads IDs must remain plain text.',
     'This prevents rounding, scientific notation, and dropped leading zeros.'],
    ['15', 'Workbook and Config time zones should match the Google Ads account time zone.',
     'Consistent time zones prevent date and pacing mismatches.'],
    ['16', 'Fill CSM contacts and Campaign Start Date on the Hub before you rely on lead-pace grace or escalation emails.',
     'Campaign Start Date delays harsh lead-pace judgment in the first days after launch.'],
    ['17', 'Paste this spreadsheet URL into the Hub Config Spoke Spreadsheet URL cell for this account.',
     'The Hub is the agency control plane; this spoke is the per-account dashboard.'],
    ['18', 'EVERYDAY CHANGES: edit cream/yellow cells only (campaigns, ad groups, optional keyword overrides). Do not re-run the spoke Apps Script generator for normal edits.',
     'Re-running the generator rebuilds tabs and can wipe what you typed.'],
    ['19', 'BIG LAYOUT UPGRADE (careful): back up Config first. Copy the yellow Campaign table, Ad Group table, any Keyword overrides, and your Daily Checklist history into a backup Sheet (or File → Make a copy of this whole spoke).',
     'Today a template rebuild clears tabs. Yellow Config and Daily Checklist rows are precious. Metric history can come back from Google Ads.'],
    ['20', 'To rebuild THIS same spoke URL: paste new create-body-shop-workbook.gs → set BODY_SHOP_NAME → put this Sheet URL in EXISTING_SPREADSHEET_URL → run createBodyShopWorkbook → paste yellow Config tables back → confirm Hub still has this exact Spoke Spreadsheet URL → let the Engine sync green cells.',
     'Same link is best. Only make a brand-new spoke if this file is broken, then update the Hub Spoke Spreadsheet URL to the new link.'],
    ['21', 'Do not mess up on upgrades: do not type budgets/CPL here (Hub only); do not overwrite green Hub-synced cells; keep IDs as plain text; do not change the Hub spoke URL without updating the real link; keep Search and PMax on separate tabs.',
     'Full plain-English guide: docs/Read this before you change Hub or Spoke Sheets - how to upgrade without losing your work.md'],
    ['22', 'On metrics tabs, peach-tinted columns are spend/budget and lavender-tinted columns are leads/CPL/conversions. Budget Pace % and Lead Pace % use traffic lights: green above 105%, yellow 95–105%, red below 95%. To refresh colors on an existing spoke without wiping data, run refreshSpokeVisualFormatting.',
     'Color bands make it easier to scan without mixing up spend vs leads. Pace lights show “ahead / near plan / behind” at a glance.']
  ];
  sheet.getRange(5, 1, rows.length, 3).setValues(rows);
  sheet.getRange(5, 1, rows.length, 1).setBackground(COLORS.ID_KEY);
  sheet.getRange(5, 2, rows.length, 2).setWrap(true);
  sheet.getRange(5, 3, rows.length, 1).setWrap(true);
  sheet.setRowHeights(5, rows.length, 48);
  sheet.setRowHeight(5 + 19, 72); // rule 20
  sheet.setRowHeight(5 + 20, 64); // rule 21
  sheet.setRowHeight(5 + 21, 64); // rule 22

  setColumnWidthsChars_(sheet, [10, 74, 72, 9, 13, 13, 13, 13]);
  sheet.setFrozenRows(4);
  sheet.setHiddenGridlines(false);
}


/* -------------------------------------------------------------------------- */
/* DEFINITIONS                                                                */
/* -------------------------------------------------------------------------- */

function writeDefinitionsSheet_(sheet) {
  sheet.getRange('A1:E1').merge()
      .setValue('Spoke column definitions — plain English with examples (grouped by tab)');
  styleTitleRow_(sheet, 1, 5);
  writeLegendRow_(sheet, 2);

  sheet.getRange(4, 1, 1, 5).setValues([[
    '#', 'Tab', 'Section', 'Column or setting', 'What this means'
  ]]);
  styleHeaderRow_(sheet, 4, 5);

  var definitions = buildSpokeDefinitionRows_();
  var rows = [];
  for (var i = 0; i < definitions.length; i++) {
    rows.push([
      i + 1,
      definitions[i][0],
      definitions[i][1],
      definitions[i][2],
      definitions[i][3]
    ]);
  }

  sheet.getRange(5, 1, rows.length, 5).setValues(rows);
  sheet.getRange(5, 1, rows.length, 1)
      .setBackground(COLORS.ID_KEY)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('top');
  sheet.getRange(5, 2, rows.length, 3)
      .setBackground(COLORS.ID_KEY)
      .setVerticalAlignment('top')
      .setWrap(true);
  sheet.getRange(5, 3, rows.length, 1).setWrap(true);
  sheet.getRange(5, 4, rows.length, 1)
      .setFontWeight('bold')
      .setWrap(true)
      .setVerticalAlignment('top');
  sheet.getRange(5, 5, rows.length, 1)
      .setWrap(true)
      .setVerticalAlignment('top')
      .setBackground(COLORS.WHITE);

  setColumnWidthsChars_(sheet, [6, 34, 42, 28, 78]);
  sheet.setRowHeights(5, rows.length, 72);
  sheet.setFrozenRows(4);
  sheet.setFrozenColumns(0);
  sheet.setHiddenGridlines(false);
}

/**
 * Plain-English Definitions for every spoke tab / column.
 * Keep in sync when headers or Config keys change.
 * Write for a non-expert reader. Use examples. ASCII only.
 */
function buildSpokeDefinitionRows_() {
  // Each row: [Tab, Section, Column or setting, What this means]
  return [
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Date", "Weekday + date of the work day (example: Wed 8/12/2026). Use Built by Shah → Add today’s checklist row. You still review yesterday’s Ads numbers on the metrics tabs."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Day / Date", "Same as Date — weekday + date of the work day. Newest rows stay on top."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Status emails", "Dropdown: All clear (green), Follow-up needed (yellow), or Critical alert (red). Starts as — Select —."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Budget pace", "Dropdown: On pace (green), Soft miss (yellow), or Off pace — fix (red). Check Account Metrics plus Search and PMax campaign tabs."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Lead pace", "Dropdown: On pace (green), Soft miss (yellow), or Off pace — fix (red). Check Account Metrics plus Search and PMax campaign tabs."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Conversions", "Dropdown: Leads OK (green), Thin day (yellow), or Zero leads w/ spend (red)."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Trend check", "Dropdown: Stable (green), Watching a change (yellow), or Big swing — dig in (red)."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Search terms", "Dropdown: Clean (green), Cleanup done (yellow), or Heavy waste (red)."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Negatives audit", "Dropdown: Clean (green), Fixed a bad block (yellow), or Critical false block (red). Open the Negatives Audit tab to check Reviewed / Remove. Shop rule overrides stay on the Hub."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Date Added", "Account-timezone date/time this row was written by the sweeper."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Channel", "SEARCH or PMAX — which sweeper wrote the row."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Campaign ID", "Google Ads campaign ID that received (or had removed) the exact negative."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Campaign", "Campaign name for humans."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Search Term", "The Google search query that triggered a rule."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Exact Negative", "What was added in Ads as an exact-match campaign negative, e.g. [cheap auto body]."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Matched Rules", "Rule IDs that fired (e.g. CHEAP, AUTO_GLASS). Official IDs are listed in the negatives sweeper guide."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Impressions", "Yesterday’s impressions for that term in this campaign."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Clicks", "Yesterday’s clicks for that term in this campaign."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Cost Yesterday", "What that term spent yesterday."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Cost Lookback", "What that term spent over the ~30-day guard window."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Conversions", "Primary conversions in the action window (should be 0 for auto-adds)."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Spend Summary", "Short blurb, e.g. $12.40 lookback / $3.10 yesterday / 0 conv."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Decision", "What the sweeper did: ADDED, MANUAL_REVIEW, FAILED, REMOVED, HIT_SAFETY_CEILING, etc."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Reason", "Why that decision happened, in plain English."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Reviewed", "Cream checkbox. Mark when you looked at this row. The sweeper never clears this."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Remove", "Cream checkbox. Next sweeper run deletes this exact negative from the campaign."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Status", "Lifecycle: ADDED, then maybe REMOVED after Remove."],
    ["Negatives Audit", "Auto-negative log for this shop only", "Removed At", "When the sweeper completed a Remove."],
    ["Negatives Audit", "Auto-negative log for this shop only", "AM Notes", "Cream free-text notes for the account manager."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Meeting", "Starts as — Select —. Click the dropdown and pick Not needed or Scheduled."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Day status", "Starts as — Select —. Pick Good (green), Needs Attention (yellow), or Urgent (red)."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Note type", "Starts as — Select —. Pick Note, Follow-up (orange), or Experiment (green). The Note type cell and Daily notes cell use the same color."],
    ["Daily Checklist", "Manager daily to-do list (first tab)", "Daily notes", "Write what you changed and why in plain words. Long notes wrap in a taller cell. The Engine does not write this tab."],
    ["Config", "Account settings (top of Config)", "Setting Key", "The name of the setting. Do not change these names. The script looks for these exact words."],
    ["Config", "Account settings (top of Config)", "Value", "The answer for that setting. Green values are copied from the Hub Sheet. Yellow values you can edit on this spoke."],
    ["Config", "Account settings (top of Config)", "Description", "A short note about the setting on the Config tab itself. For the full plain-English guide, use this Definitions tab."],
    ["Config", "Account settings (top of Config)", "CONFIG_VERSION", "Which version of this Config layout is in use. Leave it alone unless someone upgrades the whole template. Example: 1.5"],
    ["Config", "Account settings (top of Config)", "ACCOUNT_ID", "The Google Ads account number for this one body shop. Example: 123-456-7890. Edited on the Hub, then copied here (green). Keep it as text."],
    ["Config", "Account settings (top of Config)", "ACCOUNT_NAME", "The friendly Google Ads account name. Example: Auto Arena Body Shop Ads. Edited on the Hub, then copied here."],
    ["Config", "Account settings (top of Config)", "ACCOUNT_MONITORING_ENABLED", "On/off for watching this account. Enabled means the script should check it. Disabled means skip it. Comes from Hub Enabled."],
    ["Config", "Account settings (top of Config)", "ALERTS_ENABLED", "Master switch for alert emails for this shop. Enabled may send emails. Disabled still updates numbers but does not email. Comes from the Hub."],
    ["Config", "Account settings (top of Config)", "TIME_ZONE", "Time zone for this Sheet\'s dates. Example: America/New_York. Edit Time Zone on the Hub; the Engine copies it here (green) and can set the spoke Sheet time zone. Ads pacing still uses the live Google Ads account time zone."],
    ["Config", "Account settings (top of Config)", "DAILY_BUDGET", "How much ad money this shop is approved to spend on an average day. Example: 100 means about $100 per day. Comes from the Hub. Used to check if spend is on track."],
    ["Config", "Account settings (top of Config)", "MONTHLY_LEAD_GOAL", "How many leads this shop should get this month. Example: 40 leads. Comes from the Hub."],
    ["Config", "Account settings (top of Config)", "TARGET_CPL", "Goal cost per lead. CPL means how much you pay for one lead. Example: 100 means you hope each lead costs about $100. Comes from the Hub."],
    ["Config", "Account settings (top of Config)", "HIGH_CPL_MULTIPLIER", "How much higher than Target CPL counts as too expensive. Example: Target CPL $100 and multiplier 1.5 means worry around $150. Comes from the Hub."],
    ["Config", "Account settings (top of Config)", "ZERO_CONVERSION_SPEND_ALERT", "How much money can be spent with ZERO leads before we worry. Example: 100 means alert after about $100 spent with no leads. Comes from the Hub."],
    ["Config", "Account settings (top of Config)", "BUDGET_PACE_TOLERANCE", "How far spend can drift from the plan before we say off pace. Example: 15% means a little high or low is okay. Comes from the Hub."],
    ["Config", "Account settings (top of Config)", "LEAD_PACE_TOLERANCE", "How far lead count can drift from the plan before we say off pace. Example: 15%. Comes from the Hub."],
    ["Config", "Account settings (top of Config)", "ALERT_RECIPIENT_EMAILS", "Which email should get alerts for this shop. Example: manager@agency.com. Comes from the Hub."],
    ["Config", "Campaign configuration (yellow table)", "Campaign ID", "Google Ads ID for the campaign. Keep as text. Example: 111222333."],
    ["Config", "Campaign configuration (yellow table)", "Campaign Name", "Human name of the campaign. Example: Search - Branded."],
    ["Config", "Campaign configuration (yellow table)", "Campaign Type", "What kind of campaign it is. Example: Search or PMax."],
    ["Config", "Campaign configuration (yellow table)", "Monitor", "Should we watch this campaign? Enabled = yes. Disabled = ignore it for monitoring."],
    ["Config", "Campaign configuration (yellow table)", "Expected to Spend", "Do we expect this campaign to spend money? Enabled = yes (zero spend can look wrong). Disabled = spending is not expected (paused on purpose). Used by metrics formulas."],
    ["Config", "Campaign configuration (yellow table)", "Notes", "Optional notes for your team. Example: Seasonal campaign - only run in summer."],
    ["Config", "Ad group configuration (Search only, yellow table)", "Ad Group ID", "Google Ads ID for the Search ad group. Keep as text."],
    ["Config", "Ad group configuration (Search only, yellow table)", "Ad Group Name", "Human name of the ad group. Example: Windshield Repair."],
    ["Config", "Ad group configuration (Search only, yellow table)", "Campaign ID", "Which campaign this ad group belongs to (ID). Keep as text."],
    ["Config", "Ad group configuration (Search only, yellow table)", "Campaign Name", "Which campaign this ad group belongs to (name)."],
    ["Config", "Ad group configuration (Search only, yellow table)", "Monitor", "Should we watch this ad group (and its keywords by default)? Enabled = yes. Disabled = ignore."],
    ["Config", "Ad group configuration (Search only, yellow table)", "Notes", "Optional notes for your team."],
    ["Config", "Keyword overrides (optional exceptions)", "Keyword ID", "Google Ads keyword ID, only if you need a special rule. Keep as text. Most keywords are found automatically and do not need a row here."],
    ["Config", "Keyword overrides (optional exceptions)", "Keyword Text", "The keyword words. Example: auto body repair near me."],
    ["Config", "Keyword overrides (optional exceptions)", "Ad Group ID", "Which ad group the keyword sits in. Keep as text."],
    ["Config", "Keyword overrides (optional exceptions)", "Campaign ID", "Which campaign the keyword sits in. Keep as text."],
    ["Config", "Keyword overrides (optional exceptions)", "Monitor Override", "Special monitor rule for this keyword. INHERIT means follow the parent ad group. Or set Enabled / Disabled."],
    ["Config", "Keyword overrides (optional exceptions)", "Notes", "Optional notes about why this exception exists."],
    ["Config", "Alert routing (Hub-synced)", "ACCOUNT_MANAGER_NAME", "Name of the person who manages this shop day to day. Comes from the Hub. Example: Alex Rivera."],
    ["Config", "Alert routing (Hub-synced)", "ACCOUNT_MANAGER_EMAIL", "Email for the account manager. Comes from the Hub."],
    ["Config", "Alert routing (Hub-synced)", "CSM_NAME", "Optional customer success contact name. Comes from the Hub."],
    ["Config", "Alert routing (Hub-synced)", "CSM_EMAIL", "Optional customer success email. Comes from the Hub."],
    ["Config", "Alert routing (Hub-synced)", "CAMPAIGN_START_DATE", "Date this measured campaign period started. Used so early days are not judged too harshly on lead pace. Comes from the Hub. Example: Mar 1, 2026."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Date", "The day these numbers are for (in the account time zone). Example: 2026-08-09 means yesterday or that calendar day."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Account Status", "A short health label for the whole account that day, based on formulas. Example: On Pace, Needs Attention, or Excluded."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Budget Status", "Is ad spend on track versus the plan for this point in the month? Example: On pace, Over pace, Under pace."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Expected Spend", "About how much money we expected to have spent by this date, based on Daily Budget and days so far."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Actual Spend", "How much money Google Ads really spent on this date (or for the day row). Written by the script (green)."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Budget Pace %", "Actual spend divided by expected spend, shown as a percent. Example: 100% means right on plan. Traffic-light cell color: green above 105%, yellow from 95% to 105%, red below 95%."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Lead Status", "Are leads on track versus the monthly lead goal for this point in the month?"],
    ["Account Metrics (Daily)", "Whole-account daily health", "Expected Leads", "About how many leads we expected by this date, based on Monthly Lead Goal."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Google Ads Conversions", "How many leads (conversions) Google Ads counted for this day. This workbook uses Google Ads conversions as the lead source. Lead/CPL columns use a soft lavender tint so they read apart from spend columns."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Lead Pace %", "Actual leads divided by expected leads, as a percent. Example: 80% means behind plan. Traffic-light cell color: green above 105%, yellow from 95% to 105%, red below 95%."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Actual CPL", "Real cost per lead for the period. Spend divided by conversions (safe math if conversions are zero). Example: $120 CPL."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Target CPL", "The goal cost per lead, pulled from Config (from the Hub). Example: $100."],
    ["Account Metrics (Daily)", "Whole-account daily health", "CPL Status", "Is Actual CPL okay versus Target CPL and the High CPL Multiplier? Example: On target or Above target."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Active Alerts", "A short list of problems the formulas see for this day. Example: High CPL; Spend with no conversions. Also shows Manual edit detected if someone overrode a script/formula cell on this row."],
    ["Account Metrics (Daily)", "Whole-account daily health", "Notes", "Optional notes. If a person overrides a locked script/formula cell, the sheet stamps MANUAL EDIT here so Active Alerts can show Manual edit detected."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Date", "The day for this Search campaign row."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Campaign ID", "Google Ads campaign ID. Gray ID column. Keep as text."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Campaign Name", "Name of the Search campaign."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Campaign Type", "Campaign type from Google Ads. For this tab it should be Search."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Google Status", "Whether Google Ads shows the campaign as Enabled, Paused, Removed, etc."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Monitor", "Looked up from Config. Enabled means we are watching this campaign."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Expected to Spend", "Looked up from Config. Enabled means we expect this campaign to spend money."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Daily Budget", "The campaign daily budget amount from Google Ads for that day, when available."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Spend", "How much this Search campaign spent that day."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Impressions", "How many times ads from this campaign were shown."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Clicks", "How many times people clicked the ads."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "CTR", "Click-through rate. Clicks divided by impressions. Example: 5% means 5 clicks per 100 shows."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Avg. CPC", "Average cost per click. Spend divided by clicks. Example: $2.50 per click."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Conversions", "How many leads Google Ads counted for this campaign that day."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Conv. Rate", "Conversion rate. Conversions divided by clicks. Example: 10% means 1 lead per 10 clicks."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "CPL", "Cost per lead for this campaign that day. Spend divided by conversions."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Target CPL", "Goal cost per lead from Config (Hub)."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "CPL Status", "Is this campaign CPL okay versus the target?"],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Spend Status", "Is spend behaving as expected (including zero-spend / unexpected spend checks)?"],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Alert", "Any alert text for this campaign row from formulas. Also shows Manual edit detected if someone overrode a locked cell on this row."],
    ["Search Campaign Metrics (Daily)", "One row per Search campaign per day", "Notes", "Optional notes. A MANUAL EDIT stamp appears here if someone overrides a locked script/formula cell on this row."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Date", "The day for this keyword row."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Campaign ID", "Parent Search campaign ID."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Campaign Name", "Parent Search campaign name."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Ad Group ID", "Parent ad group ID."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Ad Group Name", "Parent ad group name."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Keyword ID", "Google Ads keyword ID. Keep as text."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Keyword Text", "The keyword itself. Example: dent repair near me."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Match Type", "How Google matches the keyword. Example: EXACT, PHRASE, or BROAD."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Google Status", "Whether the keyword is Enabled, Paused, etc. in Google Ads."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Monitor", "Whether we are watching this keyword (from Config / inheritance / overrides)."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Spend", "Ad spend for this keyword that day."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Impressions", "How many times ads showed for this keyword."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Clicks", "How many clicks this keyword got."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "CTR", "Clicks divided by impressions."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Avg. CPC", "Average cost per click for this keyword."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Conversions", "Leads counted for this keyword that day."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Conv. Rate", "Conversions divided by clicks."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "CPL", "Cost per lead for this keyword."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Target CPL", "Goal cost per lead from Config."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "CPL Status", "Is keyword CPL okay versus target?"],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Alert", "Any alert text for this keyword row. Also shows Manual edit detected if someone overrode a locked cell on this row."],
    ["Search Keyword Metrics (Daily)", "One row per Search keyword per day (auto-filled by the script)", "Notes", "Optional notes. A MANUAL EDIT stamp appears here if someone overrides a locked script/formula cell on this row."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Date", "The day for this PMax campaign row."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Campaign ID", "Google Ads PMax campaign ID. Keep as text."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Campaign Name", "Name of the Performance Max campaign."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Google Status", "Enabled, Paused, Removed, etc. in Google Ads."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Monitor", "Looked up from Config. Are we watching this PMax campaign?"],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Expected to Spend", "Looked up from Config. Do we expect it to spend?"],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Daily Budget", "PMax campaign daily budget from Google Ads when available."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Spend", "How much this PMax campaign spent that day."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Impressions", "How many times PMax ads were shown."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Clicks", "How many clicks PMax got."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "CTR", "Clicks divided by impressions."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Avg. CPC", "Average cost per click."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Conversions", "Leads counted for this PMax campaign that day."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Conv. Rate", "Conversions divided by clicks."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "CPL", "Cost per lead for this PMax campaign."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Target CPL", "Goal cost per lead from Config."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "CPL Status", "Is PMax CPL okay versus target?"],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Spend Status", "Is PMax spend behaving as expected?"],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Alert", "Any alert text for this PMax campaign row. Also shows Manual edit detected if someone overrode a locked cell on this row."],
    ["PMax Campaign Metrics (Daily)", "One row per Performance Max campaign per day", "Notes", "Optional notes. A MANUAL EDIT stamp appears here if someone overrides a locked script/formula cell on this row."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Week Ending", "The last day of the week these numbers cover. Example: 2026-08-09 means the week that ended that Sunday (or your configured week end)."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Campaign ID", "Which campaign these location numbers belong to."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Campaign Name", "Campaign name."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Location", "The place name. Example: Austin, TX or a ZIP / region name Google reports."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Location Type", "What kind of place it is. Example: City, Region, or Postal code."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Campaign Monitor", "Whether the parent campaign is monitored in Config."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Spend", "Ad spend in that location for the week."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Impressions", "Ad shows in that location for the week."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Clicks", "Clicks in that location for the week."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "CTR", "Clicks divided by impressions for that location."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Conversions", "Leads from that location for the week."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Conv. Rate", "Conversions divided by clicks."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "CPL", "Cost per lead for that location week."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Target CPL", "Goal cost per lead from Config."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "CPL Status", "Is location CPL okay versus target?"],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Alert", "Any alert text for this location row. Also shows Manual edit detected if someone overrode a locked cell on this row."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Action Status", "Your team decision for this location. Choices like Keep, Review, Exclude, or Insufficient Data. Example: Exclude a far-away city that wastes spend. Freely editable (no edit warning)."],
    ["Location Metrics (Weekly)", "Weekly roll-up by place (not every day)", "Notes", "Optional notes about the location decision. A MANUAL EDIT stamp appears here if someone overrides a locked script/formula cell on this row."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Week Ending", "The last day of the week these device numbers cover."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Campaign ID", "Which campaign these device numbers belong to."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Campaign Name", "Campaign name."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Device", "The device type. Example: MOBILE, DESKTOP, or TABLET."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Campaign Monitor", "Whether the parent campaign is monitored in Config."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Spend", "Ad spend on that device for the week."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Impressions", "Ad shows on that device for the week."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Clicks", "Clicks on that device for the week."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "CTR", "Clicks divided by impressions on that device."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Conversions", "Leads from that device for the week."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Conv. Rate", "Conversions divided by clicks."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "CPL", "Cost per lead on that device for the week."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Target CPL", "Goal cost per lead from Config."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "CPL Status", "Is device CPL okay versus target?"],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Alert", "Any alert text for this device row. Also shows Manual edit detected if someone overrode a locked cell on this row."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Action Status", "Your team decision for this device split. Choices like Keep, Review, Exclude, or Insufficient Data. Freely editable (no edit warning)."],
    ["Device Metrics (Weekly)", "Weekly roll-up by device (phone, computer, tablet)", "Notes", "Optional notes about the device decision. A MANUAL EDIT stamp appears here if someone overrides a locked script/formula cell on this row."],
    ["Instructions", "How to use this workbook", "(whole tab)", "Step-by-step rules for people. Read this when you are new to the Sheet. It explains yellow vs blue vs green cells and what to edit on the Hub vs here."],
    ["Definitions", "This glossary", "(whole tab)", "Plain-English meanings for every important column and Config setting, grouped by tab. If a header is confusing, find that tab section here."],
  ];
}

/* -------------------------------------------------------------------------- */
/* CONFIG                                                                     */
/* -------------------------------------------------------------------------- */

function writeConfigSheet_(sheet) {
  var shop = String(SETUP_CONFIG.BODY_SHOP_NAME || 'Body Shop').trim();
  sheet.getRange('A1:J1').merge()
      .setValue(shop + ' — Account Configuration');
  styleTitleRow_(sheet, 1, 10);
  writeLegendRow_(sheet, 2);

  // Account settings block (B11–B17 must stay aligned with metrics formulas).
  sheet.getRange(4, 1, 1, 3).setValues([['Setting Key', 'Value', 'Description']]);
  styleHeaderRow_(sheet, 4, 3);

  var settings = [
    ['CONFIG_VERSION', '1.5', 'Do not change unless the workbook template is upgraded.'],
    ['ACCOUNT_ID', String(SETUP_CONFIG.ACCOUNT_ID || ''), 'HUB SYNCED — edit Account ID on the Hub. Temporary seed until first Engine sync.'],
    ['ACCOUNT_NAME', shop, 'HUB SYNCED — edit Account Name on the Hub. Temporary seed until first Engine sync.'],
    ['ACCOUNT_MONITORING_ENABLED', 'Enabled', 'HUB SYNCED — mirrors Hub Enabled (Enabled/Disabled). Temporary seed until first Engine sync.'],
    ['ALERTS_ENABLED', 'Enabled', 'HUB SYNCED — edit Alerts Enabled on the Hub. Master switch for sending alerts.'],
    ['TIME_ZONE', SETUP_CONFIG.TIME_ZONE || 'America/New_York', 'HUB SYNCED — edit Time Zone on the Hub. Temporary seed until first Engine sync.'],
    ['DAILY_BUDGET', Number(SETUP_CONFIG.DAILY_BUDGET || 0), 'HUB SYNCED — edit Daily Budget on the Hub. Used by MTD pacing formulas.'],
    ['MONTHLY_LEAD_GOAL', Number(SETUP_CONFIG.MONTHLY_LEAD_GOAL || 0), 'HUB SYNCED — edit Monthly Lead Goal on the Hub.'],
    ['TARGET_CPL', Number(SETUP_CONFIG.TARGET_CPL || 0), 'HUB SYNCED — edit Target CPL on the Hub.'],
    ['HIGH_CPL_MULTIPLIER', Number(SETUP_CONFIG.HIGH_CPL_MULTIPLIER || 1.5), 'HUB SYNCED — edit High CPL Multiplier on the Hub. Used by metrics formulas.'],
    ['ZERO_CONVERSION_SPEND_ALERT', Number(SETUP_CONFIG.ZERO_CONVERSION_SPEND_ALERT || 100), 'HUB SYNCED — edit Zero Conversion Spend Alert on the Hub. Used by metrics formulas.'],
    ['BUDGET_PACE_TOLERANCE', Number(SETUP_CONFIG.BUDGET_PACE_TOLERANCE || 0.15), 'HUB SYNCED — edit Budget Pace Tolerance on the Hub. Used by metrics formulas.'],
    ['LEAD_PACE_TOLERANCE', Number(SETUP_CONFIG.LEAD_PACE_TOLERANCE || 0.15), 'HUB SYNCED — edit Lead Pace Tolerance on the Hub. Used by metrics formulas.'],
    ['ALERT_RECIPIENT_EMAILS', String(SETUP_CONFIG.ALERT_RECIPIENT_EMAILS || ''), 'HUB SYNCED — edit Account Manager Email on the Hub.']
  ];
  sheet.getRange(5, 1, settings.length, 3).setValues(settings);
  sheet.getRange(5, 1, settings.length, 1).setBackground(COLORS.ID_KEY);
  colorSpokeSettingValues_(sheet, 5, settings);
  sheet.getRange('B11').setNumberFormat('$#,##0.00');
  sheet.getRange('B13').setNumberFormat('$#,##0.00');
  sheet.getRange('B15').setNumberFormat('$#,##0.00');
  sheet.getRange('B16').setNumberFormat('0%');
  sheet.getRange('B17').setNumberFormat('0%');

  // Campaign configuration — cols 4=Monitor, 5=Expected to Spend (VLOOKUP)
  writeSectionBanner_(sheet, 21,
      'CAMPAIGN CONFIGURATION — list every campaign you expect to watch (your expected setup checklist)', 6);
  sheet.getRange(22, 1, 1, 6).setValues([[
    'Campaign ID', 'Campaign Name', 'Campaign Type', 'Monitor',
    'Expected to Spend', 'Notes'
  ]]);
  styleHeaderRow_(sheet, 22, 6);
  writeColumnGuideRow_(sheet, 23, [
    'TYPE THIS (gray ID). Copy the campaign ID from Google Ads. Keep as text. Example: 1234567890',
    'TYPE THIS (yellow). Friendly campaign name. Example: Search - Branded',
    'PICK ONE (yellow): Search, PMax, Display, Demand Gen, or Other',
    'PICK ONE (yellow): Enabled = watch this campaign. Disabled = ignore it',
    'PICK ONE (yellow): Enabled = we expect it to spend. Disabled = paused on purpose',
    'OPTIONAL (yellow). Free notes for your team'
  ], 6);
  sheet.getRange('A24:A33').setBackground(COLORS.ID_KEY).setNumberFormat('@');
  sheet.getRange('B24:C33').setBackground(COLORS.USER_INPUT);
  sheet.getRange('D24:F33').setBackground(COLORS.USER_INPUT);

  // Ad group configuration — col 5=Monitor (VLOOKUP for keyword inheritance)
  writeSectionBanner_(sheet, 36,
      'AD GROUP CONFIGURATION — list Search ad groups you expect to watch (keywords inherit Monitor)', 6);
  sheet.getRange(37, 1, 1, 6).setValues([[
    'Ad Group ID', 'Ad Group Name', 'Campaign ID', 'Campaign Name',
    'Monitor', 'Notes'
  ]]);
  styleHeaderRow_(sheet, 37, 6);
  writeColumnGuideRow_(sheet, 38, [
    'TYPE THIS (gray ID). Search ad group ID from Google Ads. Keep as text',
    'TYPE THIS (yellow). Ad group name. Example: Windshield Repair',
    'TYPE THIS (gray ID). Parent campaign ID (must match a campaign above)',
    'TYPE THIS (yellow). Parent campaign name',
    'PICK ONE (yellow): Enabled = watch this ad group + its keywords. Disabled = ignore',
    'OPTIONAL (yellow). Free notes for your team'
  ], 6);
  sheet.getRange('A39:A58').setBackground(COLORS.ID_KEY).setNumberFormat('@');
  sheet.getRange('C39:C58').setBackground(COLORS.ID_KEY).setNumberFormat('@');
  sheet.getRange('B39:B58').setBackground(COLORS.USER_INPUT);
  sheet.getRange('D39:F58').setBackground(COLORS.USER_INPUT);

  // Keyword overrides
  writeSectionBanner_(sheet, 61,
      'KEYWORD OVERRIDES — OPTIONAL. Skip this; keywords are auto-filled. Use only for one weird exception', 6);
  sheet.getRange(62, 1, 1, 6).setValues([[
    'Keyword ID', 'Keyword Text', 'Ad Group ID', 'Campaign ID',
    'Monitor Override', 'Notes'
  ]]);
  styleHeaderRow_(sheet, 62, 6);
  writeColumnGuideRow_(sheet, 63, [
    'ONLY IF NEEDED (gray ID). Keyword ID. Leave blank if skipping this whole section',
    'ONLY IF NEEDED (yellow). The keyword text. Example: dent repair near me',
    'ONLY IF NEEDED (gray ID). Parent ad group ID',
    'ONLY IF NEEDED (gray ID). Parent campaign ID',
    'ONLY IF NEEDED (yellow): INHERIT (normal), or force Enabled / Disabled',
    'OPTIONAL (yellow). Why this exception exists'
  ], 6);
  sheet.getRange('A64:A83').setBackground(COLORS.ID_KEY).setNumberFormat('@');
  sheet.getRange('C64:D83').setBackground(COLORS.ID_KEY).setNumberFormat('@');
  sheet.getRange('B64:B83').setBackground(COLORS.USER_INPUT);
  sheet.getRange('E64:F83').setBackground(COLORS.USER_INPUT);

  // Alert routing
  writeSectionBanner_(sheet, 86,
      'ALERT ROUTING — usually filled from the Hub (green). Do not hand-edit green cells', 3);
  sheet.getRange(87, 1, 1, 3).setValues([['Setting Key', 'Value', 'Description']]);
  styleHeaderRow_(sheet, 87, 3);
  writeColumnGuideRow_(sheet, 88, [
    'DO NOT CHANGE (gray key). Fixed names the script looks for',
    'FILLED BY HUB SYNC (green). Edit these on the Hub Config row for this shop, not here',
    'READ THIS. What that Hub-synced value is for'
  ], 3);
  var routing = [
    ['ACCOUNT_MANAGER_NAME', String(SETUP_CONFIG.ACCOUNT_MANAGER_NAME || ''),
     'HUB SYNCED — manager name. Edit Account Manager Name on the Hub.'],
    ['ACCOUNT_MANAGER_EMAIL', String(SETUP_CONFIG.ACCOUNT_MANAGER_EMAIL || ''),
     'HUB SYNCED — who gets alert emails. Edit Account Manager Email on the Hub.'],
    ['CSM_NAME', '',
     'HUB SYNCED — optional CSM name. Edit CSM Name on the Hub.'],
    ['CSM_EMAIL', '',
     'HUB SYNCED — optional CSM email. Edit CSM Email on the Hub.'],
    ['CAMPAIGN_START_DATE', '',
     'HUB SYNCED — when this measured period started. Edit Campaign Start Date on the Hub.']
  ];
  sheet.getRange(89, 1, routing.length, 3).setValues(routing);
  sheet.getRange(89, 1, routing.length, 1).setBackground(COLORS.ID_KEY);
  colorSpokeSettingValues_(sheet, 89, routing);
  sheet.getRange('B93').setNumberFormat('m/d/yyyy');

  if (SETUP_CONFIG.INCLUDE_SAMPLE_ENTITIES) {
    seedSampleEntities_(sheet);
  }

  applyConfigValidations_(sheet);
  setColumnWidthsChars_(sheet, [36, 34, 56, 30, 22, 24, 22, 22, 42, 12]);
  sheet.setFrozenRows(4);
}

/**
 * Green = Hub-synced / Engine-owned. Yellow = local human input.
 * Gray keys stay on column A via the caller.
 */
function colorSpokeSettingValues_(sheet, startRow, rows) {
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i][0] || '');
    var cell = sheet.getRange(startRow + i, 2);
    if (HUB_SYNCED_SETTING_KEYS[key]) {
      cell.setBackground(COLORS.SCRIPT);
      cell.setNote('Synced from Hub by the MCC Engine. Edit this value on the Hub Config tab, not here.');
    } else if (key === 'CONFIG_VERSION') {
      cell.setBackground(COLORS.ID_KEY);
    } else {
      cell.setBackground(COLORS.USER_INPUT);
    }
  }
  // Account ID must stay plain text.
  if (startRow === 5) {
    sheet.getRange('B6').setNumberFormat('@');
  }
}

/**
 * Warn editors away from Hub-synced goal cells. Warning-only so the Engine
 * (and spreadsheet owner) can still update values without a hard lockout.
 * Prefer protectSpokeLockedRanges_ / refreshSpokeProtections for full coverage.
 */
function protectHubSyncedConfigCells_(sheet) {
  protectConfigHubSyncedValues_(sheet);
}

function seedSampleEntities_(sheet) {
  sheet.getRange(24, 1, 2, 6).setValues([
    ['23422205641', 'Built by Shah - Google Ad Campaign', 'Search', 'Enabled', 'Enabled', ''],
    ['23417873411', 'Retargeting (Non-Converted Search Campaign Visitors) – Built by Shah', 'PMax', 'Enabled', 'Enabled', '']
  ]);
  sheet.getRange(39, 1, 1, 6).setValues([[
    '188854424857', 'Generic Body Shop Search', '23422205641',
    'Built by Shah - Google Ad Campaign', 'Enabled', ''
  ]]);
}

function applyConfigValidations_(sheet) {
  var enabledRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Enabled', 'Disabled'], true)
      .setAllowInvalid(false)
      .setHelpText('Choose Enabled or Disabled.')
      .build();

  // Account settings that use Enabled/Disabled (single cells — not empty ranges).
  sheet.getRange('B8').setDataValidation(enabledRule);
  sheet.getRange('B9').setDataValidation(enabledRule);

  // Campaign / ad group dropdowns only on a few starter rows so empty Config
  // does not show a long wall of arrows. Yellow formatting still marks the full
  // input area; copy a filled row down to extend validation if needed.
  sheet.getRange('D24:E28').setDataValidation(enabledRule);
  sheet.getRange('E39:E43').setDataValidation(enabledRule);

  // TIME_ZONE (B10) is Hub-synced — edit on Hub Config "Time Zone", not here.

  var typeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Search', 'PMax', 'Display', 'Demand Gen', 'Other'], true)
      .setAllowInvalid(false)
      .setHelpText('Campaign type for this monitored campaign.')
      .build();
  sheet.getRange('C24:C28').setDataValidation(typeRule);

  var inheritRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['INHERIT', 'Enabled', 'Disabled'], true)
      .setAllowInvalid(false)
      .setHelpText('INHERIT follows the parent campaign/ad group. Or force Enabled / Disabled.')
      .build();
  // Only a few starter override rows — not 20 empty dropdowns.
  sheet.getRange('E64:E68').setDataValidation(inheritRule);
}

/* -------------------------------------------------------------------------- */
/* DAILY CHECKLIST (human-owned; Engine does not write this tab)              */
/* -------------------------------------------------------------------------- */

var DAILY_CHECKLIST_SELECT = '— Select —';
var DAILY_CHECKLIST_DATE_FORMAT = 'ddd m/d/yyyy';
var DAILY_CHECKLIST_DATA_ROW_HEIGHT = 72;

var DAILY_CHECKLIST_TASK_OPTIONS = [
  [DAILY_CHECKLIST_SELECT, 'All clear', 'Follow-up needed', 'Critical alert'],
  [DAILY_CHECKLIST_SELECT, 'On pace', 'Soft miss', 'Off pace — fix'],
  [DAILY_CHECKLIST_SELECT, 'On pace', 'Soft miss', 'Off pace — fix'],
  [DAILY_CHECKLIST_SELECT, 'Leads OK', 'Thin day', 'Zero leads w/ spend'],
  [DAILY_CHECKLIST_SELECT, 'Stable', 'Watching a change', 'Big swing — dig in'],
  [DAILY_CHECKLIST_SELECT, 'Clean', 'Cleanup done', 'Heavy waste'],
  [DAILY_CHECKLIST_SELECT, 'Clean', 'Fixed a bad block', 'Critical false block']
];

var DAILY_CHECKLIST_STATUS_GREEN = {
  'All clear': true,
  'On pace': true,
  'Leads OK': true,
  'Stable': true,
  'Clean': true,
  'Good': true
};

var DAILY_CHECKLIST_STATUS_YELLOW = {
  'Follow-up needed': true,
  'Soft miss': true,
  'Thin day': true,
  'Watching a change': true,
  'Cleanup done': true,
  'Fixed a bad block': true,
  'Needs Attention': true
};

var DAILY_CHECKLIST_STATUS_RED = {
  'Critical alert': true,
  'Off pace — fix': true,
  'Zero leads w/ spend': true,
  'Big swing — dig in': true,
  'Heavy waste': true,
  'Critical false block': true,
  'Urgent': true
};

var DAILY_CHECKLIST_HEADERS = [
  'Day / Date',
  'Status emails',
  'Budget pace',
  'Lead pace',
  'Conversions',
  'Trend check',
  'Search terms',
  'Negatives audit',
  'Meeting',
  'Day status',
  'Note type',
  'Daily notes'
];

var DAILY_CHECKLIST_GUIDES = [
  'Shows weekday + date (example: Wed 8/12/2026). Filled for today when you add a row. You still review yesterday’s metrics on the other tabs.',
  'Open your email for this shop. Pick All clear (green), Follow-up needed (yellow), or Critical alert (red). Starts as — Select —.',
  'Check Budget Pace on Account Metrics (Daily) plus Search and PMax campaign tabs. Pick On pace (green), Soft miss (yellow), or Off pace — fix (red).',
  'Check Lead Pace on Account Metrics (Daily) plus Search and PMax campaign tabs. Pick On pace (green), Soft miss (yellow), or Off pace — fix (red).',
  'Check yesterday’s conversions. Pick Leads OK (green), Thin day (yellow), or Zero leads w/ spend (red).',
  'Compare yesterday to recent days. Pick Stable (green), Watching a change (yellow), or Big swing — dig in (red).',
  'Review yesterday’s search terms. Pick Clean (green), Cleanup done (yellow), or Heavy waste (red).',
  'Audit negatives from yesterday. Pick Clean (green), Fixed a bad block (yellow), or Critical false block (red).',
  'Click this cell’s dropdown and pick Not needed or Scheduled. Leave “— Select —” until you choose.',
  'Click this cell’s dropdown and pick Good (green), Needs Attention (yellow), or Urgent (red). Leave “— Select —” until you choose.',
  'Click this cell’s dropdown and pick Note, Follow-up, or Experiment. The Note type cell and Daily notes cell share the same color.',
  'Write what you changed and why (based on yesterday’s review). Long notes wrap in this taller cell. Use plain words.'
];

var DAILY_CHECKLIST_WIDTHS = [
  170, 170, 150, 150, 180, 180, 150, 180, 160, 170, 150, 380
];

/**
 * Refresh only the Daily Checklist tab (keeps history when headers match).
 * For existing spokes that already have the full generator project.
 */
function refreshDailyChecklistTab() {
  var spreadsheet = getOrCreateTargetSpreadsheet_();
  var preserved = snapshotDailyChecklistRows_(spreadsheet);
  var sheet = writeDailyChecklistSheet_(
      ensureSheet_(spreadsheet, SHEETS.DAILY_CHECKLIST),
      spreadsheet,
      preserved
  );
  orderSheets_(spreadsheet, spokeTabOrder_());
  colorSpokeTabs_(spreadsheet);
  ensureTodaysChecklistRowOnSheet_(spreadsheet, sheet);
  spreadsheet.setActiveSheet(sheet);
  Logger.log('Daily Checklist refreshed: ' + spreadsheet.getUrl());
  try {
    SpreadsheetApp.getUi().alert(
        'Daily Checklist ready',
        'Daily Checklist is the first tab.\n\n' +
        'WHERE TO CLICK:\n' +
        'Look at the VERY TOP menu bar (same row as File, Edit, View, Insert).\n' +
        'Click “Built by Shah”, then “Add today’s checklist row”.\n\n' +
        'Change every “— Select —” dropdown to a real green / yellow / red choice.\n' +
        'Day / Date shows weekday + date. Review yesterday’s metrics on the other tabs.',
        SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // Standalone.
  }
  return spreadsheet.getUrl();
}

/**
 * Insert today’s blank checklist row under the guide (newest on top).
 */
function addTodaysChecklistRow() {
  var spreadsheet = getOrCreateTargetSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(SHEETS.DAILY_CHECKLIST);
  if (!sheet) {
    refreshDailyChecklistTab();
    return;
  }
  var added = ensureTodaysChecklistRowOnSheet_(spreadsheet, sheet);
  if (!added) {
    var tz = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/New_York';
    var today = Utilities.formatDate(new Date(), tz, 'EEE M/d/yyyy');
    try {
      SpreadsheetApp.getUi().alert(
          'Today already added',
          'A Daily Checklist row for ' + today + ' is already on this tab.\n\n' +
          'Day / Date is today (the day you work). Metrics tabs still show yesterday’s Ads results.',
          SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {
      Logger.log('Today already added: ' + today);
    }
  }
  spreadsheet.setActiveSheet(sheet);
  sheet.setActiveRange(sheet.getRange(4, 1));
}

function ensureTodaysChecklistRowOnSheet_(spreadsheet, sheet) {
  var tz = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/New_York';
  var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var todayDate = checklistTodayDateObjectShared_(tz);
  if (dailyChecklistHasDateKey_(sheet, todayKey, tz)) {
    var n = Math.max(1, sheet.getLastRow() - 3);
    applyDailyChecklistRowControls_(sheet, 4, n);
    sheet.getRange(4, 1, n, 1).setNumberFormat(DAILY_CHECKLIST_DATE_FORMAT);
    forceDailyChecklistSelectPlaceholders_(sheet, 4, n);
    sortDailyChecklistDataNewestFirst_(sheet, tz);
    SpreadsheetApp.flush();
    return false;
  }
  sheet.insertRowBefore(4);
  writeDailyChecklistDataRow_(sheet, 4, blankDailyChecklistRow_(todayDate), tz);
  applyDailyChecklistRowControls_(sheet, 4, 1);
  sortDailyChecklistDataNewestFirst_(sheet, tz);
  SpreadsheetApp.flush();
  Logger.log('Added Daily Checklist row for ' + todayKey);
  return true;
}

function blankDailyChecklistRow_(dateValue) {
  return {
    date: dateValue,
    statuses: [
      DAILY_CHECKLIST_SELECT, DAILY_CHECKLIST_SELECT, DAILY_CHECKLIST_SELECT,
      DAILY_CHECKLIST_SELECT, DAILY_CHECKLIST_SELECT, DAILY_CHECKLIST_SELECT,
      DAILY_CHECKLIST_SELECT
    ],
    meeting: DAILY_CHECKLIST_SELECT,
    status: DAILY_CHECKLIST_SELECT,
    noteType: DAILY_CHECKLIST_SELECT,
    notes: ''
  };
}

function checklistTodayDateObjectShared_(timeZone) {
  var ymd = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  var parts = ymd.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
}

function coerceSpokeChecklistDate_(value, timeZone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }
  if (value === '' || value === null || value === undefined) {
    return checklistTodayDateObjectShared_(timeZone);
  }
  var parsed = new Date(value);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  return checklistTodayDateObjectShared_(timeZone);
}

function snapshotDailyChecklistRows_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(SHEETS.DAILY_CHECKLIST);
  if (!sheet || sheet.getLastRow() < 4) {
    return [];
  }
  var headers = sheet.getRange(2, 1, 1, DAILY_CHECKLIST_HEADERS.length).getValues()[0];
  for (var h = 0; h < DAILY_CHECKLIST_HEADERS.length; h++) {
    var actual = String(headers[h] || '').trim();
    var expected = DAILY_CHECKLIST_HEADERS[h];
    if (h === 0 && (actual === 'Date' || actual === 'Day / Date')) {
      continue;
    }
    if (actual !== expected) {
      Logger.log('Daily Checklist headers differ — history not restored on rebuild.');
      return [];
    }
  }
  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(4, 1, lastRow - 3, DAILY_CHECKLIST_HEADERS.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var blank = true;
    for (var c = 0; c < row.length; c++) {
      if (row[c] !== '' && row[c] !== null && row[c] !== false) {
        blank = false;
        break;
      }
    }
    if (blank) {
      continue;
    }
    rows.push(normalizeDailyChecklistRowObject_(row));
  }
  return sortDailyChecklistRowsNewestFirst_(
      rows,
      spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/New_York');
}

function migrateDailyChecklistTaskStatus_(taskIndex, value) {
  var options = DAILY_CHECKLIST_TASK_OPTIONS[taskIndex];
  var green = options[1];
  if (value === true || value === 'TRUE') {
    return green;
  }
  if (value === false || value === 'FALSE' || value === '' || value === null ||
      value === undefined) {
    return DAILY_CHECKLIST_SELECT;
  }
  var s = String(value).trim();
  if (!s || s === DAILY_CHECKLIST_SELECT) {
    return DAILY_CHECKLIST_SELECT;
  }
  for (var i = 0; i < options.length; i++) {
    if (options[i] === s) {
      return s;
    }
  }
  return DAILY_CHECKLIST_SELECT;
}

function normalizeDailyChecklistRowObject_(row) {
  var statuses = [];
  for (var t = 0; t < 7; t++) {
    statuses.push(migrateDailyChecklistTaskStatus_(t, row[t + 1]));
  }
  var notes = String(row[11] || '');
  var end = normalizeDailyChecklistEndDropdowns_(row[8], row[9], row[10], notes, statuses);
  return {
    date: row[0],
    statuses: statuses,
    meeting: end.meeting,
    status: end.status,
    noteType: end.noteType,
    notes: notes
  };
}

function dailyChecklistTaskStatusesAreAllSelect_(statuses) {
  if (!statuses || !statuses.length) {
    return true;
  }
  for (var i = 0; i < statuses.length; i++) {
    if (String(statuses[i] || '').trim() !== DAILY_CHECKLIST_SELECT) {
      return false;
    }
  }
  return true;
}

function normalizeDailyChecklistEndDropdowns_(meeting, status, noteType, notes, statuses) {
  var m = String(meeting || '').trim();
  var s = String(status || '').trim();
  var n = String(noteType || '').trim();
  var noteText = String(notes || '').trim();
  var looksNeverTouched =
      dailyChecklistTaskStatusesAreAllSelect_(statuses) &&
      !noteText &&
      (m === '' || m === 'Not needed' || m === DAILY_CHECKLIST_SELECT) &&
      (s === '' || s === 'Good' || s === DAILY_CHECKLIST_SELECT) &&
      (n === '' || n === 'Note' || n === DAILY_CHECKLIST_SELECT);
  if (looksNeverTouched) {
    return {
      meeting: DAILY_CHECKLIST_SELECT,
      status: DAILY_CHECKLIST_SELECT,
      noteType: DAILY_CHECKLIST_SELECT
    };
  }
  return {
    meeting: m || DAILY_CHECKLIST_SELECT,
    status: s || DAILY_CHECKLIST_SELECT,
    noteType: n || DAILY_CHECKLIST_SELECT
  };
}

function forceDailyChecklistSelectPlaceholders_(sheet, startRow, rowCount) {
  if (rowCount < 1) {
    return;
  }
  var range = sheet.getRange(startRow, 1, rowCount, DAILY_CHECKLIST_HEADERS.length);
  var values = range.getValues();
  for (var i = 0; i < values.length; i++) {
    var obj = normalizeDailyChecklistRowObject_(values[i]);
    values[i][1] = obj.statuses[0];
    values[i][2] = obj.statuses[1];
    values[i][3] = obj.statuses[2];
    values[i][4] = obj.statuses[3];
    values[i][5] = obj.statuses[4];
    values[i][6] = obj.statuses[5];
    values[i][7] = obj.statuses[6];
    values[i][8] = obj.meeting;
    values[i][9] = obj.status;
    values[i][10] = obj.noteType;
  }
  range.setValues(values);
  sheet.getRange(startRow, 1, rowCount, 1).setNumberFormat(DAILY_CHECKLIST_DATE_FORMAT);
}

function writeDailyChecklistSheet_(sheet, spreadsheet, preservedRows) {
  var colCount = DAILY_CHECKLIST_HEADERS.length;
  var shop = String(SETUP_CONFIG.BODY_SHOP_NAME || 'Body Shop').trim();

  try {
    sheet.getRange(1, 1, Math.max(3, sheet.getMaxRows()), Math.max(colCount, sheet.getMaxColumns()))
        .breakApart();
  } catch (eBreak) {
    // No merges to break.
  }

  var howTo =
      'HOW TO USE — read this first\n' +
      '1) Look at the VERY TOP of this Google Sheet window — the menu bar on the same row as File, Edit, View, Insert, Format, Data, Tools…\n' +
      '2) Click the custom menu named “Built by Shah” (it sits next to Help on that top bar).\n' +
      '3) Click “Add today’s checklist row” if today’s day/date is missing. That creates the whole row with dropdowns. Do not build rows by hand.\n' +
      '4) For every column from Status emails through Note type: click the dropdown and change “— Select —” to a real choice. Green = healthy, yellow = watching, red = fix / escalate.\n' +
      '5) Write Daily notes (they wrap in the tall cell). Newest days stay on top, like the metrics tabs.\n' +
      'Day / Date = today (the day you work). Review YESTERDAY’s Ads numbers on the other tabs. Follow-up notes = orange. Experiment = green.';

  try {
    sheet.setFrozenRows(0);
    sheet.setFrozenColumns(0);
  } catch (eUnfreeze) {
    // Ignore.
  }

  sheet.getRange(1, 1)
      .setValue(shop + ' — Daily Checklist')
      .setBackground(COLORS.TITLE)
      .setFontColor(COLORS.WHITE)
      .setFontWeight('bold')
      .setFontSize(12)
      .setWrap(true)
      .setVerticalAlignment('top');

  if (colCount > 1) {
    sheet.getRange(1, 2, 1, colCount - 1).merge();
    sheet.getRange(1, 2)
        .setValue(howTo)
        .setBackground(COLORS.TITLE)
        .setFontColor(COLORS.WHITE)
        .setFontWeight('normal')
        .setFontSize(10)
        .setWrap(true)
        .setVerticalAlignment('top');
  }
  sheet.setRowHeight(1, 160);

  sheet.getRange(2, 1, 1, colCount).setValues([DAILY_CHECKLIST_HEADERS]);
  sheet.getRange(2, 1, 1, colCount)
      .setBackground(COLORS.HEADER)
      .setFontColor(COLORS.WHITE)
      .setFontWeight('bold')
      .setWrap(true)
      .setVerticalAlignment('middle');
  sheet.setRowHeight(2, 36);

  sheet.getRange(3, 1, 1, colCount).setValues([DAILY_CHECKLIST_GUIDES]);
  sheet.getRange(3, 1, 1, colCount)
      .setBackground(COLORS.GUIDE)
      .setFontColor('#444444')
      .setFontStyle('italic')
      .setFontSize(9)
      .setWrap(true)
      .setVerticalAlignment('top');
  sheet.setRowHeight(3, 120);

  for (var c = 0; c < DAILY_CHECKLIST_WIDTHS.length; c++) {
    sheet.setColumnWidth(c + 1, DAILY_CHECKLIST_WIDTHS[c]);
  }

  sheet.setFrozenRows(3);
  sheet.setFrozenColumns(1);

  var writeRows = preservedRows && preservedRows.length ? preservedRows.slice() : [];
  var tzWrite = (spreadsheet && spreadsheet.getSpreadsheetTimeZone()) ||
      Session.getScriptTimeZone() || 'America/New_York';
  if (!writeRows.length) {
    writeRows.push(blankDailyChecklistRow_(checklistTodayDateObjectShared_(tzWrite)));
  }
  writeRows = sortDailyChecklistRowsNewestFirst_(writeRows, tzWrite);

  for (var r = 0; r < writeRows.length; r++) {
    writeDailyChecklistDataRow_(sheet, 4 + r, writeRows[r], tzWrite);
  }
  applyDailyChecklistRowControls_(sheet, 4, writeRows.length);
  sheet.getRange(4, 1, 400, 1).setNumberFormat(DAILY_CHECKLIST_DATE_FORMAT);
  sheet.getRange(4, 12, 400, 1).setWrap(true).setVerticalAlignment('top');
  sheet.setRowHeights(4, 60, DAILY_CHECKLIST_DATA_ROW_HEIGHT);
  applyDailyChecklistConditionalFormats_(sheet);
  return sheet;
}

function sortDailyChecklistRowsNewestFirst_(rows, timeZone) {
  var list = (rows || []).slice();
  list.sort(function(a, b) {
    var da = coerceSpokeChecklistDate_(a.date, timeZone).getTime();
    var db = coerceSpokeChecklistDate_(b.date, timeZone).getTime();
    return db - da;
  });
  return list;
}

function sortDailyChecklistDataNewestFirst_(sheet, timeZone) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 5) {
    if (lastRow >= 4) {
      sheet.getRange(4, 1, 1, 1).setNumberFormat(DAILY_CHECKLIST_DATE_FORMAT);
      forceDailyChecklistSelectPlaceholders_(sheet, 4, 1);
      sheet.setRowHeight(4, DAILY_CHECKLIST_DATA_ROW_HEIGHT);
      sheet.getRange(4, 12).setWrap(true).setVerticalAlignment('top');
    }
    return;
  }
  var n = lastRow - 3;
  var range = sheet.getRange(4, 1, n, DAILY_CHECKLIST_HEADERS.length);
  var values = range.getValues();
  values.sort(function(a, b) {
    var da = a[0] instanceof Date ? a[0].getTime() : new Date(a[0]).getTime();
    var db = b[0] instanceof Date ? b[0].getTime() : new Date(b[0]).getTime();
    if (isNaN(da)) {
      da = 0;
    }
    if (isNaN(db)) {
      db = 0;
    }
    return db - da;
  });
  for (var v = 0; v < values.length; v++) {
    var obj = normalizeDailyChecklistRowObject_(values[v]);
    values[v][1] = obj.statuses[0];
    values[v][2] = obj.statuses[1];
    values[v][3] = obj.statuses[2];
    values[v][4] = obj.statuses[3];
    values[v][5] = obj.statuses[4];
    values[v][6] = obj.statuses[5];
    values[v][7] = obj.statuses[6];
    values[v][8] = obj.meeting;
    values[v][9] = obj.status;
    values[v][10] = obj.noteType;
  }
  range.setValues(values);
  applyDailyChecklistRowControls_(sheet, 4, n);
  sheet.getRange(4, 1, n, 1).setNumberFormat(DAILY_CHECKLIST_DATE_FORMAT);
  sheet.getRange(4, 12, n, 1).setWrap(true).setVerticalAlignment('top');
  sheet.setRowHeights(4, n, DAILY_CHECKLIST_DATA_ROW_HEIGHT);
  sheet.getRange(4, 2, n, 10).setBackground(COLORS.CHECKLIST_SELECT);
  sheet.getRange(4, 1, n, 1).setBackground(COLORS.USER_INPUT);
  sheet.getRange(4, 12, n, 1).setBackground(COLORS.WHITE);
}

function writeDailyChecklistDataRow_(sheet, rowNumber, row, timeZone) {
  var tz = timeZone || Session.getScriptTimeZone() || 'America/New_York';
  var statuses = row.statuses || [
    DAILY_CHECKLIST_SELECT, DAILY_CHECKLIST_SELECT, DAILY_CHECKLIST_SELECT,
    DAILY_CHECKLIST_SELECT, DAILY_CHECKLIST_SELECT, DAILY_CHECKLIST_SELECT,
    DAILY_CHECKLIST_SELECT
  ];
  if (row.checks && (!row.statuses || !row.statuses.length)) {
    statuses = [];
    for (var t = 0; t < 7; t++) {
      statuses.push(migrateDailyChecklistTaskStatus_(t, row.checks[t]));
    }
  }
  for (var i = 0; i < 7; i++) {
    statuses[i] = migrateDailyChecklistTaskStatus_(i, statuses[i]);
  }
  var end = normalizeDailyChecklistEndDropdowns_(
      row.meeting, row.status, row.noteType, row.notes, statuses);
  sheet.getRange(rowNumber, 1, 1, DAILY_CHECKLIST_HEADERS.length).setValues([[
    coerceSpokeChecklistDate_(row.date, tz),
    statuses[0], statuses[1], statuses[2], statuses[3],
    statuses[4], statuses[5], statuses[6],
    end.meeting,
    end.status,
    end.noteType,
    row.notes || ''
  ]]);
  sheet.getRange(rowNumber, 1).setNumberFormat(DAILY_CHECKLIST_DATE_FORMAT);
  sheet.getRange(rowNumber, 1).setBackground(COLORS.USER_INPUT);
  sheet.getRange(rowNumber, 2, 1, 10).setBackground(COLORS.CHECKLIST_SELECT);
  sheet.getRange(rowNumber, 12).setBackground(COLORS.WHITE)
      .setWrap(true).setVerticalAlignment('top');
  sheet.setRowHeight(rowNumber, DAILY_CHECKLIST_DATA_ROW_HEIGHT);
}

function applyDailyChecklistRowControls_(sheet, startRow, rowCount) {
  if (rowCount < 1) {
    return;
  }
  sheet.getRange(startRow, 1, rowCount, 1).setNumberFormat(DAILY_CHECKLIST_DATE_FORMAT);
  sheet.getRange(startRow, 12, rowCount, 1).setWrap(true).setVerticalAlignment('top');
  sheet.setRowHeights(startRow, rowCount, DAILY_CHECKLIST_DATA_ROW_HEIGHT);
  try {
    sheet.getRange(startRow, 2, rowCount, 7).removeCheckboxes();
  } catch (eRemove) {
    // No checkboxes present.
  }
  for (var t = 0; t < DAILY_CHECKLIST_TASK_OPTIONS.length; t++) {
    sheet.getRange(startRow, 2 + t, rowCount, 1).setDataValidation(
        SpreadsheetApp.newDataValidation()
            .requireValueInList(DAILY_CHECKLIST_TASK_OPTIONS[t], true)
            .setAllowInvalid(false)
            .setHelpText('Change — Select — to a green, yellow, or red status.')
            .build());
  }
  sheet.getRange(startRow, 9, rowCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
          .requireValueInList([DAILY_CHECKLIST_SELECT, 'Not needed', 'Scheduled'], true)
          .setAllowInvalid(false)
          .setHelpText('Change — Select — to Not needed or Scheduled.')
          .build());
  sheet.getRange(startRow, 10, rowCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
          .requireValueInList([DAILY_CHECKLIST_SELECT, 'Good', 'Needs Attention', 'Urgent'], true)
          .setAllowInvalid(false)
          .setHelpText('Change — Select — to Good, Needs Attention, or Urgent.')
          .build());
  sheet.getRange(startRow, 11, rowCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
          .requireValueInList([DAILY_CHECKLIST_SELECT, 'Note', 'Follow-up', 'Experiment'], true)
          .setAllowInvalid(false)
          .setHelpText('Change — Select — to Note, Follow-up, or Experiment.')
          .build());
}

function applyDailyChecklistConditionalFormats_(sheet) {
  var taskRange = sheet.getRange('B4:H1000');
  var meetingRange = sheet.getRange('I4:I1000');
  var statusRange = sheet.getRange('J4:J1000');
  var noteTypeRange = sheet.getRange('K4:K1000');
  var notesRange = sheet.getRange('L4:L1000');
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(DAILY_CHECKLIST_SELECT)
      .setBackground(COLORS.CHECKLIST_SELECT)
      .setRanges([taskRange, meetingRange, statusRange, noteTypeRange])
      .build());
  var greenKeys = Object.keys(DAILY_CHECKLIST_STATUS_GREEN);
  for (var g = 0; g < greenKeys.length; g++) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(greenKeys[g])
        .setBackground(COLORS.STATUS_GOOD)
        .setRanges([taskRange, statusRange])
        .build());
  }
  var yellowKeys = Object.keys(DAILY_CHECKLIST_STATUS_YELLOW);
  for (var y = 0; y < yellowKeys.length; y++) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(yellowKeys[y])
        .setBackground(COLORS.STATUS_ATTENTION)
        .setRanges([taskRange, statusRange])
        .build());
  }
  var redKeys = Object.keys(DAILY_CHECKLIST_STATUS_RED);
  for (var r = 0; r < redKeys.length; r++) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(redKeys[r])
        .setBackground(COLORS.STATUS_URGENT)
        .setRanges([taskRange, statusRange])
        .build());
  }
  rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$K4="Note"')
      .setBackground(COLORS.WHITE)
      .setRanges([noteTypeRange, notesRange])
      .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$K4="Follow-up"')
      .setBackground(COLORS.FOLLOW_UP)
      .setRanges([noteTypeRange, notesRange])
      .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$K4="Experiment"')
      .setBackground(COLORS.EXPERIMENT)
      .setRanges([noteTypeRange, notesRange])
      .build());
  sheet.setConditionalFormatRules(rules);
}

function dailyChecklistHasDateKey_(sheet, ymdKey, timeZone) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 4) {
    return false;
  }
  var values = sheet.getRange(4, 1, lastRow - 3, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var cell = values[i][0];
    if (!cell) {
      continue;
    }
    if (cell instanceof Date) {
      if (Utilities.formatDate(cell, timeZone, 'yyyy-MM-dd') === ymdKey) {
        return true;
      }
    } else {
      var parsed = new Date(cell);
      if (!isNaN(parsed.getTime()) &&
          Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd') === ymdKey) {
        return true;
      }
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* EDIT WARNINGS + MANUAL-EDIT DETECTION                                      */
/* -------------------------------------------------------------------------- */

var SPOKE_PROTECTION_PREFIX = 'Built by Shah — locked';
var MANUAL_EDIT_MARKER = 'MANUAL EDIT';

/**
 * Re-apply warning-only protections and the manual-edit onEdit trigger without
 * rebuilding tabs. Safe on live spokes (values kept).
 */
function refreshSpokeProtections() {
  var spreadsheet = getOrCreateTargetSpreadsheet_();
  refreshSpokeAlertFormulas_(spreadsheet);
  protectSpokeLockedRanges_(spreadsheet);
  ensureSpokeManualEditTrigger_(spreadsheet);
  Logger.log('Spoke edit warnings + manual-edit watch ready: ' + spreadsheet.getUrl());
  try {
    SpreadsheetApp.getUi().alert(
        'Edit warnings refreshed',
        'Script, formula, ID, and Hub-synced Config cells now warn before editing.\n\n' +
        'Yellow Config campaign / ad group tables stay freely editable.\n' +
        'Weekly Action Status and Notes stay editable.\n\n' +
        'If someone overrides a locked metrics cell, Notes gets a MANUAL EDIT stamp ' +
        'and Active Alerts / Alert shows Manual edit detected.\n\n' +
        'Alert formulas were also refreshed (metric history kept).',
        SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // Standalone projects without a UI still succeed.
  }
  return spreadsheet.getUrl();
}

/**
 * Re-write blue formula columns (including Active Alerts / Alert) without
 * clearing green script values. Safe for live spokes.
 */
function refreshSpokeAlertFormulas_(spreadsheet) {
  var blueprints = spokeMetricFormulaBlueprints_();
  for (var i = 0; i < blueprints.length; i++) {
    var bp = blueprints[i];
    var sheet = spreadsheet.getSheetByName(bp.sheetName);
    if (!sheet) {
      continue;
    }
    var configured = Math.max(1, Number(bp.rowCount || 100));
    var dataRows = Math.max(0, sheet.getLastRow() - 4);
    var rowCount = Math.max(configured, dataRows);
    applyMetricFormulaColumns_(sheet, bp.formulaCols, rowCount);
  }
}

/**
 * Shared formula templates for metrics tabs (used by skeleton writes + live refresh).
 */
function spokeMetricFormulaBlueprints_() {
  return [
    {
      sheetName: SHEETS.ACCOUNT,
      rowCount: SETUP_CONFIG.FORMULA_ROWS.ACCOUNT,
      formulaCols: {
        B: '=IF(A{r}="","",IF(Config!$B$8<>"Enabled","Excluded",IF(OR(C{r}="Off Pace",G{r}="Off Pace",M{r}="High CPL",M{r}="Spend / No Conversions"),"Needs Attention","On Pace")))',
        C: '=IF(A{r}="","",IF(D{r}=0,"No Data",IF(ABS(F{r}-1)<=Config!$B$16,"On Pace","Off Pace")))',
        D: '=IF(A{r}="","",Config!$B$11*DAY(A{r}))',
        F: '=IFERROR(E{r}/D{r},"")',
        G: '=IF(A{r}="","",IF(H{r}=0,"No Data",IF(J{r}>=1-Config!$B$17,"On Pace","Off Pace")))',
        H: '=IF(A{r}="","",Config!$B$12*DAY(A{r})/DAY(EOMONTH(A{r},0)))',
        J: '=IFERROR(I{r}/H{r},"")',
        K: '=IF(OR(A{r}="",I{r}=0),"",E{r}/I{r})',
        L: '=IF(A{r}="","",Config!$B$13)',
        M: '=IF(A{r}="","",IF(AND(I{r}=0,E{r}>=Config!$B$15),"Spend / No Conversions",IF(I{r}=0,"No Data",IF(K{r}>L{r}*Config!$B$14,"High CPL","On Target"))))',
        N: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(C{r}="Off Pace","Budget Off Pace",""),IF(G{r}="Off Pace","Leads Off Pace",""),IF(M{r}="High CPL","High CPL",""),IF(M{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",O{r})),"Manual edit detected","")))'
      }
    },
    {
      sheetName: SHEETS.SEARCH_CAMPAIGN,
      rowCount: SETUP_CONFIG.FORMULA_ROWS.SEARCH_CAMPAIGN,
      formulaCols: {
        F: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',4,FALSE),"UNCONFIGURED"))',
        G: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',5,FALSE),"Disabled"))',
        L: '=IFERROR(K{r}/J{r},"")',
        M: '=IFERROR(I{r}/K{r},"")',
        O: '=IFERROR(N{r}/K{r},"")',
        P: '=IFERROR(I{r}/N{r},"")',
        Q: '=IF(A{r}="","",Config!$B$13)',
        R: '=IF(A{r}="","",IF(F{r}="Disabled","Excluded",IF(AND(N{r}=0,I{r}>=Config!$B$15),"Spend / No Conversions",IF(N{r}=0,"No Data",IF(P{r}>Q{r}*Config!$B$14,"High CPL","On Target")))))',
        S: '=IF(A{r}="","",IF(F{r}="UNCONFIGURED","UNCONFIGURED",IF(F{r}="Disabled",IF(I{r}>0,"Unexpected Spend","Excluded"),IF(G{r}="Disabled","Not Expected",IF(E{r}<>"ENABLED","Unexpected Status",IF(I{r}=0,"Zero Spend","Spending"))))))',
        T: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(F{r}="UNCONFIGURED","Unconfigured Campaign",""),IF(S{r}="Unexpected Spend","Unexpected Spend",""),IF(S{r}="Unexpected Status","Unexpected Campaign Status",""),IF(S{r}="Zero Spend","Zero Spend",""),IF(R{r}="High CPL","High CPL",""),IF(R{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",U{r})),"Manual edit detected","")))'
      }
    },
    {
      sheetName: SHEETS.SEARCH_KEYWORD,
      rowCount: SETUP_CONFIG.FORMULA_ROWS.SEARCH_KEYWORD,
      formulaCols: {
        J: '=IF(F{r}="","",IFERROR(IF(VLOOKUP(F{r},' + CONFIG_RANGES.KEYWORDS + ',5,FALSE)="INHERIT",IFERROR(VLOOKUP(D{r},' + CONFIG_RANGES.AD_GROUPS + ',5,FALSE),"UNCONFIGURED"),IF(VLOOKUP(F{r},' + CONFIG_RANGES.KEYWORDS + ',5,FALSE)="Enabled","Enabled","Disabled")),IFERROR(VLOOKUP(D{r},' + CONFIG_RANGES.AD_GROUPS + ',5,FALSE),"UNCONFIGURED")))',
        N: '=IFERROR(M{r}/L{r},"")',
        O: '=IFERROR(K{r}/M{r},"")',
        Q: '=IFERROR(P{r}/M{r},"")',
        R: '=IFERROR(K{r}/P{r},"")',
        S: '=IF(A{r}="","",Config!$B$13)',
        T: '=IF(A{r}="","",IF(J{r}="Disabled","Excluded",IF(AND(P{r}=0,K{r}>=Config!$B$15),"Spend / No Conversions",IF(P{r}=0,"No Data",IF(R{r}>S{r}*Config!$B$14,"High CPL","On Target")))))',
        U: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(J{r}="UNCONFIGURED","Unconfigured Ad Group",""),IF(AND(J{r}="Disabled",K{r}>0),"Unexpected Spend",""),IF(T{r}="High CPL","High CPL",""),IF(T{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",V{r})),"Manual edit detected","")))'
      }
    },
    {
      sheetName: SHEETS.PMAX_CAMPAIGN,
      rowCount: SETUP_CONFIG.FORMULA_ROWS.PMAX_CAMPAIGN,
      formulaCols: {
        E: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',4,FALSE),"UNCONFIGURED"))',
        F: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',5,FALSE),"Disabled"))',
        K: '=IFERROR(J{r}/I{r},"")',
        L: '=IFERROR(H{r}/J{r},"")',
        N: '=IFERROR(M{r}/J{r},"")',
        O: '=IFERROR(H{r}/M{r},"")',
        P: '=IF(A{r}="","",Config!$B$13)',
        Q: '=IF(A{r}="","",IF(E{r}="Disabled","Excluded",IF(AND(M{r}=0,H{r}>=Config!$B$15),"Spend / No Conversions",IF(M{r}=0,"No Data",IF(O{r}>P{r}*Config!$B$14,"High CPL","On Target")))))',
        R: '=IF(A{r}="","",IF(E{r}="UNCONFIGURED","UNCONFIGURED",IF(E{r}="Disabled",IF(H{r}>0,"Unexpected Spend","Excluded"),IF(F{r}="Disabled","Not Expected",IF(D{r}<>"ENABLED","Unexpected Status",IF(H{r}=0,"Zero Spend","Spending"))))))',
        S: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(E{r}="UNCONFIGURED","Unconfigured Campaign",""),IF(R{r}="Unexpected Spend","Unexpected Spend",""),IF(R{r}="Unexpected Status","Unexpected Campaign Status",""),IF(R{r}="Zero Spend","Zero Spend",""),IF(Q{r}="High CPL","High CPL",""),IF(Q{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",T{r})),"Manual edit detected","")))'
      }
    },
    {
      sheetName: SHEETS.LOCATION,
      rowCount: SETUP_CONFIG.FORMULA_ROWS.LOCATION,
      formulaCols: {
        F: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',4,FALSE),"UNCONFIGURED"))',
        J: '=IFERROR(I{r}/H{r},"")',
        L: '=IFERROR(K{r}/I{r},"")',
        M: '=IFERROR(G{r}/K{r},"")',
        N: '=IF(A{r}="","",Config!$B$13)',
        O: '=IF(A{r}="","",IF(F{r}="Disabled","Excluded",IF(AND(K{r}=0,G{r}>=Config!$B$15),"Spend / No Conversions",IF(K{r}=0,"No Data",IF(M{r}>N{r}*Config!$B$14,"High CPL","On Target")))))',
        P: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(F{r}="UNCONFIGURED","Unconfigured Campaign",""),IF(AND(F{r}="Disabled",G{r}>0),"Unexpected Spend",""),IF(O{r}="High CPL","High CPL",""),IF(O{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",R{r})),"Manual edit detected","")))'
      }
    },
    {
      sheetName: SHEETS.DEVICE,
      rowCount: SETUP_CONFIG.FORMULA_ROWS.DEVICE,
      formulaCols: {
        E: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',4,FALSE),"UNCONFIGURED"))',
        I: '=IFERROR(H{r}/G{r},"")',
        K: '=IFERROR(J{r}/H{r},"")',
        L: '=IFERROR(F{r}/J{r},"")',
        M: '=IF(A{r}="","",Config!$B$13)',
        N: '=IF(A{r}="","",IF(E{r}="Disabled","Excluded",IF(AND(J{r}=0,F{r}>=Config!$B$15),"Spend / No Conversions",IF(J{r}=0,"No Data",IF(L{r}>M{r}*Config!$B$14,"High CPL","On Target")))))',
        O: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(E{r}="UNCONFIGURED","Unconfigured Campaign",""),IF(AND(E{r}="Disabled",F{r}>0),"Unexpected Spend",""),IF(N{r}="High CPL","High CPL",""),IF(N{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",Q{r})),"Manual edit detected","")))'
      }
    }
  ];
}

function applyMetricFormulaColumns_(sheet, formulaCols, rowCount) {
  Object.keys(formulaCols || {}).forEach(function(colLetter) {
    var col = columnToIndex_(colLetter);
    var template = formulaCols[colLetter];
    var formulas = [];
    for (var r = 5; r < 5 + rowCount; r++) {
      formulas.push([template.replace(/\{r\}/g, String(r))]);
    }
    sheet.getRange(5, col, rowCount, 1).setFormulas(formulas);
    sheet.getRange(5, col, rowCount, 1).setBackground(COLORS.FORMULA);
  });
}

/**
 * Warning-only range protection so accidental edits require an explicit OK.
 * Does not hard-block the Engine (scripts can still write).
 */
function protectSpokeLockedRanges_(spreadsheet) {
  removeSpokeBuiltByShahProtections_(spreadsheet);

  var metricNames = [
    SHEETS.ACCOUNT, SHEETS.SEARCH_CAMPAIGN, SHEETS.SEARCH_KEYWORD,
    SHEETS.PMAX_CAMPAIGN, SHEETS.LOCATION, SHEETS.DEVICE
  ];
  for (var i = 0; i < metricNames.length; i++) {
    var sheet = spreadsheet.getSheetByName(metricNames[i]);
    if (sheet) {
      protectMetricSheetLockedColumns_(sheet);
    }
  }

  var config = spreadsheet.getSheetByName(SHEETS.CONFIG);
  if (config) {
    protectConfigHubSyncedValues_(config);
  }
}

function removeSpokeBuiltByShahProtections_(spreadsheet) {
  var protections = spreadsheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var i = 0; i < protections.length; i++) {
    var desc = String(protections[i].getDescription() || '');
    if (desc.indexOf(SPOKE_PROTECTION_PREFIX) === 0) {
      try {
        protections[i].remove();
      } catch (e) {
        // Another owner / cannot remove.
      }
    }
  }
}

function protectMetricSheetLockedColumns_(sheet) {
  var headerRow = 4;
  var lastCol = Math.max(1, sheet.getLastColumn());
  var lastRow = Math.max(headerRow + 1, sheet.getMaxRows());
  var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  var rowCount = lastRow - headerRow;
  for (var c = 0; c < headers.length; c++) {
    var header = String(headers[c] || '').trim();
    // Action Status = human weekly decision. Notes = free text + MANUAL EDIT stamps.
    if (!header || header === 'Action Status' || header === 'Notes') {
      continue;
    }
    var range = sheet.getRange(headerRow + 1, c + 1, rowCount, 1);
    protectRangeWarningOnly_(
        range,
        SPOKE_PROTECTION_PREFIX + ' metrics · ' + sheet.getName() + ' · ' + header
    );
  }
}

function protectConfigHubSyncedValues_(sheet) {
  // Settings Value column (includes Hub-synced goals) + key column.
  protectRangeWarningOnly_(
      sheet.getRange('A5:B18'),
      SPOKE_PROTECTION_PREFIX + ' Config settings (Hub-synced goals)'
  );
  // Alert routing Hub-synced block (keys + values).
  protectRangeWarningOnly_(
      sheet.getRange('A89:B93'),
      SPOKE_PROTECTION_PREFIX + ' Config alert routing (Hub-synced)'
  );
}

function protectRangeWarningOnly_(range, description) {
  try {
    var protection = range.protect().setDescription(description);
    protection.setWarningOnly(true);
  } catch (e) {
    // Protection requires sufficient access; skip rather than fail the build.
    Logger.log('Could not protect range (' + description + '): ' + e);
  }
}

/**
 * Installable onEdit for this spreadsheet (works from standalone projects too).
 */
function ensureSpokeManualEditTrigger_(spreadsheet) {
  var handler = 'onSpokeManualEdit';
  var ssId = spreadsheet.getId();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handler &&
        String(triggers[i].getTriggerSourceId()) === String(ssId)) {
      return;
    }
  }
  try {
    ScriptApp.newTrigger(handler)
        .forSpreadsheet(ssId)
        .onEdit()
        .create();
  } catch (e) {
    Logger.log('Could not create manual-edit trigger (authorize & re-run refreshSpokeProtections): ' + e);
  }
}

/**
 * Installable edit trigger. User UI edits only (Engine/Apps Script writes do not fire this).
 */
function onSpokeManualEdit(e) {
  try {
    if (!e || !e.range) {
      return;
    }
    var sheet = e.range.getSheet();
    var name = sheet.getName();
    if (name === SHEETS.INSTRUCTIONS || name === SHEETS.DEFINITIONS ||
        name === SHEETS.DAILY_CHECKLIST) {
      return;
    }
    if (name === SHEETS.CONFIG) {
      handleConfigManualEdit_(sheet, e);
      return;
    }
    var row = e.range.getRow();
    var col = e.range.getColumn();
    if (row < 5) {
      return;
    }
    var lastCol = Math.max(1, sheet.getLastColumn());
    var headers = sheet.getRange(4, 1, 1, lastCol).getValues()[0];
    var header = String(headers[col - 1] || '').trim();
    if (!header || header === 'Action Status' || header === 'Notes') {
      return;
    }
    stampManualEditOnMetricRow_(sheet, row, headers);
  } catch (err) {
    Logger.log('onSpokeManualEdit error: ' + err);
  }
}

function handleConfigManualEdit_(sheet, e) {
  var row = e.range.getRow();
  var col = e.range.getColumn();
  // Hub-synced settings values (col B) and routing block.
  var locked = (col === 2 && row >= 5 && row <= 18) ||
      (col === 2 && row >= 89 && row <= 93) ||
      (col === 1 && row >= 5 && row <= 18) ||
      (col === 1 && row >= 89 && row <= 93);
  if (!locked) {
    return;
  }
  try {
    e.range.setNote(
        MANUAL_EDIT_MARKER +
        ' — Hub-synced / locked Config cell. Prefer editing the Hub Sheet. ' +
        'Engine may overwrite this on the next successful run.'
    );
  } catch (err) {
    // Notes quota / permission.
  }
}

function stampManualEditOnMetricRow_(sheet, row, headers) {
  var notesCol = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === 'Notes') {
      notesCol = i + 1;
      break;
    }
  }
  if (notesCol < 1) {
    return;
  }
  var cell = sheet.getRange(row, notesCol);
  var current = String(cell.getValue() || '');
  if (current.indexOf(MANUAL_EDIT_MARKER) >= 0) {
    return;
  }
  var stamp = MANUAL_EDIT_MARKER + ' ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/New_York', 'yyyy-MM-dd');
  cell.setValue(current ? (current + ' | ' + stamp) : stamp);
}

/* -------------------------------------------------------------------------- */
/* METRICS SHEETS                                                             */
/* -------------------------------------------------------------------------- */

function writeAccountMetricsSheet_(sheet) {
  var headers = [
    'Date', 'Account Status', 'Budget Status', 'Expected Spend', 'Actual Spend',
    'Budget Pace %', 'Lead Status', 'Expected Leads', 'Google Ads Conversions',
    'Lead Pace %', 'Actual CPL', 'Target CPL', 'CPL Status', 'Active Alerts', 'Notes'
  ];
  var formulaCols = {
    B: '=IF(A{r}="","",IF(Config!$B$8<>"Enabled","Excluded",IF(OR(C{r}="Off Pace",G{r}="Off Pace",M{r}="High CPL",M{r}="Spend / No Conversions"),"Needs Attention","On Pace")))',
    C: '=IF(A{r}="","",IF(D{r}=0,"No Data",IF(ABS(F{r}-1)<=Config!$B$16,"On Pace","Off Pace")))',
    D: '=IF(A{r}="","",Config!$B$11*DAY(A{r}))',
    F: '=IFERROR(E{r}/D{r},"")',
    G: '=IF(A{r}="","",IF(H{r}=0,"No Data",IF(J{r}>=1-Config!$B$17,"On Pace","Off Pace")))',
    H: '=IF(A{r}="","",Config!$B$12*DAY(A{r})/DAY(EOMONTH(A{r},0)))',
    J: '=IFERROR(I{r}/H{r},"")',
    K: '=IF(OR(A{r}="",I{r}=0),"",E{r}/I{r})',
    L: '=IF(A{r}="","",Config!$B$13)',
    M: '=IF(A{r}="","",IF(AND(I{r}=0,E{r}>=Config!$B$15),"Spend / No Conversions",IF(I{r}=0,"No Data",IF(K{r}>L{r}*Config!$B$14,"High CPL","On Target"))))',
    N: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(C{r}="Off Pace","Budget Off Pace",""),IF(G{r}="Off Pace","Leads Off Pace",""),IF(M{r}="High CPL","High CPL",""),IF(M{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",O{r})),"Manual edit detected","")))'
  };
  var scriptCols = ['A', 'E', 'I', 'O'];
  var idCols = [];
  writeMetricsSheetSkeleton_(sheet, {
    titleSuffix: 'Account Metrics (Daily)',
    headers: headers,
    formulaCols: formulaCols,
    scriptCols: scriptCols,
    idCols: idCols,
    rowCount: SETUP_CONFIG.FORMULA_ROWS.ACCOUNT,
    freezeColumns: 2,
    statusHighlightCols: ['B', 'C', 'G', 'M'],
    alertHighlightCols: ['N'],
    pacePercentCols: ['F', 'J'],
    widths: [14, 18, 17, 18, 17, 16, 13, 17, 22, 15, 13, 13, 22, 42, 53],
    numberFormats: {
      A: 'm/d/yyyy',
      D: '$#,##0.00',
      E: '$#,##0.00',
      F: '0%',
      H: '#,##0',
      J: '0%',
      K: '$#,##0.00',
      L: '$#,##0.00'
    }
  });
}

function writeSearchCampaignMetricsSheet_(sheet) {
  var headers = [
    'Date', 'Campaign ID', 'Campaign Name', 'Campaign Type', 'Google Status',
    'Monitor', 'Expected to Spend', 'Daily Budget', 'Spend', 'Impressions',
    'Clicks', 'CTR', 'Avg. CPC', 'Conversions', 'Conv. Rate', 'CPL',
    'Target CPL', 'CPL Status', 'Spend Status', 'Alert', 'Notes'
  ];
  var formulaCols = {
    F: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',4,FALSE),"UNCONFIGURED"))',
    G: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',5,FALSE),"Disabled"))',
    L: '=IFERROR(K{r}/J{r},"")',
    M: '=IFERROR(I{r}/K{r},"")',
    O: '=IFERROR(N{r}/K{r},"")',
    P: '=IFERROR(I{r}/N{r},"")',
    Q: '=IF(A{r}="","",Config!$B$13)',
    R: '=IF(A{r}="","",IF(F{r}="Disabled","Excluded",IF(AND(N{r}=0,I{r}>=Config!$B$15),"Spend / No Conversions",IF(N{r}=0,"No Data",IF(P{r}>Q{r}*Config!$B$14,"High CPL","On Target")))))',
    S: '=IF(A{r}="","",IF(F{r}="UNCONFIGURED","UNCONFIGURED",IF(F{r}="Disabled",IF(I{r}>0,"Unexpected Spend","Excluded"),IF(G{r}="Disabled","Not Expected",IF(E{r}<>"ENABLED","Unexpected Status",IF(I{r}=0,"Zero Spend","Spending"))))))',
    T: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(F{r}="UNCONFIGURED","Unconfigured Campaign",""),IF(S{r}="Unexpected Spend","Unexpected Spend",""),IF(S{r}="Unexpected Status","Unexpected Campaign Status",""),IF(S{r}="Zero Spend","Zero Spend",""),IF(R{r}="High CPL","High CPL",""),IF(R{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",U{r})),"Manual edit detected","")))'
  };
  writeMetricsSheetSkeleton_(sheet, {
    titleSuffix: 'Search Campaign Metrics (Daily)',
    headers: headers,
    formulaCols: formulaCols,
    scriptCols: ['A', 'C', 'D', 'E', 'H', 'I', 'J', 'K', 'N', 'U'],
    idCols: ['B'],
    rowCount: SETUP_CONFIG.FORMULA_ROWS.SEARCH_CAMPAIGN,
    freezeColumns: 3,
    statusHighlightCols: ['R', 'S'],
    alertHighlightCols: ['T'],
    widths: [14, 19, 30, 16, 17, 16, 19, 16, 15, 16, 12, 13, 14, 13, 13, 13, 13, 22, 20, 45, 36],
    numberFormats: {
      A: 'm/d/yyyy',
      H: '$#,##0.00',
      I: '$#,##0.00',
      L: '0%',
      M: '$#,##0.00',
      O: '0%',
      P: '$#,##0.00',
      Q: '$#,##0.00'
    }
  });
}

function writeNegativesAuditSheet_(sheet) {
  var headers = [
    'Date Added',
    'Channel',
    'Campaign ID',
    'Campaign',
    'Search Term',
    'Exact Negative',
    'Matched Rules',
    'Impressions',
    'Clicks',
    'Cost Yesterday',
    'Cost Lookback',
    'Conversions',
    'Spend Summary',
    'Decision',
    'Reason',
    'Reviewed',
    'Remove',
    'Status',
    'Removed At',
    'AM Notes'
  ];
  var guide = [
    'Sweeper writes newest rows under this header.',
    'SEARCH or PMAX',
    'Ads campaign ID',
    'Campaign name',
    'Query that matched a rule',
    'Exact negative added in Ads, e.g. [cheap auto body]',
    'Rule IDs that fired',
    'Yesterday impressions',
    'Yesterday clicks',
    'Spend yesterday',
    'Spend over ~30-day lookback',
    'Should be 0 for auto-adds',
    'Quick waste blurb',
    'ADDED / MANUAL_REVIEW / FAILED / REMOVED…',
    'Why the decision happened',
    'Check when you reviewed',
    'Check to delete on next sweeper run',
    'ADDED or REMOVED',
    'When Remove completed',
    'Optional notes'
  ];
  var bodyRows = 200;
  var colCount = headers.length;

  sheet.clear();
  try {
    sheet.getRange(1, 1, sheet.getMaxRows(), Math.max(sheet.getMaxColumns(), colCount))
        .clearDataValidations();
  } catch (eClear) {
    // Ignore.
  }

  sheet.getRange(1, 1, 1, colCount).merge()
      .setValue(
          (SETUP_CONFIG.BODY_SHOP_NAME || 'Body Shop') +
          ' — Negatives Audit (exact campaign negatives from the sweeper)')
      .setFontWeight('bold')
      .setFontColor('#FFFFFF')
      .setBackground(COLORS.TITLE)
      .setFontSize(14);
  sheet.setRowHeight(1, 28);

  sheet.getRange(2, 1, 1, colCount).setValues([headers])
      .setFontWeight('bold')
      .setFontColor('#FFFFFF')
      .setBackground(COLORS.HEADER)
      .setWrap(true);
  sheet.setRowHeight(2, 40);
  sheet.setFrozenRows(2);

  sheet.getRange(3, 1, 1, colCount).setValues([guide])
      .setBackground(COLORS.GUIDE || '#FFF8E7')
      .setFontColor(COLORS.TEXT)
      .setFontStyle('italic')
      .setWrap(true);
  sheet.setRowHeight(3, 48);

  var dataStart = 4;
  sheet.getRange(dataStart, 1, bodyRows, colCount)
      .setBackground(COLORS.SCRIPT || '#E6EEE9')
      .setFontColor(COLORS.TEXT);

  // Human-owned cream columns: Reviewed (16), Remove (17), AM Notes (20)
  sheet.getRange(dataStart, 16, bodyRows, 1).setBackground(COLORS.USER_INPUT);
  sheet.getRange(dataStart, 17, bodyRows, 1).setBackground(COLORS.USER_INPUT);
  sheet.getRange(dataStart, 20, bodyRows, 1).setBackground(COLORS.USER_INPUT);

  var checkbox = SpreadsheetApp.newDataValidation()
      .requireCheckbox()
      .setAllowInvalid(false)
      .build();
  sheet.getRange(dataStart, 16, bodyRows, 1).setDataValidation(checkbox).setValue(false);
  sheet.getRange(dataStart, 17, bodyRows, 1).setDataValidation(checkbox).setValue(false);

  sheet.getRange(dataStart, 10, bodyRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(dataStart, 11, bodyRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(dataStart, 8, bodyRows, 1).setNumberFormat('0');
  sheet.getRange(dataStart, 9, bodyRows, 1).setNumberFormat('0');
  sheet.getRange(dataStart, 12, bodyRows, 1).setNumberFormat('0.00');

  var widths = [150, 80, 120, 200, 260, 260, 160, 100, 80, 110, 110, 100, 260, 120, 320, 90, 90, 100, 140, 220];
  for (var w = 0; w < widths.length; w++) {
    sheet.setColumnWidth(w + 1, widths[w]);
  }
  sheet.getRange(dataStart, 5, bodyRows, 1).setWrap(true);
  sheet.getRange(dataStart, 6, bodyRows, 1).setWrap(true);
  sheet.getRange(dataStart, 13, bodyRows, 1).setWrap(true);
  sheet.getRange(dataStart, 15, bodyRows, 1).setWrap(true);
  sheet.getRange(dataStart, 20, bodyRows, 1).setWrap(true);
}

function writeSearchKeywordMetricsSheet_(sheet) {
  var headers = [
    'Date', 'Campaign ID', 'Campaign Name', 'Ad Group ID', 'Ad Group Name',
    'Keyword ID', 'Keyword Text', 'Match Type', 'Google Status', 'Monitor',
    'Spend', 'Impressions', 'Clicks', 'CTR', 'Avg. CPC', 'Conversions',
    'Conv. Rate', 'CPL', 'Target CPL', 'CPL Status', 'Alert', 'Notes'
  ];
  var formulaCols = {
    J: '=IF(F{r}="","",IFERROR(IF(VLOOKUP(F{r},' + CONFIG_RANGES.KEYWORDS + ',5,FALSE)="INHERIT",IFERROR(VLOOKUP(D{r},' + CONFIG_RANGES.AD_GROUPS + ',5,FALSE),"UNCONFIGURED"),IF(VLOOKUP(F{r},' + CONFIG_RANGES.KEYWORDS + ',5,FALSE)="Enabled","Enabled","Disabled")),IFERROR(VLOOKUP(D{r},' + CONFIG_RANGES.AD_GROUPS + ',5,FALSE),"UNCONFIGURED")))',
    N: '=IFERROR(M{r}/L{r},"")',
    O: '=IFERROR(K{r}/M{r},"")',
    Q: '=IFERROR(P{r}/M{r},"")',
    R: '=IFERROR(K{r}/P{r},"")',
    S: '=IF(A{r}="","",Config!$B$13)',
    T: '=IF(A{r}="","",IF(J{r}="Disabled","Excluded",IF(AND(P{r}=0,K{r}>=Config!$B$15),"Spend / No Conversions",IF(P{r}=0,"No Data",IF(R{r}>S{r}*Config!$B$14,"High CPL","On Target")))))',
    U: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(J{r}="UNCONFIGURED","Unconfigured Ad Group",""),IF(AND(J{r}="Disabled",K{r}>0),"Unexpected Spend",""),IF(T{r}="High CPL","High CPL",""),IF(T{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",V{r})),"Manual edit detected","")))'
  };
  writeMetricsSheetSkeleton_(sheet, {
    titleSuffix: 'Search Keyword Metrics (Daily)',
    headers: headers,
    formulaCols: formulaCols,
    scriptCols: ['A', 'C', 'E', 'G', 'H', 'I', 'K', 'L', 'M', 'P', 'V'],
    idCols: ['B', 'D', 'F'],
    rowCount: SETUP_CONFIG.FORMULA_ROWS.SEARCH_KEYWORD,
    freezeColumns: 3,
    statusHighlightCols: ['T'],
    alertHighlightCols: ['U'],
    widths: [14, 19, 26, 19, 26, 18, 34, 15, 16, 13, 15, 13, 12, 13, 14, 13, 13, 13, 13, 22, 45, 36],
    numberFormats: {
      A: 'm/d/yyyy',
      K: '$#,##0.00',
      N: '0%',
      O: '$#,##0.00',
      Q: '0%',
      R: '$#,##0.00',
      S: '$#,##0.00'
    }
  });
}

function writePmaxCampaignMetricsSheet_(sheet) {
  var headers = [
    'Date', 'Campaign ID', 'Campaign Name', 'Google Status', 'Monitor',
    'Expected to Spend', 'Daily Budget', 'Spend', 'Impressions', 'Clicks',
    'CTR', 'Avg. CPC', 'Conversions', 'Conv. Rate', 'CPL', 'Target CPL',
    'CPL Status', 'Spend Status', 'Alert', 'Notes'
  ];
  var formulaCols = {
    E: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',4,FALSE),"UNCONFIGURED"))',
    F: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',5,FALSE),"Disabled"))',
    K: '=IFERROR(J{r}/I{r},"")',
    L: '=IFERROR(H{r}/J{r},"")',
    N: '=IFERROR(M{r}/J{r},"")',
    O: '=IFERROR(H{r}/M{r},"")',
    P: '=IF(A{r}="","",Config!$B$13)',
    Q: '=IF(A{r}="","",IF(E{r}="Disabled","Excluded",IF(AND(M{r}=0,H{r}>=Config!$B$15),"Spend / No Conversions",IF(M{r}=0,"No Data",IF(O{r}>P{r}*Config!$B$14,"High CPL","On Target")))))',
    R: '=IF(A{r}="","",IF(E{r}="UNCONFIGURED","UNCONFIGURED",IF(E{r}="Disabled",IF(H{r}>0,"Unexpected Spend","Excluded"),IF(F{r}="Disabled","Not Expected",IF(D{r}<>"ENABLED","Unexpected Status",IF(H{r}=0,"Zero Spend","Spending"))))))',
    S: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(E{r}="UNCONFIGURED","Unconfigured Campaign",""),IF(R{r}="Unexpected Spend","Unexpected Spend",""),IF(R{r}="Unexpected Status","Unexpected Campaign Status",""),IF(R{r}="Zero Spend","Zero Spend",""),IF(Q{r}="High CPL","High CPL",""),IF(Q{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",T{r})),"Manual edit detected","")))'
  };
  writeMetricsSheetSkeleton_(sheet, {
    titleSuffix: 'PMax Campaign Metrics (Daily)',
    headers: headers,
    formulaCols: formulaCols,
    scriptCols: ['A', 'C', 'D', 'G', 'H', 'I', 'J', 'M', 'T'],
    idCols: ['B'],
    rowCount: SETUP_CONFIG.FORMULA_ROWS.PMAX_CAMPAIGN,
    freezeColumns: 3,
    statusHighlightCols: ['Q', 'R'],
    alertHighlightCols: ['S'],
    widths: [14, 19, 30, 17, 16, 19, 16, 15, 16, 12, 13, 14, 13, 13, 13, 13, 22, 20, 45, 36],
    numberFormats: {
      A: 'm/d/yyyy',
      G: '$#,##0.00',
      H: '$#,##0.00',
      K: '0%',
      L: '$#,##0.00',
      N: '0%',
      O: '$#,##0.00',
      P: '$#,##0.00'
    }
  });
}

function writeLocationMetricsSheet_(sheet) {
  var headers = [
    'Week Ending', 'Campaign ID', 'Campaign Name', 'Location', 'Location Type',
    'Campaign Monitor', 'Spend', 'Impressions', 'Clicks', 'CTR', 'Conversions',
    'Conv. Rate', 'CPL', 'Target CPL', 'CPL Status', 'Alert', 'Action Status', 'Notes'
  ];
  var formulaCols = {
    F: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',4,FALSE),"UNCONFIGURED"))',
    J: '=IFERROR(I{r}/H{r},"")',
    L: '=IFERROR(K{r}/I{r},"")',
    M: '=IFERROR(G{r}/K{r},"")',
    N: '=IF(A{r}="","",Config!$B$13)',
    O: '=IF(A{r}="","",IF(F{r}="Disabled","Excluded",IF(AND(K{r}=0,G{r}>=Config!$B$15),"Spend / No Conversions",IF(K{r}=0,"No Data",IF(M{r}>N{r}*Config!$B$14,"High CPL","On Target")))))',
    P: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(F{r}="UNCONFIGURED","Unconfigured Campaign",""),IF(AND(F{r}="Disabled",G{r}>0),"Unexpected Spend",""),IF(O{r}="High CPL","High CPL",""),IF(O{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",R{r})),"Manual edit detected","")))'
  };
  writeMetricsSheetSkeleton_(sheet, {
    titleSuffix: 'Location Metrics (Weekly)',
    headers: headers,
    formulaCols: formulaCols,
    scriptCols: ['A', 'C', 'D', 'E', 'G', 'H', 'I', 'K', 'R'],
    idCols: ['B'],
    rowCount: SETUP_CONFIG.FORMULA_ROWS.LOCATION,
    freezeColumns: 3,
    statusHighlightCols: ['O'],
    alertHighlightCols: ['P'],
    widths: [16, 19, 28, 30, 18, 19, 15, 16, 12, 13, 14, 13, 13, 13, 22, 42, 20, 38],
    numberFormats: {
      A: 'm/d/yyyy',
      G: '$#,##0.00',
      J: '0%',
      L: '0%',
      M: '$#,##0.00',
      N: '$#,##0.00'
    }
  });

  var actionRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Keep', 'Review', 'Exclude', 'Insufficient Data'], true)
      .setAllowInvalid(true)
      .build();
  var rows = SETUP_CONFIG.FORMULA_ROWS.LOCATION;
  sheet.getRange(5, 17, rows, 1).setDataValidation(actionRule);
  sheet.getRange(5, 17, rows, 1).setBackground(COLORS.USER_INPUT);
}

function writeDeviceMetricsSheet_(sheet) {
  var headers = [
    'Week Ending', 'Campaign ID', 'Campaign Name', 'Device', 'Campaign Monitor',
    'Spend', 'Impressions', 'Clicks', 'CTR', 'Conversions', 'Conv. Rate',
    'CPL', 'Target CPL', 'CPL Status', 'Alert', 'Action Status', 'Notes'
  ];
  var formulaCols = {
    E: '=IF(B{r}="","",IFERROR(VLOOKUP(B{r},' + CONFIG_RANGES.CAMPAIGNS + ',4,FALSE),"UNCONFIGURED"))',
    I: '=IFERROR(H{r}/G{r},"")',
    K: '=IFERROR(J{r}/H{r},"")',
    L: '=IFERROR(F{r}/J{r},"")',
    M: '=IF(A{r}="","",Config!$B$13)',
    N: '=IF(A{r}="","",IF(E{r}="Disabled","Excluded",IF(AND(J{r}=0,F{r}>=Config!$B$15),"Spend / No Conversions",IF(J{r}=0,"No Data",IF(L{r}>M{r}*Config!$B$14,"High CPL","On Target")))))',
    O: '=IF(A{r}="","",TEXTJOIN(", ",TRUE,IF(E{r}="UNCONFIGURED","Unconfigured Campaign",""),IF(AND(E{r}="Disabled",F{r}>0),"Unexpected Spend",""),IF(N{r}="High CPL","High CPL",""),IF(N{r}="Spend / No Conversions","Spend With No Conversions",""),IF(ISNUMBER(SEARCH("MANUAL EDIT",Q{r})),"Manual edit detected","")))'
  };
  writeMetricsSheetSkeleton_(sheet, {
    titleSuffix: 'Device Metrics (Weekly)',
    headers: headers,
    formulaCols: formulaCols,
    scriptCols: ['A', 'C', 'D', 'F', 'G', 'H', 'J', 'Q'],
    idCols: ['B'],
    rowCount: SETUP_CONFIG.FORMULA_ROWS.DEVICE,
    freezeColumns: 3,
    statusHighlightCols: ['N'],
    alertHighlightCols: ['O'],
    widths: [16, 19, 28, 18, 19, 15, 16, 12, 13, 14, 13, 13, 13, 22, 42, 20, 38],
    numberFormats: {
      A: 'm/d/yyyy',
      F: '$#,##0.00',
      I: '0%',
      K: '0%',
      L: '$#,##0.00',
      M: '$#,##0.00'
    }
  });

  var actionRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Keep', 'Review', 'Exclude', 'Insufficient Data'], true)
      .setAllowInvalid(true)
      .build();
  var rows = SETUP_CONFIG.FORMULA_ROWS.DEVICE;
  sheet.getRange(5, 16, rows, 1).setDataValidation(actionRule);
  sheet.getRange(5, 16, rows, 1).setBackground(COLORS.USER_INPUT);
}

/**
 * Shared metrics-sheet builder: title, compact legend, headers, formula prefill.
 * Header row stays on row 4 (Engine writes assume this).
 *
 * Do NOT merge cells across the frozen-column boundary — Sheets rejects
 * setFrozenColumns when a merge is only partly inside the freeze pane.
 */
function writeMetricsSheetSkeleton_(sheet, spec) {
  var shop = String(SETUP_CONFIG.BODY_SHOP_NAME || 'Body Shop').trim();
  var colCount = spec.headers.length;
  var rowCount = Math.max(1, Number(spec.rowCount || 100));
  var freezeCols = Math.max(1, Number(spec.freezeColumns || 1));

  // Title banner without merging across freeze boundary (A1 holds the text).
  sheet.getRange(1, 1).setValue(shop + ' — ' + spec.titleSuffix);
  styleTitleRow_(sheet, 1, colCount);
  writeCompactLegendRow_(sheet, 2, colCount);

  sheet.getRange(4, 1, 1, colCount).setValues([spec.headers]);
  styleHeaderRow_(sheet, 4, colCount);

  // Prefill formulas for each configured column.
  applyMetricFormulaColumns_(sheet, spec.formulaCols || {}, rowCount);

  // Body colors come from METRIC_COLUMN_ROLES so a fresh build and a later
  // refreshSpokeVisualFormatting can never disagree about a column.
  var roles = METRIC_COLUMN_ROLES[sheet.getName()] || {
    script: (spec.scriptCols || []).map(columnToIndex_),
    id: (spec.idCols || []).map(columnToIndex_),
    user: []
  };

  // Script-output columns (green).
  (roles.script || []).forEach(function(col) {
    sheet.getRange(5, col, rowCount, 1).setBackground(COLORS.SCRIPT);
  });

  // ID columns stay text + gray.
  (roles.id || []).forEach(function(col) {
    sheet.getRange(5, col, rowCount, 1)
        .setBackground(COLORS.ID_KEY)
        .setNumberFormat('@');
  });

  // Human dropdown columns stay cream so operators can see where to type.
  (roles.user || []).forEach(function(col) {
    sheet.getRange(5, col, rowCount, 1).setBackground(COLORS.USER_INPUT);
  });

  // Number formats (letter overrides first, then header-name defaults win for
  // counts so Clicks cannot stay stuck as percent).
  Object.keys(spec.numberFormats || {}).forEach(function(colLetter) {
    var col = columnToIndex_(colLetter);
    sheet.getRange(5, col, rowCount, 1)
        .setNumberFormat(spec.numberFormats[colLetter]);
  });
  applyMetricNumberFormatsByHeader_(sheet, spec.headers || [], rowCount);

  setColumnWidthsChars_(sheet, spec.widths || []);
  sheet.setFrozenRows(4);
  sheet.setFrozenColumns(freezeCols);
  applyMetricColumnBandsFromSpec_(sheet, spec, rowCount);
  applyMetricsStatusFormatting_(sheet, spec, rowCount);
  applyPacePercentTrafficLights_(sheet, spec.pacePercentCols || [], rowCount);
  ensureSpokeFilter_(sheet, 4, 1, rowCount + 1, colCount);
}

/**
 * Apply METRIC_HEADER_NUMBER_FORMATS using the header row labels.
 * Safe to run on live sheets (values kept; formats only).
 */
function applyMetricNumberFormatsByHeader_(sheet, headers, rowCount) {
  var list = headers || [];
  if (!list.length) {
    var lastCol = Math.max(1, sheet.getLastColumn());
    list = sheet.getRange(4, 1, 1, lastCol).getValues()[0];
  }
  var rows = Math.max(1, Number(rowCount) || 1);
  for (var i = 0; i < list.length; i++) {
    var name = String(list[i] || '').trim();
    var fmt = METRIC_HEADER_NUMBER_FORMATS[name];
    if (!fmt) {
      continue;
    }
    sheet.getRange(5, i + 1, rows, 1).setNumberFormat(fmt);
  }
}

function writeCompactLegendRow_(sheet, row, colCount) {
  // Single cell only — no merge — so column freeze never cuts a merged range.
  sheet.getRange(row, 1)
      .setValue(
          'Cream=type | Blue=formula | Green=script | Gray=ID | Peach=spend/budget | ' +
          'Lavender=leads/CPL | Pace%: green>105% yellow 95-105% red<95%')
      .setBackground(COLORS.ID_KEY)
      .setFontColor('#444444')
      .setFontSize(9)
      .setVerticalAlignment('middle');
  if (colCount > 1) {
    sheet.getRange(row, 2, 1, colCount - 1).setBackground(COLORS.ID_KEY);
  }
  sheet.setRowHeight(row, 22);
  sheet.setRowHeight(1, 32);
  sheet.setRowHeight(3, 8);
}

/**
 * Soft-tint spend/budget vs lead/conversion columns so they read apart.
 * Uses header names from the sheet (row 4) unless spec.leadCols / budgetCols given.
 */
function applyMetricColumnBandsFromSpec_(sheet, spec, rowCount) {
  var headers = spec.headers || [];
  var scriptMap = {};
  var specRoles = METRIC_COLUMN_ROLES[sheet.getName()];
  if (specRoles) {
    (specRoles.script || []).forEach(function(col) {
      scriptMap[col] = true;
    });
  } else {
    (spec.scriptCols || []).forEach(function(letter) {
      scriptMap[columnToIndex_(letter)] = true;
    });
  }
  var leadMap = {};
  var budgetMap = {};
  var i;
  if (spec.leadCols && spec.leadCols.length) {
    for (i = 0; i < spec.leadCols.length; i++) {
      leadMap[columnToIndex_(spec.leadCols[i])] = true;
    }
  }
  if (spec.budgetCols && spec.budgetCols.length) {
    for (i = 0; i < spec.budgetCols.length; i++) {
      budgetMap[columnToIndex_(spec.budgetCols[i])] = true;
    }
  }
  for (i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    var col = i + 1;
    if (METRIC_LEAD_HEADERS[name]) {
      leadMap[col] = true;
    }
    if (METRIC_BUDGET_HEADERS[name]) {
      budgetMap[col] = true;
    }
  }
  applyColumnBandColors_(sheet, leadMap, budgetMap, scriptMap, rowCount);
}

function applyColumnBandColors_(sheet, leadMap, budgetMap, scriptMap, rowCount) {
  var lastCol = Math.max(1, sheet.getLastColumn());
  var headers = sheet.getRange(4, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < headers.length; c++) {
    var col = c + 1;
    var isLead = !!leadMap[col];
    var isBudget = !!budgetMap[col];
    if (!isLead && !isBudget) {
      continue;
    }
    var headerBg = isLead ? COLORS.LEAD_HEADER : COLORS.BUDGET_HEADER;
    var dataBg = scriptMap[col]
        ? (isLead ? COLORS.LEAD_SCRIPT : COLORS.BUDGET_SCRIPT)
        : (isLead ? COLORS.LEAD_FORMULA : COLORS.BUDGET_FORMULA);
    sheet.getRange(4, col)
        .setBackground(headerBg)
        .setFontColor(COLORS.WHITE)
        .setFontWeight('bold');
    // Always force dark body text — pastel alone is unreadable if white header
    // font leaked into data rows after Engine insertRowsAfter(header).
    sheet.getRange(5, col, rowCount, 1)
        .setBackground(dataBg)
        .setFontColor(COLORS.FONT_BODY)
        .setFontWeight('normal');
  }
}

/**
 * Budget Pace % / Lead Pace % traffic lights:
 * green > 105%, yellow 95%–105%, red < 95%.
 */
function applyPacePercentTrafficLights_(sheet, paceCols, rowCount) {
  if (!paceCols || !paceCols.length) {
    // Discover from headers when not passed.
    paceCols = [];
    var lastCol = Math.max(1, sheet.getLastColumn());
    var headers = sheet.getRange(4, 1, 1, lastCol).getValues()[0];
    for (var h = 0; h < headers.length; h++) {
      if (METRIC_PACE_HEADERS[String(headers[h] || '').trim()]) {
        paceCols.push(columnToLetter_(h + 1));
      }
    }
  }
  if (!paceCols.length) {
    return;
  }
  var rules = sheet.getConditionalFormatRules() || [];
  for (var i = 0; i < paceCols.length; i++) {
    var col = typeof paceCols[i] === 'number'
        ? paceCols[i]
        : columnToIndex_(paceCols[i]);
    var range = sheet.getRange(5, col, rowCount, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0.95)
        .setBackground(COLORS.PACE_RED)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberBetween(0.95, 1.05)
        .setBackground(COLORS.PACE_YELLOW)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(1.05)
        .setBackground(COLORS.PACE_GREEN)
        .setRanges([range])
        .build());
  }
  sheet.setConditionalFormatRules(rules);
}

/**
 * Live-sheet refresh: restore ALL data-row backgrounds + dark text, number
 * formats, band colors, and pace lights from current headers.
 * Keeps values; rebuilds pace CF while preserving other status CF rules.
 */
function applyMetricColumnBandsAndPaceLights_(sheet) {
  var headerRow = 4;
  var lastCol = Math.max(1, sheet.getLastColumn());
  var lastRow = Math.max(headerRow + 1, sheet.getLastRow());
  // Cap so we do not restyle tens of thousands of empty template rows slowly,
  // but always cover at least the used data block.
  var rowCount = Math.max(1, lastRow - headerRow);
  var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  var tabName = sheet.getName();
  var leadMap = {};
  var budgetMap = {};
  var scriptMap = {};
  var paceCols = [];

  for (var c = 0; c < headers.length; c++) {
    var name = String(headers[c] || '').trim();
    var col = c + 1;
    if (METRIC_LEAD_HEADERS[name]) {
      leadMap[col] = true;
    }
    if (METRIC_BUDGET_HEADERS[name]) {
      budgetMap[col] = true;
    }
    if (METRIC_PACE_HEADERS[name]) {
      paceCols.push(col);
    }
    if (metricColumnRole_(tabName, col, name) === 'script') {
      scriptMap[col] = true;
    }
  }

  // 1) Hard reset the whole data block first. Engine inserts can leave white
  //    bold header font on data rows; per-column passes alone can miss columns
  //    whose header cell is blank, so sweep the full width in one call.
  var dataBlock = sheet.getRange(5, 1, rowCount, lastCol);
  dataBlock
      .setFontColor(COLORS.FONT_BODY)
      .setFontWeight('normal')
      .setFontStyle('normal')
      .setWrap(false)
      .setVerticalAlignment('middle');
  for (var rh = 0; rh < rowCount; rh++) {
    sheet.setRowHeight(5 + rh, 21);
  }

  // 2) Every data column: pastel body BG (fixes dark header color bleeding down).
  restyleMetricDataRows_(sheet, headers, rowCount);

  // 3) Header row 4 stays dark + white bold across every column.
  restoreMetricHeaderRow_(sheet, headers, leadMap, budgetMap);

  // 4) Budget/lead header accents (peach / lavender header tints).
  applyColumnBandColors_(sheet, leadMap, budgetMap, scriptMap, rowCount);

  // 5) Number formats ($ / % / whole counts).
  applyMetricNumberFormatsByHeader_(sheet, headers, rowCount);

  // 6) Rebuild status + pace conditional formatting anchored at row 5.
  //    Engine inserts push old CF ranges down, so recent rows lose their
  //    green/yellow/red. Rebuilding is safer than trying to patch ranges.
  if (!rebuildMetricConditionalFormats_(sheet, rowCount)) {
    // Unknown tab: at least re-apply pace lights over the whole block.
    sheet.setConditionalFormatRules([]);
    applyPacePercentTrafficLights_(sheet, paceCols, rowCount);
  }
}

/**
 * Rebuild every conditional-format rule a metrics tab is supposed to have:
 * Status text colors, non-empty Alert highlight, and Pace % traffic lights.
 * Returns false for tabs that are not in METRIC_CF_COLUMNS.
 *
 * This replaces all conditional formatting on the tab. That is intentional:
 * only applyMetricsStatusFormatting_ and applyPacePercentTrafficLights_ ever
 * add rules to metrics tabs, so a full rebuild reproduces the intended set
 * exactly and cannot leave stale ranges behind.
 */
function rebuildMetricConditionalFormats_(sheet, rowCount) {
  var cf = METRIC_CF_COLUMNS[sheet.getName()];
  if (!cf) {
    return false;
  }
  var rows = Math.max(1, Number(rowCount) || 1);
  var rules = [];
  var i;
  var c;

  for (c = 0; c < (cf.status || []).length; c++) {
    var statusRange = sheet.getRange(5, cf.status[c], rows, 1);
    for (i = 0; i < METRIC_STATUS_WARN_VALUES.length; i++) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo(METRIC_STATUS_WARN_VALUES[i])
          .setBackground(COLORS.WARN_SOFT)
          .setRanges([statusRange])
          .build());
    }
    for (i = 0; i < METRIC_STATUS_OK_VALUES.length; i++) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenTextEqualTo(METRIC_STATUS_OK_VALUES[i])
          .setBackground(COLORS.OK_SOFT)
          .setRanges([statusRange])
          .build());
    }
  }

  for (c = 0; c < (cf.alert || []).length; c++) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenCellNotEmpty()
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([sheet.getRange(5, cf.alert[c], rows, 1)])
        .build());
  }

  for (c = 0; c < (cf.pace || []).length; c++) {
    var paceRange = sheet.getRange(5, cf.pace[c], rows, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0.95)
        .setBackground(COLORS.PACE_RED)
        .setRanges([paceRange])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberBetween(0.95, 1.05)
        .setBackground(COLORS.PACE_YELLOW)
        .setRanges([paceRange])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(1.05)
        .setBackground(COLORS.PACE_GREEN)
        .setRanges([paceRange])
        .build());
  }

  sheet.setConditionalFormatRules(rules);
  return true;
}

/**
 * Paint every metrics data column with the correct pastel body color and dark
 * text. Does not wipe values. Header row is left alone here (banded separately).
 */
function restyleMetricDataRows_(sheet, headers, rowCount) {
  if (rowCount < 1) {
    return;
  }
  var tabName = sheet.getName();
  for (var c = 0; c < headers.length; c++) {
    var col = c + 1;
    var name = String(headers[c] || '').trim();
    var bg = metricBodyBackground_(metricColumnRole_(tabName, col, name), name);
    sheet.getRange(5, col, rowCount, 1)
        .setBackground(bg)
        .setFontColor(COLORS.FONT_BODY)
        .setFontWeight('normal')
        .setWrap(false);
  }
}

/**
 * Header row 4 must stay dark with white bold labels on every column, even
 * columns that are neither budget nor lead tinted.
 */
function restoreMetricHeaderRow_(sheet, headers, leadMap, budgetMap) {
  for (var c = 0; c < headers.length; c++) {
    var col = c + 1;
    var bg = COLORS.HEADER;
    if (budgetMap[col]) {
      bg = COLORS.BUDGET_HEADER;
    } else if (leadMap[col]) {
      bg = COLORS.LEAD_HEADER;
    }
    sheet.getRange(4, col)
        .setBackground(bg)
        .setFontColor(COLORS.WHITE)
        .setFontWeight('bold')
        .setWrap(true)
        .setVerticalAlignment('middle');
  }
}

function columnToLetter_(col) {
  var n = Number(col);
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function applyMetricsStatusFormatting_(sheet, spec, rowCount) {
  var rules = sheet.getConditionalFormatRules() || [];
  var statusCols = spec.statusHighlightCols || [];
  for (var i = 0; i < statusCols.length; i++) {
    var col = columnToIndex_(statusCols[i]);
    var range = sheet.getRange(5, col, rowCount, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Needs Attention')
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Off Pace')
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('High CPL')
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Spend / No Conversions')
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Unexpected Spend')
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Unexpected Status')
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Zero Spend')
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('On Pace')
        .setBackground(COLORS.OK_SOFT)
        .setRanges([range])
        .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('On Target')
        .setBackground(COLORS.OK_SOFT)
        .setRanges([range])
        .build());
  }

  // Soft-highlight any non-blank Alert / Active Alerts cells.
  var alertCols = spec.alertHighlightCols || [];
  for (var a = 0; a < alertCols.length; a++) {
    var alertCol = columnToIndex_(alertCols[a]);
    var alertRange = sheet.getRange(5, alertCol, rowCount, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenCellNotEmpty()
        .setBackground(COLORS.WARN_SOFT)
        .setRanges([alertRange])
        .build());
  }

  sheet.setConditionalFormatRules(rules);
}

function ensureSpokeFilter_(sheet, startRow, startCol, numRows, numCols) {
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
/* STYLING HELPERS                                                            */
/* -------------------------------------------------------------------------- */

function writeLegendRow_(sheet, row) {
  sheet.getRange(row, 1).setValue('CELL LEGEND').setFontWeight('bold');
  sheet.getRange(row, 2, 1, 2).merge().setValue('User Input')
      .setBackground(COLORS.USER_INPUT);
  sheet.getRange(row, 4, 1, 2).merge().setValue('Formula')
      .setBackground(COLORS.FORMULA);
  sheet.getRange(row, 6, 1, 2).merge().setValue('Script Output')
      .setBackground(COLORS.SCRIPT);
  sheet.getRange(row, 8).setValue('ID / Key').setBackground(COLORS.ID_KEY);
}

function writeSectionBanner_(sheet, row, title, colCount) {
  sheet.getRange(row, 1, 1, colCount).merge().setValue(title);
  sheet.getRange(row, 1, 1, colCount)
      .setBackground(COLORS.SECTION)
      .setFontColor(COLORS.WHITE)
      .setFontWeight('bold')
      .setWrap(true);
  sheet.setRowHeight(row, 36);
}

/**
 * One plain-English guide row under a table header so managers know what to type.
 * Not for data entry — leave it in place and fill the yellow rows below it.
 */
function writeColumnGuideRow_(sheet, row, guides, colCount) {
  var values = [];
  for (var i = 0; i < colCount; i++) {
    values.push(guides[i] || '');
  }
  sheet.getRange(row, 1, 1, colCount).setValues([values]);
  sheet.getRange(row, 1, 1, colCount)
      .setBackground(COLORS.GUIDE)
      .setFontColor('#444444')
      .setFontStyle('italic')
      .setFontSize(9)
      .setWrap(true)
      .setVerticalAlignment('top');
  sheet.setRowHeight(row, 78);
}

function styleTitleRow_(sheet, row, colCount) {
  sheet.getRange(row, 1, 1, colCount)
      .setBackground(COLORS.TITLE)
      .setFontColor(COLORS.WHITE)
      .setFontWeight('bold')
      .setFontSize(14);
  sheet.setRowHeight(row, 28);
}

function styleHeaderRow_(sheet, row, colCount) {
  sheet.getRange(row, 1, 1, colCount)
      .setBackground(COLORS.HEADER)
      .setFontColor(COLORS.WHITE)
      .setFontWeight('bold')
      .setWrap(true);
  sheet.setRowHeight(row, 34);
}

function setColumnWidthsChars_(sheet, widths) {
  for (var i = 0; i < widths.length; i++) {
    if (widths[i] == null) {
      continue;
    }
    // Excel character width → approximate Sheets pixels.
    sheet.setColumnWidth(i + 1, Math.round(Number(widths[i]) * 7 + 10));
  }
}

function columnToIndex_(letter) {
  var s = String(letter || '').toUpperCase();
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}
