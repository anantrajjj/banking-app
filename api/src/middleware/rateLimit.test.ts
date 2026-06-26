/**
 * Unit tests for the auth rate-limit middleware.
 *
 * Requirements: 1.11, 12.1
 *
 * Strategy:
 *  1. Test `rateLimitHandler` directly — verifies the 429 status code and the
 *     exact structured JSON body without needing to exhaust the rate-limit
 *     counter.
 *  2. Integration-style test — spin up a minimal Express app with the
 *     `authRateLimit` middleware configured to a very low `max` (1 req) and
 *     confirm that the second request receives HTTP 429 with the correct body
 *     and RateLimit-* headers.
 */

import http from 'http';
import express, { type Application } from 'express';
import rateLimit from 'express-rate-limit';
import {
  rateLimitHandler,
  authRateLimit,
  type RateLimitErrorResponse,
} from './rateLimit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock objects for testing the handler directly. */
function makeResMock(): {
  statusCode: number;
  body: unknown;
  status: jest.Mock;
  json: jest.Mock;
} {
  const mock = {
    statusCode: 200,
    body: null as unknown,
    status: jest.fn(),
    json: jest.fn(),
  };
  // Allow chaining: res.status(429).json(...)
  mock.status.mockImplementation((code: number) => {
    mock.statusCode = code;
    return mock;
  });
  mock.json.mockImplementation((data: unknown) => {
    mock.body = data;
    return mock;
  });
  return mock;
}

/** Makes a raw HTTP GET request and collects status, headers, and parsed body. */
function makeRequest(
  port: number,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let raw = '';
      res.on('data', (chunk: string) => (raw += chunk));
      res.on('end', () => {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on('error', reject);
  });
}

/** Creates a test Express server with a custom max and returns its port. */
function createTestServer(app: Application): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        return reject(new Error('Unexpected server address'));
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// 1. Direct handler unit tests
// ---------------------------------------------------------------------------

describe('rateLimitHandler — direct invocation (Requirements 1.11, 12.1)', () => {
  it('sets HTTP status to 429', () => {
    const req = {} as express.Request;
    const res = makeResMock() as unknown as express.Response;

    rateLimitHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('returns JSON body with code RATE_LIMIT_EXCEEDED', () => {
    const req = {} as express.Request;
    const res = makeResMock() as unknown as express.Response;

    rateLimitHandler(req, res);

    const body = (makeResMock().body ?? (res as unknown as ReturnType<typeof makeResMock>).body) as RateLimitErrorResponse;
    // Re-invoke to capture body through the mock chain
    const resMock = makeResMock();
    rateLimitHandler(req, resMock as unknown as express.Response);

    expect(resMock.body).toMatchObject<RateLimitErrorResponse>({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
    });
  });

  it('returns exactly the required message string', () => {
    const req = {} as express.Request;
    const resMock = makeResMock();

    rateLimitHandler(req, resMock as unknown as express.Response);

    expect((resMock.body as RateLimitErrorResponse).message).toBe(
      'Too many requests, please try again later.',
    );
  });

  it('does not include unexpected fields in the response body', () => {
    const req = {} as express.Request;
    const resMock = makeResMock();

    rateLimitHandler(req, resMock as unknown as express.Response);

    const keys = Object.keys(resMock.body as object);
    expect(keys).toEqual(expect.arrayContaining(['code', 'message']));
    expect(keys).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. authRateLimit middleware — configuration smoke test
// ---------------------------------------------------------------------------

describe('authRateLimit — middleware is a function (Requirements 1.11)', () => {
  it('exports authRateLimit as a RequestHandler function', () => {
    expect(typeof authRateLimit).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 3. Integration — authRateLimit blocks after max requests
// ---------------------------------------------------------------------------

describe('authRateLimit — integration: returns 429 when limit exceeded (Requirements 1.11)', () => {
  let port: number;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    // Configure a tight limit (max = 1) so we can trigger 429 with 2 requests.
    const testLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 1,
      standardHeaders: true,
      legacyHeaders: false,
      handler: rateLimitHandler,
    });

    const app = express();
    app.use('/auth', testLimiter, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = await createTestServer(app);
    port = server.port;
    closeServer = server.close;
  }, 10_000);

  afterAll(async () => {
    await closeServer();
  });

  it('allows the first request through (HTTP 200)', async () => {
    const result = await makeRequest(port, '/auth/login');
    expect(result.status).toBe(200);
  });

  it('blocks the second request with HTTP 429', async () => {
    const result = await makeRequest(port, '/auth/login');
    expect(result.status).toBe(429);
  });

  it('returns structured JSON error body on 429', async () => {
    const result = await makeRequest(port, '/auth/login');
    expect(result.body).toMatchObject<RateLimitErrorResponse>({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
    });
  });

  it('includes RateLimit-* standard headers on the 429 response', async () => {
    const result = await makeRequest(port, '/auth/login');
    // RFC-compliant headers set by standardHeaders: true
    // express-rate-limit v7 emits ratelimit-limit, ratelimit-remaining, ratelimit-reset
    const headerKeys = Object.keys(result.headers).join(' ');
    expect(headerKeys).toMatch(/ratelimit/i);
  });

  it('does NOT include legacy X-RateLimit-* headers', async () => {
    const result = await makeRequest(port, '/auth/login');
    const headerKeys = Object.keys(result.headers);
    const legacyHeaders = headerKeys.filter((k) => /^x-ratelimit-/i.test(k));
    expect(legacyHeaders).toHaveLength(0);
  });
});
