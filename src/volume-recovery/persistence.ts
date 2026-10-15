import { Pool, type PoolClient } from "pg";
import { createHash } from "node:crypto";
import { canonicalRecoveryJson, parseRecoveryItem, validateRecoveryPolicy, type RecoveryPolicy } from "./contract.js";
import type { RecoveryItem } from "./contract.js";
export interface RecoveryRequest {
  id: string;
  accountId: string;
  customerId: string;
  accountName: string;
  timeZone: string;
  currencyCode: string;
  targetCpa: string | null;
  policy: RecoveryPolicy;
  snapshot: unknown;
  policyHash: string;
}
export interface RecoveryStore {
  claim(runId: string, execution: string): Promise<RecoveryRequest | null>;
  progress(request: RecoveryRequest, execution: string, stage: string, dates?: {
    startDate: string;
    endDate: string;
  }): Promise<void>;
  items(request: RecoveryRequest, execution: string, rows: {
    key: string;
    resource: string;
    item: RecoveryItem;
  }[], startOrdinal: number): Promise<void>;
  finish(request: RecoveryRequest, execution: string, status: "succeeded" | "partial" | "failed", summary: Record<string, unknown>, usage: {
    inputTokens: number;
    outputTokens: number;
  }, error?: string): Promise<void>;
}
export class PostgresRecoveryStore implements RecoveryStore {
  readonly pool: Pool;
  constructor(databaseUrl: string, readonly organizationId: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      application_name: "volume-recovery",
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000
    });
  }
  async transaction<T>(execution: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.actor_id','',true),set_config('app.recovery_execution',$2,true)", [this.organizationId, execution]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async claim(runId: string, execution: string): Promise<RecoveryRequest | null> {
    return this.transaction(execution, async client => {
      const result = await client.query(`UPDATE volume_recovery_runs run SET status='running',stage='Validating request',execution_name=$3,started_at=clock_timestamp(),heartbeat_at=clock_timestamp()
        FROM client_accounts account WHERE run.organization_id=$1 AND run.id=$2::uuid AND run.status='pending'
          AND account.organization_id=run.organization_id AND account.id=run.account_id AND account.onboarding_status<>'archived'
        RETURNING run.*,account.google_customer_id,account.client_name`, [this.organizationId, runId, execution]);
      const row = result.rows[0];
      if (!row) {
        await client.query(`UPDATE volume_recovery_runs run SET status='failed',stage='Account archived',completed_at=clock_timestamp(),
          error_code='ACCOUNT_ARCHIVED',error_message='The account was archived before this review started.'
          FROM client_accounts account WHERE run.organization_id=$1 AND run.id=$2::uuid AND run.status='pending'
          AND account.organization_id=run.organization_id AND account.id=run.account_id AND account.onboarding_status='archived'`,[this.organizationId,runId]);
        return null;
      }
      return {
        id: row.id,
        accountId: row.account_id,
        customerId: row.google_customer_id,
        accountName: row.client_name,
        timeZone: row.account_time_zone,
        currencyCode: String(row.currency_code).trim(),
        targetCpa: row.target_cpa === null ? null : String(row.target_cpa),
        policy: validateRecoveryPolicy(row.recovery_policy),
        snapshot: row.policy_snapshot,
        policyHash: row.policy_hash
      };
    });
  }
  async progress(request: RecoveryRequest, execution: string, stage: string, dates?: {
    startDate: string;
    endDate: string;
  }): Promise<void> {
    await this.transaction(execution, async client => {
      const result = await client.query(`UPDATE volume_recovery_runs SET stage=$4,heartbeat_at=clock_timestamp(),
        start_date=COALESCE(start_date,$5::date),end_date=COALESCE(end_date,$6::date)
        WHERE organization_id=$1 AND id=$2::uuid AND execution_name=$3 AND status='running'`, [this.organizationId, request.id, execution, stage.slice(0, 120), dates?.startDate ?? null, dates?.endDate ?? null]);
      if (result.rowCount !== 1) throw new Error("Recovery claim is no longer active.");
    });
  }
  async items(request: RecoveryRequest, execution: string, rows: {
    key: string;
    resource: string;
    item: RecoveryItem;
  }[], startOrdinal: number): Promise<void> {
    const records = rows.map((row, index) => ({
      item_key: row.key,
      ordinal: startOrdinal + index,
      resource_name: row.resource,
      report_item: parseRecoveryItem(row.item)
    }));
    await this.transaction(execution, async client => {
      await client.query(`INSERT INTO volume_recovery_items(organization_id,account_id,run_id,item_key,ordinal,resource_name,report_item)
        SELECT $1,$2::uuid,$3::uuid,item_key,ordinal,resource_name,report_item
        FROM jsonb_to_recordset($4::jsonb) AS item(item_key text,ordinal integer,resource_name text,report_item jsonb)`, [this.organizationId, request.accountId, request.id, JSON.stringify(records)]);
      await client.query(`UPDATE volume_recovery_runs SET item_count=(SELECT count(*) FROM volume_recovery_items WHERE organization_id=$1 AND run_id=$2::uuid),heartbeat_at=clock_timestamp()
        WHERE organization_id=$1 AND id=$2::uuid AND execution_name=$3 AND status='running'`, [this.organizationId, request.id, execution]);
    });
  }
  async finish(request: RecoveryRequest, execution: string, status: "succeeded" | "partial" | "failed", summary: Record<string, unknown>, usage: {
    inputTokens: number;
    outputTokens: number;
  }, error?: string): Promise<void> {
    await this.transaction(execution, async client => {
      const result = await client.query(`UPDATE volume_recovery_runs SET status=$4,stage=$5,summary=$6::jsonb,input_tokens=$7,output_tokens=$8,
        completed_at=clock_timestamp(),heartbeat_at=clock_timestamp(),error_code=$9,error_message=$10,
        item_count=(SELECT count(*) FROM volume_recovery_items WHERE organization_id=$1 AND run_id=$2::uuid)
        WHERE organization_id=$1 AND id=$2::uuid AND execution_name=$3 AND status='running'`, [this.organizationId, request.id, execution, status, status === "succeeded" ? "Completed" : status === "partial" ? "Partial report" : "Failed", JSON.stringify(summary), usage.inputTokens, usage.outputTokens, error ? "RECOVERY_FAILED" : null, error ?? null]);
      if (result.rowCount !== 1) throw new Error("Recovery finalization lost its active claim.");
    });
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
export function verifyRecoverySnapshot(request: RecoveryRequest): void {
  const actual = createHash("sha256").update(canonicalRecoveryJson(request.snapshot)).digest("hex");
  if (actual !== request.policyHash) throw new Error("Recovery policy snapshot hash mismatch.");
}
