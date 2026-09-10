import pg from 'pg';

const u = new URL(process.env.SWEEP_DB_URL);
u.hostname = '127.0.0.1'; u.port = '15432'; u.search = '';
const client = new pg.Client({ connectionString: u.toString(), ssl: false });
await client.connect();
await client.query("SELECT set_config('app.organization_id', $1, false)", [process.env.SWEEP_ORG_ID]);
await client.query("SELECT set_config('app.actor_id', '', false)");

const run = await client.query(
  `SELECT id, run_key, status, started_at FROM negative_keyword_sweep_runs ORDER BY started_at DESC LIMIT 1`
);
const r = run.rows[0];
console.log(`latest run: ${r.run_key} status=${r.status} started=${r.started_at}`);
const id = r.id;

const q = async (label, sql) => {
  const res = await client.query(sql, [id]);
  console.log(`${label}: ${JSON.stringify(res.rows)}`);
};
await q('account_runs', "SELECT status, count(*)::int FROM negative_keyword_sweep_account_runs WHERE sweep_run_id=$1 GROUP BY status ORDER BY status");
await q('facts', "SELECT count(*)::int AS facts FROM negative_keyword_search_term_facts WHERE sweep_run_id=$1");
await q('candidates', "SELECT count(*)::int AS c FROM negative_keyword_candidates WHERE sweep_run_id=$1");
await q('decisions', "SELECT decision, count(*)::int FROM negative_keyword_decisions WHERE sweep_run_id=$1 GROUP BY decision");
await q('batches', "SELECT status, count(*)::int FROM negative_keyword_llm_batches WHERE sweep_run_id=$1 GROUP BY status");
await q('errors', "SELECT count(*)::int AS e FROM negative_keyword_run_errors WHERE sweep_run_id=$1");

await client.end();
process.exit(0);
