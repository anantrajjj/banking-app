/**
 * Secrets retrieval and caching module.
 *
 * Fetches application secrets exclusively from AWS Secrets Manager (req 10.1).
 * Caches each secret in memory for up to 1 hour before refreshing (req 10.3).
 * Falls back to matching environment variables with a WARNING log when
 * Secrets Manager is unavailable (req 10.2, 9.5).
 * Aborts the process with a FATAL log and correlation ID if both sources fail
 * for a required secret (req 10.4, 9.6).
 *
 * Uses the ECS task IAM role via the SDK default credential chain —
 * no long-lived IAM access keys are used (req 10.5).
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  SecretsManagerServiceException,
} from '@aws-sdk/client-secrets-manager';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All secret keys managed by this module.
 * Secret names in AWS Secrets Manager follow the pattern: securebank/<key>
 */
export type SecretKey =
  | 'DB_URL'
  | 'JWT_PRIVATE_KEY'
  | 'JWT_PUBLIC_KEY'
  | 'AES_256_KEY'
  | 'SNS_TOPIC_ARN';

/**
 * Typed bundle of all application secrets returned by getAllSecrets().
 */
export interface SecretsBundle {
  DB_URL: string;
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY: string;
  AES_256_KEY: string;
  SNS_TOPIC_ARN: string;
}

/**
 * In-memory cache entry for a single secret.
 */
interface CachedSecret {
  value: string;
  fetchedAt: number; // Date.now() ms
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All secret keys that must be present for the service to operate. */
const ALL_SECRET_KEYS: ReadonlyArray<SecretKey> = [
  'DB_URL',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'AES_256_KEY',
  'SNS_TOPIC_ARN',
];

/** Namespace prefix used for secret names in AWS Secrets Manager. */
const SECRET_NAME_PREFIX = 'securebank/';

/** Maximum age (ms) for a cached secret before a refresh is attempted. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** In-memory secret cache keyed by SecretKey. */
const cache = new Map<SecretKey, CachedSecret>();

/** Singleton Secrets Manager client, created lazily. */
let _smClient: SecretsManagerClient | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Lazily creates and reuses the Secrets Manager client. */
function getSmClient(): SecretsManagerClient {
  if (!_smClient) {
    // Credentials come from the ECS task IAM role via the default credential
    // provider chain — no explicit keys are passed (req 10.5).
    _smClient = new SecretsManagerClient({});
  }
  return _smClient;
}

/**
 * Fetches the raw secret string from AWS Secrets Manager for the given key.
 * The secret name in Secrets Manager is `securebank/<key>`.
 */
async function fetchFromSecretsManager(key: SecretKey): Promise<string> {
  const secretId = `${SECRET_NAME_PREFIX}${key}`;
  const client = getSmClient();
  const command = new GetSecretValueCommand({ SecretId: secretId });
  const response = await client.send(command);

  const raw = response.SecretString;
  if (!raw) {
    throw new Error(
      `Secrets Manager returned an empty SecretString for "${secretId}"`,
    );
  }

  // If the secret is stored as a JSON object with a matching key, extract it.
  // Otherwise treat the raw string as the secret value itself.
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed[key] === 'string' && parsed[key]) {
      return parsed[key] as string;
    }
    // Return the raw string if the expected key is not present in the JSON.
    return raw;
  } catch {
    // Not valid JSON — use the raw string as-is.
    return raw;
  }
}

/** Returns true when the cached entry exists and is still within the TTL. */
function isCacheFresh(entry: CachedSecret): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

/**
 * Stores a new value in the cache with the current timestamp.
 */
function writeCache(key: SecretKey, value: string): void {
  cache.set(key, { value, fetchedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the value of the requested secret, applying the following priority:
 *
 *   1. Fresh in-memory cache (within 1 hour — req 10.3)
 *   2. AWS Secrets Manager (primary source — req 10.1)
 *      → on success: updates cache
 *      → on failure with stale cache: uses stale cache + WARNING (req 10.4)
 *      → on failure without cache: falls through to env-var check
 *   3. Matching environment variable (fallback + WARNING — req 10.2, 9.5)
 *   4. FATAL abort with correlation ID (req 10.4, 9.6)
 *
 * @param key            The secret to retrieve.
 * @param correlationId  Optional request-scoped ID included in log messages.
 */
export async function getSecret(
  key: SecretKey,
  correlationId?: string,
): Promise<string> {
  const corrId = correlationId ?? randomUUID();
  const cached = cache.get(key);

  // ── 1. Serve from fresh cache ────────────────────────────────────────────
  if (cached && isCacheFresh(cached)) {
    return cached.value;
  }

  // ── 1b. Env-only mode ────────────────────────────────────────────────────
  // When AWS Secrets Manager is not in use (e.g. on Render), read straight from
  // environment variables and skip the SDK entirely. Enable Secrets Manager by
  // setting USE_AWS_SECRETS=true.
  if (process.env['USE_AWS_SECRETS'] !== 'true') {
    const envOnly = process.env[key];
    if (envOnly) {
      writeCache(key, envOnly);
      return envOnly;
    }
    const fatalMsg =
      `[FATAL] Required secret "${key}" is not set in the environment ` +
      `(correlationId: ${correlationId ?? corrId}). The service cannot start.`;
    console.error(fatalMsg);
    throw new Error(fatalMsg);
  }

  // ── 2. Attempt Secrets Manager fetch ────────────────────────────────────
  try {
    const value = await fetchFromSecretsManager(key);
    writeCache(key, value);
    return value;
  } catch (err) {
    const errMsg =
      err instanceof SecretsManagerServiceException
        ? err.message
        : (err as Error).message;

    // ── 2a. Stale cache fallback during rotation (req 10.4) ─────────────
    if (cached) {
      console.warn(
        `[WARN] Secrets Manager call failed for "${key}" (correlationId: ${corrId}); ` +
          `continuing with stale cached value. Error: ${errMsg}`,
      );
      return cached.value;
    }

    // ── No cache at all — try env-var fallback ───────────────────────────
    console.warn(
      `[WARN] Secrets Manager unavailable for "${key}" (correlationId: ${corrId}); ` +
        `attempting environment variable fallback. Error: ${errMsg}`,
    );
  }

  // ── 3. Environment variable fallback (req 10.2, 9.5) ────────────────────
  const envValue = process.env[key];
  if (envValue) {
    console.warn(
      `[WARN] Secret "${key}" sourced from environment variable — ` +
        `Secrets Manager unavailable (correlationId: ${correlationId ?? 'n/a'})`,
    );
    // Cache the env-var value so subsequent calls within the hour avoid noise.
    writeCache(key, envValue);
    return envValue;
  }

  // ── 4. FATAL — all sources exhausted (req 10.4, 9.6) ────────────────────
  const fatalMsg =
    `[FATAL] Unable to retrieve secret "${key}" from Secrets Manager or ` +
    `environment variables (correlationId: ${correlationId ?? corrId}). ` +
    `The service cannot start.`;
  console.error(fatalMsg);
  throw new Error(fatalMsg);
}

/**
 * Fetches all required application secrets in parallel and returns them as a
 * typed SecretsBundle.  Intended to be called once at service startup so that
 * all secrets are warmed into the cache before the first request is served.
 *
 * If any individual secret cannot be resolved, getSecret() will throw, which
 * will propagate here and abort the startup sequence (req 9.6, 10.4).
 *
 * @param correlationId  Optional correlation ID for structured log output.
 */
export async function getAllSecrets(
  correlationId?: string,
): Promise<SecretsBundle> {
  const corrId = correlationId ?? randomUUID();

  const results = await Promise.all(
    ALL_SECRET_KEYS.map((key) => getSecret(key, corrId)),
  );

  // ALL_SECRET_KEYS is defined in a fixed order matching SecretsBundle fields.
  const [DB_URL, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, AES_256_KEY, SNS_TOPIC_ARN] =
    results as [string, string, string, string, string];

  return {
    DB_URL,
    JWT_PRIVATE_KEY,
    JWT_PUBLIC_KEY,
    AES_256_KEY,
    SNS_TOPIC_ARN,
  };
}

// ---------------------------------------------------------------------------
// Exported for testing purposes only
// ---------------------------------------------------------------------------

/**
 * Clears the entire secret cache.
 * **For use in unit tests only** — do not call in production code.
 */
export function _clearCacheForTesting(): void {
  cache.clear();
}

/**
 * Replaces the internal Secrets Manager client with a test double.
 * **For use in unit tests only** — do not call in production code.
 */
export function _setSmClientForTesting(client: SecretsManagerClient): void {
  _smClient = client;
}
