import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRecovery, recoveryCandidates, boundedRecoveryItem } from "../src/volume-recovery/analysis.js";
import { recoveryBlockers, type BlockerLookup } from "../src/volume-recovery/blockers.js";
import { EMPTY_RECOVERY_POLICY, parseRecoveryItem, validateRecoveryPolicy, type RecoveryPolicy } from "../src/volume-recovery/contract.js";
import { collectRecoverySources, type RecoverySources } from "../src/volume-recovery/sources.js";
import { recoveryScore } from "../src/volume-recovery/scoring.js";
const customerId = "1234567890", action = "customers/1234567890/conversionActions/1";
const now = new Date("2026-10-15T01:00:00Z"); // Still October 14 in this account.
const policy: RecoveryPolicy = { ...EMPTY_RECOVERY_POLICY, categoryActions: { "COMPETITOR-NEGATIVE": "consider" } };
async function fixture(options: {
  fail?: string;
  changes?: number;
  extraGoal?: boolean;
  custom?: boolean;
  purchase?: boolean;
  placeholder?: boolean;
  portfolio?: boolean;
  defaultValue?: string;
  lists?: boolean;
  campaignNameContains?: string | null;
  mixedCampaignNames?: boolean;
} = {}) {
  const calls: string[] = [];
  const data = await collectRecoverySources({ async searchStream(_customer, gaql) {
      calls.push(gaql);
      if (options.fail && gaql.includes(options.fail))
        throw new Error("private provider detail");
      if (gaql.includes(" FROM customer LIMIT"))
        return [{ customer: { id: customerId, timeZone: "America/Los_Angeles", currencyCode: "USD" } }];
      if (options.lists && gaql.includes(" FROM shared_set"))
        return ["10", "20", "30"].map(id => ({ sharedSet: { resourceName: "customers/1234567890/sharedSets/" + id, name: "List " + id } }));
      if (options.lists && gaql.includes(" FROM campaign_shared_set"))
        return ["1", "9"].map(id => ({ campaign: { id }, campaignSharedSet: { resourceName: "customers/1234567890/campaignSharedSets/" + id + "~10", sharedSet: "customers/1234567890/sharedSets/10" } }));
      if (options.lists && gaql.includes(" FROM customer_negative_criterion") && gaql.includes("'NEGATIVE_KEYWORD_LIST'"))
        return [{ customerNegativeCriterion: { resourceName: "customers/1234567890/customerNegativeCriteria/20", negativeKeywordList: { sharedSet: "customers/1234567890/sharedSets/20" } } }];
      if (options.lists && gaql.includes(" FROM shared_criterion") && gaql.includes("'BRAND'"))
        return [{ sharedCriterion: { sharedSet: "customers/1234567890/sharedSets/30", brand: { entityId: "/g/mock", displayName: "Riverton", status: "APPROVED" } } }];
      if (options.lists && gaql.includes(" FROM shared_criterion"))
        return ["10", "20"].map(id => ({ sharedCriterion: { resourceName: "customers/1234567890/sharedCriteria/" + id + "~1", sharedSet: "customers/1234567890/sharedSets/" + id, keyword: { text: "collision repair", matchType: "PHRASE" } } }));
      if (options.lists && gaql.includes(" FROM campaign_criterion") && gaql.includes("'BRAND_LIST'"))
        return [{ campaign: { id: "2" }, campaignCriterion: { resourceName: "customers/1234567890/campaignCriteria/2~30", brandList: { sharedSet: "customers/1234567890/sharedSets/30" } } }];
      if (gaql.includes(" FROM conversion_action"))
        return [{ conversionAction: { resourceName: action, name: options.purchase ? "Sales" : "Lead form", category: options.purchase ? "PURCHASE" : "SUBMIT_LEAD_FORM", origin: "WEBSITE", primaryForGoal: true, type: "WEBPAGE", valueSettings: { alwaysUseDefaultValue: options.placeholder === true, defaultValue: options.defaultValue ?? "1" } } }, ...(options.extraGoal ? [{ conversionAction: { resourceName: action + "2", name: "Calls", category: "PHONE_CALL_LEAD", origin: "CALL_FROM_ADS", primaryForGoal: true } }] : [])];
      if (gaql.includes(" FROM customer_conversion_goal"))
        return [{ customerConversionGoal: { category: options.purchase ? "PURCHASE" : "SUBMIT_LEAD_FORM", origin: "WEBSITE", biddable: true } }, ...(options.extraGoal ? [{ customerConversionGoal: { category: "PHONE_CALL_LEAD", origin: "CALL_FROM_ADS", biddable: true } }] : [])];
      if (gaql.includes(" FROM conversion_goal_campaign_config"))
        return [{ conversionGoalCampaignConfig: { campaign: "customers/1234567890/campaigns/1", goalConfigLevel: "CUSTOMER", ...(options.custom ? { customConversionGoal: "customers/1234567890/customConversionGoals/1" } : {}) } }];
      if (gaql.includes(" FROM custom_conversion_goal"))
        return [{ customConversionGoal: { resourceName: "customers/1234567890/customConversionGoals/1", conversionActions: [action] } }];
      if (gaql.includes(" FROM campaign_budget"))
        return [{ campaignBudget: { resourceName: "customers/1234567890/campaignBudgets/9", amountMicros: "125000000", period: "DAILY", explicitlyShared: true } }];
      if (gaql.includes(" FROM accessible_bidding_strategy"))
        return [{ accessibleBiddingStrategy: { resourceName: "customers/1234567890/accessibleBiddingStrategies/8", targetRoas: { targetRoas: "4" } } }];
      if (gaql.includes(" FROM change_event"))
        return Array.from({ length: options.changes ?? 1 }, (_, index) => ({ changeEvent: { resourceName: "changes/" + index, campaign: "customers/1234567890/campaigns/1", changeResourceName: "customers/1234567890/campaignBudgets/9", changeDateTime: "2026-10-10 12:00:00", changeResourceType: "CAMPAIGN_BUDGET", resourceChangeOperation: "UPDATE", changedFields: "amountMicros", userEmail: "must-not-retain@example.test", oldResource: { secret: true } } }));
      if (gaql.includes(" FROM campaign ") && gaql.includes("segments.date"))
        return [
          { campaign: { id: "1" }, segments: { date: "2026-10-06" }, metrics: { impressions: "520", clicks: "38", costMicros: "304000000", conversions: "3", conversionsValue: "300" } },
          { campaign: { id: "1" }, segments: { date: "2026-08-20" }, metrics: { impressions: "1000", clicks: "50", costMicros: "400000000", conversions: "4", conversionsValue: "400" } }
        ];
      if (gaql.includes(" FROM campaign "))
        return [{ campaign: { id: "1", name: options.mixedCampaignNames ? "Built By Shah - Synthetic Search" : "Synthetic Search", status: "ENABLED", advertisingChannelType: "SEARCH", servingStatus: "SERVING", primaryStatus: "LIMITED", primaryStatusReasons: ["BUDGET_CONSTRAINED"], campaignBudget: "customers/1234567890/campaignBudgets/9", biddingStrategyType: "MAXIMIZE_CONVERSION_VALUE", biddingStrategySystemStatus: "LEARNING", ...(options.portfolio ? { biddingStrategy: "customers/9999999999/biddingStrategies/8" } : {}), maximizeConversionValue: { targetRoas: "4" } } }, ...(options.lists ? [{ campaign: { id: "2", name: options.mixedCampaignNames ? "Other Agency PMax" : "Synthetic PMax", status: "ENABLED", advertisingChannelType: "PERFORMANCE_MAX" } }, { campaign: { id: "9", name: options.mixedCampaignNames ? "Other Agency Shopping" : "Paused Shopping", status: "PAUSED", advertisingChannelType: "SHOPPING" } }, { campaign: { id: "10", name: "Display", status: "ENABLED", advertisingChannelType: "DISPLAY" } }] : [])];
      if (gaql.includes(" FROM campaign_criterion") && gaql.includes("'KEYWORD'"))
        return [{ campaign: { id: "1" }, campaignCriterion: { resourceName: "customers/1234567890/campaignCriteria/1~10", keyword: { text: "riverton collision repair", matchType: "EXACT" } } }, ...(options.mixedCampaignNames ? [{ campaign: { id: "2" }, campaignCriterion: { resourceName: "customers/1234567890/campaignCriteria/2~20", keyword: { text: "other agency negative", matchType: "EXACT" } } }] : [])];
      if (options.mixedCampaignNames && gaql.includes(" FROM ad_group_criterion"))
        return [{ campaign: { id: "2" }, adGroup: { id: "22", name: "Other agency group" }, adGroupCriterion: { resourceName: "customers/1234567890/adGroupCriteria/22~20", keyword: { text: "other agency group negative", matchType: "PHRASE" } } }];
      if (gaql.includes(" FROM search_term_view"))
        return [{ campaign: { id: "1" }, adGroup: { id: "2" }, searchTermView: { searchTerm: "riverton collision repair" }, segments: { date: "2026-10-06", conversionAction: action }, metrics: gaql.includes("all_conversions") ? { allConversions: "3", allConversionsValue: options.placeholder ? "3" : "300" } : { impressions: "520", clicks: "38", costMicros: "304000000" } }];
      if (options.mixedCampaignNames && gaql.includes(" FROM campaign_search_term_view"))
        return [{ campaign: { id: "2" }, campaignSearchTermView: { searchTerm: "other agency query" }, segments: { date: "2026-10-06", conversionAction: action }, metrics: gaql.includes("all_conversions") ? { allConversions: "1", allConversionsValue: "1" } : { impressions: "100", clicks: "10", costMicros: "50000000" } }];
      return [];
    } }, { customerId, timeZone: "America/Los_Angeles", currencyCode: "USD", policy, campaignNameContains: options.campaignNameContains ?? null }, now);
  return { data, calls };
}
function analyze(data: RecoverySources, configured = policy) {
  return analyzeRecovery(data, configured, recoveryCandidates(data).map(c => ({ itemId: c.key, negativeText: c.exclusion.text, decision: "NEGATIVE", category: "COMPETITOR-NEGATIVE", competitorLikelihood: "likely", confidence: 0.95, reason: "Synthetic commercial intent" })), "85");
}
test("context keeps account-calendar comparisons, budget, bidding, goals and sanitized recent changes", async () => {
  const { data, calls } = await fixture({ portfolio: true });
  const row = analyze(data).items[0]!.item, context = row.context!;
  assert.equal(context.budget?.amount, "125");
  assert.equal(context.budget?.shared, true);
  assert.equal(context.bidding?.source, "portfolio");
  assert.equal(context.bidding?.targetRoas, "4");
  assert.equal(context.recent.startDate, "2026-09-13");
  assert.equal(context.recent.endDate, "2026-10-12");
  assert.equal(context.recent.cost, "304");
  assert.equal(context.previous.cost, "400");
  assert.equal(context.changesStartDate, "2026-09-15");
  assert.equal(context.changesEndDate, "2026-10-13");
  assert.equal(context.changes[0]!.fields[0], "amountMicros");
  assert.equal(JSON.stringify(context).includes("must-not-retain"), false);
  assert.ok(calls.every(gaql => gaql.startsWith("SELECT ")));
  assert.match(calls.find(gaql => gaql.includes(" FROM change_event"))!, /LIMIT 10000$/);
  assert.equal(row.ranking?.targetCpa, "85");
  assert.equal(row.exclusion?.resourceId, "customers/1234567890/campaignCriteria/1~10");
  assert.equal(row.exclusion?.campaigns[0]!.campaignName, "Synthetic Search");
  assert.deepEqual(parseRecoveryItem(row), row);
});
test("inventory retains exact attachment paths and brand members, including out-of-ranking fan-out", async () => {
  const { data, calls } = await fixture({ lists: true });
  const account = data.exclusions.find(row => row.scope === "account")!;
  assert.deepEqual(account.campaignIds, ["1", "2", "9"]);
  assert.equal(account.details?.campaigns.find(c => c.campaignId === "9")?.status, "PAUSED");
  assert.equal(account.details?.attachmentResourceIds[0], "customers/1234567890/customerNegativeCriteria/20");
  const shared = data.exclusions.find(row => row.scope === "shared_list")!;
  assert.equal(shared.details?.listName, "List 10");
  assert.equal(shared.details?.attachmentResourceIds.length, 2);
  const brand = data.exclusions.find(row => row.kind === "brand")!;
  assert.equal(brand.details?.brandMembers[0]!.name, "Riverton");
  assert.deepEqual(brand.details?.attachmentResourceIds, [brand.resource]);
  const report = analyze(data), search = report.items.find(row => row.resource.endsWith("1~10"))!.item;
  assert.equal(search.remainingBlockers, 2);
  const pmax = report.items.find(row => row.resource === brand.resource)!.item;
  assert.equal(pmax.channel, "PERFORMANCE_MAX");
  assert.equal(pmax.score, null);
  assert.equal(pmax.recommendation, "manual_review");
  assert.ok(calls.filter(gaql => gaql.includes(" FROM campaign_search_term_view")).every(gaql => !gaql.includes("ad_group.id")));
});
test("campaign-name scope includes Built by Shah campaigns by default and null can opt into all campaigns", async () => {
  const filtered = (await fixture({ lists: true, mixedCampaignNames: true, campaignNameContains: "bUiLt bY sHaH" })).data;
  assert.deepEqual(filtered.campaigns.map(campaign => campaign.id), ["1"]);
  assert.ok(filtered.exclusions.every(exclusion => exclusion.campaignIds.every(id => id === "1")));
  assert.ok(filtered.facts.every(fact => fact.campaignId === "1"));
  assert.deepEqual(Object.keys(filtered.campaignContexts ?? {}), ["1"]);
  assert.equal(filtered.exclusions.some(exclusion => exclusion.kind === "brand"), false);
  assert.deepEqual(filtered.exclusions.find(exclusion => exclusion.scope === "shared_list")?.details?.attachmentResourceIds, ["customers/1234567890/campaignSharedSets/1~10"]);
  assert.deepEqual(filtered.exclusions.find(exclusion => exclusion.scope === "account")?.campaignIds, ["1"]);
  assert.match(filtered.coverage.find(source => source.source === "campaign_name_filter")!.detail, /case-insensitively/u);

  const all = (await fixture({ lists: true, mixedCampaignNames: true, campaignNameContains: null })).data;
  assert.deepEqual(all.campaigns.map(campaign => campaign.id), ["1", "2"]);
  assert.deepEqual(all.exclusions.find(exclusion => exclusion.scope === "account")?.campaignIds, ["1", "2", "9"]);
  assert.equal(all.exclusions.some(exclusion => exclusion.campaignIds.includes("2") && exclusion.scope === "campaign"), true);
  assert.equal(all.exclusions.some(exclusion => exclusion.campaignIds.includes("2") && exclusion.scope === "ad_group"), true);
  assert.equal(all.facts.some(fact => fact.campaignId === "2"), true);
  assert.deepEqual(Object.keys(all.campaignContexts ?? {}), ["1", "2"]);
  assert.equal(all.exclusions.some(exclusion => exclusion.kind === "brand"), true);
});
test("v25 account keywords use account-list attachments and shared criteria, never nonexistent keyword fields", async () => {
  const { data, calls } = await fixture({ lists: true });
  assert.ok(calls.every(query => !query.includes("customer_negative_criterion.keyword") && !/FROM customer_negative_criterion WHERE customer_negative_criterion.type = 'KEYWORD'/.test(query)));
  assert.equal(data.coverage.some(source => source.source === "account_direct_negatives"), false);
  const account = data.exclusions.find(e => e.scope === "account")!;
  assert.equal(account.details?.listResourceId, "customers/1234567890/sharedSets/20");
  assert.equal(account.details?.detailsComplete, true);
  assert.deepEqual(account.campaignIds, ["1", "2", "9"]);
  data.actions[0]!.kind = "qualified_lead";
  const row = analyze(data).items.find(e => e.resource.endsWith("1~10"))!.item;
  assert.equal(row.remainingBlockers, 2);
  assert.ok(row.blockers?.some(b => b.resourceId === account.resource && b.scope === "account" && b.certainty === "known"));
  assert.equal(row.blockerCoverageComplete, true);
  assert.notEqual(row.recommendation, "potential_pilot");
});
test("account-list attachment and shared-keyword failures still prevent complete blocker coverage", async () => {
  for (const failed of ["customer_negative_criterion.negative_keyword_list.shared_set", " FROM shared_criterion"]) {
    const { data } = await fixture({ fail: failed });
    data.actions[0]!.kind = "qualified_lead";
    const row = analyze(data).items[0]!.item;
    assert.equal(row.blockerCoverageComplete, false);
    assert.notEqual(row.recommendation, "potential_pilot");
  }
});
test("unavailable or capped context stays null/partial, never an observed zero or a complete history", async () => {
  const { data } = await fixture({ fail: " FROM campaign_budget", changes: 10000 });
  const row = analyze(data).items[0]!.item;
  assert.equal(row.context?.budget, null);
  assert.equal(data.coverage.find(c => c.source === "budget_context")?.available, false);
  assert.equal(data.coverage.find(c => c.source === "recent_changes")?.available, false);
  assert.equal(row.context?.changes.length, 20);
  assert.equal(row.detailsTruncated, true);
  assert.equal(row.blockerCoverageComplete, true, "A capped change log is not a missing keyword blocker check");
  assert.notEqual(row.recommendation, "potential_pilot");
  assert.equal(data.coverage.find(c => c.source === "context_detail_limit")?.available, false);
  assert.ok(row.context?.limitations.some(reason => reason.includes("latest 20")));
  assert.equal(JSON.stringify(data.coverage).includes("private provider"), false);
  const failed = await fixture({ fail: "metrics.conversions_value FROM campaign" });
  assert.equal(analyze(failed.data).items[0]!.item.context?.recent.clicks, null);
});
test("mixed and custom goals cannot borrow the account target CPA", async () => {
  for (const options of [{ extraGoal: true }, { custom: true }]) {
    const { data } = await fixture(options);
    assert.equal(analyze(data).items[0]!.item.ranking?.targetCpa, null);
    assert.ok(analyze(data).items[0]!.item.score?.unavailable.includes("efficiency"));
  }
});
test("meaningful action-specific value enables Class B, not qualified lead or automatic release", async () => {
  const { data } = await fixture();
  const configured = { ...policy, valueTargets: { [action]: { interpretation: "business_value" as const, targetRoas: "4" } } };
  const row = analyze(data, configured).items[0]!.item;
  assert.equal(row.valueClass, "B");
  assert.equal(row.metrics.roas, "0.986842");
  assert.equal(row.score?.quality, "9.87");
  assert.equal(row.score?.efficiency, "6.17");
  assert.equal(row.ranking?.targetSource, "account_policy");
  assert.equal(row.recommendation, "manual_review");
  assert.equal(row.ranking?.completedConversionWeeks, 1);
  const raw = analyze(data).items[0]!.item;
  assert.equal(raw.valueClass, "C");
  assert.equal(raw.metrics.roas, null);
  assert.equal(raw.score?.quality, "0");
});
test("purchase value can use a sole Google goal target; unit/default or mixed values cannot", async () => {
  const { data } = await fixture({ purchase: true });
  const row = analyze(data).items[0]!.item;
  assert.equal(row.valueClass, "A");
  assert.equal(row.ranking?.targetSource, "google_single_action_goal");
  assert.equal(row.score?.quality, "9.87");
  for (const options of [{ purchase: true, placeholder: true }, { purchase: true, extraGoal: true }, { purchase: true, defaultValue: "100" }]) {
    const failed = await fixture(options);
    const item = analyze(failed.data).items[0]!.item;
    assert.equal(item.ranking?.targetRoas, null);
    assert.equal(item.score?.quality, "0");
    assert.equal(item.score?.efficiency, "0");
    assert.equal(item.recommendation, "manual_review");
  }
});
test("ROAS uses exact fractions, caps components and never divides by zero or renormalizes", () => {
  const input = { qualityEvents: null, conversions: "3", clicks: "30", cost: "100", targetCpa: null, conversionValue: "300", targetRoas: "4", valueBased: true, recent: true, completedConversionWeeks: 3 };
  assert.equal(recoveryScore(input).total, "76");
  assert.equal(recoveryScore({ ...input, conversionValue: "1000" }).quality, "40");
  assert.equal(recoveryScore({ ...input, cost: "0" }).quality, "0");
  assert.deepEqual(recoveryScore({ ...input, cost: "0" }).unavailable, ["quality", "efficiency"]);
  assert.equal(recoveryScore({ ...input, conversionValue: "1", cost: "3", targetRoas: "3" }).quality, "4.44");
});
test("blocker paths retain list, group, match and query identity, including no-history overlap", async () => {
  const { data } = await fixture();
  const source = data.exclusions[0]!;
  data.exclusions.push({ ...source, resource: "shared/20", scope: "shared_list", text: "collision repair", matchType: "PHRASE", details: { ...source.details!, resourceId: "shared/20", listResourceId: "sharedLists/2", listName: "Competitors", campaigns: [...source.details!.campaigns, { campaignId: "9", campaignName: "Other campaign", channel: "SEARCH", status: "PAUSED" }] }, campaignIds: ["1", "9"] });
  const row = analyze(data).items.find(item => item.resource === source.resource)!.item;
  assert.equal(row.remainingBlockers, 1);
  assert.equal(row.blockers?.[0]?.listName, "Competitors");
  assert.equal(row.blockers?.[0]?.affectedCampaignCount, 2);
  assert.equal(row.blockers?.[0]?.basis, "observed_query");
  data.facts = [];
  const missing = analyze(data).items.find(item => item.resource === source.resource)!.item;
  assert.equal(missing.remainingBlockers, 1);
  assert.equal(missing.blockers?.[0]?.basis, "candidate_text");
  assert.equal(missing.metrics.clicks, null);
  assert.equal(missing.recommendation, "insufficient_evidence");
});
test("brand semantics, unknown ad group and matching bounds cannot claim no remaining blocker", async () => {
  const { data } = await fixture(), source = data.exclusions[0]!;
  const group = { ...source, resource: "group/1", scope: "ad_group" as const, adGroupId: "3" };
  assert.equal(recoveryBlockers(source, [group], data.facts).known, 0);
  assert.equal(recoveryBlockers(source, [group], []).possible, 1);
  const brand = { ...source, resource: "brand/1", kind: "brand" as const, scope: "brand" as const, matchType: null };
  assert.equal(recoveryBlockers(source, [brand], data.facts).possible, 1);
  assert.equal(recoveryBlockers(source, [brand], data.facts).complete, false);
  assert.equal(recoveryBlockers(source, [group], [], "1", { cache: new Map(), remaining: 0 }).complete, false);
  assert.equal(recoveryBlockers({ ...source, text: "collision repair", matchType: "PHRASE" }, [source], []).complete, false);
});
test("large exact inventories do not spend the comparison budget on proven exact nonmatches", async () => {
  const { data } = await fixture(), source = data.exclusions[0]!;
  const others = Array.from({ length: 10000 }, (_, index) => ({ ...source, resource: "criterion/" + index, text: "repair " + index }));
  const lookup: BlockerLookup = { cache: new Map(), remaining: 1000 };
  for (let index = 0; index < 1000; index++) {
    const result = recoveryBlockers(others[index]!, others, [{ ...data.facts[0]!, query: "repair " + index }], "1", lookup);
    assert.equal(result.known, 0);
    assert.equal(result.complete, true);
  }
  assert.equal(lookup.remaining, 0);
  assert.notEqual(lookup.exhausted, true, "Exactly consuming the budget is not a skipped comparison");
  const punctuation = recoveryBlockers(source, [{ ...source, resource: "other/plain" }], [{ ...data.facts[0]!, query: "repair-shop" }]);
  assert.equal(punctuation.possible, 1, "Punctuation remains unknown, not filtered out by the index");
  assert.equal(punctuation.complete, false);
  const unknownExact = { ...source, resource: "punctuation/1", text: "repair-shop" };
  assert.equal(recoveryBlockers(source, [unknownExact], data.facts).possible, 1);
});
test("oversized Unicode detail is capped before persistence without dropping metrics or claiming a full assessment", async () => {
  const { data } = await fixture();
  const original = analyze(data).items[0]!.item;
  original.context!.changes = Array.from({ length: 20 }, () => ({ resourceId: "budget/1", at: "2026-10-10 12:00:00", resourceType: "CAMPAIGN_BUDGET", operation: "UPDATE", fields: Array(100).fill("界".repeat(200)) }));
  original.recommendation = "potential_pilot";
  assert.throws(() => parseRecoveryItem(original), /storage bound/);
  const bounded = boundedRecoveryItem(original);
  assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).length < 100000);
  assert.deepEqual(bounded.metrics, original.metrics);
  assert.equal(bounded.conversionActions[0]!.resourceId, action);
  assert.equal(bounded.blockerCoverageComplete, true, "Only context detail was reduced");
  assert.equal(bounded.recommendation, "manual_review");
  assert.ok(bounded.context!.changes.length < 20);
  assert.equal(original.context!.changes.length, 20);
  assert.deepEqual(parseRecoveryItem(bounded), bounded);
  const inventoryOnly = { ...original, context: null, exclusion: { ...original.exclusion!, campaigns: Array.from({ length: 200 }, (_, index) => ({ campaignId: String(index), campaignName: "界".repeat(500), channel: "SEARCH", status: "ENABLED" })) } };
  const cappedInventory = boundedRecoveryItem(inventoryOnly);
  assert.equal(cappedInventory.detailsTruncated, true);
  assert.equal(cappedInventory.exclusion?.detailsComplete, false);
  assert.equal(cappedInventory.blockerCoverageComplete, false);
  assert.deepEqual(parseRecoveryItem(cappedInventory), cappedInventory);
});
test("the selected action survives count/byte caps even when it was last in the source", async () => {
  for (const name of ["Other action", "界".repeat(500)]) {
    const { data } = await fixture();
    const selected = { ...data.actions[0]!, kind: "qualified_lead" as const };
    data.actions = [...Array.from({ length: 105 }, (_, index) => ({ ...selected, resource: action + String(index + 10), name, kind: "ignore" as const, primary: false })), selected];
    data.conversionFacts.push(...data.actions.slice(0, -1).map(other => ({ key: data.facts[0]!.key, action: other.resource, events: "1", value: "0" })));
    const report = analyze(data), row = report.items[0]!.item;
    assert.equal(row.conversionActions[0]!.resourceId, action);
    assert.equal(row.metrics.conversionEvents, "3");
    assert.equal(row.detailsTruncated, true);
    assert.equal(row.recommendation, "manual_review");
    assert.equal(row.evidenceConfidence, "low");
    assert.equal(report.coverage.find(c => c.source === "retained_detail_limit")?.available, false);
    assert.ok(new TextEncoder().encode(JSON.stringify(row)).length < 65536);
    assert.deepEqual(parseRecoveryItem(row), row);
  }
});
test("value targets are bounded strict data; projections reject malformed detail and strip provider fields", async () => {
  assert.deepEqual(validateRecoveryPolicy(EMPTY_RECOVERY_POLICY), EMPTY_RECOVERY_POLICY);
  const valid = { ...policy, valueTargets: { [action]: { interpretation: "business_value", targetRoas: "4.25" } } };
  assert.deepEqual(validateRecoveryPolicy(valid), valid);
  for (const targetRoas of ["0", "-1", "Infinity", "1e3", "1.0000001", "1000000"])
    assert.throws(() => validateRecoveryPolicy({ ...valid, valueTargets: { [action]: { interpretation: "revenue", targetRoas } } }));
  assert.throws(() => validateRecoveryPolicy({ ...valid, valueTargets: { [action]: { interpretation: "revenue", targetRoas: "4", execute: true } } }));
  const ids = Array.from({ length: 100 }, (_, index) => "customers/" + "1".repeat(50) + "/conversionActions/" + String(index));
  assert.throws(() => validateRecoveryPolicy({ version: 1, categoryActions: Object.fromEntries(ids.map((_, index) => ["RULE-" + index + "-" + "X".repeat(80) + "-NEGATIVE", "consider"])), conversionActions: Object.fromEntries(ids.map(id => [id, "qualified_lead"])), valueTargets: Object.fromEntries(ids.map(id => [id, { interpretation: "business_value", targetRoas: "4" }])) }), /storage bound/);
  const { data } = await fixture();
  const row = analyze(data).items[0]!.item;
  assert.equal("providerPayload" in parseRecoveryItem({ ...row, context: { ...row.context, providerPayload: "private" } }).context!, false);
  assert.throws(() => parseRecoveryItem({ ...row, blockers: [{ text: "bad" }] }));
  assert.throws(() => parseRecoveryItem({ ...row, context: { ...row.context, changes: Array(21).fill({}) } }));
  const { exclusion: _exclusion, blockers: _blockers, possibleBlockers: _possible, context: _context, ranking: _ranking, detailsTruncated: _truncated, ...legacy } = row;
  legacy.conversionActions = Array.from({ length: 80 }, (_, index) => ({ resourceId: action + String(index), name: "界".repeat(350), kind: "raw_lead", events: "1", value: "1" }));
  assert.ok(new TextEncoder().encode(JSON.stringify(legacy)).length > 65536);
  assert.deepEqual(parseRecoveryItem(legacy), legacy);
});
