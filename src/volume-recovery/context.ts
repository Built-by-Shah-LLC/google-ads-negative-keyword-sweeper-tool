import type { RecoveryCampaignContext, RecoveryPeriod } from "./contract.js";
import type { RecoverySources } from "./sources.js";
import { record, sourceDecimal, string } from "./sources.js";
import { decimal, fraction, sumDecimals } from "./scoring.js";
type Query = (source: string, gaql: string, customer?: string, limit?: number) => Promise<Record<string, unknown>[]>;
const offset = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export function microsToMoney(value: unknown): string | null {
  const amount = sourceDecimal(value);
  return amount === null ? null : decimal({ n: fraction(amount).n, d: fraction(amount).d * 1000000n }, 6);
}
// Context explains competing causes of low volume. It never supplies query-level outcomes or removal authority.
export async function collectRecoveryContext(query: Query, sources: RecoverySources, request: {
  customerId: string;
  timeZone: string;
}, now: Date): Promise<void> {
  const where = " WHERE campaign.status != 'REMOVED' AND campaign.advertising_channel_type IN ('SEARCH','PERFORMANCE_MAX')";
  const campaigns = await query("delivery_context", "SELECT campaign.id, campaign.serving_status, campaign.primary_status, campaign.primary_status_reasons, campaign.campaign_budget, campaign.bidding_strategy, campaign.bidding_strategy_type, campaign.bidding_strategy_system_status, campaign.maximize_conversions.target_cpa_micros, campaign.target_cpa.target_cpa_micros, campaign.maximize_conversion_value.target_roas, campaign.target_roas.target_roas FROM campaign" + where);
  const budgets = await query("budget_context", "SELECT campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.period, campaign_budget.explicitly_shared FROM campaign_budget WHERE campaign_budget.status != 'REMOVED'");
  const portfolios = await query("portfolio_bidding_context", "SELECT accessible_bidding_strategy.resource_name, accessible_bidding_strategy.maximize_conversions.target_cpa_micros, accessible_bidding_strategy.target_cpa.target_cpa_micros, accessible_bidding_strategy.maximize_conversion_value.target_roas, accessible_bidding_strategy.target_roas.target_roas FROM accessible_bidding_strategy");
  const customerGoals = await query("conversion_goals", "SELECT customer_conversion_goal.category, customer_conversion_goal.origin, customer_conversion_goal.biddable FROM customer_conversion_goal");
  const campaignGoals = await query("campaign_goal_context", "SELECT campaign_conversion_goal.campaign, campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal");
  const configs = await query("campaign_goal_configuration", "SELECT conversion_goal_campaign_config.campaign, conversion_goal_campaign_config.goal_config_level, conversion_goal_campaign_config.custom_conversion_goal FROM conversion_goal_campaign_config");
  const customGoals = await query("custom_goal_context", "SELECT custom_conversion_goal.resource_name, custom_conversion_goal.conversion_actions FROM custom_conversion_goal WHERE custom_conversion_goal.status != 'REMOVED'");
  const historyStart = offset(sources.dates.endDate, -59);
  const daily = await query("campaign_comparison", "SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign" + where + " AND segments.date BETWEEN '" + historyStart + "' AND '" + sources.dates.endDate + "'");
  // 29 account-local days ending before today stay inside Google's 30-day Change Event window.
  // The explicit 10,000 bound is required by this resource; equality is conservatively partial.
  const changesStart = offset(sources.dates.today, -29);
  const changes = await query("recent_changes", "SELECT change_event.resource_name, change_event.change_date_time, change_event.change_resource_name, change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields, change_event.campaign FROM change_event WHERE change_event.change_date_time >= '" + changesStart + " 00:00:00' AND change_event.change_date_time < '" + sources.dates.today + " 00:00:00' ORDER BY change_event.change_date_time DESC", request.customerId, 10000);
  const available = (name: string) => sources.coverage.some(c => c.source === name && c.available);
  const budgetMap = new Map(budgets.map(row => { const b = record(row.campaignBudget); return [string(b.resourceName), b]; }));
  const portfolioMap = new Map(portfolios.map(row => { const b = record(row.accessibleBiddingStrategy); return [string(b.resourceName).split("/").at(-1), b]; }));
  const configMap = new Map(configs.map(row => { const g = record(row.conversionGoalCampaignConfig); return [string(g.campaign).split("/").at(-1), g]; }));
  const customMap = new Map(customGoals.map(row => { const g = record(row.customConversionGoal); return [string(g.resourceName), g]; }));
  const campaignMap = new Map(campaigns.map(row => [string(record(row.campaign).id), record(row.campaign)]));
  const goalKey = (goal: Record<string, unknown>) => string(goal.category) + "/" + string(goal.origin);
  const positiveTarget = (value: unknown): string | null => { const target = sourceDecimal(value); return target !== null && fraction(target).n > 0n ? target : null; };
  const dailyByCampaign = new Map<string, Map<string, Record<string, unknown>>>();
  for (const row of daily) {
    const id = string(record(row.campaign).id), date = string(record(row.segments).date);
    if (date < historyStart || date > sources.dates.endDate)
      continue;
    const dates = dailyByCampaign.get(id) ?? new Map();
    dates.set(date, record(row.metrics)); // Do not count an accidental repeated source row twice.
    dailyByCampaign.set(id, dates);
  }
  sources.campaignContexts = {};
  sources.campaignGoalActionIds = {};
  sources.goalCategories = [...new Set(customerGoals.map(row => record(row.customerConversionGoal)).filter(g => g.biddable === true).map(g => string(g.category)))];
  sources.campaignGoalLevels = {};
  sources.contextTruncatedCampaignIds = [];
  for (const campaign of sources.campaigns) {
    const row = campaignMap.get(campaign.id), config = configMap.get(campaign.id);
    const strategy = string(row?.biddingStrategy);
    const bidding = strategy ? portfolioMap.get(strategy.split("/").at(-1)) : row;
    const budget = budgetMap.get(string(row?.campaignBudget));
    const customId = string(config?.customConversionGoal);
    const level = customId ? "CUSTOM" : string(config?.goalConfigLevel);
    sources.campaignGoalLevels[campaign.id] = level;
    const goals = level === "CUSTOMER" ? customerGoals.map(row => record(row.customerConversionGoal)) : level === "CAMPAIGN" ? campaignGoals.map(row => record(row.campaignConversionGoal)).filter(g => string(g.campaign).endsWith("/" + campaign.id)) : [];
    const keys = [...new Set(goals.filter(g => g.biddable === true).map(goalKey))];
    const customActions = customMap.get(customId)?.conversionActions;
    const goalComplete = available("campaign_goal_configuration") && (level === "CUSTOM" ? available("custom_goal_context") && Array.isArray(customActions) : ["CUSTOMER", "CAMPAIGN"].includes(level) && available(level === "CUSTOMER" ? "conversion_goals" : "campaign_goal_context")) && available("conversion_actions");
    const actions = level === "CUSTOM" && Array.isArray(customActions) ? customActions.map(string) : sources.actions.filter(a => a.primary && keys.includes(a.category + "/" + (a.origin ?? ""))).map(a => a.resource);
    if (goalComplete)
      sources.campaignGoalActionIds[campaign.id] = actions;
    const period = (startDate: string, endDate: string): RecoveryPeriod => {
      const rows = [...(dailyByCampaign.get(campaign.id) ?? new Map())].filter(([date]) => date >= startDate && date <= endDate).map(([, metrics]) => metrics);
      const sum = (key: string): string | null => {
        if (!available("campaign_comparison"))
          return null;
        const values = rows.map(row => sourceDecimal(row[key]));
        return values.every((value): value is string => value !== null) ? sumDecimals(values) : null;
      };
      return { startDate, endDate, impressions: sum("impressions"), clicks: sum("clicks"), cost: microsToMoney(sum("costMicros")), conversions: sum("conversions"), conversionValue: sum("conversionsValue") };
    };
    // Account-wide or budget/strategy changes without a campaign association still matter to this campaign.
    const relevant = changes.filter(row => { const event = record(row.changeEvent); return !string(event.campaign) || string(event.campaign).endsWith("/" + campaign.id); });
    const limitations = ["Current budget/bid/goal settings are context, not their historic settings or proof that negatives caused a volume decline.", "Campaign conversion totals use Google's configured goals, not deduplicated people or the selected query-action basis.", "Change Event covers only the stated 29-day window, excludes today, and can omit changes visible in the Ads UI; no legacy author or pre-exclusion date is inferred."];
    if (!goalComplete)
      limitations.push("Effective goal actions could not be fully resolved; account CPA is not assigned to a query action.");
    if (strategy && !bidding)
      limitations.push("Portfolio strategy details are unavailable; no campaign target fallback is assumed.");
    if (relevant.length > 20)
      limitations.push("Only the latest 20 relevant change summaries are retained for this campaign; the change detail is partial.");
    if (actions.length > 100 || keys.length > 100)
      limitations.push("The effective goal display reached its 100-entry bound; the detail is partial.");
    if (relevant.length > 20 || actions.length > 100 || keys.length > 100) sources.contextTruncatedCampaignIds.push(campaign.id);
    for (const name of ["delivery_context", "budget_context", "portfolio_bidding_context", "campaign_comparison", "recent_changes"])
      if (!available(name))
        limitations.push(name + " is unavailable or capped.");
    const context: RecoveryCampaignContext = {
      collectedAt: now.toISOString(), timeZone: request.timeZone, servingStatus: string(row?.servingStatus) || null, primaryStatus: string(row?.primaryStatus) || null,
      primaryStatusReasons: Array.isArray(row?.primaryStatusReasons) ? row.primaryStatusReasons.map(string).slice(0, 100) : [],
      budget: budget ? { resourceId: string(budget.resourceName), amount: microsToMoney(budget.amountMicros), period: string(budget.period), shared: typeof budget.explicitlyShared === "boolean" ? budget.explicitlyShared : null } : null,
      bidding: row && bidding ? { strategyResourceId: strategy || null, type: string(row.biddingStrategyType), status: string(row.biddingStrategySystemStatus) || null, targetCpa: microsToMoney(positiveTarget(record(bidding.maximizeConversions).targetCpaMicros) ?? positiveTarget(record(bidding.targetCpa).targetCpaMicros)), targetRoas: positiveTarget(record(bidding.maximizeConversionValue).targetRoas) ?? positiveTarget(record(bidding.targetRoas).targetRoas), source: strategy ? "portfolio" : "campaign" } : null,
      goals: config ? { level: level || "UNKNOWN", customGoalResourceId: customId || null, biddableGoals: keys.slice(0, 100), actionResourceIds: actions.slice(0, 100) } : null,
      recent: period(offset(sources.dates.endDate, -29), sources.dates.endDate), previous: period(historyStart, offset(sources.dates.endDate, -30)),
      changesStartDate: changesStart, changesEndDate: offset(sources.dates.today, -1),
      changes: relevant.slice(0, 20).map(row => { const event = record(row.changeEvent); const mask = event.changedFields; const paths = typeof mask === "string" ? mask.split(",") : Array.isArray(record(mask).paths) ? record(mask).paths as unknown[] : []; return { resourceId: string(event.changeResourceName), at: string(event.changeDateTime), resourceType: string(event.changeResourceType), operation: string(event.resourceChangeOperation), fields: paths.map(string).slice(0, 100).map(path => path.slice(0, 200)) }; }), limitations
    };
    sources.campaignContexts[campaign.id] = context;
  }
  if (sources.contextTruncatedCampaignIds.length) sources.coverage.push({ source: "context_detail_limit", available: false, detail: "Some campaign change/goal details exceeded the declared per-campaign bounds; affected findings are review-only." });
}
