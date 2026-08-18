import {
  ArtworkCatalogApplicationError,
  type ArtworkCatalogActor,
  type ArtworkCatalogCustomerAuthority
} from "./contracts.js";

const SAFE_OPERATOR_UID = /^[A-Za-z0-9_.:-]{1,160}$/;
const PATHFINDER_CUSTOMER_ID = /^\d{1,20}$/;

export function artworkCatalogActorFromAuthUser(authUser: unknown): ArtworkCatalogActor {
  if (!authUser || typeof authUser !== "object" || Array.isArray(authUser)) {
    throw new ArtworkCatalogApplicationError("unauthenticated", "An authenticated operator is required.");
  }
  const uid = (authUser as { uid?: unknown }).uid;
  if (typeof uid !== "string" || !SAFE_OPERATOR_UID.test(uid)) {
    throw new ArtworkCatalogApplicationError("unauthenticated", "An authenticated operator is required.");
  }
  return Object.freeze({ operator_uid: uid });
}

export function requireArtworkCatalogCustomerId(customerId: string): string {
  const normalized = customerId.trim();
  if (!PATHFINDER_CUSTOMER_ID.test(normalized)) {
    throw new ArtworkCatalogApplicationError("invalid_request", "The customer identifier is invalid.");
  }
  return normalized;
}

export async function authorizeArtworkCatalogCustomer(
  authority: ArtworkCatalogCustomerAuthority,
  actor: ArtworkCatalogActor,
  customerId: string
) {
  const normalizedCustomerId = requireArtworkCatalogCustomerId(customerId);
  let authorized = false;
  try {
    authorized = await authority.authorize({
      operator_uid: actor.operator_uid,
      customer_id: normalizedCustomerId
    });
  } catch {
    authorized = false;
  }
  if (!authorized) {
    throw new ArtworkCatalogApplicationError(
      "forbidden",
      "This operator is not authorized for the requested customer."
    );
  }
  return normalizedCustomerId;
}
