import assert from "node:assert/strict";
import test from "node:test";
import {
  GetObjectTaggingCommand,
  PutObjectTaggingCommand
} from "@aws-sdk/client-s3";
import type { ProofAssetUploadRecord } from "@pathfinder/proof-domain/proof-asset-upload";
import {
  createProofAssetScanWorkerHandler,
  createProofAssetSourceLifecycleWriter,
  type ProofAssetScanWorkerConfig
} from "../src/proof/asset-scan-worker.js";

process.env.PATHFINDER_PROOF_TELEMETRY_MODE = "off";

const config: ProofAssetScanWorkerConfig = {
  enabled: true,
  account_id: "744016783602",
  region: "us-east-1",
  bucket_name: "vornan-pathfinder-proof-assets-dev-744016783602"
};

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    account: config.account_id,
    region: config.region,
    observation: {
      schema_version: "1.0",
      event_id: "72c7d362-737a-6dce-fc78-9e27a0171419",
      occurred_at: "2026-08-02T12:00:00.000Z",
      bucket_name: config.bucket_name,
      object_key:
        "orders/A0226753/tasks/task-1/revisions/revision-1/source/" +
        `passet_${"a".repeat(64)}/revision.pdf`,
      object_version_id: "version-1",
      scan_result: "NO_THREATS_FOUND",
      ...overrides
    }
  });
}

test("keeps the asset worker dark before parsing or durable scan work", async () => {
  let calls = 0;
  const handler = createProofAssetScanWorkerHandler(
    { observeScan: async () => { calls += 1; } },
    () => ({ ...config, enabled: false })
  );
  const result = await handler({
    Records: [{ messageId: "message-1", body: body() }]
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "message-1" }]
  });
});

test("accepts only the exact sanitized account, region, bucket, and observation", async () => {
  const observations: unknown[] = [];
  const handler = createProofAssetScanWorkerHandler(
    { observeScan: async (observation) => { observations.push(observation); } },
    () => config
  );
  assert.deepEqual(
    await handler({ Records: [{ messageId: "message-1", body: body() }] }),
    { batchItemFailures: [] }
  );
  assert.equal(observations.length, 1);

  for (const unsafe of [
    JSON.stringify({ account: "111122223333", region: config.region, observation: JSON.parse(body()).observation }),
    JSON.stringify({ account: config.account_id, region: "us-west-2", observation: JSON.parse(body()).observation }),
    body({ bucket_name: "vornan-pathfinder-proof-assets-qa-744016783602" }),
    JSON.stringify({
      account: config.account_id,
      region: config.region,
      observation: { ...JSON.parse(body()).observation, threats: ["must-not-enter-queue"] }
    })
  ]) {
    const result = await handler({
      Records: [{ messageId: "message-unsafe", body: unsafe }]
    });
    assert.deepEqual(result, {
      batchItemFailures: [{ itemIdentifier: "message-unsafe" }]
    });
  }
  assert.equal(observations.length, 1);
});

test("reports only the failed SQS item so successful scan events are not replayed", async () => {
  const seen: string[] = [];
  const handler = createProofAssetScanWorkerHandler(
    {
      observeScan: async (observation) => {
        seen.push(observation.event_id);
        if (observation.scan_result === "FAILED") throw new Error("synthetic failure");
      }
    },
    () => config
  );
  const result = await handler({
    Records: [
      { messageId: "message-clear", body: body() },
      { messageId: "message-failed", body: body({ scan_result: "FAILED" }) }
    ]
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(result, {
    batchItemFailures: [{ itemIdentifier: "message-failed" }]
  });
});

test("preserves GuardDuty tags and verifies an exact lifecycle update on one object version", async () => {
  const commands: unknown[] = [];
  let reads = 0;
  const client = {
    async send(command: GetObjectTaggingCommand | PutObjectTaggingCommand) {
      commands.push(command);
      if (command instanceof GetObjectTaggingCommand) {
        reads += 1;
        return reads === 1
          ? { TagSet: [
              { Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" },
              { Key: "owner", Value: "proof" }
            ] }
          : { TagSet: [
              { Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" },
              { Key: "owner", Value: "proof" },
              { Key: "proof-lifecycle", Value: "retained-source" }
            ] };
      }
      return {};
    }
  };
  const writer = createProofAssetSourceLifecycleWriter(client);
  await writer({
    record: {
      bucket_name: config.bucket_name,
      source_key:
        "orders/A0226753/tasks/task-1/revisions/revision-1/source/" +
        `passet_${"a".repeat(64)}/revision.pdf`
    } as ProofAssetUploadRecord,
    object_version_id: "version-1",
    lifecycle: "retained-source"
  });
  assert.equal(commands.length, 3);
  const put = commands[1] as PutObjectTaggingCommand;
  assert.equal(put.input.Bucket, config.bucket_name);
  assert.equal(put.input.VersionId, "version-1");
  assert.deepEqual(put.input.Tagging?.TagSet, [
    { Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" },
    { Key: "owner", Value: "proof" },
    { Key: "proof-lifecycle", Value: "retained-source" }
  ]);
});

test("fails closed when the object tag does not match the scan lifecycle", async () => {
  let writes = 0;
  const writer = createProofAssetSourceLifecycleWriter({
    async send(command: GetObjectTaggingCommand | PutObjectTaggingCommand) {
      if (command instanceof PutObjectTaggingCommand) writes += 1;
      return { TagSet: [{ Key: "GuardDutyMalwareScanStatus", Value: "THREATS_FOUND" }] };
    }
  });
  await assert.rejects(
    writer({
      record: {
        bucket_name: config.bucket_name,
        source_key:
          "orders/A0226753/tasks/task-1/revisions/revision-1/source/" +
          `passet_${"a".repeat(64)}/revision.pdf`
      } as ProofAssetUploadRecord,
      object_version_id: "version-1",
      lifecycle: "retained-source"
    }),
    /GuardDutyTagMismatch/
  );
  assert.equal(writes, 0);
});
