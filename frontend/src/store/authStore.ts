// Simple in-memory token store using a module-level variable.
// Token is NEVER written to localStorage (Req: JWT stored in memory only).

let _accessToken: string | null = null;
const _listeners: Array<() => void> = [];

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string): void {
  _accessToken = token;
  _listeners.forEach((fn) => fn());
}

export function clearAccessToken(): void {
  _accessToken = null;
  _listeners.forEach((fn) => fn());
}

export function subscribeToToken(listener: () => void): () => void {
  _listeners.push(listener);
  return () => {
    const idx = _listeners.indexOf(listener);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}
