import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config/env.js";
import type { RuleSet } from "./types.js";
import { runSweeper, type SweepOptions } from "./pipeline/run-sweeper.js";

async function main(): Promise<void> {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseArguments(process.argv.slice(2), rootDirectory);
  const config = await loadConfig(rootDirectory);
  const rules = JSON.parse(await readFile(resolve(rootDirectory, "src/config/negative-keyword-rules.json"), "utf8")) as RuleSet;

  console.log("Starting read-only Google Ads → Gemini classification pipeline.");
  console.log(options.allOrganizations
    ? "Scope: every enabled leaf organization."
    : options.customerId
      ? `Scope: customer ${options.customerId.replaceAll("-", "")}.`
      : `Scope: first ${options.organizationLimit ?? 1} organization(s); use --all-organizations for the full MCC.`);

  const result = await runSweeper(config, rules, options);
  console.log(`Run ${result.status}: ${result.runId}`);
  console.log(`Artifacts: ${result.runDirectory}`);
  if (result.status === "FAILED") process.exitCode = 1;
}

function parseArguments(argumentsList: string[], rootDirectory: string): SweepOptions {
  const options: SweepOptions = {
    rootDirectory,
    date: null,
    customerId: null,
    organizationLimit: 1,
    allOrganizations: false
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--all-organizations") {
      options.allOrganizations = true;
      options.organizationLimit = null;
      continue;
    }
    if (argument === "--date" || argument === "--customer" || argument === "--organization-limit") {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--date") {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("--date must use YYYY-MM-DD.");
        options.date = value;
      } else if (argument === "--customer") {
        if (!/^[\d-]+$/u.test(value)) throw new Error("--customer must be a Google Ads customer ID.");
        options.customerId = value;
      } else {
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--organization-limit must be positive.");
        options.organizationLimit = limit;
      }
      continue;
    }
    throw new Error(`Unknown argument '${argument}'.`);
  }
  if (options.customerId && options.allOrganizations) {
    throw new Error("Use either --customer or --all-organizations, not both.");
  }
  return options;
}

main().catch((error: unknown) => {
  console.error(`Sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
