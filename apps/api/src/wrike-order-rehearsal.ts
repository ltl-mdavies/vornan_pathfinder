const MAX_REHEARSAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const WRIKE_ORDER_REHEARSAL_CONFIRMATION_PREFIX = "PREPARE WRIKE PREVIEW";

export type WrikeOrderRehearsalConfig = {
  enabled: boolean;
  customer_id: string | null;
  import_method_id: string | null;
  task_id: string | null;
  expires_at: string | null;
};

export class WrikeOrderRehearsalError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "WrikeOrderRehearsalError";
  }
}

function optionalIdentifier(value: string | undefined) {
  const normalized = value?.trim() || null;
  return normalized && SAFE_IDENTIFIER.test(normalized) ? normalized : null;
}

function optionalTimestamp(value: string | undefined) {
  const normalized = value?.trim() || null;
  if (!normalized) {
    return null;
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function getWrikeOrderRehearsalConfig(
  env: NodeJS.ProcessEnv = process.env
): WrikeOrderRehearsalConfig {
  const compactScope = env.PATHFINDER_WRIKE_ORDER_REHEARSAL_SCOPE?.trim();
  if (compactScope) {
    const values = compactScope.split("|");
    return {
      enabled: env.PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL === "true",
      customer_id: values.length === 4 ? optionalIdentifier(values[0]) : null,
      import_method_id: values.length === 4 ? optionalIdentifier(values[1]) : null,
      task_id: values.length === 4 ? optionalIdentifier(values[2]) : null,
      expires_at: values.length === 4 ? optionalTimestamp(values[3]) : null
    };
  }
  return {
    enabled: env.PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL === "true",
    customer_id: optionalIdentifier(env.PATHFINDER_WRIKE_ORDER_REHEARSAL_CUSTOMER_ID),
    import_method_id: optionalIdentifier(env.PATHFINDER_WRIKE_ORDER_REHEARSAL_IMPORT_METHOD_ID),
    task_id: optionalIdentifier(env.PATHFINDER_WRIKE_ORDER_REHEARSAL_TASK_ID),
    expires_at: optionalTimestamp(env.PATHFINDER_WRIKE_ORDER_REHEARSAL_EXPIRES_AT)
  };
}

export function wrikeOrderRehearsalConfirmationPhrase(taskId: string) {
  return `${WRIKE_ORDER_REHEARSAL_CONFIRMATION_PREFIX} ${taskId}`;
}

export function authorizeWrikeOrderRehearsal(args: {
  config: WrikeOrderRehearsalConfig;
  customer_id: string;
  import_method_id: string;
  task_id: unknown;
  confirmation_phrase: unknown;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  if (!args.config.enabled) {
    throw new WrikeOrderRehearsalError(
      423,
      "Wrike order rehearsal is disabled at the API boundary."
    );
  }
  if (
    !args.config.customer_id ||
    !args.config.import_method_id ||
    !args.config.task_id ||
    !args.config.expires_at
  ) {
    throw new WrikeOrderRehearsalError(
      423,
      "Wrike order rehearsal requires an exact customer, Import Method, task, and expiry."
    );
  }

  const expiresAt = Date.parse(args.config.expires_at);
  if (expiresAt <= now.getTime()) {
    throw new WrikeOrderRehearsalError(423, "The Wrike order rehearsal window has expired.");
  }
  if (expiresAt - now.getTime() > MAX_REHEARSAL_WINDOW_MS) {
    throw new WrikeOrderRehearsalError(
      423,
      "The Wrike order rehearsal window may not exceed 24 hours."
    );
  }

  if (
    args.customer_id !== args.config.customer_id ||
    args.import_method_id !== args.config.import_method_id
  ) {
    throw new WrikeOrderRehearsalError(
      403,
      "This customer and Import Method are outside the approved Wrike rehearsal scope."
    );
  }
  if (args.task_id !== args.config.task_id) {
    throw new WrikeOrderRehearsalError(
      403,
      "This Wrike task is outside the approved rehearsal scope."
    );
  }
  if (
    args.confirmation_phrase !==
    wrikeOrderRehearsalConfirmationPhrase(args.config.task_id)
  ) {
    throw new WrikeOrderRehearsalError(
      400,
      "Type the exact Wrike rehearsal confirmation phrase before preparing the order."
    );
  }

  return {
    customer_id: args.config.customer_id,
    import_method_id: args.config.import_method_id,
    task_id: args.config.task_id,
    expires_at: args.config.expires_at
  };
}
