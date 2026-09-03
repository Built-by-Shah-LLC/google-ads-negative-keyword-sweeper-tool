import type { RunReportEmailConfig } from "../config/env.js";
import { PipelineError } from "../observability/errors.js";
import type { Logger } from "../observability/logger.js";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export interface RunReportMessage {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  workbook: Buffer;
  filename: string;
  organizationCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RunReportDelivery {
  status: "SENT" | "DISABLED";
  messageId: string | null;
  attemptCount: number;
  sentAt: string | null;
}

export class RunReportEmailService {
  constructor(
    private readonly config: RunReportEmailConfig,
    private readonly logger: Logger,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {}

  async send(message: RunReportMessage): Promise<RunReportDelivery> {
    if (!this.config.enabled) {
      this.logger.info({ runId: message.runId }, "Run report email skipped because it is disabled");
      return { status: "DISABLED", messageId: null, attemptCount: 0, sentAt: null };
    }

    const payload = {
      from: this.config.from,
      to: this.config.recipients,
      subject: `${this.config.subjectPrefix} ${message.status} — ${message.runId}`,
      text: [
        `Negative keyword sweeper run ${message.runId} finished with status ${message.status}.`,
        `Organizations: ${message.organizationCount}`,
        `Actual LLM generation input tokens: ${message.inputTokens}`,
        `Actual LLM generation output tokens: ${message.outputTokens}`,
        `Calculated generation total (input + output): ${message.inputTokens + message.outputTokens}`,
        "The attached Excel workbook contains one worksheet per organization, including decisions, rules, reasons, batch token usage, and errors/timeouts."
      ].join("\n"),
      attachments: [{
        filename: message.filename,
        content: message.workbook.toString("base64"),
        content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }]
    };

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImplementation(RESEND_EMAILS_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": `negative-keyword-sweeper-${message.runId}`
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });
      } catch (error) {
        if (attempt < this.config.maxRetries) {
          this.logger.warn({
            runId: message.runId,
            attempt: attempt + 1,
            timedOut: isTimeoutError(error)
          }, "Run report email request will retry");
          await wait(backoffMs(attempt));
          continue;
        }
        const timedOut = isTimeoutError(error);
        throw new PipelineError(
          timedOut
            ? `Resend report email timed out after ${this.config.requestTimeoutMs}ms.`
            : `Resend report email network request failed: ${errorMessage(error)}`,
          {
            stage: "RUN_REPORT_EMAIL",
            code: timedOut ? "RESEND_TIMEOUT" : "RESEND_NETWORK_ERROR",
            provider: "resend",
            retryable: true,
            details: { attemptCount: attempt + 1 }
          },
          { cause: asError(error) }
        );
      }

      const responsePayload = await readJsonSafely(response);
      if (response.ok && isRecord(responsePayload) && typeof responsePayload.id === "string") {
        const result: RunReportDelivery = {
          status: "SENT",
          messageId: responsePayload.id,
          attemptCount: attempt + 1,
          sentAt: new Date().toISOString()
        };
        this.logger.info({
          runId: message.runId,
          messageId: result.messageId,
          recipients: this.config.recipients,
          attemptCount: result.attemptCount
        }, "Run report email sent");
        return result;
      }

      const detail = safeErrorMessage(responsePayload);
      const retrying = RETRYABLE_STATUS.has(response.status) && attempt < this.config.maxRetries;
      if (retrying) {
        this.logger.warn({
          runId: message.runId,
          attempt: attempt + 1,
          statusCode: response.status,
          error: detail
        }, "Run report email request will retry");
        await wait(retryDelayMs(response, attempt));
        continue;
      }
      throw new PipelineError(`Resend report email failed with HTTP ${response.status}: ${detail}`, {
        stage: "RUN_REPORT_EMAIL",
        code: "RESEND_HTTP_ERROR",
        provider: "resend",
        statusCode: response.status,
        requestId: response.headers.get("x-request-id"),
        retryable: RETRYABLE_STATUS.has(response.status),
        details: { attemptCount: attempt + 1 }
      });
    }
    throw new Error("Resend retry loop ended unexpectedly.");
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter && /^\d+(?:\.\d+)?$/u.test(retryAfter) ? Number(retryAfter) : 0;
  return Math.max(backoffMs(attempt), seconds * 1000) + Math.floor(Math.random() * 250);
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) return "No JSON error detail returned";
  if (typeof payload.message === "string") return payload.message;
  const error = isRecord(payload.error) ? payload.error : null;
  return typeof error?.message === "string" ? error.message : "No message returned";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
