// Prep utility: find the alphabetically-first enabled account under the MCC and
// generate the candidates.json input file for scripts/measure-pnc-30day-kimi.ts.
// Read-only against Google Ads (GAQL only). Re-run to refresh the input data.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { fetchSearchTermsForDateRange, aggregateCandidates } from "../src/google-ads/search-terms.js";
import type { Organization } from "../src/types.js";

const workspace = process.cwd();
const envFile: Record<string, string> = Object.fromEntries(
  (await readFile(resolve(workspace, ".env"), "utf8")).split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()])
);
const need = (name: string): string => process.env[name] ?? envFile[name] ?? (() => { throw new Error(`${name} missing`); })();
const client = new GoogleAdsClient({
  apiVersion: envFile.GOOGLE_ADS_API_VERSION || "v25",
  developerToken: need("GOOGLE_ADS_DEVELOPER_TOKEN"),
  loginCustomerId: need("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replaceAll("-", ""),
  clientId: need("GOOGLE_ADS_CLIENT_ID"),
  clientSecret: need("GOOGLE_ADS_CLIENT_SECRET"),
  refreshToken: need("GOOGLE_ADS_REFRESH_TOKEN")
});
const mccId = need("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replaceAll("-", "");

// 1) List direct enabled clients of the MCC.
const rows = await client.searchStream(mccId, `
  SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status
  FROM customer_client
  WHERE customer_client.status = 'ENABLED'
`);
interface ClientRow { id: string; name: string; manager: boolean }
const clients: ClientRow[] = [];
for (const row of rows) {
  const cc = (row as Record<string, any>).customerClient ?? {};
  const id = String(cc.id ?? "");
  if (!/^\d+$/u.test(id)) continue;
  clients.push({ id, name: String(cc.descriptiveName ?? ""), manager: cc.manager === true });
}
clients.sort((a, b) => a.name.toLocaleLowerCase("en-US").localeCompare(b.name.toLocaleLowerCase("en-US")));
console.log(`Enabled direct clients under MCC ${mccId}: ${clients.length}`);
for (const c of clients.slice(0, 5)) console.log(`  ${c.manager ? "[MCC] " : ""}${c.name} (${c.id})`);
const target = clients.find((c) => !c.manager) ?? clients[0];
if (!target) throw new Error("No enabled client accounts found under the MCC.");
console.log(`TARGET (first alphabetically): ${target.name} (${target.id})`);

// 2) Account metadata for the Organization record.
const custRows = await client.searchStream(target.id, `
  SELECT customer.time_zone, customer.currency_code, customer.descriptive_name FROM customer LIMIT 1
`);
const cust = ((custRows[0] as Record<string, any>)?.customer ?? {}) as Record<string, any>;
const organization: Organization = {
  customerId: target.id,
  descriptiveName: String(cust.descriptiveName ?? target.name),
  timeZone: String(cust.timeZone ?? "America/Los_Angeles"),
  currencyCode: String(cust.currencyCode ?? "USD")
};

// 3) Fetch last-30-day search terms and aggregate candidates (aligned key).
const endDate = new Date().toISOString().slice(0, 10);
const startDate = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
const dateRange = { startDate, endDate };
const rows0 = await fetchSearchTermsForDateRange(client, target.id, dateRange);
// Mirror pipeline behavior: honor CAMPAIGN_NAME_CONTAINS if configured.
const nameFilter = (process.env.CAMPAIGN_NAME_CONTAINS ?? envFile.CAMPAIGN_NAME_CONTAINS ?? "").trim().toLocaleLowerCase("en-US");
const filtered = nameFilter ? rows0.filter((row) => row.campaignName.toLocaleLowerCase("en-US").includes(nameFilter)) : rows0;
const candidates = aggregateCandidates(filtered);
console.log(`Range ${startDate}..${endDate}: ${rows0.length} rows -> ${filtered.length} after campaign filter '${nameFilter || "(none)"}' -> ${candidates.length} candidates`);

const outDir = resolve(workspace, "runs", `mutation-e2e-${target.id}`);
await mkdir(resolve(outDir, "organizations", target.id), { recursive: true });
const outPath = resolve(outDir, "organizations", target.id, "candidates.json");
await writeFile(outPath, JSON.stringify({ organization, dateRange, candidates }, null, 2));
console.log(`WROTE ${outPath}`);
