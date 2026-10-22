import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { Temporal } from "@js-temporal/polyfill";
import { loadConfig, loadOperationalConfig, type AppConfig } from "../config/env.js";
import { loadPolicyFromDatabase } from "../config/db-policy.js";
import { EmailAlertService } from "../notifications/email-alerts.js";
import { RunReportEmailService } from "../notifications/run-report-email.js";
import { createLogger } from "../observability/logger.js";
import { runSweeper, type SweepOptions } from "../pipeline/run-sweeper.js";
import { nextScheduledInstant, type StoredRecurrence } from "./recurrence.js";

interface DueRow {
  readonly id:string; readonly revision_id:string; readonly next_run_at:Date; readonly frequency:StoredRecurrence["frequency"];
  readonly local_time:string; readonly time_zone:string; readonly weekday:number|null; readonly anchor_date:string|null; readonly month_day:number|null;
  readonly automatic_mutation_enabled:boolean; readonly revision_snapshot:Record<string,unknown>;
  readonly accounts:readonly {id:string;googleCustomerId:string;name:string}[];
  readonly recipients:readonly {kind:"internal"|"manual";userId:string|null;email:string}[];
}
interface OccurrenceRow { readonly id:string; readonly organization_id:string; readonly status:string; readonly scheduled_for:Date; readonly reporting_date:string|Date; readonly mutation_requested:boolean; readonly snapshot:{timeZone:string;accounts:readonly {id:string;googleCustomerId:string;name:string}[];recipients:readonly {kind:"internal"|"manual";userId:string|null;email:string}[]}; }

function required(name:string):string{const value=process.env[name]?.trim();if(!value)throw new Error(`${name} is required for scheduled sweeps.`);return value;}
function organizations():readonly string[]{return (process.env.COORDINATOR_ORGANIZATION_IDS??required("ORGANIZATION_ID")).split(",").map(value=>value.trim()).filter(Boolean);}
function enabled(name:string):boolean{return /^(?:true|1|yes)$/i.test(process.env[name]??"");}
function customerAllowlist():Set<string>{return new Set((process.env.SCHEDULED_MUTATION_CUSTOMER_ALLOWLIST??"").split(",").map(value=>value.replace(/[-\s]/g,"")).filter(value=>/^\d{10}$/.test(value)));}
function recipientAllowlist():Set<string>{return new Set((process.env.SCHEDULED_REPORT_RECIPIENT_ALLOWLIST??"").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean));}
async function scoped<T>(pool:Pool,organizationId:string,operation:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);const value=await operation(client);await client.query("COMMIT");return value;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

function reportingDate(scheduledFor:Temporal.Instant,timeZone:string):string{return scheduledFor.toZonedDateTimeISO(timeZone).toPlainDate().subtract({days:2}).toString();}

export async function claimDueOccurrences(pool:Pool,organizationId:string,now:Temporal.Instant):Promise<readonly string[]>{
  return scoped(pool,organizationId,async client=>{
    const due=await client.query<DueRow>(`
      SELECT s.id::text,r.id::text revision_id,s.next_run_at,s.frequency,s.local_time::text,s.time_zone,s.weekday,s.anchor_date,s.month_day,s.automatic_mutation_enabled,r.snapshot revision_snapshot,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id::text,'googleCustomerId',a.google_customer_id,'name',COALESCE(NULLIF(btrim(a.business_display_name),''),NULLIF(btrim(a.client_name),''),a.google_account_name)) ORDER BY a.id) FROM keyword_sweep_schedule_accounts sa JOIN client_accounts a ON a.organization_id=sa.organization_id AND a.id=sa.account_id WHERE sa.organization_id=s.organization_id AND sa.schedule_id=s.id AND a.monitoring_enabled=true AND a.onboarding_status IN ('ready','active')),'[]'::jsonb) accounts,
        COALESCE((SELECT jsonb_agg(recipient ORDER BY recipient->>'kind',recipient->>'email') FROM (
          SELECT jsonb_build_object('kind','internal','userId',u.id::text,'email',e.email) recipient FROM keyword_sweep_schedule_internal_recipients sr JOIN users u ON u.organization_id=sr.organization_id AND u.id=sr.user_id AND u.status='active' JOIN user_emails e ON e.organization_id=u.organization_id AND e.user_id=u.id AND e.is_primary=true AND e.verified_at IS NOT NULL WHERE sr.organization_id=s.organization_id AND sr.schedule_id=s.id
          UNION ALL SELECT jsonb_build_object('kind','manual','userId',NULL,'email',mr.email) FROM keyword_sweep_schedule_manual_recipients mr WHERE mr.organization_id=s.organization_id AND mr.schedule_id=s.id
        ) recipients),'[]'::jsonb) recipients
      FROM keyword_sweep_schedules s JOIN keyword_sweep_schedule_revisions r ON r.organization_id=s.organization_id AND r.schedule_id=s.id AND r.revision=s.revision
      WHERE s.organization_id=$1 AND s.status='enabled' AND s.next_run_at<=$2::timestamptz ORDER BY s.next_run_at,s.id FOR UPDATE OF s SKIP LOCKED LIMIT 25
    `,[organizationId,now.toString()]);
    const occurrenceIds:string[]=[];
    for(const row of due.rows){
      if(row.accounts.length===0||row.recipients.length===0){await client.query("UPDATE keyword_sweep_schedules SET status='paused',next_run_at=NULL,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid",[organizationId,row.id]);continue;}
      const scheduled=Temporal.Instant.from(row.next_run_at.toISOString());
      const snapshot={version:1,scheduleRevision:row.revision_snapshot,timeZone:row.time_zone,accounts:row.accounts,recipients:row.recipients};
      const inserted=await client.query<{readonly id:string}>(`INSERT INTO keyword_sweep_occurrences (organization_id,schedule_id,schedule_revision_id,scheduled_for,reporting_date,snapshot,mutation_requested) VALUES ($1,$2::uuid,$3::uuid,$4::timestamptz,$5::date,$6::jsonb,$7) ON CONFLICT (schedule_id,scheduled_for) DO NOTHING RETURNING id::text`,[organizationId,row.id,row.revision_id,scheduled.toString(),reportingDate(scheduled,row.time_zone),JSON.stringify(snapshot),row.automatic_mutation_enabled]);
      const existing=inserted.rows[0]??(await client.query<{readonly id:string}>("SELECT id::text FROM keyword_sweep_occurrences WHERE organization_id=$1 AND schedule_id=$2::uuid AND scheduled_for=$3::timestamptz",[organizationId,row.id,scheduled.toString()])).rows[0];
      if(existing)occurrenceIds.push(existing.id);
      const rule:StoredRecurrence={frequency:row.frequency,localTime:row.local_time.slice(0,5),timeZone:row.time_zone,weekday:row.weekday,anchorDate:row.anchor_date,monthDay:row.month_day};
      await client.query("UPDATE keyword_sweep_schedules SET next_run_at=$3::timestamptz,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid",[organizationId,row.id,nextScheduledInstant(rule,now).toString()]);
    }
    await client.query("UPDATE keyword_sweep_occurrences SET status='queued',execution_name=NULL,claimed_at=NULL,error_code='DISPATCH_STALE',updated_at=clock_timestamp() WHERE organization_id=$1 AND status='dispatching' AND claimed_at<$2::timestamptz-interval '30 minutes'",[organizationId,now.toString()]);
    const retry=await client.query<{readonly id:string}>("SELECT id::text FROM keyword_sweep_occurrences WHERE organization_id=$1 AND status='queued' ORDER BY scheduled_for,id LIMIT 50",[organizationId]);
    return [...new Set([...occurrenceIds,...retry.rows.map(row=>row.id)])];
  });
}

async function metadataToken():Promise<string>{const response=await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",{headers:{"Metadata-Flavor":"Google"},signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error(`Metadata token request failed with ${response.status}.`);const body=await response.json() as {access_token?:unknown};if(typeof body.access_token!=="string")throw new Error("Metadata token response was invalid.");return body.access_token;}
export async function invokeOccurrence(occurrenceId:string,tokenProvider:()=>Promise<string>=metadataToken):Promise<string>{
  const project=required("GOOGLE_CLOUD_PROJECT");const region=process.env.CLOUD_RUN_REGION?.trim()||"us-west1";const job=process.env.SCHEDULED_SWEEPER_JOB_NAME?.trim()||"negative-keyword-sweeper";
  const url=`https://${region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${encodeURIComponent(project)}/jobs/${encodeURIComponent(job)}:run`;
  const response=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${await tokenProvider()}`,"content-type":"application/json"},body:JSON.stringify({overrides:{containerOverrides:[{args:["--occurrence-id",occurrenceId]}]}}),signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>null) as {metadata?:{name?:unknown};name?:unknown}|null;
  if(!response.ok)throw new Error(`Cloud Run Jobs invocation failed with ${response.status}.`);
  const name=typeof body?.metadata?.name==="string"?body.metadata.name:typeof body?.name==="string"?body.name:"accepted";
  return name;
}

export async function runScheduleCoordinator():Promise<void>{
  const pool=new Pool({connectionString:required("DATABASE_URL"),max:4});const logger=createLogger();let failures=0;
  try{for(const organizationId of organizations()){for(const occurrenceId of await claimDueOccurrences(pool,organizationId,Temporal.Now.instant())){try{const claimed=await scoped(pool,organizationId,async client=>(await client.query("UPDATE keyword_sweep_occurrences SET status='dispatching',claimed_at=COALESCE(claimed_at,clock_timestamp()),updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid AND status='queued' RETURNING id",[organizationId,occurrenceId])).rowCount===1);if(!claimed)continue;const executionName=await invokeOccurrence(occurrenceId);await scoped(pool,organizationId,client=>client.query("UPDATE keyword_sweep_occurrences SET execution_name=$3,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid AND status='dispatching'",[organizationId,occurrenceId,executionName]).then(()=>undefined));logger.info({occurrenceId},"Scheduled occurrence dispatched");}catch(error){failures+=1;await scoped(pool,organizationId,client=>client.query("UPDATE keyword_sweep_occurrences SET status='queued',error_code='DISPATCH_FAILED',updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid AND status='dispatching'",[organizationId,occurrenceId]).then(()=>undefined));logger.error({occurrenceId,errorType:error instanceof Error?error.name:"unknown"},"Scheduled occurrence dispatch failed");}}}}finally{await pool.end();}if(failures>0)process.exitCode=1;
}

interface ResolvedRecipient {
  readonly kind: "internal" | "manual";
  readonly email: string;
  readonly permitted: boolean;
}

interface PersistedDelivery {
  readonly status: "sent" | "disabled" | "not_configured" | "failed";
  readonly message_id: string | null;
  readonly attempt_count: number;
  readonly sent_at: Date | null;
  readonly error_code: string | null;
}

async function resolveRecipients(
  pool: Pool,
  organizationId: string,
  occurrence: OccurrenceRow
): Promise<readonly ResolvedRecipient[]> {
  const internalUserIds = occurrence.snapshot.recipients
    .filter((recipient) => recipient.kind === "internal" && recipient.userId !== null)
    .map((recipient) => recipient.userId!);
  const currentInternalEmails = await scoped(pool, organizationId, async (client) => {
    if (internalUserIds.length === 0) return new Map<string, string>();
    const result = await client.query<{ readonly user_id: string; readonly email: string }>(`
      SELECT u.id::text user_id, lower(e.email) email
      FROM users u
      JOIN user_emails e
        ON e.organization_id = u.organization_id
       AND e.user_id = u.id
       AND e.is_primary = true
       AND e.verified_at IS NOT NULL
      WHERE u.organization_id = $1
        AND u.status = 'active'
        AND u.id = ANY($2::uuid[])
    `, [organizationId, internalUserIds]);
    return new Map(result.rows.map((row) => [row.user_id, row.email]));
  });
  const deploymentAllowlist = recipientAllowlist();
  const deduplicated = new Map<string, ResolvedRecipient>();
  for (const recipient of occurrence.snapshot.recipients) {
    const currentEmail = recipient.kind === "internal" && recipient.userId !== null
      ? currentInternalEmails.get(recipient.userId) ?? null
      : recipient.email.toLowerCase();
    const email = currentEmail ?? recipient.email.toLowerCase();
    const permitted = currentEmail !== null && deploymentAllowlist.has(email);
    const existing = deduplicated.get(email);
    deduplicated.set(email, {
      kind: existing?.kind === "internal" ? "internal" : recipient.kind,
      email,
      permitted: permitted || existing?.permitted === true
    });
  }
  return [...deduplicated.values()];
}

function occurrenceDeliveryStatus(
  permittedRecipientCount: number,
  delivery: PersistedDelivery | undefined
): "sent" | "failed" | "skipped" {
  if (permittedRecipientCount === 0) return "skipped";
  if (delivery?.status === "sent") return "sent";
  if (delivery?.status === "failed") return "failed";
  return "skipped";
}
export function normalizeScheduledReportingDate(value:string|Date):string{
  if(value instanceof Date){if(Number.isNaN(value.getTime()))throw new Error("Scheduled occurrence has an invalid reporting date.");return value.toISOString().slice(0,10);}
  const match=/^(\d{4}-\d{2}-\d{2})/.exec(value);if(match?.[1]!==undefined)return match[1];
  throw new Error("Scheduled occurrence has an invalid reporting date.");
}
function scheduledOptions(rootDirectory:string,occurrence:OccurrenceRow,mutationAuthorized:boolean):SweepOptions{return {rootDirectory,date:normalizeScheduledReportingDate(occurrence.reporting_date),customerId:null,customerIds:occurrence.snapshot.accounts.map(item=>item.googleCustomerId),organizationLimit:null,allOrganizations:false,candidateLimitPerOrganization:null,productionMutationAuthorized:mutationAuthorized,thirtyDayMode:false,allPending:false,ignoreThirtyDayCheck:false,triggerKind:"scheduled",requestedDateSource:"AUTOMATIC_48_HOURS_BACK",accountPolicies:{},policyMode:"effective",pilot:null};}
export function isScheduledMutationAuthorized(input:{readonly mutationRequested:boolean;readonly deploymentEnabled:boolean;readonly customerIds:readonly string[];readonly allowedCustomerIds:ReadonlySet<string>}):boolean{return input.mutationRequested&&input.deploymentEnabled&&input.customerIds.length>0&&input.customerIds.every(id=>input.allowedCustomerIds.has(id.replaceAll("-","")));}
function occurrenceConfig(config:AppConfig,occurrence:OccurrenceRow):{config:AppConfig;mutationAuthorized:boolean;mutationStatus:"not_attempted"|"gated"|"running"}{
  const customers=occurrence.snapshot.accounts.map(item=>item.googleCustomerId);const gate=isScheduledMutationAuthorized({mutationRequested:occurrence.mutation_requested,deploymentEnabled:enabled("SCHEDULED_AUTOMATIC_MUTATION_ENABLED"),customerIds:customers,allowedCustomerIds:customerAllowlist()});
  if(!gate)return {config:{...config,googleAdsMutation:{mode:"disabled",chunkSize:config.googleAdsMutation.chunkSize},persistence:config.persistence.enabled?{...config.persistence,executionKey:occurrence.id}:config.persistence},mutationAuthorized:false,mutationStatus:occurrence.mutation_requested?"gated":"not_attempted"};
  return {config:{...config,persistence:config.persistence.enabled?{...config.persistence,executionKey:occurrence.id}:config.persistence},mutationAuthorized:config.googleAdsMutation.mode==="production",mutationStatus:"running"};
}

export async function runScheduledOccurrence(occurrenceId:string,rootDirectory:string):Promise<void>{
  const base=await loadConfig(rootDirectory);if(!base.persistence.enabled)throw new Error("Scheduled occurrences require PostgreSQL persistence.");const persistence=base.persistence;const organizationId=persistence.organizationId;const pool=new Pool({connectionString:persistence.databaseUrl,max:2});const logger=createLogger();let occurrence:OccurrenceRow|null=null;
  try{occurrence=await scoped(pool,organizationId,async client=>{const result=await client.query<OccurrenceRow>("UPDATE keyword_sweep_occurrences SET status='running',claimed_at=COALESCE(claimed_at,clock_timestamp()),updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid AND status IN ('queued','dispatching') RETURNING id::text,organization_id::text,status,scheduled_for,reporting_date,mutation_requested,snapshot",[organizationId,occurrenceId]);return result.rows[0]??null;});if(occurrence===null){logger.info({occurrenceId},"Occurrence was already claimed or completed");return;}
    const prepared=occurrenceConfig(base,occurrence);await scoped(pool,organizationId,client=>client.query("UPDATE keyword_sweep_occurrences SET mutation_status=$3,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid",[organizationId,occurrenceId,prepared.mutationStatus]).then(()=>undefined));
    if(!prepared.config.persistence.enabled)throw new Error("Scheduled occurrence persistence unexpectedly became disabled.");
    const resolvedRecipients=await resolveRecipients(pool,organizationId,occurrence);const permittedRecipients=resolvedRecipients.filter(recipient=>recipient.permitted).map(recipient=>recipient.email);
    const policy=await loadPolicyFromDatabase(prepared.config.persistence);const operational=await loadOperationalConfig(rootDirectory);const alerts=new EmailAlertService(operational.emailAlerts,logger);const reports=new RunReportEmailService(operational.runReportEmail,logger);
    const options=scheduledOptions(rootDirectory,occurrence,prepared.mutationAuthorized);options.accountPolicies=policy.accountPolicies;
    const result=await runSweeper(prepared.config,policy.rules,options,{logger,emailAlerts:alerts,runReportEmail:reports,runReportRecipients:permittedRecipients});await alerts.flush();alerts.close();
    const finalStatus=result.status==="SUCCEEDED"?"succeeded":result.status==="PARTIAL"?"partial":"failed";
    await scoped(pool,organizationId,async client=>{const run=await client.query<{readonly id:string;readonly google_ads_mutation_performed:boolean}>("SELECT id::text,google_ads_mutation_performed FROM negative_keyword_sweep_runs WHERE organization_id=$1 AND execution_key=$2",[organizationId,occurrenceId]);const sweep=run.rows[0];const deliveryResult=sweep===undefined?undefined:(await client.query<PersistedDelivery>("SELECT status,message_id,attempt_count,sent_at,error_code FROM negative_keyword_report_deliveries WHERE organization_id=$1 AND sweep_run_id=$2::uuid",[organizationId,sweep.id])).rows[0];const deliveryStatus=occurrenceDeliveryStatus(permittedRecipients.length,deliveryResult);await client.query("UPDATE keyword_sweep_occurrences SET status=$3,completed_at=clock_timestamp(),sweep_run_id=$4::uuid,mutation_status=$5,delivery_status=$6,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid",[organizationId,occurrenceId,finalStatus,sweep?.id??null,sweep?.google_ads_mutation_performed?"succeeded":prepared.mutationStatus==="running"?"succeeded":prepared.mutationStatus,deliveryStatus]);for(const recipient of resolvedRecipients){const recipientStatus=recipient.permitted?deliveryStatus:"skipped";await client.query("INSERT INTO keyword_sweep_delivery_attempts (organization_id,occurrence_id,recipient_key,recipient_kind,recipient_email,status,attempt_count,provider_message_id,error_code,sent_at) VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (occurrence_id,recipient_key) DO UPDATE SET status=EXCLUDED.status,attempt_count=EXCLUDED.attempt_count,provider_message_id=EXCLUDED.provider_message_id,error_code=EXCLUDED.error_code,sent_at=EXCLUDED.sent_at,updated_at=clock_timestamp()",[organizationId,occurrenceId,createHash("sha256").update(recipient.email).digest("hex"),recipient.kind,recipient.email,recipientStatus,recipient.permitted?deliveryResult?.attempt_count??0:0,recipient.permitted?deliveryResult?.message_id??null:null,recipient.permitted?deliveryResult?.error_code??null:null,recipientStatus==="sent"?deliveryResult?.sent_at??null:null]);}});
    if(result.status==="FAILED")process.exitCode=1;
  }catch(error){if(occurrence!==null)await scoped(pool,organizationId,client=>client.query("UPDATE keyword_sweep_occurrences SET status='failed',completed_at=clock_timestamp(),error_code='WORKER_FAILED',updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2::uuid AND status='running'",[organizationId,occurrenceId]).then(()=>undefined));throw error;}finally{await pool.end();}
}
