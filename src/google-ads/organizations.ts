import type { Organization } from "../types.js";
import type { GoogleAdsClient } from "./client.js";

export async function fetchOrganizations(
  client: GoogleAdsClient,
  managerCustomerId: string
): Promise<Organization[]> {
  const rows = await client.searchStream(managerCustomerId, `
    SELECT
      customer_client.id,
      customer_client.descriptive_name,
      customer_client.manager,
      customer_client.status,
      customer_client.time_zone,
      customer_client.currency_code
    FROM customer_client
    ORDER BY customer_client.descriptive_name
  `);

  const organizations = new Map<string, Organization>();
  for (const row of rows) {
    const customer = row.customerClient as Record<string, unknown> | undefined;
    if (!customer || customer.manager === true || customer.status !== "ENABLED") continue;
    const customerId = stringValue(customer.id);
    if (!customerId) continue;
    organizations.set(customerId, {
      customerId,
      descriptiveName: stringValue(customer.descriptiveName) || "(unnamed account)",
      timeZone: stringValue(customer.timeZone) || "UTC",
      currencyCode: stringValue(customer.currencyCode) || ""
    });
  }
  return [...organizations.values()];
}

/**
 * Keeps only organizations that match at least one allowlist entry. An entry of
 * digits (dashes/spaces ignored) matches the customer ID exactly; any other entry
 * matches case-insensitively against the account name. An empty allowlist keeps everything.
 */
export function filterOrganizationsByAllowlist(
  organizations: Organization[],
  allowlist: string[]
): Organization[] {
  const entries = allowlist.map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return organizations;
  return organizations.filter((organization) =>
    entries.some((entry) => allowlistEntryMatches(organization, entry))
  );
}

function allowlistEntryMatches(organization: Organization, entry: string): boolean {
  const digits = entry.replace(/[\s-]/gu, "");
  if (/^\d+$/u.test(digits)) return organization.customerId === digits;
  return organization.descriptiveName
    .toLocaleLowerCase("en-US")
    .includes(entry.toLocaleLowerCase("en-US"));
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}
