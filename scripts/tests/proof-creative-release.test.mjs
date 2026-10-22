import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("creative approval activation is explicit and default-off in every deployment entrypoint", () => {
  const template = source("infra/aws/proof-cloudformation.yaml");
  assert.match(template, /CustomerAllocationEnabled:\s+Type: String\s+Default: "false"/);
  assert.match(template, /PATHFINDER_PROOF_ENABLE_CUSTOMER_ALLOCATIONS: !Ref CustomerAllocationEnabled/);
  assert.match(source("scripts/deploy-proof-stack.sh"), /CustomerAllocationEnabled="\$\{PATHFINDER_PROOF_ENABLE_CUSTOMER_ALLOCATIONS:-false\}"/);
  assert.match(source(".github/workflows/deploy-proof.yml"), /customer_allocation_enabled:[\s\S]*?default: "false"/);
  assert.match(source("apps/api/src/proof/customer-quantity-service.ts"), /review_experience !== "advanced"/);
});
test("larger creative payloads stay bounded to the new route and preserve the existing public JSON limit", () => {
  const server = source("apps/api/src/proof/public-server.ts");
  assert.match(server, /app.use\("\/api\/public\/proof\/approval-batches", express.json\(\{ limit: "16kb"/);
  assert.match(server, /app.use\(express.json\(\{ limit: "4kb"/);
});
