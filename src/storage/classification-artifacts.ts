import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SerializedError } from "../observability/errors.js";
import type { ClassificationCandidate, ClassificationDecision } from "../types.js";

export interface OrganizationClassificationArtifacts {
  candidates: ClassificationCandidate[];
  decisions: ClassificationDecision[];
  errors: SerializedError[];
}

/**
 * Loads the durable classification artifacts for one organization in a run.
 * Missing files are valid for a failed or interrupted organization and produce
 * empty collections so downstream reports can still describe that account.
 */
export async function loadOrganizationClassificationArtifacts(
  runDirectory: string,
  customerId: string
): Promise<OrganizationClassificationArtifacts> {
  const base = join(runDirectory, "organizations", customerId);
  const candidatesFile = await readJsonIfExists<{ candidates?: ClassificationCandidate[] }>(join(base, "candidates.json"));
  const decisionsFile = await readJsonIfExists<{ decisions?: ClassificationDecision[] }>(join(base, "decisions.json"));
  const errorsFile = await readJsonIfExists<{ errors?: SerializedError[] }>(join(base, "errors.json"));
  return {
    candidates: Array.isArray(candidatesFile?.candidates) ? candidatesFile.candidates : [],
    decisions: Array.isArray(decisionsFile?.decisions) ? decisionsFile.decisions : [],
    errors: Array.isArray(errorsFile?.errors) ? errorsFile.errors : []
  };
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
