import assert from "node:assert/strict";
import test from "node:test";
import { readWrikeCurrentWorkbookVersions, createDefaultWrikeSourceConfig, type WrikeOAuthCredentials } from "../src/index.js";
const credentials: WrikeOAuthCredentials = { host: "www.wrike.com", client_id: "synthetic", client_secret: "synthetic", refresh_token: "synthetic", access_token: "synthetic", access_token_expires_at: "2026-09-10T15:00:00Z", scope: "wsReadWrite" };
const attachment = { id: "ATTACH1", versionId: "VERSION1", updatedDate: "2026-09-10T09:00:00Z", name: "order.xlsx" };
test("feedback metadata uses existing version normalization without downloads and refuses incomplete listings", async () => {
  let payload: object = { data: [attachment] }; let requests = 0;
  const options = { now: () => new Date("2026-09-10T12:00:00Z"), fetch_impl: (async (input, init) => {
    requests++; const url = new URL(String(input)); assert.equal(url.pathname, "/api/v4/tasks/TASK123/attachments");
    assert.equal(url.searchParams.get("versions"), "false"); assert.equal(url.searchParams.has("withUrls"), false); assert.equal(init!.method, "GET");
    return Response.json(payload);
  }) as typeof fetch };
  const config = createDefaultWrikeSourceConfig(); config.attachment_filename_contains = "";
  const result = await readWrikeCurrentWorkbookVersions(credentials, "TASK123", config, options);
  assert.deepEqual(result.attachments, [{ attachment_id: "ATTACH1", version_id: "VERSION1", updated_at: "2026-09-10T09:00:00.000Z" }]);
  for (const value of [{ data: [attachment], nextPageToken: "more" }, { data: [attachment, attachment] }, { data: [{ ...attachment, updatedDate: "invalid" }] }, { data: Array(1001).fill(attachment) }]) {
    payload = value; await assert.rejects(readWrikeCurrentWorkbookVersions(credentials, "TASK123", config, options));
  }
  assert.equal(requests, 5);
});
