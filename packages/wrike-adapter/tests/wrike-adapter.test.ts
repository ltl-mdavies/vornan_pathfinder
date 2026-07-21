import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWrikeIngestionIdentity,
  createDefaultWrikeSourceConfig,
  getWrikeContractReadiness,
  normalizeWrikeSourceConfig,
  selectWrikeWorkbookAttachment
} from "../src/index.ts";

test("normalizes a fail-closed Wrike intake contract without retaining secrets", () => {
  const normalized = normalizeWrikeSourceConfig({
    enabled: true,
    folder_id: "  IEABFOLDER  ",
    trigger_mode: "webhook_with_reconciliation",
    trigger_status_id: " IEABORDERED ",
    trigger_status_label: " Ordered ",
    attachment_filename_contains: " Momentara Order ",
    attachment_extensions: [".XLSX", "pdf", "csv", "xlsx"],
    poll_interval_minutes: 2,
    access_token: "must-not-persist",
    create_preview_only: false
  });

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.folder_id, "IEABFOLDER");
  assert.equal(normalized.trigger_status_id, "IEABORDERED");
  assert.deepEqual(normalized.attachment_extensions, ["xlsx", "csv"]);
  assert.equal(normalized.poll_interval_minutes, 5);
  assert.equal(normalized.create_preview_only, true);
  assert.equal("access_token" in normalized, false);
  assert.equal(getWrikeContractReadiness(normalized).status, "Configured");
});

test("snaps reconciliation intervals to the operator-visible presets", () => {
  assert.equal(normalizeWrikeSourceConfig({ poll_interval_minutes: 17 }).poll_interval_minutes, 15);
  assert.equal(normalizeWrikeSourceConfig({ poll_interval_minutes: 58 }).poll_interval_minutes, 60);
});

test("reports the durable identifiers still needed before connection", () => {
  assert.deepEqual(getWrikeContractReadiness(createDefaultWrikeSourceConfig()), {
    status: "Incomplete",
    missing: ["folder_id", "trigger_status_id"]
  });
});

test("uses account, task, attachment, and version for deterministic ingestion identity", () => {
  const first = buildWrikeIngestionIdentity({
    account_id: "IEACCOUNT",
    task_id: "IETASK",
    attachment_id: "IEATTACHMENT",
    version_id: "2"
  });
  const same = buildWrikeIngestionIdentity({
    account_id: "IEACCOUNT",
    task_id: "IETASK",
    attachment_id: "IEATTACHMENT",
    version_id: "2"
  });
  const replacement = buildWrikeIngestionIdentity({
    account_id: "IEACCOUNT",
    task_id: "IETASK",
    attachment_id: "IEATTACHMENT",
    version_id: "3"
  });

  assert.equal(first, same);
  assert.notEqual(first, replacement);
});

test("selects the newest matching workbook and fails closed on a timestamp tie", () => {
  const config = normalizeWrikeSourceConfig({
    folder_id: "IEABFOLDER",
    trigger_status_id: "IEABORDERED",
    attachment_filename_contains: "order",
    attachment_extensions: ["xlsx"]
  });
  const candidates = [
    {
      attachment_id: "old",
      version_id: "1",
      file_name: "Momentara order.xlsx",
      updated_at: "2026-07-21T12:00:00.000Z"
    },
    {
      attachment_id: "ignored",
      version_id: "1",
      file_name: "Momentara order.pdf",
      updated_at: "2026-07-21T14:00:00.000Z"
    },
    {
      attachment_id: "new",
      version_id: "2",
      file_name: "Momentara order.xlsx",
      updated_at: "2026-07-21T13:00:00.000Z"
    }
  ];

  assert.equal(selectWrikeWorkbookAttachment(candidates, config).attachment?.attachment_id, "new");
  assert.equal(
    selectWrikeWorkbookAttachment(
      [
        ...candidates,
        {
          attachment_id: "tied",
          version_id: "1",
          file_name: "Replacement order.xlsx",
          updated_at: "2026-07-21T13:00:00.000Z"
        }
      ],
      config
    ).status,
    "ambiguous"
  );
});
