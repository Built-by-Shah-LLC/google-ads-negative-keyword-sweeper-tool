import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reviewPolicyPilot, type PilotAccountDeclaration, type PilotDecisionEvidence, type PilotDeltaReview } from "../src/pilot/policy-pilot.js";

function option(name: string): string { const index = process.argv.indexOf(name); const value = index < 0 ? undefined : process.argv[index + 1]; if (!value) throw new Error(`${name} is required.`); return value; }
async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(resolve(path), "utf8")) as T; }

const declaration = await json<PilotAccountDeclaration>(option("--declaration"));
const baseline = await json<PilotDecisionEvidence[]>(option("--baseline"));
const policy = await json<PilotDecisionEvidence[]>(option("--policy"));
const reviewsPath = process.argv.includes("--reviews") ? option("--reviews") : null;
const reviews = reviewsPath === null ? [] : await json<PilotDeltaReview[]>(reviewsPath);
const outputPath = resolve(option("--output"));
const report = reviewPolicyPilot({ declaration, baseline, policy, reviews });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ status: "REVIEW_WRITTEN", outputPath, recommendation: report.recommendation, unreviewedDeltaCount: report.unreviewedDeltaCount, stopReasons: report.stopReasons })}\n`);
