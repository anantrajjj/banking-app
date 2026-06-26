/**
 * Database connection pool module.
 *
 * Retrieves the DB connection string exclusively from AWS Secrets Manager.
 * Falls back to the DATABASE_URL environment variable with a WARNING log when
 * Secrets Manager is unavailable or not configured (requirement 10.2).
 * Aborts the process with a FATAL log when neither source is available (req 10.4).
 * Caches the secret in memory for up to 1 hour before re-fetching (req 10.3).
 * Uses the ECS task IAM role via the SDK default credential chain — no explicit
 * long-lived keys (requirement 10.5).
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  SecretsManagerServiceException,
} from '@aws-sdk/client-secrets-manager';
import { Pool, QueryResult } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SecretCache {
  value: string;
  fetchedAt: number; // Date.now() ms
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _pool: Pool | null = null;
let _secretCache: SecretCache | null = null;
let _initPromise: Promise<Pool> | null = null;

// ---------------------------------------------------------------------------
// Secrets Manager client (lazy — only created when needed)
// ---------------------------------------------------------------------------

function createSmClient(): SecretsManagerClient {
  // No explicit credentials — relies on the ECS task IAM role via the
  // default credential provider chain (requirement 10.5).
  return new SecretsManagerClient({});
}

// ---------------------------------------------------------------------------
// Secret retrieval with in-memory caching (requirement 10.3)
// ---------------------------------------------------------------------------

/**
 * Returns a cached secret string if still within the TTL window, otherwise
 * fetches a fresh value from the provided fetch function and updates the cache.
 */
async function getCachedOrFetch(
  fetchFn: () => Promise<string>,
): Promise<string> {
  const now = Date.now();
  if (_secretCache && now - _secretCache.fetchedAt < CACHE_TTL_MS) {
    return _secretCache.value;
  }

  const value = await fetchFn();
  _secretCache = { value, fetchedAt: now };
  return value;
}

// ---------------------------------------------------------------------------
// Connection string resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the DB connection string following this priority:
 *   1. AWS Secrets Manager (primary, requirement 10.1)
 *   2. DATABASE_URL env var (fallback + WARNING, requirement 10.2)
 *   3. FATAL abort (requirement 10.4)
 */
export async function resolveConnectionString(): Promise<string> {
  const secretArn =
    process.env['DB_SECRET_ARN'] ?? process.env['DB_SECRET_NAME'];

  if (secretArn) {
    try {
      const connStr = await getCachedOrFetch(async () => {
        const client = createSmClient();
        const command = new GetSecretValueCommand({ SecretId: secretArn });
        const response = await client.send(command);

        const raw = response.SecretString;
        if (!raw) {
          throw new Error(
            `Secrets Manager returned empty SecretString for "${secretArn}"`,
          );
        }

        // The secret may be stored as a JSON object with a "connectionString"
        // (or similar) key, or as the raw connection string itself.
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const candidates = [
            'connectionString',
            'connection_string',
            'DATABASE_URL',
            'url',
          ];
          for (const key of candidates) {
            if (typeof parsed[key] === 'string' && parsed[key]) {
              return parsed[key] as string;
            }
          }
          // If no known key found, return the raw string
          return raw;
        } catch {
          // Not JSON — treat as a plain connection string
          return raw;
        }
      });

      return connStr;
    } catch (err) {
      // Secrets Manager call failed — check for a cached value first
      if (_secretCache) {
        console.warn(
          '[WARNING] Secrets Manager unavailable; using cached DB credential.',
          { secretArn, error: (err as Error).message },
        );
        return _secretCache.value;
      }

      // No cache — fall through to env-var fallback
      const smError = err instanceof SecretsManagerServiceException
        ? err.message
        : (err as Error).message;

      console.warn(
        '[WARNING] Secrets Manager unavailable and no cached credential; ' +
          'falling back to DATABASE_URL env var.',
        { secretArn, error: smError },
      );
    }
  }

  // ── Env-var fallback (requirement 10.2) ──────────────────────────────────
  const databaseUrl = process.env['DATABASE_URL'];

  if (!secretArn) {
    // DB_SECRET_ARN / DB_SECRET_NAME not configured at all
    console.warn(
      '[WARNING] DB_SECRET_ARN / DB_SECRET_NAME is not set; ' +
        'falling back to DATABASE_URL environment variable.',
    );
  }

  if (databaseUrl) {
    return databaseUrl;
  }

  // ── FATAL — neither source available (requirement 10.4) ──────────────────
  console.error(
    '[FATAL] No DB connection string available: Secrets Manager is ' +
      'not configured or unavailable, and DATABASE_URL is not set. ' +
      'The service cannot start.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Pool initialisation
// ---------------------------------------------------------------------------

async function initPool(): Promise<Pool> {
  if (_pool) return _pool;

  const connectionString = await resolveConnectionString();

  // Enable TLS when DATABASE_SSL=true or the URL requests it (e.g. external
  // managed Postgres such as Render's external connection string). Render's
  // certificate chain is not in the default CA bundle, so disable strict
  // verification when SSL is on.
  const sslRequested =
    process.env['DATABASE_SSL'] === 'true' ||
    /[?&]sslmode=require/.test(connectionString);
  const ssl = sslRequested ? { rejectUnauthorized: false } : undefined;

  _pool = new Pool({
    connectionString,
    ssl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Surface connection errors so they don't go unnoticed
  _pool.on('error', (err: Error) => {
    console.error('[ERROR] Unexpected pg pool client error:', err.message);
  });

  return _pool;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Ensures the pool is initialised (does so once) and returns it.
 * All callers that need a connection should go through this function.
 */
export async function getPool(): Promise<Pool> {
  if (_pool) return _pool;
  if (!_initPromise) {
    _initPromise = initPool();
  }
  return _initPromise;
}

/**
 * The pg Pool instance. Will be `null` until `getPool()` has been awaited at
 * least once. Prefer `getPool()` over this export to avoid null-checks.
 */
export { _pool as pool };

/**
 * Convenience query wrapper that enforces parameterised queries.
 *
 * Safety guard: if `text` contains `$` placeholders but no `params` array is
 * provided, the call is rejected to prevent accidental unparameterised queries
 * (requirement 12.4).
 */
export async function query<T extends object = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const hasPlaceholders = /\$\d+/.test(text);
  if (hasPlaceholders && params === undefined) {
    throw new Error(
      'query() called with $N placeholders but no params array was supplied. ' +
        'Always pass a params array to enforce parameterised queries.',
    );
  }

  const p = await getPool();
  return p.query<T>(text, params);
}

/**
 * Drains and closes the pg connection pool gracefully.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function closePool(): Promise<void> {
  if (!_pool) return;
  const poolToClose = _pool;
  _pool = null;
  _initPromise = null;
  await poolToClose.end();
}

// ---------------------------------------------------------------------------
// Graceful shutdown signal handlers
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.info(`[INFO] Received ${signal}; closing DB pool and exiting.`);
  await closePool();
  process.exit(0);
}

// Guard against duplicate listener registration (e.g. during test reloads)
const _shutdownRegistered = Symbol.for('__securebank_db_shutdown_registered__');
type ProcessWithFlag = NodeJS.Process & { [key: symbol]: boolean };

if (!(process as ProcessWithFlag)[_shutdownRegistered]) {
  (process as ProcessWithFlag)[_shutdownRegistered] = true;
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
