import type { RunReportMessage } from "./run-report-email.js";
import { renderRunReportEmailHtml, renderRunReportEmailText } from "./run-report-template.js";

type Outcome = "sent" | "failed" | "uncertain";

export interface ManualSweepReportSender {
  readonly requestId: string;
  readonly allowlist: readonly string[];
  readonly send: (message: RunReportMessage, address: string, userId: string) => Promise<Outcome>;
}

/** Only the manual job reads these settings. An empty allowlist disables delivery. */
export function manualSweepReportSender(requestId: string, environment = process.env, fetchEmail = fetch): ManualSweepReportSender {
  const from = environment.MANUAL_SWEEP_REPORT_FROM?.trim();
  const apiKey = environment.RESEND_API_KEY?.trim();
  const allowlist = [...new Set((environment.MANUAL_SWEEP_REPORT_ALLOWLIST ?? "").split(",")
    .map((value) => value.trim().toLowerCase()).filter(Boolean))];
  return {
    requestId,
    allowlist: from && apiKey ? allowlist : [],
    async send(message, address, userId) {
      if (!from || !apiKey || !allowlist.includes(address)) return "failed";
      try {
        const response = await fetchEmail("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": `manual-sweep-${requestId}-${userId}`,
          },
          body: JSON.stringify({
            from,
            to: [address],
            subject: `Keyword sweep report · ${message.status}`,
            text: renderRunReportEmailText(message, "manual"),
            html: renderRunReportEmailHtml(message, "manual"),
            // The diagnostic workbook also contains provider errors and agency-wide policy.
            attachments: [
              { filename: message.cipirianAnalysisFilename, content: message.cipirianAnalysisWorkbook.toString("base64"), content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const body: unknown = await response.json();
          return typeof body === "object" && body !== null && "id" in body && typeof body.id === "string" && body.id !== ""
            ? "sent" : "uncertain";
        }
        return response.status === 409 || response.status >= 500 ? "uncertain" : "failed";
      } catch {
        return "uncertain";
      }
    },
  };
}
