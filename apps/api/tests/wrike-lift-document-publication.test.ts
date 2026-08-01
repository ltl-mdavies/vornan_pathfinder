import assert from "node:assert/strict";
import test from "node:test";
import type { WrikeLiftSourceEvidenceBinding } from "@pathfinder/wrike-adapter";
import {
  getWrikeLiftDocumentPublicationConfig,
  publishWrikeLiftSourceDocument,
  WrikeLiftDocumentPublicationError
} from "../src/wrike-lift-document-publication.ts";

const bytes = new TextEncoder().encode("synthetic workbook bytes");
const sha256 = "67f3d9c81203e696a60c82da2812272d3850da4acd0ce319fcfb4bc1be55a402";

const evidence: WrikeLiftSourceEvidenceBinding = {
  evidence_id: "wrike_workbook_synthetic_evidence",
  document_role: "order_grid",
  task_id: "IEQUALIFIEDTASK",
  attachment_id: "IEGRID",
  version_id: "IEGRIDV1",
  file_name: "C316870: AZ Lottery #1.xlsx",
  content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  byte_size: bytes.byteLength,
  sha256
};

function missingObject() {
  return {
    name: "NoSuchKey",
    $metadata: { httpStatusCode: 404 }
  };
}

function directResponse(url: string, length: number) {
  const response = new Response(new Uint8Array(length), {
    status: 200,
    headers: { "content-length": String(length) }
  });
  Object.defineProperty(response, "url", { value: url });
  Object.defineProperty(response, "redirected", { value: false });
  return response;
}

test("fails before storage or network when the publication gate is dark", async () => {
  const calls: string[] = [];
  await assert.rejects(
    publishWrikeLiftSourceDocument({
      evidence,
      bytes,
      config: { enabled: false, bucket_name: null, manifest_bucket_name: null, delivery_base_url: null },
      s3_sender: { send: async (command) => { calls.push(command?.constructor?.name ?? "unknown"); } },
      fetch_impl: async () => { throw new Error("must not fetch"); }
    }),
    (error: unknown) => error instanceof WrikeLiftDocumentPublicationError && error.code === "disabled"
  );
  assert.deepEqual(calls, []);
});

test("conditionally publishes one immutable object, verifies direct delivery, and finalizes a manifest", async () => {
  const calls: Array<{ name: string; input: Record<string, any> }> = [];
  let objectInput: Record<string, any> | null = null;
  let manifestInput: Record<string, any> | null = null;
  const sender = {
    send: async (command: any) => {
      calls.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "GetObjectCommand") {
        throw missingObject();
      }
      if (command.constructor.name === "PutObjectCommand" && command.input.Key.startsWith("d/")) {
        objectInput = command.input;
        return { VersionId: "delivery-version-1" };
      }
      if (command.constructor.name === "HeadObjectCommand") {
        return {
          VersionId: "delivery-version-1",
          ContentLength: evidence.byte_size,
          LastModified: new Date("2026-07-31T16:00:00.000Z"),
          Metadata: objectInput?.Metadata
        };
      }
      if (
        command.constructor.name === "PutObjectCommand" &&
        command.input.Key.startsWith("wrike/publications/")
      ) {
        manifestInput = command.input;
        return { VersionId: "manifest-version-1" };
      }
      throw new Error(`Unexpected ${command.constructor.name}`);
    }
  };
  const result = await publishWrikeLiftSourceDocument({
    evidence,
    bytes,
    config: {
      enabled: true,
      bucket_name: "wrike-delivery-test",
      manifest_bucket_name: "wrike-evidence-test",
      delivery_base_url: "https://go.vornan.co"
    },
    s3_sender: sender,
    fetch_impl: async (url) => directResponse(String(url), evidence.byte_size),
    now: () => new Date("2026-07-31T16:00:01.000Z")
  });

  assert.match(result.direct_url, /\/d\/wd_[a-f0-9]{64}\/C316870_AZ_Lottery_1\.xlsx$/);
  assert.equal(result.object_version_id, "delivery-version-1");
  assert.equal(result.published_at, "2026-07-31T16:00:00.000Z");
  assert.equal(result.expires_at, "2026-08-14T16:00:00.000Z");
  assert.equal(objectInput?.IfNoneMatch, "*");
  assert.equal(objectInput?.Bucket, "wrike-delivery-test");
  assert.equal(objectInput?.ContentDisposition, 'attachment; filename="C316870_AZ_Lottery_1.xlsx"');
  assert.equal(manifestInput?.IfNoneMatch, "*");
  assert.equal(manifestInput?.Bucket, "wrike-evidence-test");
  assert.match(manifestInput?.Key ?? "", /^wrike\/publications\/wrike_publication_[a-f0-9]{64}\.json$/);
  assert.equal(calls.filter((call) => call.name === "PutObjectCommand").length, 2);
  assert.equal(JSON.stringify(manifestInput).includes("IEQUALIFIEDTASK"), false);
});

test("replays an immutable manifest without rewriting the document or extending retention", async () => {
  let manifest: any = null;
  // Build the exact deterministic metadata with the primary success path.
  const recorded: Record<string, any> = {};
  const bootstrapSender = {
    send: async (command: any) => {
      if (command.constructor.name === "GetObjectCommand") throw missingObject();
      if (command.constructor.name === "PutObjectCommand" && command.input.Key.startsWith("d/")) {
        recorded.metadata = command.input.Metadata;
        return {};
      }
      if (command.constructor.name === "HeadObjectCommand") {
        return {
          VersionId: "delivery-version-1",
          ContentLength: evidence.byte_size,
          LastModified: new Date("2026-07-31T16:00:00.000Z"),
          Metadata: recorded.metadata
        };
      }
      if (command.constructor.name === "PutObjectCommand") {
        manifest = JSON.parse(command.input.Body);
        return {};
      }
      throw new Error("unexpected");
    }
  };
  const config = {
    enabled: true,
    bucket_name: "wrike-delivery-test",
    manifest_bucket_name: "wrike-evidence-test",
    delivery_base_url: "https://go.vornan.co"
  };
  await publishWrikeLiftSourceDocument({
    evidence,
    bytes,
    config,
    s3_sender: bootstrapSender,
    fetch_impl: async (url) => directResponse(String(url), evidence.byte_size),
    now: () => new Date("2026-07-31T16:00:01.000Z")
  });
  assert.ok(manifest);

  const replayCalls: string[] = [];
  const replay = await publishWrikeLiftSourceDocument({
    evidence,
    bytes,
    config,
    s3_sender: {
      send: async (command: any) => {
        replayCalls.push(command.constructor.name);
        if (command.constructor.name === "GetObjectCommand") {
          return { Body: { transformToString: async () => JSON.stringify(manifest) } };
        }
        if (command.constructor.name === "HeadObjectCommand") {
          return {
            VersionId: "delivery-version-1",
            ContentLength: evidence.byte_size,
            LastModified: new Date("2026-07-31T16:00:00.000Z"),
            Metadata: recorded.metadata
          };
        }
        throw new Error("replay must not write");
      }
    },
    fetch_impl: async (url) => directResponse(String(url), evidence.byte_size),
    now: () => new Date("2026-08-01T16:00:00.000Z")
  });
  assert.equal(replay.expires_at, "2026-08-14T16:00:00.000Z");
  assert.deepEqual(replayCalls, ["GetObjectCommand", "HeadObjectCommand"]);
});

test("validates the exact dark configuration and rejects unsafe delivery origins", () => {
  assert.deepEqual(getWrikeLiftDocumentPublicationConfig({}), {
    enabled: false,
    bucket_name: null,
    manifest_bucket_name: null,
    delivery_base_url: null
  });
  assert.throws(
    () => getWrikeLiftDocumentPublicationConfig({
      PATHFINDER_ENABLE_WRIKE_LIFT_DOCUMENT_PUBLICATION: "true",
      PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET: "bucket",
      PATHFINDER_SOURCE_EVIDENCE_BUCKET: "evidence",
      PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BASE_URL: "https://example.com"
    }),
    WrikeLiftDocumentPublicationError
  );
});

test("reports a sanitized manifest-read stage when S3 does not return a missing-object observation", async () => {
  await assert.rejects(
    publishWrikeLiftSourceDocument({
      evidence,
      bytes,
      config: {
        enabled: true,
        bucket_name: "wrike-delivery-test",
        manifest_bucket_name: "wrike-evidence-test",
        delivery_base_url: "https://go.vornan.co"
      },
      s3_sender: { send: async () => { throw new Error("provider-private-detail"); } },
      fetch_impl: async () => { throw new Error("must not fetch"); }
    }),
    (error: unknown) =>
      error instanceof WrikeLiftDocumentPublicationError &&
      error.code === "manifest_read_failed" &&
      !error.message.includes("provider-private-detail")
  );
});

test("reports a sanitized object-write stage after structurally detecting a missing manifest", async () => {
  let calls = 0;
  await assert.rejects(
    publishWrikeLiftSourceDocument({
      evidence,
      bytes,
      config: {
        enabled: true,
        bucket_name: "wrike-delivery-test",
        manifest_bucket_name: "wrike-evidence-test",
        delivery_base_url: "https://go.vornan.co"
      },
      s3_sender: {
        send: async () => {
          calls += 1;
          if (calls === 1) throw missingObject();
          throw new Error("provider-private-detail");
        }
      },
      fetch_impl: async () => { throw new Error("must not fetch"); }
    }),
    (error: unknown) =>
      error instanceof WrikeLiftDocumentPublicationError &&
      error.code === "object_write_failed" &&
      !error.message.includes("provider-private-detail")
  );
  assert.equal(calls, 2);
});
