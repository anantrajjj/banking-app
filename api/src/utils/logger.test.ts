/**
 * Unit tests for api/src/utils/logger.ts
 *
 * Covers:
 *   - sanitiseMeta: strips PII/secret field names (pan, aadhaar, password,
 *     token, secret, key and any field whose name contains those words);
 *     preserves safe fields; handles nested objects and arrays.
 *   - logger.info/warn/error/fatal: each emits a single-line JSON object to
 *     stdout containing timestamp, level, message, and (optionally)
 *     correlation_id plus safe meta fields.
 *   - requestLogger middleware: sets x-correlation-id response header,
 *     populates res.locals.correlation_id, generates a UUID when the header
 *     is absent, propagates an existing header value, and on 'finish' emits a
 *     JSON log with correlation_id, method, path, status, latency_ms.
 *
 * Requirement 13.1 — no PII or secrets are ever logged.
 */

import { EventEmitter } from 'events';
import type { Request, Response, NextFunction } from 'express';

import { sanitiseMeta, logger, requestLogger } from './logger';

// ---------------------------------------------------------------------------
// Helpers: capture stdout
// ---------------------------------------------------------------------------

/**
 * Intercepts process.stdout.write for the duration of a callback and returns
 * every line written as a parsed JSON object.
 */
async function captureJsonLines(fn: () => void | Promise<void>): Promise<unknown[]> {
  const lines: unknown[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    for (const line of str.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        lines.push(JSON.parse(trimmed));
      }
    }
    return true;
  }) as typeof process.stdout.write;

  try {
    const result = fn();
    if (result instanceof Promise) await result;
  } finally {
    process.stdout.write = original;
  }

  return lines;
}

// ---------------------------------------------------------------------------
// sanitiseMeta
// ---------------------------------------------------------------------------

describe('sanitiseMeta', () => {
  // ── PII field names that must be stripped ────────────────────────────────

  const bannedFields = ['pan', 'aadhaar', 'password', 'token', 'secret', 'key'];

  it.each(bannedFields)('strips top-level field "%s"', (field) => {
    const result = sanitiseMeta({ [field]: 'sensitive-value', safe: 'ok' }) as Record<
      string,
      unknown
    >;
    expect(result).not.toHaveProperty(field);
    expect(result['safe']).toBe('ok');
  });

  it('strips compound field names that contain a banned word (e.g. "apiKey", "jwtToken")', () => {
    const result = sanitiseMeta({
      apiKey: 'abc',
      jwtToken: 'xyz',
      accessToken: 'def',
      secretKey: 'ghi',
      safe: 'visible',
    }) as Record<string, unknown>;

    expect(result).not.toHaveProperty('apiKey');
    expect(result).not.toHaveProperty('jwtToken');
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('secretKey');
    expect(result['safe']).toBe('visible');
  });

  it('strips banned fields regardless of case', () => {
    const result = sanitiseMeta({
      PASSWORD: 'upper',
      Token: 'mixed',
      safe: 'yes',
    }) as Record<string, unknown>;

    expect(result).not.toHaveProperty('PASSWORD');
    expect(result).not.toHaveProperty('Token');
    expect(result['safe']).toBe('yes');
  });

  it('preserves safe fields', () => {
    const result = sanitiseMeta({
      userId: 'u1',
      action: 'login',
      status: 200,
    });
    expect(result).toEqual({ userId: 'u1', action: 'login', status: 200 });
  });

  it('strips banned fields recursively in nested objects', () => {
    const result = sanitiseMeta({
      user: { name: 'Alice', password: 'hunter2' },
    }) as Record<string, unknown>;

    expect((result['user'] as Record<string, unknown>)['name']).toBe('Alice');
    expect((result['user'] as Record<string, unknown>)).not.toHaveProperty('password');
  });

  it('strips banned fields inside array elements', () => {
    const result = sanitiseMeta([
      { id: 1, secret: 'shhh' },
      { id: 2, name: 'safe' },
    ]) as Array<Record<string, unknown>>;

    expect(result[0]).not.toHaveProperty('secret');
    expect(result[0]!['id']).toBe(1);
    expect(result[1]!['name']).toBe('safe');
  });

  it('returns primitives unchanged', () => {
    expect(sanitiseMeta(42)).toBe(42);
    expect(sanitiseMeta('hello')).toBe('hello');
    expect(sanitiseMeta(null)).toBeNull();
    expect(sanitiseMeta(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// logger.* — JSON output on stdout
// ---------------------------------------------------------------------------

describe('logger', () => {
  const levels = ['info', 'warn', 'error', 'fatal'] as const;

  it.each(levels)('logger.%s emits a single JSON line with correct level', async (level) => {
    const [entry] = await captureJsonLines(() => {
      logger[level]('test message');
    });
    const e = entry as Record<string, unknown>;
    expect(e['level']).toBe(level);
    expect(e['message']).toBe('test message');
  });

  it('emits timestamp in ISO 8601 format', async () => {
    const [entry] = await captureJsonLines(() => logger.info('ts check'));
    const e = entry as Record<string, unknown>;
    expect(typeof e['timestamp']).toBe('string');
    expect(() => new Date(e['timestamp'] as string).toISOString()).not.toThrow();
  });

  it('includes correlation_id when provided', async () => {
    const [entry] = await captureJsonLines(() =>
      logger.info('msg', {}, 'corr-id-123'),
    );
    const e = entry as Record<string, unknown>;
    expect(e['correlation_id']).toBe('corr-id-123');
  });

  it('omits correlation_id when not provided', async () => {
    const [entry] = await captureJsonLines(() => logger.info('msg'));
    const e = entry as Record<string, unknown>;
    expect(e).not.toHaveProperty('correlation_id');
  });

  it('includes safe meta fields in the output', async () => {
    const [entry] = await captureJsonLines(() =>
      logger.info('msg', { userId: 'u1', action: 'view' }),
    );
    const e = entry as Record<string, unknown>;
    expect(e['userId']).toBe('u1');
    expect(e['action']).toBe('view');
  });

  const piiFields = ['pan', 'aadhaar', 'password', 'token', 'secret', 'key'];

  it.each(piiFields)('never logs PII field "%s" via logger.info', async (field) => {
    const [entry] = await captureJsonLines(() =>
      logger.info('attempt', { [field]: 'pii-value', safe: 'ok' }),
    );
    const serialised = JSON.stringify(entry);
    // The field name itself must not appear in the serialised output
    expect(serialised).not.toContain(`"${field}"`);
  });

  it('emits exactly one line per log call', async () => {
    const lines = await captureJsonLines(() => {
      logger.info('one');
      logger.warn('two');
    });
    expect(lines).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// requestLogger middleware
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Express-like mock triple (req, res, next).
 * `res` extends EventEmitter so we can emit 'finish' to simulate response end.
 */
function buildMockReqRes(overrideHeaders: Record<string, string> = {}) {
  const req = {
    method: 'GET',
    path: '/test',
    headers: { ...overrideHeaders },
  } as unknown as Request;

  class MockResponse extends EventEmitter {
    statusCode = 200;
    private _headers: Record<string, string> = {};

    setHeader(name: string, value: string) {
      this._headers[name.toLowerCase()] = value;
    }
    getHeader(name: string) {
      return this._headers[name.toLowerCase()];
    }
    locals: Record<string, unknown> = {};
  }

  const res = new MockResponse() as unknown as Response & MockResponse;
  const next: NextFunction = jest.fn();

  return { req, res: res as typeof res & MockResponse, next };
}

describe('requestLogger middleware', () => {
  it('calls next()', async () => {
    const { req, res, next } = buildMockReqRes();
    requestLogger(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets x-correlation-id response header', () => {
    const { req, res, next } = buildMockReqRes();
    requestLogger(req, res, next);
    const header = (res as unknown as { getHeader(n: string): string }).getHeader(
      'x-correlation-id',
    );
    expect(typeof header).toBe('string');
    expect(header.length).toBeGreaterThan(0);
  });

  it('sets res.locals.correlation_id', () => {
    const { req, res, next } = buildMockReqRes();
    requestLogger(req, res, next);
    expect(typeof res.locals['correlation_id']).toBe('string');
    expect((res.locals['correlation_id'] as string).length).toBeGreaterThan(0);
  });

  it('propagates existing x-correlation-id header from the request', () => {
    const existing = 'my-trace-id-abc';
    const { req, res, next } = buildMockReqRes({ 'x-correlation-id': existing });
    requestLogger(req, res, next);

    expect(res.locals['correlation_id']).toBe(existing);
    const responseHeader = (res as unknown as { getHeader(n: string): string }).getHeader(
      'x-correlation-id',
    );
    expect(responseHeader).toBe(existing);
  });

  it('generates a UUID v4 when x-correlation-id header is absent', () => {
    const { req, res, next } = buildMockReqRes();
    requestLogger(req, res, next);
    const id = res.locals['correlation_id'] as string;
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('x-correlation-id response header matches res.locals.correlation_id', () => {
    const { req, res, next } = buildMockReqRes();
    requestLogger(req, res, next);
    const localId = res.locals['correlation_id'] as string;
    const headerVal = (res as unknown as { getHeader(n: string): string }).getHeader(
      'x-correlation-id',
    );
    expect(headerVal).toBe(localId);
  });

  it('emits a JSON log entry on response finish', async () => {
    const { req, res, next } = buildMockReqRes();

    const lines = await captureJsonLines(() => {
      requestLogger(req, res, next);
      (res as unknown as EventEmitter).emit('finish');
    });

    expect(lines).toHaveLength(1);
  });

  it('log entry on finish contains correlation_id, method, path, status, latency_ms', async () => {
    const { req, res, next } = buildMockReqRes({ 'x-correlation-id': 'trace-xyz' });
    (req as unknown as Record<string, unknown>)['method'] = 'POST';
    (req as unknown as Record<string, unknown>)['path'] = '/api/login';
    (res as unknown as Record<string, unknown>)['statusCode'] = 401;

    const lines = await captureJsonLines(() => {
      requestLogger(req, res, next);
      (res as unknown as EventEmitter).emit('finish');
    });

    const entry = lines[0] as Record<string, unknown>;
    expect(entry['correlation_id']).toBe('trace-xyz');
    expect(entry['method']).toBe('POST');
    expect(entry['path']).toBe('/api/login');
    expect(entry['status']).toBe(401);
    expect(typeof entry['latency_ms']).toBe('number');
    expect(entry['latency_ms']).toBeGreaterThanOrEqual(0);
  });

  it('latency_ms is a non-negative number', async () => {
    const { req, res, next } = buildMockReqRes();

    const lines = await captureJsonLines(() => {
      requestLogger(req, res, next);
      (res as unknown as EventEmitter).emit('finish');
    });

    const entry = lines[0] as Record<string, unknown>;
    expect(typeof entry['latency_ms']).toBe('number');
    expect(entry['latency_ms'] as number).toBeGreaterThanOrEqual(0);
  });

  it('does NOT log any PII fields in the finish entry', async () => {
    const { req, res, next } = buildMockReqRes();

    const lines = await captureJsonLines(() => {
      requestLogger(req, res, next);
      (res as unknown as EventEmitter).emit('finish');
    });

    const serialised = JSON.stringify(lines[0]);
    for (const field of ['pan', 'aadhaar', 'password', 'token', 'secret']) {
      expect(serialised).not.toContain(`"${field}"`);
    }
  });
});
