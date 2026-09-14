import {
  assertMutationHttpSuccess,
  campaignCriterionMutationPath,
  customerNegativeCriteriaMutationPath,
  parsePartialFailureErrors,
  type GoogleAdsMutationHttpTransport
} from "./negative-keyword-writer.prod.js";

/**
 * Direct negative-keyword management against the live Google Ads API.
 *
 * Supports, per customer account:
 * - campaign scope: create/remove campaign-level negative keywords via
 *   `customers/{cid}/campaignCriteria:mutate`.
 * - account scope: create/remove account-level negative keywords via
 *   `customers/{cid}/customerNegativeCriteria:mutate`.
 *
 * Every batch is sent with validateOnly=true first; the real request only runs
 * when validation passed and dry-run was not requested. partialFailure and
 * RESOURCE_NAME_ONLY mirror the production negative-keyword writer.
 */

export type NegativeMatchType = "EXACT" | "PHRASE";
export type NegativeScope = "campaign" | "account";

export interface NegativeCriterionActionResult {
  action: "ADD" | "REMOVE";
  scope: NegativeScope;
  campaignId: string | null;
  text: string;
  matchType: NegativeMatchType;
  status: "VALIDATED" | "APPLIED" | "FAILED";
  resourceName: string | null;
  error: string | null;
}

export interface NegativeCriteriaManagementSummary {
  customerId: string;
  scope: NegativeScope;
  campaignId: string | null;
  matchType: NegativeMatchType;
  dryRun: boolean;
  validatedCount: number;
  appliedCount: number;
  failedCount: number;
  googleAdsMutationPerformed: boolean;
  requestIds: string[];
  results: NegativeCriterionActionResult[];
}

export interface NegativeCriteriaManageInput {
  customerId: string;
  scope: NegativeScope;
  campaignId?: string;
  add: string[];
  remove: string[];
  matchType: NegativeMatchType;
  /** When true, only validateOnly requests are sent; nothing is mutated. */
  dryRun: boolean;
}

type SearchStream = (customerId: string, query: string) => Promise<Record<string, unknown>[]>;

interface ExistingNegativeCriterion {
  criterionId: string;
  resourceName: string;
  text: string;
  matchType: string;
}

interface BatchItem {
  text: string;
  matchType: NegativeMatchType;
  /** Set for removals; creation resource names come from the API response. */
  resourceName: string | null;
}

interface BatchOutcome {
  status: "VALIDATED" | "APPLIED" | "FAILED";
  resourceName: string | null;
  error: string | null;
}

export class NegativeCriteriaManager {
  constructor(
    private readonly transport: GoogleAdsMutationHttpTransport,
    private readonly searchStream: SearchStream
  ) {}

  async run(input: NegativeCriteriaManageInput): Promise<NegativeCriteriaManagementSummary> {
    const customerId = digits(input.customerId, "customer ID");
    const matchType = normalizeMatchType(input.matchType, input.scope);
    const scope = input.scope;
    if (scope !== "campaign" && scope !== "account") {
      throw new Error("Negative-keyword scope must be campaign or account.");
    }
    const campaignId = scope === "campaign"
      ? digits(required(input.campaignId, "--campaign-id is required when --scope campaign."), "campaign ID")
      : null;
    const adds = dedupeTexts(input.add);
    const removes = dedupeTexts(input.remove);
    if (adds.length === 0 && removes.length === 0) {
      throw new Error("Nothing to do: provide at least one --add or --remove value.");
    }
    const conflict = adds.find((text) => removes.some((item) => sameText(item, text)));
    if (conflict) {
      throw new Error(`'${conflict}' was passed to both --add and --remove.`);
    }

    const results: NegativeCriterionActionResult[] = [];
    const requestIds: string[] = [];

    if (removes.length > 0) {
      const existing = scope === "campaign"
        ? await this.fetchCampaignNegatives(customerId, campaignId!)
        : await this.fetchAccountNegatives(customerId);
      const removalItems: BatchItem[] = [];
      for (const text of removes) {
        const match = existing.find((criterion) =>
          sameText(criterion.text, text) && criterion.matchType === matchType);
        if (!match) {
          results.push(baseResult("REMOVE", scope, campaignId, text, matchType, "FAILED", null,
            `No existing ${scope}-level ${matchType} negative keyword matches '${text}'.`));
          continue;
        }
        removalItems.push({ text, matchType, resourceName: match.resourceName });
      }
      if (removalItems.length > 0) {
        const path = scope === "campaign"
          ? campaignCriterionMutationPath(customerId)
          : customerNegativeCriteriaMutationPath(customerId);
        const outcomes = await this.executeBatch(path, removalItems, input.dryRun,
          (validateOnly) => scope === "campaign"
            ? campaignNegativeRemoveRequest(customerId, removalItems.map((item) => item.resourceName!), validateOnly)
            : accountNegativeRemoveRequest(customerId, removalItems.map((item) => item.resourceName!), validateOnly));
        requestIds.push(...outcomes.requestIds);
        for (const [index, item] of removalItems.entries()) {
          const outcome = outcomes.items[index]!;
          results.push(baseResult("REMOVE", scope, campaignId, item.text, item.matchType,
            outcome.status, outcome.resourceName ?? item.resourceName, outcome.error));
        }
      }
    }

    if (adds.length > 0) {
      const addItems: BatchItem[] = adds.map((text) => ({ text, matchType, resourceName: null }));
      const path = scope === "campaign"
        ? campaignCriterionMutationPath(customerId)
        : customerNegativeCriteriaMutationPath(customerId);
      const outcomes = await this.executeBatch(path, addItems, input.dryRun,
        (validateOnly) => scope === "campaign"
          ? campaignNegativeCreateRequest(customerId, campaignId!, addItems, validateOnly)
          : accountNegativeCreateRequest(customerId, addItems, validateOnly));
      requestIds.push(...outcomes.requestIds);
      for (const [index, item] of addItems.entries()) {
        const outcome = outcomes.items[index]!;
        results.push(baseResult("ADD", scope, campaignId, item.text, item.matchType,
          outcome.status, outcome.resourceName, outcome.error));
      }
    }

    const validatedCount = results.filter((result) => result.status === "VALIDATED").length;
    const appliedCount = results.filter((result) => result.status === "APPLIED").length;
    const failedCount = results.filter((result) => result.status === "FAILED").length;
    return {
      customerId,
      scope,
      campaignId,
      matchType,
      dryRun: input.dryRun,
      validatedCount,
      appliedCount,
      failedCount,
      googleAdsMutationPerformed: !input.dryRun && appliedCount > 0,
      requestIds,
      results
    };
  }

  /**
   * Sends validateOnly first, then (unless dryRun) the real request for the
   * operations that passed validation. Per-operation partial-failure errors are
   * surfaced on the affected items; unmapped partial failures fail the batch.
   */
  private async executeBatch(
    path: string,
    items: BatchItem[],
    dryRun: boolean,
    buildRequest: (validateOnly: boolean) => Record<string, unknown>
  ): Promise<{ requestIds: string[]; items: BatchOutcome[] }> {
    const customerId = customerIdFromMutationPath(path);
    const requestIds: string[] = [];
    const outcomes: BatchOutcome[] = items.map(() => ({ status: "FAILED", resourceName: null, error: "" }));

    const validation = await this.transport.post(path, buildRequest(true));
    requestIds.push(...(validation.requestId ? [validation.requestId] : []));
    assertMutationHttpSuccess(validation, customerId, true);
    const validationErrors = parsePartialFailureErrors(validation.payload);
    if (validationErrors.unmapped.length > 0) {
      const message = validationErrors.unmapped.join("; ");
      return { requestIds, items: outcomes.map((item) => ({ ...item, error: message.slice(0, 500) })) };
    }
    const validIndexes: number[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const errors = validationErrors.byOperation.get(index);
      if (errors && errors.length > 0) outcomes[index]!.error = errors.join("; ").slice(0, 500);
      else validIndexes.push(index);
    }
    if (validIndexes.length === 0) return { requestIds, items: outcomes };
    if (dryRun) {
      for (const index of validIndexes) {
        outcomes[index] = { status: "VALIDATED", resourceName: null, error: null };
      }
      return { requestIds, items: outcomes };
    }

    // Re-submit only the operations that passed validation so the real request
    // mirrors exactly what was validated.
    const subset = validIndexes.map((index) => items[index]!);
    const mutation = await this.transport.post(path, buildScopedRequest(buildRequest, validIndexes));
    requestIds.push(...(mutation.requestId ? [mutation.requestId] : []));
    assertMutationHttpSuccess(mutation, customerId, false);
    const mutationErrors = parsePartialFailureErrors(mutation.payload);
    const responseItems = mutationResults(mutation.payload);
    if (mutationErrors.unmapped.length > 0 || responseItems.length !== subset.length) {
      const message = mutationErrors.unmapped.length > 0
        ? mutationErrors.unmapped.join("; ")
        : "Google Ads returned an unexpected mutation result count.";
      for (const index of validIndexes) outcomes[index]!.error = message.slice(0, 500);
      return { requestIds, items: outcomes };
    }
    for (const [filteredIndex, originalIndex] of validIndexes.entries()) {
      const errors = mutationErrors.byOperation.get(filteredIndex);
      const resourceName = stringValue(responseItems[filteredIndex]?.resourceName);
      outcomes[originalIndex] = errors && errors.length > 0
        ? { status: "FAILED", resourceName: null, error: errors.join("; ").slice(0, 500) }
        : resourceName
          ? { status: "APPLIED", resourceName, error: null }
          : { status: "FAILED", resourceName: null, error: "Google Ads returned an empty result without a mapped partial-failure error." };
    }
    return { requestIds, items: outcomes };
  }

  private async fetchCampaignNegatives(customerId: string, campaignId: string): Promise<ExistingNegativeCriterion[]> {
    const rows = await this.searchStream(customerId, campaignNegativeCriteriaQuery(campaignId));
    const results: ExistingNegativeCriterion[] = [];
    for (const row of rows) {
      const criterion = recordValue(row.campaignCriterion);
      const keyword = recordValue(criterion?.keyword);
      const criterionId = stringValue(criterion?.criterionId);
      const text = stringValue(keyword?.text);
      const matchType = stringValue(keyword?.matchType).toUpperCase();
      if (!/^\d+$/u.test(criterionId) || !text || !matchType || criterion?.negative !== true) continue;
      results.push({
        criterionId,
        resourceName: stringValue(criterion?.resourceName)
          || `customers/${customerId}/campaignCriteria/${campaignId}~${criterionId}`,
        text,
        matchType
      });
    }
    return results;
  }

  private async fetchAccountNegatives(customerId: string): Promise<ExistingNegativeCriterion[]> {
    const rows = await this.searchStream(customerId, accountNegativeCriteriaQuery());
    const results: ExistingNegativeCriterion[] = [];
    for (const row of rows) {
      const criterion = recordValue(row.customerNegativeCriterion);
      const keyword = recordValue(criterion?.keyword);
      const criterionId = stringValue(criterion?.criterionId);
      const text = stringValue(keyword?.text);
      const matchType = stringValue(keyword?.matchType).toUpperCase();
      if (!/^\d+$/u.test(criterionId) || !text || !matchType) continue;
      results.push({
        criterionId,
        resourceName: stringValue(criterion?.resourceName)
          || `customers/${customerId}/customerNegativeCriteria/${criterionId}`,
        text,
        matchType
      });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Request builders (pure; exported for tests)
// ---------------------------------------------------------------------------

export function campaignNegativeCreateRequest(
  customerId: string,
  campaignId: string,
  items: Array<Pick<BatchItem, "text" | "matchType">>,
  validateOnly: boolean
): Record<string, unknown> {
  const cleanCustomerId = digits(customerId, "customer ID");
  const cleanCampaignId = digits(campaignId, "campaign ID");
  return {
    operations: items.map((item) => ({
      create: {
        campaign: `customers/${cleanCustomerId}/campaigns/${cleanCampaignId}`,
        negative: true,
        keyword: { text: item.text, matchType: item.matchType }
      }
    })),
    partialFailure: true,
    validateOnly,
    responseContentType: "RESOURCE_NAME_ONLY"
  };
}

export function campaignNegativeRemoveRequest(
  customerId: string,
  resourceNames: string[],
  validateOnly: boolean
): Record<string, unknown> {
  const cleanCustomerId = digits(customerId, "customer ID");
  for (const resourceName of resourceNames) {
    if (!new RegExp(`^customers/${cleanCustomerId}/campaignCriteria/\\d+~\\d+$`, "u").test(resourceName)) {
      throw new Error(`Refusing to remove unexpected campaign criterion resource '${resourceName}'.`);
    }
  }
  return {
    operations: resourceNames.map((resourceName) => ({ remove: resourceName })),
    partialFailure: true,
    validateOnly,
    responseContentType: "RESOURCE_NAME_ONLY"
  };
}

export function accountNegativeCreateRequest(
  customerId: string,
  items: Array<Pick<BatchItem, "text" | "matchType">>,
  validateOnly: boolean
): Record<string, unknown> {
  const cleanCustomerId = digits(customerId, "customer ID");
  for (const item of items) {
    if (item.matchType !== "EXACT" && item.matchType !== "PHRASE") {
      throw new Error("Account-level negative keywords only support EXACT or PHRASE match types.");
    }
  }
  return {
    operations: items.map((item) => ({
      create: {
        negative: true,
        keyword: { text: item.text, matchType: item.matchType }
      }
    })),
    partialFailure: true,
    validateOnly,
    responseContentType: "RESOURCE_NAME_ONLY"
  };
}

export function accountNegativeRemoveRequest(
  customerId: string,
  resourceNames: string[],
  validateOnly: boolean
): Record<string, unknown> {
  const cleanCustomerId = digits(customerId, "customer ID");
  for (const resourceName of resourceNames) {
    if (!new RegExp(`^customers/${cleanCustomerId}/customerNegativeCriteria/\\d+$`, "u").test(resourceName)) {
      throw new Error(`Refusing to remove unexpected customer negative criterion resource '${resourceName}'.`);
    }
  }
  return {
    operations: resourceNames.map((resourceName) => ({ remove: resourceName })),
    partialFailure: true,
    validateOnly,
    responseContentType: "RESOURCE_NAME_ONLY"
  };
}

// ---------------------------------------------------------------------------
// GAQL lookup queries (pure; exported for tests)
// ---------------------------------------------------------------------------

export function campaignNegativeCriteriaQuery(campaignId: string): string {
  const cleanCampaignId = digits(campaignId, "campaign ID");
  return `
    SELECT
      campaign_criterion.criterion_id,
      campaign_criterion.resource_name,
      campaign_criterion.keyword.text,
      campaign_criterion.keyword.match_type,
      campaign_criterion.negative
    FROM campaign_criterion
    WHERE campaign.id = ${cleanCampaignId}
      AND campaign_criterion.type = KEYWORD
      AND campaign_criterion.negative = TRUE
  `;
}

export function accountNegativeCriteriaQuery(): string {
  return `
    SELECT
      customer_negative_criterion.criterion_id,
      customer_negative_criterion.resource_name,
      customer_negative_criterion.keyword.text,
      customer_negative_criterion.keyword.match_type
    FROM customer_negative_criterion
    WHERE customer_negative_criterion.type = KEYWORD
  `;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeMatchType(value: string, scope: NegativeScope): NegativeMatchType {
  const normalized = value.trim().toUpperCase();
  if (normalized === "EXACT" || normalized === "PHRASE") return normalized;
  if (normalized === "BROAD") {
    throw new Error(scope === "account"
      ? "BROAD negative keywords are not allowed at the account (customer) level."
      : "BROAD negative keywords are not supported by this tool; use EXACT or PHRASE.");
  }
  throw new Error("Match type must be EXACT or PHRASE.");
}

function buildScopedRequest(
  buildRequest: (validateOnly: boolean) => Record<string, unknown>,
  validIndexes: number[]
): Record<string, unknown> {
  const request = buildRequest(false);
  if (validIndexes.length === (request.operations as unknown[]).length) return request;
  const operations = (request.operations as unknown[]).filter((_, index) => validIndexes.includes(index));
  return { ...request, operations };
}

function baseResult(
  action: "ADD" | "REMOVE",
  scope: NegativeScope,
  campaignId: string | null,
  text: string,
  matchType: NegativeMatchType,
  status: NegativeCriterionActionResult["status"],
  resourceName: string | null,
  error: string | null
): NegativeCriterionActionResult {
  return { action, scope, campaignId, text, matchType, status, resourceName, error };
}

function dedupeTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text) throw new Error("Negative keyword text must not be empty.");
    const key = normalizeText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function sameText(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function digits(value: string, label: string): string {
  const clean = value.replaceAll("-", "");
  if (!/^\d+$/u.test(clean)) throw new Error(`Google Ads ${label} must contain only digits.`);
  return clean;
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function customerIdFromMutationPath(path: string): string {
  return /^\/customers\/(\d+)\//u.exec(path)?.[1] ?? "unknown";
}

function mutationResults(payload: unknown): Record<string, unknown>[] {
  const root = recordValue(payload);
  return Array.isArray(root?.results)
    ? root.results.map((item) => recordValue(item) ?? {})
    : [];
}

function recordValue(value: unknown): Record<string, any> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}
