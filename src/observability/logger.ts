import pino, { type Logger } from "pino";
import type { LoggingConfig } from "../config/env.js";

const REDACTED_PATHS = [
  "apiKey",
  "authorization",
  "password",
  "refreshToken",
  "clientSecret",
  "developerToken",
  "smtp.password",
  "config.llm.apiKey",
  "config.googleAds.clientSecret",
  "config.googleAds.developerToken",
  "config.googleAds.refreshToken",
  "req.headers.authorization",
  "request.headers.authorization"
];

export function createLogger(config: LoggingConfig = { level: "info" }): Logger {
  return pino({
    name: "negative-keyword-sweeper",
    level: config.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
    base: { service: "negative-keyword-sweeper", pid: process.pid }
  });
}

export type { Logger };
