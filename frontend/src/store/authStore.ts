// Auth token store.
//
// Access token: kept in memory only (never persisted) so it is not exposed to
// disk/XSS-readable storage. It lives ~15 min.
// Refresh token: persisted in localStorage so the session survives a page
// reload. On startup the app exchanges it for a fresh access token. The backend
// rotates the refresh token on every use, so we always store the latest one.

let _accessToken: string | null = null;
const _listeners: Array<() => void> = [];

const REFRESH_KEY = 'sb_refresh_token';

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string): void {
  _accessToken = token;
  _listeners.forEach((fn) => fn());
}

// ── Refresh token (persisted) ───────────────────────────────────────────────

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_KEY, token);
  } catch {
    /* storage unavailable (private mode) — session simply won't persist */
  }
}

// ── Combined helpers ────────────────────────────────────────────────────────

/** Store both tokens after a successful login or refresh. */
export function setSession(accessToken: string, refreshToken: string): void {
  setRefreshToken(refreshToken);
  setAccessToken(accessToken);
}

/** Clear the entire session (memory access token + persisted refresh token). */
export function clearAccessToken(): void {
  _accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
  _listeners.forEach((fn) => fn());
}

/** Alias kept for clarity at call sites that mean "log out completely". */
export const clearSession = clearAccessToken;

export function subscribeToToken(listener: () => void): () => void {
  _listeners.push(listener);
  return () => {
    const idx = _listeners.indexOf(listener);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}
