import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeCustomerId } from "./sweep-accounts.js";

/**
 * Completion record for one company's initial 30-day-lookback sweep. The
 * regular sweeper only runs for companies that have one of these records.
 */
export interface Sweep30DayCompletion {
  completedAt: string;
  source: string;
  runId?: string;
}

export interface Sweep30DayState {
  version: number;
  completed: Record<string, Sweep30DayCompletion>;
}

export interface Sweep30DayStateLoad {
  state: Sweep30DayState;
  filePath: string;
  /** false when the file does not exist; callers must treat that as "no completions". */
  existed: boolean;
}

export function emptySweep30DayState(): Sweep30DayState {
  return { version: 1, completed: {} };
}

export function parseSweep30DayState(source: string, filePath: string): Sweep30DayState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`30-day sweep state file ${filePath} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`30-day sweep state file ${filePath} must contain an object.`);
  }
  const { version, completed } = parsed as Record<string, unknown>;
  if (version !== 1) {
    throw new Error(`30-day sweep state file ${filePath} must have "version": 1.`);
  }
  if (typeof completed !== "object" || completed === null || Array.isArray(completed)) {
    throw new Error(`30-day sweep state file ${filePath} must contain a "completed" object.`);
  }
  const records: Record<string, Sweep30DayCompletion> = {};
  for (const [customerId, value] of Object.entries(completed as Record<string, unknown>)) {
    if (!/^\d{10}$/u.test(customerId)) {
      throw new Error(`30-day sweep state file ${filePath} key '${customerId}' must be ten digits.`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`30-day sweep state file ${filePath} entry '${customerId}' must be an object.`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.completedAt !== "string" || Number.isNaN(new Date(record.completedAt).getTime())) {
      throw new Error(`30-day sweep state file ${filePath} entry '${customerId}' needs a valid completedAt timestamp.`);
    }
    records[customerId] = {
      completedAt: record.completedAt,
      source: typeof record.source === "string" && record.source ? record.source : "unknown",
      ...(typeof record.runId === "string" && record.runId ? { runId: record.runId } : {})
    };
  }
  return { version: 1, completed: records };
}

/** Reads the state file; a missing file yields an empty state with existed=false. */
export async function loadSweep30DayState(filePath: string): Promise<Sweep30DayStateLoad> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: emptySweep30DayState(), filePath, existed: false };
    }
    throw error;
  }
  return { state: parseSweep30DayState(source, filePath), filePath, existed: true };
}

export function hasSweep30DayCompletion(state: Sweep30DayState, customerId: string): boolean {
  return normalizeCustomerId(customerId) in state.completed;
}

/**
 * Atomically records one company's completed 30-day sweep: the updated state
 * is written to a sibling temporary file and renamed over the original, so a
 * crash can never leave a half-written state file behind.
 */
export async function recordSweep30DayCompletion(
  filePath: string,
  customerId: string,
  details: { runId: string; completedAt?: string; source?: string }
): Promise<Sweep30DayState> {
  const normalized = normalizeCustomerId(customerId);
  if (!/^\d{10}$/u.test(normalized)) {
    throw new Error(`30-day completion customer ID '${customerId}' must be ten digits.`);
  }
  const { state } = await loadSweep30DayState(filePath);
  const next: Sweep30DayState = {
    version: 1,
    completed: {
      ...state.completed,
      [normalized]: {
        completedAt: details.completedAt ?? new Date().toISOString(),
        source: details.source ?? "sweep:30day",
        runId: details.runId
      }
    }
  };
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
  return next;
}
