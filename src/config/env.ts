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

export interface LoggingConfig {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
}

export type EmailAlertConfig = {
  enabled: false;
  handledErrorCodes: string[];
  handledErrorStages: string[];
} | {
  enabled: true;
  recipients: string[];
  from: string;
  subjectPrefix: string;
  handledErrorCodes: string[];
  handledErrorStages: string[];
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
  };
};

export interface OperationalConfig {
  logging: LoggingConfig;
  emailAlerts: EmailAlertConfig;
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

function booleanValue(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === "") return fallback;
  if (/^(?:true|1|yes)$/iu.test(value)) return true;
  if (/^(?:false|0|no)$/iu.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function commaSeparated(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function loadEnvironment(rootDirectory: string): Promise<Record<string, string | undefined>> {
  let fileValues: Record<string, string> = {};
  let localValues: Record<string, string> = {};
  try {
    fileValues = parseDotEnv(await readFile(resolve(rootDirectory, ".env"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    localValues = parseDotEnv(await readFile(resolve(rootDirectory, ".env.openai"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { ...fileValues, ...localValues, ...process.env };
}

export async function loadOperationalConfig(rootDirectory = process.cwd()): Promise<OperationalConfig> {
  const env = await loadEnvironment(rootDirectory);
  const level = env.LOG_LEVEL || "info";
  if (!new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).has(level)) {
    throw new Error("LOG_LEVEL must be trace, debug, info, warn, error, fatal, or silent.");
  }

  const handledErrorCodes = commaSeparated(env.ALERT_HANDLED_ERROR_CODES);
  const handledErrorStages = commaSeparated(env.ALERT_HANDLED_ERROR_STAGES);
  const enabled = booleanValue(env.ERROR_EMAIL_ENABLED, false, "ERROR_EMAIL_ENABLED");
  if (!enabled) {
    return {
      logging: { level: level as LoggingConfig["level"] },
      emailAlerts: { enabled: false, handledErrorCodes, handledErrorStages }
    };
  }

  const recipients = commaSeparated(env.ERROR_EMAIL_TO);
  const missing = [
    recipients.length === 0 ? "ERROR_EMAIL_TO" : null,
    !env.ERROR_EMAIL_FROM ? "ERROR_EMAIL_FROM" : null,
    !env.SMTP_HOST ? "SMTP_HOST" : null
  ].filter((item): item is string => item !== null);
  if (missing.length > 0) {
    throw new Error(`Email alerts are enabled but configuration is missing: ${missing.join(", ")}`);
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must either both be configured or both be omitted.");
  }

  const smtp: Extract<EmailAlertConfig, { enabled: true }>["smtp"] = {
    host: env.SMTP_HOST!,
    port: positiveInteger(env.SMTP_PORT, 587, "SMTP_PORT"),
    secure: booleanValue(env.SMTP_SECURE, false, "SMTP_SECURE")
  };
  if (env.SMTP_USER && env.SMTP_PASSWORD) {
    smtp.user = env.SMTP_USER;
    smtp.password = env.SMTP_PASSWORD;
  }
  return {
    logging: { level: level as LoggingConfig["level"] },
    emailAlerts: {
      enabled: true,
      recipients,
      from: env.ERROR_EMAIL_FROM!,
      subjectPrefix: env.ERROR_EMAIL_SUBJECT_PREFIX || "[Negative Keyword Sweeper]",
      handledErrorCodes,
      handledErrorStages,
      smtp
    }
  };
}

export async function loadConfig(rootDirectory = process.cwd()): Promise<AppConfig> {
  const env = await loadEnvironment(rootDirectory);
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "OPENAI_API_KEY"
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
      apiKey: env.OPENAI_API_KEY!,
      model: env.OPENAI_MODEL || env.LLM_MODEL || "gpt-5.6-luna",
      batchSize: positiveInteger(env.LLM_BATCH_SIZE, 50, "LLM_BATCH_SIZE"),
      concurrency: positiveInteger(env.LLM_CONCURRENCY, 3, "LLM_CONCURRENCY")
    },
    googleFetchConcurrency: positiveInteger(env.GOOGLE_FETCH_CONCURRENCY, 5, "GOOGLE_FETCH_CONCURRENCY")
  };
}
