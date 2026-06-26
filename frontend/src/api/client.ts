import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosError } from 'axios';
import {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  clearSession,
} from '../store/authStore';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/v1';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 200, 400, 800
  const jitter = Math.random() * 100 - 50; // ±50ms
  return Math.max(0, base + jitter);
}

const client: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

/**
 * Exchange the stored refresh token for a fresh access token (and a rotated
 * refresh token). Uses a bare axios call so it never goes through this client's
 * interceptors (avoids infinite 401 loops). De-duplicates concurrent calls.
 */
let _refreshInFlight: Promise<string> | null = null;

export function refreshAccessToken(): Promise<string> {
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token');
    const res = await axios.post<{ access_token: string; refresh_token: string }>(
      `${BASE_URL}/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 },
    );
    setAccessToken(res.data.access_token);
    setRefreshToken(res.data.refresh_token);
    return res.data.access_token;
  })();

  _refreshInFlight.finally(() => {
    _refreshInFlight = null;
  });

  return _refreshInFlight;
}

// Request interceptor — inject JWT from in-memory store
client.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — auto-refresh on 401, retry on 503/429
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as
      | (AxiosRequestConfig & { _retryCount?: number; _retriedAuth?: boolean })
      | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';

    // ── 401: try a one-time token refresh, then replay the request ───────────
    if (
      status === 401 &&
      config &&
      !config._retriedAuth &&
      !url.includes('/auth/') &&
      getRefreshToken()
    ) {
      config._retriedAuth = true;
      try {
        const newToken = await refreshAccessToken();
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
        return client(config);
      } catch {
        // Refresh failed — session is truly over.
        clearSession();
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.assign('/login');
        }
        return Promise.reject(error);
      }
    }

    // ── 503 / 429: exponential backoff retry ────────────────────────────────
    if ((status === 503 || status === 429) && config) {
      config._retryCount = (config._retryCount ?? 0) + 1;
      if (config._retryCount <= MAX_RETRIES) {
        const delay = getRetryDelay(config._retryCount);
        await sleep(delay);
        return client(config);
      }
    }

    return Promise.reject(error);
  },
);

export default client;
