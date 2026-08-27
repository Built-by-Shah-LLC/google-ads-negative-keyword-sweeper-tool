import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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

const MODEL = "gpt-5.6-luna";
const logger = createLogger();

interface CandidateArtifact {
  organization: Organization;
  date: string;
  candidates: ClassificationCandidate[];
}

async function main(): Promise<void> {
  const sourceArgument = process.argv[2];
  if (!sourceArgument) {
    throw new Error("Usage: npm run codex:one-off -- <path-to-candidates.json>");
  }

  const workspace = process.cwd();
  const sourcePath = resolve(workspace, sourceArgument);
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as CandidateArtifact;
  const rules = await loadRuleSet(workspace);

  if (!source.organization?.customerId || !source.date || !Array.isArray(source.candidates)) {
    throw new Error("The source candidate artifact has an invalid shape.");
  }
  if (source.candidates.length === 0) throw new Error("There are no candidates to classify.");

  const artifacts = new RunArtifacts(resolve(workspace), `codex-${createTimestamp()}`);
  const organizationDirectory = `organizations/${source.organization.customerId}`;
  const schemaPath = resolve(artifacts.runDirectory, "codex-output-schema.json");
  const rawOutputPath = resolve(artifacts.runDirectory, "codex-raw-output.json");
  const prompt = createPrompt(source, rules);
  const schema = createSchema(source.candidates, rules);

  await artifacts.write("run-manifest.json", {
    purpose: "One-off subscription-backed classification test; no Google Ads mutation",
    model: MODEL,
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
  await artifacts.writeText("codex-prompt.txt", prompt);
  await artifacts.write("codex-output-schema.json", schema);

  logger.info({ candidateCount: source.candidates.length, model: MODEL, reasoningEffort: "low" }, "Starting Codex classification");
  await executeCodex(workspace, schemaPath, rawOutputPath, prompt);

  const rawOutput = JSON.parse(await readFile(rawOutputPath, "utf8")) as unknown;
  const decisions = validateDecisions(rawOutput, source.candidates, rules);
  const counts = countDecisions(decisions);

  await artifacts.write(`${organizationDirectory}/decisions.json`, {
    model: MODEL,
    ruleVersion: rules.version,
    decisions
  });
  await artifacts.writeText(
    `${organizationDirectory}/llm-decisions.csv`,
    createDecisionCsv(
      source.organization,
      source.date,
      source.candidates,
      decisions,
      MODEL,
      rules.version
    )
  );
  await artifacts.write(`${organizationDirectory}/summary.json`, {
    status: "SUCCEEDED",
    customerId: source.organization.customerId,
    organizationName: source.organization.descriptiveName,
    date: source.date,
    candidateCount: source.candidates.length,
    validatedDecisionCount: decisions.length,
    counts,
    googleAdsMutationPerformed: false
  });

  logger.info({ result: {
    status: "SUCCEEDED",
    runDirectory: artifacts.runDirectory,
    customerId: source.organization.customerId,
    candidateCount: source.candidates.length,
    counts,
    googleAdsMutationPerformed: false
  } }, "Codex classification completed");
}

function createPrompt(source: CandidateArtifact, rules: RuleSet): string {
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
  return `${prompt.systemInstruction}\n\n${prompt.userPrompt}`;
}

function createSchema(candidates: ClassificationCandidate[], rules: RuleSet): Record<string, unknown> {
  return createResponseSchema(candidates.map((candidate) => candidate.itemId), rules.ruleIds);
}

async function executeCodex(
  workspace: string,
  schemaPath: string,
  outputPath: string,
  prompt: string
): Promise<void> {
  const codexArguments = [
    "exec",
    "-m", MODEL,
    "-c", 'model_reasoning_effort="low"',
    "--sandbox", "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--output-schema", schemaPath,
    "--output-last-message", outputPath,
    "-C", workspace,
    "-"
  ];
  const appData = process.env.APPDATA;
  const executable = process.platform === "win32" ? process.execPath : "codex";
  const argumentsList = process.platform === "win32"
    ? [
        join(appData ?? "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js"),
        ...codexArguments
      ]
    : codexArguments;

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, argumentsList, {
      cwd: workspace,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let diagnosticOutput = "";

    child.stdout.on("data", (chunk: Buffer) => {
      diagnosticOutput = retainTail(diagnosticOutput + chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      diagnosticOutput = retainTail(diagnosticOutput + chunk.toString("utf8"));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Codex CLI exited with code ${code}. Diagnostic tail:\n${diagnosticOutput}`));
    });
    child.stdin.end(prompt, "utf8");
  });
}

function retainTail(value: string): string {
  return value.length <= 4_000 ? value : value.slice(-4_000);
}

function countDecisions(decisions: ClassificationDecision[]): Record<string, number> {
  return decisions.reduce<Record<string, number>>((counts, item) => {
    counts[item.decision] = (counts[item.decision] ?? 0) + 1;
    return counts;
  }, { KEEP: 0, NEGATIVE_EXACT: 0 });
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Codex one-off failed");
  process.exitCode = 1;
});
