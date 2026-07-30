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
        <legend>Order task rules</legend>
        <div className="wrike-contract-heading">
          <div>
            <span className="section-eyebrow">GPA Campaigns</span>
            <strong>Find Placard Order tasks across every campaign</strong>
            <small>
              A task must match the saved title, ready status, Contract Number, and
              Print Vendor before Pathfinder considers its workbooks.
            </small>
          </div>
          <span className="mini-pill mini-pill-success">Order rules</span>
        </div>
        <div className="setup-grid">
          <label className="setup-control">
            <span>How to recognize the order task</span>
            <select
              value={config.order_task_identity_mode}
              onChange={(event) =>
                onChange({
                  order_task_identity_mode: event.target.value as WrikeTaskIdentityMode
                })
              }
            >
              <option value="exact_title">By task title (recommended)</option>
              <option value="custom_item_type">By custom item type (advanced)</option>
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
              <span>Order task title</span>
              <input
                value={config.order_task_title}
                placeholder="Placard Order"
                onChange={(event) => onChange({ order_task_title: event.target.value })}
              />
            </label>
          )}
          <label className="setup-control">
            <span>Required Print Vendor</span>
            <input
              value={config.required_print_vendor_value}
              placeholder="Larger Than Life"
              onChange={(event) =>
                onChange({ required_print_vendor_value: event.target.value })
              }
            />
            <small>Only tasks assigned to this vendor can become orders.</small>
          </label>
        </div>
        <div className="wrike-contract-note">
          The QA task ID in Advanced Wrike identifiers is used only by the safe verification
          tools. Saved discovery uses the GPA Campaigns folder and the rules above.
        </div>
      </fieldset>

      <details className="wrike-intake-behavior wrike-inactive-details">
        <summary className="wrike-inactive-details-summary">
          <span>
            <span className="section-eyebrow">Planned future step</span>
            <strong>Shipping Information intake</strong>
            <small>
              Not active yet. Open to review the planned task and workbook rules.
            </small>
          </span>
          <span className="mini-pill mini-pill-warning">Inactive</span>
        </summary>

        <div className="wrike-inactive-details-body">
          <div className="wrike-contract-heading">
            <div>
              <strong>Configure the shipping-ready task</strong>
              <small id="wrike-shipping-intake-safety">
                This foundation can identify safe task and attachment metadata only. It
                cannot download, parse, store, expose, or send shipping workbook contents.
              </small>
            </div>
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
              <span>How to recognize the shipping task</span>
              <select
                value={shipping.task_identity_mode}
                onChange={(event) =>
                  updateShipping({
                    task_identity_mode: event.target.value as WrikeTaskIdentityMode
                  })
                }
              >
                <option value="exact_title">By task title (recommended)</option>
                <option value="custom_item_type">By custom item type (advanced)</option>
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
              <span>Shipping-ready status name</span>
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
            <fieldset className="setup-control setup-control-wide wrike-extension-fieldset">
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
            Shipping remains separate from order intake. It does not create an order preview,
            write to Wrike, or call Lift.
          </div>
        </div>
      </details>
    </div>
  );
}
