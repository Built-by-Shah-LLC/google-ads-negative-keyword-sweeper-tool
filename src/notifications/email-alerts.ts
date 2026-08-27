import nodemailer, { type Transporter } from "nodemailer";
import type { EmailAlertConfig } from "../config/env.js";
import type { SerializedError } from "../observability/errors.js";
import type { Logger } from "../observability/logger.js";

export interface AlertContext {
  runId?: string;
  runDirectory?: string;
}

type AlertKind = "UNHANDLED" | "HANDLED";

export class EmailAlertService {
  private readonly transporter: Transporter | null;
  private readonly pending = new Set<Promise<void>>();
  private readonly handledFingerprints = new Set<string>();

  constructor(
    private readonly config: EmailAlertConfig,
    private readonly logger: Logger,
    transporter?: Transporter
  ) {
    this.transporter = config.enabled
      ? transporter ?? nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
          ...(config.smtp.user && config.smtp.password
            ? { auth: { user: config.smtp.user, pass: config.smtp.password } }
            : {})
        })
      : null;
  }

  notifyHandled(error: SerializedError, context: AlertContext = {}): void {
    if (!this.config.enabled || !this.matchesHandledPolicy(error)) return;
    const fingerprint = [error.code, error.stage, error.organizationId, error.batchId, error.message].join("|");
    if (this.handledFingerprints.has(fingerprint)) return;
    this.handledFingerprints.add(fingerprint);
    this.enqueue("HANDLED", error, context);
  }

  async notifyUnhandled(error: SerializedError, context: AlertContext = {}): Promise<void> {
    if (!this.config.enabled) {
      this.logger.warn({ stage: error.stage, code: error.code }, "Unhandled-error email was skipped because email alerts are disabled");
      return;
    }
    await this.send("UNHANDLED", error, context);
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  close(): void {
    this.transporter?.close();
  }

  private matchesHandledPolicy(error: SerializedError): boolean {
    if (!this.config.enabled) return false;
    return this.config.handledErrorCodes.includes("*")
      || (error.code !== undefined && this.config.handledErrorCodes.includes(error.code))
      || this.config.handledErrorStages.includes("*")
      || this.config.handledErrorStages.includes(error.stage);
  }

  private enqueue(kind: AlertKind, error: SerializedError, context: AlertContext): void {
    const operation = this.send(kind, error, context).finally(() => this.pending.delete(operation));
    this.pending.add(operation);
  }

  private async send(kind: AlertKind, error: SerializedError, context: AlertContext): Promise<void> {
    if (!this.config.enabled || !this.transporter) return;
    const subject = `${this.config.subjectPrefix} ${kind}: ${error.code ?? error.stage}`;
    const body = [
      `Error kind: ${kind}`,
      `Occurred at: ${error.occurredAt}`,
      `Stage: ${error.stage}`,
      `Code: ${error.code ?? "not provided"}`,
      `Message: ${error.message}`,
      `Retryable: ${error.retryable ?? "not provided"}`,
      `Provider: ${error.provider ?? "not provided"}`,
      `HTTP status: ${error.statusCode ?? "not provided"}`,
      `Provider request ID: ${error.requestId ?? "not provided"}`,
      `Run ID: ${context.runId ?? "not available"}`,
      `Organization ID: ${error.organizationId ?? "not available"}`,
      `Batch ID: ${error.batchId ?? "not available"}`,
      `Run directory: ${context.runDirectory ?? "not available"}`,
      "",
      "Structured error:",
      JSON.stringify(error, null, 2)
    ].join("\n");

    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: this.config.recipients,
        subject,
        text: body
      });
      this.logger.info({
        alertKind: kind,
        errorCode: error.code,
        errorStage: error.stage,
        messageId: info.messageId,
        recipients: this.config.recipients
      }, "Error alert email sent");
    } catch (sendError) {
      this.logger.error({
        err: sendError,
        alertKind: kind,
        errorCode: error.code,
        errorStage: error.stage
      }, "Failed to send error alert email");
    }
  }
}
