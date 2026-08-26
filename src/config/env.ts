import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface AppConfig {
  googleAds: {
    apiVersion: string;
    developerToken: string;
    loginCustomerId: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
  llm: {
    apiKey: string;
    model: string;
    batchSize: number;
    concurrency: number;
  };
  googleFetchConcurrency: number;
}

function parseDotEnv(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export async function loadConfig(rootDirectory = process.cwd()): Promise<AppConfig> {
  let fileValues: Record<string, string> = {};
  try {
    fileValues = parseDotEnv(await readFile(resolve(rootDirectory, ".env"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const env = { ...fileValues, ...process.env };
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GEMINI_API_KEY"
  ] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }

  return {
    googleAds: {
      apiVersion: env.GOOGLE_ADS_API_VERSION || "v25",
      developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!.replaceAll("-", ""),
      clientId: env.GOOGLE_ADS_CLIENT_ID!,
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET!,
      refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN!
    },
    llm: {
      apiKey: env.GEMINI_API_KEY!,
      model: env.LLM_MODEL || "gemini-3.1-flash-lite",
      batchSize: positiveInteger(env.LLM_BATCH_SIZE, 30, "LLM_BATCH_SIZE"),
      concurrency: positiveInteger(env.LLM_CONCURRENCY, 3, "LLM_CONCURRENCY")
    },
    googleFetchConcurrency: positiveInteger(env.GOOGLE_FETCH_CONCURRENCY, 5, "GOOGLE_FETCH_CONCURRENCY")
  };
}
