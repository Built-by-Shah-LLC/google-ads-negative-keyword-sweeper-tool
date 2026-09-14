import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Organization } from "../types.js";

/**
 * One company in the fixed sweep master list. Customer IDs are stored as ten
 * digits without dashes so they can be compared directly against Google Ads
 * customer_client.id values.
 */
export interface SweepAccount {
  customerId: string;
  name: string;
}

export interface SweepAccountSelection {
  /** master-file = config/sweep-accounts.json replaced ACCOUNT_ALLOWLIST; env-allowlist = legacy fallback. */
  source: "master-file" | "env-allowlist";
  filePath: string;
  accounts: SweepAccount[];
}

export const DEFAULT_SWEEP_ACCOUNTS_FILE = "config/sweep-accounts.json";
export const DEFAULT_SWEEP_30DAY_STATE_FILE = "data/sweep-30day-state.json";

/**
 * Master-list companies that (as of 2026-09-15) have no active row in the
 * Built Ads Manager client_accounts mapping. Persistence intentionally fails
 * closed for these accounts; the pipeline refuses to report their runs as
 * durably persisted. Update this list when the mapping lands — it is a static
 * cross-check note, not live DB state.
 */
export const KNOWN_MISSING_CLIENT_ACCOUNT_MAPPINGS: readonly string[] = [
  "8820051592", // CARSTAR - Santa Maria
  "8724978591", // Chris Auto Body
  "9879723872", // G&S Custom Auto Body, inc. d/b/a Bella's Collision
  "5166711284", // Streamline Collision Inc
  "3522557954", // Sunrise Auto Body
  "4007102747", // TRI STATE AUTO BODY
  "2356287166" // US Auto Connection
];

export function resolveSweepPath(rootDirectory: string, value: string | undefined, fallback: string): string {
  const raw = (value ?? "").trim() || fallback;
  return isAbsolute(raw) ? raw : resolve(rootDirectory, raw);
}

/** Strips dashes and spaces so "850-080-9656" and "8500809656" compare equal. */
export function normalizeCustomerId(value: string): string {
  return value.replace(/[\s-]/gu, "");
}

export function parseSweepAccountList(source: string, filePath: string): SweepAccount[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Sweep accounts file ${filePath} is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Sweep accounts file ${filePath} must contain a non-empty array of accounts.`);
  }
  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    const label = `Sweep accounts file ${filePath} entry ${index + 1}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${label} must be an object with customerId and name.`);
    }
    const { customerId, name } = entry as Record<string, unknown>;
    if (typeof customerId !== "string" || !/^\d{10}$/u.test(customerId)) {
      throw new Error(`${label} customerId must be exactly ten digits without dashes.`);
    }
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(`${label} name must be a non-empty string.`);
    }
    if (seen.has(customerId)) {
      throw new Error(`${label} duplicates customerId ${customerId}.`);
    }
    seen.add(customerId);
    return { customerId, name: name.trim() };
  });
}

export async function loadSweepAccountList(filePath: string): Promise<SweepAccount[]> {
  return parseSweepAccountList(await readFile(filePath, "utf8"), filePath);
}

/**
 * Loads the fixed sweep master list. When the file exists and is valid it
 * replaces ACCOUNT_ALLOWLIST filtering entirely. When the file is missing the
 * caller falls back to the legacy ACCOUNT_ALLOWLIST environment filtering;
 * any other problem (invalid JSON, bad shape, duplicate IDs) fails fast.
 */
export async function loadSweepAccountSelection(
  rootDirectory: string,
  environmentValue: string | undefined
): Promise<SweepAccountSelection> {
  const filePath = resolveSweepPath(rootDirectory, environmentValue, DEFAULT_SWEEP_ACCOUNTS_FILE);
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { source: "env-allowlist", filePath, accounts: [] };
    }
    throw error;
  }
  return { source: "master-file", filePath, accounts: parseSweepAccountList(source, filePath) };
}

/** Keeps only discovered organizations whose customer ID is in the master list. */
export function filterOrganizationsBySweepAccounts(
  organizations: Organization[],
  accounts: SweepAccount[]
): Organization[] {
  const ids = new Set(accounts.map((account) => account.customerId));
  return organizations.filter((organization) => ids.has(normalizeCustomerId(organization.customerId)));
}

export function sweepAccountFor(accounts: SweepAccount[], customerId: string): SweepAccount | undefined {
  const normalized = normalizeCustomerId(customerId);
  return accounts.find((account) => account.customerId === normalized);
}
