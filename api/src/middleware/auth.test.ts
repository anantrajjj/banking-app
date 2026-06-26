/**
 * Unit tests for the JWT verification middleware — auth.ts
 *
 * Requirements covered: 2.1, 2.4, 2.5, 3.1, 3.5
 *
 * Test cases:
 *  ✔ Missing Authorization header → 401 UNAUTHORIZED
 *  ✔ Malformed Bearer token (not a valid JWT) → 401 UNAUTHORIZED
 *  ✔ Expired JWT → 401 UNAUTHORIZED
 *  ✔ JWT with invalid signature (wrong key) → 401 UNAUTHORIZED
 *  ✔ Valid JWT, JTI in revocation list → 401 UNAUTHORIZED
 *  ✔ Valid JWT, session key missing (inactivity expired) → 401 SESSION_EXPIRED
 *  ✔ Valid JWT, all checks pass → calls next() and sets res.locals.user
 *  ✔ Redis unreachable during revocation check → request proceeds (WARNING logged)
 */

import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware } from './auth';

// ---------------------------------------------------------------------------
// Key generation — one RS256 key-pair for the entire suite
// ---------------------------------------------------------------------------

let privateKey: string;
let publicKey: string;
let wrongPrivateKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;

  const wrongPair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  wrongPrivateKey = wrongPair.privateKey;
});

// ---------------------------------------------------------------------------
// Mocks — secrets + logger (never call AWS / real Redis)
// ---------------------------------------------------------------------------

jest.mock('../utils/secrets', () => ({
  getSecret: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  },
}));

// Import after mocking so we get the mocked versions.
import { getSecret } from '../utils/secrets';
import { logger } from '../utils/logger';

const mockGetSecret = getSecret as jest.MockedFunction<typeof getSecret>;
const mockLogger = logger as jest.Mocked<typeof logger>;

// Make getSecret return our test public key by default.
beforeEach(() => {
  mockGetSecret.mockResolvedValue(publicKey);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Token factory
// ---------------------------------------------------------------------------

interface TokenOptions {
  sub?: string;
  role?: string;
  jti?: string;
  expiresIn?: string | number;
  signKey?: string;
}

function makeToken(opts: TokenOptions = {}): string {
  const {
    sub = 'user-uuid-123',
    role = 'CUSTOMER',
    jti = 'jti-default',
    expiresIn = '15m',
    signKey,
  } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign({ sub, role, jti }, signKey ?? privateKey, {
    algorithm: 'RS256',
    expiresIn: expiresIn as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
  });
}

// ---------------------------------------------------------------------------
// Redis mock factory
// ---------------------------------------------------------------------------

interface RedisMock {
  exists: jest.MockedFunction<(key: string) => Promise<number>>;
  del: jest.MockedFunction<(key: string) => Promise<number>>;
  expire: jest.MockedFunction<(key: string, ttl: number) => Promise<number>>;
}

/**
 * Default: revocation key does NOT exist (0), session key DOES exist (1).
 * Overrides replace any of those defaults.
 */
function makeRedisMock(overrides: Partial<RedisMock> = {}): RedisMock {
  return {
    exists: jest.fn((_key: string) => Promise.resolve(0)),
    del: jest.fn((_key: string) => Promise.resolve(1)),
    expire: jest.fn((_key: string, _ttl: number) => Promise.resolve(1)),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// HTTP test harness
// ---------------------------------------------------------------------------

interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

/**
 * Spins up an ephemeral Express server, fires one GET /protected, returns
 * the response, then shuts the server down.
 */
function runRequest(
  token: string | null,
  redisMock: RedisMock | null,
  extraHeaders: Record<string, string> = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const app = express();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const middleware = createAuthMiddleware(redisMock as any);
    app.use(middleware);

    app.get('/protected', (req, res) => {
      res.status(200).json({ user: req.user, locals_user: res.locals['user'] });
    });

    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        return reject(new Error('Unexpected server address'));
      }

      const headers: Record<string, string> = { ...extraHeaders };
      if (token !== null) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: address.port,
        path: '/protected',
        method: 'GET',
        headers,
      };

      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          server.close(() => {
            let body: unknown = null;
            try {
              body = JSON.parse(Buffer.concat(chunks).toString());
            } catch {
              // leave as null
            }
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body,
            });
          });
        });
      });

      req.on('error', (err) => server.close(() => reject(err)));
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// 1. Missing / malformed Authorization header
// ---------------------------------------------------------------------------

describe('Missing Authorization header → HTTP 401', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const result = await runRequest(null, null);

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });

  it('returns 401 when Authorization header is "Bearer " with no token', async () => {
    // Pass an empty token string — runRequest adds the header only when
    // token !== null, so we build a custom request here.
    const result = await new Promise<TestResponse>((resolve, reject) => {
      const app = express();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app.use(createAuthMiddleware(null as any));
      app.get('/protected', (_req, res) => res.status(200).json({ ok: true }));

      const server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/protected',
            method: 'GET',
            headers: { Authorization: 'Bearer ' },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              server.close(() => {
                resolve({
                  status: res.statusCode ?? 0,
                  headers: res.headers,
                  body: JSON.parse(Buffer.concat(chunks).toString()),
                });
              });
            });
          },
        );
        req.on('error', (e) => server.close(() => reject(e)));
        req.end();
      });
    });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Malformed JWT string
// ---------------------------------------------------------------------------

describe('Malformed Bearer token → HTTP 401', () => {
  it('returns 401 for a string that is not a valid JWT', async () => {
    const result = await runRequest('not.a.jwt.at.all', null);

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });

  it('returns 401 for a random base64 blob', async () => {
    const garbage = Buffer.from('{"alg":"RS256"}.{"sub":"x"}.invalidsig').toString('base64');
    const result = await runRequest(garbage, null);

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Expired JWT
// ---------------------------------------------------------------------------

describe('Expired JWT → HTTP 401', () => {
  it('returns 401 for a token whose exp has already passed', async () => {
    const expiredToken = jwt.sign(
      { sub: 'user-123', role: 'CUSTOMER', jti: 'jti-expired' },
      privateKey,
      { algorithm: 'RS256', expiresIn: -1 },
    );

    const result = await runRequest(expiredToken, null);

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Invalid signature (wrong key)
// ---------------------------------------------------------------------------

describe('JWT with invalid RS256 signature → HTTP 401', () => {
  it('returns 401 when the token was signed with a different private key', async () => {
    const tamperedToken = makeToken({ signKey: wrongPrivateKey });

    const result = await runRequest(tamperedToken, null);

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });
});

// ---------------------------------------------------------------------------
// 5. JTI in revocation list
// ---------------------------------------------------------------------------

describe('JTI in revocation list → HTTP 401', () => {
  it('returns 401 when revoked:<jti> key exists in Redis', async () => {
    const jti = 'jti-revoked-001';
    const token = makeToken({ jti });

    const redis = makeRedisMock({
      exists: jest.fn((key: string) =>
        Promise.resolve(key === `revoked:${jti}` ? 1 : 0),
      ),
    });

    const result = await runRequest(token, redis);

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Session key missing (inactivity expired)
// ---------------------------------------------------------------------------

describe('Session key missing (inactivity expired) → HTTP 401 SESSION_EXPIRED', () => {
  it('returns 401 with SESSION_EXPIRED code when session:<jti> does not exist', async () => {
    const jti = 'jti-inactive-001';
    const token = makeToken({ jti });

    const redis = makeRedisMock({
      // Both revocation key and session key are absent.
      exists: jest.fn((_key: string) => Promise.resolve(0)),
    });

    const result = await runRequest(token, redis);

    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      code: 'SESSION_EXPIRED',
      message: 'Session expired due to inactivity',
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Valid JWT — all checks pass
// ---------------------------------------------------------------------------

describe('Valid JWT — all checks pass → next() called, res.locals.user set', () => {
  it('returns HTTP 200, calls next(), and sets res.locals.user correctly', async () => {
    const jti = 'jti-valid-001';
    const token = makeToken({ jti, sub: 'user-uuid-abc', role: 'CUSTOMER' });

    const redis = makeRedisMock({
      // revocation key absent (0), session key present (1)
      exists: jest.fn((key: string) =>
        Promise.resolve(key.startsWith('session:') ? 1 : 0),
      ),
    });

    const result = await runRequest(token, redis);

    expect(result.status).toBe(200);

    const body = result.body as {
      user: { id: string; role: string; jti: string };
      locals_user: { id: string; role: string; jti: string };
    };

    // req.user is attached
    expect(body.user.id).toBe('user-uuid-abc');
    expect(body.user.role).toBe('CUSTOMER');
    expect(body.user.jti).toBe(jti);

    // res.locals.user is also attached
    expect(body.locals_user.id).toBe('user-uuid-abc');
    expect(body.locals_user.role).toBe('CUSTOMER');
    expect(body.locals_user.jti).toBe(jti);
  });

  it('resets the session TTL to 900 seconds (15 min) on a valid active request', async () => {
    const jti = 'jti-active-ttl-reset';
    const token = makeToken({ jti });

    const expireSpy = jest.fn((_key: string, _ttl: number) => Promise.resolve(1));
    const redis = makeRedisMock({
      exists: jest.fn((key: string) =>
        Promise.resolve(key.startsWith('session:') ? 1 : 0),
      ),
      expire: expireSpy,
    });

    const result = await runRequest(token, redis);

    expect(result.status).toBe(200);
    expect(expireSpy).toHaveBeenCalledWith(`session:${jti}`, 900);
  });

  it('works for BRANCH_MANAGER role', async () => {
    const jti = 'jti-bm-001';
    const token = makeToken({ jti, role: 'BRANCH_MANAGER' });

    const redis = makeRedisMock({
      exists: jest.fn((key: string) =>
        Promise.resolve(key.startsWith('session:') ? 1 : 0),
      ),
    });

    const result = await runRequest(token, redis);
    expect(result.status).toBe(200);
    const body = result.body as { user: { role: string } };
    expect(body.user.role).toBe('BRANCH_MANAGER');
  });

  it('works for ADMIN role', async () => {
    const jti = 'jti-admin-001';
    const token = makeToken({ jti, role: 'ADMIN' });

    const redis = makeRedisMock({
      exists: jest.fn((key: string) =>
        Promise.resolve(key.startsWith('session:') ? 1 : 0),
      ),
    });

    const result = await runRequest(token, redis);
    expect(result.status).toBe(200);
    const body = result.body as { user: { role: string } };
    expect(body.user.role).toBe('ADMIN');
  });
});

// ---------------------------------------------------------------------------
// 8. Redis unreachable — request proceeds, WARNING logged (Req 2.4)
// ---------------------------------------------------------------------------

describe('Redis unreachable → request proceeds with WARNING logged (Req 2.4)', () => {
  it('allows the request when Redis.exists throws ECONNREFUSED', async () => {
    const jti = 'jti-redis-down';
    const token = makeToken({ jti });

    const redis = makeRedisMock({
      exists: jest.fn((_key: string) => Promise.reject(new Error('ECONNREFUSED'))),
    });

    const result = await runRequest(token, redis);

    // Request must NOT be blocked.
    expect(result.status).toBe(200);

    // A WARNING must have been logged (Req 2.4).
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('revocation check skipped'),
      expect.objectContaining({ error: expect.any(String) }),
      expect.any(String), // correlationId
    );
  });

  it('includes the correlationId from the request header in the WARNING log', async () => {
    const jti = 'jti-redis-corr';
    const token = makeToken({ jti });
    const testCorrelationId = 'test-corr-id-12345';

    const redis = makeRedisMock({
      exists: jest.fn((_key: string) => Promise.reject(new Error('Connection refused'))),
    });

    await runRequest(token, redis, { 'x-correlation-id': testCorrelationId });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(testCorrelationId),
      expect.any(Object),
      testCorrelationId,
    );
  });
});
