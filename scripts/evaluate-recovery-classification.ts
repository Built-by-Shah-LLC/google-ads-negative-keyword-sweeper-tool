import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Dispatcher } from "undici";
import type { AppConfig } from "../src/config/env.js";
import type { RecoveryCandidate, RecoveryIntent } from "../src/volume-recovery/analysis.js";
import { createRecoveryClassifier, recoveryModelRequest } from "../src/volume-recovery/classifier.js";
import { canonicalRecoveryJson } from "../src/volume-recovery/contract.js";
import fixture from "../test/fixtures/recovery-classification.json" with { type: "json" };

// Opt-in only. This module imports no Ads reader, DB store, environment loader or job entrypoint.
export interface EvaluationApproval {
  approvedFixture: boolean;
  budgetUsd: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  priceBasis: string;
}
export function evaluationApproval(args: string[]): EvaluationApproval {
  const approved = args.includes("--approve-paid-fixture");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === "--approve-paid-fixture") continue;
    if (!["--budget-usd", "--input-usd-per-million", "--output-usd-per-million", "--cached-input-usd-per-million", "--price-basis"].includes(flag) || values.has(flag) || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error("Invalid evaluation arguments.");
    values.set(flag, args[++index]!);
  }
  const approval: EvaluationApproval = {
    approvedFixture: approved, budgetUsd: Number(values.get("--budget-usd")),
    inputUsdPerMillion: Number(values.get("--input-usd-per-million")), outputUsdPerMillion: Number(values.get("--output-usd-per-million")),
    priceBasis: values.get("--price-basis") ?? "",
    ...(values.has("--cached-input-usd-per-million") ? { cachedInputUsdPerMillion: Number(values.get("--cached-input-usd-per-million")) } : {})
  };
  assertApproval(approval);
  return approval;
}
function assertApproval(approval: EvaluationApproval) {
  if (!approval.approvedFixture) throw new Error("Paid evaluation is disabled. Obtain explicit approval for the fixture text/policy and cost before using --approve-paid-fixture.");
  if (![approval.budgetUsd, approval.inputUsdPerMillion, approval.outputUsdPerMillion, approval.cachedInputUsdPerMillion ?? 0].every(value => Number.isFinite(value) && value >= 0) || approval.budgetUsd <= 0 || !approval.priceBasis.trim() || approval.priceBasis.length > 200) throw new Error("Supply a positive USD budget, nonnegative rates and a dated pricing basis.");
}
const unique = [...new Map(fixture.cases.map(row => [JSON.stringify([row.text, row.scope, row.match]), row])).values()];
const snapshot = { rulesMarkdown: fixture.rulesMarkdown, phraseProtections: [] };
const categories = [...fixture.rulesMarkdown.matchAll(/^###\s+`([A-Z][A-Z0-9-]*-NEGATIVE)`/gm)].map(match => match[1]!);
export const evaluationCandidates: RecoveryCandidate[] = unique.map(row => ({
  key: `csv-row-${row.row}`, campaignId: null,
  exclusion: { resource: `synthetic-reference/${row.row}`, text: row.text, kind: "keyword", scope: row.scope as "campaign" | "ad_group" | "shared_list", matchType: row.match as "EXACT" | "PHRASE" | "BROAD", campaignIds: [], adGroupId: null, adGroupName: null }
}));
export function assessReference(intents: RecoveryIntent[] | null) {
  const rows = unique.map((row, index) => {
    const actual = intents?.find(item => item.itemId === evaluationCandidates[index]!.key);
    const disagreements = !actual ? ["No accepted classification"] : [
      ...(!row.categories.some(category => category === actual.category) ? ["Category differs from permitted reference meanings"] : []),
      ...(!row.competitor.some(likelihood => likelihood === actual.competitorLikelihood) ? ["Competitor inference differs from reference"] : [])
    ];
    return { csvRow: row.row, text: row.text, ambiguous: row.ambiguous, referenceMeaning: row.meaning, permittedCategories: row.categories, permittedCompetitorLikelihood: row.competitor, actual: actual ?? null, disagreements, explanationReview: "Human review required: grounded in supplied policy/text, no invented verification, performance or lead quality." };
  });
  const summary = (ambiguous: boolean) => {
    const selected = rows.filter(row => row.ambiguous === ambiguous);
    return { total: selected.length, labelAgreement: selected.filter(row => row.disagreements.length === 0).length };
  };
  return { clearCases: summary(false), ambiguousCases: summary(true), rows, note: "Label agreement is not semantic certification. Review explanations individually; self-reported confidence is not calibrated accuracy. One small trial cannot establish quality across accounts." };
}
export async function evaluateRecoveryFixture(approval: EvaluationApproval, config: AppConfig["llm"], dispatcher?: Dispatcher) {
  // Recheck even for programmatic callers; no provider factory is constructed before approval.
  assertApproval(approval);
  if (config.maxRetries !== 0 || config.provider !== "moonshot") throw new Error("This evaluation permits one Moonshot request with no retries.");
  if (evaluationCandidates.length > 25) throw new Error("Evaluation is limited to one small batch.");
  const request = recoveryModelRequest(config, fixture.accountName, snapshot, evaluationCandidates, categories);
  // Conservative planning quote, not a provider billing cap. Use full input rate for cache until actual usage is known.
  const planningInputTokens = Buffer.byteLength(JSON.stringify(request), "utf8") + 1024;
  const quoteUsd = (planningInputTokens * approval.inputUsdPerMillion + 32768 * approval.outputUsdPerMillion) / 1e6;
  if (quoteUsd > approval.budgetUsd) throw new Error("Planning quote exceeds the approved evaluation budget; no request was sent.");
  const metadata = {
    fixture: "CSV-grounded fictional-policy reference; not an original-run replay", policyHash: createHash("sha256").update(canonicalRecoveryJson(snapshot)).digest("hex"),
    inputHash: createHash("sha256").update(canonicalRecoveryJson(request)).digest("hex"),
    provider: config.provider, model: config.model, settings: { thinking: config.thinking, requestTimeoutMs: config.requestTimeoutMs, maxRetries: 0, maxTokens: 32768 },
    budgetUsd: approval.budgetUsd, planningQuoteUsd: quoteUsd, priceBasis: approval.priceBasis,
    ratesUsdPerMillion: { input: approval.inputUsdPerMillion, output: approval.outputUsdPerMillion, cachedInput: approval.cachedInputUsdPerMillion ?? approval.inputUsdPerMillion }
  };
  try {
    const response = await createRecoveryClassifier(config, dispatcher).classify(fixture.accountName, snapshot, evaluationCandidates, categories);
    const usage = response.usageReported ? { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.inputTokens + response.usage.outputTokens, cachedInputTokens: response.cachedInputTokensReported ? response.usage.cachedInputTokens : null } : null;
    const cached = usage?.cachedInputTokens ?? 0;
    const estimatedCostUsd = usage ? ((usage.inputTokens - cached) * approval.inputUsdPerMillion + cached * (approval.cachedInputUsdPerMillion ?? approval.inputUsdPerMillion) + usage.outputTokens * approval.outputUsdPerMillion) / 1e6 : null;
    return { ...metadata, status: response.intents ? "accepted" : "rejected", counts: { accepted: response.intents?.length ?? 0, rejected: response.intents ? 0 : unique.length, skipped: 0 }, usage, estimatedCostUsd,
      costBasis: usage ? "Provider-reported input/output counts and operator-supplied rates, not an invoice. Missing/invalid cache usage or rate is priced at the full input rate; unreported cache stays unknown." : "Input/output usage was absent or invalid. Cost and budget assessment are unknown, not zero.",
      budgetExceeded: estimatedCostUsd === null ? null : estimatedCostUsd > approval.budgetUsd, assessment: assessReference(response.intents) };
  } catch {
    return { ...metadata, status: "provider_unavailable", counts: { accepted: 0, rejected: unique.length, skipped: 0 }, usage: null, estimatedCostUsd: null, budgetExceeded: null, costBasis: "Request failed; usable usage was not returned. Cost is unknown, not zero.", assessment: assessReference(null) };
  }
}
async function main() {
  const approval = evaluationApproval(process.argv.slice(2)); // Refuse before touching credentials.
  const apiKey = process.env.MOONSHOT_API_KEY;
  const model = process.env.MOONSHOT_MODEL;
  if (!apiKey || !model) throw new Error("Provide MOONSHOT_API_KEY and MOONSHOT_MODEL explicitly; this command does not load .env or account credentials.");
  const config: AppConfig["llm"] = { provider: "moonshot", apiKey, model, baseUrl: "https://api.moonshot.ai/v1", thinking: "enabled", batchSize: 25, concurrency: 1, requestTimeoutMs: 600000, maxRetries: 0 };
  const result = await evaluateRecoveryFixture(approval, config);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "accepted") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write("Evaluation refused or failed. Check approval, budget, pricing basis and explicit model configuration; no raw provider error is exposed.\n"); process.exitCode = 1; });
}
