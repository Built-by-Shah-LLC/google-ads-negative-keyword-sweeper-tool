import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRuleSet } from "../src/config/rule-set.js";

import type {
  ClassificationCandidate,
  ClassificationDecision,
  Organization,
  RuleSet
} from "../src/types.js";
import { validateDecisions } from "../src/llm/validation.js";
import { buildClassifierPrompt, createResponseSchema } from "../src/llm/prompt.js";
import { createLogger } from "../src/observability/logger.js";
import { createDecisionCsv } from "../src/storage/decision-csv.js";
import { RunArtifacts } from "../src/storage/run-artifacts.js";

const logger = createLogger();

interface CandidateArtifact {
  organization: Organization;
  date: string;
  candidates: ClassificationCandidate[];
}

interface KimiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

async function main(): Promise<void> {
  const sourceArgument = process.argv[2];
  if (!sourceArgument) {
    throw new Error("Usage: npm run kimi:one-off -- <path-to-candidates.json>");
  }

  const workspace = process.cwd();
  const config = await loadKimiConfig(workspace);
  const sourcePath = resolve(workspace, sourceArgument);
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as CandidateArtifact;
  const rules = await loadRuleSet(workspace);

  if (!source.organization?.customerId || !source.date || !Array.isArray(source.candidates)) {
    throw new Error("The source candidate artifact has an invalid shape.");
  }
  if (source.candidates.length === 0) throw new Error("There are no candidates to classify.");

  const artifacts = new RunArtifacts(workspace, `kimi-${createTimestamp()}`);
  const organizationDirectory = `organizations/${source.organization.customerId}`;
  const request = createRequest(config.model, source, rules);

  await artifacts.write("run-manifest.json", {
    purpose: "One-off Kimi subscription classification test; no Google Ads mutation",
    provider: "kimi-code",
    model: config.model,
    reasoningEffort: "low",
    sourcePath,
    customerId: source.organization.customerId,
    organizationName: source.organization.descriptiveName,
    date: source.date,
    candidateCount: source.candidates.length,
    ruleVersion: rules.version
  });
  await artifacts.write(`${organizationDirectory}/candidates.json`, source);
  await artifacts.writeText("rules.md", rules.markdown);
  await artifacts.write(`${organizationDirectory}/llm/request.json`, request);

  logger.info({ candidateCount: source.candidates.length, model: config.model, reasoningEffort: "low" }, "Starting Kimi classification");
  const { payload, requestId } = await callKimi(config, request);
  await artifacts.write(`${organizationDirectory}/llm/raw-response.json`, payload);

  const choice = asRecord(payload.choices?.[0], "Kimi response choice");
  if (choice.finish_reason !== "stop") {
    throw new Error(`Kimi response did not finish normally (${String(choice.finish_reason)}).`);
  }
  const message = asRecord(choice.message, "Kimi response message");
  if (typeof message.content !== "string" || message.content.trim() === "") {
    throw new Error("Kimi returned no final response content.");
  }

  const parsed = JSON.parse(message.content) as unknown;
  const decisions = validateDecisions(parsed, source.candidates, rules);
  const counts = countDecisions(decisions);
  const usage = isRecord(payload.usage) ? payload.usage : null;

  await artifacts.write(`${organizationDirectory}/decisions.json`, {
    provider: "kimi-code",
    model: config.model,
    providerRequestId: requestId,
    ruleVersion: rules.version,
    usage,
    decisions
  });
  await artifacts.writeText(
    `${organizationDirectory}/llm-decisions.csv`,
    createDecisionCsv(
      source.organization,
      source.date,
      source.candidates,
      decisions,
      config.model,
      rules.version
    )
  );
  await artifacts.write(`${organizationDirectory}/summary.json`, {
    status: "SUCCEEDED",
    provider: "kimi-code",
    model: config.model,
    customerId: source.organization.customerId,
    organizationName: source.organization.descriptiveName,
    date: source.date,
    candidateCount: source.candidates.length,
    validatedDecisionCount: decisions.length,
    counts,
    usage,
    googleAdsMutationPerformed: false
  });

  logger.info({ result: {
    status: "SUCCEEDED",
    runDirectory: artifacts.runDirectory,
    customerId: source.organization.customerId,
    candidateCount: source.candidates.length,
    counts,
    usage,
    googleAdsMutationPerformed: false
  } }, "Kimi classification completed");
}

function createRequest(model: string, source: CandidateArtifact, rules: RuleSet): Record<string, unknown> {
  const prompt = buildClassifierPrompt({
    account: {
      customerId: source.organization.customerId,
      descriptiveName: source.organization.descriptiveName,
      timeZone: source.organization.timeZone
    },
    date: source.date,
    rules,
    searchTerms: source.candidates
  });

  return {
    model,
    messages: [
      {
        role: "system",
        content: prompt.systemInstruction
      },
      {
        role: "user",
        content: prompt.userPrompt
      }
    ],
    reasoning_effort: "low",
    max_completion_tokens: 50_000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "negative_keyword_decisions",
        strict: true,
        schema: createSchema(source.candidates, rules)
      }
    },
    prompt_cache_key: `negative-keyword-sweeper:${source.organization.customerId}:${source.date}:${rules.version}`
  };
}

function createSchema(candidates: ClassificationCandidate[], rules: RuleSet): Record<string, unknown> {
  return createResponseSchema(candidates.map((candidate) => candidate.itemId), rules.ruleIds);
}

async function callKimi(
  config: KimiConfig,
  request: Record<string, unknown>
): Promise<{ payload: Record<string, any>; requestId: string | null }> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      "user-agent": "google-ads-negative-keyword-sweeper-tool/0.1.0"
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(300_000)
  });
  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(`Kimi request failed with HTTP ${response.status}: ${safeErrorMessage(payload)}`);
  }
  if (!isRecord(payload)) throw new Error("Kimi returned a non-object response.");
  return {
    payload,
    requestId: response.headers.get("x-request-id") || (typeof payload.id === "string" ? payload.id : null)
  };
}

async function loadKimiConfig(workspace: string): Promise<KimiConfig> {
  const source = await readFile(resolve(workspace, ".env"), "utf8");
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const apiKey = process.env.KIMI_API_KEY || values.KIMI_API_KEY;
  if (!apiKey) throw new Error("KIMI_API_KEY is missing.");
  return {
    apiKey,
    baseUrl: process.env.KIMI_BASE_URL || values.KIMI_BASE_URL || "https://api.kimi.com/coding/v1",
    model: process.env.KIMI_MODEL || values.KIMI_MODEL || "kimi-for-coding"
  };
}

function countDecisions(decisions: ClassificationDecision[]): Record<string, number> {
  return decisions.reduce<Record<string, number>>((counts, item) => {
    counts[item.decision] = (counts[item.decision] ?? 0) + 1;
    return counts;
  }, { KEEP: 0, NEGATIVE_EXACT: 0 });
}

function asRecord(value: unknown, name: string): Record<string, any> {
  if (!isRecord(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeErrorMessage(payload: unknown): string {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const type = typeof error?.type === "string" ? error.type : "UNKNOWN";
  const message = typeof error?.message === "string" ? error.message : "No message returned";
  return `${type}: ${message}`;
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Kimi one-off failed");
  process.exitCode = 1;
});
