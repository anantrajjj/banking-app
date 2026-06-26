/**
 * Structured JSON logger for SecureBank API.
 *
 * Design constraints (Requirement 13.1):
 *   - Every log entry is emitted as a single-line JSON object to stdout.
 *   - Every API request log includes: correlation_id, method, path, status,
 *     latency_ms, and timestamp.
 *   - PII / secret field names (pan, aadhaar, password, token, secret, key)
 *     are NEVER included in any log output — they are stripped from `meta`.
 *   - A UUID v4 correlation_id is generated per request when the caller does
 *     not supply an x-correlation-id header; an existing header value is
 *     propagated unchanged.
 *   - Uses Node.js built-ins only (crypto, process) — no external libs.
 */

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// PII / secret field filter
// ---------------------------------------------------------------------------

/**
 * Field names that MUST never appear in a log entry.
 * Both exact-match and case-insensitive substring checks are applied.
 */
const REDACTED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'pan',
  'aadhaar',
  'password',
  'token',
  'secret',
  'key',
]);

/**
 * Returns true if the given field name matches a PII/secret pattern.
 * Matching is case-insensitive and checks both exact equality and whether the
 * banned word is a substring of the key name (e.g. "apiKey", "jwtToken").
 */
function isRedactedField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  for (const banned of REDACTED_FIELD_NAMES) {
    if (lower === banned || lower.includes(banned)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively strips PII/secret keys from an object, returning a sanitised
 * shallow copy.  Arrays are walked element-by-element.  Primitives are
 * returned as-is.
 */
export function sanitiseMeta(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitiseMeta);
  }

  const obj = value as Record<string, unknown>;
  const sanitised: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(obj)) {
    if (isRedactedField(k)) {
      // Omit this field entirely — do not include even a "[REDACTED]" marker
      // to avoid leaking the presence of the value.
      continue;
    }
    sanitised[k] = sanitiseMeta(v);
  }

  return sanitised;
}

// ---------------------------------------------------------------------------
// Log-level types
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'warn' | 'error' | 'fatal';

/**
 * The shape of every structured log entry written to stdout.
 */
export interface LogEntry {
  timestamp: string;       // ISO 8601 UTC
  level: LogLevel;
  correlation_id?: string;
  message: string;
  [key: string]: unknown;  // additional sanitised meta fields
}

// ---------------------------------------------------------------------------
// Core emit function
// ---------------------------------------------------------------------------

/**
 * Serialises a LogEntry to a single-line JSON string and writes it to
 * process.stdout.  All output goes through this single function so that
 * tests can intercept stdout consistently.
 */
function emit(entry: LogEntry): void {
  process.stdout.write(JSON.stringify(entry) + '\n');
}

// ---------------------------------------------------------------------------
// Logger object
// ---------------------------------------------------------------------------

/**
 * Builds a structured log entry and emits it.
 *
 * @param level          Log severity.
 * @param message        Human-readable message (not sanitised — callers must
 *                       not embed PII in the message string directly).
 * @param meta           Optional key-value metadata.  All PII/secret keys are
 *                       automatically stripped before serialisation.
 * @param correlationId  Optional request-scoped correlation ID.
 */
function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
  correlationId?: string,
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(correlationId !== undefined ? { correlation_id: correlationId } : {}),
    ...(meta !== undefined ? (sanitiseMeta(meta) as Record<string, unknown>) : {}),
  };
  emit(entry);
}

/**
 * Structured JSON logger — exported for use throughout the application.
 *
 * Usage:
 *   logger.info('Server started', { port: 3000 });
 *   logger.warn('Redis unavailable', { correlationId });
 *   logger.error('Unhandled error', { err: error.message });
 *   logger.fatal('Startup failed', { reason: 'secrets missing' });
 */
export const logger = {
  info(message: string, meta?: Record<string, unknown>, correlationId?: string): void {
    log('info', message, meta, correlationId);
  },
  warn(message: string, meta?: Record<string, unknown>, correlationId?: string): void {
    log('warn', message, meta, correlationId);
  },
  error(message: string, meta?: Record<string, unknown>, correlationId?: string): void {
    log('error', message, meta, correlationId);
  },
  fatal(message: string, meta?: Record<string, unknown>, correlationId?: string): void {
    log('fatal', message, meta, correlationId);
  },
};

// ---------------------------------------------------------------------------
// Express request-logger middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that:
 *   1. Reads the x-correlation-id request header, or generates a UUID v4.
 *   2. Attaches the correlation_id to res.locals so downstream handlers can
 *      reference it (e.g. for including it in error responses).
 *   3. Sets the x-correlation-id response header so clients can trace logs.
 *   4. On the 'finish' event, emits a structured JSON log entry containing:
 *      correlation_id, method, path, status, latency_ms, timestamp.
 *
 * Requirement 13.1 — no PII or secrets are ever logged.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // 1. Resolve or generate correlation ID
  const headerValue = req.headers['x-correlation-id'];
  const correlationId: string =
    typeof headerValue === 'string' && headerValue.length > 0
      ? headerValue
      : randomUUID();

  // 2. Attach to res.locals for downstream use
  res.locals['correlation_id'] = correlationId;

  // 3. Propagate as response header
  res.setHeader('x-correlation-id', correlationId);

  // 4. Capture start time
  const startMs = Date.now();

  // 5. Log on response finish
  res.on('finish', () => {
    const latency_ms = Date.now() - startMs;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      correlation_id: correlationId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      latency_ms,
      message: 'request completed',
    };
    emit(entry);
  });

  next();
}
