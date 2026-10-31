/** Status navigation carries no authority. The existing Proof session is required. */
const ORDER = /^A\d{7}$/;
export function statusHandoffUrl(input: {
  enabled: boolean; customerId: string; orderNumber: string; pending: number;
  reviewRequired: boolean; healthy: boolean; cancelled: boolean; visibility: string;
}) {
  return input.enabled && input.customerId === "1249" && ORDER.test(input.orderNumber)
    && Number.isInteger(input.pending) && input.pending > 0 && input.reviewRequired
    && input.healthy && !input.cancelled && input.visibility === "review_link"
    ? `https://proof.vornan.co/#/status/${input.orderNumber}` : null;
}

/** Called only after the existing session/grant/capability/revocation validation. */
export function statusHandoffMatches(enabled: boolean, expected: unknown,
  sessionOrder: string, actualOrder: string, actualCustomer: string) {
  return enabled && typeof expected === "string" && ORDER.test(expected)
    && expected === sessionOrder && expected === actualOrder && actualCustomer === "1249";
}
