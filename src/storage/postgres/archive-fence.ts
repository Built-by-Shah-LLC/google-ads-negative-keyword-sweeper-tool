import type { PoolClient } from "pg";
import { PipelineError } from "../../observability/errors.js";

export interface ArchiveAccount {
  readonly id: string;
  readonly customerId: string;
  readonly revision: string;
}

export function archivedBeforeStart(): PipelineError {
  return new PipelineError("Account archive state changed before work started.", {
    stage: "ACCOUNT_ADMISSION",
    code: "ACCOUNT_ARCHIVED",
    retryable: false
  });
}

/** This role has read access to client_accounts. Use the same advisory key as the Admin archive command. */
export async function lockArchiveAccounts(client: PoolClient, organizationId: string, accountIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(accountIds)].sort()) {
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [`account-archive:${organizationId}:${id}`]);
  }
}
