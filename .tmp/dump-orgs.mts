import { readFile, writeFile } from "node:fs/promises";
import { GoogleAdsClient } from "../src/google-ads/client.js";
import { fetchOrganizations } from "../src/google-ads/organizations.js";

const text = await readFile(new URL("../.env", import.meta.url), "utf8");
const env = {};
for (const line of text.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const client = new GoogleAdsClient({
  apiVersion: env.GOOGLE_ADS_API_VERSION || "v25",
  developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
  loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replaceAll("-", ""),
  clientId: env.GOOGLE_ADS_CLIENT_ID,
  clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
  refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN
});

const orgs = await fetchOrganizations(client, env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replaceAll("-", ""));
await writeFile(new URL("./mcc-orgs.json", import.meta.url), JSON.stringify(orgs, null, 1));
console.log(`dumped ${orgs.length} leaf organizations`);
