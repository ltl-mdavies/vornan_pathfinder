import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultWrikeSourceConfig } from "@pathfinder/wrike-adapter";

import { WrikeIntakeBehaviorSetup } from "../src/WrikeIntakeBehaviorSetup";

test("renders separate configurable order discovery and inactive shipping behaviors", () => {
  const config = createDefaultWrikeSourceConfig();
  const markup = renderToStaticMarkup(
    <WrikeIntakeBehaviorSetup config={config} onChange={() => undefined} />
  );

  assert.match(markup, /Order discovery and qualification/);
  assert.match(markup, /GPA Campaigns discovery/);
  assert.match(markup, /Find eligible Placard Order tasks across campaign descendants/);
  assert.match(markup, /Placard task title/);
  assert.match(markup, /Larger Than Life/);
  assert.match(markup, /approved task ID.*bounded QA verification target/i);
  assert.match(markup, /Shipping Information intake/);
  assert.match(markup, /Separate sibling-task behavior/);
  assert.match(markup, /Inactive/);
  assert.match(markup, /Shipping intake inactive/);
  assert.match(markup, /Have Address - LTL/);
  assert.match(markup, /cannot download, parse, store, expose, or send shipping workbook contents/);
  assert.match(markup, /does not use workbook sheet roles/);
  assert.match(markup, /aria-describedby="wrike-shipping-intake-safety"/);
  assert.match(markup, /type="checkbox" disabled=""/);
  assert.match(markup, /wrike-intake-behavior/);
});

test("normalization preserves configurable shipping metadata rules while keeping them inactive by default", () => {
  const config = createDefaultWrikeSourceConfig();

  assert.equal(config.shipping_intake.enabled, false);
  assert.equal(config.shipping_intake.task_title, "Shipping Information");
  assert.equal(config.shipping_intake.trigger_status_label, "Have Address - LTL");
  assert.deepEqual(config.shipping_intake.attachment_extensions, ["xlsx"]);
  assert.equal(config.order_task_title, "Placard Order");
  assert.equal(config.required_print_vendor_value, "Larger Than Life");
});
