import assert from "node:assert/strict";
import test from "node:test";
import { invokeOccurrence, isScheduledMutationAuthorized } from "../src/scheduled/runtime.js";

test("occurrence dispatch invokes the shared Cloud Run Job with only the occurrence id", async () => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  const previousRegion = process.env.CLOUD_RUN_REGION;
  const previousJob = process.env.SCHEDULED_SWEEPER_JOB_NAME;
  const previousFetch = globalThis.fetch;
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  try {
    process.env.GOOGLE_CLOUD_PROJECT = "example-project";
    process.env.CLOUD_RUN_REGION = "us-west1";
    process.env.SCHEDULED_SWEEPER_JOB_NAME = "negative-keyword-sweeper";
    globalThis.fetch = (async (url, init) => {
      observedUrl = String(url);
      observedInit = init;
      return new Response(JSON.stringify({ metadata: { name: "operations/dispatch-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const occurrenceId = "00000000-0000-4000-8000-000000000123";
    assert.equal(await invokeOccurrence(occurrenceId, async () => "access-token"), "operations/dispatch-1");
    assert.equal(observedUrl, "https://us-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/example-project/jobs/negative-keyword-sweeper:run");
    assert.equal(observedInit?.method, "POST");
    assert.equal(new Headers(observedInit?.headers).get("authorization"), "Bearer access-token");
    assert.deepEqual(JSON.parse(String(observedInit?.body)), {
      overrides: { containerOverrides: [{ args: ["--occurrence-id", occurrenceId] }] }
    });
  } finally {
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
    if (previousRegion === undefined) delete process.env.CLOUD_RUN_REGION; else process.env.CLOUD_RUN_REGION = previousRegion;
    if (previousJob === undefined) delete process.env.SCHEDULED_SWEEPER_JOB_NAME; else process.env.SCHEDULED_SWEEPER_JOB_NAME = previousJob;
    globalThis.fetch = previousFetch;
  }
});

test("scheduled mutation requires intent, the deployment switch, and every customer", () => {
  const allowed = new Set(["3629748374"]);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: true, deploymentEnabled: true, customerIds: ["362-974-8374"], allowedCustomerIds: allowed }), true);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: false, deploymentEnabled: true, customerIds: ["3629748374"], allowedCustomerIds: allowed }), false);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: true, deploymentEnabled: false, customerIds: ["3629748374"], allowedCustomerIds: allowed }), false);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: true, deploymentEnabled: true, customerIds: ["3629748374", "1111111111"], allowedCustomerIds: allowed }), false);
  assert.equal(isScheduledMutationAuthorized({ mutationRequested: true, deploymentEnabled: true, customerIds: [], allowedCustomerIds: allowed }), false);
});
