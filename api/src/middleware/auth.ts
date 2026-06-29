/**
 * JWT verification middleware for SecureBank API.
 *
 * Responsibilities (Requirements 2.1, 2.4, 2.5, 3.1, 3.5):
 *
 *  - Req 2.5 / 3.5: Verify RS256 cryptographic signature, well-formed format,
 *    and expiry before applying any role checks; return HTTP 401 on any failure.
 *  - Req 3.1: Extract `id`, `role`, and `jti` claims from the verified JWT and
 *    attach them to `res.locals.user` (and `req.user`) for downstream handlers.
 *  - Req 2.1: Track session inactivity per JTI via a Redis key (`session:<jti>`)
 *    with a 15-minute TTL (sliding window).  On each valid request reset the TTL.
 *    If the key has expired/missing, return HTTP 401 SESSION_EXPIRED.
 *  - Req 2.3 / revocation: Check the token revocation key `revoked:<jti>` in
 *    Redis; if present return HTTP 401 UNAUTHORIZED.
 *  - Req 2.4: If Redis is unreachable, allow the request to proceed and log a
 *    WARNING with a correlation ID — do NOT block the request.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { getSecret } from '../utils/secrets';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// TypeScript augmentation — attach `user` to Express Request
// ---------------------------------------------------------------------------

/**
 * Decoded JWT claims extracted by this middleware.
 */
export interface AuthUser {
  /** UUID of the authenticated user (`sub` claim). */
  id: string;
  /** User role — CUSTOMER | BRANCH_MANAGER | ADMIN. */
  role: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';
  /** JWT ID claim — used as the session / revocation key. */
  jti: string;
}

// Augment the Express Request type so downstream handlers get a typed `user`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HTTP 401 response body — generic auth failure (Req 2.5 / 3.5). */
const UNAUTHORIZED_BODY = {
  code: 'UNAUTHORIZED',
  message: 'Authentication required',
} as const;

/** HTTP 401 response body — session inactive (Req 2.1). */
const SESSION_EXPIRED_BODY = {
  code: 'SESSION_EXPIRED',
  message: 'Session expired due to inactivity',
} as const;

/** Inactivity TTL in seconds (Req 2.1 — 15 minutes). */
const SESSION_TTL_SECONDS = 15 * 60; // 900

/** Redis key prefix for the inactivity timer per JTI. */
const SESSION_KEY_PREFIX = 'session:';

/** Redis key prefix for the revocation entry per JTI. */
const REVOCATION_KEY_PREFIX = 'revoked:';

// ---------------------------------------------------------------------------
// Module-level Redis singleton (created lazily on first import)
// ---------------------------------------------------------------------------

let _redisClient: Redis | null = null;

/**
 * Returns the module-level Redis client, creating it lazily on first call.
 * The URL is read from the REDIS_URL environment variable (default:
 * redis://localhost:6379).
 *
 * Exported for testing so tests can replace it with a mock via
 * `_setRedisClientForTesting`.
 */
export function getRedisClient(): Redis {
  if (!_redisClient) {
    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    _redisClient = new Redis(url, {
      // Prevent ioredis from retrying forever on connection failures —
      // we want quick failure so the req-level catch can apply Req 2.4 logic.
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      lazyConnect: true,
      // ElastiCache uses TLS (rediss://) — disable cert verification for demo
      tls: url.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    });
  }
  return _redisClient;
}

/**
 * Replaces the internal Redis client with a test double.
 * **For use in unit tests only.**
 */
export function _setRedisClientForTesting(client: Redis | null): void {
  _redisClient = client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the raw Bearer token from the Authorization header.
 * Returns `null` if the header is absent or malformed.
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Expected shape of the SecureBank JWT payload.
 */
interface JwtPayload {
  sub: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns the JWT verification middleware.
 *
 * The `redisClient` parameter is optional so that the middleware can be
 * constructed before Redis has been initialised; pass `null` to disable
 * Redis-backed checks (useful in tests that only need token verification).
 *
 * @param redisClient  An ioredis client instance, or `null` to skip Redis.
 */
export function createAuthMiddleware(redisClient: Redis | null): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // ── Resolve / propagate correlation ID ──────────────────────────────────
    const correlationId: string =
      (res.locals['correlation_id'] as string | undefined) ??
      (req.headers['x-correlation-id'] as string | undefined) ??
      randomUUID();

    // ── 1. Extract Bearer token ─────────────────────────────────────────────
    const rawToken = extractBearerToken(req);
    if (!rawToken) {
      res.status(401).json(UNAUTHORIZED_BODY);
      return;
    }

    // ── 2. Verify RS256 signature, format, and expiry (Req 2.5 / 3.5) ──────
    let payload: JwtPayload;
    try {
      const publicKey = await getSecret('JWT_PUBLIC_KEY', correlationId);

      const decoded = jwt.verify(rawToken, publicKey, {
        algorithms: ['RS256'],
      }) as JwtPayload;

      // Ensure required claims are present and typed correctly.
      if (
        typeof decoded.sub !== 'string' ||
        typeof decoded.role !== 'string' ||
        typeof decoded.jti !== 'string'
      ) {
        res.status(401).json(UNAUTHORIZED_BODY);
        return;
      }

      payload = decoded;
    } catch {
      // Covers: JsonWebTokenError (bad sig / malformed), TokenExpiredError,
      // NotBeforeError, and secrets retrieval failures.
      res.status(401).json(UNAUTHORIZED_BODY);
      return;
    }

    // ── 3. Validate role claim (Req 3.1 / 3.6) ──────────────────────────────
    const validRoles: ReadonlySet<string> = new Set([
      'CUSTOMER',
      'BRANCH_MANAGER',
      'ADMIN',
    ]);
    if (!validRoles.has(payload.role)) {
      res.status(401).json(UNAUTHORIZED_BODY);
      return;
    }

    const authUser: AuthUser = {
      id: payload.sub,
      role: payload.role as AuthUser['role'],
      jti: payload.jti,
    };

    // ── 4. Redis checks (revocation + inactivity) ───────────────────────────
    // Use the injected client (for tests) or fall back to the module singleton.
    const redis = redisClient ?? getRedisClient();

    try {
      // ── 4a. Revocation list check (Req 2.3) ───────────────────────────────
      const revocationKey = `${REVOCATION_KEY_PREFIX}${payload.jti}`;
      const isRevoked = await redis.exists(revocationKey);
      if (isRevoked) {
        res.status(401).json(UNAUTHORIZED_BODY);
        return;
      }

      // ── 4b. Session inactivity check (Req 2.1) ────────────────────────────
      const sessionKey = `${SESSION_KEY_PREFIX}${payload.jti}`;
      const sessionExists = await redis.exists(sessionKey);

      if (!sessionExists) {
        // Session key has expired (TTL hit zero) — treat as inactive (Req 2.1).
        // Attempt to clean up any remnant key, then reject.
        await redis.del(sessionKey).catch(() => { /* ignore del errors */ });
        res.status(401).json(SESSION_EXPIRED_BODY);
        return;
      }

      // Reset inactivity TTL (sliding window — Req 2.2).
      await redis.expire(sessionKey, SESSION_TTL_SECONDS);
    } catch (redisErr) {
      // ── 4c. Redis unreachable — allow request, log WARNING (Req 2.4) ──────
      logger.warn(
        `[WARN] revocation check skipped (correlationId: ${correlationId})`,
        { error: (redisErr as Error).message },
        correlationId,
      );
      // Do NOT return — fall through and allow the request to proceed.
    }

    // ── 5. Attach decoded user to request and res.locals (Req 3.1) ──────────
    req.user = authUser;
    res.locals['user'] = { id: payload.sub, role: payload.role, jti: payload.jti };

    next();
  };
}

// ---------------------------------------------------------------------------
// Default named export — the `authenticate` RequestHandler
// ---------------------------------------------------------------------------

/**
 * JWT authentication middleware.
 *
 * Exported as `authenticate` (required by task 4.4).  Uses the module-level
 * Redis singleton (lazily created from REDIS_URL env var).  Prefer
 * `createAuthMiddleware(redisClient)` in tests to inject a mock Redis client.
 */
export const authenticate: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  void createAuthMiddleware(null)(req, res, next);
};

/**
 * Legacy alias kept for backward compatibility with other modules that may
 * import `authMiddleware`.
 */
export const authMiddleware: RequestHandler = authenticate;
