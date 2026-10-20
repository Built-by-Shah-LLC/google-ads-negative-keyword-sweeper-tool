import type { RecoveryChannel, RecoveryCoverage, RecoveryConversionKind, RecoveryPolicy, RecoveryScope, RecoveryExclusionDetails, RecoveryCampaignContext, RecoveryAttachment } from "./contract.js";
import { collectRecoveryContext } from "./context.js";
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
  details?: RecoveryExclusionDetails;
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
  origin?: string;
  type?: string;
  alwaysUseDefaultValue?: boolean | null;
  defaultValue?: string | null;
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
  campaignContexts?: Record<string, RecoveryCampaignContext>;
  campaignGoalActionIds?: Record<string, string[]>;
  contextTruncatedCampaignIds?: string[];
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
  if (["PURCHASE", "STORE_SALE"].includes(category)) return "revenue";
  if (["SUBMIT_LEAD_FORM", "PHONE_CALL_LEAD", "CONTACT", "BOOK_APPOINTMENT", "REQUEST_QUOTE"].includes(category)) return "raw_lead";
  return "ignore";
}
export async function collectRecoverySources(reader: RecoveryReader, request: {
  customerId: string;
  timeZone: string;
  currencyCode: string;
  policy: RecoveryPolicy;
  campaignNameContains: string | null;
}, now = new Date()): Promise<RecoverySources> {
  if (!/^\d{10}$/.test(request.customerId)) throw new Error("Invalid persisted customer ID.");
  const dates = recoveryDates(request.timeZone, now);
  const campaignNameFilter = request.campaignNameContains?.trim() || null;
  const campaignNameNeedle = campaignNameFilter?.toLocaleLowerCase("en-US") ?? null;
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
  async function query(source: string, gaql: string, customer = request.customerId, limit = 20000): Promise<Record<string, unknown>[]> {
    try {
      const rows = await reader.searchStream(customer, gaql + " LIMIT " + String(limit === 10000 ? limit : limit + 1));
      const capped = limit === 10000 ? rows.length >= limit : rows.length > limit;
      result.coverage.push({
        source,
        available: !capped,
        detail: capped ? "Source reached its " + limit.toLocaleString("en-US") + "-row bound; coverage is partial." : "Google Ads reported rows collected."
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
  const campaigns = await query("campaigns", "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.primary_status_reasons FROM campaign WHERE campaign.status != 'REMOVED'");
  const campaignDirectory = new Map<string, RecoveryAttachment>();
  for (const row of campaigns) {
    const campaign = record(row.campaign),
      id = string(campaign.id),
      name = string(campaign.name),
      channel = string(campaign.advertisingChannelType);
    if (!/^\d+$/.test(id) || campaignNameNeedle !== null && !name.toLocaleLowerCase("en-US").includes(campaignNameNeedle)) continue;
    campaignDirectory.set(id, { campaignId: id, campaignName: name || null, channel: channel || null, status: string(campaign.status) || null });
    if (!["SEARCH", "PERFORMANCE_MAX"].includes(channel)) continue;
    result.campaigns.push({
      id,
      name,
      channel: channel as RecoveryChannel,
      status: string(campaign.status),
      reasons: Array.isArray(campaign.primaryStatusReasons) ? campaign.primaryStatusReasons.map(string) : []
    });
  }
  result.coverage.push({
    source: "campaign_name_filter",
    available: true,
    detail: campaignNameFilter === null ? "Campaign-name filtering is disabled; every campaign name is eligible." : `Only campaign names containing ${JSON.stringify(campaignNameFilter)} case-insensitively are eligible.`
  });
  const campaignNegatives = await query("campaign_negatives", "SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.status != 'REMOVED'");
  for (const row of campaignNegatives) {
    const criterion = record(row.campaignCriterion),
      keyword = record(criterion.keyword),
      matchType = string(keyword.matchType),
      campaignId = string(record(row.campaign).id);
    if (!campaignDirectory.has(campaignId)) continue;
    if (types.has(matchType)) result.exclusions.push({
      resource: string(criterion.resourceName),
      text: string(keyword.text),
      kind: "keyword",
      scope: "campaign",
      matchType: matchType as "EXACT" | "PHRASE" | "BROAD",
      campaignIds: [campaignId],
      adGroupId: null,
      adGroupName: null
    });
  }
  const groupNegatives = await query("ad_group_negatives", "SELECT campaign.id, ad_group.id, ad_group.name, ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'");
  for (const row of groupNegatives) {
    const criterion = record(row.adGroupCriterion),
      keyword = record(criterion.keyword),
      group = record(row.adGroup),
      matchType = string(keyword.matchType),
      campaignId = string(record(row.campaign).id);
    if (!campaignDirectory.has(campaignId)) continue;
    if (types.has(matchType)) result.exclusions.push({
      resource: string(criterion.resourceName),
      text: string(keyword.text),
      kind: "keyword",
      scope: "ad_group",
      matchType: matchType as "EXACT" | "PHRASE" | "BROAD",
      campaignIds: [campaignId],
      adGroupId: string(group.id),
      adGroupName: string(group.name)
    });
  }
  const sets = await query("shared_sets", "SELECT shared_set.resource_name, shared_set.name, shared_set.type FROM shared_set WHERE shared_set.status != 'REMOVED'");
  const names = new Map(sets.map(row => {
    const set = record(row.sharedSet);
    return [string(set.resourceName), string(set.name)];
  }));
  const attachments = (await query("shared_attachments", "SELECT campaign.id, campaign_shared_set.resource_name, campaign_shared_set.shared_set FROM campaign_shared_set WHERE campaign_shared_set.status = 'ENABLED' AND campaign.status != 'REMOVED'")).filter(row => campaignDirectory.has(string(record(row.campaign).id)));
  const bySet = new Map<string, string[]>();
  for (const row of attachments) {
    const key = string(record(row.campaignSharedSet).sharedSet);
    bySet.set(key, [...(bySet.get(key) ?? []), string(record(row.campaign).id)]);
  }
  const accountAttachments = await query("account_negatives", "SELECT customer_negative_criterion.resource_name, customer_negative_criterion.negative_keyword_list.shared_set FROM customer_negative_criterion WHERE customer_negative_criterion.type = 'NEGATIVE_KEYWORD_LIST'");
  const accountSets = new Set(accountAttachments.map(row => string(record(record(row.customerNegativeCriterion).negativeKeywordList).sharedSet)));
  // Account lists affect matching Search/Shopping inventory, including eligible campaign types outside this report's ranking scope.
  const accountCampaigns = [...campaignDirectory.values()].filter(c => ["SEARCH", "PERFORMANCE_MAX", "SHOPPING", "MULTI_CHANNEL", "SMART", "LOCAL"].includes(c.channel ?? "")).map(c => c.campaignId);
  // v25 account keywords live in the attached account-level shared list, not a customer criterion keyword field.
  function details(resourceId: string, set: string | null, ids: string[]): RecoveryExclusionDetails {
    const links = set === null ? [] : [...attachments.filter(row => string(record(row.campaignSharedSet).sharedSet) === set).map(row => string(record(row.campaignSharedSet).resourceName)), ...accountAttachments.filter(row => string(record(record(row.customerNegativeCriterion).negativeKeywordList).sharedSet) === set).map(row => string(record(row.customerNegativeCriterion).resourceName))];
    return { resourceId, listResourceId: set, listName: set ? names.get(set) ?? null : null, attachmentResourceIds: links.slice(0, 200), campaigns: [...new Set(ids)].slice(0, 200).map(id => campaignDirectory.get(id) ?? { campaignId: id, campaignName: null, channel: null, status: null }), detailsComplete: ids.length <= 200 && links.length <= 200 && ids.every(id => campaignDirectory.has(id)) && (set === null || names.has(set)) && result.coverage.filter(c => ["campaigns", "shared_sets", "shared_attachments", "account_negatives"].includes(c.source)).every(c => c.available), brandMembers: [] };
  }
  for (const exclusion of result.exclusions) exclusion.details = details(exclusion.resource, null, exclusion.campaignIds);
  const shared = await query("shared_keywords", "SELECT shared_criterion.resource_name, shared_criterion.shared_set, shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.type IN ('NEGATIVE_KEYWORDS','ACCOUNT_LEVEL_NEGATIVE_KEYWORDS') AND shared_set.status != 'REMOVED'");
  for (const row of shared) {
    const criterion = record(row.sharedCriterion),
      keyword = record(criterion.keyword),
      set = string(criterion.sharedSet),
      matchType = string(keyword.matchType),
      campaignIds = accountSets.has(set) ? accountCampaigns : [...new Set(bySet.get(set) ?? [])];
    if (!types.has(matchType)) continue;
    if (!campaignIds.length && campaignNameFilter !== null) continue;
    result.exclusions.push({
      resource: string(criterion.resourceName),
      text: string(keyword.text),
      kind: "keyword",
      scope: accountSets.has(set) ? "account" : "shared_list",
      matchType: matchType as "EXACT" | "PHRASE" | "BROAD",
      campaignIds,
      adGroupId: null,
      adGroupName: null,
      details: details(string(criterion.resourceName), set, campaignIds)
    });
  }
  const brands = await query("brand_exclusions", "SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.brand_list.shared_set FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'BRAND_LIST' AND campaign_criterion.status != 'REMOVED'");
  for (const row of brands) {
    const criterion = record(row.campaignCriterion),
      set = string(record(criterion.brandList).sharedSet),
      campaignId = string(record(row.campaign).id);
    if (!campaignDirectory.has(campaignId)) continue;
    result.exclusions.push({
      resource: string(criterion.resourceName),
      text: names.get(set) ?? "Brand exclusion list",
      kind: "brand",
      scope: "brand",
      matchType: null,
      campaignIds: [campaignId],
      adGroupId: null,
      adGroupName: null,
      details: { ...details(string(criterion.resourceName), set, [campaignId]), attachmentResourceIds: [string(criterion.resourceName)] }
    });
  }
  const members = await query("brand_members", "SELECT shared_criterion.shared_set, shared_criterion.brand.entity_id, shared_criterion.brand.display_name, shared_criterion.brand.status FROM shared_criterion WHERE shared_criterion.type = 'BRAND' AND shared_set.status != 'REMOVED'");
  for (const exclusion of result.exclusions.filter(e => e.kind === "brand")) {
    const matching = members.filter(row => string(record(row.sharedCriterion).sharedSet) === exclusion.details?.listResourceId);
    exclusion.details!.brandMembers = matching.slice(0, 100).map(row => { const brand = record(record(row.sharedCriterion).brand); return { entityId: string(brand.entityId), name: string(brand.displayName), status: string(brand.status) }; });
    exclusion.details!.detailsComplete &&= matching.length <= 100 && result.coverage.find(c => c.source === "brand_members")?.available === true;
  }
  if (result.exclusions.some(exclusion => exclusion.details?.detailsComplete === false)) result.coverage.push({ source: "exclusion_details", available: false, detail: "Some attachment/list/member details are unavailable or exceed the 200-attachment / 100-brand-member bounds; affected rows require review." });
  const actions = await query("conversion_actions", "SELECT conversion_action.resource_name, conversion_action.name, conversion_action.category, conversion_action.origin, conversion_action.type, conversion_action.primary_for_goal, conversion_action.value_settings.always_use_default_value, conversion_action.value_settings.default_value FROM conversion_action WHERE conversion_action.status != 'REMOVED'", result.conversionOwner);
  for (const row of actions) {
    const action = record(row.conversionAction),
      resource = string(action.resourceName),
      category = string(action.category);
    result.actions.push({
      resource,
      name: string(action.name),
      category,
      kind: request.policy.conversionActions[resource] ?? actionKind(category),
      primary: action.primaryForGoal === true,
      origin: string(action.origin),
      type: string(action.type),
      alwaysUseDefaultValue: typeof record(action.valueSettings).alwaysUseDefaultValue === "boolean" ? record(action.valueSettings).alwaysUseDefaultValue as boolean : null,
      defaultValue: sourceDecimal(record(action.valueSettings).defaultValue)
    });
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
  await collectRecoveryContext(query, result, request, now);
  return result;
}
