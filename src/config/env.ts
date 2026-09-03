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
    provider: LlmProvider;
    apiKey: string;
    model: string;
    baseUrl: string;
    thinking: "enabled" | "disabled";
    batchSize: number;
    concurrency: number;
    requestTimeoutMs: number;
    maxRetries: number;
  };
  processingTimeZone: string;
  googleFetchConcurrency: number;
  /**
   * Only campaigns whose name contains this text (case-insensitive) are handled.
   * Defaults to "Built by Shah"; set CAMPAIGN_NAME_CONTAINS to an empty value to disable.
   */
  campaignNameContains: string | null;
  /**
   * Optional allowlist of accounts to process: customer IDs (digits, dashes ignored)
   * or case-insensitive account-name fragments. Empty means every enabled leaf account.
   */
  accountAllowlist: string[];
}

export type LlmProvider = "moonshot" | "openai" | "gemini" | "kimi-code";

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

export type RunReportEmailConfig = {
  enabled: false;
} | {
  enabled: true;
  apiKey: string;
  recipients: string[];
  from: string;
  subjectPrefix: string;
  requestTimeoutMs: number;
  maxRetries: number;
};

export interface OperationalConfig {
  logging: LoggingConfig;
  emailAlerts: EmailAlertConfig;
  runReportEmail: RunReportEmailConfig;
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
  const runReportEmail = loadRunReportEmailConfig(env);
  const enabled = booleanValue(env.ERROR_EMAIL_ENABLED, false, "ERROR_EMAIL_ENABLED");
  if (!enabled) {
    return {
      logging: { level: level as LoggingConfig["level"] },
      emailAlerts: { enabled: false, handledErrorCodes, handledErrorStages },
      runReportEmail
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
    runReportEmail,
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
  const provider = llmProvider(env.LLM_PROVIDER);
  const providerConfig = selectedProviderConfig(provider, env);
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN"
  ] as const;
  const missing: string[] = required.filter((name) => !env[name]);
  if (!providerConfig.apiKey) missing.push(providerConfig.apiKeyVariable);
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
      provider,
      apiKey: providerConfig.apiKey,
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
      thinking: thinkingMode(provider, env.MOONSHOT_THINKING),
      batchSize: positiveInteger(env.LLM_BATCH_SIZE, 50, "LLM_BATCH_SIZE"),
      concurrency: positiveInteger(env.LLM_CONCURRENCY, 3, "LLM_CONCURRENCY"),
      requestTimeoutMs: positiveInteger(env.LLM_REQUEST_TIMEOUT_MS, 600_000, "LLM_REQUEST_TIMEOUT_MS"),
      maxRetries: positiveInteger(env.LLM_MAX_ATTEMPTS, 5, "LLM_MAX_ATTEMPTS") - 1
    },
    processingTimeZone: timeZoneValue(env.RUN_TIME_ZONE || "Europe/Moscow", "RUN_TIME_ZONE"),
    googleFetchConcurrency: positiveInteger(env.GOOGLE_FETCH_CONCURRENCY, 5, "GOOGLE_FETCH_CONCURRENCY"),
    campaignNameContains: campaignNameContainsValue(env.CAMPAIGN_NAME_CONTAINS),
    accountAllowlist: commaSeparated(env.ACCOUNT_ALLOWLIST)
  };
}

function campaignNameContainsValue(value: string | undefined): string | null {
  if (value === undefined) return "Built by Shah";
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function timeZoneValue(value: string, name: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error(`${name} must be a valid IANA timezone, such as Europe/Moscow.`);
  }
}

function thinkingMode(
  provider: LlmProvider,
  value: string | undefined
): "enabled" | "disabled" {
  if (provider !== "moonshot") return "disabled";
  if (value === undefined || value === "") return "enabled";
  const normalized = value.trim().toLowerCase();
  if (normalized === "enabled" || normalized === "on" || normalized === "true" || normalized === "1") {
    return "enabled";
  }
  if (normalized === "disabled" || normalized === "off" || normalized === "false" || normalized === "0") {
    return "disabled";
  }
  throw new Error("MOONSHOT_THINKING must be enabled or disabled.");
}

function llmProvider(value: string | undefined): LlmProvider {
  const normalized = (value || "moonshot").trim().toLowerCase();
  if (normalized === "google-gemini") return "gemini";
  if (normalized === "kimi" || normalized === "moonshot-kimi") return "moonshot";
  if (normalized === "moonshot" || normalized === "openai" || normalized === "gemini" || normalized === "kimi-code") {
    return normalized;
  }
  throw new Error("LLM_PROVIDER must be moonshot, openai, gemini, or kimi-code.");
}

function selectedProviderConfig(
  provider: LlmProvider,
  env: Record<string, string | undefined>
): { apiKeyVariable: string; apiKey: string; model: string; baseUrl: string } {
  if (provider === "openai") {
    return {
      apiKeyVariable: "OPENAI_API_KEY",
      apiKey: env.OPENAI_API_KEY || "",
      model: env.OPENAI_MODEL || env.LLM_MODEL || "gpt-5-mini",
      baseUrl: "https://api.openai.com/v1"
    };
  }
  if (provider === "gemini") {
    return {
      apiKeyVariable: "GEMINI_API_KEY",
      apiKey: env.GEMINI_API_KEY || "",
      model: env.GEMINI_MODEL || env.LLM_MODEL || "gemini-3.1-flash-lite",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta"
    };
  }
  if (provider === "kimi-code") {
    return {
      apiKeyVariable: "KIMI_API_KEY",
      apiKey: env.KIMI_API_KEY || "",
      model: env.KIMI_MODEL || env.LLM_MODEL || "kimi-for-coding",
      baseUrl: (env.KIMI_BASE_URL || "https://api.kimi.com/coding/v1").replace(/\/$/u, "")
    };
  }
  return {
    apiKeyVariable: "MOONSHOT_API_KEY",
    apiKey: env.MOONSHOT_API_KEY || "",
    model: env.MOONSHOT_MODEL || env.LLM_MODEL || "kimi-k2.6",
    baseUrl: (env.MOONSHOT_BASE_URL || "https://api.moonshot.ai/v1").replace(/\/$/u, "")
  };
}

function loadRunReportEmailConfig(env: Record<string, string | undefined>): RunReportEmailConfig {
  const enabled = booleanValue(env.RUN_REPORT_EMAIL_ENABLED, false, "RUN_REPORT_EMAIL_ENABLED");
  if (!enabled) return { enabled: false };
  const recipients = commaSeparated(env.RUN_REPORT_EMAIL_TO);
  const missing = [
    !env.RESEND_API_KEY ? "RESEND_API_KEY" : null,
    recipients.length === 0 ? "RUN_REPORT_EMAIL_TO" : null,
    !env.RUN_REPORT_EMAIL_FROM ? "RUN_REPORT_EMAIL_FROM" : null
  ].filter((item): item is string => item !== null);
  if (missing.length > 0) {
    throw new Error(`Run report email is enabled but configuration is missing: ${missing.join(", ")}`);
  }
  return {
    enabled: true,
    apiKey: env.RESEND_API_KEY!,
    recipients,
    from: env.RUN_REPORT_EMAIL_FROM!,
    subjectPrefix: env.RUN_REPORT_EMAIL_SUBJECT_PREFIX || "[Negative Keyword Sweeper]",
    requestTimeoutMs: positiveInteger(env.RESEND_REQUEST_TIMEOUT_MS, 60_000, "RESEND_REQUEST_TIMEOUT_MS"),
    maxRetries: positiveInteger(env.RESEND_MAX_ATTEMPTS, 5, "RESEND_MAX_ATTEMPTS") - 1
  };
}
