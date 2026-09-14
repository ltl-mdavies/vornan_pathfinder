# Workspace table namespace resolver

This source slice adds a pure resolver. It does not change the deployed template
or its environment bindings. Deploy and validate compatible runtime code with the
existing explicit settings before separately preparing template packing.

The optional `PATHFINDER_TABLE_NAMESPACE` binding is `1|prefix|environment`.
It derives exactly eight fixed suffixes: Customers, CustomerWorkspaces, ImportMethods,
OutputRoutes, ProductMappings, Jobs, OrderIds, SubmitAttempts. Names are
`${prefix}-${suffix}-${environment}`. Targets and all Proof tables are excluded.

Prefix accepts ASCII letters/digits/hyphens; environment accepts lowercase letters,
digits/hyphens, matching template constraints. Every derived table name must satisfy
DynamoDB's 3–255-character bound. Unknown versions, empty/malformed fields and oversized
names fail before table access. An absent namespace retains explicit legacy settings.
All supplied legacy values are validated; any overlap must match the derived name
exactly. Missing required legacy values fail before the requested operation starts.
Focused operations may request a subset without requiring unrelated legacy settings.
The resolver does not mutate process.env, cache configuration or perform I/O.

Store table configuration, recovery snapshot queries and feedback workspace/method
reads all use this resolver. Source inventory tests reject any direct access to the
eight old binding names outside the resolver. Dynamo fixtures cover compact-only
ordinary persistence and focused reads, including conflicts before access.

Future packing must remove exactly those eight bindings and add the namespace,
while proving all physical table names, IAM, partitions and resources unchanged.
Deploy resolver-compatible code first, observe a natural scheduled cycle, then
separately deploy template-only packing with the same code and all shadow gates off.
Never revert resolver code until the eight explicit settings have been restored.
Packing rollback restores the exact prior eight values; it does not move/delete data.

New assurance activation evidence requires at least 256 bytes remaining in the
serialized full environment map. This is separate from the absolute 4096-byte limit;
read-only baseline and dark rollback evidence can describe lower existing headroom.
Recalculate from fresh real values. No old expiry or rejected candidate can be reused.
