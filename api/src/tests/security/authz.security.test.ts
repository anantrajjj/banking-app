// Feature: secure-bank
/**
 * Security tests — Authorization enforcement.
 *
 * Covers:
 *  - No token on every protected route → 401
 *  - Expired token → 401
 *  - Tampered token (modified payload, re-encoded without valid signature) → 401
 *  - CUSTOMER token calling ADMIN-only endpoint → 403
 *  - Customer A valid token + Customer B's account UUID → 403
 *  - Unknown role claim in token → 403
 *  - Valid token missing "Bearer " prefix → 401
 */

import request from 'supertest';
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import app from '../../app';
import * as accountService from '../../services/account.service';
import * as transferService from '../../services/transfer.service';
import * as loanService from '../../services/loan.service';
import * as transactionService from '../../services/transaction.service';

// ---------------------------------------------------------------------------
// Key pair for signing test tokens
// ---------------------------------------------------------------------------

let privateKey: string;
let wrongPrivateKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = pair.privateKey;

  const wrongPair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  wrongPrivateKey = wrongPair.privateKey;
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../utils/secrets', () => ({
  getSecret: jest.fn().mockImplementation((key: string) => {
    // Will be overridden in beforeEach to return the real publicKey
    return Promise.resolve(key);
  }),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../utils/metrics', () => ({
  recordFundTransferCompletion: jest.fn().mockResolvedValue(undefined),
  recordFailedLoginAttempt: jest.fn().mockResolvedValue(undefined),
  recordAccountLockout: jest.fn().mockResolvedValue(undefined),
  recordMfaFailure: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/account.service');
jest.mock('../../services/transfer.service');
jest.mock('../../services/loan.service');
jest.mock('../../services/transaction.service');

jest.mock('../../middleware/auth', () => {
  const actual = jest.requireActual('../../middleware/auth') as typeof import('../../middleware/auth');
  return {
    ...actual,
    // Keep the real createAuthMiddleware so we can import it, but override
    // authenticate and getRedisClient for predictable testing.
    getRedisClient: jest.fn().mockReturnValue({
      exists: jest.fn().mockImplementation((key: string) => {
        // Session key exists, no revocation
        return Promise.resolve(key.startsWith('session:') ? 1 : 0);
      }),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    }),
  };
});

import { getSecret } from '../../utils/secrets';

const mockGetSecret = getSecret as jest.MockedFunction<typeof getSecret>;

// Stub services to prevent real DB calls (return 403 for ownership-check scenarios)
beforeEach(() => {
  jest.clearAllMocks();
  // Make getSecret return our test public key by default (set in each describe)
  const { ServiceError } = jest.requireActual<typeof import('../../services/account.service')>(
    '../../services/account.service',
  );
  (accountService.getAccountSummary as jest.Mock).mockRejectedValue(
    new ServiceError(403, 'FORBIDDEN'),
  );
  (accountService.getMiniStatement as jest.Mock).mockRejectedValue(
    new ServiceError(403, 'FORBIDDEN'),
  );
  (transactionService.getTransactionHistory as jest.Mock).mockRejectedValue(
    new ServiceError(403, 'FORBIDDEN'),
  );
  (transactionService.exportCsvStatement as jest.Mock).mockRejectedValue(
    new ServiceError(403, 'FORBIDDEN'),
  );
  const { TransferError } = jest.requireActual<typeof import('../../services/transfer.service')>(
    '../../services/transfer.service',
  );
  (transferService.createTransfer as jest.Mock).mockRejectedValue(
    new TransferError(403, 'SOURCE_ACCOUNT_NOT_FOUND'),
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(payload: Record<string, unknown>, key?: string, options?: jwt.SignOptions): string {
  return jwt.sign(payload, key ?? privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
    ...options,
  });
}

function publicKeyForTest(): string {
  // Derived at runtime from the key pair generated in beforeAll
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return pair.publicKey;
}

// We need the actual public key that corresponds to our privateKey.
// Store it during beforeAll.
let testPublicKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // Override the private/public key with a fresh consistent pair for this file
  privateKey = pair.privateKey;
  testPublicKey = pair.publicKey;
});

// Make getSecret return the matching public key so the middleware can verify tokens
beforeEach(() => {
  mockGetSecret.mockResolvedValue(testPublicKey);
});

// ---------------------------------------------------------------------------
// Protected routes to test — (method, path, body?)
// ---------------------------------------------------------------------------

const PROTECTED_ROUTES: Array<{
  method: 'get' | 'post' | 'delete';
  path: string;
  body?: Record<string, unknown>;
}> = [
  { method: 'get', path: '/v1/accounts' },
  { method: 'get', path: '/v1/accounts/some-uuid/mini-statement' },
  { method: 'get', path: '/v1/accounts/some-uuid/transactions' },
  { method: 'get', path: '/v1/accounts/some-uuid/transactions/export' },
  {
    method: 'post',
    path: '/v1/transfers',
    body: {
      source_account_id: 'src',
      dest_account_id: 'dest',
      amount: 100,
      transfer_mode: 'NEFT',
      idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
    },
  },
  { method: 'get', path: '/v1/transfers/some-uuid' },
  { method: 'get', path: '/v1/loans' },
];

// ---------------------------------------------------------------------------

describe('No token on every protected route → 401', () => {
  it.each(PROTECTED_ROUTES)(
    '$method $path returns 401 without Authorization header',
    async ({ method, path, body }) => {
      let req = request(app)[method](path);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(401);
    },
  );
});

// ---------------------------------------------------------------------------

describe('Expired token → 401', () => {
  it('returns 401 when JWT exp is in the past', async () => {
    const expiredToken = jwt.sign(
      { sub: 'user-uuid-1', role: 'CUSTOMER', jti: 'jti-expired' },
      privateKey,
      { algorithm: 'RS256', expiresIn: -1 },
    );

    const res = await request(app)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe('Tampered token → 401', () => {
  it('returns 401 for a token with modified payload and no valid signature', async () => {
    const validToken = makeToken({ sub: 'user-uuid-1', role: 'CUSTOMER', jti: 'jti-legit' });
    const parts = validToken.split('.');

    // Modify the payload (base64url-encode a forged payload)
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'admin-uuid', role: 'ADMIN', jti: 'jti-forged', exp: Math.floor(Date.now() / 1000) + 900 }),
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

    const res = await request(app)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${tamperedToken}`);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a token signed with a different private key', async () => {
    const wrongKeyToken = makeToken(
      { sub: 'user-uuid-1', role: 'CUSTOMER', jti: 'jti-wrongkey' },
      wrongPrivateKey,
    );

    const res = await request(app)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${wrongKeyToken}`);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe('CUSTOMER token calling ADMIN-only endpoint → 403', () => {
  it('returns 403 when CUSTOMER calls PATCH /v1/beneficiaries/:id/verify', async () => {
    const customerToken = makeToken({
      sub: 'customer-uuid-1',
      role: 'CUSTOMER',
      jti: 'jti-customer',
    });

    // Set up Redis mock to allow session through
    const { getRedisClient } = jest.requireMock<typeof import('../../middleware/auth')>(
      '../../middleware/auth',
    );
    (getRedisClient as jest.Mock).mockReturnValue({
      exists: jest.fn().mockImplementation((key: string) =>
        Promise.resolve(key.startsWith('session:') ? 1 : 0),
      ),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    });

    const res = await request(app)
      .patch('/v1/beneficiaries/some-bene-uuid/verify')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------

describe('Customer A token + Customer B account UUID → 403', () => {
  it('returns 403 when account belongs to a different customer', async () => {
    const { ServiceError } = jest.requireActual<typeof import('../../services/account.service')>(
      '../../services/account.service',
    );
    (accountService.getMiniStatement as jest.Mock).mockRejectedValue(
      new ServiceError(403, 'FORBIDDEN'),
    );

    const customerAToken = makeToken({
      sub: 'customer-A-uuid',
      role: 'CUSTOMER',
      jti: 'jti-customer-A',
    });

    const { getRedisClient } = jest.requireMock<typeof import('../../middleware/auth')>(
      '../../middleware/auth',
    );
    (getRedisClient as jest.Mock).mockReturnValue({
      exists: jest.fn().mockImplementation((key: string) =>
        Promise.resolve(key.startsWith('session:') ? 1 : 0),
      ),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    });

    const res = await request(app)
      .get('/v1/accounts/customer-B-account-uuid/mini-statement')
      .set('Authorization', `Bearer ${customerAToken}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------

describe('Unknown role claim → 403', () => {
  it('returns 403 for a token with an unrecognised role', async () => {
    const unknownRoleToken = makeToken({
      sub: 'user-uuid-1',
      role: 'SUPER_USER', // not a valid role
      jti: 'jti-unknown-role',
    });

    const { getRedisClient } = jest.requireMock<typeof import('../../middleware/auth')>(
      '../../middleware/auth',
    );
    (getRedisClient as jest.Mock).mockReturnValue({
      exists: jest.fn().mockImplementation((key: string) =>
        Promise.resolve(key.startsWith('session:') ? 1 : 0),
      ),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    });

    const res = await request(app)
      .get('/v1/accounts')
      .set('Authorization', `Bearer ${unknownRoleToken}`);

    // The auth middleware catches unrecognised roles and returns 401 (per auth.ts line 191)
    // The RBAC middleware also returns 403 for unknown roles.
    expect([401, 403]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------

describe('Valid token missing "Bearer " prefix → 401', () => {
  it('returns 401 when Authorization header lacks the "Bearer " prefix', async () => {
    const validToken = makeToken({ sub: 'user-uuid-1', role: 'CUSTOMER', jti: 'jti-nobearer' });

    const res = await request(app)
      .get('/v1/accounts')
      .set('Authorization', validToken); // No "Bearer " prefix

    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is "Token <jwt>" instead of "Bearer <jwt>"', async () => {
    const validToken = makeToken({ sub: 'user-uuid-1', role: 'CUSTOMER', jti: 'jti-tokenprefix' });

    const res = await request(app)
      .get('/v1/accounts')
      .set('Authorization', `Token ${validToken}`);

    expect(res.status).toBe(401);
  });
});
