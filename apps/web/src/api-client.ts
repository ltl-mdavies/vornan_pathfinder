export const PATHFINDER_SESSION_EXPIRED_MESSAGE =
  "Your Pathfinder session expired. Sign in again to continue, then retry your last action.";

type AuthTokenProvider = (forceRefresh?: boolean) => Promise<string | null>;
type SessionExpiredHandler = (message: string) => void | Promise<void>;

interface PathfinderApiAuthConfig {
  apiBaseUrl: string;
  token: string | null;
  getToken?: AuthTokenProvider | null;
  onSessionExpired?: SessionExpiredHandler | null;
}

let authConfig: PathfinderApiAuthConfig = {
  apiBaseUrl: "",
  token: null,
  getToken: null,
  onSessionExpired: null
};

export function configurePathfinderApiAuth(config: PathfinderApiAuthConfig) {
  authConfig = config;
}

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return input.url;
  }
  return String(input);
}

function isPathfinderApiRequest(input: RequestInfo | URL) {
  if (!authConfig.apiBaseUrl) {
    return false;
  }

  try {
    const request = new URL(requestUrl(input), globalThis.location?.origin ?? "http://127.0.0.1");
    const api = new URL(authConfig.apiBaseUrl, globalThis.location?.origin ?? "http://127.0.0.1");
    return request.origin === api.origin && request.pathname.startsWith(`${api.pathname.replace(/\/$/, "")}/`);
  } catch {
    return false;
  }
}

async function currentToken(forceRefresh = false) {
  if (authConfig.getToken) {
    const token = await authConfig.getToken(forceRefresh);
    authConfig.token = token;
    return token;
  }
  return authConfig.token;
}

function requestWithToken(input: RequestInfo | URL, init: RequestInit, token: string | null) {
  if (!token) {
    return globalThis.fetch(input, init);
  }

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set("Authorization", `Bearer ${token}`);
  return globalThis.fetch(input, { ...init, headers });
}

async function notifySessionExpired() {
  await authConfig.onSessionExpired?.(PATHFINDER_SESSION_EXPIRED_MESSAGE);
}

export const pathfinderFetch: typeof globalThis.fetch = async (input, init = {}) => {
  if (!isPathfinderApiRequest(input)) {
    return globalThis.fetch(input, init);
  }

  let token: string | null;
  try {
    token = await currentToken(false);
  } catch {
    await notifySessionExpired();
    return globalThis.fetch(input, init);
  }

  const response = await requestWithToken(input, init, token);
  if (response.status !== 401 || !authConfig.getToken) {
    return response;
  }

  try {
    const refreshedToken = await currentToken(true);
    if (!refreshedToken) {
      await notifySessionExpired();
      return response;
    }

    const retryResponse = await requestWithToken(input, init, refreshedToken);
    if (retryResponse.status === 401) {
      await notifySessionExpired();
    }
    return retryResponse;
  } catch {
    await notifySessionExpired();
    return response;
  }
};
