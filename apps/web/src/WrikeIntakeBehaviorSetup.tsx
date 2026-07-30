import React from "react";

import type {
  WrikeSourceConfig,
  WrikeTaskIdentityMode,
  WrikeWorkbookExtension
} from "@pathfinder/wrike-adapter";

interface WrikeIntakeBehaviorSetupProps {
  config: WrikeSourceConfig;
  onChange: (patch: Partial<WrikeSourceConfig>) => void;
}

export function WrikeIntakeBehaviorSetup({
  config,
  onChange
}: WrikeIntakeBehaviorSetupProps) {
  const shipping = config.shipping_intake;
  const updateShipping = (patch: Partial<WrikeSourceConfig["shipping_intake"]>) => {
    onChange({
      shipping_intake: {
        ...shipping,
        ...patch,
        // This repository slice deliberately has no runtime shipping transport.
        // Keep the saved behavior inactive until that capability is separately reviewed.
        enabled: false
      }
    });
  };

  return (
    <div className="wrike-intake-behaviors setup-control-wide">
      <fieldset className="wrike-intake-behavior">
        <legend>Order discovery and qualification</legend>
        <div className="wrike-contract-heading">
          <div>
            <span className="section-eyebrow">GPA Campaigns discovery</span>
            <strong>Find eligible Placard Order tasks across campaign descendants</strong>
            <small>
              Pathfinder requires the configured folder/project boundary, exact task
              identity, status ID, Contract Number field, and Print Vendor value before
              considering an order.
            </small>
          </div>
          <span className="mini-pill mini-pill-success">Metadata contract</span>
        </div>
        <div className="setup-grid">
          <label className="setup-control">
            <span>Placard task identity</span>
            <select
              value={config.order_task_identity_mode}
              onChange={(event) =>
                onChange({
                  order_task_identity_mode: event.target.value as WrikeTaskIdentityMode
                })
              }
            >
              <option value="exact_title">Exact task title</option>
              <option value="custom_item_type">Custom item type ID</option>
            </select>
          </label>
          {config.order_task_identity_mode === "custom_item_type" ? (
            <label className="setup-control">
              <span>Placard custom item type ID</span>
              <input
                value={config.order_task_custom_item_type_id}
                placeholder="Wrike API ID"
                onChange={(event) =>
                  onChange({ order_task_custom_item_type_id: event.target.value })
                }
              />
            </label>
          ) : (
            <label className="setup-control">
              <span>Placard task title</span>
              <input
                value={config.order_task_title}
                placeholder="Placard Order"
                onChange={(event) => onChange({ order_task_title: event.target.value })}
              />
            </label>
          )}
          <label className="setup-control">
            <span>Required Print Vendor value</span>
            <input
              value={config.required_print_vendor_value}
              placeholder="Larger Than Life"
              onChange={(event) =>
                onChange({ required_print_vendor_value: event.target.value })
              }
            />
            <small>Compared to the configured Print Vendor custom-field ID.</small>
          </label>
        </div>
        <div className="wrike-contract-note">
          The approved task ID below remains a bounded QA verification target. Production
          discovery is scoped by the saved GPA Campaigns folder ID and qualification rules.
        </div>
      </fieldset>

      <fieldset className="wrike-intake-behavior">
        <legend>Shipping Information intake</legend>
        <div className="wrike-contract-heading">
          <div>
            <span className="section-eyebrow">Separate sibling-task behavior</span>
            <strong>Configure shipping-ready task and XLSX metadata rules</strong>
            <small id="wrike-shipping-intake-safety">
              This foundation remains inactive. It can identify safe task and attachment
              metadata only; it cannot download, parse, store, expose, or send shipping
              workbook contents.
            </small>
          </div>
          <span className="mini-pill mini-pill-warning">Inactive</span>
        </div>

        <label className="switch-field" aria-describedby="wrike-shipping-intake-safety">
          <input type="checkbox" checked={false} disabled />
          <span className="switch-field-track" aria-hidden="true" />
          <span>
            <strong>Shipping intake inactive</strong>
            <small>Activation waits for a separately approved Lift attachment contract.</small>
          </span>
        </label>

        <div className="setup-grid">
          <label className="setup-control">
            <span>Shipping task identity</span>
            <select
              value={shipping.task_identity_mode}
              onChange={(event) =>
                updateShipping({
                  task_identity_mode: event.target.value as WrikeTaskIdentityMode
                })
              }
            >
              <option value="exact_title">Exact task title</option>
              <option value="custom_item_type">Custom item type ID</option>
            </select>
          </label>
          {shipping.task_identity_mode === "custom_item_type" ? (
            <label className="setup-control">
              <span>Shipping custom item type ID</span>
              <input
                value={shipping.custom_item_type_id}
                placeholder="Wrike API ID"
                onChange={(event) =>
                  updateShipping({ custom_item_type_id: event.target.value })
                }
              />
            </label>
          ) : (
            <label className="setup-control">
              <span>Shipping task title</span>
              <input
                value={shipping.task_title}
                placeholder="Shipping Information"
                onChange={(event) => updateShipping({ task_title: event.target.value })}
              />
            </label>
          )}
          <label className="setup-control">
            <span>Shipping-ready status ID</span>
            <input
              value={shipping.trigger_status_id}
              placeholder="Wrike API ID"
              onChange={(event) =>
                updateShipping({ trigger_status_id: event.target.value })
              }
            />
          </label>
          <label className="setup-control">
            <span>Shipping-ready status label</span>
            <input
              value={shipping.trigger_status_label}
              placeholder="Have Address - LTL"
              onChange={(event) =>
                updateShipping({ trigger_status_label: event.target.value })
              }
            />
          </label>
          <label className="setup-control">
            <span>Shipping filename contains (optional)</span>
            <input
              value={shipping.attachment_filename_contains}
              placeholder="Ship List"
              onChange={(event) =>
                updateShipping({ attachment_filename_contains: event.target.value })
              }
            />
          </label>
          <fieldset className="setup-control setup-control-wide">
            <legend>Allowed shipping workbook types</legend>
            <div className="wrike-extension-options">
              {(["xlsx", "xls", "csv"] as WrikeWorkbookExtension[]).map((extension) => (
                <label key={extension} className="switch-field">
                  <input
                    type="checkbox"
                    checked={shipping.attachment_extensions.includes(extension)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? Array.from(
                            new Set([...shipping.attachment_extensions, extension])
                          )
                        : shipping.attachment_extensions.filter(
                            (candidate) => candidate !== extension
                          );
                      updateShipping({ attachment_extensions: next });
                    }}
                  />
                  <span className="switch-field-track" aria-hidden="true" />
                  <span>.{extension}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="source-setup-callout source-setup-callout-muted">
          Shipping remains a separate Wrike behavior. It does not use workbook sheet roles,
          create an order preview, write to Wrike, or call Lift.
        </div>
      </fieldset>
    </div>
  );
}
