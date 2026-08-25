/**
 * Built by Shah — add / refresh Negatives Audit tab only
 *
 * Adds (or refreshes headers/guide on) the **Negatives Audit** tab on an
 * existing spoke Google Sheet. Does not wipe history rows when headers match.
 * Does not change Config, metrics, Instructions, Definitions, or Daily Checklist.
 *
 * How to use:
 *   1. Open the body shop spoke Google Sheet
 *   2. Extensions → Apps Script
 *   3. Paste this entire file into a new .gs file
 *   4. Optional: set NEGATIVES_SETUP.EXISTING_SPREADSHEET_URL for a standalone project
 *   5. Run refreshNegativesAuditTab() once and authorize
 *   6. Reload the Sheet — Negatives Audit should sit near Search metrics
 *
 * New spokes built with create-body-shop-workbook.gs V 1.10.0+ already include
 * this tab. Prefer that generator for full rebuilds.
 *
 * After adding the tab, set Hub Config → Negatives Sweeper Enabled = Enabled
 * for this shop (and keep Enabled = Enabled).
 */

var NEGATIVES_SETUP = {
  EXISTING_SPREADSHEET_URL: '',
  BODY_SHOP_NAME: '',
  TAB_NAME: 'Negatives Audit',
  DATA_ROWS: 200
};

var NEGATIVES_COLORS = {
  TITLE: '#17324D',
  HEADER: '#3A5A78',
  GUIDE: '#FFF8E7',
  USER_INPUT: '#F7F3E8',
  SCRIPT: '#E6EEE9',
  TEXT: '#1A1A1A',
  TAB: '#3A5A78'
};

var NEGATIVES_HEADERS = [
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

var NEGATIVES_GUIDE = [
  'Sweeper writes newest rows under this header.',
  'SEARCH or PMAX',
  'Ads campaign ID',
  'Campaign name',
  'Query that matched a rule',
  'Exact negative added in Ads',
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

function refreshNegativesAuditTab() {
  var spreadsheet = getNegativesTargetSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(NEGATIVES_SETUP.TAB_NAME);
  var existingRows = [];
  if (sheet && sheet.getLastRow() >= 4) {
    var lastRow = sheet.getLastRow();
    var lastCol = Math.min(sheet.getLastColumn(), NEGATIVES_HEADERS.length);
    var headerCheck = sheet.getRange(2, 1, 1, lastCol).getDisplayValues()[0];
    var headersMatch = true;
    for (var h = 0; h < NEGATIVES_HEADERS.length; h++) {
      if (String(headerCheck[h] || '') !== NEGATIVES_HEADERS[h]) {
        headersMatch = false;
        break;
      }
    }
    if (headersMatch && lastRow >= 4) {
      existingRows = sheet.getRange(4, 1, lastRow - 3, NEGATIVES_HEADERS.length).getValues();
    }
  }

  if (!sheet) {
    sheet = spreadsheet.insertSheet(NEGATIVES_SETUP.TAB_NAME);
  }
  writeNegativesAuditLayout_(sheet);

  if (existingRows.length) {
    sheet.getRange(4, 1, existingRows.length, NEGATIVES_HEADERS.length)
        .setValues(existingRows);
  }

  orderNegativesTab_(spreadsheet);
  sheet.setTabColor(NEGATIVES_COLORS.TAB);
  Logger.log('Negatives Audit ready: ' + spreadsheet.getUrl());
  try {
    SpreadsheetApp.getUi().alert(
        'Negatives Audit tab is ready.\n\n' +
        'Next: on the Hub, set Negatives Sweeper Enabled = Enabled for this shop ' +
        '(and keep Enabled = Enabled).'
    );
  } catch (eUi) {
    // Standalone project may not have UI.
  }
}

function getNegativesTargetSpreadsheet_() {
  if (NEGATIVES_SETUP.EXISTING_SPREADSHEET_URL) {
    return SpreadsheetApp.openByUrl(NEGATIVES_SETUP.EXISTING_SPREADSHEET_URL);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function writeNegativesAuditLayout_(sheet) {
  var bodyRows = NEGATIVES_SETUP.DATA_ROWS;
  var colCount = NEGATIVES_HEADERS.length;
  var shop = NEGATIVES_SETUP.BODY_SHOP_NAME ||
      String(SpreadsheetApp.getActiveSpreadsheet() ?
          SpreadsheetApp.getActiveSpreadsheet().getName() : 'Body Shop')
          .split(' — ')[0];

  sheet.clear();
  try {
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), bodyRows + 3),
        Math.max(sheet.getMaxColumns(), colCount)).clearDataValidations();
  } catch (e) {
    // Ignore.
  }

  sheet.getRange(1, 1, 1, colCount).merge()
      .setValue(shop + ' — Negatives Audit (exact campaign negatives from the sweeper)')
      .setFontWeight('bold')
      .setFontColor('#FFFFFF')
      .setBackground(NEGATIVES_COLORS.TITLE)
      .setFontSize(14);
  sheet.setRowHeight(1, 28);

  sheet.getRange(2, 1, 1, colCount).setValues([NEGATIVES_HEADERS])
      .setFontWeight('bold')
      .setFontColor('#FFFFFF')
      .setBackground(NEGATIVES_COLORS.HEADER)
      .setWrap(true);
  sheet.setRowHeight(2, 40);
  sheet.setFrozenRows(2);

  sheet.getRange(3, 1, 1, colCount).setValues([NEGATIVES_GUIDE])
      .setBackground(NEGATIVES_COLORS.GUIDE)
      .setFontColor(NEGATIVES_COLORS.TEXT)
      .setFontStyle('italic')
      .setWrap(true);
  sheet.setRowHeight(3, 48);

  var dataStart = 4;
  sheet.getRange(dataStart, 1, bodyRows, colCount)
      .setBackground(NEGATIVES_COLORS.SCRIPT)
      .setFontColor(NEGATIVES_COLORS.TEXT);
  sheet.getRange(dataStart, 16, bodyRows, 1).setBackground(NEGATIVES_COLORS.USER_INPUT);
  sheet.getRange(dataStart, 17, bodyRows, 1).setBackground(NEGATIVES_COLORS.USER_INPUT);
  sheet.getRange(dataStart, 20, bodyRows, 1).setBackground(NEGATIVES_COLORS.USER_INPUT);

  var checkbox = SpreadsheetApp.newDataValidation()
      .requireCheckbox()
      .setAllowInvalid(false)
      .build();
  sheet.getRange(dataStart, 16, bodyRows, 1).setDataValidation(checkbox).setValue(false);
  sheet.getRange(dataStart, 17, bodyRows, 1).setDataValidation(checkbox).setValue(false);

  sheet.getRange(dataStart, 10, bodyRows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(dataStart, 11, bodyRows, 1).setNumberFormat('$#,##0.00');

  var widths = [150, 80, 120, 200, 260, 260, 160, 100, 80, 110, 110, 100, 260, 120, 320, 90, 90, 100, 140, 220];
  for (var w = 0; w < widths.length; w++) {
    sheet.setColumnWidth(w + 1, widths[w]);
  }
}

function orderNegativesTab_(spreadsheet) {
  var preferred = [
    'Daily Checklist',
    'Account Metrics (Daily)',
    'Search Campaign Metrics (Daily)',
    'Search Keyword Metrics (Daily)',
    'Negatives Audit',
    'PMax Campaign Metrics (Daily)',
    'Location Metrics (Weekly)',
    'Device Metrics (Weekly)',
    'Instructions',
    'Definitions',
    'Config'
  ];
  for (var i = 0; i < preferred.length; i++) {
    var sheet = spreadsheet.getSheetByName(preferred[i]);
    if (!sheet) continue;
    spreadsheet.setActiveSheet(sheet);
    spreadsheet.moveActiveSheet(i + 1);
  }
}
