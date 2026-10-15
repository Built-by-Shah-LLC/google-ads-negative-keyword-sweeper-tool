import type { RecoveryChannel, RecoveryCoverage, RecoveryConversionKind, RecoveryPolicy, RecoveryScope } from "./contract.js";
import { recoveryDates } from "./scoring.js";
export interface RecoveryCampaign {
  id: string;
  name: string;
  channel: RecoveryChannel;
  status: string;
  reasons: string[];
}
export interface RecoveryExclusion {
  resource: string;
  text: string;
  kind: "keyword" | "brand";
  scope: RecoveryScope;
  matchType: "EXACT" | "PHRASE" | "BROAD" | null;
  campaignIds: string[];
  adGroupId: string | null;
  adGroupName: string | null;
}
export interface RecoveryFact {
  key: string;
  campaignId: string;
  adGroupId: string | null;
  channel: RecoveryChannel;
  query: string;
  date: string;
  impressions: string | null;
  clicks: string | null;
  costMicros: string | null;
}
export interface RecoveryConversionFact {
  key: string;
  action: string;
  events: string | null;
  value: string | null;
}
export interface RecoveryConversionAction {
  resource: string;
  name: string;
  category: string;
  kind: RecoveryConversionKind;
  primary: boolean;
}
export interface RecoverySources {
  campaigns: RecoveryCampaign[];
  exclusions: RecoveryExclusion[];
  facts: RecoveryFact[];
  conversionFacts: RecoveryConversionFact[];
  actions: RecoveryConversionAction[];
  coverage: RecoveryCoverage[];
  dates: ReturnType<typeof recoveryDates>;
  goalCategories: string[];
  conversionOwner: string;
  campaignGoalLevels?: Record<string, string>;
}
export interface RecoveryReader {
  searchStream(customerId: string, query: string): Promise<Record<string, unknown>[]>;
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export const string = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
export function sourceDecimal(value: unknown): string | null {
  const text = string(value);
  return /^[0-9]{1,30}(?:\.[0-9]{1,12})?$/.test(text) ? text : null;
}
const types = new Set(["EXACT", "PHRASE", "BROAD"]);
export function factKey(campaign: string, group: string | null, query: string, date: string): string {
  return JSON.stringify([campaign, group, query, date]);
}
export function actionKind(category: string): RecoveryConversionKind {
  if (["QUALIFIED_LEAD", "CONVERTED_LEAD"].includes(category)) return "qualified_lead";
  if (category === "PURCHASE") return "revenue";
  if (["SUBMIT_LEAD_FORM", "PHONE_CALL_LEAD", "CONTACT", "BOOK_APPOINTMENT", "REQUEST_QUOTE"].includes(category)) return "raw_lead";
  return "ignore";
}
export async function collectRecoverySources(reader: RecoveryReader, request: {
  customerId: string;
  timeZone: string;
  currencyCode: string;
  policy: RecoveryPolicy;
}, now = new Date()): Promise<RecoverySources> {
  if (!/^\d{10}$/.test(request.customerId)) throw new Error("Invalid persisted customer ID.");
  const dates = recoveryDates(request.timeZone, now);
  const result: RecoverySources = {
    campaigns: [],
    exclusions: [],
    facts: [],
    conversionFacts: [],
    actions: [],
    coverage: [],
    dates,
    goalCategories: [],
    conversionOwner: request.customerId
  };
  const limit = 20000;
  async function query(source: string, gaql: string, customer = request.customerId): Promise<Record<string, unknown>[]> {
    try {
      const rows = await reader.searchStream(customer, gaql + " LIMIT " + String(limit + 1));
      const capped = rows.length > limit;
      result.coverage.push({
        source,
        available: !capped,
        detail: capped ? "Source exceeded the 20,000-row bound; coverage is partial." : "Google Ads reported rows collected."
      });
      return rows.slice(0, limit);
    } catch {
      result.coverage.push({
        source,
        available: false,
        detail: "This source could not be read; dependent findings require review."
      });
      return [];
    }
  }
  const customerRows = await query("account_metadata", "SELECT customer.id, customer.time_zone, customer.currency_code, customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer");
  const customer = record(customerRows[0]?.customer);
  if (string(customer.id) !== request.customerId || string(customer.timeZone) !== request.timeZone || string(customer.currencyCode) !== request.currencyCode) throw new Error("Account metadata does not match the persisted request.");
  const owner = string(record(customer.conversionTrackingSetting).googleAdsConversionCustomer);
  if (owner) {
    if (!/^customers\/[0-9]+$/.test(owner)) throw new Error("Invalid conversion-owner identity.");
    result.conversionOwner = owner.split("/")[1]!;
  }
  const campaigns = await query("campaigns", "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.primary_status_reasons FROM campaign WHERE campaign.status != 'REMOVED' AND campaign.advertising_channel_type IN ('SEARCH','PERFORMANCE_MAX')");
  for (const row of campaigns) {
    const campaign = record(row.campaign),
      channel = string(campaign.advertisingChannelType);
    if (!["SEARCH", "PERFORMANCE_MAX"].includes(channel) || !/^\d+$/.test(string(campaign.id))) continue;
    result.campaigns.push({
      id: string(campaign.id),
      name: string(campaign.name),
      channel: channel as RecoveryChannel,
      status: string(campaign.status),
      reasons: Array.isArray(campaign.primaryStatusReasons) ? campaign.primaryStatusReasons.map(string) : []
    });
  }
  const campaignNegatives = await query("campaign_negatives", "SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.status != 'REMOVED'");
  for (const row of campaignNegatives) {
    const criterion = record(row.campaignCriterion),
      keyword = record(criterion.keyword),
      matchType = string(keyword.matchType);
    if (types.has(matchType)) result.exclusions.push({
      resource: string(criterion.resourceName),
      text: string(keyword.text),
      kind: "keyword",
      scope: "campaign",
      matchType: matchType as "EXACT" | "PHRASE" | "BROAD",
      campaignIds: [string(record(row.campaign).id)],
      adGroupId: null,
      adGroupName: null
    });
  }
  const groupNegatives = await query("ad_group_negatives", "SELECT campaign.id, ad_group.id, ad_group.name, ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'");
  for (const row of groupNegatives) {
    const criterion = record(row.adGroupCriterion),
      keyword = record(criterion.keyword),
      group = record(row.adGroup),
      matchType = string(keyword.matchType);
    if (types.has(matchType)) result.exclusions.push({
      resource: string(criterion.resourceName),
      text: string(keyword.text),
      kind: "keyword",
      scope: "ad_group",
      matchType: matchType as "EXACT" | "PHRASE" | "BROAD",
      campaignIds: [string(record(row.campaign).id)],
      adGroupId: string(group.id),
      adGroupName: string(group.name)
    });
  }
  const sets = await query("shared_sets", "SELECT shared_set.resource_name, shared_set.name, shared_set.type FROM shared_set WHERE shared_set.status != 'REMOVED'");
  const names = new Map(sets.map(row => {
    const set = record(row.sharedSet);
    return [string(set.resourceName), string(set.name)];
  }));
  const attachments = await query("shared_attachments", "SELECT campaign.id, campaign_shared_set.shared_set FROM campaign_shared_set WHERE campaign_shared_set.status = 'ENABLED'");
  const bySet = new Map<string, string[]>();
  for (const row of attachments) {
    const key = string(record(row.campaignSharedSet).sharedSet);
    bySet.set(key, [...(bySet.get(key) ?? []), string(record(row.campaign).id)]);
  }
  const accountAttachments = await query("account_negatives", "SELECT customer_negative_criterion.resource_name, customer_negative_criterion.negative_keyword_list.shared_set FROM customer_negative_criterion WHERE customer_negative_criterion.type = 'NEGATIVE_KEYWORD_LIST'");
  const accountSets = new Set(accountAttachments.map(row => string(record(record(row.customerNegativeCriterion).negativeKeywordList).sharedSet)));
  const shared = await query("shared_keywords", "SELECT shared_criterion.resource_name, shared_criterion.shared_set, shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.type IN ('NEGATIVE_KEYWORDS','ACCOUNT_LEVEL_NEGATIVE_KEYWORDS') AND shared_set.status != 'REMOVED'");
  for (const row of shared) {
    const criterion = record(row.sharedCriterion),
      keyword = record(criterion.keyword),
      set = string(criterion.sharedSet),
      matchType = string(keyword.matchType);
    if (!types.has(matchType)) continue;
    result.exclusions.push({
      resource: string(criterion.resourceName),
      text: string(keyword.text),
      kind: "keyword",
      scope: accountSets.has(set) ? "account" : "shared_list",
      matchType: matchType as "EXACT" | "PHRASE" | "BROAD",
      campaignIds: accountSets.has(set) ? result.campaigns.map(c => c.id) : [...new Set(bySet.get(set) ?? [])],
      adGroupId: null,
      adGroupName: null
    });
  }
  const brands = await query("brand_exclusions", "SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.brand_list.shared_set FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'BRAND_LIST' AND campaign_criterion.status != 'REMOVED'");
  for (const row of brands) {
    const criterion = record(row.campaignCriterion),
      set = string(record(criterion.brandList).sharedSet);
    result.exclusions.push({
      resource: string(criterion.resourceName),
      text: names.get(set) ?? "Brand exclusion list",
      kind: "brand",
      scope: "brand",
      matchType: null,
      campaignIds: [string(record(row.campaign).id)],
      adGroupId: null,
      adGroupName: null
    });
  }
  const actions = await query("conversion_actions", "SELECT conversion_action.resource_name, conversion_action.name, conversion_action.category, conversion_action.type, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status != 'REMOVED'", result.conversionOwner);
  for (const row of actions) {
    const action = record(row.conversionAction),
      resource = string(action.resourceName),
      category = string(action.category);
    result.actions.push({
      resource,
      name: string(action.name),
      category,
      kind: request.policy.conversionActions[resource] ?? actionKind(category),
      primary: action.primaryForGoal === true
    });
  }
  const goals = await query("conversion_goals", "SELECT customer_conversion_goal.category, customer_conversion_goal.biddable FROM customer_conversion_goal");
  result.goalCategories = goals.filter(row => record(row.customerConversionGoal).biddable === true).map(row => string(record(row.customerConversionGoal).category));
  const campaignGoals = await query("campaign_goal_configuration", "SELECT conversion_goal_campaign_config.campaign, conversion_goal_campaign_config.goal_config_level, conversion_goal_campaign_config.custom_conversion_goal FROM conversion_goal_campaign_config");
  result.campaignGoalLevels = {};
  for (const row of campaignGoals) {
    const goal = record(row.conversionGoalCampaignConfig),
      id = string(goal.campaign).split("/").at(-1);
    if (id) result.campaignGoalLevels[id] = string(goal.customConversionGoal) ? "CUSTOM" : string(goal.goalConfigLevel);
  }
  const active = new Set(result.campaigns.filter(c => c.status === "ENABLED").map(c => c.id));
  for (const channel of ["SEARCH", "PERFORMANCE_MAX"] as const) {
    const view = channel === "SEARCH" ? "search_term_view" : "campaign_search_term_view";
    const group = channel === "SEARCH" ? "ad_group.id, " : "";
    const where = " WHERE segments.date BETWEEN '" + dates.startDate + "' AND '" + dates.endDate + "' AND campaign.advertising_channel_type = '" + channel + "' AND campaign.status = 'ENABLED'";
    const rows = await query(channel + "_traffic", "SELECT campaign.id, " + group + view + ".search_term, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros FROM " + view + where);
    const dedupe = new Set<string>();
    for (const row of rows) {
      const campaignId = string(record(row.campaign).id),
        adGroupId = channel === "SEARCH" ? string(record(row.adGroup).id) : null,
        queryText = string(record(row[view === "search_term_view" ? "searchTermView" : "campaignSearchTermView"]).searchTerm),
        date = string(record(row.segments).date),
        metrics = record(row.metrics);
      if (!active.has(campaignId) || !queryText || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const key = factKey(campaignId, adGroupId, queryText, date);
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      result.facts.push({
        key,
        campaignId,
        adGroupId,
        channel,
        query: queryText,
        date,
        impressions: sourceDecimal(metrics.impressions),
        clicks: sourceDecimal(metrics.clicks),
        costMicros: sourceDecimal(metrics.costMicros)
      });
    }
    const conversions = await query(channel + "_conversion_events", "SELECT campaign.id, " + group + view + ".search_term, segments.date, segments.conversion_action, metrics.all_conversions, metrics.all_conversions_value FROM " + view + where);
    const seen = new Set<string>();
    for (const row of conversions) {
      const campaignId = string(record(row.campaign).id),
        adGroupId = channel === "SEARCH" ? string(record(row.adGroup).id) : null,
        queryText = string(record(row[view === "search_term_view" ? "searchTermView" : "campaignSearchTermView"]).searchTerm),
        segments = record(row.segments),
        metrics = record(row.metrics),
        date = string(segments.date),
        action = string(segments.conversionAction);
      if (!active.has(campaignId) || !queryText || !action) continue;
      const key = factKey(campaignId, adGroupId, queryText, date),
        unique = key + "|" + action;
      if (seen.has(unique)) continue;
      seen.add(unique);
      result.conversionFacts.push({
        key,
        action,
        events: sourceDecimal(metrics.allConversions),
        value: sourceDecimal(metrics.allConversionsValue)
      });
    }
  }
  result.coverage.push({
    source: "conversion_diagnostics",
    available: false,
    detail: "Tag and import diagnostics are not inferred from action names. Confirm unresolved measurement warnings before a future pilot."
  });
  result.coverage.push({source:"delivery_change_context",available:false,
    detail:"Budget, bidding and recent change-history context is not collected in this first implementation. Low volume must not be attributed to exclusions from this report alone."});
  return result;
}
