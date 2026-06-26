/**
 * Property-based tests for api/src/middleware/auth.ts
 *
 * **Validates: Requirements 1.1, 2.1, 2.5, 3.5**
 *
 * Property 7: JWT Expiry Enforcement
 *   For ANY expiry time `exp` that is strictly in the past (exp < now),
 *   a JWT signed with that `exp` sent to the auth middleware returns HTTP 401
 *   with body { code: 'UNAUTHORIZED', message: 'Authentication required' }.
 */

import http from 'http';
import express from 'express';
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import * as fc from 'fast-check';
import { createAuthMiddleware } from './auth';

// ---------------------------------------------------------------------------
// Key generation — one RS256 key-pair for the entire suite
// ---------------------------------------------------------------------------

let privateKey: string;
let publicKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
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

import { getSecret } from '../utils/secrets';

const mockGetSecret = getSecret as jest.MockedFunction<typeof getSecret>;

// Make getSecret return our test public key before each test.
beforeEach(() => {
  mockGetSecret.mockResolvedValue(publicKey);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// HTTP test harness
// ---------------------------------------------------------------------------

interface TestResponse {
  status: number;
  body: unknown;
}

/**
 * Spins up an ephemeral Express server, fires one GET /protected with the
 * given Authorization header, returns the response, then shuts down.
 */
function runRequest(token: string): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const app = express();

    // Pass null — Redis checks are skipped; we only care about token expiry.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const middleware = createAuthMiddleware(null as any);
    app.use(middleware);

    app.get('/protected', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        return reject(new Error('Unexpected server address'));
      }

      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: address.port,
        path: '/protected',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
// Property 7 — JWT Expiry Enforcement
// ---------------------------------------------------------------------------

describe('Property 7: JWT Expiry Enforcement (Requirements 1.1, 2.1, 2.5, 3.5)', () => {
  it(
    'returns HTTP 401 UNAUTHORIZED for any JWT whose exp is strictly in the past',
    async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);

      await fc.assert(
        fc.asyncProperty(
          // Generate "seconds in the past": 1 second ago up to 24 hours ago.
          fc.integer({ min: 1, max: 86400 }),
          async (secondsInThePast) => {
            const expiredAt = nowSeconds - secondsInThePast;

            // Build a JWT with the exp claim set directly (already expired).
            const token = jwt.sign(
              {
                sub: 'user-uuid-pbt',
                role: 'CUSTOMER',
                jti: `jti-pbt-${secondsInThePast}`,
                exp: expiredAt,
              },
              privateKey,
              { algorithm: 'RS256' },
            );

            const result = await runRequest(token);

            // Every expired token must yield 401 with the UNAUTHORIZED body.
            expect(result.status).toBe(401);
            expect(result.body).toEqual({
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
            });
          },
        ),
        { numRuns: 100, verbose: false },
      );
    },
    // Generous timeout: 100 runs × ~50 ms each = ~5 s; allow 30 s headroom.
    30_000,
  );
});
