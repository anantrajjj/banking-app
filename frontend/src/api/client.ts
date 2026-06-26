import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosError } from 'axios';
import { getAccessToken } from '../store/authStore';

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

// Request interceptor — inject JWT from in-memory store
client.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — retry on 503/429 with exponential backoff
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as AxiosRequestConfig & { _retryCount?: number };
    const status = error.response?.status;

    if ((status === 503 || status === 429) && config) {
      config._retryCount = (config._retryCount ?? 0) + 1;
      if (config._retryCount <= MAX_RETRIES) {
        const delay = getRetryDelay(config._retryCount);
        await sleep(delay);
        return client(config);
      }
    }

    return Promise.reject(error);
  }
);

export default client;
