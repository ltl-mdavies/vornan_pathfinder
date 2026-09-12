import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isIntakeVisibilityAvailable } from "../src/intake-visibility.js";

test("visibility requires literal true, an authenticated session and the exact safe customer", () => {
  for (const flag of [undefined,"","false","TRUE","1"," true "]) assert.equal(isIntakeVisibilityAvailable(flag,"synthetic","synthetic",true),false);
  for (const customer of [undefined,""," ","one,two","synthetic\n"]) assert.equal(isIntakeVisibilityAvailable("true",customer,"synthetic",true),false);
  assert.equal(isIntakeVisibilityAvailable("true","synthetic","other",true),false);
  assert.equal(isIntakeVisibilityAvailable("true","synthetic","synthetic",false),false);
  assert.equal(isIntakeVisibilityAvailable("true","synthetic","synthetic",true),true);
});

test("the shared availability check protects navigation and mounting of fetch-owning read-only components", () => {
  const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
  assert.match(app,/isIntakeVisibilityAvailable\(import\.meta\.env\.VITE_ENABLE_INTAKE_EXCEPTIONS, import\.meta\.env\.VITE_INTAKE_EXCEPTIONS_CUSTOMER_ID, selectedCustomerId, Boolean\(authSession\)\)/);
  assert.match(app,/item\.label !== "Intake Exceptions" \|\| intakeVisibilityAvailable/);
  assert.match(app,/activeCustomerView === "Intake Exceptions" && intakeVisibilityAvailable \? \(/);
  for(const path of ["../src/IntakeExceptions.tsx","../src/IntakeDeliveries.tsx"]) {
    const component=readFileSync(new URL(path,import.meta.url),"utf8");
    assert.doesNotMatch(component,/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    assert.doesNotMatch(component,/intake-delivery-review|(?:reconcile|dispatch|submitOrder)\s*\(/);
  }
});
