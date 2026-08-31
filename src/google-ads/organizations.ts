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

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}
