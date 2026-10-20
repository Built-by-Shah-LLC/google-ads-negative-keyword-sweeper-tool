import { createHash } from "node:crypto";
import type { Dispatcher } from "undici";
import type { AppConfig } from "../../src/config/env.js";
import type { RecoveryCandidate, RecoveryIntent } from "../../src/volume-recovery/analysis.js";
import { createRecoveryClassifier } from "../../src/volume-recovery/classifier.js";
import { canonicalRecoveryJson, EMPTY_RECOVERY_POLICY, parseRecoveryItem, type RecoveryItem } from "../../src/volume-recovery/contract.js";
import type { RecoveryRequest, RecoveryStore } from "../../src/volume-recovery/persistence.js";
import type { RecoveryServices } from "../../src/volume-recovery/pipeline.js";
import { collectRecoverySources, type RecoveryReader } from "../../src/volume-recovery/sources.js";
import fixture from "../fixtures/recovery-classification.json" with { type: "json" };

export { fixture };
export const now = new Date("2026-10-19T12:00:00Z");
export const config: AppConfig["llm"] = {
  provider: "moonshot", apiKey: "fictional-test-key", model: "kimi-k2.6", baseUrl: "https://model.invalid/v1",
  thinking: "enabled", batchSize: 25, concurrency: 1, requestTimeoutMs: 1000, maxRetries: 0
};
export const snapshot = { rulesMarkdown: fixture.rulesMarkdown, phraseProtections: [] };
export const categories = [...fixture.rulesMarkdown.matchAll(/^###\s+`([A-Z][A-Z0-9-]*-NEGATIVE)`/gm)].map(match => match[1]!);
export type ReferenceCase = typeof fixture.cases[number];
export const signature = (row: { text: string; scope: string; match: string }) => JSON.stringify([row.text, row.scope, row.match]);
export function reference(candidate: RecoveryCandidate) {
  const row = fixture.cases.find(row => signature(row) === signature({ text: candidate.exclusion.text, scope: candidate.exclusion.scope, match: candidate.exclusion.matchType! }));
  if (!row) throw new Error("Synthetic model responder has no reference case.");
  return row;
}
/** Deterministic test replies prove plumbing only, not model accuracy. */
export function reply(candidates: RecoveryCandidate[]): RecoveryIntent[] {
  return candidates.map(candidate => {
    const row = reference(candidate);
    return { itemId: candidate.key, category: row.categories[0]!, competitorLikelihood: row.competitor[0] as RecoveryIntent["competitorLikelihood"], confidence: row.categories[0] === null ? 0.4 : 0.9, reason: row.meaning };
  });
}
export interface ModelRequest {
  model: string;
  messages: { role: string; content: string }[];
  response_format: Record<string, unknown>;
}
export function fakeDispatcher(respond: (request: ModelRequest, index: number) => unknown | Promise<unknown>) {
  const requests: ModelRequest[] = [];
  const dispatcher = {
    async request(options: { origin: string | URL; path: string; body: string; headers: Record<string, string> }) {
      if (String(options.origin) !== "https://model.invalid" || options.path !== "/v1/chat/completions") throw new Error("Unexpected fake endpoint");
      const request = JSON.parse(options.body) as ModelRequest;
      requests.push(request);
      const payload = await respond(request, requests.length - 1);
      return { statusCode: 200, headers: {}, body: { text: async () => JSON.stringify(payload) } };
    }
  } as unknown as Dispatcher;
  return { dispatcher, requests };
}
export function completion(items: unknown, content?: string) {
  return { choices: [{ message: { content: content ?? JSON.stringify({ items }) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 10 } } };
}

/** Aggregate CSV rows cannot reconstruct original query-level responses or relationships.
 * Each represented campaign is fictional and isolated. Only rows 38/906 share a list.
 * Blank-channel rows have no attachment. No-history rows produce no synthetic facts. */
export function syntheticReader(rows: ReferenceCase[] = fixture.cases) {
  const calls: string[] = [];
  const campaigns = rows.filter(row => row.channel !== null).map(row => ({
    campaign: { id: String(row.row), name: `Synthetic campaign for CSV row ${row.row}`, status: "ENABLED", advertisingChannelType: row.channel, primaryStatusReasons: [], servingStatus: "SERVING", primaryStatus: "ELIGIBLE", biddingStrategyType: "MAXIMIZE_CONVERSIONS" }
  }));
  const shared = [...new Map(rows.filter(row => row.scope === "shared_list").map(row => [signature(row), row])).values()];
  const setId = (row: ReferenceCase) => String(shared.find(item => signature(item) === signature(row))!.row);
  const setResource = (row: ReferenceCase) => `customers/1234567890/sharedSets/${setId(row)}`;
  const action = "customers/1234567890/conversionActions/1";
  const reader: RecoveryReader = {
    async searchStream(customer, query) {
      if (customer !== "1234567890" || !query.startsWith("SELECT ")) throw new Error("Unexpected synthetic source access");
      calls.push(query);
      const from = / FROM ([a-z_]+)/.exec(query)?.[1];
      if (from === "customer") return [{ customer: { id: customer, timeZone: "America/New_York", currencyCode: "USD" } }];
      if (from === "campaign") return query.includes("segments.date") ? [] : campaigns;
      if (from === "campaign_criterion") return query.includes("'BRAND_LIST'") ? [] : rows.filter(row => row.scope === "campaign").map(row => ({ campaign: { id: String(row.row) }, campaignCriterion: { resourceName: `customers/${customer}/campaignCriteria/${row.row}~1`, keyword: { text: row.text, matchType: row.match } } }));
      if (from === "ad_group_criterion") return rows.filter(row => row.scope === "ad_group").map(row => ({ campaign: { id: String(row.row) }, adGroup: { id: String(row.row + 10000), name: "Synthetic ad group" }, adGroupCriterion: { resourceName: `customers/${customer}/adGroupCriteria/${row.row + 10000}~1`, keyword: { text: row.text, matchType: row.match } } }));
      if (from === "shared_set") return shared.map(row => ({ sharedSet: { resourceName: setResource(row), name: `Synthetic list ${setId(row)}`, type: "NEGATIVE_KEYWORDS" } }));
      if (from === "campaign_shared_set") return rows.filter(row => row.scope === "shared_list" && row.channel !== null).map(row => ({ campaign: { id: String(row.row) }, campaignSharedSet: { resourceName: `customers/${customer}/campaignSharedSets/${row.row}~${setId(row)}`, sharedSet: setResource(row) } }));
      if (from === "shared_criterion") return query.includes("'BRAND'") ? [] : shared.map(row => ({ sharedCriterion: { resourceName: `customers/${customer}/sharedCriteria/${setId(row)}~1`, sharedSet: setResource(row), keyword: { text: row.text, matchType: row.match } } }));
      if (from === "conversion_action") return [{ conversionAction: { resourceName: action, name: "Synthetic raw lead form", category: "SUBMIT_LEAD_FORM", origin: "WEBSITE", type: "WEBPAGE", primaryForGoal: true, valueSettings: { alwaysUseDefaultValue: true, defaultValue: "1" } } }];
      if (from === "customer_conversion_goal") return [{ customerConversionGoal: { category: "SUBMIT_LEAD_FORM", origin: "WEBSITE", biddable: true } }];
      if (from === "conversion_goal_campaign_config") return campaigns.map(({ campaign }) => ({ conversionGoalCampaignConfig: { campaign: `customers/${customer}/campaigns/${campaign.id}`, goalConfigLevel: "CUSTOMER" } }));
      if (from === "search_term_view" || from === "campaign_search_term_view") {
        const channel = from === "search_term_view" ? "SEARCH" : "PERFORMANCE_MAX";
        const conversions = query.includes("metrics.all_conversions");
        return rows.filter(row => row.channel === channel && row.impressions !== null).map(row => ({
          campaign: { id: String(row.row) }, ...(channel === "SEARCH" ? { adGroup: { id: String(row.row + 10000) } } : {}),
          [channel === "SEARCH" ? "searchTermView" : "campaignSearchTermView"]: { searchTerm: row.text },
          segments: { date: "2026-10-06", ...(conversions ? { conversionAction: action } : {}) },
          metrics: conversions ? { allConversions: row.events, allConversionsValue: row.value } : { impressions: row.impressions, clicks: row.clicks, costMicros: row.cost!.replace(".", "").padEnd(row.cost!.split(".")[0]!.length + 6, "0") }
        }));
      }
      if (["customer_negative_criterion", "campaign_budget", "accessible_bidding_strategy", "campaign_conversion_goal", "custom_conversion_goal", "change_event"].includes(from ?? "")) return [];
      throw new Error(`Unrouted synthetic source: ${from}`);
    }
  };
  return { reader, calls };
}

export function offlineHarness(respond?: (candidates: RecoveryCandidate[], index: number) => unknown | Promise<unknown>, rows = fixture.cases) {
  const request: RecoveryRequest = {
    id: "00000000-0000-4000-8000-000000000004", accountId: "00000000-0000-4000-8000-000000000003",
    customerId: "1234567890", accountName: fixture.accountName, timeZone: "America/New_York", currencyCode: "USD", targetCpa: "85",
    policy: { ...EMPTY_RECOVERY_POLICY, categoryActions: { "BODYWORK-NEGATIVE": "consider", "PRICE-SHOPPING-NEGATIVE": "consider", "EMPLOYMENT-NEGATIVE": "retain", "MECHANICAL-NEGATIVE": "retain", "FREE-SERVICE-NEGATIVE": "retain", "COMPETITOR-NEGATIVE": "review" } },
    snapshot: structuredClone(snapshot), policyHash: createHash("sha256").update(canonicalRecoveryJson(snapshot)).digest("hex")
  };
  const source = syntheticReader(rows);
  const saved: { key: string; resource: string; item: RecoveryItem; ordinal: number }[] = [];
  const progress: string[] = [];
  let terminal: { status: string; summary: Record<string, unknown>; usage: { inputTokens: number; outputTokens: number } } | undefined;
  const store: RecoveryStore = {
    async claim() { return request; },
    async progress(_request, _execution, stage) { progress.push(stage); },
    async items(_request, _execution, items, start) {
      items.forEach((row, index) => saved.push({ ...row, item: parseRecoveryItem(JSON.parse(JSON.stringify(row.item))), ordinal: start + index }));
    },
    async finish(_request, _execution, status, summary, usage) { terminal = { status, summary: summary as Record<string, unknown>, usage }; }
  };
  // The actual pipeline passes the actual candidates; the fake only chooses its HTTP reply.
  const knownCandidates = new Map<string, RecoveryCandidate>();
  const model = fakeDispatcher((body, index) => {
    const batch = (JSON.parse(body.messages[1]!.content).items as { itemId: string }[]).map(row => knownCandidates.get(row.itemId)!);
    return respond ? respond(batch, index) : completion(reply(batch).reverse());
  });
  const classifier = createRecoveryClassifier(config, model.dispatcher);
  const services: RecoveryServices = {
    store, collect: input => collectRecoverySources(source.reader, { ...input, campaignNameContains: null }, now), now: () => now,
    classify(input, candidates, allowed) { candidates.forEach(candidate => knownCandidates.set(candidate.key, candidate)); return classifier.classify(input.accountName, input.snapshot, candidates, allowed); }
  };
  return { request, services, saved, progress, source, model, terminal: () => terminal! };
}
