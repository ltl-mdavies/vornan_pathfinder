# Wrike scoped discovery and Shipping Information metadata foundation

## Purpose

Pathfinder's Momentara intake is configured against the stable **GPA
Campaigns** Wrike folder/project ID rather than one campaign or one task. A
Placard Order becomes an eligible order candidate only when every saved
qualification rule passes:

- the task is inside the configured GPA Campaigns descendant boundary;
- the task matches the configured exact title or custom item type ID;
- the task uses the exact configured `Sent to Print - LTL` status ID;
- the configured Contract Number field contains a bounded contract identifier;
- the configured Print Vendor field exactly matches the saved
  `Larger Than Life` value.

The legacy approved-task ID remains an operator-controlled QA verification
target. It is not the production campaign discovery selector.

## Bounded metadata discovery

The adapter exposes a bounded, paginated metadata discovery contract. It
requests only the task fields needed to qualify configured candidates:

- attachment count;
- custom fields;
- custom item type ID;
- direct parent IDs;
- super-parent IDs.

The result contains bounded provider identifiers, counts, contract number, and
artwork-folder readiness state. It does not return task descriptions, artwork
URLs, attachment URLs, workbook contents, OAuth values, or raw provider
responses.

This contract is not wired to a production route or scheduler in this
foundation. It does not download attachments, persist evidence, create a
preview job, write to Wrike, or call Lift.

The metadata contract follows Wrike's read-only folder-task and task-attachment
interfaces, including descendant scope, bounded pagination, explicit optional
task fields, current attachment metadata, and `withUrls=false`:

- [Get Tasks (Folder)](https://developers.wrike.com/reference/getfolderssingletasks)
- [Get Attachments (Task)](https://developers.wrike.com/reference/gettaskssingleattachments)

## Separate Shipping Information behavior

Shipping Information is intentionally separate from workbook sheet roles and
order creation. Its Import Method configuration includes:

- inactive-by-default state;
- exact task title or custom item type identity;
- exact shipping-ready status ID and operator-facing label;
- optional attachment filename filter;
- allowed workbook extensions.

The current UI permits those rules to be prepared while the behavior remains
visibly inactive. There is no operational activation control.

When separately activated in a later reviewed slice, discovery may request
current attachment metadata with `withUrls=false`. Its safe candidate summary
contains only task/account/parent identifiers, attachment/version identifiers,
extension, timestamps, and counts. Filenames, download URLs, workbook contents,
shipping names, addresses, and creative-distribution rows stay out of the
result.

## Deferred shipping lifecycle

This foundation does **not**:

- download, parse, store, display, or log a shipping workbook;
- associate shipping rows with canonical order or line fields;
- attach a file to Lift;
- create or update a Lift order;
- write a comment, status, field, or attachment to Wrike;
- add polling, webhook, scheduler, deployment gate, IAM, or runtime capability.

Later implementation requires a separately approved Lift order-document
attachment contract, exact campaign-to-Lift-order binding, immutable source
evidence and checksum policy, PII-safe retention, one-attempt idempotency,
authoritative Lift attachment readback, and default-false deployment controls.
