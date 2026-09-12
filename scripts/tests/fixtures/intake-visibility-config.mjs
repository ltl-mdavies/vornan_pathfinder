import { recoveryValidation } from "./intake-recovery-config.mjs";
export const visibilityParameters = { IntakeAssuranceVisibilityEnabled: "true", IntakeAssuranceStorageEnabled: "true", IntakeAssuranceCustomerId: "synthetic" };
export const visibilityKeys = ["PATHFINDER_ENABLE_INTAKE_EXCEPTIONS", "PATHFINDER_INTAKE_EXCEPTIONS_CUSTOMER_IDS"];
export const visibilityValidation = { validateParameters: true, rules: [...recoveryValidation.rules, "IntakeVisibilityRequiresAuthenticatedStorage"] };
