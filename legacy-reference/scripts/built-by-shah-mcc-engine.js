/**
 * BUILT BY SHAH — MCC Hub-and-Spoke Engine
 * Version: 1.2.3
 *
 * PURPOSE
 * -------
 * Daily MCC Google Ads Script for the Hub-and-Spoke architecture:
 *   - Reads the agency Google Ads Hub Config (goals, routing, alert gates)
 *   - Syncs Hub goal fields into each spoke Config (green cells)
 *   - Pulls Ads performance (account / Search / PMax / Search keywords; weekly geo+device)
 *   - Writes newest daily/weekly metric rows under the header (older rows pushed down)
 *   - Writes metrics into that account's spoke workbook only
 *   - Logs batch status to Hub Run Log and issues to Google Ads Hub Alerts
 *   - Sends a problem-first Google Ads Account Status email per Engine batch
 *     (max 50 shops/run; may send more than one email/day if shops remain due;
 *     no separate per-issue alert emails). Negatives automation is a sibling
 *     MCC script (Search / PMax sweepers), not part of this Engine.
 *   - 1.2.0: 30-day money-back email banners (lead strip + sort + CSM CC on
 *     guarantee-window shops, including Healthy).
 *   - 1.2.1: After insertRowsAfter(header), restore pastel body colors by header
 *     name and apply full metric number formats (Expected Spend $, Expected Leads
 *     whole ints, Budget/Lead Pace %). Prevents new rows inheriting dark header
 *     formatting / raw decimals.
 *   - 1.2.2: Body colors now come from SPOKE_METRIC_COLUMN_ROLES (per tab, per
 *     column) instead of guessing from header names, which mispainted 23 columns
 *     across the six metrics tabs — most importantly the cream Action Status
 *     dropdowns on the weekly tabs and the green Notes columns. Also resets font
 *     on the full row width so blank-header columns cannot keep white header text.
 *   - 1.2.3: Re-anchor conditional formatting after top inserts. Sheets shifts CF
 *     ranges down instead of growing them, so newly inserted rows fell outside
 *     every rule and Budget/Lead Status, Budget/Lead Pace %, and CPL Status
 *     stopped showing green/yellow/red on recent rows.
 *
 * SAFETY
 * ------
 * This version does not modify Google Ads accounts (read-only Ads access).
 * It writes Google Sheets (Hub Run Log/Alerts + spoke Config sync + metrics).
 *
 * INSTALLATION
 * ------------
 * 1. Google Ads Manager Account > Tools > Bulk actions > Scripts.
 * 2. Paste this entire file.
 * 3. Confirm ENGINE_CONFIG.HUB_SPREADSHEET_URL points at your live Hub (already set in this repo).
 * 4. Ensure each Google Ads Hub Config row has Spoke Spreadsheet URL and Enabled = Enabled.
 * 5. Preview, authorize, Run.
 * 6. SCHEDULE enough runs per day (Google Ads allows only ONE Frequency per Scripts row):
 *      ~70 accounts  → at least TWICE daily (e.g. 6:00 AM + 7:00 AM)
 *      ≤50 accounts  → once daily is enough
 *      ~200 accounts → about four runs
 *    To get two Daily times: add a second Scripts row with the SAME Engine code + same Hub URL
 *    (wave 2 schedule only — not a second Hub, not a Batch A/B fork).
 *    Each run auto-processes the next ≤50 shops still due today (Last Successful Run).
 *    See docs/Read this to schedule the Engine - why about 70 shops need two runs every day.md (plain English) and docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md.
 *
 * Architecture: docs/Read this to understand the Hub Engine and Spoke sheets - system blueprint.md
 * Scale: docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md (one Hub, one Engine, daily due-queue ≤50 per run)
 * Scheduling: docs/Read this to schedule the Engine - why about 70 shops need two runs every day.md
 */

const ENGINE_CONFIG = {
  // Required. Agency Hub workbook URL (create-hub-workbook.gs).
  HUB_SPREADSHEET_URL:
      'HUB_SPREADSHEET_URL_PLACEHOLDER',

  // Empty = auto due-queue from Hub. Otherwise force these IDs (still capped at 50).
  ACCOUNT_IDS: [],

  // Google hard limit for executeInParallel. Never raise above 50.
  MAX_ACCOUNTS: 50,

  // When true, each run processes only accounts due today (Last Successful Run
  // blank / not today), up to MAX_ACCOUNTS. Schedule the same script multiple
  // times per day to cover 70–200+ shops — see docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md.
  AUTO_SHARD: true,

  MAX_CHANGE_EVENTS_PER_ACCOUNT: 2000,
  MAX_KEYWORD_ROWS: 500,

  // Hub Run Log timestamps and weekly gate for spoke Location/Device tabs.
  REPORT_TIME_ZONE: 'America/New_York',

  // 0 = Sunday ... 5 = Friday. Weekly Location + Device tabs only on this day.
  WEEKLY_SEGMENT_DAY: 5,

  // Keep false in production. true rewrites weekly Location/Device every run (testing only).
  WRITE_WEEKLY_EVERY_RUN: false,

  // Master switch for Google Ads Account Status emails. true = send after each batch.
  SEND_INTERNAL_EMAILS: true,

  // Morning digest behavior (problem-first — replaces separate alert emails).
  EMAIL_PROBLEM_FIRST: true,
  // Show healthy accounts below the Action Required block (muted) so managers
  // can contrast problem shops vs healthy ones in one glance.
  EMAIL_INCLUDE_HEALTHY_ACCOUNTS: true,
  // When true and there are no problems, still send a short "all clear" digest.
  EMAIL_SEND_ALL_CLEAR: true,
  // Include CSM Email on digests when that CSM’s shop has open problems OR is
  // still inside the first-30-day minimum lead money-back guarantee window
  // (including Healthy shops). Set false to never CC CSM Email.
  EMAIL_INCLUDE_CSM_ON_PROBLEMS: true,

  EMAIL_SUBJECT_PREFIX: 'Built by Shah | Google Ads Account Status',
  EMAIL_SENDER_NAME: 'Built by Shah',
  BRAND_LOGO_CID: 'builtByShahLogo',
  BRAND_LOGO_WIDTH_PX: 190,
  EMAIL_INCLUDE_CLIENT_SECTION: true,
  EMAIL_SORT_ACCOUNTS_BY_HEALTH: true,

  // Lead-pace alerts ignored until this many days after Campaign Start Date.
  LEAD_PACE_GRACE_DAYS: 7,
  // Status-email callout: Hub Campaign Start Date → first N days = minimum lead
  // money-back guarantee window (banner + sort those shops to top of section,
  // closest deadline first).
  MONEY_BACK_GUARANTEE_DAYS: 30,
  // 14-day keyword/ad-group waste lookback. Dollar threshold comes from Hub
  // "Keyword Waste Spend Threshold" when set; otherwise WASTE_SPEND_THRESHOLD.
  WASTE_LOOKBACK_DAYS: 14,
  WASTE_SPEND_THRESHOLD: 50,
  // Location waste: ≥N clicks and 0 conversions over this many days (no $ gate).
  LOCATION_WASTE_LOOKBACK_DAYS: 30,
  LOCATION_WASTE_MIN_CLICKS: 20,

  // Fallbacks when Hub cells are blank (Hub values always win when present).
  DEFAULT_PACE_TOLERANCE: 0.15,
  DEFAULT_ZERO_CONVERSION_SPEND_ALERT: 200,
  AVERAGE_DAYS_PER_MONTH: 30.4,

  HUB_SHEETS: {
    CONFIG: 'Config',
    RUN_LOG: 'Run Log',
    ALERTS: 'Alerts'
  },

  SPOKE_SHEETS: {
    CONFIG: 'Config',
    ACCOUNT: 'Account Metrics (Daily)',
    SEARCH_CAMPAIGN: 'Search Campaign Metrics (Daily)',
    SEARCH_KEYWORD: 'Search Keyword Metrics (Daily)',
    PMAX_CAMPAIGN: 'PMax Campaign Metrics (Daily)',
    LOCATION: 'Location Metrics (Weekly)',
    DEVICE: 'Device Metrics (Weekly)'
  }
};

/** Operator-facing name in status emails (not the Scripts file name). */
const ENGINE_PRODUCT_NAME = 'Built by Shah Google Ads Script Engine';

const BUILT_BY_SHAH_LOGO_DARK_PNG_BASE64 =
    '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';


const HUB_SPOKE_SYNC_MAP = {
  'Account ID': ['ACCOUNT_ID'],
  'Account Name': ['ACCOUNT_NAME'],
  Enabled: ['ACCOUNT_MONITORING_ENABLED'],
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
};

const HUB_RUN_LOG_HEADERS = [
  'Run Date Time', 'Status', 'Accounts Selected', 'Accounts Succeeded',
  'Accounts Failed', 'Hub Spreadsheet URL', 'Message'
];

const HUB_ALERTS_HEADERS = [
  'Alert Date Time', 'Account ID', 'Account Name', 'Status',
  'Alert Type', 'Message', 'Resolved'
];
const HUB_ALERT_STATUS_NEEDS_ATTENTION = 'Needs attention';

// Must match apps-script/create-hub-workbook.gs CONFIG_HEADERS column *names*.
// Order may differ on older Hubs (e.g. Campaign Start Date still near the right,
// or Priority / Last Successful Run appended). Validation is by name, not position.
const HUB_CONFIG_HEADERS = [
  'Account ID', 'Account Name', 'Enabled', 'Priority', 'Campaign Start Date',
  'Last Successful Run',
  'Client Name', 'Spoke Spreadsheet URL', 'Time Zone',
  'Daily Budget', 'Monthly Budget', 'Monthly Lead Goal', 'Target CPL',
  'Alerts Enabled', 'High CPL Multiplier', 'Zero Conversion Spend Alert',
  'Keyword Waste Spend Threshold',
  'Budget Pace Tolerance', 'Lead Pace Tolerance',
  'Alert: Budget Off Pace', 'Alert: Leads Off Pace', 'Alert: High CPL',
  'Alert: Spend No Conversions', 'Alert: Zero Spend', 'Alert: Unconfigured',
  'Account Manager Name', 'Account Manager Email', 'CSM Name', 'CSM Email',
  'Client Report Notes'
];

const HUB_SCALE_COLUMNS = ['Priority', 'Last Successful Run'];

// Appended onto older live Hubs when missing (Engine migrates in place).
const HUB_APPEND_COLUMNS = [
  {
    name: 'Keyword Waste Spend Threshold',
    background: '#E8EEF4',
    numberFormat: '$#,##0.00',
    width: 180,
    defaultValue: 50
  }
];

// Must match apps-script/create-body-shop-workbook.gs metrics header rows exactly.
const SPOKE_METRIC_HEADERS = {
  ACCOUNT: [
    'Date', 'Account Status', 'Budget Status', 'Expected Spend', 'Actual Spend',
    'Budget Pace %', 'Lead Status', 'Expected Leads', 'Google Ads Conversions',
    'Lead Pace %', 'Actual CPL', 'Target CPL', 'CPL Status', 'Active Alerts', 'Notes'
  ],
  SEARCH_CAMPAIGN: [
    'Date', 'Campaign ID', 'Campaign Name', 'Campaign Type', 'Google Status',
    'Monitor', 'Expected to Spend', 'Daily Budget', 'Spend', 'Impressions',
    'Clicks', 'CTR', 'Avg. CPC', 'Conversions', 'Conv. Rate', 'CPL',
    'Target CPL', 'CPL Status', 'Spend Status', 'Alert', 'Notes'
  ],
  SEARCH_KEYWORD: [
    'Date', 'Campaign ID', 'Campaign Name', 'Ad Group ID', 'Ad Group Name',
    'Keyword ID', 'Keyword Text', 'Match Type', 'Google Status', 'Monitor',
    'Spend', 'Impressions', 'Clicks', 'CTR', 'Avg. CPC', 'Conversions',
    'Conv. Rate', 'CPL', 'Target CPL', 'CPL Status', 'Alert', 'Notes'
  ],
  PMAX_CAMPAIGN: [
    'Date', 'Campaign ID', 'Campaign Name', 'Google Status', 'Monitor',
    'Expected to Spend', 'Daily Budget', 'Spend', 'Impressions', 'Clicks',
    'CTR', 'Avg. CPC', 'Conversions', 'Conv. Rate', 'CPL', 'Target CPL',
    'CPL Status', 'Spend Status', 'Alert', 'Notes'
  ],
  LOCATION: [
    'Week Ending', 'Campaign ID', 'Campaign Name', 'Location', 'Location Type',
    'Campaign Monitor', 'Spend', 'Impressions', 'Clicks', 'CTR', 'Conversions',
    'Conv. Rate', 'CPL', 'Target CPL', 'CPL Status', 'Alert', 'Action Status',
    'Notes'
  ],
  DEVICE: [
    'Week Ending', 'Campaign ID', 'Campaign Name', 'Device', 'Campaign Monitor',
    'Spend', 'Impressions', 'Clicks', 'CTR', 'Conversions', 'Conv. Rate',
    'CPL', 'Target CPL', 'CPL Status', 'Alert', 'Action Status', 'Notes'
  ]
};

function main() {
  const hub = openHubSpreadsheet_();
  ensureHubOutputSheets_(hub);
  ensureHubScaleColumns_(hub);
  ensureHubAppendColumns_(hub);
  ensureHubAlertsStatusColumn_(hub);
  const runContext = buildHubRunContext_(hub);

  console.log('Built by Shah Hub: ' + hub.getUrl());
  console.log(
      'Enabled: ' + runContext.enabledAccountIds.length +
      ', due today: ' + runContext.dueAccountIds.length +
      ', this wave: ' + runContext.batchAccountIds.length +
      ', remaining after wave: ' + runContext.remainingDueAfterBatch
  );
  console.log(
      'Wave account IDs: ' +
      (runContext.batchAccountIds.length
          ? runContext.batchAccountIds.join(', ')
          : '(none)')
  );

  if (!runContext.batchAccountIds.length) {
    writeDailyCycleCompleteRunLog_(hub, runContext);
    console.log('Daily due queue empty — DAILY_CYCLE_COMPLETE. Hub: ' + hub.getUrl());
    return;
  }

  try {
    PropertiesService.getScriptProperties().setProperty(
        'BBS_LAST_WAVE_IDS',
        JSON.stringify(runContext.batchAccountIds)
    );
  } catch (propError) {
    console.warn('Could not cache wave account IDs: ' + propError);
  }

  const selector = AdsManagerApp.accounts()
      .withIds(runContext.batchAccountIds)
      .withCondition("customer_client.status = 'ENABLED'")
      .withLimit(ENGINE_CONFIG.MAX_ACCOUNTS);

  selector.executeInParallel(
      'processHubSpokeAccount',
      'finishHubSpokeRun',
      JSON.stringify(runContext)
  );
}

function processHubSpokeAccount(sharedInput) {
  const startedAt = new Date();
  const shared = JSON.parse(sharedInput);
  const account = AdsApp.currentAccount();
  const accountId = normalizeCustomerId_(account.getCustomerId());
  const accountName = account.getName();
  const currency = account.getCurrencyCode();
  const timeZone = account.getTimeZone();
  const hubConfig = shared.accountConfigs[accountId] || null;

  if (!hubConfig) {
    return JSON.stringify({
      skipped: true,
      accountId: accountId,
      accountName: accountName,
      reason: 'Not present or not Enabled in Google Ads Hub Config'
    });
  }

  if (!isEnabledFlag_(hubConfig.enabled)) {
    return JSON.stringify({
      skipped: true,
      accountId: accountId,
      accountName: accountName,
      reason: 'Disabled in Google Ads Hub Config'
    });
  }

  if (!hubConfig.spokeSpreadsheetUrl) {
    return JSON.stringify({
      skipped: false,
      success: false,
      accountId: accountId,
      accountName: accountName,
      error: 'Missing Spoke Spreadsheet URL in Google Ads Hub Config',
      durationSeconds: Math.round((new Date() - startedAt) / 1000)
    });
  }

  try {
    const previewMode = isAdsPreviewMode_();
    if (previewMode) {
      console.log(
          'Preview mode: collecting Ads data and validating Hub/Spoke access, ' +
          'but NOT writing Sheets or sending email.'
      );
    }

    const spoke = SpreadsheetApp.openByUrl(hubConfig.spokeSpreadsheetUrl);
    if (!previewMode) {
      syncHubGoalsToSpokeConfig_(spoke, hubConfig);
    }

    const dates = buildAccountDates_(timeZone);
    const yesterday = getPerformance_(dates.yesterday, dates.yesterday);
    // Always MTD through yesterday in *yesterday's* month (not "today's" month).
    // On the 1st, yesterday is last month — elapsedDays===0 used to write $0 incorrectly.
    const monthToDate = getPerformance_(dates.mtdStart, dates.yesterday);
    const lastSevenDays = getPerformance_(dates.weekStart, dates.yesterday);

    const optimizationScore = getOptimizationScore_();
    const adsDeepLink = getAccountAdsDeepLinkIds_();
    const recommendationData = getRecommendationData_();
    const activeExperiments = getActiveExperimentCount_();
    const searchTermsAnalyzed = getSearchTermCount_(dates.weekStart, dates.yesterday);
    const budgetEstimate = getEnabledDailyBudgetEstimate_();
    const changeData = getChangeData_(
        dates.weekStart,
        dates.yesterday,
        ENGINE_CONFIG.MAX_CHANGE_EVENTS_PER_ACCOUNT
    );

    const settings = resolveAccountSettingsFromHub_(
        hubConfig,
        budgetEstimate,
        dates.daysInMonth
    );

    // Conversions since Hub Campaign Start Date (for 30-day money-back email strip).
    // Prefer this over calendar MTD when the guarantee window crosses months.
    let campaignStartToDate = null;
    const campaignStartYmd = normalizeSheetDateFlexible_(settings.campaignStartDate);
    if (campaignStartYmd) {
      if (campaignStartYmd > dates.yesterday) {
        campaignStartToDate = emptyPerformance_();
      } else {
        campaignStartToDate = getPerformance_(campaignStartYmd, dates.yesterday);
      }
    }

    const health = calculateHealth_({
      dates: dates,
      yesterday: yesterday,
      monthToDate: monthToDate,
      settings: settings,
      currency: currency,
      optimizationScore: optimizationScore,
      activeRecommendations: recommendationData.total,
      recommendationRiskCounts: recommendationData.riskCounts,
      activeExperiments: activeExperiments,
      changeData: changeData
    });

    const manualActions = emptyManualActions_();
    const weeklyCounts = mergeWeeklyCounts_(changeData.summary, manualActions);

    const internalSummary = buildInternalSummary_({
      accountName: accountName,
      clientName: settings.clientName,
      currency: currency,
      yesterday: yesterday,
      monthToDate: monthToDate,
      settings: settings,
      health: health,
      optimizationScore: optimizationScore,
      activeRecommendations: recommendationData.total,
      recommendationRiskCounts: recommendationData.riskCounts,
      activeExperiments: activeExperiments,
      changeData: changeData
    });

    const clientReport = buildClientReportContent_({
      accountName: accountName,
      clientName: settings.clientName,
      currency: currency,
      yesterday: yesterday,
      monthToDate: monthToDate,
      lastSevenDays: lastSevenDays,
      settings: settings,
      optimizationScore: optimizationScore,
      activeRecommendations: recommendationData.total,
      activeExperiments: activeExperiments,
      searchTermsAnalyzed: searchTermsAnalyzed,
      weeklyCounts: weeklyCounts,
      health: health,
      clientNotes: settings.clientNotes
    });
    const clientSummary = composeClientSummary_(clientReport);

    // Spoke formulas expect MTD Actual Spend / Conversions for the Date row.
    const accountNotes = buildSpokeAccountNotes_({
      health: health,
      optimizationScore: optimizationScore,
      recommendationData: recommendationData,
      changeData: changeData,
      activeExperiments: activeExperiments,
      searchTermsAnalyzed: searchTermsAnalyzed,
      internalSummary: internalSummary
    });

    let weeklyAlerts = [];
    const wasteAlerts = getKeywordWasteAlerts_(settings.keywordWasteSpendThreshold)
        .concat(getLocationWasteAlerts_());
    const adAlerts = getDisapprovedAdAlerts_();

    if (!previewMode) {
      upsertSpokeAccountMetricsRow_(spoke, {
        date: dates.yesterday,
        actualSpend: monthToDate.cost,
        conversions: monthToDate.conversions,
        notes: accountNotes,
        timeZone: timeZone
      });

      writeSearchAndPmaxDailyMetrics_(spoke, dates.yesterday, timeZone);
      if (shouldWriteWeeklySegments_(shared.managerDates.today)) {
        weeklyAlerts = writeWeeklySegmentMetrics_(
            spoke, dates.weekStart, dates.yesterday, timeZone) || [];
      }
      console.log(
          'Spoke metrics written for ' + accountName +
          ' (' + accountId + ') → ' + hubConfig.spokeSpreadsheetUrl
      );
    }

    const alerts = buildHubAlertsForAccount_({
      accountId: accountId,
      accountName: accountName,
      clientName: settings.clientName,
      currency: currency,
      yesterday: yesterday,
      monthToDate: monthToDate,
      settings: settings,
      health: health,
      hubConfig: hubConfig,
      wasteAlerts: wasteAlerts,
      adAlerts: adAlerts,
      weeklyAlerts: weeklyAlerts
    });

    return JSON.stringify({
      skipped: false,
      success: true,
      preview: previewMode,
      accountId: accountId,
      accountName: accountName,
      clientName: settings.clientName,
      managerEmail: settings.managerEmail,
      csmEmail: settings.csmEmail,
      managerName: settings.managerName,
      csmName: settings.csmName,
      currency: currency,
      timeZone: timeZone,
      dates: dates,
      yesterday: yesterday,
      monthToDate: monthToDate,
      campaignStartToDate: campaignStartToDate,
      lastSevenDays: lastSevenDays,
      settings: settings,
      optimizationScore: optimizationScore,
      recommendations: recommendationData,
      activeExperiments: activeExperiments,
      searchTermsAnalyzed: searchTermsAnalyzed,
      changeData: {
        summary: changeData.summary,
        events: [] // omit bulky event dump from parallel return
      },
      weeklyCounts: weeklyCounts,
      health: health,
      internalSummary: internalSummary,
      clientSummary: clientSummary,
      clientReport: clientReport,
      alerts: alerts,
      spokeUrl: hubConfig.spokeSpreadsheetUrl,
      adsOcid: adsDeepLink.ocid,
      durationSeconds: Math.round((new Date() - startedAt) / 1000)
    });
  } catch (error) {
    return JSON.stringify({
      skipped: false,
      success: false,
      accountId: accountId,
      accountName: accountName,
      managerEmail: hubConfig.managerEmail || '',
      error: error && error.stack ? error.stack : String(error),
      durationSeconds: Math.round((new Date() - startedAt) / 1000)
    });
  }
}

function finishHubSpokeRun(executionResults) {
  const hub = openHubSpreadsheet_();
  ensureHubOutputSheets_(hub);
  ensureHubScaleColumns_(hub);
  ensureHubAppendColumns_(hub);
  ensureHubAlertsStatusColumn_(hub);
  const previewMode = isAdsPreviewMode_();
  const now = new Date();
  const runDate = formatDate_(now, ENGINE_CONFIG.REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const runDateTime = formatDate_(now, ENGINE_CONFIG.REPORT_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');

  const parsed = [];
  const failures = [];
  let skippedCount = 0;
  const alertRows = [];
  const seenIds = {};

  for (let i = 0; i < executionResults.length; i++) {
    const execution = executionResults[i];
    try {
      const value = execution.getReturnValue();
      if (!value) {
        const missingId = normalizeCustomerId_(
            execution.getCustomerId ? execution.getCustomerId() : '');
        if (missingId) {
          seenIds[missingId] = true;
        }
        failures.push({
          accountId: missingId || '',
          accountName: '',
          error: 'No return value. Status: ' + execution.getStatus()
        });
        continue;
      }
      const result = JSON.parse(value);
      const resultId = normalizeCustomerId_(result.accountId || '');
      if (resultId) {
        seenIds[resultId] = true;
      }
      if (result.skipped) {
        skippedCount++;
      } else if (result.success) {
        parsed.push(result);
        if (!previewMode && !result.preview && result.alerts && result.alerts.length) {
          for (let a = 0; a < result.alerts.length; a++) {
            alertRows.push(result.alerts[a]);
          }
        }
      } else {
        failures.push(result);
        if (!previewMode) {
          const engineGuide = cloneNextStepGuide_(
              getAlertNextStepGuide_('ENGINE_FAILURE'));
          engineGuide.facts = String(result.error || 'Unknown failure');
          alertRows.push({
            'Alert Date Time': runDateTime,
            'Account ID': result.accountId || '',
            'Account Name': result.accountName || '',
            Status: HUB_ALERT_STATUS_NEEDS_ATTENTION,
            'Alert Type': 'ENGINE_FAILURE',
            Message: String(result.error || 'Unknown failure'),
            Resolved: 'No',
            NextStep: formatNextStepPlain_(engineGuide),
            NextStepGuide: engineGuide
          });
        }
      }
    } catch (error) {
      const catchId = normalizeCustomerId_(
          execution.getCustomerId ? execution.getCustomerId() : '');
      if (catchId) {
        seenIds[catchId] = true;
      }
      failures.push({
        accountId: catchId || '',
        accountName: '',
        error: String(error)
      });
    }
  }

  // Accounts selected for the wave but missing from executeInParallel results
  // (common when an MCC child is inaccessible / not ENABLED under the manager).
  const plannedIds = readCachedWaveAccountIds_();
  for (let p = 0; p < plannedIds.length; p++) {
    const plannedId = plannedIds[p];
    if (seenIds[plannedId]) {
      continue;
    }
    failures.push({
      accountId: plannedId,
      accountName: '',
      error:
          'Selected for this wave but Google Ads returned no parallel result. ' +
          'Confirm the account is ENABLED under this MCC and the Google Ads Hub Account ID matches.'
    });
    if (!previewMode) {
      const missingGuide = cloneNextStepGuide_(
          getAlertNextStepGuide_('ENGINE_FAILURE'));
      missingGuide.facts =
          'Account ' + plannedId +
          ' was in the wave but executeInParallel returned nothing for it.';
      alertRows.push({
        'Alert Date Time': runDateTime,
        'Account ID': plannedId,
        'Account Name': '',
        Status: HUB_ALERT_STATUS_NEEDS_ATTENTION,
        'Alert Type': 'ENGINE_FAILURE',
        Message: missingGuide.facts,
        Resolved: 'No',
        NextStep: formatNextStepPlain_(missingGuide),
        NextStepGuide: missingGuide
      });
    }
  }

  const status = failures.length === 0 ? 'SUCCESS' : (parsed.length > 0 ? 'PARTIAL' : 'FAILED');
  const waveSize = Math.max(executionResults.length, plannedIds.length);

  if (previewMode) {
    const progressPreview = measureHubDueProgress_(hub, runDate);
    const waveMessagePreview = buildWaveRunMessage_({
      failures: failures,
      skippedCount: skippedCount,
      waveSize: waveSize,
      succeeded: parsed.length,
      enabledCount: progressPreview.enabledCount,
      remainingDue: progressPreview.remainingDue
    });
    console.log(
        'Preview mode: skipped Hub Run Log / Alerts / Last Successful Run writes and email. ' +
        'Would have been Status=' + status + ' | ' + waveMessagePreview
    );
    console.log(
        'Built by Shah Hub-Spoke wave complete (PREVIEW)' +
        '. Success: ' + parsed.length +
        ', failed: ' + failures.length +
        ', skipped: ' + skippedCount +
        ', remaining due today: ' + progressPreview.remainingDue +
        '. Hub: ' + hub.getUrl()
    );
  } else {
    stampHubLastSuccessfulRuns_(
        hub,
        parsed.filter(function(result) {
          return !result.preview;
        }),
        runDate
    );

    // Measure AFTER stamping so remaining-due matches what operators see on Hub.
    const progress = measureHubDueProgress_(hub, runDate);
    const waveMessage = buildWaveRunMessage_({
      failures: failures,
      skippedCount: skippedCount,
      waveSize: waveSize,
      succeeded: parsed.length,
      enabledCount: progress.enabledCount,
      remainingDue: progress.remainingDue
    });

    appendHubObjectRows_(
        hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.RUN_LOG),
        HUB_RUN_LOG_HEADERS,
        [{
          'Run Date Time': runDateTime,
          Status: status,
          'Accounts Selected': waveSize,
          'Accounts Succeeded': parsed.length,
          'Accounts Failed': failures.length,
          'Hub Spreadsheet URL': hub.getUrl(),
          Message: waveMessage
        }]
    );

    if (alertRows.length > 0) {
      appendHubObjectRows_(
          hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.ALERTS),
          HUB_ALERTS_HEADERS,
          alertRows
      );
    }

    const liveResults = parsed.filter(function(result) {
      return !result.preview;
    }).concat(synthesizeFailureDigestResults_(failures));
    if (ENGINE_CONFIG.SEND_INTERNAL_EMAILS) {
      sendInternalEmails_(liveResults, runDate, {
        remainingDue: progress.remainingDue,
        enabledCount: progress.enabledCount
      });
    } else {
      console.log(
          'Status email not sent (SEND_INTERNAL_EMAILS is false). ' +
          'Remaining due: ' + progress.remainingDue
      );
    }

    for (let s = 0; s < parsed.length; s++) {
      console.log(
          'Succeeded: ' +
          (parsed[s].accountName || '') +
          ' (' + (parsed[s].accountId || '') + ')'
      );
    }
    console.log(
        'Built by Shah Hub-Spoke wave complete' +
        '. Success: ' + parsed.length +
        ', failed: ' + failures.length +
        ', skipped: ' + skippedCount +
        ', remaining due today: ' + progress.remainingDue +
        '. Hub: ' + hub.getUrl()
    );
  }

  for (let f = 0; f < failures.length; f++) {
    console.error(
        (failures[f].accountName || failures[f].accountId || 'Unknown account') +
        ': ' + failures[f].error
    );
  }
}

/**
 * Turn Engine failures into digest-shaped results so ENGINE_FAILURE shows in
 * the morning Account Status email (not only Google Ads Hub Alerts).
 */
function synthesizeFailureDigestResults_(failures) {
  const out = [];
  for (let i = 0; i < (failures || []).length; i++) {
    const failure = failures[i] || {};
    const engineGuide = cloneNextStepGuide_(
        getAlertNextStepGuide_('ENGINE_FAILURE'));
    engineGuide.facts = String(failure.error || 'Unknown failure');
    out.push({
      accountId: failure.accountId || '',
      accountName: failure.accountName || '',
      clientName: failure.clientName || failure.accountName || failure.accountId || '',
      managerEmail: failure.managerEmail || '',
      csmEmail: failure.csmEmail || '',
      csmName: failure.csmName || '',
      spokeUrl: failure.spokeUrl || '',
      health: { status: HUB_ALERT_STATUS_NEEDS_ATTENTION },
      alerts: [{
        'Account ID': failure.accountId || '',
        'Account Name': failure.accountName || '',
        Status: HUB_ALERT_STATUS_NEEDS_ATTENTION,
        'Alert Type': 'ENGINE_FAILURE',
        Message: String(failure.error || 'Unknown failure'),
        NextStep: formatNextStepPlain_(engineGuide),
        NextStepGuide: engineGuide,
        CsmName: failure.csmName || '',
        CsmEmail: failure.csmEmail || ''
      }]
    });
  }
  return out;
}


/* -------------------------------------------------------------------------- */
/* HUB + SPOKE I/O                                                            */
/* -------------------------------------------------------------------------- */

/**
 * True when the Ads Script UI is in Preview (not a live Run).
 * Preview should validate access/data without writing Sheets or emailing.
 */
function isAdsPreviewMode_() {
  try {
    return !!(AdsApp.getExecutionInfo &&
        AdsApp.getExecutionInfo().isPreview &&
        AdsApp.getExecutionInfo().isPreview());
  } catch (error) {
    return false;
  }
}

/**
 * Fail fast if Hub is missing Run Log / Alerts (Config is checked elsewhere).
 */
function ensureHubOutputSheets_(hub) {
  const missing = [];
  if (!hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.RUN_LOG)) {
    missing.push(ENGINE_CONFIG.HUB_SHEETS.RUN_LOG);
  }
  if (!hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.ALERTS)) {
    missing.push(ENGINE_CONFIG.HUB_SHEETS.ALERTS);
  }
  if (missing.length) {
    throw new Error(
        'Hub is missing required tab(s): ' + missing.join(', ') +
        '. Re-run create-hub-workbook.gs or restore the deleted sheets before running the Engine.'
    );
  }
}

function openHubSpreadsheet_() {
  const url = String(ENGINE_CONFIG.HUB_SPREADSHEET_URL || '').trim();
  if (!url) {
    throw new Error(
        'ENGINE_CONFIG.HUB_SPREADSHEET_URL is required. ' +
        'Paste the Google Ads Hub Sheet URL from create-hub-workbook.gs.'
    );
  }
  try {
    return SpreadsheetApp.openByUrl(url);
  } catch (error) {
    throw new Error('Unable to open Google Ads Hub spreadsheet: ' + error);
  }
}

function buildHubRunContext_(hub) {
  const now = new Date();
  const today = formatDate_(now, ENGINE_CONFIG.REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const yesterday = addDays_(today, -1);
  const weekStart = addDays_(yesterday, -6);
  const accountConfigs = readHubAccountConfigs_(hub);
  const enabledAccountIds = [];

  for (const id in accountConfigs) {
    if (!Object.prototype.hasOwnProperty.call(accountConfigs, id)) {
      continue;
    }
    if (isEnabledFlag_(accountConfigs[id].enabled)) {
      enabledAccountIds.push(id);
    }
  }

  const selection = selectDueAccountBatch_(accountConfigs, enabledAccountIds, today);

  return {
    hubUrl: hub.getUrl(),
    accountConfigs: accountConfigs,
    enabledAccountIds: enabledAccountIds,
    dueAccountIds: selection.dueAccountIds,
    batchAccountIds: selection.batchAccountIds,
    remainingDueAfterBatch: selection.remainingDueAfterBatch,
    managerDates: {
      today: today,
      yesterday: yesterday,
      weekStart: weekStart
    }
  };
}

/**
 * Append Priority + Last Successful Run when missing so older Hubs migrate in place.
 * docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md
 */
function ensureHubScaleColumns_(hub) {
  const sheet = hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.CONFIG);
  if (!sheet) {
    throw new Error('Hub is missing Config tab');
  }

  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headerRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const index = headerIndex_(headerRow);
  let nextCol = 0;
  for (let i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i] || '').trim()) {
      nextCol = i + 1;
    }
  }

  const dataRows = Math.max(200, sheet.getMaxRows() - 1);
  for (let c = 0; c < HUB_SCALE_COLUMNS.length; c++) {
    const name = HUB_SCALE_COLUMNS[c];
    if (index[name] !== undefined) {
      continue;
    }
    nextCol += 1;
    sheet.getRange(1, nextCol).setValue(name)
        .setBackground('#243B55')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setWrap(true);
    if (name === 'Priority') {
      sheet.getRange(2, nextCol, dataRows, 1)
          .setBackground('#F7F3E8')
          .setNumberFormat('0');
      sheet.setColumnWidth(nextCol, 90);
    } else if (name === 'Last Successful Run') {
      sheet.getRange(2, nextCol, dataRows, 1)
          .setBackground('#E6EEE9')
          .setNumberFormat('yyyy-mm-dd');
      sheet.setColumnWidth(nextCol, 140);
    }
    index[name] = nextCol - 1;
    console.log('Google Ads Hub Config: appended scale column "' + name + '"');
  }
}

/**
 * Append missing Google Ads Hub Config columns (thresholds, etc.) so older Hubs migrate
 * without regenerating the workbook.
 */
function ensureHubAppendColumns_(hub) {
  const sheet = hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.CONFIG);
  if (!sheet) {
    throw new Error('Hub is missing Config tab');
  }

  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headerRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const index = headerIndex_(headerRow);
  let nextCol = 0;
  for (let i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i] || '').trim()) {
      nextCol = i + 1;
    }
  }

  const lastDataRow = Math.max(2, sheet.getLastRow());
  const dataRows = Math.max(200, sheet.getMaxRows() - 1);
  for (let c = 0; c < HUB_APPEND_COLUMNS.length; c++) {
    const spec = HUB_APPEND_COLUMNS[c];
    if (index[spec.name] !== undefined) {
      continue;
    }
    nextCol += 1;
    sheet.getRange(1, nextCol).setValue(spec.name)
        .setBackground('#4A5568')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setWrap(true);
    const valueRange = sheet.getRange(2, nextCol, dataRows, 1);
    valueRange.setBackground(spec.background || '#F7F3E8');
    if (spec.numberFormat) {
      valueRange.setNumberFormat(spec.numberFormat);
    }
    if (spec.width) {
      sheet.setColumnWidth(nextCol, spec.width);
    }
    if (spec.defaultValue !== undefined && spec.defaultValue !== null) {
      const existingRows = Math.max(0, lastDataRow - 1);
      if (existingRows > 0) {
        const defaults = [];
        for (let r = 0; r < existingRows; r++) {
          defaults.push([spec.defaultValue]);
        }
        sheet.getRange(2, nextCol, existingRows, 1).setValues(defaults);
      }
    }
    index[spec.name] = nextCol - 1;
    console.log('Google Ads Hub Config: appended column "' + spec.name + '"');
  }
}

/**
 * Older Hubs used Alerts!Severity (Critical/Warning). Rename to Status and
 * keep writing a single Needs attention value going forward.
 */
function ensureHubAlertsStatusColumn_(hub) {
  const sheet = hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.ALERTS);
  if (!sheet) {
    return;
  }
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === 'Severity') {
      sheet.getRange(1, i + 1).setValue('Status');
      console.log('Google Ads Hub Alerts: renamed Severity column to Status');
      break;
    }
  }
}

/**
 * Pick ≤50 accounts for this wave. Forced ACCOUNT_IDS bypass the due filter.
 */
function selectDueAccountBatch_(accountConfigs, enabledAccountIds, todayYmd) {
  const maxPerRun = ENGINE_CONFIG.MAX_ACCOUNTS;
  const forcedIds = (ENGINE_CONFIG.ACCOUNT_IDS || [])
      .map(function(id) {
        return normalizeCustomerId_(id);
      })
      .filter(function(id) {
        return !!id;
      });

  if (forcedIds.length > 0) {
    const batch = [];
    for (let i = 0; i < forcedIds.length && batch.length < maxPerRun; i++) {
      const id = forcedIds[i];
      if (accountConfigs[id] && isEnabledFlag_(accountConfigs[id].enabled)) {
        batch.push(id);
      }
    }
    return {
      dueAccountIds: batch.slice(),
      batchAccountIds: batch,
      remainingDueAfterBatch: 0
    };
  }

  const due = [];
  for (let e = 0; e < enabledAccountIds.length; e++) {
    const id = enabledAccountIds[e];
    const cfg = accountConfigs[id];
    if (!cfg) {
      continue;
    }
    if (!ENGINE_CONFIG.AUTO_SHARD || isAccountDueToday_(cfg, todayYmd)) {
      due.push(id);
    }
  }

  due.sort(function(a, b) {
    const pa = Number(accountConfigs[a].priority) || 0;
    const pb = Number(accountConfigs[b].priority) || 0;
    if (pb !== pa) {
      return pb - pa;
    }
    return String(a).localeCompare(String(b));
  });

  const batch = due.slice(0, maxPerRun);
  return {
    dueAccountIds: due,
    batchAccountIds: batch,
    remainingDueAfterBatch: Math.max(0, due.length - batch.length)
  };
}

function isAccountDueToday_(hubConfig, todayYmd) {
  const last = normalizeSheetDateFlexible_(hubConfig.lastSuccessfulRun);
  return !last || last !== todayYmd;
}

function readCachedWaveAccountIds_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('BBS_LAST_WAVE_IDS');
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.length) {
      return [];
    }
    return parsed.map(function(id) {
      return normalizeCustomerId_(id);
    }).filter(function(id) {
      return !!id;
    });
  } catch (error) {
    console.warn('Could not read cached wave account IDs: ' + error);
    return [];
  }
}

function stampHubLastSuccessfulRuns_(hub, successResults, runDateYmd) {
  if (!successResults || !successResults.length) {
    return;
  }
  const sheet = hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.CONFIG);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return;
  }
  const index = headerIndex_(values[0]);
  const col = index['Last Successful Run'];
  if (col === undefined) {
    console.warn('Google Ads Hub Config missing Last Successful Run — cannot stamp successes');
    return;
  }

  const dateValue = Utilities.parseDate(
      runDateYmd, ENGINE_CONFIG.REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const successIds = {};
  for (let i = 0; i < successResults.length; i++) {
    const id = normalizeCustomerId_(successResults[i].accountId);
    if (id) {
      successIds[id] = true;
    }
  }

  for (let r = 1; r < values.length; r++) {
    const id = normalizeCustomerId_(values[r][index['Account ID']]);
    if (successIds[id]) {
      sheet.getRange(r + 1, col + 1)
          .setValue(dateValue)
          .setNumberFormat('yyyy-mm-dd')
          .setBackground('#E6EEE9');
    }
  }
  SpreadsheetApp.flush();
}

function measureHubDueProgress_(hub, todayYmd) {
  const accountConfigs = readHubAccountConfigs_(hub);
  let enabledCount = 0;
  let remainingDue = 0;
  for (const id in accountConfigs) {
    if (!Object.prototype.hasOwnProperty.call(accountConfigs, id)) {
      continue;
    }
    const cfg = accountConfigs[id];
    if (!isEnabledFlag_(cfg.enabled)) {
      continue;
    }
    enabledCount++;
    if (isAccountDueToday_(cfg, todayYmd)) {
      remainingDue++;
    }
  }
  return {
    enabledCount: enabledCount,
    remainingDue: remainingDue
  };
}

function writeDailyCycleCompleteRunLog_(hub, runContext) {
  if (isAdsPreviewMode_()) {
    console.log('Preview mode: skipped DAILY_CYCLE_COMPLETE Run Log write.');
    return;
  }
  const now = new Date();
  const runDateTime = formatDate_(now, ENGINE_CONFIG.REPORT_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  appendHubObjectRows_(
      hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.RUN_LOG),
      HUB_RUN_LOG_HEADERS,
      [{
        'Run Date Time': runDateTime,
        Status: 'DAILY_CYCLE_COMPLETE',
        'Accounts Selected': 0,
        'Accounts Succeeded': 0,
        'Accounts Failed': 0,
        'Hub Spreadsheet URL': hub.getUrl(),
        Message: 'No Enabled accounts due today. Enabled total: ' +
            ((runContext && runContext.enabledAccountIds) ?
                runContext.enabledAccountIds.length : 0) +
            '. Next calendar day resets the due queue.'
      }]
  );
}

function buildWaveRunMessage_(opts) {
  const parts = [];
  parts.push(
      'Wave ' + opts.succeeded + '/' + opts.waveSize +
      ' ok; enabled ' + opts.enabledCount +
      '; remaining due today ' + opts.remainingDue
  );
  if (opts.remainingDue === 0) {
    parts.push('DAILY_CYCLE_COMPLETE');
  }
  const base = buildRunMessage_(opts.failures, opts.skippedCount);
  if (base && base !== 'Run completed successfully') {
    parts.push(base);
  }
  return parts.join(' | ');
}

function readHubAccountConfigs_(hub) {
  const sheet = hub.getSheetByName(ENGINE_CONFIG.HUB_SHEETS.CONFIG);
  if (!sheet) {
    throw new Error('Hub is missing Config tab');
  }
  const values = sheet.getDataRange().getValues();
  const map = {};
  if (values.length < 2) {
    return map;
  }

  const index = headerIndex_(values[0]);
  // Name-based (not positional): fresh Hubs put Priority / Campaign Start Date /
  // Last Successful Run after Enabled; older Hubs may still have a different order.
  requireHeadersByName_(values[0], HUB_CONFIG_HEADERS, 'Google Ads Hub Config');

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const id = normalizeCustomerId_(row[index['Account ID']]);
    if (!id) {
      continue;
    }
    map[id] = {
      accountId: id,
      accountName: row[index['Account Name']] || '',
      enabled: row[index.Enabled],
      clientName: row[index['Client Name']] || '',
      spokeSpreadsheetUrl: String(row[index['Spoke Spreadsheet URL']] || '').trim(),
      timeZone: row[index['Time Zone']] || '',
      dailyBudget: row[index['Daily Budget']],
      monthlyBudget: row[index['Monthly Budget']],
      monthlyLeadGoal: row[index['Monthly Lead Goal']],
      targetCpl: row[index['Target CPL']],
      alertsEnabled: row[index['Alerts Enabled']],
      highCplMultiplier: row[index['High CPL Multiplier']],
      zeroConversionSpendAlert: row[index['Zero Conversion Spend Alert']],
      keywordWasteSpendThreshold: index['Keyword Waste Spend Threshold'] !== undefined
          ? row[index['Keyword Waste Spend Threshold']]
          : '',
      budgetPaceTolerance: row[index['Budget Pace Tolerance']],
      leadPaceTolerance: row[index['Lead Pace Tolerance']],
      alertBudgetOffPace: row[index['Alert: Budget Off Pace']],
      alertLeadsOffPace: row[index['Alert: Leads Off Pace']],
      alertHighCpl: row[index['Alert: High CPL']],
      alertSpendNoConversions: row[index['Alert: Spend No Conversions']],
      alertZeroSpend: row[index['Alert: Zero Spend']],
      alertUnconfigured: row[index['Alert: Unconfigured']],
      managerName: row[index['Account Manager Name']] || '',
      managerEmail: row[index['Account Manager Email']] || '',
      csmName: row[index['CSM Name']] || '',
      csmEmail: row[index['CSM Email']] || '',
      campaignStartDate: row[index['Campaign Start Date']] || '',
      clientNotes: row[index['Client Report Notes']] || '',
      priority: index.Priority !== undefined ? row[index.Priority] : 0,
      lastSuccessfulRun: index['Last Successful Run'] !== undefined
          ? row[index['Last Successful Run']]
          : '',
      configRowNumber: i + 1
    };
  }
  return map;
}

/**
 * Require every expected header name to exist (any column order).
 * Extra columns are allowed so older Hubs can keep appended scale columns.
 */
function requireHeadersByName_(actualHeaders, expectedHeaders, sheetLabel) {
  const index = headerIndex_(actualHeaders);
  const missing = [];
  for (let i = 0; i < expectedHeaders.length; i++) {
    if (index[expectedHeaders[i]] === undefined) {
      missing.push(expectedHeaders[i]);
    }
  }
  if (missing.length) {
    throw new Error(
        sheetLabel + ' missing required column(s): ' + missing.join(', ') +
        '. Refresh from the Apps Script generator, or add the missing headers.'
    );
  }
}

/**
 * Fail fast when a Spoke metrics header row does not exactly match the template.
 * Extra trailing blank header cells are ignored. Order matters for formulas.
 */
function requireExactHeaders_(actualHeaders, expectedHeaders, sheetLabel) {
  const actual = [];
  for (let i = 0; i < actualHeaders.length; i++) {
    const value = String(actualHeaders[i] || '').trim();
    if (value) {
      actual.push(value);
    }
  }
  if (actual.length !== expectedHeaders.length) {
    throw new Error(
        sheetLabel + ' header count mismatch. Expected ' +
        expectedHeaders.length + ' columns, found ' + actual.length +
        '. Refresh the workbook from the Apps Script generator, or update the Engine schema lock.'
    );
  }
  for (let i = 0; i < expectedHeaders.length; i++) {
    if (actual[i] !== expectedHeaders[i]) {
      throw new Error(
          sheetLabel + ' header mismatch at column ' + (i + 1) +
          '. Expected "' + expectedHeaders[i] + '", found "' + actual[i] + '".'
      );
    }
  }
}

function expectedHeadersForSpokeSheet_(sheetName) {
  const name = String(sheetName || '');
  if (name === ENGINE_CONFIG.SPOKE_SHEETS.ACCOUNT) {
    return SPOKE_METRIC_HEADERS.ACCOUNT;
  }
  if (name === ENGINE_CONFIG.SPOKE_SHEETS.SEARCH_CAMPAIGN) {
    return SPOKE_METRIC_HEADERS.SEARCH_CAMPAIGN;
  }
  if (name === ENGINE_CONFIG.SPOKE_SHEETS.SEARCH_KEYWORD) {
    return SPOKE_METRIC_HEADERS.SEARCH_KEYWORD;
  }
  if (name === ENGINE_CONFIG.SPOKE_SHEETS.PMAX_CAMPAIGN) {
    return SPOKE_METRIC_HEADERS.PMAX_CAMPAIGN;
  }
  if (name === ENGINE_CONFIG.SPOKE_SHEETS.LOCATION) {
    return SPOKE_METRIC_HEADERS.LOCATION;
  }
  if (name === ENGINE_CONFIG.SPOKE_SHEETS.DEVICE) {
    return SPOKE_METRIC_HEADERS.DEVICE;
  }
  return null;
}


function syncHubGoalsToSpokeConfig_(spoke, hubConfig) {
  const sheet = spoke.getSheetByName(ENGINE_CONFIG.SPOKE_SHEETS.CONFIG);
  if (!sheet) {
    throw new Error('Spoke is missing Config tab: ' + hubConfig.spokeSpreadsheetUrl);
  }

  // No script-wide LockService: each parallel worker writes a different spoke.
  // A global lock serializes waves and times out at 50-account scale (docs/Read this for the technical plan to scale past 50 accounts with one Hub and one Engine.md).
  const values = sheet.getDataRange().getValues();
  const keyToRow = {};
  for (let r = 0; r < values.length; r++) {
    const key = String(values[r][0] || '').trim();
    if (key) {
      keyToRow[key] = r + 1;
    }
  }

  const writes = {
    ACCOUNT_ID: hubConfig.accountId,
    ACCOUNT_NAME: hubConfig.accountName || '',
    ACCOUNT_MONITORING_ENABLED: isEnabledFlag_(hubConfig.enabled) ? 'Enabled' : 'Disabled',
    TIME_ZONE: String(hubConfig.timeZone || '').trim() || 'America/New_York',
    DAILY_BUDGET: positiveNumberOrZero_(hubConfig.dailyBudget) || '',
    MONTHLY_LEAD_GOAL: positiveNumberOrZero_(hubConfig.monthlyLeadGoal) || '',
    TARGET_CPL: positiveNumberOrZero_(hubConfig.targetCpl) || '',
    ALERTS_ENABLED: normalizeEnabledDisabled_(hubConfig.alertsEnabled, 'Enabled'),
    HIGH_CPL_MULTIPLIER: hubConfig.highCplMultiplier === '' ||
        hubConfig.highCplMultiplier === null || hubConfig.highCplMultiplier === undefined
        ? 1.5
        : Number(hubConfig.highCplMultiplier),
    ZERO_CONVERSION_SPEND_ALERT: positiveNumberOrZero_(
        hubConfig.zeroConversionSpendAlert) ||
        ENGINE_CONFIG.DEFAULT_ZERO_CONVERSION_SPEND_ALERT,
    BUDGET_PACE_TOLERANCE: toTolerance_(
        hubConfig.budgetPaceTolerance, ENGINE_CONFIG.DEFAULT_PACE_TOLERANCE),
    LEAD_PACE_TOLERANCE: toTolerance_(
        hubConfig.leadPaceTolerance, ENGINE_CONFIG.DEFAULT_PACE_TOLERANCE),
    ACCOUNT_MANAGER_NAME: hubConfig.managerName || '',
    ACCOUNT_MANAGER_EMAIL: hubConfig.managerEmail || '',
    ALERT_RECIPIENT_EMAILS: hubConfig.managerEmail || '',
    CSM_NAME: hubConfig.csmName || '',
    CSM_EMAIL: hubConfig.csmEmail || '',
    CAMPAIGN_START_DATE: hubConfig.campaignStartDate || ''
  };

  for (const key in writes) {
    if (!Object.prototype.hasOwnProperty.call(writes, key)) {
      continue;
    }
    const row = keyToRow[key];
    if (!row) {
      console.warn('Spoke Config missing key (skipped sync): ' + key);
      continue;
    }
    sheet.getRange(row, 2).setValue(writes[key]);
    if (key === 'ACCOUNT_ID') {
      sheet.getRange(row, 2).setNumberFormat('@');
    }
  }

  const sheetTz = String(hubConfig.timeZone || '').trim();
  if (sheetTz) {
    try {
      spoke.setSpreadsheetTimeZone(sheetTz);
    } catch (tzError) {
      console.warn('Could not set spoke spreadsheet time zone to ' + sheetTz + ': ' + tzError);
    }
  }
  SpreadsheetApp.flush();
}

function upsertSpokeAccountMetricsRow_(spoke, payload) {
  const sheet = spoke.getSheetByName(ENGINE_CONFIG.SPOKE_SHEETS.ACCOUNT);
  if (!sheet) {
    throw new Error('Spoke missing tab: Account Metrics (Daily)');
  }

  // Filters + sorted views break insert/write targeting on metrics tabs.
  clearSheetFilter_(sheet);

  const headerRow = 4;
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  requireExactHeaders_(
      headers,
      SPOKE_METRIC_HEADERS.ACCOUNT,
      ENGINE_CONFIG.SPOKE_SHEETS.ACCOUNT
  );
  const index = headerIndex_(headers);

  // headerIndex_ is 0-based; Sheets ranges are 1-based.
  const dateCol = index.Date + 1;
  const spendCol = index['Actual Spend'] + 1;
  const convCol = index['Google Ads Conversions'] + 1;
  const notesCol = index.Notes !== undefined ? index.Notes + 1 : null;
  const tz = payload.timeZone || ENGINE_CONFIG.REPORT_TIME_ZONE;

  // Reuse matching Date row, or insert under the header for a brand-new day.
  // Do NOT append after getLastRow() — formula prefill hides writes far below row 5.
  const targetRows = findOrAllocateMetricRows_(
      sheet, headerRow, dateCol, payload.date, 1, tz);
  const targetRow = targetRows[0];
  if (!targetRow) {
    throw new Error('Account Metrics (Daily): could not allocate a write row');
  }

  // Clear all same-date script cells first (including orphans), then write.
  clearMetricDateRows_(
      sheet, headerRow, dateCol, payload.date, headers.length, tz);

  const dateValue = Utilities.parseDate(payload.date, tz, 'yyyy-MM-dd');
  sheet.getRange(targetRow, dateCol).setValue(dateValue).setNumberFormat('m/d/yyyy');
  sheet.getRange(targetRow, spendCol).setValue(payload.actualSpend).setNumberFormat('$#,##0.00');
  sheet.getRange(targetRow, convCol).setValue(payload.conversions);
  if (notesCol) {
    const existingNotes = String(sheet.getRange(targetRow, notesCol).getValue() || '');
    const engineNotes = String(payload.notes || '');
    sheet.getRange(targetRow, notesCol).setValue(
        mergeNotesPreservingManualEdit_(existingNotes, engineNotes)
    );
  }
  SpreadsheetApp.flush();
  console.log(
      'Account Metrics row ' + targetRow +
      ' ← ' + payload.date +
      ' spend=' + payload.actualSpend +
      ' conv=' + payload.conversions
  );
}

function writeSearchAndPmaxDailyMetrics_(spoke, dateYmd, timeZone) {
  const searchRows = getCampaignMetricRows_('SEARCH', dateYmd);
  const pmaxRows = getCampaignMetricRows_('PERFORMANCE_MAX', dateYmd);
  replaceDailyMetricBlock_(
      spoke.getSheetByName(ENGINE_CONFIG.SPOKE_SHEETS.SEARCH_CAMPAIGN),
      dateYmd,
      searchRows,
      buildSearchCampaignScriptRow_,
      timeZone
  );
  replaceDailyMetricBlock_(
      spoke.getSheetByName(ENGINE_CONFIG.SPOKE_SHEETS.PMAX_CAMPAIGN),
      dateYmd,
      pmaxRows,
      buildPmaxCampaignScriptRow_,
      timeZone
  );

  const searchKw = getSearchKeywordMetricRows_(dateYmd);
  replaceDailyMetricBlock_(
      spoke.getSheetByName(ENGINE_CONFIG.SPOKE_SHEETS.SEARCH_KEYWORD),
      dateYmd,
      searchKw,
      buildSearchKeywordScriptRow_,
      timeZone
  );
}

function writeWeeklySegmentMetrics_(spoke, weekStart, weekEnd, timeZone) {
  const locationRows = getLocationMetricRows_(weekStart, weekEnd);
  const deviceRows = getDeviceMetricRows_(weekStart, weekEnd);
  replaceWeeklyMetricBlock_(
      spoke.getSheetByName(ENGINE_CONFIG.SPOKE_SHEETS.LOCATION),
      weekEnd,
      locationRows,
      buildLocationScriptRow_,
      timeZone
  );
  replaceWeeklyMetricBlock_(
      spoke.getSheetByName(ENGINE_CONFIG.SPOKE_SHEETS.DEVICE),
      weekEnd,
      deviceRows,
      buildDeviceScriptRow_,
      timeZone
  );
  return buildWeeklyThresholdAlerts30d_();
}

/**
 * Weekly device threshold checks on a 30-day lookback
 * (only called on weekly write day).
 * Device: CPA > $100 with conversions > 0.
 * Location waste runs every Engine day via getLocationWasteAlerts_ (not only weekly).
 */
function buildWeeklyThresholdAlerts30d_() {
  const alerts = [];
  const deviceCpaThreshold = 100;
  const end = formatDate_(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
  const start = addDays_(end, -29);
  const windowLabel = 'last 30 days (' + start + ' → ' + end + ')';
  const currency = AdsApp.currentAccount().getCurrencyCode();

  try {
    const query =
        'SELECT segments.device, metrics.cost_micros, metrics.conversions ' +
        'FROM customer ' +
        "WHERE segments.date BETWEEN '" + start + "' AND '" + end + "'";
    const byDevice = {};
    const iter = AdsApp.search(query);
    while (iter.hasNext()) {
      const row = iter.next();
      const device = row.segments ? row.segments.device : 'UNKNOWN';
      if (!byDevice[device]) {
        byDevice[device] = {spend: 0, conversions: 0};
      }
      byDevice[device].spend += microsToCurrency_(row.metrics.costMicros);
      byDevice[device].conversions += toNumber_(row.metrics.conversions);
    }
    for (const device in byDevice) {
      if (!Object.prototype.hasOwnProperty.call(byDevice, device)) {
        continue;
      }
      const bucket = byDevice[device];
      const cpa = safeDivide_(bucket.spend, bucket.conversions);
      if (bucket.conversions > 0 && cpa !== null && cpa > deviceCpaThreshold) {
        alerts.push({
          type: 'DEVICE_HIGH_CPA',
          message: 'Device ' + device + ' CPA ' + formatMoney_(cpa, currency) +
              ' is above $' + deviceCpaThreshold + ' (' + windowLabel + ').',
          nextStep: 'Review device performance before bid changes; meet Shah/Saad first.'
        });
      }
    }
  } catch (error) {
    console.warn('30-day device CPA scan unavailable: ' + error);
  }
  return alerts;
}

/** @deprecated kept name for clarity — weekly write now uses 30d scanner above */
function buildWeeklyThresholdAlerts_(locationRows, deviceRows, weekStart, weekEnd) {
  return buildWeeklyThresholdAlerts30d_();
}

function getKeywordWasteAlerts_(wasteSpendThreshold) {
  const alerts = [];
  const lookback = ENGINE_CONFIG.WASTE_LOOKBACK_DAYS || 14;
  const threshold = positiveNumberOrZero_(wasteSpendThreshold) ||
      ENGINE_CONFIG.WASTE_SPEND_THRESHOLD || 50;
  const end = formatDate_(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
  const start = addDays_(end, -(lookback - 1));
  try {
    const query =
        'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ' +
        'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ' +
        'ad_group_criterion.keyword.match_type, ' +
        'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ' +
        'FROM keyword_view ' +
        "WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' " +
        'AND metrics.conversions = 0 ' +
        'AND metrics.cost_micros >= ' + Math.round(threshold * 1000000) + ' ' +
        'ORDER BY metrics.cost_micros DESC ' +
        'LIMIT 25';
    const iter = AdsApp.search(query);
    while (iter.hasNext()) {
      const row = iter.next();
      const spend = microsToCurrency_(row.metrics.costMicros);
      const kw = row.adGroupCriterion && row.adGroupCriterion.keyword
          ? row.adGroupCriterion.keyword.text
          : '';
      alerts.push({
        type: 'WASTE_14D_KEYWORD',
        message: 'Keyword "' + kw + '" in ' + (row.campaign.name || 'campaign') +
            ' / ' + (row.adGroup.name || 'ad group') + ' spent ' +
            formatMoney_(spend, AdsApp.currentAccount().getCurrencyCode()) +
            ' with 0 conversions over the last ' + lookback + ' days' +
            ' (Google Ads Hub waste threshold ' +
            formatMoney_(threshold, AdsApp.currentAccount().getCurrencyCode()) +
            ').',
        nextStep: 'Review search terms and relevance; meet Shah/Saad before major pauses.'
      });
    }
  } catch (error) {
    console.warn('14-day keyword waste scan unavailable: ' + error);
  }

  try {
    const agQuery =
        'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ' +
        'metrics.cost_micros, metrics.conversions ' +
        'FROM ad_group ' +
        "WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' " +
        'AND metrics.conversions = 0 ' +
        'AND metrics.cost_micros >= ' + Math.round(threshold * 1000000) + ' ' +
        'ORDER BY metrics.cost_micros DESC ' +
        'LIMIT 15';
    const agIter = AdsApp.search(agQuery);
    while (agIter.hasNext()) {
      const row = agIter.next();
      const spend = microsToCurrency_(row.metrics.costMicros);
      alerts.push({
        type: 'WASTE_14D_AD_GROUP',
        message: 'Ad group "' + (row.adGroup.name || '') + '" in ' +
            (row.campaign.name || 'campaign') + ' spent ' +
            formatMoney_(spend, AdsApp.currentAccount().getCurrencyCode()) +
            ' with 0 conversions over the last ' + lookback + ' days' +
            ' (Google Ads Hub waste threshold ' +
            formatMoney_(threshold, AdsApp.currentAccount().getCurrencyCode()) +
            ').',
        nextStep: 'Review ad group relevance and landing pages; meet Shah/Saad before major pauses.'
      });
    }
  } catch (error) {
    console.warn('14-day ad group waste scan unavailable: ' + error);
  }
  return alerts;
}

/**
 * Locations (people physically there) with ≥20 clicks and zero conversions
 * over the last 30 days. Uses Google's most-specific geo (zip, city, metro,
 * region, county, etc.). LOCATION_WASTE → Google Ads Hub Alerts + status email every run.
 * Click/day rules are Engine defaults (not the Google Ads Hub keyword $ threshold).
 */
function getLocationWasteAlerts_() {
  const alerts = [];
  const lookback = Math.max(
      1, toNumber_(ENGINE_CONFIG.LOCATION_WASTE_LOOKBACK_DAYS) || 30);
  const minClicks = Math.max(
      1, toNumber_(ENGINE_CONFIG.LOCATION_WASTE_MIN_CLICKS) || 20);
  const end = formatDate_(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
  const start = addDays_(end, -(lookback - 1));
  const currency = AdsApp.currentAccount().getCurrencyCode();
  const candidates = collectLocationWasteCandidates_({
    start: start,
    end: end,
    minClicks: minClicks
  });

  if (!candidates.length) {
    return alerts;
  }

  const nameByRef = resolveGeoTargetNames_(candidates.map(function(c) {
    return c.locationRef;
  }));

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const resolved = nameByRef[normalizeGeoTargetRef_(item.locationRef)];
    const locationLabel = resolved
        ? formatGeoTargetDisplayLabel_(resolved.name, resolved.targetType)
        : formatGeoTargetFallbackLabel_(item.locationRef);
    alerts.push({
      type: 'LOCATION_WASTE',
      message: 'Location "' + locationLabel + '" (people in that location) in ' +
          item.campaignName + ' had ' +
          formatNumberText_(item.clicks) + ' clicks and 0 conversions over the last ' +
          lookback + ' days' +
          (item.spend > 0
              ? ' (spend ' + formatMoney_(item.spend, currency) + ')'
              : '') +
          '.',
      nextStep: 'Confirm service-area fit before excluding; meet Shah/Saad first.'
    });
  }
  return alerts;
}

/**
 * Pull waste candidates using most-specific geo first (zip/city/metro/…).
 * If that segment is unavailable, fall back to scanning each geo level separately.
 */
function collectLocationWasteCandidates_(opts) {
  const options = opts || {};
  const start = options.start;
  const end = options.end;
  const minClicks = options.minClicks;
  const whereBase =
      "WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' " +
      "AND geographic_view.location_type = 'LOCATION_OF_PRESENCE' " +
      'AND metrics.conversions = 0 ' +
      'AND metrics.clicks >= ' + minClicks + ' ';

  // Preferred: one row per most-specific location Google attributed.
  try {
    const query =
        'SELECT campaign.name, segments.geo_target_most_specific_location, ' +
        'metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions ' +
        'FROM geographic_view ' +
        whereBase +
        'ORDER BY metrics.clicks DESC ' +
        'LIMIT 25';
    const rows = runLocationWasteQuery_(query, 'geoTargetMostSpecificLocation');
    if (rows.length) {
      return rows;
    }
  } catch (error) {
    console.warn(
        'Most-specific location waste scan unavailable, falling back by geo level: ' +
        error);
  }

  // Fallback: union every common Google Ads geo segment type.
  const byKey = {};
  const levels = getGeographicWasteSegmentLevels_();
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    try {
      const query =
          'SELECT campaign.name, ' + level.gaqlField + ', ' +
          'metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions ' +
          'FROM geographic_view ' +
          whereBase +
          'ORDER BY metrics.clicks DESC ' +
          'LIMIT 15';
      const rows = runLocationWasteQuery_(query, level.scriptField);
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const key = row.campaignName + '|' + normalizeGeoTargetRef_(row.locationRef);
        if (!byKey[key] || row.clicks > byKey[key].clicks) {
          byKey[key] = row;
        }
      }
    } catch (levelError) {
      console.warn(
          'Location waste scan skipped for ' + level.label + ': ' + levelError);
    }
  }

  const merged = [];
  for (const key in byKey) {
    if (Object.prototype.hasOwnProperty.call(byKey, key)) {
      merged.push(byKey[key]);
    }
  }
  merged.sort(function(a, b) {
    return b.clicks - a.clicks;
  });
  return merged.slice(0, 25);
}

function getGeographicWasteSegmentLevels_() {
  // Covers the geo segment types Google Ads exposes on geographic_view.
  return [
    {label: 'Postal code', gaqlField: 'segments.geo_target_postal_code', scriptField: 'geoTargetPostalCode'},
    {label: 'City', gaqlField: 'segments.geo_target_city', scriptField: 'geoTargetCity'},
    {label: 'Metro', gaqlField: 'segments.geo_target_metro', scriptField: 'geoTargetMetro'},
    {label: 'County', gaqlField: 'segments.geo_target_county', scriptField: 'geoTargetCounty'},
    {label: 'Region', gaqlField: 'segments.geo_target_region', scriptField: 'geoTargetRegion'},
    {label: 'Province', gaqlField: 'segments.geo_target_province', scriptField: 'geoTargetProvince'},
    {label: 'State', gaqlField: 'segments.geo_target_state', scriptField: 'geoTargetState'},
    {label: 'District', gaqlField: 'segments.geo_target_district', scriptField: 'geoTargetDistrict'},
    {label: 'Canton', gaqlField: 'segments.geo_target_canton', scriptField: 'geoTargetCanton'},
    {label: 'Airport', gaqlField: 'segments.geo_target_airport', scriptField: 'geoTargetAirport'},
    {label: 'University', gaqlField: 'segments.geo_target_university', scriptField: 'geoTargetUniversity'}
  ];
}

function runLocationWasteQuery_(query, segmentScriptField) {
  const out = [];
  const iter = AdsApp.search(query);
  while (iter.hasNext()) {
    const row = iter.next();
    const locationRef = row.segments && row.segments[segmentScriptField]
        ? String(row.segments[segmentScriptField])
        : '';
    if (!locationRef) {
      continue;
    }
    out.push({
      campaignName: row.campaign.name || 'campaign',
      locationRef: locationRef,
      spend: microsToCurrency_(row.metrics.costMicros),
      clicks: toNumber_(row.metrics.clicks),
      impressions: toNumber_(row.metrics.impressions)
    });
  }
  return out;
}

function normalizeGeoTargetRef_(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (raw.indexOf('geoTargetConstants/') === 0) {
    return raw;
  }
  const id = extractGeoTargetId_(raw);
  return id ? ('geoTargetConstants/' + id) : raw;
}

function extractGeoTargetId_(value) {
  const match = String(value || '').match(/(\d+)\s*$/);
  return match ? match[1] : '';
}

function formatGeoTargetFallbackLabel_(value) {
  const id = extractGeoTargetId_(value);
  return id ? ('Location ID ' + id) : String(value || 'Unknown location');
}

function formatGeoTargetDisplayLabel_(name, targetType) {
  const label = String(name || '').trim() || 'Unknown location';
  const type = String(targetType || '').trim();
  if (!type) {
    return label;
  }
  // Postal codes often already look like "64111" — still show type for clarity.
  return label + ' (' + type + ')';
}

/**
 * Map geoTargetConstants/### → { name, targetType }.
 */
function resolveGeoTargetNames_(resourceNames) {
  const map = {};
  const ids = [];
  const seen = {};
  for (let i = 0; i < (resourceNames || []).length; i++) {
    const id = extractGeoTargetId_(resourceNames[i]);
    if (!id || seen[id]) {
      continue;
    }
    seen[id] = true;
    ids.push(id);
  }
  if (!ids.length) {
    return map;
  }

  const chunkSize = 25;
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunk = ids.slice(start, start + chunkSize);
    try {
      const query =
          'SELECT geo_target_constant.resource_name, geo_target_constant.name, ' +
          'geo_target_constant.canonical_name, geo_target_constant.target_type ' +
          'FROM geo_target_constant ' +
          'WHERE geo_target_constant.id IN (' + chunk.join(',') + ')';
      const iter = AdsApp.search(query);
      while (iter.hasNext()) {
        const row = iter.next();
        const resourceName = row.geoTargetConstant &&
            row.geoTargetConstant.resourceName
            ? String(row.geoTargetConstant.resourceName)
            : '';
        const key = normalizeGeoTargetRef_(resourceName);
        const name = (row.geoTargetConstant &&
            (row.geoTargetConstant.canonicalName || row.geoTargetConstant.name)) ||
            formatGeoTargetFallbackLabel_(resourceName);
        const targetType = row.geoTargetConstant && row.geoTargetConstant.targetType
            ? String(row.geoTargetConstant.targetType)
            : '';
        if (key) {
          map[key] = {
            name: String(name),
            targetType: targetType
          };
        }
      }
    } catch (error) {
      console.warn('Geo target name lookup unavailable: ' + error);
    }
  }
  return map;
}

function getDisapprovedAdAlerts_() {
  const alerts = [];
  try {
    const query =
        'SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ' +
        'ad_group_ad.ad.type, ad_group_ad.policy_summary.approval_status, ' +
        'ad_group_ad.policy_summary.review_status ' +
        'FROM ad_group_ad ' +
        "WHERE campaign.status = 'ENABLED' " +
        "AND ad_group.status = 'ENABLED' " +
        "AND ad_group_ad.status = 'ENABLED' " +
        "AND ad_group_ad.policy_summary.approval_status != 'APPROVED' " +
        'LIMIT 20';
    const iter = AdsApp.search(query);
    while (iter.hasNext()) {
      const row = iter.next();
      const approval = row.adGroupAd && row.adGroupAd.policySummary
          ? row.adGroupAd.policySummary.approvalStatus
          : 'UNKNOWN';
      alerts.push({
        type: 'AD_DISAPPROVED',
        message: 'Ad ' + (row.adGroupAd.ad.id || '') + ' in ' +
            (row.campaign.name || 'campaign') + ' / ' +
            (row.adGroup.name || 'ad group') + ' has approval status ' +
            approval + '.',
        nextStep: 'Review Policy Manager; correct, replace, or appeal the ad.'
      });
    }
  } catch (error) {
    console.warn('Disapproved ad scan unavailable: ' + error);
  }
  return alerts;
}


/* -------------------------------------------------------------------------- */
/* SETTINGS, HEALTH, ALERTS (Hub-aware)                                       */
/* -------------------------------------------------------------------------- */

function resolveAccountSettingsFromHub_(hubConfig, dailyBudgetEstimate, daysInMonth) {
  const configuredDailyBudget = positiveNumberOrZero_(hubConfig.dailyBudget);
  const configuredMonthlyBudget = positiveNumberOrZero_(hubConfig.monthlyBudget);
  const estimatedDailyBudget = positiveNumberOrZero_(dailyBudgetEstimate);

  const dailyBudget = configuredDailyBudget || estimatedDailyBudget;
  const calculatedMonthlyBudget = dailyBudget > 0
      ? dailyBudget * ENGINE_CONFIG.AVERAGE_DAYS_PER_MONTH
      : 0;

  return {
    clientName: hubConfig.clientName || '',
    dailyBudget: dailyBudget,
    dailyBudgetSource: configuredDailyBudget
        ? 'CONFIG'
        : (estimatedDailyBudget
            ? 'Estimated from enabled campaign budgets'
            : 'Not configured'),
    monthlyBudget: configuredMonthlyBudget || calculatedMonthlyBudget,
    budgetSource: configuredMonthlyBudget
        ? 'CONFIG'
        : (configuredDailyBudget
            ? 'Calculated from configured daily budget'
            : (estimatedDailyBudget
                ? 'Estimated from enabled campaign budgets'
                : 'Not configured')),
    monthlyLeadGoal: positiveNumberOrZero_(hubConfig.monthlyLeadGoal),
    targetCpl: positiveNumberOrZero_(hubConfig.targetCpl),
    managerEmail: hubConfig.managerEmail || '',
    csmEmail: hubConfig.csmEmail || '',
    csmName: hubConfig.csmName || '',
    managerName: hubConfig.managerName || '',
    campaignStartDate: hubConfig.campaignStartDate || '',
    clientNotes: hubConfig.clientNotes || '',
    budgetPaceTolerance: toTolerance_(
        hubConfig.budgetPaceTolerance, ENGINE_CONFIG.DEFAULT_PACE_TOLERANCE),
    leadPaceTolerance: toTolerance_(
        hubConfig.leadPaceTolerance, ENGINE_CONFIG.DEFAULT_PACE_TOLERANCE),
    zeroConversionSpendAlert: positiveNumberOrZero_(hubConfig.zeroConversionSpendAlert) ||
        ENGINE_CONFIG.DEFAULT_ZERO_CONVERSION_SPEND_ALERT,
    keywordWasteSpendThreshold: positiveNumberOrZero_(
        hubConfig.keywordWasteSpendThreshold) ||
        ENGINE_CONFIG.WASTE_SPEND_THRESHOLD,
    highCplMultiplier: toNumber_(hubConfig.highCplMultiplier) || 1.5,
    alertsEnabled: isEnabledFlag_(hubConfig.alertsEnabled),
    alertGates: {
      budgetOffPace: isEnabledFlag_(hubConfig.alertBudgetOffPace),
      leadsOffPace: isEnabledFlag_(hubConfig.alertLeadsOffPace),
      highCpl: isEnabledFlag_(hubConfig.alertHighCpl),
      spendNoConversions: isEnabledFlag_(hubConfig.alertSpendNoConversions),
      zeroSpend: isEnabledFlag_(hubConfig.alertZeroSpend),
      unconfigured: isEnabledFlag_(hubConfig.alertUnconfigured)
    }
  };
}

function calculateHealth_(input) {
  const dates = input.dates;
  const yesterday = input.yesterday;
  const mtd = input.monthToDate;
  const settings = input.settings;
  const elapsedFraction = dates.daysInMonth > 0
      ? dates.elapsedDays / dates.daysInMonth
      : 0;

  const expectedSpend = settings.monthlyBudget * elapsedFraction;
  const expectedLeads = settings.monthlyLeadGoal * elapsedFraction;
  const dailyBudgetUtilization = safeDivide_(yesterday.cost, settings.dailyBudget);
  const monthlyBudgetUsed = safeDivide_(mtd.cost, settings.monthlyBudget);
  const spendPace = safeDivide_(mtd.cost, expectedSpend);
  const leadPace = safeDivide_(mtd.conversions, expectedLeads);
  const cpl = safeDivide_(mtd.cost, mtd.conversions);

  const budgetTol = settings.budgetPaceTolerance || ENGINE_CONFIG.DEFAULT_PACE_TOLERANCE;
  const leadTol = settings.leadPaceTolerance || ENGINE_CONFIG.DEFAULT_PACE_TOLERANCE;

  const dailyBudgetStatus = dailyBudgetStatus_(
      dailyBudgetUtilization,
      settings.dailyBudget > 0
  );
  const spendPaceStatus = paceStatusWithTolerance_(
      spendPace, settings.monthlyBudget > 0, budgetTol);
  const leadPaceStatus = paceStatusWithTolerance_(
      leadPace, settings.monthlyLeadGoal > 0, leadTol);
  const cplStatus = cplStatusWithMultiplier_(
      cpl, settings.targetCpl, settings.highCplMultiplier || 1.5);

  const currency = input.currency || 'USD';
  const attention = [];
  let status = 'Healthy';

  if (settings.dailyBudgetSource === 'Not configured') {
    attention.push('Daily budget not configured on the Google Ads Hub');
  } else if (settings.dailyBudgetSource !== 'CONFIG') {
    attention.push(
        'Daily budget is estimated at ' +
        formatMoney_(settings.dailyBudget, currency) +
        ' (not set on the Google Ads Hub)'
    );
  }

  if (settings.budgetSource === 'Not configured') {
    attention.push('Monthly budget not configured on the Google Ads Hub');
  } else if (settings.budgetSource !== 'CONFIG') {
    attention.push(
        'Monthly budget is calculated/estimated at ' +
        formatMoney_(settings.monthlyBudget, currency) +
        ' (not set on the Google Ads Hub)'
    );
  }

  if (spendPaceStatus === 'Over pace' || spendPaceStatus === 'Under pace') {
    attention.push(
        'Monthly spend is ' + spendPaceStatus.toLowerCase() +
        ' — actual MTD ' + formatMoney_(mtd.cost, currency) +
        ' vs expected ' + formatMoney_(expectedSpend, currency) +
        ' by today (' + formatPercentText_(spendPace) + ' of pace)' +
        '; Google Ads Hub monthly budget ' + formatMoney_(settings.monthlyBudget, currency)
    );
    status = 'Watch';
  }

  const leadPaceExempt = isWithinLeadPaceGrace_(
      settings.campaignStartDate, dates.yesterday);
  if (!leadPaceExempt && leadPaceStatus === 'Under pace') {
    attention.push(
        'Lead volume is under pace — actual ' +
        formatNumberText_(mtd.conversions) +
        ' leads MTD vs expected ' +
        formatNumberText_(expectedLeads) +
        ' by today (' + formatPercentText_(leadPace) + ' of pace)' +
        '; Google Ads Hub monthly lead goal ' +
        formatNumberText_(settings.monthlyLeadGoal)
    );
    status = 'Watch';
  } else if (leadPaceExempt && leadPaceStatus === 'Under pace') {
    attention.push(
        'Lead pace under target (within ' +
        ENGINE_CONFIG.LEAD_PACE_GRACE_DAYS +
        '-day new-campaign grace) — actual ' +
        formatNumberText_(mtd.conversions) +
        ' leads MTD vs expected ' +
        formatNumberText_(expectedLeads) +
        ' by today; Google Ads Hub monthly lead goal ' +
        formatNumberText_(settings.monthlyLeadGoal)
    );
  }

  if (cplStatus === 'Above target') {
    attention.push(
        'CPL is above target — actual ' +
        formatMoneyOrDash_(cpl, currency) +
        ' vs Google Ads Hub Target CPL ' +
        formatMoney_(settings.targetCpl, currency) +
        ' (MTD ' + formatMoney_(mtd.cost, currency) + ' spend / ' +
        formatNumberText_(mtd.conversions) + ' conversions)'
    );
    status = 'Watch';
  }

  const zeroConversionThreshold = settings.zeroConversionSpendAlert ||
      ENGINE_CONFIG.DEFAULT_ZERO_CONVERSION_SPEND_ALERT;
  if (mtd.cost >= zeroConversionThreshold && mtd.conversions === 0) {
    attention.push(
        'Meaningful spend with zero primary conversions — MTD spend ' +
        formatMoney_(mtd.cost, currency) +
        ' with 0 conversions (alert threshold ' +
        formatMoney_(zeroConversionThreshold, currency) + ')'
    );
    status = 'Needs attention';
  }

  // Yesterday delivery / conversion signals (Notion problem checks).
  const noDeliveryYesterday = yesterday.cost <= 0 &&
      yesterday.impressions <= 0 &&
      yesterday.clicks <= 0;
  if (noDeliveryYesterday && settings.dailyBudget > 0) {
    attention.push(
        'No delivery yesterday — $0.00 spend, 0 impressions, 0 clicks' +
        ' (Google Ads Hub daily budget ' + formatMoney_(settings.dailyBudget, currency) + ')'
    );
    status = 'Needs attention';
  }
  if (yesterday.cost > 0 && yesterday.conversions === 0) {
    attention.push(
        'Zero conversions yesterday — spent ' +
        formatMoney_(yesterday.cost, currency) +
        ' on ' + formatNumberText_(yesterday.clicks) +
        ' clicks / ' + formatNumberText_(yesterday.impressions) +
        ' impressions with 0 conversions'
    );
    if (status === 'Healthy') {
      status = 'Watch';
    }
  }

  if (input.optimizationScore !== null && input.optimizationScore < 1) {
    attention.push(
        'Optimization Score is ' +
        formatPercentText_(input.optimizationScore)
    );
  }

  if (input.changeData.summary.error) {
    attention.push('Change history could not be retrieved');
    status = status === 'Healthy' ? 'Watch' : status;
  }

  return {
    status: status,
    dailyBudgetUtilization: dailyBudgetUtilization,
    dailyBudgetStatus: dailyBudgetStatus,
    monthlyBudgetUsed: monthlyBudgetUsed,
    expectedSpend: expectedSpend,
    expectedLeads: expectedLeads,
    spendPace: spendPace,
    leadPace: leadPace,
    actualCpl: cpl,
    spendPaceStatus: spendPaceStatus,
    leadPaceStatus: leadPaceStatus,
    leadPaceExempt: leadPaceExempt,
    cplStatus: cplStatus,
    noDeliveryYesterday: noDeliveryYesterday,
    zeroConversionsYesterday: yesterday.cost > 0 && yesterday.conversions === 0,
    attentionItems: attention
  };
}

function paceStatusWithTolerance_(pace, isConfigured, tolerance) {
  if (!isConfigured || pace === null) {
    return 'Not configured';
  }
  const tol = tolerance || ENGINE_CONFIG.DEFAULT_PACE_TOLERANCE;
  if (pace > 1 + tol) {
    return 'Over pace';
  }
  if (pace < 1 - tol) {
    return 'Under pace';
  }
  return 'On pace';
}

function cplStatusWithMultiplier_(cpl, targetCpl, multiplier) {
  if (!targetCpl) {
    return 'Not configured';
  }
  if (cpl === null) {
    return 'No conversions';
  }
  const mult = multiplier || 1.5;
  if (cpl > targetCpl * mult) {
    return 'Above target';
  }
  if (cpl < targetCpl * 0.90) {
    return 'Below target';
  }
  return 'Near target';
}

function buildSpokeAccountNotes_(input) {
  const parts = [];
  parts.push('Health: ' + input.health.status);
  if (input.health.attentionItems.length) {
    parts.push('Attention: ' + input.health.attentionItems.join('; '));
  }
  parts.push(
      'Opt score: ' +
      (input.optimizationScore === null
          ? 'n/a'
          : formatPercentText_(input.optimizationScore)) +
      '; recs: ' + input.recommendationData.total +
      ' (H' + input.recommendationData.riskCounts.HIGH +
      '/M' + input.recommendationData.riskCounts.MEDIUM +
      '/L' + input.recommendationData.riskCounts.LOW + ')'
  );
  parts.push(
      'Changes 24h/7d: ' +
      input.changeData.summary.last24Hours + '/' +
      input.changeData.summary.total +
      '; search terms 7d: ' + input.searchTermsAnalyzed +
      '; experiments: ' + input.activeExperiments
  );
  return parts.join(' | ');
}

function buildHubAlertsForAccount_(input) {
  const hubConfig = input.hubConfig;
  if (!isEnabledFlag_(hubConfig.alertsEnabled)) {
    return [];
  }

  const now = formatDate_(new Date(), ENGINE_CONFIG.REPORT_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  const rows = [];
  const health = input.health;
  const yesterday = input.yesterday || emptyPerformance_();
  const gates = {
    budget: isEnabledFlag_(hubConfig.alertBudgetOffPace),
    leads: isEnabledFlag_(hubConfig.alertLeadsOffPace),
    highCpl: isEnabledFlag_(hubConfig.alertHighCpl),
    spendNoConv: isEnabledFlag_(hubConfig.alertSpendNoConversions),
    zeroSpend: isEnabledFlag_(hubConfig.alertZeroSpend),
    unconfigured: isEnabledFlag_(hubConfig.alertUnconfigured)
  };

  function push(type, message, context) {
    const guide = cloneNextStepGuide_(
        getAlertNextStepGuide_(type, context || {}));
    if (context && context.facts) {
      guide.facts = context.facts;
    }
    rows.push({
      'Alert Date Time': now,
      'Account ID': input.accountId,
      'Account Name': input.accountName,
      Status: HUB_ALERT_STATUS_NEEDS_ATTENTION,
      'Alert Type': type,
      Message: message,
      Resolved: 'No',
      // Email-only enrichment (Hub sheet uses the columns above).
      NextStep: formatNextStepPlain_(guide),
      NextStepGuide: guide,
      ClientName: input.clientName || '',
      SpokeUrl: hubConfig.spokeSpreadsheetUrl || '',
      ManagerName: hubConfig.managerName || '',
      CsmName: hubConfig.csmName || '',
      CsmEmail: hubConfig.csmEmail || ''
    });
  }

  const currency = input.currency || 'USD';
  const settings = input.settings || {};
  const mtd = input.monthToDate || emptyPerformance_();
  const zeroConversionThreshold = settings.zeroConversionSpendAlert ||
      ENGINE_CONFIG.DEFAULT_ZERO_CONVERSION_SPEND_ALERT;

  if (gates.zeroSpend && health.noDeliveryYesterday) {
    const facts =
        'Yesterday: ' + formatMoney_(yesterday.cost, currency) +
        ' spend, ' + formatNumberText_(yesterday.impressions) +
        ' impressions, ' + formatNumberText_(yesterday.clicks) +
        ' clicks. Google Ads Hub daily budget: ' +
        formatMoney_(settings.dailyBudget, currency) + '.';
    push(
        'ZERO_SPEND',
        'No delivery yesterday — actual spend ' +
            formatMoney_(yesterday.cost, currency) +
            ', impressions ' + formatNumberText_(yesterday.impressions) +
            ', clicks ' + formatNumberText_(yesterday.clicks) +
            ' (Google Ads Hub daily budget ' +
            formatMoney_(settings.dailyBudget, currency) + ').',
        {facts: facts}
    );
  }

  if (gates.unconfigured &&
      (hasAttentionPrefix_(health.attentionItems, 'Daily budget not configured') ||
       hasAttentionPrefix_(health.attentionItems, 'Monthly budget not configured'))) {
    const facts =
        'Google Ads Hub Daily Budget: ' +
        (settings.dailyBudgetSource === 'CONFIG'
            ? formatMoney_(settings.dailyBudget, currency)
            : 'missing') +
        '. Google Ads Hub Monthly Budget: ' +
        (settings.budgetSource === 'CONFIG'
            ? formatMoney_(settings.monthlyBudget, currency)
            : 'missing') +
        '. Google Ads Hub Monthly Lead Goal: ' +
        (settings.monthlyLeadGoal
            ? formatNumberText_(settings.monthlyLeadGoal)
            : 'missing') +
        '. Google Ads Hub Target CPL: ' +
        (settings.targetCpl
            ? formatMoney_(settings.targetCpl, currency)
            : 'missing') + '.';
    push(
        'UNCONFIGURED',
        'Budget goals are missing or incomplete on the Google Ads Hub Config row. ' + facts,
        {facts: facts}
    );
  }

  if (gates.budget &&
      (health.spendPaceStatus === 'Over pace' || health.spendPaceStatus === 'Under pace')) {
    const facts =
        'Actual MTD spend: ' + formatMoney_(mtd.cost, currency) +
        '. Expected by today: ' + formatMoney_(health.expectedSpend, currency) +
        ' (' + formatPercentText_(health.spendPace) + ' of pace).' +
        ' Google Ads Hub monthly budget: ' + formatMoney_(settings.monthlyBudget, currency) +
        '. Google Ads Hub daily budget: ' + formatMoney_(settings.dailyBudget, currency) + '.';
    push(
        'BUDGET_OFF_PACE',
        'Monthly spend is ' + health.spendPaceStatus.toLowerCase() +
            ' — actual MTD ' + formatMoney_(mtd.cost, currency) +
            ' vs expected ' + formatMoney_(health.expectedSpend, currency) +
            ' by today (' + formatPercentText_(health.spendPace) +
            ' of pace); Google Ads Hub monthly budget ' +
            formatMoney_(settings.monthlyBudget, currency) + '.',
        {spendPaceStatus: health.spendPaceStatus, facts: facts}
    );
  }

  if (gates.leads &&
      health.leadPaceStatus === 'Under pace' &&
      !health.leadPaceExempt) {
    const facts =
        'Actual MTD leads: ' + formatNumberText_(mtd.conversions) +
        '. Expected by today: ' + formatNumberText_(health.expectedLeads) +
        ' (' + formatPercentText_(health.leadPace) + ' of pace).' +
        ' Google Ads Hub monthly lead goal: ' +
        formatNumberText_(settings.monthlyLeadGoal) + '.';
    push(
        'LEADS_OFF_PACE',
        'Lead volume is under pace — actual ' +
            formatNumberText_(mtd.conversions) +
            ' leads MTD vs expected ' +
            formatNumberText_(health.expectedLeads) +
            ' by today (' + formatPercentText_(health.leadPace) +
            ' of pace); Google Ads Hub monthly lead goal ' +
            formatNumberText_(settings.monthlyLeadGoal) + '.',
        {facts: facts}
    );
  }

  if (gates.highCpl && health.cplStatus === 'Above target') {
    const actualCpl = health.actualCpl !== undefined
        ? health.actualCpl
        : safeDivide_(mtd.cost, mtd.conversions);
    const facts =
        'Actual MTD CPL: ' + formatMoneyOrDash_(actualCpl, currency) +
        '. Google Ads Hub Target CPL: ' + formatMoney_(settings.targetCpl, currency) +
        '. From ' + formatMoney_(mtd.cost, currency) + ' spend / ' +
        formatNumberText_(mtd.conversions) + ' conversions.';
    push(
        'HIGH_CPL',
        'CPL is above target — actual ' +
            formatMoneyOrDash_(actualCpl, currency) +
            ' vs Google Ads Hub Target CPL ' +
            formatMoney_(settings.targetCpl, currency) +
            ' (MTD ' + formatMoney_(mtd.cost, currency) + ' / ' +
            formatNumberText_(mtd.conversions) + ' conversions).',
        {facts: facts}
    );
  }

  if (gates.spendNoConv &&
      hasAttentionPrefix_(health.attentionItems,
          'Meaningful spend with zero primary conversions')) {
    const facts =
        'MTD spend: ' + formatMoney_(mtd.cost, currency) +
        '. MTD conversions: 0. Alert threshold: ' +
        formatMoney_(zeroConversionThreshold, currency) + '.';
    push(
        'SPEND_NO_CONVERSIONS',
        'Meaningful MTD spend with zero primary conversions — spent ' +
            formatMoney_(mtd.cost, currency) +
            ' with 0 conversions (threshold ' +
            formatMoney_(zeroConversionThreshold, currency) + ').',
        {facts: facts}
    );
  }

  if (gates.spendNoConv && health.zeroConversionsYesterday) {
    const facts =
        'Yesterday spend: ' + formatMoney_(yesterday.cost, currency) +
        '. Clicks: ' + formatNumberText_(yesterday.clicks) +
        '. Impressions: ' + formatNumberText_(yesterday.impressions) +
        '. Conversions: 0.';
    push(
        'ZERO_CONVERSIONS_YESTERDAY',
        'Spent yesterday with zero conversions — ' +
            formatMoney_(yesterday.cost, currency) + ' spend, ' +
            formatNumberText_(yesterday.clicks) + ' clicks, ' +
            formatNumberText_(yesterday.impressions) +
            ' impressions, 0 conversions.',
        {facts: facts}
    );
  }

  const wasteAlerts = input.wasteAlerts || [];
  for (let w = 0; w < wasteAlerts.length; w++) {
    push(
        wasteAlerts[w].type || 'WASTE_14D',
        wasteAlerts[w].message,
        {facts: wasteAlerts[w].message}
    );
  }

  const adAlerts = input.adAlerts || [];
  for (let a = 0; a < adAlerts.length; a++) {
    push(
        adAlerts[a].type || 'AD_DISAPPROVED',
        adAlerts[a].message,
        {facts: adAlerts[a].message}
    );
  }

  const weeklyAlerts = input.weeklyAlerts || [];
  for (let q = 0; q < weeklyAlerts.length; q++) {
    push(
        weeklyAlerts[q].type || 'WEEKLY_SEGMENT',
        weeklyAlerts[q].message,
        {facts: weeklyAlerts[q].message}
    );
  }

  if (health.status === 'Needs attention' && rows.length === 0) {
    const facts = (health.attentionItems || []).join(' · ');
    push(
        'NEEDS_ATTENTION',
        facts || 'Needs attention',
        {facts: facts}
    );
  }
  return rows;
}

function hasAttentionPrefix_(attentionItems, prefix) {
  const items = attentionItems || [];
  for (let i = 0; i < items.length; i++) {
    if (String(items[i] || '').indexOf(prefix) === 0) {
      return true;
    }
  }
  return false;
}

function cloneNextStepGuide_(guide) {
  const source = guide || {};
  return {
    title: source.title || '',
    meaning: source.meaning || '',
    checks: (source.checks || []).slice(),
    remember: source.remember || '',
    facts: source.facts || ''
  };
}

/**
 * Plain-English next-step guides for Needs attention alerts (5th-grade reading level).
 * Returns {title, meaning, checks[], remember, facts?}.
 *
 * Covered Alert Types (must stay in sync with buildHubAlertsForAccount_ /
 * waste / weekly / ENGINE_FAILURE emitters):
 *   ZERO_SPEND
 *   ZERO_CONVERSIONS_YESTERDAY
 *   SPEND_NO_CONVERSIONS
 *   BUDGET_OFF_PACE          (over + under variants)
 *   LEADS_OFF_PACE
 *   HIGH_CPL
 *   UNCONFIGURED
 *   AD_DISAPPROVED
 *   WASTE_14D_KEYWORD
 *   WASTE_14D_AD_GROUP
 *   WASTE_14D                (generic waste fallback)
 *   LOCATION_WASTE
 *   DEVICE_HIGH_CPA
 *   WEEKLY_SEGMENT           (generic weekly fallback)
 *   ENGINE_FAILURE
 *   NEEDS_ATTENTION          (catch-all when health is red but no typed alert)
 * Unknown types → generic fallback (never empty Next step).
 */
function getAlertNextStepGuide_(alertType, context) {
  const type = String(alertType || '').toUpperCase();
  const ctx = context || {};
  const paceStatus = String(ctx.spendPaceStatus || '').toLowerCase();
  let underPace = false;
  if (paceStatus.indexOf('under') >= 0) {
    underPace = true;
  } else if (paceStatus.indexOf('over') >= 0) {
    underPace = false;
  } else {
    const paceHint = String(ctx.message || ctx.facts || '').toLowerCase();
    underPace = paceHint.indexOf('under') >= 0;
  }

  const guides = {
    ZERO_SPEND: {
      title: 'Ads did not run yesterday',
      meaning:
          'Google did not show ads for this shop yesterday, so nobody clicked and nothing was spent. ' +
          'That usually means something is paused, out of money, blocked, or not set up to show.',
      checks: [
          'Open Google Ads for this account (use the button below).',
          'Look at Campaigns. Are the main Search / Performance Max campaigns set to Enabled? If any say Paused, find out why and turn the right ones back on.',
          'Click into each active campaign and check Budgets. Is the daily budget above $0? Did the campaign hit a shared budget cap?',
          'Check Billing (Tools & settings → Billing). Is there a payment problem, failed card, or unpaid invoice?',
          'Open Notifications / Policy manager. Are there account holds, payment holds, or policy bans that stop ads?',
          'Check targeting: location (still covering the shop’s service area?), schedule (ads allowed to run yesterday?), and language.',
          'For Search: are keywords still Enabled? For Performance Max: are asset groups Enabled with enough assets?',
          'If everything looks on, check whether yesterday was a holiday/closure day or if the client asked to pause spend.'
      ],
      remember:
          'Fix the blocker first (billing, pause, policy). Then watch spend today to confirm ads are showing again. Tell the CSM if the shop asked for a pause.'
    },
    ZERO_CONVERSIONS_YESTERDAY: {
      title: 'Ads spent money but got zero leads yesterday',
      meaning:
          'People saw and/or clicked the ads, but Google did not count any phone calls or form leads yesterday. ' +
          'Either tracking broke, the landing page broke, or traffic was too weak/wrong.',
      checks: [
          'Open Google Ads → Goals / Conversions. Are the phone and form conversion actions still Enabled and recording recently?',
          'Click a few ads and open the landing page yourself on phone and desktop. Does the page load? Do the call button and form still work?',
          'Check CallRail (or the call tracker). Did any calls come in yesterday? If yes in CallRail but zero in Google Ads, the link between CallRail and Google Ads is broken.',
          'Check GoHighLevel / the form CRM. Did any form leads arrive? If yes in the CRM but zero in Google Ads, the form conversion tag or webhook is broken.',
          'In Google Ads, open search terms / insights for yesterday. Was traffic clearly irrelevant (wrong city, wrong intent)?',
          'Confirm the Google Ads Hub lists the correct Phone / Form conversion action names for this shop.',
          'Look at ad disapprovals or limited ads that may have sent weak traffic.'
      ],
      remember:
          'If tracking is broken, pause big budget changes until leads count again. If tracking is fine, improve relevance (keywords, ads, landing page) next.'
    },
    SPEND_NO_CONVERSIONS: {
      title: 'Spent a lot this month with no leads yet',
      meaning:
          'This shop has already spent enough money this month that we expect at least some leads, but Google still shows zero primary conversions. ' +
          'Treat this as urgent: either tracking is off or the funnel is not working.',
      checks: [
          'Compare Google Ads conversions to CallRail and GoHighLevel for the same month-to-date window. Do outside tools show leads that Google is missing?',
          'Re-check every primary conversion action (calls + forms). Make sure they are primary, Enabled, and not accidentally removed or set to secondary-only.',
          'Test the live landing page: call tracking number, form submit, thank-you page, and tag firing (Tag Assistant / CallRail test).',
          'Confirm Google Ads Hub phone/form conversion action names match what exists inside this Google Ads account.',
          'Review search terms and PMax insights: is spend going to junk queries or wrong cities?',
          'Check whether campaigns recently restarted, changed landing pages, or swapped conversion goals.',
          'If spend is high and tracking is proven broken, pause or sharply cut budget until tracking is fixed so we stop flying blind.'
      ],
      remember:
          'Do not “optimize keywords” first if conversions are not recording. Prove tracking works, then improve quality.'
    },
    BUDGET_OFF_PACE: underPace
        ? {
          title: 'Spend is behind where it should be this month',
          meaning:
              'Based on the Google Ads Hub monthly budget and today’s date, this shop should have spent more by now. ' +
              'Ads may be limited, under-budgeted, or not winning enough auctions.',
          checks: [
              'Open the Google Ads Hub Config row and confirm Monthly Budget / Daily Budget are still the agreed numbers.',
              'In Google Ads, check campaign daily budgets and shared budgets. Are they too low to hit the monthly plan?',
              'Look for “Limited by budget,” learning limits, or payment issues that slow delivery.',
              'Check location, schedule, and bid strategy. Did someone narrow targeting or lower bids?',
              'Review impression share / lost IS (budget) and lost IS (rank) if available.',
              'Make sure key campaigns are Enabled and not stuck in a long learning reset.',
              'If the client reduced spend on purpose, update the Google Ads Hub budgets so pacing matches reality.'
          ],
          remember:
              'If you raise budgets, do it in controlled steps and tell the CSM. Do not blindly 2x spend in one day.'
        }
        : {
          title: 'Spend is ahead of where it should be this month',
          meaning:
              'This shop is burning budget faster than the Google Ads Hub monthly plan for this point in the month. ' +
              'If nothing changes, it may run out of money early or overspend the agreement.',
          checks: [
              'Open Google Ads Hub Config and confirm the Monthly Budget is correct (sometimes the Google Ads Hub number is outdated).',
              'In Google Ads, lower daily budgets or shared budgets so the rest of the month is covered.',
              'Check for a recent bid strategy change, broad match expansion, or PMax spike that accelerated spend.',
              'Look at search terms / insights: is a wasteful theme driving the overspend?',
              'Confirm there is no duplicate campaign or unexpected Enabled campaign stacking spend.',
              'If overspend is already large, message the CSM and agree on a temporary daily cap today.'
          ],
          remember:
              'Fix the Google Ads Hub number if the plan changed. Otherwise slow delivery now so the month finishes evenly.'
        },
    LEADS_OFF_PACE: {
      title: 'Lead count is behind the monthly goal',
      meaning:
          'Based on the Google Ads Hub monthly lead goal and today’s date, this shop should have more leads by now. ' +
          'Something is limiting lead volume, lead quality tracking, or both.',
      checks: [
          'Confirm Google Ads Hub Monthly Lead Goal is still the real goal for this shop.',
          'Check conversion tracking first (CallRail + forms). Behind “leads” is sometimes just broken counting.',
          'Review yesterday and last-7-day search terms. Add negatives for junk; protect strong money terms.',
          'Check ad strength, landing page speed, and whether the offer/message still matches what people search.',
          'Look at impression share and budget limits — maybe the account cannot show enough to hit the goal.',
          'For PMax: review asset group strength, audience signals, and whether brand cannibalization is hiding true lead pace.',
          'If still behind after tracking is verified, schedule a short CSM meeting with a clear ask (budget, offer, or geo).'
      ],
      remember:
          'New campaigns get a short grace window. After that, behind pace needs a real plan, not hope.'
    },
    HIGH_CPL: {
      title: 'Cost per lead is too high',
      meaning:
          'Each counted lead is costing more than the Google Ads Hub Target CPL. ' +
          'We are paying too much for the leads we are getting, or counting weak leads.',
      checks: [
          'Confirm Target CPL on the Google Ads Hub is still what the shop agreed to.',
          'Split phone vs form CPL if possible. Which lead type is expensive?',
          'Open search terms. Pause or negative out expensive junk queries that rarely become real jobs.',
          'Review keyword match types and close variants that drag CPL up.',
          'Check ads and landing pages: clear offer, strong call button, form above the fold, correct city/service copy.',
          'Review location and schedule: late-night or out-of-area clicks often raise CPL.',
          'Check lead quality with the CSM/client. If Google “leads” are tire-kickers, fix messaging and targeting — not just bids.'
      ],
      remember:
          'Lower CPL by cutting waste and improving conversion rate first. Cutting budget alone does not fix a high CPL.'
    },
    UNCONFIGURED: {
      title: 'Google Ads Hub goals are missing for this shop',
      meaning:
          'The Google Ads Hub Config row is missing budget or lead goal numbers we need to judge pacing. ' +
          'Without those numbers, alerts and pacing can be wrong.',
      checks: [
          'Open the Google Ads Hub spreadsheet → Config tab.',
          'Find this account’s row.',
          'Fill Daily Budget (average daily media budget).',
          'Fill Monthly Budget (true monthly media budget).',
          'Fill Monthly Lead Goal and Target CPL.',
          'Save, then let the next Built by Shah Google Ads Script Engine run sync those goals into the spoke sheet.'
      ],
      remember:
          'Only edit goals on the Google Ads Hub — never maintain a second set of budgets on the spoke.'
    },
    AD_DISAPPROVED: {
      title: 'An ad is blocked by Google policy',
      meaning:
          'At least one ad is not fully approved, so it may not show (or may show in a limited way). ' +
          'That can kill delivery for a whole ad group or asset group.',
      checks: [
          'Open Google Ads → Campaigns → Ads (or Policy manager).',
          'Find the disapproved / limited ad named in this alert.',
          'Read the policy reason in plain language (misrepresentation, trademark, restricted service, etc.).',
          'Edit the ad text, URL, or assets to remove the problem. Or create a clean replacement ad and keep the old one paused.',
          'If you believe Google is wrong, use Appeal — but still launch a safe backup ad so delivery does not sit at zero.',
          'After fixing, confirm status moves to Eligible / Approved and that the ad group still has another strong ad running.'
      ],
      remember:
          'Never leave an ad group with only disapproved ads. Always have at least one approved ad live.'
    },
    WASTE_14D_KEYWORD: {
      title: 'A keyword spent money with no leads',
      meaning:
          'Over the last 14 days, this keyword spent past the Google Ads Hub Keyword Waste Spend Threshold ' +
          'and got zero conversions. It may be irrelevant, too broad, or sending bad traffic.',
      checks: [
          'Open the keyword from this alert and review its search terms for the same dates.',
          'Add negatives for clearly useless queries (jobs, DIY, wrong city, free, etc.).',
          'Check match type. If Broad is dumping junk, tighten to Phrase/Exact for the money terms.',
          'Confirm the landing page matches the keyword intent.',
          'If the keyword is off-offer for this body shop, pause it.',
          'Before pausing a big keyword, quick-check with Shah/Saad if it is a strategic brand/conquest term.'
      ],
      remember:
          'Fix search terms first. Pausing everything without negatives often just moves waste somewhere else.'
    },
    WASTE_14D_AD_GROUP: {
      title: 'An ad group spent money with no leads',
      meaning:
          'This whole ad group spent past the Google Ads Hub Keyword Waste Spend Threshold over 14 days with zero conversions. ' +
          'The theme, ads, or landing page may be wrong.',
      checks: [
          'Open the ad group and review search terms / keywords inside it.',
          'Check ads: are they approved, specific, and selling the right service?',
          'Click the landing page from the ad. Does it match the ad group theme?',
          'Look for one bad keyword driving most of the spend; fix or pause that first.',
          'If the whole theme is wrong for this shop, pause the ad group after a quick Shah/Saad check.'
      ],
      remember:
          'Prefer surgical fixes (one keyword, one negative list) over pausing a whole ad group when part of it still works.'
    },
    WASTE_14D: {
      title: 'Spend with no leads in the last 14 days',
      meaning:
          'Part of this account spent money for two weeks without conversions. Find the waste pocket and clean it up.',
      checks: [
          'Open the alert details and jump to the keyword or ad group named.',
          'Review search terms and add negatives.',
          'Confirm landing page and conversion tracking still work.',
          'Pause only after you know the traffic cannot become jobs for this shop.'
      ],
      remember:
          'Ask Shah/Saad before large pauses that change account structure.'
    },
    LOCATION_WASTE: {
      title: 'A location got clicks with no leads',
      meaning:
          'Over the last 30 days, people physically in this location (zip, city, metro, region, or other Google geo target) ' +
          'clicked at least 20 times and still got zero conversions. ' +
          'It may be outside the shop’s real service area, or the offer/page is weak for that geo.',
      checks: [
          'Confirm whether this location is inside the shop’s true service area with the CSM/client.',
          'In Google Ads → Locations, open the zip/city/metro from this alert and confirm Presence (not only Interest).',
          'If clearly out of area, plan an exclusion — but get Shah/Saad approval before excluding large geos.',
          'If in-area, check landing page/local messaging and call tracking for that geo instead of excluding.',
          'Compare nearby zips/cities to see if this is one bad pocket or a wider trend.'
      ],
      remember:
          'Do not mass-exclude locations without a human check. Wrong exclusions can wipe good coverage.'
    },
    DEVICE_HIGH_CPA: {
      title: 'One device type is too expensive',
      meaning:
          'On this device (mobile, desktop, or tablet), cost per lead is above our threshold. ' +
          'The page or bids may work badly on that device.',
      checks: [
          'Open the landing page on that device yourself. Is the call button easy? Is the form hard to use?',
          'Compare conversion rate by device for the last 30 days.',
          'Check if a device bid adjustment is already too aggressive.',
          'Fix the page/experience first when mobile is weak.',
          'Only change device bids after Shah/Saad review if the gap stays large.'
      ],
      remember:
          'A bad mobile page looks like a “bid problem.” Fix the page before cutting mobile hard.'
    },
    WEEKLY_SEGMENT: {
      title: 'A weekly location/device issue needs review',
      meaning:
          'The weekly scan found a location or device pocket that looks inefficient. Dig in before changing bids or exclusions.',
      checks: [
          'Open the spoke Location / Device weekly tabs for this shop.',
          'Confirm the numbers match what you see in Google Ads.',
          'Decide if this is a tracking issue, a page issue, or true poor geo/device performance.',
          'Get Shah/Saad approval before exclusions or big device bid changes.'
      ],
      remember:
          'Weekly segment changes are easy to overdo. Move carefully.'
    },
    ENGINE_FAILURE: {
      title: 'Built by Shah Google Ads Script Engine failed on this account',
      meaning:
          'The morning script could not finish updating this shop. The spoke sheet and alerts may be stale until it succeeds.',
      checks: [
          'Read the error message in Google Ads Hub → Alerts / Run Log.',
          'Confirm the Spoke Spreadsheet URL on the Google Ads Hub still opens and the Built by Shah Google Ads Script Engine has edit access.',
          'Confirm the account is still Enabled under the MCC and not canceled.',
          'Re-run the Built by Shah Google Ads Script Engine for this wave after fixing access/URL issues.',
          'If it keeps failing, paste the error to the tech owner before the next morning digest.'
      ],
      remember:
          'One failed account should not stop the whole batch — but this shop still needs a manual follow-up today.'
    },
    NEEDS_ATTENTION: {
      title: 'This shop needs a human look today',
      meaning:
          'The health checks flagged a problem even if a more specific alert type did not fire. Start with the spoke sheet, then Google Ads.',
      checks: [
          'Open the account sheet and read Account Metrics (Daily) → Active Alerts / notes.',
          'Compare yesterday spend, clicks, and conversions to a normal day for this shop.',
          'Open Google Ads Overview and scan Notifications, policy, and campaign status.',
          'Check CallRail / forms if conversions look wrong.',
          'Write what you found and the fix in the Google Ads Hub Alerts Resolved notes when done.'
      ],
      remember:
          'Use the Open Google Ads and Open account sheet buttons below so you do not hunt for links.'
    }
  };

  if (guides[type]) {
    return guides[type];
  }
  return {
    title: 'Review this account today',
    meaning:
        'Something needs a human check. Open the account, find what changed, and fix the root cause.',
    checks: [
        'Open Google Ads for this shop.',
        'Open the account sheet and read the latest metrics.',
        'Fix tracking, delivery, or waste based on what you find.',
        'Tell the CSM if the client needs an update.'
    ],
    remember: 'Mark the Google Ads Hub alert Resolved only after you actually handled it.'
  };
}

function formatNextStepPlain_(guide) {
  if (!guide) {
    return '';
  }
  const lines = [];
  if (guide.title) {
    lines.push(guide.title + '.');
  }
  if (guide.meaning) {
    lines.push(guide.meaning);
  }
  if (guide.facts) {
    lines.push('');
    lines.push('The numbers: ' + guide.facts);
  }
  lines.push('');
  lines.push('Check these things:');
  const checks = guide.checks || [];
  for (let i = 0; i < checks.length; i++) {
    lines.push((i + 1) + '. ' + checks[i]);
  }
  if (guide.remember) {
    lines.push('');
    lines.push('Remember: ' + guide.remember);
  }
  return lines.join('\n');
}

/**
 * Rehydrate next-step guides so email HTML always includes the checklist.
 * Parallel JSON returns can keep title/meaning but drop checks — never trust a
 * partial NextStepGuide alone. Never use <details>/<summary> (Gmail-unreliable).
 */
function hydrateNextStepGuide_(alertType, existingGuide, context) {
  const catalog = cloneNextStepGuide_(
      getAlertNextStepGuide_(alertType, context || {}));
  const existing = existingGuide || {};
  const existingChecks = existing.checks && existing.checks.length
      ? existing.checks.slice()
      : [];
  return {
    title: String(existing.title || catalog.title || 'What to do next'),
    meaning: String(existing.meaning || catalog.meaning || ''),
    checks: existingChecks.length ? existingChecks : (catalog.checks || []).slice(),
    remember: String(existing.remember || catalog.remember || ''),
    facts: String(
        existing.facts ||
        (context && context.facts) ||
        catalog.facts ||
        ''
    )
  };
}

/**
 * Always-visible Next step callout (title, meaning, numbers, checklist, remember).
 * No dropdown / <details> — every block is inline so Gmail cannot hide it.
 */
function buildNextStepBoxHtml_(guide, accentColor, borderColor) {
  if (!guide) {
    return '';
  }
  const accent = accentColor || '#b42318';
  const border = borderColor || accent;
  const checks = guide.checks || [];
  const items = [];
  for (let i = 0; i < checks.length; i++) {
    items.push(
        '<li style="margin:0 0 8px;padding:0;color:#344054;font-size:13px;' +
        'line-height:19px;">' +
          escapeHtml_(checks[i]) +
        '</li>'
    );
  }

  const title = guide.title ? String(guide.title) : 'What to do next';
  const meaning = guide.meaning ? String(guide.meaning) : '';

  let bodyHtml = '';
  if (guide.facts) {
    bodyHtml +=
        '<div style="margin:12px 0 12px;padding:12px 14px;background:#f8fafc;' +
        'border:1px solid #e4eaf0;border-radius:6px;font-size:13px;' +
        'line-height:19px;color:#172b4d;">' +
          '<strong style="color:' + accent + ';">The numbers:</strong> ' +
          escapeHtml_(guide.facts) +
        '</div>';
  } else {
    bodyHtml += '<div style="margin-top:12px;"></div>';
  }
  if (items.length) {
    bodyHtml +=
        '<div style="font-size:11px;line-height:15px;font-weight:700;color:#60758a;' +
        'letter-spacing:.5px;text-transform:uppercase;margin:0 0 8px;">' +
          'Check these things' +
        '</div>' +
        '<ol style="margin:0 0 0 18px;padding:0;">' + items.join('') + '</ol>';
  }
  if (guide.remember) {
    bodyHtml +=
        '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #eef2f6;' +
        'font-size:13px;line-height:19px;color:#667085;">' +
          '<strong style="color:' + accent + ';">Remember:</strong> ' +
          escapeHtml_(guide.remember) +
        '</div>';
  }

  return '' +
    '<div style="margin-top:12px;padding:16px 16px 14px;background:#ffffff;' +
    'border:1px dashed ' + border + ';border-radius:8px;">' +
      '<div style="font-size:10px;line-height:14px;letter-spacing:.9px;' +
      'text-transform:uppercase;color:' + accent + ';font-weight:800;' +
      'margin:0 0 6px;">' +
        'Next step' +
      '</div>' +
      '<div style="font-size:15px;line-height:21px;font-weight:700;color:#172b4d;' +
      'margin:0 0 ' + (meaning ? '6px' : '0') + ';">' +
        escapeHtml_(title) +
      '</div>' +
      (meaning
          ? '<div style="font-size:13px;line-height:19px;color:#475467;margin:0;">' +
            escapeHtml_(meaning) +
            '</div>'
          : '') +
      bodyHtml +
    '</div>';
}

function isWithinLeadPaceGrace_(campaignStartDate, asOfYmd) {
  const start = normalizeSheetDateFlexible_(campaignStartDate);
  if (!start || !asOfYmd) {
    return false;
  }
  const startMs = Date.parse(start + 'T12:00:00Z');
  const asOfMs = Date.parse(String(asOfYmd).substring(0, 10) + 'T12:00:00Z');
  if (!isFinite(startMs) || !isFinite(asOfMs)) {
    return false;
  }
  const daysActive = Math.floor((asOfMs - startMs) / 86400000) + 1;
  return daysActive > 0 && daysActive <= ENGINE_CONFIG.LEAD_PACE_GRACE_DAYS;
}

/**
 * First N calendar days from Hub Campaign Start Date (inclusive).
 * Day 1 = start date; guarantee ends on start + (N - 1) days.
 * Example: start Aug 1, N=30 → ends Aug 30.
 */
function getMoneyBackGuaranteeInfo_(campaignStartDate, asOfYmd) {
  const start = normalizeSheetDateFlexible_(campaignStartDate);
  const asOf = String(asOfYmd || '').substring(0, 10);
  const totalDays = toNumber_(ENGINE_CONFIG.MONEY_BACK_GUARANTEE_DAYS) || 30;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || totalDays < 1) {
    return null;
  }
  const startMs = Date.parse(start + 'T12:00:00Z');
  const asOfMs = Date.parse(asOf + 'T12:00:00Z');
  if (!isFinite(startMs) || !isFinite(asOfMs)) {
    return null;
  }
  const dayNumber = Math.floor((asOfMs - startMs) / 86400000) + 1;
  if (dayNumber < 1 || dayNumber > totalDays) {
    return null;
  }
  return {
    active: true,
    startYmd: start,
    endYmd: addDays_(start, totalDays - 1),
    dayNumber: dayNumber,
    totalDays: totalDays,
    daysRemaining: totalDays - dayNumber + 1
  };
}

function getCampaignStartDateFromResult_(result) {
  const row = result || {};
  if (row.settings && row.settings.campaignStartDate) {
    return row.settings.campaignStartDate;
  }
  return row.campaignStartDate || '';
}

function getGuaranteeAsOfFromResult_(result, fallbackYmd) {
  const row = result || {};
  if (row.dates && row.dates.today) {
    return row.dates.today;
  }
  return fallbackYmd || '';
}

function formatEmailShortDate_(yyyyMmDd) {
  const parts = String(yyyyMmDd || '').split('-');
  if (parts.length !== 3) {
    return String(yyyyMmDd || '');
  }
  const date = new Date(Date.UTC(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2]),
      12, 0, 0
  ));
  return Utilities.formatDate(date, 'UTC', 'MMM d, yyyy');
}

/** Countdown text for money-back banner (inclusive of today). */
function formatMoneyBackDaysLeftText_(info) {
  const daysLeft = info && info.daysRemaining != null
      ? toNumber_(info.daysRemaining)
      : 0;
  if (daysLeft <= 1) {
    return 'Last day';
  }
  return String(daysLeft) + ' days';
}

/**
 * Lead numbers for the money-back banner strip.
 * Target = Hub Monthly Lead Goal (no new Hub column).
 * Leads so far = conversions from Campaign Start Date through yesterday.
 * Needed so far = round((dayNumber / 30) * target).
 * Pace colors: &lt;100% red, 100–105% yellow, &gt;105% green.
 */
function buildMoneyBackLeadStatus_(info, result) {
  if (!info || !info.active || !result) {
    return null;
  }
  const settings = result.settings || {};
  const target = positiveNumberOrZero_(settings.monthlyLeadGoal);
  if (!target) {
    return null;
  }

  let leadsSoFar = null;
  if (result.campaignStartToDate &&
      result.campaignStartToDate.conversions !== undefined &&
      result.campaignStartToDate.conversions !== null) {
    leadsSoFar = toNumber_(result.campaignStartToDate.conversions);
  } else if (result.monthToDate && info.startYmd && result.dates &&
      result.dates.mtdStart && info.startYmd >= result.dates.mtdStart) {
    // Safe fallback only when start is inside the current MTD window.
    leadsSoFar = toNumber_(result.monthToDate.conversions);
  }
  if (leadsSoFar === null || !isFinite(leadsSoFar)) {
    return null;
  }

  const leadsNeededSoFar = Math.round(
      (info.dayNumber / info.totalDays) * target
  );
  const pace = leadsNeededSoFar > 0
      ? safeDivide_(leadsSoFar, leadsNeededSoFar)
      : null;

  let band = 'unknown';
  if (pace !== null && isFinite(pace)) {
    if (pace < 1) {
      band = 'behind';
    } else if (pace <= 1.05) {
      band = 'close';
    } else {
      band = 'onTrack';
    }
  }

  return {
    leadsSoFar: leadsSoFar,
    leadsNeededSoFar: leadsNeededSoFar,
    target: target,
    pace: pace,
    band: band
  };
}

function getMoneyBackLeadStatusStyle_(band) {
  if (band === 'behind') {
    return {
      boxBg: '#fef3f2',
      boxBorder: '#f04438',
      label: '#912018',
      value: '#7a271a',
      paceValue: '#b42318'
    };
  }
  if (band === 'close') {
    return {
      boxBg: '#fffaeb',
      boxBorder: '#f79009',
      label: '#b54708',
      value: '#7a4d00',
      paceValue: '#b54708'
    };
  }
  if (band === 'onTrack') {
    return {
      boxBg: '#ecfdf3',
      boxBorder: '#12b76a',
      label: '#087443',
      value: '#085d3a',
      paceValue: '#087443'
    };
  }
  return {
    boxBg: '#f8fafc',
    boxBorder: '#e4eaf0',
    label: '#667085',
    value: '#344054',
    paceValue: '#344054'
  };
}

function buildMoneyBackLeadStatusHtml_(info, result) {
  const status = buildMoneyBackLeadStatus_(info, result);
  if (!status) {
    return '';
  }
  const style = getMoneyBackLeadStatusStyle_(status.band);
  const paceText = status.pace === null || !isFinite(status.pace)
      ? '—'
      : (Math.round(status.pace * 100) + '%');

  return '' +
    '<div style="margin:10px 0 0;padding:10px 11px;background:' + style.boxBg +
    ';border:1px solid ' + style.boxBorder + ';border-left:4px solid ' +
    style.boxBorder + ';border-radius:6px;">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;">' +
        '<tr>' +
          '<td width="25%" valign="top" style="padding:0 5px 0 0;">' +
            '<div style="font-size:9px;line-height:12px;letter-spacing:.4px;' +
            'text-transform:uppercase;color:' + style.label +
            ';font-weight:700;">Leads so far</div>' +
            '<div style="font-size:15px;line-height:20px;font-weight:700;color:' +
            style.value + ';margin-top:1px;">' +
              escapeHtml_(formatNumberText_(status.leadsSoFar)) +
            '</div>' +
          '</td>' +
          '<td width="25%" valign="top" style="padding:0 5px;">' +
            '<div style="font-size:9px;line-height:12px;letter-spacing:.4px;' +
            'text-transform:uppercase;color:' + style.label +
            ';font-weight:700;">Leads needed so far</div>' +
            '<div style="font-size:15px;line-height:20px;font-weight:700;color:' +
            style.value + ';margin-top:1px;">' +
              escapeHtml_(formatNumberText_(status.leadsNeededSoFar)) +
            '</div>' +
          '</td>' +
          '<td width="25%" valign="top" style="padding:0 5px;">' +
            '<div style="font-size:9px;line-height:12px;letter-spacing:.4px;' +
            'text-transform:uppercase;color:' + style.label +
            ';font-weight:700;">Current lead pace</div>' +
            '<div style="font-size:15px;line-height:20px;font-weight:700;color:' +
            style.paceValue + ';margin-top:1px;">' +
              escapeHtml_(paceText) +
            '</div>' +
          '</td>' +
          '<td width="25%" valign="top" style="padding:0 0 0 5px;">' +
            '<div style="font-size:9px;line-height:12px;letter-spacing:.4px;' +
            'text-transform:uppercase;color:' + style.label +
            ';font-weight:700;">30-day lead target</div>' +
            '<div style="font-size:15px;line-height:20px;font-weight:700;color:' +
            style.value + ';margin-top:1px;">' +
              escapeHtml_(formatNumberText_(status.target)) +
            '</div>' +
          '</td>' +
        '</tr>' +
      '</table>' +
    '</div>';
}

function buildMoneyBackGuaranteeBadgeHtml_(info) {
  if (!info || !info.active) {
    return '';
  }
  return '' +
    '<div style="margin-top:6px;">' +
      '<span style="display:inline-block;background:#fff7ed;color:#9a3412;' +
      'font-size:10px;line-height:14px;font-weight:800;padding:4px 8px;' +
      'border-radius:999px;border:1px solid #fb923c;letter-spacing:.3px;' +
      'text-transform:uppercase;">' +
        'Day ' + escapeHtml_(String(info.dayNumber)) + ' of ' +
        escapeHtml_(String(info.totalDays)) + ' · money-back' +
      '</span>' +
    '</div>';
}

/**
 * Orange contractual callout for shops still inside the 30-day lead money-back window.
 * Same design for every shop in the window (no separate final-days treatment).
 * @param {Object} info from getMoneyBackGuaranteeInfo_
 * @param {string} tone 'healthy' | 'needsAttention' | 'watch'
 * @param {Object=} result account result (for lead strip numbers)
 */
function buildMoneyBackGuaranteeBannerHtml_(info, tone, result) {
  if (!info || !info.active) {
    return '';
  }
  const isHealthy = tone === 'healthy';
  const body = isHealthy
      ? ('KPIs look healthy today, but the client can still claim a refund if we miss ' +
          'the agreed lead target by the end of day ' + info.totalDays +
          '. Keep monitoring closely until the guarantee ends.')
      : ('If we miss the agreed lead target by the end of day ' + info.totalDays +
          ', the client can claim a refund. Treat every open issue on this shop as ' +
          'high priority until the guarantee ends.');

  return '' +
    '<div style="margin:0 0 14px;padding:14px 14px 13px;background:#fff7ed;' +
    'border:2px solid #ea580c;border-radius:8px;">' +
      '<div style="font-size:11px;line-height:15px;letter-spacing:.7px;' +
      'text-transform:uppercase;font-weight:800;color:#9a3412;">' +
        'First ' + escapeHtml_(String(info.totalDays)) +
        ' days — minimum lead money-back guarantee' +
      '</div>' +
      '<div style="font-size:14px;line-height:21px;font-weight:700;color:#7c2d12;' +
      'margin-top:5px;">' +
        'This shop is inside the ' + escapeHtml_(String(info.totalDays)) +
        '-day money-back guarantee window.' +
      '</div>' +
      '<div style="font-size:13px;line-height:19px;color:#9a3412;margin-top:6px;">' +
        escapeHtml_(body) +
      '</div>' +
      buildMoneyBackLeadStatusHtml_(info, result || {}) +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;margin-top:10px;">' +
        '<tr>' +
          '<td width="33%" valign="top" style="padding:0 8px 0 0;">' +
            '<div style="font-size:10px;line-height:14px;letter-spacing:.5px;' +
            'text-transform:uppercase;color:#c2410c;font-weight:700;">Campaign start</div>' +
            '<div style="font-size:14px;line-height:20px;font-weight:700;color:#7c2d12;' +
            'margin-top:2px;">' +
              escapeHtml_(formatEmailShortDate_(info.startYmd)) +
            '</div>' +
          '</td>' +
          '<td width="33%" valign="top" style="padding:0 8px;">' +
            '<div style="font-size:10px;line-height:14px;letter-spacing:.5px;' +
            'text-transform:uppercase;color:#c2410c;font-weight:700;">Guarantee ends</div>' +
            '<div style="font-size:14px;line-height:20px;font-weight:700;color:#7c2d12;' +
            'margin-top:2px;">' +
              escapeHtml_(formatEmailShortDate_(info.endYmd)) +
            '</div>' +
          '</td>' +
          '<td width="33%" valign="top" style="padding:0 0 0 8px;">' +
            '<div style="font-size:10px;line-height:14px;letter-spacing:.5px;' +
            'text-transform:uppercase;color:#c2410c;font-weight:700;">Days left</div>' +
            '<div style="font-size:14px;line-height:20px;font-weight:700;color:#7c2d12;' +
            'margin-top:2px;">' +
              escapeHtml_(formatMoneyBackDaysLeftText_(info)) +
            '</div>' +
          '</td>' +
        '</tr>' +
      '</table>' +
    '</div>';
}

function compareMoneyBackGuaranteeFirst_(resultA, resultB, asOfYmd) {
  const asOfA = getGuaranteeAsOfFromResult_(resultA, asOfYmd);
  const asOfB = getGuaranteeAsOfFromResult_(resultB, asOfYmd);
  const infoA = getMoneyBackGuaranteeInfo_(
      getCampaignStartDateFromResult_(resultA), asOfA);
  const infoB = getMoneyBackGuaranteeInfo_(
      getCampaignStartDateFromResult_(resultB), asOfB);
  const activeA = !!(infoA && infoA.active);
  const activeB = !!(infoB && infoB.active);
  if (activeA !== activeB) {
    return activeA ? -1 : 1;
  }
  if (activeA && activeB) {
    // Closest to guarantee end first (fewer days remaining = higher).
    if (infoA.daysRemaining !== infoB.daysRemaining) {
      return infoA.daysRemaining - infoB.daysRemaining;
    }
  }
  const labelA = String(
      (resultA && (resultA.clientName || resultA.accountName)) || '').toLowerCase();
  const labelB = String(
      (resultB && (resultB.clientName || resultB.accountName)) || '').toLowerCase();
  if (labelA < labelB) {
    return -1;
  }
  if (labelA > labelB) {
    return 1;
  }
  return 0;
}

function sortResultsMoneyBackGuaranteeFirst_(results, asOfYmd) {
  const list = (results || []).slice();
  list.sort(function(a, b) {
    return compareMoneyBackGuaranteeFirst_(a, b, asOfYmd);
  });
  return list;
}

/* -------------------------------------------------------------------------- */
/* GAQL → SPOKE METRIC WRITERS                                                */
/* -------------------------------------------------------------------------- */

function getCampaignMetricRows_(channelType, dateYmd) {
  const rows = [];
  try {
    const query =
        'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
        'campaign_budget.amount_micros, ' +
        'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ' +
        'FROM campaign ' +
        "WHERE segments.date = '" + dateYmd + "' " +
        "AND campaign.advertising_channel_type = '" + channelType + "' " +
        'AND metrics.impressions > 0';
    const iter = AdsApp.search(query);
    while (iter.hasNext()) {
      const row = iter.next();
      rows.push({
        date: dateYmd,
        campaignId: String(row.campaign.id),
        campaignName: row.campaign.name || '',
        channelType: row.campaign.advertisingChannelType || channelType,
        status: row.campaign.status || '',
        dailyBudget: microsToCurrency_(
            row.campaignBudget && row.campaignBudget.amountMicros),
        spend: microsToCurrency_(row.metrics.costMicros),
        impressions: toNumber_(row.metrics.impressions),
        clicks: toNumber_(row.metrics.clicks),
        conversions: toNumber_(row.metrics.conversions)
      });
    }
  } catch (error) {
    console.warn(channelType + ' campaign metrics unavailable: ' + error);
  }
  return rows;
}

function getSearchKeywordMetricRows_(dateYmd) {
  const rows = [];
  try {
    const query =
        'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ' +
        'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ' +
        'ad_group_criterion.keyword.match_type, ad_group_criterion.status, ' +
        'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ' +
        'FROM keyword_view ' +
        "WHERE segments.date = '" + dateYmd + "' " +
        'AND metrics.impressions > 0 ' +
        'ORDER BY metrics.cost_micros DESC ' +
        'LIMIT ' + ENGINE_CONFIG.MAX_KEYWORD_ROWS;
    const iter = AdsApp.search(query);
    while (iter.hasNext()) {
      const row = iter.next();
      const kw = row.adGroupCriterion && row.adGroupCriterion.keyword
          ? row.adGroupCriterion.keyword
          : {};
      rows.push({
        date: dateYmd,
        campaignId: String(row.campaign.id),
        campaignName: row.campaign.name || '',
        adGroupId: String(row.adGroup.id),
        adGroupName: row.adGroup.name || '',
        keywordId: String(row.adGroupCriterion.criterionId),
        keywordText: kw.text || '',
        matchType: kw.matchType || '',
        status: row.adGroupCriterion.status || '',
        spend: microsToCurrency_(row.metrics.costMicros),
        impressions: toNumber_(row.metrics.impressions),
        clicks: toNumber_(row.metrics.clicks),
        conversions: toNumber_(row.metrics.conversions)
      });
    }
  } catch (error) {
    console.warn('Search keyword metrics unavailable: ' + error);
  }
  return rows;
}

function getLocationMetricRows_(weekStart, weekEnd) {
  const rows = [];
  try {
    // Most-specific geo covers zip, city, metro, region, county, etc.
    const query =
        'SELECT campaign.id, campaign.name, ' +
        'segments.geo_target_most_specific_location, ' +
        'geographic_view.location_type, ' +
        'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ' +
        'FROM geographic_view ' +
        "WHERE segments.date BETWEEN '" + weekStart + "' AND '" + weekEnd + "' " +
        'AND metrics.impressions > 0';
    const rollup = {};
    const iter = AdsApp.search(query);
    while (iter.hasNext()) {
      const row = iter.next();
      const locationRef = row.segments && row.segments.geoTargetMostSpecificLocation
          ? String(row.segments.geoTargetMostSpecificLocation)
          : '';
      if (!locationRef) {
        continue;
      }
      const key = [
        row.campaign.id,
        normalizeGeoTargetRef_(locationRef),
        row.geographicView.locationType || ''
      ].join('|');
      if (!rollup[key]) {
        rollup[key] = {
          weekEnding: weekEnd,
          campaignId: String(row.campaign.id),
          campaignName: row.campaign.name || '',
          locationRef: locationRef,
          location: locationRef,
          locationType: row.geographicView.locationType || '',
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0
        };
      }
      rollup[key].spend += microsToCurrency_(row.metrics.costMicros);
      rollup[key].impressions += toNumber_(row.metrics.impressions);
      rollup[key].clicks += toNumber_(row.metrics.clicks);
      rollup[key].conversions += toNumber_(row.metrics.conversions);
    }

    const refs = [];
    for (const k in rollup) {
      if (Object.prototype.hasOwnProperty.call(rollup, k)) {
        refs.push(rollup[k].locationRef);
      }
    }
    const nameByRef = resolveGeoTargetNames_(refs);
    for (const k2 in rollup) {
      if (!Object.prototype.hasOwnProperty.call(rollup, k2)) {
        continue;
      }
      const item = rollup[k2];
      const resolved = nameByRef[normalizeGeoTargetRef_(item.locationRef)];
      item.location = resolved
          ? formatGeoTargetDisplayLabel_(resolved.name, resolved.targetType)
          : formatGeoTargetFallbackLabel_(item.locationRef);
      delete item.locationRef;
      rows.push(item);
    }
  } catch (error) {
    console.warn(
        'Most-specific location metrics unavailable, trying multi-level fallback: ' +
        error);
    return getLocationMetricRowsMultiLevelFallback_(weekStart, weekEnd);
  }
  return rows;
}

/**
 * Fallback weekly location metrics when most-specific segment is unavailable.
 * Unions postal code, city, metro, region, and other Google geo levels.
 */
function getLocationMetricRowsMultiLevelFallback_(weekStart, weekEnd) {
  const rows = [];
  const rollup = {};
  const levels = getGeographicWasteSegmentLevels_();
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    try {
      const query =
          'SELECT campaign.id, campaign.name, ' + level.gaqlField + ', ' +
          'geographic_view.location_type, ' +
          'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ' +
          'FROM geographic_view ' +
          "WHERE segments.date BETWEEN '" + weekStart + "' AND '" + weekEnd + "' " +
          'AND metrics.impressions > 0';
      const iter = AdsApp.search(query);
      while (iter.hasNext()) {
        const row = iter.next();
        const locationRef = row.segments && row.segments[level.scriptField]
            ? String(row.segments[level.scriptField])
            : '';
        if (!locationRef) {
          continue;
        }
        const key = [
          row.campaign.id,
          normalizeGeoTargetRef_(locationRef),
          row.geographicView.locationType || '',
          level.label
        ].join('|');
        if (!rollup[key]) {
          rollup[key] = {
            weekEnding: weekEnd,
            campaignId: String(row.campaign.id),
            campaignName: row.campaign.name || '',
            locationRef: locationRef,
            location: locationRef,
            locationType: (row.geographicView.locationType || '') +
                (level.label ? ' / ' + level.label : ''),
            spend: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0
          };
        }
        rollup[key].spend += microsToCurrency_(row.metrics.costMicros);
        rollup[key].impressions += toNumber_(row.metrics.impressions);
        rollup[key].clicks += toNumber_(row.metrics.clicks);
        rollup[key].conversions += toNumber_(row.metrics.conversions);
      }
    } catch (levelError) {
      console.warn(
          'Weekly location metrics skipped for ' + level.label + ': ' + levelError);
    }
  }

  const refs = [];
  for (const k in rollup) {
    if (Object.prototype.hasOwnProperty.call(rollup, k)) {
      refs.push(rollup[k].locationRef);
    }
  }
  const nameByRef = resolveGeoTargetNames_(refs);
  for (const k2 in rollup) {
    if (!Object.prototype.hasOwnProperty.call(rollup, k2)) {
      continue;
    }
    const item = rollup[k2];
    const resolved = nameByRef[normalizeGeoTargetRef_(item.locationRef)];
    item.location = resolved
        ? formatGeoTargetDisplayLabel_(resolved.name, resolved.targetType)
        : formatGeoTargetFallbackLabel_(item.locationRef);
    delete item.locationRef;
    rows.push(item);
  }
  return rows;
}

function getDeviceMetricRows_(weekStart, weekEnd) {
  const rows = [];
  try {
    const query =
        'SELECT campaign.id, campaign.name, segments.device, ' +
        'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ' +
        'FROM campaign ' +
        "WHERE segments.date BETWEEN '" + weekStart + "' AND '" + weekEnd + "' " +
        'AND metrics.impressions > 0';
    const rollup = {};
    const iter = AdsApp.search(query);
    while (iter.hasNext()) {
      const row = iter.next();
      const device = row.segments ? row.segments.device : 'UNKNOWN';
      const key = row.campaign.id + '|' + device;
      if (!rollup[key]) {
        rollup[key] = {
          weekEnding: weekEnd,
          campaignId: String(row.campaign.id),
          campaignName: row.campaign.name || '',
          device: String(device || 'UNKNOWN'),
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0
        };
      }
      rollup[key].spend += microsToCurrency_(row.metrics.costMicros);
      rollup[key].impressions += toNumber_(row.metrics.impressions);
      rollup[key].clicks += toNumber_(row.metrics.clicks);
      rollup[key].conversions += toNumber_(row.metrics.conversions);
    }
    for (const k in rollup) {
      if (Object.prototype.hasOwnProperty.call(rollup, k)) {
        rows.push(rollup[k]);
      }
    }
  } catch (error) {
    console.warn('Device metrics unavailable: ' + error);
  }
  return rows;
}

function buildSearchCampaignScriptRow_(item, headers) {
  // Script cols: A Date, C Name, D Type, E Status, H Daily Budget, I Spend,
  // J Impr, K Clicks, N Conversions, U Notes — others formula/ID
  return mapSparseRow_(headers, {
    'Date': item.date,
    'Campaign ID': item.campaignId,
    'Campaign Name': item.campaignName,
    'Campaign Type': item.channelType,
    'Google Status': item.status,
    'Daily Budget': item.dailyBudget,
    'Spend': item.spend,
    'Impressions': item.impressions,
    'Clicks': item.clicks,
    'Conversions': item.conversions,
    'Notes': ''
  });
}

function buildPmaxCampaignScriptRow_(item, headers) {
  return mapSparseRow_(headers, {
    'Date': item.date,
    'Campaign ID': item.campaignId,
    'Campaign Name': item.campaignName,
    'Google Status': item.status,
    'Daily Budget': item.dailyBudget,
    'Spend': item.spend,
    'Impressions': item.impressions,
    'Clicks': item.clicks,
    'Conversions': item.conversions,
    'Notes': ''
  });
}

function buildSearchKeywordScriptRow_(item, headers) {
  return mapSparseRow_(headers, {
    'Date': item.date,
    'Campaign ID': item.campaignId,
    'Campaign Name': item.campaignName,
    'Ad Group ID': item.adGroupId,
    'Ad Group Name': item.adGroupName,
    'Keyword ID': item.keywordId,
    'Keyword Text': item.keywordText,
    'Match Type': item.matchType,
    'Google Status': item.status,
    'Spend': item.spend,
    'Impressions': item.impressions,
    'Clicks': item.clicks,
    'Conversions': item.conversions,
    'Notes': ''
  });
}

function buildLocationScriptRow_(item, headers) {
  return mapSparseRow_(headers, {
    'Week Ending': item.weekEnding,
    'Campaign ID': item.campaignId,
    'Campaign Name': item.campaignName,
    'Location': item.location,
    'Location Type': item.locationType,
    'Spend': item.spend,
    'Impressions': item.impressions,
    'Clicks': item.clicks,
    'Conversions': item.conversions,
    'Notes': ''
  });
}

function buildDeviceScriptRow_(item, headers) {
  return mapSparseRow_(headers, {
    'Week Ending': item.weekEnding,
    'Campaign ID': item.campaignId,
    'Campaign Name': item.campaignName,
    'Device': item.device,
    'Spend': item.spend,
    'Impressions': item.impressions,
    'Clicks': item.clicks,
    'Conversions': item.conversions,
    'Notes': ''
  });
}

function mapSparseRow_(headers, valuesByHeader) {
  const row = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    row.push(Object.prototype.hasOwnProperty.call(valuesByHeader, h)
        ? valuesByHeader[h]
        : '');
  }
  return row;
}

function replaceDailyMetricBlock_(sheet, dateYmd, items, rowBuilder, timeZone) {
  if (!sheet) {
    return;
  }
  clearSheetFilter_(sheet);
  const tz = timeZone || ENGINE_CONFIG.REPORT_TIME_ZONE;
  const headerRow = 4;
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const expected = expectedHeadersForSpokeSheet_(sheet.getName());
  if (expected) {
    requireExactHeaders_(headers, expected, sheet.getName());
  }
  const dateCol = headerIndex_(headers).Date;
  if (dateCol === undefined) {
    console.warn('Sheet missing Date header: ' + sheet.getName());
    return;
  }

  // Never delete history rows — spoke templates pre-fill formulas. Same-day
  // values clear in place; brand-new dates insert under the header (newest on top).
  const targetRows = findOrAllocateMetricRows_(
      sheet, headerRow, dateCol + 1, dateYmd, items.length, tz);
  clearMetricDateRows_(sheet, headerRow, dateCol + 1, dateYmd, headers.length, tz);

  if (!items.length) {
    SpreadsheetApp.flush();
    return;
  }

  const built = items.map(function(item) {
    return rowBuilder(item, headers);
  });
  for (let r = 0; r < built.length; r++) {
    if (built[r][dateCol]) {
      built[r][dateCol] = Utilities.parseDate(
          String(built[r][dateCol]).substring(0, 10),
          tz,
          'yyyy-MM-dd'
      );
    }
    // Write only non-empty cells so formulas in other columns stay intact.
    writeSparseMetricRow_(sheet, targetRows[r], headers, built[r]);
  }
  // Self-heal: insertRowsAfter(header) inherits dark header formatting.
  // Always re-apply pastel body colors + number formats on rows we just wrote.
  applySpokeMetricPresentationToRows_(sheet, headerRow, targetRows);
  reanchorSpokeMetricConditionalFormats_(sheet, headerRow);
  SpreadsheetApp.flush();
}

function replaceWeeklyMetricBlock_(sheet, weekEnding, items, rowBuilder, timeZone) {
  if (!sheet) {
    return;
  }
  clearSheetFilter_(sheet);
  const tz = timeZone || ENGINE_CONFIG.REPORT_TIME_ZONE;
  const headerRow = 4;
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const expected = expectedHeadersForSpokeSheet_(sheet.getName());
  if (expected) {
    requireExactHeaders_(headers, expected, sheet.getName());
  }
  const weekCol = headerIndex_(headers)['Week Ending'];
  if (weekCol === undefined) {
    console.warn('Sheet missing Week Ending header: ' + sheet.getName());
    return;
  }

  const targetRows = findOrAllocateMetricRows_(
      sheet, headerRow, weekCol + 1, weekEnding, items.length, tz);
  clearMetricDateRows_(sheet, headerRow, weekCol + 1, weekEnding, headers.length, tz);

  if (!items.length) {
    SpreadsheetApp.flush();
    return;
  }

  const built = items.map(function(item) {
    return rowBuilder(item, headers);
  });
  for (let r = 0; r < built.length; r++) {
    if (built[r][weekCol]) {
      built[r][weekCol] = Utilities.parseDate(
          String(built[r][weekCol]).substring(0, 10),
          tz,
          'yyyy-MM-dd'
      );
    }
    writeSparseMetricRow_(sheet, targetRows[r], headers, built[r]);
  }
  applySpokeMetricPresentationToRows_(sheet, headerRow, targetRows);
  reanchorSpokeMetricConditionalFormats_(sheet, headerRow);
  SpreadsheetApp.flush();
}

/**
 * Re-anchor conditional formatting after inserting rows under the header.
 *
 * insertRowsAfter(headerRow) pushes existing conditional-format ranges DOWN
 * instead of growing them, so a range that covered rows 5-104 becomes 6-105 and
 * the newest row falls outside every rule. That is why Budget Status, Budget
 * Pace %, Lead Status, Lead Pace %, and CPL Status stop showing green/yellow/red
 * on recent rows while older template rows still color correctly.
 *
 * Stretch every data-row range back to the first data row and over the whole
 * used block. Rule conditions and colors are preserved.
 */
function reanchorSpokeMetricConditionalFormats_(sheet, headerRow) {
  if (!sheet) {
    return;
  }
  let rules;
  try {
    rules = sheet.getConditionalFormatRules() || [];
  } catch (e) {
    return;
  }
  if (!rules.length) {
    return;
  }
  const firstDataRow = headerRow + 1;
  const lastRow = Math.max(firstDataRow, sheet.getLastRow());
  const numRows = lastRow - headerRow;
  const rebuilt = [];
  let changed = false;

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const ranges = rule.getRanges() || [];
    const nextRanges = [];
    for (let r = 0; r < ranges.length; r++) {
      const range = ranges[r];
      // Leave title/header/legend rules alone.
      if (range.getRow() <= headerRow) {
        nextRanges.push(range);
        continue;
      }
      if (range.getRow() === firstDataRow && range.getNumRows() >= numRows) {
        nextRanges.push(range);
        continue;
      }
      nextRanges.push(
          sheet.getRange(firstDataRow, range.getColumn(), numRows, range.getNumColumns())
      );
      changed = true;
    }
    rebuilt.push(rule.copy().setRanges(nextRanges).build());
  }

  if (changed) {
    sheet.setConditionalFormatRules(rebuilt);
  }
}


function ensureSheetRows_(sheet, requiredLastRow) {
  if (requiredLastRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
  }
}


function findOrAllocateMetricRows_(sheet, headerRow, dateCol1Based, ymd, count, timeZone) {
  if (count <= 0) {
    return [];
  }

  const scanLast = Math.max(sheet.getLastRow(), headerRow + 500);
  ensureSheetRows_(sheet, scanLast);

  const values = sheet.getRange(headerRow + 1, dateCol1Based, scanLast - headerRow, 1).getValues();
  const matching = [];
  const empty = [];
  for (let i = 0; i < values.length; i++) {
    const cell = normalizeSheetDateFlexible_(values[i][0], timeZone);
    const row = headerRow + 1 + i;
    if (cell === ymd) {
      matching.push(row);
    } else if (!cell) {
      empty.push(row);
    }
  }

  // Same day / week already present: update those rows in place.
  if (matching.length > 0) {
    const preferEmptyFirst = empty.length > 0 && empty[0] < matching[0];
    const targets = [];
    let remaining = count;
    if (!preferEmptyFirst) {
      for (let m = 0; m < matching.length && remaining > 0; m++) {
        targets.push(matching[m]);
        remaining--;
      }
    }
    for (let e = 0; e < empty.length && remaining > 0; e++) {
      targets.push(empty[e]);
      remaining--;
    }
    if (preferEmptyFirst) {
      for (let m = 0; m < matching.length && remaining > 0; m++) {
        targets.push(matching[m]);
        remaining--;
      }
    }
    let nextAppend = Math.max(scanLast, sheet.getLastRow()) + 1;
    while (remaining > 0) {
      ensureSheetRows_(sheet, nextAppend);
      targets.push(nextAppend);
      nextAppend++;
      remaining--;
    }
    return targets;
  }

  // Brand-new date/week: keep the newest block directly under the header.
  const firstDataRow = headerRow + 1;
  const topContiguousEmpty = [];
  if (empty.length > 0 && empty[0] === firstDataRow) {
    for (let e = 0; e < empty.length; e++) {
      if (empty[e] !== firstDataRow + e) {
        break;
      }
      topContiguousEmpty.push(empty[e]);
    }
  }

  if (topContiguousEmpty.length >= count) {
    return topContiguousEmpty.slice(0, count);
  }

  insertMetricRowsAtTop_(sheet, headerRow, count);
  const targets = [];
  for (let i = 0; i < count; i++) {
    targets.push(headerRow + 1 + i);
  }
  return targets;
}

/**
 * Insert blank metric rows under the header and copy formulas from the previous
 * first data row (now shifted down). Newest Engine writes stay on top.
 *
 * IMPORTANT: Google Sheets insertRowsAfter(headerRow) makes new rows inherit the
 * HEADER row’s dark backgrounds and plain number formats. We must never leave
 * those in place. After PASTE_FORMULA, restore pastel body colors + safe number
 * formats by header name (do not blind-copy full formats from a neighbor row —
 * that used to turn Clicks/Impressions into percent when a template row was bad).
 */
function insertMetricRowsAtTop_(sheet, headerRow, count) {
  if (count <= 0) {
    return;
  }
  clearSheetFilter_(sheet);
  const lastCol = Math.max(1, sheet.getLastColumn());
  const formulaSourceBefore = headerRow + 1;
  sheet.insertRowsAfter(headerRow, count);
  const formulaSourceAfter = formulaSourceBefore + count;
  ensureSheetRows_(sheet, formulaSourceAfter);
  const sourceRange = sheet.getRange(formulaSourceAfter, 1, 1, lastCol);
  for (let i = 0; i < count; i++) {
    const destRow = headerRow + 1 + i;
    const destRange = sheet.getRange(destRow, 1, 1, lastCol);
    try {
      // Formulas only — never PASTE_FORMAT / copyFormatToRange here.
      sourceRange.copyTo(
          destRange,
          SpreadsheetApp.CopyPasteType.PASTE_FORMULA,
          false
      );
    } catch (copyError) {
      console.warn(
          'Could not copy formulas to inserted metrics row ' + destRow + ': ' +
          copyError
      );
    }
  }
  applySpokeMetricNumberFormats_(sheet, headerRow, headerRow + 1, count);
  applySpokeMetricBodyStyles_(sheet, headerRow, headerRow + 1, count);
}

/**
 * Apply number formats + pastel body colors to a list of metric row numbers
 * (contiguous blocks batched for speed).
 */
function applySpokeMetricPresentationToRows_(sheet, headerRow, rowNumbers) {
  if (!sheet || !rowNumbers || !rowNumbers.length) {
    return;
  }
  const sorted = rowNumbers.slice().sort(function(a, b) {
    return a - b;
  });
  let blockStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (i === sorted.length || sorted[i] !== prev + 1) {
      const numRows = prev - blockStart + 1;
      applySpokeMetricNumberFormats_(sheet, headerRow, blockStart, numRows);
      applySpokeMetricBodyStyles_(sheet, headerRow, blockStart, numRows);
      if (i < sorted.length) {
        blockStart = sorted[i];
        prev = sorted[i];
      }
    } else {
      prev = sorted[i];
    }
  }
}

/**
 * Apply safe number formats by header name for a block of metric rows.
 * Prevents Impressions/Clicks from displaying as percent (184 → 18400%).
 * Must include Expected Spend / Expected Leads / Pace % / Actual CPL — those
 * are formula columns the Engine does not rewrite, so formats must be set here.
 */
function applySpokeMetricNumberFormats_(sheet, headerRow, startRow, numRows) {
  if (!sheet || numRows <= 0) {
    return;
  }
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  const formatsByHeader = {
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
  for (let c = 0; c < headers.length; c++) {
    const fmt = formatsByHeader[String(headers[c] || '').trim()];
    if (!fmt) {
      continue;
    }
    sheet.getRange(startRow, c + 1, numRows, 1).setNumberFormat(fmt);
  }
}

/**
 * Restore pastel body-row colors and readable dark text on metric data rows.
 * Used after insertRowsAfter(header) so new rows do not keep dark header BGs.
 *
 * Column colors come from SPOKE_METRIC_COLUMN_ROLES (per tab, per column) so
 * they match create-body-shop-workbook.gs exactly. Do not go back to guessing
 * from header names: CTR is a formula on campaign tabs, Notes is script-written,
 * and Action Status is a human dropdown that must stay cream.
 */
function applySpokeMetricBodyStyles_(sheet, headerRow, startRow, numRows) {
  if (!sheet || numRows <= 0) {
    return;
  }
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  const tabName = sheet.getName();

  // Full-width reset first. Columns with a blank header still inherit the dark
  // header's white bold font, and a per-column loop would skip them.
  sheet.getRange(startRow, 1, numRows, lastCol)
      .setFontColor(SPOKE_BODY_COLORS.FONT)
      .setFontWeight('normal')
      .setFontStyle('normal')
      .setWrap(false)
      .setVerticalAlignment('middle');

  for (let c = 0; c < headers.length; c++) {
    const name = String(headers[c] || '').trim();
    const role = spokeMetricColumnRole_(tabName, c + 1, name);
    sheet.getRange(startRow, c + 1, numRows, 1)
        .setBackground(spokeMetricBodyBackground_(role, name));
  }
  for (let r = 0; r < numRows; r++) {
    sheet.setRowHeight(startRow + r, 21);
  }
}

const SPOKE_BODY_COLORS = {
  FORMULA: '#E8F1F8',
  SCRIPT: '#E6EEE9',
  ID_KEY: '#EEF2F5',
  USER_INPUT: '#F7F3E8',
  BUDGET_FORMULA: '#F5EDE6',
  BUDGET_SCRIPT: '#EFE4DA',
  LEAD_FORMULA: '#EDE8F5',
  LEAD_SCRIPT: '#E4DDF0',
  FONT: '#202124'
};

const SPOKE_BUDGET_HEADERS = {
  'Budget Status': true,
  'Expected Spend': true,
  'Actual Spend': true,
  'Budget Pace %': true,
  'Daily Budget': true,
  'Spend': true
};

const SPOKE_LEAD_HEADERS = {
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

/**
 * Per-tab column roles, 1-based. Must match METRIC_COLUMN_ROLES in
 * apps-script/create-body-shop-workbook.gs, which mirrors each tab spec.
 *
 * Header names alone get this wrong: CTR and Avg. CPC are sheet formulas on
 * campaign tabs (blue), Notes is script-written (green), and Action Status is
 * a human dropdown that must stay cream. Unlisted columns are formulas.
 */
const SPOKE_METRIC_COLUMN_ROLES = {
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

// Fallback only, for tabs missing from SPOKE_METRIC_COLUMN_ROLES.
const SPOKE_FALLBACK_ID_HEADERS = {
  'Campaign ID': true,
  'Ad Group ID': true,
  'Keyword ID': true,
  'Account ID': true
};
const SPOKE_FALLBACK_SCRIPT_HEADERS = {
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

function spokeMetricColumnRole_(tabName, col, headerName) {
  const roles = SPOKE_METRIC_COLUMN_ROLES[tabName];
  if (roles) {
    if (roles.user.indexOf(col) >= 0) {
      return 'user';
    }
    if (roles.id.indexOf(col) >= 0) {
      return 'id';
    }
    if (roles.script.indexOf(col) >= 0) {
      return 'script';
    }
    return 'formula';
  }
  if (SPOKE_FALLBACK_ID_HEADERS[headerName]) {
    return 'id';
  }
  if (SPOKE_FALLBACK_SCRIPT_HEADERS[headerName]) {
    return 'script';
  }
  return 'formula';
}

function spokeMetricBodyBackground_(role, headerName) {
  if (SPOKE_BUDGET_HEADERS[headerName]) {
    return role === 'script'
        ? SPOKE_BODY_COLORS.BUDGET_SCRIPT
        : SPOKE_BODY_COLORS.BUDGET_FORMULA;
  }
  if (SPOKE_LEAD_HEADERS[headerName]) {
    return role === 'script'
        ? SPOKE_BODY_COLORS.LEAD_SCRIPT
        : SPOKE_BODY_COLORS.LEAD_FORMULA;
  }
  if (role === 'user') {
    return SPOKE_BODY_COLORS.USER_INPUT;
  }
  if (role === 'id') {
    return SPOKE_BODY_COLORS.ID_KEY;
  }
  if (role === 'script') {
    return SPOKE_BODY_COLORS.SCRIPT;
  }
  return SPOKE_BODY_COLORS.FORMULA;
}

/** Remove an active filter so inserts/writes land on real row numbers. */
function clearSheetFilter_(sheet) {
  if (!sheet) {
    return;
  }
  try {
    const filter = sheet.getFilter();
    if (filter) {
      filter.remove();
    }
  } catch (e) {
    // No filter / cannot remove.
  }
}

function clearMetricDateRows_(sheet, headerRow, dateCol1Based, ymd, colCount, timeZone) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) {
    return;
  }
  const headers = sheet.getRange(headerRow, 1, 1, colCount).getValues()[0];
  const clearNames = {
    'Date': true,
    'Week Ending': true,
    'Campaign ID': true,
    'Campaign Name': true,
    'Campaign Type': true,
    'Google Status': true,
    'Ad Group ID': true,
    'Ad Group Name': true,
    'Keyword ID': true,
    'Keyword Text': true,
    'Match Type': true,
    'Location': true,
    'Location Type': true,
    'Device': true,
    'Daily Budget': true,
    'Spend': true,
    'Actual Spend': true,
    'Impressions': true,
    'Clicks': true,
    'Conversions': true,
    'Google Ads Conversions': true,
    'Notes': true
  };
  const values = sheet.getRange(headerRow + 1, dateCol1Based, lastRow - headerRow, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const cell = normalizeSheetDateFlexible_(values[i][0], timeZone);
    if (cell !== ymd) {
      continue;
    }
    const row = headerRow + 1 + i;
    for (let c = 0; c < headers.length; c++) {
      const headerName = String(headers[c] || '').trim();
      if (!clearNames[headerName]) {
        continue;
      }
      // Keep human MANUAL EDIT stamps in Notes across same-day Engine rewrites.
      if (headerName === 'Notes') {
        const notes = String(sheet.getRange(row, c + 1).getValue() || '');
        if (notes.indexOf('MANUAL EDIT') >= 0) {
          sheet.getRange(row, c + 1).setValue(
              mergeNotesPreservingManualEdit_(notes, '')
          );
          continue;
        }
      }
      sheet.getRange(row, c + 1).clearContent();
    }
  }
}

/**
 * Preserve "MANUAL EDIT …" stamps from spoke onEdit warnings when Engine
 * clears/rewrites Notes.
 */
function mergeNotesPreservingManualEdit_(existingNotes, engineNotes) {
  const existing = String(existingNotes || '').trim();
  const incoming = String(engineNotes || '').trim();
  const marker = 'MANUAL EDIT';
  let manualPart = '';
  if (existing.indexOf(marker) >= 0) {
    const parts = existing.split('|');
    const kept = [];
    for (let i = 0; i < parts.length; i++) {
      const part = String(parts[i] || '').trim();
      if (part.indexOf(marker) >= 0) {
        kept.push(part);
      }
    }
    manualPart = kept.join(' | ');
  }
  if (manualPart && incoming) {
    return incoming + ' | ' + manualPart;
  }
  if (manualPart) {
    return manualPart;
  }
  return incoming;
}

function writeSparseMetricRow_(sheet, rowNumber, headers, values) {
  for (let c = 0; c < headers.length; c++) {
    const value = values[c];
    if (value === '' || value === null || value === undefined) {
      continue;
    }
    const cell = sheet.getRange(rowNumber, c + 1);
    const header = String(headers[c] || '').trim();
    if (header === 'Notes') {
      const existingNotes = String(cell.getValue() || '');
      cell.setValue(mergeNotesPreservingManualEdit_(existingNotes, value));
      continue;
    }
    cell.setValue(value);
    // Keep count columns as whole numbers (never percent). A bare 4 with
    // percent format displays as 400% — common PMax Clicks display bug.
    if (header === 'Clicks' || header === 'Impressions' ||
        header === 'Conversions' || header === 'Google Ads Conversions' ||
        header === 'Expected Leads') {
      cell.setNumberFormat('#,##0');
    } else if (header === 'Spend' || header === 'Actual Spend' ||
        header === 'Daily Budget' || header === 'Expected Spend' ||
        header === 'Avg. CPC' || header === 'CPL' || header === 'Actual CPL' ||
        header === 'Target CPL') {
      cell.setNumberFormat('$#,##0.00');
    } else if (header === 'CTR' || header === 'Conv. Rate' ||
        header === 'Budget Pace %' || header === 'Lead Pace %') {
      cell.setNumberFormat('0%');
    } else if (header === 'Date' || header === 'Week Ending') {
      cell.setNumberFormat('m/d/yyyy');
    }
  }
}


function appendHubObjectRows_(sheet, headers, objects) {
  if (!sheet || !objects || !objects.length) {
    return;
  }
  const existingHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0];
  requireExactHeaders_(existingHeaders, headers, sheet.getName());
  const rows = [];
  for (let i = 0; i < objects.length; i++) {
    const row = [];
    for (let h = 0; h < headers.length; h++) {
      const value = objects[i][headers[h]];
      row.push(value === undefined || value === null ? '' : value);
    }
    rows.push(row);
  }
  const start = sheet.getLastRow() + 1;
  ensureSheetRows_(sheet, start + rows.length - 1);
  sheet.getRange(start, 1, rows.length, headers.length).setValues(rows);
}

function shouldWriteWeeklySegments_(runDate) {
  if (ENGINE_CONFIG.WRITE_WEEKLY_EVERY_RUN) {
    return true;
  }
  const date = new Date(runDate + 'T12:00:00Z');
  return date.getUTCDay() === ENGINE_CONFIG.WEEKLY_SEGMENT_DAY;
}

function isEnabledFlag_(value) {
  if (value === true || value === 1) {
    return true;
  }
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  return normalized === 'ENABLED' || normalized === 'TRUE' || normalized === 'YES';
}

function normalizeEnabledDisabled_(value, defaultValue) {
  if (isEnabledFlag_(value)) {
    return 'Enabled';
  }
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'DISABLED' || normalized === 'FALSE' || normalized === 'NO' ||
      normalized === '0') {
    return 'Disabled';
  }
  return defaultValue || 'Disabled';
}

function toTolerance_(value, fallback) {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!isFinite(number) || number < 0) {
    return fallback;
  }
  // Hub sheet may store 15% as 0.15 or as 15
  if (number > 1) {
    return number / 100;
  }
  return number;
}

function normalizeSheetDateFlexible_(value, timeZone) {
  const tz = timeZone || ENGINE_CONFIG.REPORT_TIME_ZONE;
  if (!value) {
    return '';
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, tz, 'yyyy-MM-dd');
  }
  return '';
}


/* -------------------------------------------------------------------------- */
/* SHARED HELPERS (GAQL, HEALTH COPY, EMAIL)                                 */
/* -------------------------------------------------------------------------- */

function getPerformance_(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) {
    return emptyPerformance_();
  }

  const query =
      'SELECT ' +
      'metrics.cost_micros, metrics.impressions, metrics.clicks, ' +
      'metrics.conversions, metrics.all_conversions ' +
      'FROM customer ' +
      "WHERE segments.date BETWEEN '" + startDate + "' AND '" + endDate + "'";

  const rows = AdsApp.search(query);
  const output = emptyPerformance_();

  while (rows.hasNext()) {
    const row = rows.next();
    output.cost += microsToCurrency_(row.metrics.costMicros);
    output.impressions += toNumber_(row.metrics.impressions);
    output.clicks += toNumber_(row.metrics.clicks);
    output.conversions += toNumber_(row.metrics.conversions);
    output.allConversions += toNumber_(row.metrics.allConversions);
  }

  return output;
}

function getOptimizationScore_() {
  try {
    const query =
        'SELECT customer.optimization_score ' +
        'FROM customer LIMIT 1';
    const rows = AdsApp.search(query);
    if (rows.hasNext()) {
      const row = rows.next();
      const score = row.customer.optimizationScore;
      return score === null || score === undefined ? null : toNumber_(score);
    }
  } catch (error) {
    console.warn('Optimization Score unavailable: ' + error);
  }
  return null;
}

/**
 * Resolve Ads UI deep-link IDs for the current account.
 * The `ocid` query param in ads.google.com is often a different token than the
 * 10-digit Customer ID. Pulling it from metrics.optimization_score_url is the
 * reliable way Scripts can deep-link into the right client overview.
 */
function getAccountAdsDeepLinkIds_() {
  const customerId = normalizeCustomerId_(AdsApp.currentAccount().getCustomerId());
  let ocid = '';
  try {
    const query =
        'SELECT metrics.optimization_score_url FROM customer LIMIT 1';
    const rows = AdsApp.search(query);
    if (rows.hasNext()) {
      const row = rows.next();
      const url = row.metrics && row.metrics.optimizationScoreUrl
          ? String(row.metrics.optimizationScoreUrl)
          : '';
      const match = url.match(/[?&]ocid=(\d+)/i);
      if (match && match[1]) {
        ocid = match[1];
      }
    }
  } catch (error) {
    console.warn('Could not resolve Ads UI ocid for deep link: ' + error);
  }
  return {
    customerId: customerId,
    ocid: ocid || customerId
  };
}

function getRecommendationData_() {
  const byType = {};
  const riskCounts = {LOW: 0, MEDIUM: 0, HIGH: 0, REVIEW: 0};
  let total = 0;

  try {
    const iterator = AdsApp.recommendations().get();
    while (iterator.hasNext()) {
      const recommendation = iterator.next();
      const type = recommendation.getType() || 'UNKNOWN';
      const classification = classifyRecommendationType_(type);
      byType[type] = (byType[type] || 0) + 1;
      riskCounts[classification.riskLevel] =
          (riskCounts[classification.riskLevel] || 0) + 1;
      total++;
    }
  } catch (error) {
    console.warn('Recommendations unavailable: ' + error);
  }

  return {total: total, byType: byType, riskCounts: riskCounts};
}

function classifyRecommendationType_(type) {
  const normalized = String(type || 'UNKNOWN').toUpperCase();

  const highRiskTokens = [
    'BUDGET', 'TARGET_CPA', 'TARGET_ROAS', 'MAXIMIZE_CONVERSION',
    'MAXIMIZE_CONVERSION_VALUE', 'BROAD_MATCH', 'DISPLAY_EXPANSION',
    'MOVE_UNUSED_BUDGET', 'PERFORMANCE_MAX_OPT_IN', 'FORECASTING'
  ];
  const mediumRiskTokens = [
    'KEYWORD', 'RESPONSIVE_SEARCH_AD', 'DYNAMIC_SEARCH_AD', 'AUDIENCE',
    'LOCATION', 'AD_STRENGTH', 'CAMPAIGN', 'SHOPPING'
  ];
  const lowRiskTokens = [
    'SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'IMAGE_ASSET',
    'BUSINESS_NAME', 'BUSINESS_LOGO', 'CALL_ASSET', 'LEAD_FORM_ASSET'
  ];

  if (containsAny_(normalized, highRiskTokens)) {
    return {
      riskLevel: 'HIGH',
      suggestedAction: 'Manual review required',
      rationale: 'Could materially affect spend, bidding, targeting, or traffic quality. Do not apply solely to increase Optimization Score.'
    };
  }

  if (containsAny_(normalized, lowRiskTokens)) {
    return {
      riskLevel: 'LOW',
      suggestedAction: 'Review for safe application',
      rationale: 'Usually an asset-coverage or account-completeness recommendation. Confirm all claims, URLs, and client details before applying.'
    };
  }

  if (containsAny_(normalized, mediumRiskTokens)) {
    return {
      riskLevel: 'MEDIUM',
      suggestedAction: 'Require operator approval',
      rationale: 'May affect search intent, ad messaging, campaign structure, or audience reach and should be supported by account evidence.'
    };
  }

  return {
    riskLevel: 'REVIEW',
    suggestedAction: 'Review and document decision',
    rationale: 'Recommendation type is not in the current rule library and needs manual classification.'
  };
}

function getActiveExperimentCount_() {
  let count = 0;

  // Google Ads Scripts exposes experiments through AdsApp.experiments().
  // Status names vary between legacy draft experiments and newer experiment
  // resources, so this accepts both active-status vocabularies.
  const activeStatuses = {
    ACTIVE: true,
    CREATING: true,
    APPLYING: true,
    SETUP: true,
    ENABLED: true,
    INITIATED: true
  };

  try {
    const iterator = AdsApp.experiments().get();
    while (iterator.hasNext()) {
      const experiment = iterator.next();
      const status = String(experiment.getStatus() || '').toUpperCase();
      if (activeStatuses[status]) {
        count++;
      }
    }
  } catch (error) {
    console.warn('Experiments unavailable: ' + error);
  }

  return count;
}

function getSearchTermCount_(startDate, endDate) {
  const uniqueTerms = {};
  try {
    const query =
        'SELECT search_term_view.search_term ' +
        'FROM search_term_view ' +
        "WHERE segments.date BETWEEN '" + startDate + "' AND '" + endDate + "' " +
        'AND metrics.impressions > 0';
    const rows = AdsApp.search(query);
    while (rows.hasNext()) {
      const row = rows.next();
      const term = row.searchTermView.searchTerm;
      if (term) {
        uniqueTerms[String(term).toLowerCase()] = true;
      }
    }
  } catch (error) {
    console.warn('Search terms unavailable: ' + error);
  }
  return Object.keys(uniqueTerms).length;
}

function getEnabledDailyBudgetEstimate_() {
  const uniqueBudgets = {};
  let dailyBudget = 0;

  try {
    const query =
        'SELECT campaign.campaign_budget, campaign_budget.amount_micros ' +
        'FROM campaign ' +
        "WHERE campaign.status = 'ENABLED'";
    const rows = AdsApp.search(query);

    while (rows.hasNext()) {
      const row = rows.next();
      const resourceName = row.campaign.campaignBudget;
      if (resourceName && !uniqueBudgets[resourceName]) {
        uniqueBudgets[resourceName] = true;
        dailyBudget += microsToCurrency_(row.campaignBudget.amountMicros);
      }
    }
  } catch (error) {
    console.warn('Budget estimate unavailable: ' + error);
  }

  return dailyBudget;
}

function getChangeData_(startDate, endDate, limit) {
  const summary = {
    total: 0,
    last24Hours: 0,
    negativeKeywords: 0,
    assets: 0,
    ads: 0,
    highRisk: 0,
    recommendationsApplied: 0,
    byCategory: {}
  };
  const events = [];

  try {
    const query =
        'SELECT ' +
        'change_event.resource_name, ' +
        'change_event.change_date_time, ' +
        'change_event.user_email, ' +
        'change_event.client_type, ' +
        'change_event.change_resource_type, ' +
        'change_event.resource_change_operation, ' +
        'change_event.changed_fields, ' +
        'change_event.old_resource, ' +
        'change_event.new_resource ' +
        'FROM change_event ' +
        "WHERE change_event.change_date_time >= '" + startDate + " 00:00:00' " +
        "AND change_event.change_date_time <= '" + endDate + " 23:59:59' " +
        'ORDER BY change_event.change_date_time DESC ' +
        'LIMIT ' + limit;

    const rows = AdsApp.search(query);
    const yesterdayMidnight = endDate + ' 00:00:00';

    while (rows.hasNext()) {
      const row = rows.next();
      const event = row.changeEvent;
      const fields = getChangedFieldPaths_(event.changedFields);
      const category = categorizeChangeEvent_(event, fields);

      const compact = {
        eventKey: event.resourceName || buildFallbackEventKey_(event, fields),
        dateTime: event.changeDateTime || '',
        resourceType: event.changeResourceType || 'UNKNOWN',
        operation: event.resourceChangeOperation || 'UNKNOWN',
        clientType: event.clientType || 'UNKNOWN',
        userEmail: event.userEmail || '',
        changedFields: fields,
        category: category
      };

      events.push(compact);
      summary.total++;
      summary.byCategory[category] = (summary.byCategory[category] || 0) + 1;

      if ((event.changeDateTime || '') >= yesterdayMidnight) {
        summary.last24Hours++;
      }
      if (category === 'Negative Keywords') {
        summary.negativeKeywords++;
      }
      if (category === 'Assets') {
        summary.assets++;
      }
      if (category === 'Ads / Creative') {
        summary.ads++;
      }
      if (category === 'Budget / Bidding') {
        summary.highRisk++;
      }
      if (String(event.clientType || '').indexOf('GOOGLE_ADS_RECOMMENDATIONS') === 0) {
        summary.recommendationsApplied++;
      }
    }
  } catch (error) {
    console.warn('Change history unavailable: ' + error);
    summary.error = String(error);
  }

  return {summary: summary, events: events};
}

function categorizeChangeEvent_(event, fields) {
  const type = String(event.changeResourceType || '');
  const fieldText = fields.join(' ').toLowerCase();

  if (isNegativeKeywordEvent_(event)) {
    return 'Negative Keywords';
  }

  if (
    type === 'ASSET' ||
    type === 'ASSET_SET' ||
    type === 'ASSET_SET_ASSET' ||
    type === 'CUSTOMER_ASSET' ||
    type === 'CAMPAIGN_ASSET' ||
    type === 'CAMPAIGN_ASSET_SET' ||
    type === 'AD_GROUP_ASSET'
  ) {
    return 'Assets';
  }

  if (type === 'AD' || type === 'AD_GROUP_AD') {
    return 'Ads / Creative';
  }

  if (
    type === 'CAMPAIGN_BUDGET' ||
    fieldText.indexOf('bidding') >= 0 ||
    fieldText.indexOf('target_cpa') >= 0 ||
    fieldText.indexOf('target_cpa_micros') >= 0 ||
    fieldText.indexOf('target_roas') >= 0 ||
    fieldText.indexOf('maximize_conversion') >= 0 ||
    fieldText.indexOf('manual_cpc') >= 0 ||
    fieldText.indexOf('amount_micros') >= 0
  ) {
    return 'Budget / Bidding';
  }

  if (
    type === 'AD_GROUP_CRITERION' ||
    type === 'CAMPAIGN_CRITERION' ||
    type === 'AD_GROUP_BID_MODIFIER'
  ) {
    return 'Targeting / Keywords';
  }

  if (type === 'CAMPAIGN') {
    return 'Campaign Settings';
  }

  if (type === 'AD_GROUP') {
    return 'Ad Group Settings';
  }

  return 'Other';
}

function isNegativeKeywordEvent_(event) {
  const type = String(event.changeResourceType || '');
  if (type !== 'AD_GROUP_CRITERION' && type !== 'CAMPAIGN_CRITERION') {
    return false;
  }

  const source = event.resourceChangeOperation === 'REMOVE'
      ? event.oldResource
      : event.newResource;

  const criterion = getCriterionResource_(source);
  if (!criterion) {
    return false;
  }

  return criterion.negative === true && !!criterion.keyword;
}

function getCriterionResource_(resource) {
  if (!resource) {
    return null;
  }
  return resource.adGroupCriterion ||
      resource.campaignCriterion ||
      resource.sharedCriterion ||
      null;
}

function getChangedFieldPaths_(changedFields) {
  if (!changedFields) {
    return [];
  }
  if (changedFields.paths && Array.isArray(changedFields.paths)) {
    return changedFields.paths;
  }
  if (Array.isArray(changedFields)) {
    return changedFields;
  }

  try {
    const serialized = JSON.stringify(changedFields);
    const parsed = JSON.parse(serialized);
    if (parsed.paths && Array.isArray(parsed.paths)) {
      return parsed.paths;
    }
  } catch (error) {
    // Ignore and use a readable fallback.
  }

  return [String(changedFields)];
}

function buildFallbackEventKey_(event, fields) {
  return [
    event.changeDateTime || '',
    event.changeResourceType || '',
    event.resourceChangeOperation || '',
    event.clientType || '',
    event.userEmail || '',
    fields.join('|')
  ].join('~');
}

function buildInternalSummary_(input) {
  const accountLabel = input.clientName || input.accountName;
  const mtdCpl = safeDivide_(input.monthToDate.cost, input.monthToDate.conversions);
  const parts = [];

  parts.push(accountLabel + ' — ' + input.health.status + '.');
  parts.push(
      'Yesterday: ' +
      formatMoney_(input.yesterday.cost, input.currency) + ' spend, ' +
      formatNumberText_(input.yesterday.conversions) + ' conversions.'
  );

  if (input.settings.dailyBudget > 0) {
    parts.push(
        'Daily budget: ' +
        formatMoney_(input.settings.dailyBudget, input.currency) +
        ' average; yesterday used ' +
        formatPercentText_(input.health.dailyBudgetUtilization) +
        ' (' + input.health.dailyBudgetStatus + ').'
    );
  }

  parts.push(
      'MTD: ' +
      formatMoney_(input.monthToDate.cost, input.currency) + ' spend, ' +
      formatNumberText_(input.monthToDate.conversions) + ' conversions, ' +
      formatMoneyOrDash_(mtdCpl, input.currency) + ' CPL.'
  );

  if (input.settings.monthlyBudget > 0) {
    parts.push(
        'Monthly budget: ' +
        formatMoney_(input.settings.monthlyBudget, input.currency) +
        '; ' + formatPercentText_(input.health.monthlyBudgetUsed) +
        ' used and ' + input.health.spendPaceStatus.toLowerCase() + '.'
    );
  }

  if (input.settings.monthlyLeadGoal > 0) {
    parts.push(
        'Lead pace: ' + input.health.leadPaceStatus +
        ' at ' + formatPercentText_(input.health.leadPace) +
        ' of expected pace.'
    );
  }

  parts.push(
      'Optimization Score: ' +
      (input.optimizationScore === null
          ? 'not available'
          : formatPercentText_(input.optimizationScore)) +
      '; ' + input.activeRecommendations + ' active recommendations (' +
      input.recommendationRiskCounts.LOW + ' low, ' +
      input.recommendationRiskCounts.MEDIUM + ' medium, ' +
      input.recommendationRiskCounts.HIGH + ' high risk).'
  );
  parts.push(
      input.changeData.summary.last24Hours + ' verified changes in the last 24 hours; ' +
      input.changeData.summary.total + ' in the last seven days.'
  );

  if (input.activeExperiments > 0) {
    parts.push(
        input.activeExperiments + ' active experiment' +
        (input.activeExperiments === 1 ? '' : 's') + '.'
    );
  }

  if (input.health.attentionItems.length > 0) {
    parts.push('Attention: ' + input.health.attentionItems.join('; ') + '.');
  } else {
    parts.push('No immediate account-health issues were detected.');
  }

  return parts.join(' ');
}

function buildClientReportContent_(input) {
  const accountLabel = input.clientName || input.accountName;
  const conversions = toNumber_(input.lastSevenDays.conversions);
  const spend = toNumber_(input.lastSevenDays.cost);
  const cpl = safeDivide_(spend, conversions);
  const averageDailySpend = spend / 7;
  const counts = input.weeklyCounts;

  let results = '';
  if (conversions > 0) {
    results =
        'Over the past seven days, ' + accountLabel + ' generated ' +
        formatNumberText_(conversions) + ' ' +
        (conversions === 1 ? 'lead' : 'leads') + ' from ' +
        formatMoney_(spend, input.currency) +
        ' in ad spend, averaging ' +
        formatMoneyOrDash_(cpl, input.currency) + ' per lead.';
  } else if (spend > 0) {
    results =
        'Over the past seven days, ' + accountLabel + ' invested ' +
        formatMoney_(spend, input.currency) +
        ' in advertising. No primary leads were recorded during this reporting window, ' +
        'so we are reviewing traffic quality and conversion activity closely.';
  } else {
    results =
        accountLabel + ' recorded no ad spend during the past seven days. ' +
        'We are confirming account delivery and the next steps needed to resume normal activity.';
  }

  const budgetSentences = [];
  if (input.settings.dailyBudget > 0) {
    budgetSentences.push(
        'Average daily spend was ' +
        formatMoney_(averageDailySpend, input.currency) +
        ' compared with the current ' +
        formatMoney_(input.settings.dailyBudget, input.currency) +
        ' daily budget'
    );
  }

  if (input.settings.monthlyBudget > 0) {
    budgetSentences.push(
        'month-to-date spend is ' +
        formatMoney_(input.monthToDate.cost, input.currency) +
        ' of the ' +
        formatMoney_(input.settings.monthlyBudget, input.currency) +
        ' monthly budget, with pacing currently ' +
        clientPacePhrase_(input.health.spendPaceStatus)
    );
  }

  let budget = '';
  if (budgetSentences.length > 0) {
    budget = capitalizeFirst_(budgetSentences.join(', and ')) + '.';
  }

  const completed = [];
  if (counts.negativeKeywords > 0) {
    completed.push(
        'added ' + counts.negativeKeywords + ' negative keyword' +
        (counts.negativeKeywords === 1 ? '' : 's') +
        ' to improve traffic quality'
    );
  }
  if (counts.assets > 0) {
    completed.push(
        'updated ' + counts.assets + ' ad asset' +
        (counts.assets === 1 ? '' : 's')
    );
  }
  if (counts.ads > 0) {
    completed.push(
        'refreshed ' + counts.ads + ' ad' +
        (counts.ads === 1 ? '' : 's')
    );
  }
  if (counts.keywordsUpdated > 0) {
    completed.push(
        'updated ' + counts.keywordsUpdated + ' keyword' +
        (counts.keywordsUpdated === 1 ? '' : 's')
    );
  }
  if (counts.audiencesUpdated > 0) {
    completed.push(
        'updated ' + counts.audiencesUpdated + ' audience setting' +
        (counts.audiencesUpdated === 1 ? '' : 's')
    );
  }
  if (counts.recommendationsDismissed > 0) {
    completed.push(
        'reviewed and cleared ' + counts.recommendationsDismissed +
        ' account recommendation' +
        (counts.recommendationsDismissed === 1 ? '' : 's')
    );
  }
  if (counts.experimentsCreated > 0) {
    completed.push(
        'launched ' + counts.experimentsCreated + ' controlled test' +
        (counts.experimentsCreated === 1 ? '' : 's')
    );
  }
  if (counts.experimentsReviewed > 0) {
    completed.push(
        'reviewed ' + counts.experimentsReviewed + ' test result' +
        (counts.experimentsReviewed === 1 ? '' : 's')
    );
  } else if (input.activeExperiments > 0) {
    completed.push(
        'continued monitoring ' + input.activeExperiments + ' ad test' +
        (input.activeExperiments === 1 ? '' : 's')
    );
  }

  let work = '';
  if (completed.length > 0) {
    work =
        'This week, we reviewed ' + input.searchTermsAnalyzed +
        ' search terms and ' + joinHumanList_(completed) + '.';
  } else if (input.searchTermsAnalyzed > 0) {
    work =
        'This week, we reviewed ' + input.searchTermsAnalyzed +
        ' search terms, monitored delivery and budget pacing, and identified the next ' +
        'opportunities to improve lead quality and efficiency.';
  } else {
    work =
        'This week, we monitored delivery, budget pacing, and lead performance while ' +
        'identifying the next opportunities to improve results.';
  }

  let nextFocus = '';
  if (input.health.status === 'Healthy') {
    nextFocus =
        'Performance is tracking in line with the current plan, and we will continue refining ' +
        'traffic quality and lead efficiency.';
  } else if (input.health.status === 'Watch') {
    nextFocus =
        'We are watching pacing and lead efficiency closely and will continue making measured ' +
        'adjustments as more data comes in.';
  } else {
    nextFocus =
        'Our immediate focus is improving lead volume and efficiency while protecting the budget.';
  }

  return {
    accountUpdate: String(input.clientNotes || '').trim(),
    results: results,
    budget: budget,
    work: work,
    nextFocus: nextFocus
  };
}

function composeClientSummary_(clientReport) {
  const parts = [];
  if (clientReport.accountUpdate) {
    parts.push('Account update: ' + clientReport.accountUpdate);
  }
  if (clientReport.results) {
    parts.push(clientReport.results);
  }
  if (clientReport.budget) {
    parts.push(clientReport.budget);
  }
  if (clientReport.work) {
    parts.push(clientReport.work);
  }
  if (clientReport.nextFocus) {
    parts.push(clientReport.nextFocus);
  }
  return parts.join(' ');
}

function clientPacePhrase_(status) {
  switch (String(status || '')) {
    case 'On pace':
      return 'aligned with plan';
    case 'Under pace':
      return 'below the planned pace';
    case 'Over pace':
      return 'ahead of the planned pace';
    default:
      return 'under review';
  }
}

function capitalizeFirst_(text) {
  if (!text) {
    return '';
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function mergeWeeklyCounts_(automated, manual) {
  return {
    total: automated.total + manual.negativeKeywords + manual.keywordsUpdated +
        manual.assets + manual.ads + manual.audiencesUpdated +
        manual.recommendationsDismissed + manual.experimentsCreated +
        manual.experimentsReviewed + manual.highRisk + manual.otherActions,
    negativeKeywords: automated.negativeKeywords + manual.negativeKeywords,
    keywordsUpdated: manual.keywordsUpdated,
    assets: automated.assets + manual.assets,
    ads: automated.ads + manual.ads,
    audiencesUpdated: manual.audiencesUpdated,
    highRisk: automated.highRisk + manual.highRisk,
    recommendationsDismissed: manual.recommendationsDismissed,
    experimentsCreated: manual.experimentsCreated,
    experimentsReviewed: manual.experimentsReviewed
  };
}

function getBuiltByShahEmailLogoBlob_() {
  return Utilities.newBlob(
      Utilities.base64Decode(BUILT_BY_SHAH_LOGO_DARK_PNG_BASE64),
      'image/png',
      'built-by-shah-logo-dark.png'
  );
}

function buildHtmlEmailSubject_(hubRollup, runDate, problemAccountCount, problemIssueCount) {
  const attention = toNumber_(hubRollup.Needs_Attention_Accounts);
  const watch = toNumber_(hubRollup.Watch_Accounts);
  const accountCount = problemAccountCount === undefined || problemAccountCount === null
      ? attention
      : toNumber_(problemAccountCount);
  const issueCount = problemIssueCount === undefined || problemIssueCount === null
      ? accountCount
      : toNumber_(problemIssueCount);
  let statusText = 'All clear';

  if (accountCount > 0) {
    if (accountCount === 1) {
      statusText = issueCount > 1
          ? '1 account needs action (' + issueCount + ' issues)'
          : '1 account needs action';
    } else {
      statusText = issueCount > accountCount
          ? accountCount + ' accounts need action (' + issueCount + ' issues)'
          : accountCount + ' accounts need action';
    }
  } else if (attention > 0) {
    statusText = attention === 1
        ? '1 Account Needs Attention'
        : attention + ' Accounts Need Attention';
  } else if (watch > 0) {
    statusText = watch === 1
        ? '1 Account on Watch'
        : watch + ' Accounts on Watch';
  }

  return ENGINE_CONFIG.EMAIL_SUBJECT_PREFIX +
      ' — ' + statusText +
      ' — ' + formatEmailDate_(runDate);
}

function accountHasDigestProblems_(result) {
  if (!result) {
    return false;
  }
  if (result.alerts && result.alerts.length > 0) {
    return true;
  }
  const status = result.health && result.health.status;
  return status === 'Needs attention' || status === 'Watch';
}

/** True when Hub Campaign Start Date puts this shop in the money-back window. */
function isResultInMoneyBackGuarantee_(result, asOfYmd) {
  return !!getMoneyBackGuaranteeInfo_(
      getCampaignStartDateFromResult_(result),
      getGuaranteeAsOfFromResult_(result, asOfYmd));
}

/**
 * CSM should be copied when their shop needs attention/Watch/typed alerts,
 * or when it is still inside the 30-day money-back guarantee (even if Healthy).
 */
function accountNeedsCsmEmailVisibility_(result, asOfYmd) {
  return accountHasDigestProblems_(result) ||
      isResultInMoneyBackGuarantee_(result, asOfYmd);
}

/** Keep money-back shops visible even when healthy cards are otherwise hidden. */
function accountShouldAppearInEmailDetail_(result, asOfYmd) {
  if (accountHasDigestProblems_(result)) {
    return true;
  }
  if (ENGINE_CONFIG.EMAIL_INCLUDE_HEALTHY_ACCOUNTS) {
    return true;
  }
  return isResultInMoneyBackGuarantee_(result, asOfYmd);
}

function collectProblemAlertsFromResults_(results) {
  const list = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const alerts = result.alerts || [];
    for (let a = 0; a < alerts.length; a++) {
      const alert = alerts[a];
      list.push({
        result: result,
        alert: alert,
        spokeUrl: result.spokeUrl || alert.SpokeUrl || '',
        accountLabel: result.clientName || result.accountName || alert['Account Name'] || ''
      });
    }
  }
  list.sort(function(a, b) {
    return String(a.accountLabel).localeCompare(String(b.accountLabel));
  });
  return list;
}

/**
 * One card per shop: group typed Hub alerts so multiple issues stay under one account.
 */
function groupProblemAlertsByAccount_(problemItems) {
  const groups = [];
  const indexByKey = {};
  for (let i = 0; i < (problemItems || []).length; i++) {
    const item = problemItems[i] || {};
    const result = item.result || {};
    const alert = item.alert || {};
    const accountId = normalizeCustomerId_(
        result.accountId || alert['Account ID'] || '');
    const accountLabel = item.accountLabel ||
        result.clientName || result.accountName || alert['Account Name'] || 'Account';
    const key = accountId || ('label:' + accountLabel);
    if (!Object.prototype.hasOwnProperty.call(indexByKey, key)) {
      indexByKey[key] = groups.length;
      groups.push({
        result: result,
        accountLabel: accountLabel,
        spokeUrl: item.spokeUrl || result.spokeUrl || alert.SpokeUrl || '',
        alerts: []
      });
    }
    groups[indexByKey[key]].alerts.push(alert);
  }
  return groups;
}

function getNeedsAttentionCardStyle_() {
  return {
    border: '#f04438',
    headerBg: '#fef3f2',
    badgeBg: '#fdecec',
    badgeColor: '#b42318',
    accent: '#b42318',
    label: HUB_ALERT_STATUS_NEEDS_ATTENTION
  };
}

function buildActionRequiredEmailSection_(problemItems, runDate) {
  const groups = groupProblemAlertsByAccount_(problemItems);
  if (!groups.length) {
    return '';
  }

  groups.sort(function(a, b) {
    return compareMoneyBackGuaranteeFirst_(
        a.result || {}, b.result || {}, runDate);
  });

  const cards = [];
  for (let c = 0; c < groups.length; c++) {
    cards.push(buildProblemAccountEmailCard_(groups[c], runDate));
  }

  const issueCount = problemItems.length;
  const accountCount = groups.length;
  const subtitle = accountCount === 1
      ? (issueCount === 1
          ? '1 shop with an open issue'
          : '1 shop with ' + issueCount + ' open issues')
      : accountCount + ' shops with ' + issueCount + ' open issues';

  return '' +
    '<div style="margin:22px 0 12px;padding:10px 12px;border-radius:8px;' +
    'background:#fef3f2;border:1px solid #fecdca;">' +
      '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;font-weight:800;' +
      'text-transform:uppercase;color:#b42318;">Needs attention — account detail</div>' +
      '<div style="font-size:15px;line-height:22px;font-weight:700;color:#7a271a;' +
      'margin-top:2px;">' + escapeHtml_(subtitle) + '</div>' +
    '</div>' +
    cards.join('');
}

function buildProblemIssueBlockHtml_(alert, result, style, issueIndex, issueTotal) {
  const message = String(alert.Message || '').replace(/\s*Next step:.*$/i, '');
  const guide = hydrateNextStepGuide_(
      alert['Alert Type'] || '',
      alert.NextStepGuide,
      {
        spendPaceStatus: result.health && result.health.spendPaceStatus,
        message: message,
        facts: (alert.NextStepGuide && alert.NextStepGuide.facts) || message
      }
  );
  const issueLabel = issueTotal > 1
      ? ('Issue ' + issueIndex + ' of ' + issueTotal)
      : 'Issue';

  return '' +
    '<div style="margin:' + (issueIndex > 1 ? '16px' : '0') +
    ' 0 0;padding:' + (issueIndex > 1 ? '16px 0 0' : '0') + ';' +
    (issueIndex > 1 ? 'border-top:1px solid #fecdca;' : '') + '">' +
      '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;' +
      'text-transform:uppercase;color:#60758a;font-weight:700;margin-bottom:4px;">' +
        escapeHtml_(issueLabel) +
      '</div>' +
      '<div style="font-size:13px;line-height:19px;font-weight:800;color:#b42318;' +
      'margin-bottom:6px;">' +
        escapeHtml_(alert['Alert Type'] || 'ALERT') +
      '</div>' +
      '<div style="font-size:13px;line-height:20px;color:#263b50;">' +
        escapeHtml_(message) +
      '</div>' +
      buildNextStepBoxHtml_(guide, style.accent, style.border) +
    '</div>';
}

/**
 * One Needs attention card per account (all typed Hub alerts nested inside).
 */
function buildProblemAccountEmailCard_(group, runDate) {
  const result = group.result || {};
  const alerts = group.alerts || [];
  const style = getNeedsAttentionCardStyle_();
  const accountLabel = group.accountLabel ||
      result.clientName || result.accountName || 'Account';
  const firstAlert = alerts[0] || {};
  const accountId = formatCustomerIdForEmail_(
      result.accountId || firstAlert['Account ID'] || '');
  const spokeUrl = group.spokeUrl || result.spokeUrl || '';
  const csmName = result.csmName || firstAlert.CsmName || '';
  const csmEmail = result.csmEmail || firstAlert.CsmEmail || '';
  const guaranteeInfo = getMoneyBackGuaranteeInfo_(
      getCampaignStartDateFromResult_(result),
      getGuaranteeAsOfFromResult_(result, runDate));
  const issueParts = [];
  for (let i = 0; i < alerts.length; i++) {
    issueParts.push(
        buildProblemIssueBlockHtml_(alerts[i], result, style, i + 1, alerts.length));
  }
  const linksHtml = buildAccountActionButtonsHtml_({
    accountId: result.accountId || firstAlert['Account ID'] || '',
    adsOcid: result.adsOcid || '',
    spokeUrl: spokeUrl,
    primaryBg: style.accent,
    primaryBorder: style.border,
    primaryColor: '#ffffff',
    secondaryBg: '#ffffff',
    secondaryBorder: style.border,
    secondaryColor: style.accent
  });
  const badgeText = alerts.length > 1
      ? (style.label + ' · ' + alerts.length + ' issues')
      : style.label;

  return '' +
    '<div style="border:1px solid ' + style.border + ';border-left:6px solid ' +
    style.border + ';border-radius:9px;margin:0 0 18px;overflow:hidden;' +
    'background:#ffffff;">' +
      '<div style="padding:15px 17px;background:' + style.headerBg +
      ';border-bottom:1px solid ' + style.border + ';">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' +
          '<tr>' +
            '<td style="font-size:17px;line-height:24px;color:#172b4d;font-weight:700;">' +
              escapeHtml_(accountLabel) +
              '<div style="font-size:11px;line-height:16px;color:#718096;font-weight:400;' +
              'margin-top:2px;">' +
                escapeHtml_(result.accountName || '') +
                (accountId ? ' · ' + escapeHtml_(accountId) : '') +
              '</div>' +
              buildCsmContactLineHtml_(csmName, csmEmail) +
            '</td>' +
            '<td align="right" valign="top">' +
              '<span style="display:inline-block;background:' + style.badgeBg +
              ';color:' + style.badgeColor + ';font-size:11px;line-height:16px;' +
              'font-weight:700;padding:5px 9px;border-radius:999px;border:1px solid ' +
              style.border + ';">' +
                escapeHtml_(badgeText) +
              '</span>' +
              buildMoneyBackGuaranteeBadgeHtml_(guaranteeInfo) +
            '</td>' +
          '</tr>' +
        '</table>' +
      '</div>' +
      '<div style="padding:15px 17px 17px;">' +
        buildMoneyBackGuaranteeBannerHtml_(guaranteeInfo, 'needsAttention', result) +
        issueParts.join('') +
        linksHtml +
      '</div>' +
    '</div>';
}

/** @deprecated Prefer buildProblemAccountEmailCard_ (grouped by account). */
function buildProblemAlertEmailCard_(item) {
  return buildProblemAccountEmailCard_({
    result: item.result || {},
    accountLabel: item.accountLabel || '',
    spokeUrl: item.spokeUrl || '',
    alerts: item.alert ? [item.alert] : []
  });
}

/**
 * Split Hub multi-value cells (names or emails) on commas / semicolons / newlines.
 */
function splitHubListField_(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }
  const parts = raw.split(/[,;\n]+/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const item = String(parts[i] || '').trim();
    if (item) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Pair Hub CSM Name + CSM Email lists by position (1st name with 1st email, etc.).
 * Supports one shop with several CSMs in the same Hub row.
 */
function buildCsmContactPairs_(csmName, csmEmail) {
  const names = splitHubListField_(csmName);
  const emails = splitHubListField_(csmEmail);
  const count = Math.max(names.length, emails.length);
  const pairs = [];
  for (let i = 0; i < count; i++) {
    pairs.push({
      name: names[i] || '',
      email: emails[i] || ''
    });
  }
  return pairs;
}

function formatOneCsmContact_(pair) {
  const name = String((pair && pair.name) || '').trim();
  const email = String((pair && pair.email) || '').trim();
  if (name && email) {
    return name + ' · ' + email;
  }
  if (name) {
    return name;
  }
  if (email) {
    return email;
  }
  return '';
}

/**
 * CSM contact line for email cards (from Google Ads Hub Config columns).
 * One CSM: "CSM: Name · email"
 * Several: "CSMs: Name1 · email1; Name2 · email2"
 */
function formatCsmContactLine_(csmName, csmEmail) {
  const pairs = buildCsmContactPairs_(csmName, csmEmail);
  if (!pairs.length) {
    return 'CSM: not set on the Google Ads Hub sheet';
  }
  const parts = [];
  for (let i = 0; i < pairs.length; i++) {
    const part = formatOneCsmContact_(pairs[i]);
    if (part) {
      parts.push(part);
    }
  }
  if (!parts.length) {
    return 'CSM: not set on the Google Ads Hub sheet';
  }
  if (parts.length === 1) {
    return 'CSM: ' + parts[0];
  }
  return 'CSMs: ' + parts.join('; ');
}

function buildCsmContactLineHtml_(csmName, csmEmail) {
  const pairs = buildCsmContactPairs_(csmName, csmEmail);
  const isMissing = !pairs.length;
  if (isMissing) {
    return '' +
      '<div style="font-size:12px;line-height:17px;color:#98a2b3;font-weight:500;' +
      'margin-top:4px;">' +
        escapeHtml_('CSM: not set on the Google Ads Hub sheet') +
      '</div>';
  }

  if (pairs.length === 1) {
    return '' +
      '<div style="font-size:12px;line-height:17px;color:#475467;font-weight:500;' +
      'margin-top:4px;">' +
        escapeHtml_('CSM: ' + formatOneCsmContact_(pairs[0])) +
      '</div>';
  }

  let html =
      '<div style="font-size:12px;line-height:17px;color:#475467;font-weight:600;' +
      'margin-top:4px;">CSMs</div>';
  for (let i = 0; i < pairs.length; i++) {
    const part = formatOneCsmContact_(pairs[i]);
    if (!part) {
      continue;
    }
    html +=
        '<div style="font-size:12px;line-height:17px;color:#475467;font-weight:500;' +
        'margin-top:2px;">' +
          escapeHtml_(part) +
        '</div>';
  }
  return html;
}

/**
 * Deep-link buttons for email cards.
 * Prefer the Ads UI `ocid` resolved during the account run (from
 * metrics.optimization_score_url). Falling back to Customer ID alone often
 * lands managers on the MCC "Select a Google Ads account" screen.
 * Spoke sheet URL comes from Google Ads Hub Config → Spoke Spreadsheet URL.
 */
function buildGoogleAdsOverviewUrl_(accountId, adsOcid) {
  const customerId = normalizeCustomerId_(accountId);
  if (!customerId) {
    return 'https://ads.google.com/';
  }
  const ocid = normalizeCustomerId_(adsOcid) || customerId;
  // ocid = Ads UI account token; uscid / __c = Customer ID — together they
  // usually open the client overview instead of the MCC account picker.
  return 'https://ads.google.com/aw/overview?ocid=' + encodeURIComponent(ocid) +
      '&uscid=' + encodeURIComponent(customerId) +
      '&__c=' + encodeURIComponent(customerId);
}

function buildAccountActionButtonsHtml_(opts) {
  const options = opts || {};
  const adsUrl = buildGoogleAdsOverviewUrl_(options.accountId, options.adsOcid);
  const spokeUrl = String(options.spokeUrl || '').trim();
  const primaryBg = options.primaryBg || '#b42318';
  const primaryBorder = options.primaryBorder || primaryBg;
  const primaryColor = options.primaryColor || '#ffffff';
  const secondaryBg = options.secondaryBg || '#ffffff';
  const secondaryBorder = options.secondaryBorder || primaryBorder;
  const secondaryColor = options.secondaryColor || primaryBg;

  let html =
      '<div style="margin-top:14px;">' +
        '<a href="' + escapeHtml_(adsUrl) + '" style="display:inline-block;' +
        'margin:0 8px 0 0;padding:8px 12px;border-radius:8px;background:' +
        primaryBg + ';border:1px solid ' + primaryBorder + ';color:' + primaryColor +
        ';font-size:12px;line-height:16px;font-weight:700;text-decoration:none;">' +
          'Open Google Ads' +
        '</a>';
  if (spokeUrl) {
    html +=
        '<a href="' + escapeHtml_(spokeUrl) + '" style="display:inline-block;' +
        'padding:8px 12px;border-radius:8px;background:' + secondaryBg +
        ';border:1px solid ' + secondaryBorder + ';color:' + secondaryColor +
        ';font-size:12px;line-height:16px;font-weight:700;text-decoration:none;">' +
          'Open account sheet' +
        '</a>';
  }
  html += '</div>';
  return html;
}

function buildHtmlEmail_(results, hubRollup, runDate) {
  const problemItems = collectProblemAlertsFromResults_(results);
  const problemGroups = groupProblemAlertsByAccount_(problemItems);

  let detailResults = results.slice();
  if (ENGINE_CONFIG.EMAIL_PROBLEM_FIRST && !ENGINE_CONFIG.EMAIL_INCLUDE_HEALTHY_ACCOUNTS) {
    detailResults = results.filter(function(result) {
      return accountShouldAppearInEmailDetail_(result, runDate);
    });
  }
  if (ENGINE_CONFIG.EMAIL_SORT_ACCOUNTS_BY_HEALTH) {
    detailResults.sort(compareAccountHealth_);
  }

  // Typed Hub alerts render once as Needs attention cards above. Below that:
  // Watch briefings + any Needs attention shops that have no typed alert row
  // (gates off / alerts disabled) so Next step copy is never missing. Skip
  // accounts that already appear in the alert section to avoid double-listing.
  const accountsWithAlerts = {};
  for (let p = 0; p < problemItems.length; p++) {
    const id = normalizeCustomerId_(
        (problemItems[p].result && problemItems[p].result.accountId) ||
        (problemItems[p].alert && problemItems[p].alert['Account ID']) ||
        ''
    );
    if (id) {
      accountsWithAlerts[id] = true;
    }
  }

  const watchResults = [];
  const orphanNeedsResults = [];
  const healthyResults = [];
  for (let i = 0; i < detailResults.length; i++) {
    const result = detailResults[i];
    const accountId = normalizeCustomerId_(result.accountId || '');
    if (accountsWithAlerts[accountId]) {
      continue;
    }
    const status = result.health && result.health.status;
    if (status === 'Watch') {
      watchResults.push(result);
    } else if (status === 'Needs attention') {
      orphanNeedsResults.push(result);
    } else {
      healthyResults.push(result);
    }
  }

  const sortedOrphanNeeds = sortResultsMoneyBackGuaranteeFirst_(
      orphanNeedsResults, runDate);
  const sortedHealthy = sortResultsMoneyBackGuaranteeFirst_(
      healthyResults, runDate);

  const watchCards = [];
  for (let w = 0; w < watchResults.length; w++) {
    watchCards.push(buildAccountEmailCard_(watchResults[w], runDate));
  }
  const orphanNeedsCards = [];
  for (let n = 0; n < sortedOrphanNeeds.length; n++) {
    orphanNeedsCards.push(buildAccountEmailCard_(sortedOrphanNeeds[n], runDate));
  }
  const healthyCards = [];
  for (let h = 0; h < sortedHealthy.length; h++) {
    healthyCards.push(buildAccountEmailCard_(sortedHealthy[h], runDate));
  }

  let accountDetailSection = '';
  if (watchCards.length || orphanNeedsCards.length || healthyCards.length) {
    accountDetailSection = '<tr><td style="background:#ffffff;padding:8px 28px 26px;">';
    if (watchCards.length) {
      accountDetailSection +=
          '<div style="margin:10px 0 12px;padding:10px 12px;border-radius:8px;' +
          'background:#fffaeb;border:1px solid #fecdca;">' +
            '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;font-weight:800;' +
            'text-transform:uppercase;color:#8a5a00;">Watch — keep an eye on</div>' +
            '<div style="font-size:15px;line-height:22px;font-weight:700;color:#7a4d00;' +
            'margin-top:2px;">Shops drifting off pace or target</div>' +
          '</div>' +
          watchCards.join('');
    }
    if (orphanNeedsCards.length) {
      accountDetailSection +=
          '<div style="margin:' + (watchCards.length ? '18px' : '10px') +
          ' 0 12px;padding:10px 12px;border-radius:8px;' +
          'background:#fef3f2;border:1px solid #fecdca;">' +
            '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;font-weight:800;' +
            'text-transform:uppercase;color:#b42318;">Needs attention — follow up</div>' +
            '<div style="font-size:15px;line-height:22px;font-weight:700;color:#7a271a;' +
            'margin-top:2px;">Shops flagged red without a typed Google Ads Hub alert row</div>' +
          '</div>' +
          orphanNeedsCards.join('');
    }
    if (healthyCards.length) {
      accountDetailSection +=
          '<div style="margin:' +
          ((watchCards.length || orphanNeedsCards.length) ? '18px' : '10px') +
          ' 0 12px;padding:10px 12px;border-radius:8px;' +
          'background:#ecfdf3;border:1px solid #abefc6;">' +
            '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;font-weight:800;' +
            'text-transform:uppercase;color:#087443;">Healthy — no action needed</div>' +
            '<div style="font-size:15px;line-height:22px;font-weight:700;color:#085d3a;' +
            'margin-top:2px;">Shops looking good this wave</div>' +
          '</div>' +
          healthyCards.join('');
    }
    accountDetailSection += '</td></tr>';
  }

  return '' +
    '<!doctype html>' +
    '<html><body style="margin:0;padding:0;background:#e8eef4;' +
    'font-family:Arial,Helvetica,sans-serif;color:#172b4d;">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' +
        escapeHtml_(buildEmailPreheader_(
            hubRollup, problemGroups.length, problemItems.length)) +
      '</div>' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;background:#e8eef4;">' +
        '<tr><td align="center" style="padding:24px 12px;">' +
          '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
          'style="width:100%;max-width:760px;border-collapse:collapse;' +
          'box-shadow:0 1px 3px rgba(16,24,40,.08);">' +
            buildEmailHeroHtml_({
              runDate: runDate,
              hubRollup: hubRollup,
              problemAccountCount: problemGroups.length,
              problemIssueCount: problemItems.length,
              logoHtml:
                  '<img src="cid:' + ENGINE_CONFIG.BRAND_LOGO_CID + '" ' +
                  'width="' + ENGINE_CONFIG.BRAND_LOGO_WIDTH_PX + '" alt="Built by Shah" ' +
                  'style="display:block;width:' + ENGINE_CONFIG.BRAND_LOGO_WIDTH_PX +
                  'px;max-width:100%;height:auto;border:0;outline:none;' +
                  'text-decoration:none;">'
            }) +
            '<tr><td style="background:#ffffff;padding:26px 28px 8px;">' +
              buildHubEmailSection_(hubRollup) +
              buildActionRequiredEmailSection_(problemItems, runDate) +
            '</td></tr>' +
            accountDetailSection +
            buildEmailOfficialFooterHtml_(runDate) +
          '</table>' +
        '</td></tr>' +
      '</table>' +
    '</body></html>';
}

/**
 * Clean navy hero with official text (ref / batch / distribution / status).
 */
function buildEmailDigestRefId_(runDate) {
  return 'BBS-HUB-' + String(runDate || '').replace(/-/g, '');
}

/**
 * Honest batch framing for multi-wave days (50 accounts/run cap).
 * Uses Hub remaining-due after this wave — not a guessed "batch 2 of N".
 * Returns full sentences for email hero / plain text.
 */
function buildEmailBatchCoverageSentence_(hubRollup) {
  const accountCount = toNumber_((hubRollup || {}).Account_Count);
  if (accountCount === 1) {
    return 'This email covers 1 account from the current ' +
        ENGINE_PRODUCT_NAME + ' run.';
  }
  return 'This email covers ' + accountCount +
      ' accounts from the current ' + ENGINE_PRODUCT_NAME + ' run.';
}

function buildEmailBatchQueueSentence_(hubRollup) {
  const rollup = hubRollup || {};
  if (Object.prototype.hasOwnProperty.call(rollup, 'Remaining_Due_Today') &&
      rollup.Remaining_Due_Today !== null &&
      rollup.Remaining_Due_Today !== undefined &&
      rollup.Remaining_Due_Today !== '') {
    const remaining = toNumber_(rollup.Remaining_Due_Today);
    if (remaining > 0) {
      return 'Google Ads Scripts process up to 50 accounts per run. ' +
          remaining +
          (remaining === 1
              ? ' enabled Google Ads Hub account is still due later today, so another scheduled run may send a separate status email. '
              : ' enabled Google Ads Hub accounts are still due later today, so another scheduled run may send a separate status email. ') +
          'This uses the same ' + ENGINE_PRODUCT_NAME + ' and Google Ads Hub — not a second system.';
    }
    return 'Google Ads Scripts process up to 50 accounts per run. ' +
        'The Google Ads Hub daily due queue is complete for today.';
  }
  return 'Google Ads Scripts process up to 50 accounts per run, so you may receive more than one status email in a day when accounts remain due. ' +
      'This uses the same ' + ENGINE_PRODUCT_NAME + ' and Google Ads Hub — not a second system.';
}

/** @deprecated Prefer buildEmailBatchCoverageSentence_ + buildEmailBatchQueueSentence_. */
function buildEmailBatchMetaLine_(hubRollup) {
  return buildEmailBatchCoverageSentence_(hubRollup);
}

/** @deprecated Prefer buildEmailBatchQueueSentence_. */
function buildEmailBatchExplainer_(hubRollup) {
  return buildEmailBatchQueueSentence_(hubRollup);
}

function buildEmailHeroMetaRow_(label, value) {
  return '<tr>' +
    '<td valign="top" style="width:108px;padding:0 12px 7px 0;font-size:12px;' +
    'line-height:18px;color:#9eb4c7;font-weight:700;white-space:nowrap;">' +
      escapeHtml_(label) +
    '</td>' +
    '<td valign="top" style="padding:0 0 7px;font-size:13px;line-height:18px;' +
    'color:#e8f0f7;">' +
      escapeHtml_(value) +
    '</td>' +
  '</tr>';
}

function buildEmailHeroHtml_(opts) {
  const options = opts || {};
  const runDate = options.runDate || '';
  const hubRollup = options.hubRollup || {};
  const problemAccountCount = toNumber_(
      options.problemAccountCount !== undefined
          ? options.problemAccountCount
          : options.problemCount);
  const problemIssueCount = toNumber_(
      options.problemIssueCount !== undefined
          ? options.problemIssueCount
          : problemAccountCount);
  const logoHtml = options.logoHtml || '';
  const refId = buildEmailDigestRefId_(runDate);
  const dateLabel = formatEmailDate_(runDate);
  const coverageSentence = buildEmailBatchCoverageSentence_(hubRollup);
  const queueSentence = buildEmailBatchQueueSentence_(hubRollup);
  let statusLine = 'No open issues require manager action in this email.';
  if (problemAccountCount > 0) {
    if (problemAccountCount === 1) {
      statusLine = problemIssueCount > 1
          ? '1 shop has ' + problemIssueCount +
            ' open issues that need manager action.'
          : '1 shop has an open issue that needs manager action.';
    } else {
      statusLine = problemAccountCount + ' shops have open issues' +
          (problemIssueCount > problemAccountCount
              ? ' (' + problemIssueCount + ' total)'
              : '') +
          ' that need manager action.';
    }
  }

  return '' +
    '<tr><td style="background:#17324d;padding:22px 28px 24px;border-radius:10px 10px 0 0;">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;">' +
        '<tr>' +
          '<td valign="middle">' + logoHtml + '</td>' +
          '<td align="right" valign="top" style="padding-left:14px;">' +
            '<span style="display:inline-block;border:1px solid #6f879d;' +
            'border-radius:999px;padding:5px 9px;color:#e8f0f7;font-size:10px;' +
            'line-height:14px;letter-spacing:.6px;text-transform:uppercase;' +
            'font-weight:700;white-space:nowrap;">For internal use only</span>' +
          '</td>' +
        '</tr>' +
      '</table>' +
      '<div style="font-size:26px;line-height:34px;color:#ffffff;font-weight:700;' +
      'margin-top:14px;">Google Ads Account Status</div>' +
      '<div style="font-size:14px;line-height:21px;color:#d9e8f5;margin-top:6px;' +
      'max-width:560px;">' +
        'Official account-health briefing for Built by Shah Google Ads managers. ' +
        'Handle as confidential agency operations material.' +
      '</div>' +
      '<table role="presentation" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:collapse;margin-top:14px;">' +
        buildEmailHeroMetaRow_('Report date', dateLabel) +
        buildEmailHeroMetaRow_('Reference', refId) +
        buildEmailHeroMetaRow_('Audience', 'Account managers (CSMs when action is needed)') +
      '</table>' +
      '<div style="margin-top:12px;padding:12px 14px;background:rgba(255,255,255,.08);' +
      'border:1px solid rgba(255,255,255,.14);border-radius:8px;">' +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.6px;' +
        'text-transform:uppercase;font-weight:800;color:#9eb4c7;">' +
          'About this email' +
        '</div>' +
        '<div style="font-size:13px;line-height:20px;color:#e8f0f7;margin-top:6px;">' +
          escapeHtml_(coverageSentence) + ' ' + escapeHtml_(queueSentence) +
        '</div>' +
      '</div>' +
      '<div style="font-size:14px;line-height:21px;color:#ffffff;font-weight:700;' +
      'margin-top:14px;">' +
        escapeHtml_(statusLine) +
      '</div>' +
    '</td></tr>';
}

function buildEmailTroubleshootChecklistHtml_() {
  return '' +
    '<div style="font-size:12px;line-height:18px;color:#475569;margin:0 0 12px;">' +
      'Work this checklist, then ask the tech owner if it still fails. ' +
      'These emails come from the Built by Shah Google Ads Script Engine — not Gmail rules. ' +
      'You may get more than one per day when the Google Ads Hub still has shops due (50 accounts per run).' +
    '</div>' +
    '<ol style="margin:0;padding:0 0 0 18px;font-size:12px;line-height:18px;color:#334155;">' +
      '<li style="margin:0 0 10px;padding-left:2px;">' +
        '<strong>Google Ads Hub spreadsheet → Config tab</strong> — find your shop’s row(s).' +
        '<ul style="margin:6px 0 0 14px;padding:0;color:#475569;">' +
          '<li style="margin:0 0 4px;"><strong>Enabled</strong> must be <strong>Enabled</strong> (Disabled shops are skipped).</li>' +
          '<li style="margin:0 0 4px;"><strong>Account Manager Email</strong> must include your address. ' +
          'This is the main To: field. Blank email = no status email for that shop. ' +
          'You can list multiple emails separated by commas.</li>' +
          '<li style="margin:0 0 4px;"><strong>CSM Email</strong> is added when that shop has open problems ' +
          '<em>or</em> is still inside the first 30-day money-back guarantee window (including Healthy shops), ' +
          'and only if the Built by Shah Google Ads Script Engine setting below allows it. ' +
          'Put the CSM address here if they should get those emails. ' +
          'Several CSMs on one shop: comma-separate <strong>CSM Name</strong> and <strong>CSM Email</strong> in the same order ' +
          '(example names: Jordan Lee, Sam Rivera / emails: user@example.com, user@example.com). ' +
          'The account card lists every CSM for the Google Ads manager.</li>' +
          '<li style="margin:0 0 4px;"><strong>Alerts Enabled</strong> should usually be <strong>Enabled</strong>. ' +
          'If Disabled, typed Google Ads Hub alerts (Needs attention cards) will not be created for that shop.</li>' +
          '<li style="margin:0 0 0;">Individual gates — <strong>Alert: Budget Off Pace</strong>, ' +
          '<strong>Alert: Leads Off Pace</strong>, <strong>Alert: High CPL</strong>, ' +
          '<strong>Alert: Spend No Conversions</strong>, <strong>Alert: Zero Spend</strong>, ' +
          '<strong>Alert: Unconfigured</strong> — set each to <strong>Enabled</strong> for the issues you want flagged.</li>' +
        '</ul>' +
      '</li>' +
      '<li style="margin:0 0 10px;padding-left:2px;">' +
        '<strong>Google Ads Hub spreadsheet → Run Log</strong> — confirm today’s ' +
        ENGINE_PRODUCT_NAME + ' run shows SUCCESS or PARTIAL. ' +
        'If FAILED / missing, the script did not finish and may not have emailed.' +
      '</li>' +
      '<li style="margin:0 0 10px;padding-left:2px;">' +
        '<strong>Google Ads (MCC) → Tools &amp; settings → Bulk actions → Scripts</strong> — open ' +
        '<strong>built-by-shah-mcc-engine</strong> (or your ' + ENGINE_PRODUCT_NAME +
        ' script name).' +
        '<ul style="margin:6px 0 0 14px;padding:0;color:#475569;">' +
          '<li style="margin:0 0 4px;">Confirm it is still <strong>authorized</strong> (re-authorize if Google asks).</li>' +
          '<li style="margin:0 0 4px;">Confirm <strong>frequency / schedule</strong> is still on. ' +
          'Google caps <strong>50 accounts per run</strong>; with ~70 shops you need ' +
          '<strong>at least two Daily runs</strong> (for example 6:00 and 7:00). ' +
          'Google only allows one Frequency per Scripts row, so add a second Scripts row with the ' +
          '<strong>same</strong> Built by Shah Google Ads Script Engine + Google Ads Hub for wave 2. Do not create a second Google Ads Hub or a Batch A / Batch B fork.</li>' +
          '<li style="margin:0 0 0;">Check recent run logs for errors (Google Ads Hub URL missing, spreadsheet permission, etc.).</li>' +
        '</ul>' +
      '</li>' +
      '<li style="margin:0 0 10px;padding-left:2px;">' +
        '<strong>Inside the Built by Shah Google Ads Script Engine → ENGINE_CONFIG</strong> (ask the tech owner if you do not edit scripts):' +
        '<ul style="margin:6px 0 0 14px;padding:0;color:#475569;">' +
          '<li style="margin:0 0 4px;"><strong>SEND_INTERNAL_EMAILS</strong> must be <strong>true</strong> for status emails to send after each batch.</li>' +
          '<li style="margin:0 0 4px;"><strong>EMAIL_SEND_ALL_CLEAR</strong> — if <strong>false</strong>, ' +
          'managers with <em>no</em> open problems that wave get no email (looks like “emails stopped”). Keep <strong>true</strong> for daily all-clear emails.</li>' +
          '<li style="margin:0 0 4px;"><strong>EMAIL_INCLUDE_CSM_ON_PROBLEMS</strong> — if <strong>false</strong>, CSM Email is never CC’d. ' +
          'If <strong>true</strong>, CSMs are copied for shops with open problems <em>and</em> for shops still in the 30-day money-back guarantee window.</li>' +
          '<li style="margin:0 0 4px;"><strong>HUB_SPREADSHEET_URL</strong> must still point at the live Google Ads Hub.</li>' +
          '<li style="margin:0 0 0;">Preview / test runs do <strong>not</strong> send real email.</li>' +
        '</ul>' +
      '</li>' +
      '<li style="margin:0 0 0;padding-left:2px;">' +
        '<strong>Your inbox</strong> — search for subject prefix ' +
        '<strong>Built by Shah | Google Ads Account Status</strong>. ' +
        'Check Spam / Promotions and any filter that archives Google Ads Scripts mail.' +
      '</li>' +
    '</ol>';
}

function buildEmailOfficialFooterHtml_(runDate) {
  const refId = buildEmailDigestRefId_(runDate);
  return '' +
    '<tr><td style="padding:18px 28px 22px;color:#718096;font-size:12px;' +
    'line-height:18px;background:#ffffff;border-radius:0 0 10px 10px;' +
    'border-top:1px solid #e6edf3;">' +
      '<div style="text-align:center;font-size:11px;line-height:16px;letter-spacing:.5px;' +
      'text-transform:uppercase;font-weight:700;color:#52667a;">' +
        'Confidential — Internal Use Only' +
      '</div>' +
      '<div style="text-align:center;margin-top:6px;">' +
        'Do not forward outside Built by Shah without authorization. ' +
        'This email is the action queue — no separate alert emails. ' +
        'Negatives automation is a sibling MCC script (Search / PMax sweepers), not part of this Engine.' +
      '</div>' +
      // Always expanded — Gmail does not support real <details> disclosure.
      '<div style="margin-top:16px;padding:18px 20px 20px;background:#f4f8fc;' +
      'border:1px solid #d0dfea;border-radius:8px;text-align:left;color:#334155;"' +
      ' id="bbs-email-troubleshoot">' +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.7px;' +
        'text-transform:uppercase;font-weight:800;color:#1d4f7a;margin:0 0 6px;">' +
          'Save this tip' +
        '</div>' +
        '<div style="font-size:15px;line-height:22px;font-weight:700;' +
        'color:#0f3d63;margin:0 0 6px;">' +
          'If this Google Ads Account Status email ever stops arriving' +
        '</div>' +
        '<div style="font-size:12px;line-height:18px;color:#52667a;margin:0 0 14px;">' +
          'Keep this section. Open any past status email, scroll here, and run the checklist.' +
        '</div>' +
        buildEmailTroubleshootChecklistHtml_() +
      '</div>' +
      '<div style="text-align:center;margin-top:12px;color:#94a3b8;">' +
        'Issued by Built by Shah Google Ads Script Engine · Ref ' + escapeHtml_(refId) +
      '</div>' +
    '</td></tr>';
}

function buildHubEmailSection_(row) {
  return '' +
    '<div style="font-size:18px;line-height:26px;font-weight:700;color:#172b4d;' +
    'margin-bottom:6px;">Google Ads Hub snapshot</div>' +
    '<div style="font-size:12px;line-height:18px;color:#667085;margin-bottom:14px;">' +
      'Health counts for the accounts in this email only.' +
    '</div>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
    'style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 8px;">' +
      '<tr>' +
        buildMetricCell_('Accounts', row.Account_Count, '#eaf2f8') +
        buildMetricCell_('Healthy', row.Healthy_Accounts, '#e9f7ef') +
        buildMetricCell_('Watch', row.Watch_Accounts, '#fff8e1') +
        buildMetricCell_('Needs attention', row.Needs_Attention_Accounts, '#fdecec') +
      '</tr>' +
    '</table>';
}

function buildMetricCell_(label, value, background) {
  return '<td width="25%" valign="top" style="padding:0 4px;">' +
    '<div style="background:' + background + ';border-radius:8px;padding:13px 10px;' +
    'text-align:center;">' +
      '<div style="font-size:22px;line-height:28px;font-weight:700;color:#172b4d;">' +
        escapeHtml_(String(value === null || value === undefined ? '—' : value)) +
      '</div>' +
      '<div style="font-size:11px;line-height:16px;color:#52667a;margin-top:3px;">' +
        escapeHtml_(label) +
      '</div>' +
    '</div>' +
  '</td>';
}

/**
 * Compact KPI strip for account cards — mirrors the Hub alert gates so managers
 * can trust “Healthy” without opening the spoke sheet:
 *   Yesterday spend / leads  → ZERO_SPEND, ZERO_CONVERSIONS_YESTERDAY
 *   Budget / lead pace       → BUDGET_OFF_PACE, LEADS_OFF_PACE
 *   MTD CPL vs Target CPL    → HIGH_CPL
 */
function buildAccountHealthKpiHtml_(result) {
  const health = result.health || {};
  const settings = result.settings || {};
  const currency = result.currency || 'USD';
  const yesterday = result.yesterday || emptyPerformance_();
  const mtd = result.monthToDate || emptyPerformance_();
  const cpl = health.actualCpl !== undefined && health.actualCpl !== null
      ? health.actualCpl
      : safeDivide_(mtd.cost, mtd.conversions);

  const tiles = [
    {
      label: 'Yesterday spend',
      value: formatMoney_(yesterday.cost, currency),
      hint: 'Ads delivering'
    },
    {
      label: 'Yesterday leads',
      value: formatNumberText_(yesterday.conversions),
      hint: formatNumberText_(yesterday.clicks) + ' clicks'
    },
    {
      label: 'Budget pace',
      value: health.spendPace === null || health.spendPace === undefined
          ? '—'
          : formatPercentText_(health.spendPace),
      hint: String(health.spendPaceStatus || 'Pace')
    },
    {
      label: 'Lead pace',
      value: health.leadPace === null || health.leadPace === undefined
          ? '—'
          : formatPercentText_(health.leadPace),
      hint: String(health.leadPaceStatus || 'Pace')
    },
    {
      label: 'MTD CPL',
      value: formatMoneyOrDash_(cpl, currency),
      hint: String(health.cplStatus || 'CPL')
    },
    {
      label: 'Target CPL',
      value: settings.targetCpl
          ? formatMoney_(settings.targetCpl, currency)
          : '—',
      hint: 'Hub goal'
    }
  ];

  let rowsHtml = '';
  for (let r = 0; r < tiles.length; r += 3) {
    rowsHtml += '<tr>';
    for (let c = 0; c < 3; c++) {
      const tile = tiles[r + c];
      if (!tile) {
        rowsHtml += '<td width="33%" style="padding:4px;"></td>';
        continue;
      }
      rowsHtml +=
          '<td width="33%" valign="top" style="padding:4px;">' +
            '<div style="background:#f8fafc;border:1px solid #e4eaf0;border-radius:8px;' +
            'padding:10px 10px 9px;text-align:center;">' +
              '<div style="font-size:10px;line-height:14px;letter-spacing:.5px;' +
              'text-transform:uppercase;color:#667085;font-weight:700;">' +
                escapeHtml_(tile.label) +
              '</div>' +
              '<div style="font-size:16px;line-height:22px;font-weight:700;color:#172b4d;' +
              'margin-top:4px;">' +
                escapeHtml_(tile.value) +
              '</div>' +
              '<div style="font-size:11px;line-height:15px;color:#718096;margin-top:3px;">' +
                escapeHtml_(tile.hint) +
              '</div>' +
            '</div>' +
          '</td>';
    }
    rowsHtml += '</tr>';
  }

  return '' +
    '<div style="margin:0 0 12px;">' +
      '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;' +
      'text-transform:uppercase;color:#60758a;font-weight:700;margin-bottom:8px;">' +
        'Health KPIs (same checks as Hub alerts)' +
      '</div>' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" ' +
      'style="border-collapse:separate;border-spacing:0;">' +
        rowsHtml +
      '</table>' +
    '</div>';
}

function buildClientReportRow_(label, text) {
  return '<tr>' +
    '<td valign="top" style="width:92px;padding:6px 10px 6px 0;' +
    'font-size:11px;line-height:18px;color:#60758a;font-weight:700;">' +
      escapeHtml_(label) +
    '</td>' +
    '<td valign="top" style="padding:6px 0;font-size:13px;line-height:20px;' +
    'color:#34495e;">' +
      escapeHtml_(text) +
    '</td>' +
  '</tr>';
}

function buildAccountEmailCard_(result, runDate) {
  const status = result.health.status || 'Watch';
  const statusStyle = getEmailStatusStyle_(status);
  const accountLabel = result.clientName || result.accountName;
  const attentionItems = result.health.attentionItems || [];
  const recRisk = result.recommendations.riskCounts || {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    REVIEW: 0
  };
  const isHealthy = status === 'Healthy';
  const kpiHtml = buildAccountHealthKpiHtml_(result);
  const guaranteeInfo = getMoneyBackGuaranteeInfo_(
      getCampaignStartDateFromResult_(result),
      getGuaranteeAsOfFromResult_(result, runDate));
  const guaranteeTone = isHealthy
      ? 'healthy'
      : (status === 'Needs attention' ? 'needsAttention' : 'watch');
  const guaranteeBannerHtml = buildMoneyBackGuaranteeBannerHtml_(
      guaranteeInfo, guaranteeTone, result);
  const guaranteeBadgeHtml = buildMoneyBackGuaranteeBadgeHtml_(guaranteeInfo);

  const internalBullets = [];
  if (isHealthy) {
    internalBullets.push(
        'Ads ran yesterday, budget and lead pace are inside Hub tolerance, ' +
        'and MTD CPL is within the High CPL Multiplier of Target CPL. ' +
        'No open Hub alerts for this shop.'
    );
  } else {
    internalBullets.push(
        '<strong>Yesterday:</strong> ' +
        escapeHtml_(formatMoney_(result.yesterday.cost, result.currency)) +
        ' spend, ' +
        escapeHtml_(formatNumberText_(result.yesterday.conversions)) +
        ' conversions.'
    );
    internalBullets.push(
        '<strong>Budget:</strong> ' +
        escapeHtml_(formatMoney_(result.settings.dailyBudget, result.currency)) +
        ' average daily budget; yesterday used ' +
        escapeHtml_(formatPercentText_(result.health.dailyBudgetUtilization)) +
        '. Monthly spend is ' +
        escapeHtml_(formatPercentText_(result.health.monthlyBudgetUsed)) +
        ' of budget and ' +
        escapeHtml_(String(result.health.spendPaceStatus).toLowerCase()) + '.'
    );
    internalBullets.push(
        '<strong>MTD performance:</strong> ' +
        escapeHtml_(formatMoney_(result.monthToDate.cost, result.currency)) +
        ' spend, ' +
        escapeHtml_(formatNumberText_(result.monthToDate.conversions)) +
        ' conversions, ' +
        escapeHtml_(formatMoneyOrDash_(
            safeDivide_(result.monthToDate.cost, result.monthToDate.conversions),
            result.currency
        )) +
        ' CPL.'
    );
    internalBullets.push(
        '<strong>Optimization:</strong> ' +
        escapeHtml_(result.optimizationScore === null
            ? 'Optimization Score unavailable'
            : formatPercentText_(result.optimizationScore) + ' Optimization Score') +
        '; ' + escapeHtml_(String(result.recommendations.total)) +
        ' active recommendations (' +
        escapeHtml_(String(recRisk.LOW || 0)) + ' low, ' +
        escapeHtml_(String(recRisk.MEDIUM || 0)) + ' medium, ' +
        escapeHtml_(String(recRisk.HIGH || 0)) + ' high risk).'
    );
    internalBullets.push(
        '<strong>Activity:</strong> ' +
        escapeHtml_(String(result.searchTermsAnalyzed)) +
        ' reported search terms analyzed; ' +
        escapeHtml_(String(result.changeData.summary.last24Hours)) +
        ' verified changes in 24 hours; ' +
        escapeHtml_(String(result.changeData.summary.total)) +
        ' in seven days; ' +
        escapeHtml_(String(result.activeExperiments)) +
        ' active experiments.'
    );
    if (attentionItems.length > 0) {
      internalBullets.push(
          '<strong>Attention:</strong> ' +
          escapeHtml_(summarizeAttentionLabels_(attentionItems)) + '.'
      );
    } else {
      internalBullets.push(
          '<strong>Attention:</strong> No immediate account-health issues detected.'
      );
    }
  }

  const numbersAccent = status === 'Needs attention'
      ? '#b42318'
      : (status === 'Watch' ? '#dc6803' : '#087443');
  const cardDashBorder = status === 'Needs attention'
      ? '#f04438'
      : (status === 'Watch' ? '#f79009' : '#abefc6');

  let nextStepHtml = '';
  if (status === 'Watch' || status === 'Needs attention') {
    const watchGuide = buildWatchNextStepGuide_(result) || {};
    const guide = {
      title: watchGuide.title || 'What to do next',
      meaning: watchGuide.meaning || '',
      checks: (watchGuide.checks && watchGuide.checks.length)
          ? watchGuide.checks.slice()
          : hydrateNextStepGuide_('NEEDS_ATTENTION', null, {}).checks,
      remember: watchGuide.remember || '',
      facts: watchGuide.facts || ''
    };
    nextStepHtml = buildNextStepBoxHtml_(
        guide,
        numbersAccent,
        cardDashBorder
    );
  }

  let clientSection = '';
  if (ENGINE_CONFIG.EMAIL_INCLUDE_CLIENT_SECTION) {
    const clientReport = result.clientReport || {
      accountUpdate: result.settings.clientNotes || '',
      results: result.clientSummary || '',
      budget: '',
      work: '',
      nextFocus: ''
    };

    let accountUpdateHtml = '';
    if (clientReport.accountUpdate) {
      accountUpdateHtml =
        '<div style="margin:0 0 12px;background:#fff8e6;border:1px solid #f5d98b;' +
        'border-radius:6px;padding:11px 13px;">' +
          '<div style="font-size:10px;line-height:15px;letter-spacing:.7px;' +
          'text-transform:uppercase;color:#8a5a00;font-weight:700;margin-bottom:3px;">' +
            'Account update' +
          '</div>' +
          '<div style="font-size:13px;line-height:20px;color:#5f470d;">' +
            escapeHtml_(clientReport.accountUpdate) +
          '</div>' +
        '</div>';
    }

    const clientRows = [];
    if (clientReport.results) {
      clientRows.push(buildClientReportRow_('Results', clientReport.results));
    }
    if (clientReport.budget) {
      clientRows.push(buildClientReportRow_('Budget', clientReport.budget));
    }
    if (clientReport.work) {
      clientRows.push(buildClientReportRow_('Work completed', clientReport.work));
    }
    if (clientReport.nextFocus) {
      clientRows.push(buildClientReportRow_('Next focus', clientReport.nextFocus));
    }

    clientSection =
      '<div style="margin-top:16px;background:#f7fafc;border-left:4px solid #1a73e8;' +
      'border-radius:4px;padding:14px 16px;">' +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;' +
        'text-transform:uppercase;color:#1a73e8;font-weight:700;margin-bottom:9px;">' +
          'Client-ready summary · Rolling 7 Days' +
        '</div>' +
        accountUpdateHtml +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' +
          clientRows.join('') +
        '</table>' +
      '</div>';
  }

  const isProblem = accountHasDigestProblems_(result);
  const cardBorder = status === 'Needs attention'
      ? '#f04438'
      : (status === 'Watch' ? '#f79009' : '#abefc6');
  const cardHeaderBg = status === 'Needs attention'
      ? '#fef3f2'
      : (status === 'Watch' ? '#fffaeb' : '#ecfdf3');
  const leftBar = isProblem ? '6px' : '4px';
  const buttonAccent = status === 'Needs attention'
      ? '#b42318'
      : (status === 'Watch' ? '#dc6803' : '#087443');
  const linksHtml = buildAccountActionButtonsHtml_({
    accountId: result.accountId,
    adsOcid: result.adsOcid || '',
    spokeUrl: result.spokeUrl || '',
    primaryBg: buttonAccent,
    primaryBorder: cardBorder,
    primaryColor: '#ffffff',
    secondaryBg: '#ffffff',
    secondaryBorder: cardBorder,
    secondaryColor: buttonAccent
  });

  return '' +
    '<div style="border:1px solid ' + cardBorder + ';border-left:' + leftBar +
    ' solid ' + cardBorder + ';border-radius:9px;margin:0 0 18px;' +
    'overflow:hidden;background:#ffffff;">' +
      '<div style="padding:15px 17px;background:' + cardHeaderBg +
      ';border-bottom:1px solid ' + cardBorder + ';">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' +
          '<tr>' +
            '<td style="font-size:17px;line-height:24px;color:#172b4d;font-weight:700;">' +
              escapeHtml_(accountLabel) +
              '<div style="font-size:11px;line-height:16px;color:#718096;font-weight:400;' +
              'margin-top:2px;">' +
                escapeHtml_(result.accountName) + ' · ' +
                escapeHtml_(formatCustomerIdForEmail_(result.accountId)) +
              '</div>' +
              buildCsmContactLineHtml_(result.csmName, result.csmEmail) +
            '</td>' +
            '<td align="right" valign="top">' +
              '<span style="display:inline-block;background:' + statusStyle.background +
              ';color:' + statusStyle.color + ';font-size:11px;line-height:16px;' +
              'font-weight:700;padding:5px 9px;border-radius:999px;border:1px solid ' +
              cardBorder + ';">' +
                escapeHtml_(status) +
              '</span>' +
              guaranteeBadgeHtml +
            '</td>' +
          '</tr>' +
        '</table>' +
      '</div>' +
      '<div style="padding:15px 17px 17px;">' +
        guaranteeBannerHtml +
        kpiHtml +
        '<div style="font-size:11px;line-height:16px;letter-spacing:.8px;' +
        'text-transform:uppercase;color:#60758a;font-weight:700;margin-bottom:6px;">' +
          (isHealthy
              ? 'Why this shop is Healthy'
              : 'Internal account-manager briefing') +
        '</div>' +
        (isHealthy
            ? ('<div style="font-size:13px;line-height:20px;color:#344054;margin:0 0 4px;">' +
                escapeHtml_(internalBullets[0] || '') +
              '</div>')
            : ('<ul style="margin:6px 0 0 19px;padding:0;color:#263b50;' +
                'font-size:13px;line-height:20px;">' +
                  '<li style="margin:0 0 5px;">' + internalBullets.join(
                      '</li><li style="margin:0 0 5px;">'
                  ) + '</li>' +
                '</ul>')) +
        nextStepHtml +
        linksHtml +
        (isHealthy ? '' : clientSection) +
      '</div>' +
    '</div>';
}

/**
 * Short attention labels for briefing cards (numbers live in The numbers box).
 * "Monthly spend is under pace — actual MTD ..." → "Monthly spend is under pace"
 */
function summarizeAttentionLabels_(attentionItems) {
  const labels = [];
  const items = attentionItems || [];
  for (let i = 0; i < items.length; i++) {
    const raw = String(items[i] || '').trim();
    if (!raw) {
      continue;
    }
    const splitAt = raw.indexOf(' — ');
    labels.push(splitAt >= 0 ? raw.substring(0, splitAt) : raw);
  }
  return labels.length ? labels.join('; ') : 'Needs review';
}

function buildAccountNumbersFacts_(result) {
  const health = result.health || {};
  const settings = result.settings || {};
  const currency = result.currency || 'USD';
  const mtd = result.monthToDate || emptyPerformance_();
  const yesterday = result.yesterday || emptyPerformance_();
  const facts = [];

  if (health.spendPaceStatus === 'Over pace' || health.spendPaceStatus === 'Under pace') {
    facts.push(
        'Actual MTD spend: ' + formatMoney_(mtd.cost, currency) +
        '. Expected by today: ' + formatMoney_(health.expectedSpend, currency) +
        ' (' + formatPercentText_(health.spendPace) + ' of pace).' +
        ' Google Ads Hub monthly budget: ' + formatMoney_(settings.monthlyBudget, currency) + '.'
    );
  }
  if (health.leadPaceStatus === 'Under pace') {
    facts.push(
        'Actual MTD leads: ' + formatNumberText_(mtd.conversions) +
        '. Expected by today: ' + formatNumberText_(health.expectedLeads) +
        ' (' + formatPercentText_(health.leadPace) + ' of pace).' +
        ' Google Ads Hub monthly lead goal: ' +
        formatNumberText_(settings.monthlyLeadGoal) + '.'
    );
  }
  if (health.cplStatus === 'Above target') {
    const actualCpl = health.actualCpl !== undefined
        ? health.actualCpl
        : safeDivide_(mtd.cost, mtd.conversions);
    facts.push(
        'Actual MTD CPL: ' + formatMoneyOrDash_(actualCpl, currency) +
        '. Google Ads Hub Target CPL: ' + formatMoney_(settings.targetCpl, currency) +
        '. From ' + formatMoney_(mtd.cost, currency) + ' spend / ' +
        formatNumberText_(mtd.conversions) + ' conversions.'
    );
  }
  if (health.noDeliveryYesterday) {
    facts.push(
        'Yesterday: ' + formatMoney_(yesterday.cost, currency) +
        ' spend, ' + formatNumberText_(yesterday.impressions) +
        ' impressions, ' + formatNumberText_(yesterday.clicks) +
        ' clicks. Google Ads Hub daily budget: ' +
        formatMoney_(settings.dailyBudget, currency) + '.'
    );
  } else if (health.zeroConversionsYesterday) {
    facts.push(
        'Yesterday spend: ' + formatMoney_(yesterday.cost, currency) +
        '. Clicks: ' + formatNumberText_(yesterday.clicks) +
        '. Impressions: ' + formatNumberText_(yesterday.impressions) +
        '. Conversions: 0.'
    );
  }
  if (mtd.conversions === 0 && mtd.cost > 0 &&
      hasAttentionPrefix_(health.attentionItems,
          'Meaningful spend with zero primary conversions')) {
    const threshold = settings.zeroConversionSpendAlert ||
        ENGINE_CONFIG.DEFAULT_ZERO_CONVERSION_SPEND_ALERT;
    facts.push(
        'MTD spend: ' + formatMoney_(mtd.cost, currency) +
        '. MTD conversions: 0. Alert threshold: ' +
        formatMoney_(threshold, currency) + '.'
    );
  }

  // Fallback: pull fact fragments after " — " from attention items.
  if (!facts.length) {
    const items = health.attentionItems || [];
    for (let i = 0; i < items.length; i++) {
      const raw = String(items[i] || '');
      const splitAt = raw.indexOf(' — ');
      if (splitAt >= 0) {
        facts.push(raw.substring(splitAt + 3));
      }
    }
  }

  return facts.join(' ');
}

function buildTheNumbersBoxHtml_(facts, accentColor) {
  if (!facts) {
    return '';
  }
  const accent = accentColor || '#dc6803';
  return '' +
    '<div style="margin-top:12px;padding:10px 12px;background:#f8fafc;' +
    'border:1px solid #e4eaf0;border-radius:6px;font-size:13px;' +
    'line-height:19px;color:#172b4d;">' +
      '<strong style="color:' + accent + ';">The numbers:</strong> ' +
      escapeHtml_(facts) +
    '</div>';
}

/**
 * Plain-English next-step guide for Watch / briefing cards (and Needs attention
 * shops that have no typed Hub alert row).
 * Same structure as Needs attention alert guides (title, meaning, facts, checks).
 *
 * Watch / attention triggers covered (from calculateHealth_ + related notes):
 *   - No delivery yesterday
 *   - Zero conversions yesterday
 *   - Meaningful MTD spend with zero conversions
 *   - Monthly spend under pace / over pace
 *   - Lead volume under pace (incl. new-campaign grace wording)
 *   - CPL above target
 *   - Hub budgets not configured
 *   - Hub budgets estimated / calculated (not set on the Google Ads Hub)
 *   - Change history could not be retrieved
 *   - Optimization Score soft flag
 * Unknown / empty → generic Watch fallback (never empty Next step).
 */
function buildWatchNextStepGuide_(result) {
  const health = result.health || {};
  const items = health.attentionItems || [];
  const labels = summarizeAttentionLabels_(items).toLowerCase();

  function hasPrefix_(prefix) {
    return hasAttentionPrefix_(items, prefix);
  }
  function hasLabel_(needle) {
    return labels.indexOf(String(needle || '').toLowerCase()) >= 0;
  }

  const noDelivery = health.noDeliveryYesterday ||
      hasPrefix_('No delivery yesterday') ||
      hasLabel_('no delivery yesterday');
  const zeroYday = health.zeroConversionsYesterday ||
      hasPrefix_('Zero conversions yesterday') ||
      hasLabel_('zero conversions yesterday');
  const spendNoConv = hasPrefix_('Meaningful spend with zero primary conversions') ||
      hasLabel_('meaningful spend with zero');
  const underSpend = health.spendPaceStatus === 'Under pace' ||
      hasPrefix_('Monthly spend is under pace') ||
      hasLabel_('spend is under pace');
  const overSpend = health.spendPaceStatus === 'Over pace' ||
      hasPrefix_('Monthly spend is over pace') ||
      hasLabel_('spend is over pace');
  const leadBehind = health.leadPaceStatus === 'Under pace' ||
      hasPrefix_('Lead volume is under pace') ||
      hasPrefix_('Lead pace under target') ||
      hasLabel_('lead volume is under pace') ||
      hasLabel_('lead pace under target');
  const highCpl = health.cplStatus === 'Above target' ||
      hasPrefix_('CPL is above target') ||
      hasLabel_('cpl is above target');
  const unconfigured = hasPrefix_('Daily budget not configured') ||
      hasPrefix_('Monthly budget not configured') ||
      hasLabel_('budget not configured');
  const estimatedBudget =
      hasPrefix_('Daily budget is estimated') ||
      hasPrefix_('Monthly budget is calculated/estimated') ||
      hasLabel_('budget is estimated') ||
      hasLabel_('budget is calculated/estimated');
  const changeHistoryFail =
      hasPrefix_('Change history could not be retrieved') ||
      hasLabel_('change history could not be retrieved');
  const optScoreSoft =
      hasPrefix_('Optimization Score is') ||
      hasLabel_('optimization score is');

  const checks = [];
  const titles = [];
  const meanings = [];

  if (noDelivery) {
    titles.push('Ads may not have run yesterday');
    meanings.push(
        'This shop shows no spend, impressions, or clicks yesterday. ' +
        'Something may be paused, out of money, or blocked.'
    );
    checks.push(
        'Open Google Ads and confirm the main campaigns are Enabled.',
        'Check daily budgets and shared budgets are above $0.',
        'Check Billing for payment problems.',
        'Open Notifications / Policy manager for holds or bans.',
        'Confirm location, schedule, and keywords/asset groups are still set to show.',
        'If the client asked for a pause, tell the CSM and update Google Ads Hub notes.'
    );
  }

  if (spendNoConv) {
    titles.push('Spent a lot this month with no leads yet');
    meanings.push(
        'This shop has already spent enough money this month that we expect at least some leads, ' +
        'but Google still shows zero primary conversions. Tracking may be broken or the funnel is not working.'
    );
    checks.push(
        'Compare Google Ads conversions to CallRail and GoHighLevel for the same month-to-date window.',
        'Re-check every primary conversion action (calls + forms) — Enabled, primary, and recording.',
        'Test the live landing page: call tracking number, form submit, and thank-you page.',
        'Confirm Google Ads Hub phone/form conversion action names match this Google Ads account.',
        'Review search terms / PMax insights for junk traffic.',
        'If tracking is proven broken, pause or cut budget until it is fixed.'
    );
  }

  if (zeroYday && !noDelivery && !spendNoConv) {
    titles.push('Spend happened with zero leads yesterday');
    meanings.push(
        'Ads spent money yesterday, but Google counted no conversions. ' +
        'Tracking may be broken, or traffic quality was weak.'
    );
    checks.push(
        'Open Goals / Conversions and confirm phone + form actions still record.',
        'Test the landing page call button and form on phone and desktop.',
        'Compare CallRail / GoHighLevel leads to Google Ads for yesterday.',
        'Skim search terms for junk or wrong-city traffic.',
        'Confirm Google Ads Hub lists the correct Phone / Form conversion action names.'
    );
  } else if (zeroYday && !noDelivery && spendNoConv) {
    // Still add yesterday-specific checks when both fire.
    checks.push(
        'Also check yesterday alone: CallRail / forms vs Google Ads for that day.',
        'Skim yesterday search terms for junk or wrong-city traffic.'
    );
  }

  if (underSpend) {
    titles.push('Monthly spend is behind plan');
    meanings.push(
        'Based on the Google Ads Hub monthly budget and today’s date, this shop should have ' +
        'spent more by now. Ads may be limited or not winning enough auctions.'
    );
    checks.push(
        'Confirm Google Ads Hub Monthly Budget / Daily Budget are still the agreed numbers.',
        'In Google Ads, check campaign daily budgets and shared budgets.',
        'Look for “Limited by budget,” learning limits, or payment issues.',
        'Check location, schedule, and bid strategy for recent narrowing.',
        'Review impression share lost to budget or rank if available.',
        'If the client reduced spend on purpose, update the Google Ads Hub budgets.'
    );
  }

  if (overSpend) {
    titles.push('Monthly spend is ahead of plan');
    meanings.push(
        'This shop is burning budget faster than the Google Ads Hub monthly plan. ' +
        'If nothing changes, it may run out of money early.'
    );
    checks.push(
        'Confirm the Google Ads Hub Monthly Budget is still correct.',
        'Lower daily or shared budgets so the rest of the month is covered.',
        'Check for a recent bid or broad-match change that sped up spend.',
        'Review search terms for wasteful themes driving the spike.',
        'Tell the CSM if overspend is already large and agree on a daily cap.'
    );
  }

  if (leadBehind) {
    titles.push('Lead count is behind the monthly goal');
    meanings.push(
        health.leadPaceExempt
            ? ('Lead pace is behind the Google Ads Hub goal, but this shop is still inside the ' +
              ENGINE_CONFIG.LEAD_PACE_GRACE_DAYS +
              '-day new-campaign grace window — watch closely, do not panic-change everything yet.')
            : ('Based on the Google Ads Hub monthly lead goal and today’s date, this shop should ' +
              'have more leads by now.')
    );
    checks.push(
        'Confirm Google Ads Hub Monthly Lead Goal is still the real goal.',
        'Check conversion tracking first (CallRail + forms) before changing bids.',
        'Review search terms and add negatives for junk queries.',
        'Check ad strength and landing-page offer/message fit.',
        'Look at impression share and budget limits that may block volume.',
        health.leadPaceExempt
            ? 'If still far behind after the grace window, schedule a short CSM check-in.'
            : 'If still behind after tracking is verified, schedule a short CSM check-in.'
    );
  }

  if (highCpl) {
    titles.push('Cost per lead is too high');
    meanings.push(
        'Each counted lead is costing more than the Google Ads Hub Target CPL. ' +
        'We are paying too much for the leads we are getting.'
    );
    checks.push(
        'Confirm Target CPL on the Google Ads Hub is still what the shop agreed to.',
        'Open search terms and negative out expensive junk queries.',
        'Tighten weak match types and protect strong money terms.',
        'Check ads and landing pages for clear offer and easy call/form.',
        'Review location and schedule for out-of-area or late-night waste.',
        'Ask the CSM about lead quality if “leads” are not becoming jobs.'
    );
  }

  if (unconfigured) {
    titles.push('Google Ads Hub goals are incomplete');
    meanings.push(
        'Budget or lead goal fields are missing on the Google Ads Hub, so pacing can be wrong.'
    );
    checks.push(
        'Open Google Ads Hub → Config for this account.',
        'Fill Daily Budget, Monthly Budget, Monthly Lead Goal, and Target CPL.',
        'Save and let the next Built by Shah Google Ads Script Engine run sync goals to the spoke.'
    );
  } else if (estimatedBudget) {
    titles.push('Google Ads Hub budgets are estimated, not configured');
    meanings.push(
        'Daily or monthly budget is being estimated from campaign settings instead of Google Ads Hub Config. ' +
        'Pacing alerts may not match the real client agreement.'
    );
    checks.push(
        'Open Google Ads Hub → Config for this account.',
        'Enter the real agreed Daily Budget and Monthly Budget (do not leave blank).',
        'Confirm Monthly Lead Goal and Target CPL while you are there.',
        'Save so the next Built by Shah Google Ads Script Engine run stops using estimates.'
    );
  }

  if (changeHistoryFail) {
    titles.push('Change history could not be loaded');
    meanings.push(
        'Built by Shah Google Ads Script Engine could not pull recent Google Ads change history for this shop, ' +
        'so we may be missing who changed bids, budgets, or status.'
    );
    checks.push(
        'Open Google Ads → Change history manually and scan the last 24–48 hours.',
        'Look for unexpected pauses, budget cuts, bid changes, or conversion-goal edits.',
        'Confirm the account is still Enabled under the MCC and that API/script access is intact.',
        'If this keeps failing across many accounts, tell the tech owner — it may be an API/permission issue.'
    );
  }

  if (optScoreSoft) {
    titles.push('Optimization Score is soft');
    meanings.push(
        'Google’s Optimization Score for this account is below 100%. ' +
        'Treat recommendations as ideas — not automatic to-dos.'
    );
    checks.push(
        'Open Google Ads Recommendations and read only High/Medium items that match our strategy.',
        'Ignore broad auto-apply suggestions that fight brand, geo, or conversion setup.',
        'Apply only recommendations you understand; skip the rest and note why.'
    );
  }

  // De-dupe checks while keeping order.
  const seen = {};
  const uniqueChecks = [];
  for (let c = 0; c < checks.length; c++) {
    if (seen[checks[c]]) {
      continue;
    }
    seen[checks[c]] = true;
    uniqueChecks.push(checks[c]);
  }

  if (!titles.length && !uniqueChecks.length) {
    return {
      title: 'Keep an eye on this shop',
      meaning:
          'Something drifted enough to land on Watch. Confirm the numbers, ' +
          'then fix the root cause before it becomes Needs attention.',
      facts: buildAccountNumbersFacts_(result),
      checks: [
          'Open Google Ads and the account sheet with the buttons below.',
          'Compare yesterday and MTD to a normal week for this shop.',
          'Fix tracking, budgets, or waste based on what you find.',
          'Tell the CSM if the client needs an update.'
      ],
      remember:
          'Watch means “nudge soon,” not “ignore until it breaks.”'
    };
  }

  let title = titles[0];
  if (titles.length === 2) {
    title = titles[0] + ' · ' + titles[1];
  } else if (titles.length > 2) {
    title = health.status === 'Needs attention'
        ? 'This shop has a few issues that need a look'
        : 'This shop has a few Watch issues';
  }

  const meaning = meanings.join(' ');
  let remember =
      'If the same Watch issue is still here tomorrow, treat it like Needs attention.';
  if (health.status === 'Needs attention') {
    remember =
        'This is already Needs attention — handle it today, then mark the Google Ads Hub alert Resolved when done.';
  } else if (spendNoConv || noDelivery) {
    remember =
        'Delivery and tracking problems come first. Do not “optimize keywords” while flying blind.';
  } else if (highCpl && underSpend) {
    remember =
        'Fix delivery and waste together. Raising spend into a high CPL usually makes the month worse.';
  } else if (overSpend) {
    remember =
        'Slow spend carefully so the month finishes evenly. Update the Google Ads Hub if the plan changed.';
  } else if (changeHistoryFail && titles.length === 1) {
    remember =
        'Manual change-history review is enough for today if metrics otherwise look normal.';
  }

  return {
    title: title,
    meaning: meaning,
    facts: buildAccountNumbersFacts_(result),
    checks: uniqueChecks,
    remember: remember
  };
}

/**
 * @deprecated Prefer buildWatchNextStepGuide_ for Watch/briefing cards.
 * Kept as a thin plain-text helper for digest text fallbacks.
 */
function buildAccountCardNextStep_(result) {
  const guide = buildWatchNextStepGuide_(result);
  return formatNextStepPlain_(guide);
}

function buildPlainTextEmail_(results, hubRollup, runDate) {
  const problemItems = collectProblemAlertsFromResults_(results);
  const problemGroups = groupProblemAlertsByAccount_(problemItems);
  const lines = [];
  lines.push('BUILT BY SHAH — GOOGLE ADS ACCOUNT STATUS');
  lines.push('CONFIDENTIAL — INTERNAL USE ONLY · AUTHORIZED RECIPIENTS ONLY');
  lines.push('Official account-health briefing for Built by Shah Google Ads managers.');
  lines.push('Report date: ' + formatEmailDate_(runDate));
  lines.push('Reference: ' + buildEmailDigestRefId_(runDate));
  lines.push('Audience: Account managers (CSMs when action is needed)');
  lines.push(buildEmailBatchCoverageSentence_(hubRollup));
  lines.push(buildEmailBatchQueueSentence_(hubRollup));
  lines.push('Issued by Built by Shah Google Ads Script Engine');
  lines.push('');
  if (!problemGroups.length) {
    lines.push('ACTION REQUIRED (0 shops)');
    lines.push('No open issues require manager action in this email.');
  } else {
    lines.push(
        'ACTION REQUIRED (' + problemGroups.length +
        (problemGroups.length === 1 ? ' shop' : ' shops') +
        ', ' + problemItems.length +
        (problemItems.length === 1 ? ' issue)' : ' issues)'));
    for (let g = 0; g < problemGroups.length; g++) {
      const group = problemGroups[g];
      const result = group.result || {};
      const alerts = group.alerts || [];
      lines.push('');
      lines.push('[Needs attention] ' + group.accountLabel +
          (alerts.length > 1 ? ' — ' + alerts.length + ' issues' : ''));
      lines.push(formatCsmContactLine_(
          result.csmName || (alerts[0] && alerts[0].CsmName) || '',
          result.csmEmail || (alerts[0] && alerts[0].CsmEmail) || ''));
      for (let a = 0; a < alerts.length; a++) {
        const alert = alerts[a];
        lines.push('');
        lines.push(
            'Issue ' + (a + 1) + '/' + alerts.length + ': ' +
            (alert['Alert Type'] || 'ALERT'));
        lines.push(String(alert.Message || '').replace(/\s*Next step:.*$/i, ''));
        if (alert.NextStepGuide) {
          lines.push(formatNextStepPlain_(alert.NextStepGuide));
        } else if (alert.NextStep) {
          lines.push(alert.NextStep);
        } else {
          lines.push(formatNextStepPlain_(
              getAlertNextStepGuide_(alert['Alert Type'] || '', {
                message: alert.Message || '',
                facts: alert.Message || ''
              })));
        }
      }
      if (group.spokeUrl) {
        lines.push('Sheet: ' + group.spokeUrl);
      }
    }
  }

  lines.push('');
  lines.push('HUB SNAPSHOT');
  lines.push(
      'Accounts: ' + hubRollup.Account_Count +
      ' | Healthy: ' + hubRollup.Healthy_Accounts +
      ' | Watch: ' + hubRollup.Watch_Accounts +
      ' | Needs attention: ' + hubRollup.Needs_Attention_Accounts
  );
  lines.push(hubRollup.Hub_Internal_Summary);

  const accountsWithAlerts = {};
  for (let p = 0; p < problemItems.length; p++) {
    const id = normalizeCustomerId_(
        (problemItems[p].result && problemItems[p].result.accountId) ||
        (problemItems[p].alert && problemItems[p].alert['Account ID']) ||
        ''
    );
    if (id) {
      accountsWithAlerts[id] = true;
    }
  }

  let detailResults = results.slice();
  if (ENGINE_CONFIG.EMAIL_PROBLEM_FIRST && !ENGINE_CONFIG.EMAIL_INCLUDE_HEALTHY_ACCOUNTS) {
    detailResults = results.filter(function(result) {
      return accountShouldAppearInEmailDetail_(result, runDate);
    });
  }

  const watchLines = [];
  for (let w = 0; w < detailResults.length; w++) {
    const result = detailResults[w];
    const accountId = normalizeCustomerId_(result.accountId || '');
    if (accountsWithAlerts[accountId]) {
      continue;
    }
    if (result.health && result.health.status === 'Watch') {
      watchLines.push('');
      watchLines.push('[Watch] ' + (result.clientName || result.accountName));
      watchLines.push(formatCsmContactLine_(result.csmName, result.csmEmail));
      if (result.health.attentionItems && result.health.attentionItems.length) {
        watchLines.push(
            'Attention: ' +
            summarizeAttentionLabels_(result.health.attentionItems)
        );
      }
      const watchGuide = buildWatchNextStepGuide_(result);
      if (watchGuide) {
        watchLines.push(formatNextStepPlain_(watchGuide));
      }
    }
  }
  if (watchLines.length) {
    lines.push('');
    lines.push('WATCH');
    for (let i = 0; i < watchLines.length; i++) {
      lines.push(watchLines[i]);
    }
  }

  for (let i = 0; i < detailResults.length; i++) {
    const result = detailResults[i];
    lines.push('');
    lines.push('----------------------------------------');
    lines.push((result.clientName || result.accountName) + ' — ' + result.health.status);
    lines.push(formatCsmContactLine_(result.csmName, result.csmEmail));
    lines.push('');
    lines.push('INTERNAL ACCOUNT-MANAGER BRIEFING');
    lines.push('• ' + result.internalSummary);

    if (ENGINE_CONFIG.EMAIL_INCLUDE_CLIENT_SECTION) {
      const clientReport = result.clientReport || {
        accountUpdate: result.settings.clientNotes || '',
        results: result.clientSummary || '',
        budget: '',
        work: '',
        nextFocus: ''
      };
      lines.push('');
      lines.push('CLIENT-READY SUMMARY — ROLLING 7 DAYS');
      if (clientReport.accountUpdate) {
        lines.push('ACCOUNT UPDATE: ' + clientReport.accountUpdate);
      }
      if (clientReport.results) {
        lines.push('RESULTS: ' + clientReport.results);
      }
      if (clientReport.budget) {
        lines.push('BUDGET: ' + clientReport.budget);
      }
      if (clientReport.work) {
        lines.push('WORK COMPLETED: ' + clientReport.work);
      }
      if (clientReport.nextFocus) {
        lines.push('NEXT FOCUS: ' + clientReport.nextFocus);
      }
    }
  }

  lines.push('');
  lines.push('CONFIDENTIAL — INTERNAL USE ONLY');
  lines.push('Do not forward outside Built by Shah without authorization.');
  lines.push('This digest is the action queue (no separate alert emails).');
  lines.push('Negatives automation is a sibling MCC script (Search / PMax sweepers), not part of this Engine.');
  lines.push('');
  lines.push('SAVE THIS TIP');
  lines.push('If this Google Ads Account Status email ever stops arriving, open any past HTML status email and scroll to the “Save this tip” checklist at the bottom.');
  lines.push('Full checklist:');
  lines.push('');
  lines.push('1) Google Ads Hub spreadsheet → Config tab (your shop row):');
  lines.push('   - Enabled = Enabled (Disabled shops are skipped).');
  lines.push('   - Account Manager Email must include your address (main To:). Blank = no email for that shop. Comma-separate multiple emails.');
  lines.push('   - CSM Email is only added when the email has open problems (and only if Built by Shah Google Ads Script Engine allows CSM CC).');
  lines.push('   - Several CSMs on one shop: comma-separate CSM Name and CSM Email in the same order.');
  lines.push('   - Alerts Enabled = Enabled (or typed Needs attention alerts will not be created).');
  lines.push('   - Alert gates (Budget Off Pace / Leads Off Pace / High CPL / Spend No Conversions / Zero Spend / Unconfigured) = Enabled for issues you want flagged.');
  lines.push('');
  lines.push('2) Google Ads Hub spreadsheet → Run Log:');
  lines.push('   - Confirm today’s run is SUCCESS or PARTIAL. FAILED / missing means the script may not have emailed.');
  lines.push('');
  lines.push('3) Google Ads (MCC) → Tools & settings → Bulk actions → Scripts → Built by Shah Google Ads Script Engine:');
  lines.push('   - Still authorized; schedule still on.');
  lines.push('   - Google caps 50 accounts/run. With ~70 shops, need ≥2 Daily runs (e.g. 6:00 + 7:00). One Scripts row = one Frequency; add a second identical Built by Shah Google Ads Script Engine row for wave 2 (same Google Ads Hub). No second Google Ads Hub / no Batch A-B fork.');
  lines.push('   - Check recent script logs for Google Ads Hub URL / permission errors.');
  lines.push('');
  lines.push('4) Built by Shah Google Ads Script Engine → ENGINE_CONFIG (ask tech owner if needed):');
  lines.push('   - SEND_INTERNAL_EMAILS = true (status emails send after each finished batch)');
  lines.push('   - EMAIL_SEND_ALL_CLEAR = true (if false, no-problem managers get no email)');
  lines.push('   - EMAIL_INCLUDE_CSM_ON_PROBLEMS = true if CSMs should be CC’d on problem emails and 30-day money-back guarantee shops');
  lines.push('   - HUB_SPREADSHEET_URL still points at the live Google Ads Hub');
  lines.push('   - Preview/test runs do not send real email');
  lines.push('');
  lines.push('5) Inbox: search “Built by Shah | Google Ads Account Status”; check Spam/Promotions/filters.');
  lines.push('');
  lines.push('Issued by Built by Shah Google Ads Script Engine · Ref ' + buildEmailDigestRefId_(runDate));
  return lines.join('\n');
}

function buildEmailPreheader_(hubRollup, problemAccountCount, problemIssueCount) {
  const accounts = problemAccountCount === undefined
      ? toNumber_(hubRollup.Needs_Attention_Accounts)
      : toNumber_(problemAccountCount);
  const issues = problemIssueCount === undefined
      ? accounts
      : toNumber_(problemIssueCount);
  const batchHint = Object.prototype.hasOwnProperty.call(hubRollup || {}, 'Remaining_Due_Today') &&
      toNumber_(hubRollup.Remaining_Due_Today) > 0
      ? ' One Built by Shah Google Ads Script Engine batch — more shops still due today.'
      : ' One Built by Shah Google Ads Script Engine batch.';
  if (accounts > 0) {
    if (accounts === 1) {
      return (issues > 1
          ? '1 shop has ' + issues + ' open issues that need review.'
          : '1 shop has an open issue that needs review.') + batchHint;
    }
    return accounts + ' shops have open issues' +
        (issues > accounts ? ' (' + issues + ' total)' : '') +
        ' that need review.' + batchHint;
  }
  return 'All clear — no active problem alerts in this batch.' + batchHint;
}

function compareAccountHealth_(a, b) {
  const rank = {
    'Needs attention': 0,
    'Watch': 1,
    'Healthy': 2
  };
  const aRank = rank[a.health.status] === undefined ? 3 : rank[a.health.status];
  const bRank = rank[b.health.status] === undefined ? 3 : rank[b.health.status];

  if (aRank !== bRank) {
    return aRank - bRank;
  }

  const aName = String(a.clientName || a.accountName || '');
  const bName = String(b.clientName || b.accountName || '');
  return aName.localeCompare(bName);
}

function getEmailStatusStyle_(status) {
  if (status === 'Healthy') {
    return {background: '#e9f7ef', color: '#1e7a45'};
  }
  if (status === 'Needs attention') {
    return {background: '#fdecec', color: '#b42318'};
  }
  return {background: '#fff4d6', color: '#8a5a00'};
}

function formatEmailDate_(yyyyMmDd) {
  const parts = String(yyyyMmDd || '').split('-');
  if (parts.length !== 3) {
    return String(yyyyMmDd || '');
  }
  const date = new Date(Date.UTC(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2]),
      12, 0, 0
  ));
  return Utilities.formatDate(date, 'UTC', 'MMMM d, yyyy');
}

function formatCustomerIdForEmail_(value) {
  const id = normalizeCustomerId_(value);
  if (id.length !== 10) {
    return id;
  }
  return id.substring(0, 3) + '-' +
      id.substring(3, 6) + '-' +
      id.substring(6);
}

function escapeHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute_(value) {
  return escapeHtml_(value);
}

function normalizeRecipientList_(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const parts = raw.split(/[,;\n]+/);
  const unique = {};
  const valid = [];

  for (let i = 0; i < parts.length; i++) {
    const email = parts[i].trim();
    if (!email) {
      continue;
    }
    if (!isValidEmail_(email)) {
      console.warn('Skipped invalid email address: ' + email);
      continue;
    }
    const key = email.toLowerCase();
    if (!unique[key]) {
      unique[key] = true;
      valid.push(email);
    }
  }

  valid.sort(function(a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
  return valid.join(',');
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function buildAccountDates_(timeZone) {
  const today = formatDate_(new Date(), timeZone, 'yyyy-MM-dd');
  const parts = today.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const elapsedDays = Math.max(0, day - 1);
  const yesterday = addDays_(today, -1);
  const weekStart = addDays_(yesterday, -6);
  const yesterdayParts = yesterday.split('-');

  return {
    today: today,
    yesterday: yesterday,
    weekStart: weekStart,
    monthStart: parts[0] + '-' + parts[1] + '-01',
    // Month start for the day we write (yesterday) — correct on the 1st.
    mtdStart: yesterdayParts[0] + '-' + yesterdayParts[1] + '-01',
    daysInMonth: daysInMonth,
    elapsedDays: elapsedDays
  };
}

function addDays_(yyyyMmDd, days) {
  const date = new Date(yyyyMmDd + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function formatDate_(date, timeZone, format) {
  return Utilities.formatDate(date, timeZone, format);
}

function containsAny_(text, tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (text.indexOf(tokens[i]) >= 0) {
      return true;
    }
  }
  return false;
}

function emptyPerformance_() {
  return {
    cost: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    allConversions: 0
  };
}

function emptyManualActions_() {
  return {
    searchTermsReviewed: 0,
    negativeKeywords: 0,
    keywordsUpdated: 0,
    assets: 0,
    ads: 0,
    audiencesUpdated: 0,
    recommendationsDismissed: 0,
    experimentsCreated: 0,
    experimentsReviewed: 0,
    highRisk: 0,
    otherActions: 0
  };
}

function normalizeCustomerId_(value) {
  return String(value || '').replace(/\D/g, '');
}

function positiveNumberOrZero_(value) {
  const number = Number(value);
  return isFinite(number) && number > 0 ? number : 0;
}

function toNumber_(value) {
  const number = Number(value);
  return isFinite(number) ? number : 0;
}

function microsToCurrency_(value) {
  return toNumber_(value) / 1000000;
}

function safeDivide_(numerator, denominator) {
  const n = toNumber_(numerator);
  const d = toNumber_(denominator);
  return d === 0 ? null : n / d;
}

function formatPercentText_(value) {
  if (value === null || value === undefined || !isFinite(Number(value))) {
    return '—';
  }
  return (Number(value) * 100).toFixed(1) + '%';
}

function formatNumberText_(value) {
  const number = toNumber_(value);
  return number % 1 === 0 ? String(number) : number.toFixed(1);
}

function formatMoney_(value, currency) {
  const number = toNumber_(value);
  const symbol = currency === 'USD' ? '$' : (currency + ' ');
  const formatted = number.toFixed(2)
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return symbol + formatted;
}

function formatMoneyOrDash_(value, currency) {
  return value === null ? '—' : formatMoney_(value, currency);
}

function joinHumanList_(items) {
  if (items.length === 0) {
    return '';
  }
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return items[0] + ' and ' + items[1];
  }
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

function headerIndex_(headers) {
  const index = {};
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i] || '').trim();
    if (header) {
      index[header] = i;
    }
  }
  return index;
}

function buildHubRollupRow_(results, runDate) {
  const totals = {
    yesterdaySpend: 0,
    yesterdayConversions: 0,
    dailyBudget: 0,
    mtdSpend: 0,
    mtdConversions: 0,
    monthlyBudget: 0,
    expectedSpend: 0,
    optimizationScoreTotal: 0,
    optimizationScoreCount: 0,
    recommendations: 0,
    lowRiskRecommendations: 0,
    mediumRiskRecommendations: 0,
    highRiskRecommendations: 0,
    experiments: 0,
    changes24: 0,
    changes7: 0,
    healthy: 0,
    watch: 0,
    needsAttention: 0
  };
  const currencies = {};

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    currencies[result.currency] = true;
    totals.yesterdaySpend += result.yesterday.cost;
    totals.yesterdayConversions += result.yesterday.conversions;
    totals.dailyBudget += result.settings.dailyBudget;
    totals.mtdSpend += result.monthToDate.cost;
    totals.mtdConversions += result.monthToDate.conversions;
    totals.monthlyBudget += result.settings.monthlyBudget;
    totals.expectedSpend += result.health.expectedSpend;
    totals.recommendations += result.recommendations.total;
    totals.lowRiskRecommendations += result.recommendations.riskCounts.LOW;
    totals.mediumRiskRecommendations += result.recommendations.riskCounts.MEDIUM;
    totals.highRiskRecommendations += result.recommendations.riskCounts.HIGH;
    totals.experiments += result.activeExperiments;
    totals.changes24 += result.changeData.summary.last24Hours;
    totals.changes7 += result.changeData.summary.total;

    if (result.optimizationScore !== null) {
      totals.optimizationScoreTotal += result.optimizationScore;
      totals.optimizationScoreCount++;
    }

    if (result.alerts && result.alerts.length > 0) {
      // Typed Hub alerts always surface in Needs attention email cards —
      // count the shop that way so Google Ads Hub snapshot matches the detail section.
      totals.needsAttention++;
    } else if (result.health.status === 'Healthy') {
      totals.healthy++;
    } else if (result.health.status === 'Watch') {
      totals.watch++;
    } else {
      totals.needsAttention++;
    }
  }

  const currencyList = Object.keys(currencies);
  const currency = currencyList.length === 1 ? currencyList[0] : 'MULTI';
  const summary = buildHubRollupSummary_(totals, currency, results.length);

  return {
    Run_Date: runDate,
    Currency: currency,
    Account_Count: results.length,
    Healthy_Accounts: totals.healthy,
    Watch_Accounts: totals.watch,
    Needs_Attention_Accounts: totals.needsAttention,
    Yesterday_Spend: totals.yesterdaySpend,
    Yesterday_Conversions: totals.yesterdayConversions,
    Total_Daily_Budget: totals.dailyBudget,
    Daily_Budget_Utilization_Percent: safeDivide_(totals.yesterdaySpend, totals.dailyBudget),
    MTD_Spend: totals.mtdSpend,
    MTD_Conversions: totals.mtdConversions,
    MTD_CPL: safeDivide_(totals.mtdSpend, totals.mtdConversions),
    Total_Monthly_Budget: totals.monthlyBudget,
    Expected_MTD_Spend: totals.expectedSpend,
    Spend_Pace_Percent: safeDivide_(totals.mtdSpend, totals.expectedSpend),
    Average_Optimization_Score: totals.optimizationScoreCount > 0
        ? totals.optimizationScoreTotal / totals.optimizationScoreCount
        : null,
    Active_Recommendations: totals.recommendations,
    Low_Risk_Recommendations: totals.lowRiskRecommendations,
    Medium_Risk_Recommendations: totals.mediumRiskRecommendations,
    High_Risk_Recommendations: totals.highRiskRecommendations,
    Active_Experiments: totals.experiments,
    Changes_Last_24_Hours: totals.changes24,
    Changes_Last_7_Days: totals.changes7,
    Hub_Internal_Summary: summary
  };
}

function buildHubRollupSummary_(totals, currency, accountCount) {
  const parts = [];
  parts.push(
      'Google Ads Hub health: ' + totals.healthy + ' healthy, ' +
      totals.watch + ' watch, and ' + totals.needsAttention +
      ' needs attention across ' + accountCount + ' accounts.'
  );

  if (currency !== 'MULTI') {
    parts.push(
        'Yesterday: ' + formatMoney_(totals.yesterdaySpend, currency) +
        ' spend against ' + formatMoney_(totals.dailyBudget, currency) +
        ' in configured or estimated average daily budgets, with ' +
        formatNumberText_(totals.yesterdayConversions) + ' conversions.'
    );
    parts.push(
        'MTD: ' + formatMoney_(totals.mtdSpend, currency) +
        ' spend against ' + formatMoney_(totals.monthlyBudget, currency) +
        ' in monthly budgets at ' +
        formatMoneyOrDash_(safeDivide_(totals.mtdSpend, totals.mtdConversions), currency) +
        ' CPL.'
    );
  } else {
    parts.push('This digest covers multiple currencies, so monetary totals require separate review.');
  }

  parts.push(
      totals.recommendations + ' active recommendations (' +
      totals.lowRiskRecommendations + ' low, ' +
      totals.mediumRiskRecommendations + ' medium, ' +
      totals.highRiskRecommendations + ' high risk), ' +
      totals.experiments + ' active experiments, and ' +
      totals.changes24 + ' verified changes in the last 24 hours.'
  );
  return parts.join(' ');
}


function paceStatus_(pace, isConfigured) {
  return paceStatusWithTolerance_(
      pace, isConfigured, ENGINE_CONFIG.DEFAULT_PACE_TOLERANCE);
}


function cplStatus_(cpl, targetCpl) {
  if (!targetCpl) {
    return 'Not configured';
  }
  if (cpl === null) {
    return 'No conversions';
  }
  if (cpl > targetCpl * 1.10) {
    return 'Above target';
  }
  if (cpl < targetCpl * 0.90) {
    return 'Below target';
  }
  return 'Near target';
}

function dailyBudgetStatus_(utilization, isConfigured) {
  if (!isConfigured || utilization === null) {
    return 'Not configured';
  }
  if (utilization === 0) {
    return 'No spend';
  }
  if (utilization > 2.05) {
    return 'Above 2× daily average';
  }
  if (utilization > 1.15) {
    return 'Above daily average';
  }
  if (utilization < 0.50) {
    return 'Below daily average';
  }
  return 'Near daily average';
}

function sendInternalEmails_(results, runDate, batchMeta) {
  try {
    if (AdsApp.getExecutionInfo().isPreview()) {
      console.log('Preview mode: HTML emails were not sent.');
      return;
    }
  } catch (error) {
    console.warn('Unable to confirm preview state; emails were not sent.');
    return;
  }

  const meta = batchMeta || {};
  const grouped = {};
  for (let i = 0; i < results.length; i++) {
    const recipientList = normalizeRecipientList_(results[i].managerEmail);
    if (!recipientList) {
      continue;
    }
    if (!grouped[recipientList]) {
      grouped[recipientList] = [];
    }
    grouped[recipientList].push(results[i]);
  }

  for (const managerRecipients in grouped) {
    if (!Object.prototype.hasOwnProperty.call(grouped, managerRecipients)) {
      continue;
    }

    let recipientResults = grouped[managerRecipients].slice();
    if (ENGINE_CONFIG.EMAIL_SORT_ACCOUNTS_BY_HEALTH) {
      recipientResults.sort(compareAccountHealth_);
    }

    const problemItems = collectProblemAlertsFromResults_(recipientResults);
    const problemGroups = groupProblemAlertsByAccount_(problemItems);
    const hasProblems = problemItems.length > 0;
    let hasMoneyBackShops = false;
    for (let m = 0; m < recipientResults.length; m++) {
      if (isResultInMoneyBackGuarantee_(recipientResults[m], runDate)) {
        hasMoneyBackShops = true;
        break;
      }
    }

    if (!hasProblems &&
        !hasMoneyBackShops &&
        ENGINE_CONFIG.EMAIL_PROBLEM_FIRST &&
        !ENGINE_CONFIG.EMAIL_SEND_ALL_CLEAR) {
      console.log('No problems for ' + managerRecipients + ' — skipped digest.');
      continue;
    }

    let toRecipients = managerRecipients;
    if (ENGINE_CONFIG.EMAIL_INCLUDE_CSM_ON_PROBLEMS) {
      const csmParts = [managerRecipients];
      for (let r = 0; r < recipientResults.length; r++) {
        if (accountNeedsCsmEmailVisibility_(recipientResults[r], runDate) &&
            recipientResults[r].csmEmail) {
          csmParts.push(recipientResults[r].csmEmail);
        }
      }
      toRecipients = normalizeRecipientList_(csmParts.join(',')) || managerRecipients;
    }

    const hubRollup = buildHubRollupRow_(recipientResults, runDate);
    if (Object.prototype.hasOwnProperty.call(meta, 'remainingDue')) {
      hubRollup.Remaining_Due_Today = meta.remainingDue;
    }
    if (Object.prototype.hasOwnProperty.call(meta, 'enabledCount')) {
      hubRollup.Enabled_Account_Count = meta.enabledCount;
    }
    const subject = buildHtmlEmailSubject_(
        hubRollup, runDate, problemGroups.length, problemItems.length);
    const plainBody = buildPlainTextEmail_(
        recipientResults,
        hubRollup,
        runDate
    );
    const htmlBody = buildHtmlEmail_(
        recipientResults,
        hubRollup,
        runDate
    );

    const inlineImages = {};
    inlineImages[ENGINE_CONFIG.BRAND_LOGO_CID] = getBuiltByShahEmailLogoBlob_();

    MailApp.sendEmail({
      to: toRecipients,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody,
      inlineImages: inlineImages,
      name: ENGINE_CONFIG.EMAIL_SENDER_NAME
    });

    console.log(
        'Sent Google Ads Account Status email to: ' + toRecipients +
        ' (alerts: ' + problemItems.length +
        ', accounts in email: ' + recipientResults.length +
        ', remaining due today: ' +
        (hubRollup.Remaining_Due_Today === undefined
            ? 'n/a'
            : hubRollup.Remaining_Due_Today) + ')'
    );
  }
}

function buildRunMessage_(failures, skippedCount) {
  const parts = [];
  if (skippedCount > 0) {
    parts.push(skippedCount + ' account(s) disabled in CONFIG');
  }
  if (failures.length > 0) {
    const names = [];
    for (let i = 0; i < failures.length; i++) {
      names.push(failures[i].accountName || failures[i].accountId || 'Unknown');
    }
    parts.push('Failures: ' + names.join(', '));
  }
  return parts.length > 0 ? parts.join(' | ') : 'Run completed successfully';
}

