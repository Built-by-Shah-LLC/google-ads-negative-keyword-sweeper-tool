import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadLoggingConfig } from "./config/env.js";
import { GoogleAdsClient } from "./google-ads/client.js";
import { createLogger, type Logger } from "./observability/logger.js";
import { createRecoveryClassifier } from "./volume-recovery/classifier.js";
import { PostgresRecoveryStore } from "./volume-recovery/persistence.js";
import { runVolumeRecovery } from "./volume-recovery/pipeline.js";
import { collectRecoverySources } from "./volume-recovery/sources.js";
export function parseRecoveryArguments(args: string[]): string {
  if (args.length !== 2 || args[0] !== "--request-id" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args[1]!)) throw new Error("Usage: volume-recovery --request-id UUID");
  return args[1]!.toLowerCase();
}
async function main(root: string, logger: Logger): Promise<void> {
  const runId = parseRecoveryArguments(process.argv.slice(2));
  const config = await loadConfig(root);
  if (config.googleAdsMutation.mode !== "disabled") throw new Error("Volume Recovery requires GOOGLE_ADS_MUTATION_MODE=disabled.");
  if (!config.persistence.enabled) throw new Error("Volume Recovery requires durable PostgreSQL persistence.");
  const execution = process.env.CLOUD_RUN_EXECUTION;
  if (!execution || !/^[a-z][a-z0-9-]{0,254}$/.test(execution)) throw new Error("Volume Recovery requires its Cloud Run execution identity.");
  logger.info({
    recoveryEvent: "recovery_worker_started",
    phase: "bootstrap",
    runId,
    execution,
    provider: config.llm.provider,
    model: config.llm.model,
    readOnly: true,
    googleAdsMutationMode: config.googleAdsMutation.mode
  }, "Volume Recovery worker started");
  const reader = new GoogleAdsClient(config.googleAds);
  const classifier = createRecoveryClassifier({ ...config.llm,
    requestTimeoutMs: Math.min(config.llm.requestTimeoutMs, 60000), maxRetries: Math.min(config.llm.maxRetries, 1) });
  const store = new PostgresRecoveryStore(config.persistence.databaseUrl, config.persistence.organizationId);
  try {
    const status = await runVolumeRecovery(runId, execution, {
      store,
      collect: request => collectRecoverySources(reader, {
        customerId: request.customerId,
        timeZone: request.timeZone,
        currencyCode: request.currencyCode,
        policy: request.policy,
        campaignNameContains: config.campaignNameContains
      }),
      classify: (request, candidates, categories) => classifier.classify(request.accountName, request.snapshot, candidates, categories),
      logger
    });
    process.stdout.write(JSON.stringify({
      runId,
      status,
      readOnly: true
    }) + "\n");
    if (status === "failed") process.exitCode = 1;
  } finally {
    await store.close();
    logger.info({ recoveryEvent: "recovery_store_closed", phase: "shutdown", runId, execution }, "Volume Recovery store closed");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let logger = createLogger();
  void loadLoggingConfig(root).then(loggingConfig => {
    logger = createLogger(loggingConfig);
    return main(root, logger);
  }).catch(error => {
    logger.fatal({
      recoveryEvent: "recovery_worker_failed",
      phase: "bootstrap",
      errorType: error instanceof Error ? error.name : typeof error,
      errorCode: "RECOVERY_BOOTSTRAP_FAILED"
    }, "Volume Recovery worker failed to start or complete");
    process.stderr.write("Volume Recovery failed to start. Check request/configuration and server logs.\n");
    process.exitCode = 1;
  });
}
