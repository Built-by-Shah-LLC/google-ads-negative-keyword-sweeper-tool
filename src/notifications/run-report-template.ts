import type { RunReportAccountOverview } from "../storage/cipirian-keyword-analysis.js";

export interface RunReportEmailContent {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  completedAt: string;
  organizationCount: number;
  inputTokens: number;
  outputTokens: number;
  accountOverviews: RunReportAccountOverview[];
}

const EMAIL_FONT = "Arial, Helvetica, sans-serif";

/** Renders the visual daily report sent through Resend. */
export function renderRunReportEmailHtml(content: RunReportEmailContent): string {
  const totals = summarize(content.accountOverviews);
  const accounts = content.accountOverviews.length > 0
    ? content.accountOverviews.map(renderAccountCard).join("\n")
    : emptyAccountsCard();
  const title = content.status === "SUCCEEDED" ? "Search Negatives Sweep" : "Search Negatives Sweep — Attention needed";
  const runMessage = totals.negativeExactCount === 0
    ? "No exact-negative recommendations were generated in this run."
    : `${formatCount(totals.negativeExactCount)} exact-negative ${plural(totals.negativeExactCount, "recommendation")} across ${formatCount(content.organizationCount)} ${plural(content.organizationCount, "account")}.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:${EMAIL_FONT};color:#1d3557;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;">
      <tr>
        <td align="center" style="padding:0 12px 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:760px;background:#ffffff;">
            <tr>
              <td style="background:#173653;padding:26px 30px 24px;color:#ffffff;border-radius:8px 8px 0 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="font-size:20px;line-height:24px;font-weight:700;letter-spacing:-0.2px;">Built by Shah</td>
                    <td align="right" style="font-size:11px;line-height:18px;font-weight:700;letter-spacing:0.5px;">
                      <span style="display:inline-block;padding:4px 12px;border:1px solid #8aa4bb;border-radius:16px;">FOR INTERNAL USE ONLY</span>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top:2px;font-size:11px;line-height:15px;font-weight:700;color:#b4c7d9;letter-spacing:0.7px;">GOOGLE ADS SCRIPTS</td>
                  </tr>
                </table>
                <div style="padding-top:20px;font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.4px;">${escapeHtml(title)}</div>
                <div style="padding-top:6px;font-size:14px;line-height:21px;color:#e2edf5;">Run-level summary of classified search terms and exact-negative recommendations. One report covers every selected account in the sweeper run.</div>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="padding-top:15px;font-size:13px;line-height:20px;color:#f5f9fc;">
                  <tr><td style="width:120px;color:#abc0d1;font-weight:700;">Report date</td><td>${escapeHtml(formatReportDate(content.completedAt))}</td></tr>
                  <tr><td style="color:#abc0d1;font-weight:700;">Reference</td><td>${escapeHtml(content.runId)}</td></tr>
                  <tr><td style="color:#abc0d1;font-weight:700;">Audience</td><td>Account managers</td></tr>
                </table>
                <div style="margin-top:18px;padding:14px 16px;border:1px solid #57758e;border-radius:7px;background:#294b69;">
                  <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.7px;color:#b8cad8;">ABOUT THIS EMAIL</div>
                  <div style="padding-top:6px;font-size:13px;line-height:20px;color:#f2f7fb;">This email covers ${formatCount(content.organizationCount)} ${plural(content.organizationCount, "account")} from one sweep. The original decision-audit workbook is unchanged. The attached Cipirian Keyword Analysis workbook contains one table with every classified candidate across this run.</div>
                </div>
                <div style="padding-top:17px;font-size:15px;line-height:22px;font-weight:700;">${escapeHtml(runMessage)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:27px 30px 4px;">
                <div style="font-size:20px;line-height:26px;font-weight:700;color:#19375d;">Wave snapshot</div>
                <div style="padding-top:4px;font-size:12px;line-height:18px;color:#60758b;">Counts for the accounts in this email only.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:17px 30px 10px;">
                ${renderMetricCards(content.organizationCount, totals)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 30px 12px;">
                <div style="padding:13px 15px;border:1px solid #c3d8ea;border-radius:7px;background:#f1f7fc;">
                  <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.7px;color:#1d5383;">RECONCILED DECISION FUNNEL</div>
                  <div style="padding-top:5px;font-size:13px;line-height:20px;color:#263a55;">Raw search-term rows: ${formatCount(totals.rawRowCount)} · Candidates: ${formatCount(totals.candidateCount)} · Classified: ${formatCount(totals.decisionCount)} · Exact-negative recommendations: ${formatCount(totals.negativeExactCount)} · Kept: ${formatCount(totals.keepCount)} · Unclassified: ${formatCount(totals.unclassifiedCount)} · Errors: ${formatCount(totals.errorCount)}</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 30px 18px;">
                <div style="padding:12px 15px;border:1px solid ${totals.failedCount > 0 ? "#f2b7b7" : "#a7e7bd"};border-radius:7px;background:${totals.failedCount > 0 ? "#fff2f2" : "#effcf4"};">
                  <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.7px;color:${totals.failedCount > 0 ? "#b42318" : "#08733d"};">${totals.failedCount > 0 ? "ATTENTION REQUIRED" : "RUN COVERAGE"}</div>
                  <div style="padding-top:3px;font-size:15px;line-height:21px;font-weight:700;color:${totals.failedCount > 0 ? "#8c1d18" : "#075b35"};">${escapeHtml(coverageMessage(totals, content.organizationCount))}</div>
                </div>
              </td>
            </tr>
            ${accounts}
            <tr>
              <td style="padding:21px 30px 27px;text-align:center;font-size:11px;line-height:17px;color:#6d8093;">Issued by Built by Shah Negative Keyword Sweeper · ${escapeHtml(formatReportDate(content.completedAt))} · Ref ${escapeHtml(content.runId)} · Two Excel workbooks attached</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Plain-text alternative for recipients or mail clients that cannot render HTML. */
export function renderRunReportEmailText(content: RunReportEmailContent): string {
  const totals = summarize(content.accountOverviews);
  const lines = [
    `Search Negatives Sweep — ${content.status}`,
    `Run: ${content.runId}`,
    `Completed: ${formatReportDate(content.completedAt)}`,
    `Accounts: ${content.organizationCount}`,
    `Raw search-term rows: ${totals.rawRowCount}`,
    `Candidates: ${totals.candidateCount}`,
    `Classified: ${totals.decisionCount}`,
    `Exact-negative recommendations: ${totals.negativeExactCount}`,
    `Kept: ${totals.keepCount}`,
    `Unclassified: ${totals.unclassifiedCount}`,
    `Errors: ${totals.errorCount}`,
    `LLM generation input tokens: ${content.inputTokens}`,
    `LLM generation output tokens: ${content.outputTokens}`,
    "",
    "Account summaries:"
  ];
  for (const account of content.accountOverviews) {
    lines.push(
      `- ${account.descriptiveName} (${account.customerId}): ${account.status}; ${account.candidateCount} candidates; ${account.decisionCount} classified; ${account.negativeExactCount} exact-negative recommendations; ${account.errorCount} errors.`
    );
  }
  lines.push("", "Attached: the unchanged decision-audit workbook and Cipirian Keyword Analysis, a one-sheet table of all classified keywords.");
  return lines.join("\n");
}

function renderMetricCards(accountCount: number, totals: ReturnType<typeof summarize>): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    ${metricCard(formatCount(accountCount), "Accounts", "#eaf2f9")}
    <td style="width:10px;">&nbsp;</td>
    ${metricCard(formatCount(totals.negativeExactCount), "Recommended", "#ebf8ef")}
    <td style="width:10px;">&nbsp;</td>
    ${metricCard(formatCount(totals.unclassifiedCount), "Unclassified", "#fff6db")}
    <td style="width:10px;">&nbsp;</td>
    ${metricCard(formatCount(totals.failedCount), "Failures", "#fcebed")}
  </tr>
</table>`;
}

function metricCard(value: string, label: string, background: string): string {
  return `<td width="25%" align="center" style="padding:13px 8px;background:${background};border-radius:7px;">
  <div style="font-size:22px;line-height:27px;font-weight:700;color:#173653;">${escapeHtml(value)}</div>
  <div style="padding-top:3px;font-size:11px;line-height:15px;color:#4b627b;">${escapeHtml(label)}</div>
</td>`;
}

function renderAccountCard(account: RunReportAccountOverview): string {
  const theme = accountTheme(account.status);
  const proposalLabel = account.mutation.googleAdsMutationPerformed && account.mutation.verifiedCount > 0
    ? `Applied ${formatCount(account.mutation.verifiedCount)}`
    : `Recommended ${formatCount(account.negativeExactCount)}`;
  const decisionContent = account.negativeKeywords.length > 0
    ? `<div style="padding:13px 17px 2px;font-size:12px;line-height:18px;color:#536a82;">Showing up to ${formatCount(account.negativeKeywords.length)} exact-negative ${plural(account.negativeKeywords.length, "recommendation")}. The Cipirian Keyword Analysis attachment contains every classified candidate.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;border-collapse:collapse;">
        <tr>
          ${emailTableHeader("CH", "16%")}
          ${emailTableHeader("CAMPAIGN", "31%")}
          ${emailTableHeader("EXACT NEGATIVE", "31%")}
          ${emailTableHeader("RULES", "22%")}
        </tr>
        ${account.negativeKeywords.map((keyword) => `<tr>
          ${emailTableCell(keyword.channel, true)}
          ${emailTableCell(keyword.campaignName)}
          ${emailTableCell(`[${keyword.negativeText}]`, false, true)}
          ${emailTableCell(keyword.ruleIds.join(", "))}
        </tr>`).join("")}
      </table>`
    : `<div style="padding:14px 17px 3px;font-size:13px;line-height:20px;color:#536a82;">${account.negativeExactCount > 0 ? `${formatCount(account.negativeExactCount)} exact-negative ${plural(account.negativeExactCount, "recommendation")} ${plural(account.negativeExactCount, "was", "were")} recorded, but per-keyword artifact detail was unavailable for this email.` : "No exact-negative recommendations were generated for this account."}</div>`;

  return `<tr>
  <td style="padding:0 30px 17px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid ${theme.border};border-left:5px solid ${theme.accent};border-radius:7px;overflow:hidden;background:#ffffff;">
      <tr>
        <td style="padding:16px 17px 13px;background:${theme.background};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="font-size:17px;line-height:22px;font-weight:700;color:#173653;">${escapeHtml(account.descriptiveName)}</td>
              <td align="right" style="padding-left:10px;">
                <span style="display:inline-block;padding:7px 12px;border:1px solid ${theme.accent};border-radius:20px;font-size:11px;line-height:15px;font-weight:700;color:${theme.text};">${escapeHtml(proposalLabel)}</span>
              </td>
            </tr>
          </table>
          <div style="padding-top:5px;font-size:12px;line-height:18px;color:#587087;">${escapeHtml(formatCustomerId(account.customerId))} · ${escapeHtml(account.startDate)} to ${escapeHtml(account.endDate)} · ${escapeHtml(account.status)}</div>
          <div style="padding-top:7px;font-size:12px;line-height:18px;font-weight:700;color:#425c73;">${escapeHtml(mutationMessage(account))}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 17px 0;">
          <div style="padding:11px 13px;border:1px solid #c9d9e7;border-radius:7px;background:#f3f8fc;">
            <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.7px;color:#1d5383;">DECISION COUNTS RECONCILE</div>
            <div style="padding-top:4px;font-size:12px;line-height:19px;color:#263a55;">Raw rows: ${formatCount(account.rawRowCount)} · Candidates: ${formatCount(account.candidateCount)} · Classified: ${formatCount(account.decisionCount)} · Recommended: ${formatCount(account.negativeExactCount)} · Kept: ${formatCount(account.keepCount)} · Errors: ${formatCount(account.errorCount)}</div>
          </div>
        </td>
      </tr>
      <tr><td>${decisionContent}</td></tr>
      <tr><td style="height:14px;font-size:1px;line-height:1px;">&nbsp;</td></tr>
    </table>
  </td>
</tr>`;
}

function emptyAccountsCard(): string {
  return `<tr><td style="padding:0 30px 18px;"><div style="padding:16px;border:1px solid #c9d9e7;border-radius:7px;background:#f3f8fc;font-size:13px;line-height:20px;color:#425c73;">No per-account details were available for this run.</div></td></tr>`;
}

function emailTableHeader(value: string, width: string): string {
  return `<td width="${width}" style="padding:9px 8px;border-bottom:1px solid #dce6ef;background:#f7f9fb;font-size:11px;line-height:15px;font-weight:700;letter-spacing:0.5px;color:#40536b;">${escapeHtml(value)}</td>`;
}

function emailTableCell(value: string, bold = false, mono = false): string {
  return `<td style="padding:9px 8px;border-bottom:1px solid #e7edf3;vertical-align:top;font-size:12px;line-height:18px;${bold ? "font-weight:700;" : ""}${mono ? "font-family:Consolas, 'Courier New', monospace;" : ""}color:#2c3e57;">${escapeHtml(value)}</td>`;
}

function summarize(accounts: RunReportAccountOverview[]) {
  return accounts.reduce((total, account) => ({
    rawRowCount: total.rawRowCount + account.rawRowCount,
    candidateCount: total.candidateCount + account.candidateCount,
    decisionCount: total.decisionCount + account.decisionCount,
    negativeExactCount: total.negativeExactCount + account.negativeExactCount,
    keepCount: total.keepCount + account.keepCount,
    unclassifiedCount: total.unclassifiedCount + Math.max(0, account.candidateCount - account.decisionCount),
    errorCount: total.errorCount + account.errorCount,
    failedCount: total.failedCount + (account.status === "FAILED" ? 1 : 0),
    partialCount: total.partialCount + (account.status === "PARTIAL" ? 1 : 0)
  }), {
    rawRowCount: 0,
    candidateCount: 0,
    decisionCount: 0,
    negativeExactCount: 0,
    keepCount: 0,
    unclassifiedCount: 0,
    errorCount: 0,
    failedCount: 0,
    partialCount: 0
  });
}

function coverageMessage(totals: ReturnType<typeof summarize>, accountCount: number): string {
  if (totals.failedCount > 0) {
    return `${formatCount(totals.failedCount)} ${plural(totals.failedCount, "account")} failed and ${formatCount(totals.partialCount)} ${plural(totals.partialCount, "account")} completed partially. Review the affected account sections below.`;
  }
  if (totals.partialCount > 0) {
    return `${formatCount(accountCount - totals.partialCount)} ${plural(accountCount - totals.partialCount, "account")} completed successfully; ${formatCount(totals.partialCount)} ${plural(totals.partialCount, "account")} ${plural(totals.partialCount, "needs", "need")} review.`;
  }
  return `${formatCount(accountCount)} ${plural(accountCount, "account")} completed successfully.`;
}

function accountTheme(status: RunReportAccountOverview["status"]) {
  if (status === "FAILED") return { accent: "#d92d20", border: "#f0b5b1", background: "#fff1f0", text: "#a5281d" };
  if (status === "PARTIAL") return { accent: "#d98b00", border: "#f2d391", background: "#fff9e9", text: "#935c00" };
  return { accent: "#12a660", border: "#a7e7bd", background: "#effcf4", text: "#08733d" };
}

function mutationMessage(account: RunReportAccountOverview): string {
  const mutation = account.mutation;
  if (mutation.googleAdsMutationPerformed && mutation.verifiedCount > 0) {
    return `Google Ads exact negatives applied and verified: ${formatCount(mutation.verifiedCount)}.`;
  }
  if (mutation.googleAdsMutationPerformed && mutation.appliedCount > 0) {
    return `Google Ads exact negatives applied: ${formatCount(mutation.appliedCount)}. Verification did not report a confirmed count.`;
  }
  if (mutation.mode === "validation") {
    return `Validation-only requests completed for ${formatCount(mutation.validatedCount)} ${plural(mutation.validatedCount, "negative")}; Google Ads was not changed.`;
  }
  if (mutation.mode === "development") {
    return `Development-mode mock writes recorded: ${formatCount(mutation.mockedCount)}; Google Ads was not changed.`;
  }
  return "No Google Ads mutations were requested for this run.";
}

function formatReportDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatCustomerId(customerId: string): string {
  return /^\d{10}$/u.test(customerId)
    ? `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}`
    : customerId;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return value === 1 ? singular : pluralForm;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
