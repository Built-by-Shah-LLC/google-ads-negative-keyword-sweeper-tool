/**
 * BUILT BY SHAH — MCC Engine Hub→Spoke contract (documentation stub)
 * Version: 1.6.0
 *
 * This file is NOT a runnable Ads Script. It locks the Hub↔Spoke sync contract.
 * The runnable Engine is scripts/built-by-shah-mcc-engine.js.
 *
 * Hub Config headers are human-readable (spaces, no underscores) and must
 * match apps-script/create-hub-workbook.gs exactly.
 *
 * Negatives sweeper columns live on the Hub but are NOT Engine-synced to spokes.
 * See scripts/built-by-shah-mcc-search-negatives-sweeper.js and the PMax sister.
 *
 * Architecture: docs/Read this to understand the Hub Engine and Spoke sheets - system blueprint.md
 * Scale: docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md (daily due-queue; ≤50 accounts per executeInParallel)
 */

const HUB_SPOKE_SYNC_CONTRACT = {
  version: '1.6.0',

  hubConfigColumns: [
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
  ],

  /**
   * Map Hub Config headers → spoke Config!B values (Setting Key in column A).
   * Per-alert send gates stay Hub-only (not synced).
   */
  spokeConfigSyncMap: {
    'Account ID': ['ACCOUNT_ID'],
    'Account Name': ['ACCOUNT_NAME'],
    'Enabled': ['ACCOUNT_MONITORING_ENABLED'],
    'Time Zone': ['TIME_ZONE'],
    'Daily Budget': ['DAILY_BUDGET'],
    'Monthly Lead Goal': ['MONTHLY_LEAD_GOAL'],
    'Target CPL': ['TARGET_CPL'],
    'Alerts Enabled': ['ALERTS_ENABLED'],
    'High CPL Multiplier': ['HIGH_CPL_MULTIPLIER'],
    'Zero Conversion Spend Alert': ['ZERO_CONVERSION_SPEND_ALERT'],
    'Budget Pace Tolerance': ['BUDGET_PACE_TOLERANCE'],
    'Lead Pace Tolerance': ['LEAD_PACE_TOLERANCE'],
    'Account Manager Name': ['ACCOUNT_MANAGER_NAME'],
    'Account Manager Email': ['ALERT_RECIPIENT_EMAILS', 'ACCOUNT_MANAGER_EMAIL'],
    'CSM Name': ['CSM_NAME'],
    'CSM Email': ['CSM_EMAIL'],
    'Campaign Start Date': ['CAMPAIGN_START_DATE']
  },

  hubOnlyAlertSendGates: [
    'Alert: Budget Off Pace',
    'Alert: Leads Off Pace',
    'Alert: High CPL',
    'Alert: Spend No Conversions',
    'Alert: Zero Spend',
    'Alert: Unconfigured'
  ],

  // Dollar thresholds edited on Hub only (Engine reads them; not all sync to spoke).
  hubOnlyThresholdColumns: [
    'Keyword Waste Spend Threshold'
  ],

  rules: [
    'Skip Hub rows where Enabled is not "Enabled".',
    'Require Spoke Spreadsheet URL; fail that account into Run Log if missing/invalid.',
    'Open the spoke spreadsheet; write only mapped Config keys (green cells).',
    'If Alerts Enabled is Disabled, send no account alerts (still write metrics).',
    'For each alert event, also require the matching Alert: … send gate to be Enabled.',
    'Never overwrite yellow spoke Config cells (campaign tables, overrides, etc.).',
    'Sync Hub Time Zone into spoke TIME_ZONE and set the spoke spreadsheet time zone when present.',
    'Never overwrite blue formula columns on metrics tabs.',
    'Keep Google Ads IDs as plain text (@).',
    'Do not use a global LockService.getScriptLock() across parallel spoke writers (different spokes do not collide).',
    'Humans edit goals and alert controls only on the Hub — never on synced spoke cells.',
    'Cap executeInParallel at 50. Auto-select due accounts (Last Successful Run blank/not today); stamp success dates; schedule the same Engine multiple times/day for 70–200+ shops.',
    'Never fork a new Engine script or Hub spreadsheet per 50 shops.',
    'Alert: Zero Spend means no delivery yesterday (cost/impressions/clicks all 0), not an hours threshold.',
    'Spoke metrics may still display Unexpected Spend / Unexpected Status from campaign checklist formulas; those are Sheet display only (no Hub email gates).',
    'Hub Config column order: identity → ops (Enabled/Priority/Campaign Start Date/Last Successful Run) → routing → goals → thresholds → alert gates → people.'
  ],

  perAccountSteps: [
    'syncHubGoalsToSpokeConfig_',
    'writeDailyMetrics_',
    'maybeWriteWeeklySegments_',
    'evaluateAndSendAlertsFromHubGates_'
  ],

  scaleSteps: [
    'ensureHubScaleColumns_',
    'selectDueAccountBatch_',
    'executeInParallel(batch ≤ 50)',
    'stampHubLastSuccessfulRuns_',
    'write DAILY_CYCLE_COMPLETE when due queue empty'
  ]
};
