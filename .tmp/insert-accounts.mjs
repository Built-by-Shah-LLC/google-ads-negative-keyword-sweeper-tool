import pg from 'pg';
import { readFile } from 'node:fs/promises';

const rows = JSON.parse(await readFile(new URL('./insert-rows.json', import.meta.url), 'utf8'));
const u = new URL(process.env.SWEEP_DB_URL);
u.hostname = '127.0.0.1'; u.port = '15432'; u.search = '';
const orgId = process.env.SWEEP_ORG_ID;

const client = new pg.Client({ connectionString: u.toString(), ssl: false });
await client.connect();
await client.query('BEGIN');
await client.query("SELECT set_config('app.organization_id', $1, true)", [orgId]);
await client.query("SELECT set_config('app.actor_id', '', true)");

let inserted = 0, skipped = 0;
for (const r of rows) {
  const res = await client.query(
    `INSERT INTO client_accounts (
       organization_id, google_customer_id, google_account_name,
       business_display_name, client_name, account_time_zone, currency_code
     ) VALUES ($1, $2, $3, $3, $3, $4, $5)
     ON CONFLICT (organization_id, google_customer_id) DO NOTHING
     RETURNING id`,
    [orgId, r.customerId, r.descriptiveName, r.timeZone, r.currencyCode]
  );
  if (res.rowCount > 0) inserted++; else skipped++;
}

const check = await client.query(
  `SELECT count(*)::int AS total FROM client_accounts WHERE organization_id = $1 AND onboarding_status <> 'archived'`,
  [orgId]
);
console.log(`inserted=${inserted} already-existed=${skipped} active-client-accounts=${check.rows[0].total}`);

await client.query('COMMIT');
await client.end();
process.exit(0);
