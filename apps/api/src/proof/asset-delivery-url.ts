const LOCATOR_ID = /^plocator_[a-f0-9]{64}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._() -]{0,239}$/;

function assertIdentity(locatorId: string, filename: string) {
  if (!LOCATOR_ID.test(locatorId) || !SAFE_FILENAME.test(filename)) {
    throw new Error("Proof delivery identity is invalid.");
  }
}

/**
 * The opaque locator remains the authorization-safe identity. The filename is
 * a presentation-only terminal path segment so Lift and prepress can retain a
 * meaningful filename without a redirect or an undocumented Lift API field.
 */
export function proofAssetDeliveryObjectKey(locatorId: string, filename: string) {
  assertIdentity(locatorId, filename);
  return `a/${locatorId}/${filename}`;
}

export function proofAssetDeliveryPath(locatorId: string, filename: string) {
  assertIdentity(locatorId, filename);
  return `/a/${locatorId}/${encodeURIComponent(filename)}`;
}

export function proofAssetDeliveryUrl(
  deliveryBaseUrl: string,
  locatorId: string,
  filename: string
) {
  const base = new URL(deliveryBaseUrl);
  if (base.protocol !== "https:" || base.hostname !== "go.vornan.co" || base.pathname !== "/") {
    throw new Error("Proof delivery base URL is invalid.");
  }
  return `${base.origin}${proofAssetDeliveryPath(locatorId, filename)}`;
}
