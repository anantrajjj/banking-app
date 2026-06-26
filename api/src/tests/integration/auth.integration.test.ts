/**
 * Integration tests for auth endpoints.
 * Feature: secure-bank
 *
 * Covers:
 *  - POST /v1/auth/login → 200 with mfa_challenge_id
 *  - POST /v1/auth/login wrong password → 401
 *  - POST /v1/auth/login after 5 failures → 423
 *  - POST /v1/auth/mfa valid OTP → 200 with access_token
 *  - POST /v1/auth/mfa expired OTP → 401
 *  - POST /v1/auth/refresh valid token → 200
 *  - POST /v1/auth/logout → 200
 */

import request from 'supertest';
import app from '../../app';
import * as authService from '../../services/auth.service';
import * as authMiddleware from '../../middleware/auth';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../services/auth.service');
jest.mock('../../middleware/auth', () => {
  const actual = jest.requireActual('../../middleware/auth') as typeof import('../../middleware/auth');
  return {
    ...actual,
    authenticate: (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      // Attach a default authenticated user for logout tests
      req.user = { id: 'user-uuid-123', role: 'CUSTOMER', jti: 'jti-test-123' };
      (res.locals as Record<string, unknown>)['user'] = {
        id: 'user-uuid-123',
        role: 'CUSTOMER',
        jti: 'jti-test-123',
      };
      next();
    },
    getRedisClient: jest.fn().mockReturnValue({
      exists: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    }),
  };
});

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PublishCommand: jest.fn(),
}));

jest.mock('../../utils/secrets', () => ({
  getSecret: jest.fn().mockResolvedValue('mock-secret'),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../utils/metrics', () => ({
  recordFailedLoginAttempt: jest.fn().mockResolvedValue(undefined),
  recordAccountLockout: jest.fn().mockResolvedValue(undefined),
  recordMfaFailure: jest.fn().mockResolvedValue(undefined),
  recordFundTransferCompletion: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockLogin = authService.login as jest.MockedFunction<typeof authService.login>;
const mockVerifyMfa = authService.verifyMfa as jest.MockedFunction<typeof authService.verifyMfa>;
const mockLogout = authService.logout as jest.MockedFunction<typeof authService.logout>;
const mockRefreshToken = authService.refreshToken as jest.MockedFunction<typeof authService.refreshToken>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /v1/auth/login', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 200 with mfa_challenge_id on valid credentials', async () => {
    mockLogin.mockResolvedValueOnce({
      mfa_challenge_id: 'challenge-uuid-abc',
      otp_channel: 'EMAIL',
    });

    const res = await request(app)
      .post('/v1/auth/login')
      .send({ username: 'alice', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mfa_challenge_id', 'challenge-uuid-abc');
    expect(res.body).toHaveProperty('otp_channel', 'EMAIL');
  });

  it('returns 401 when password is wrong', async () => {
    const { AuthError } = jest.requireActual<typeof import('../../services/auth.service')>(
      '../../services/auth.service',
    );
    mockLogin.mockRejectedValueOnce(new AuthError(401, 'INVALID_CREDENTIALS'));

    const res = await request(app)
      .post('/v1/auth/login')
      .send({ username: 'alice', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'INVALID_CREDENTIALS');
  });

  it('returns 423 when account is locked (after 5 failures)', async () => {
    const { AuthError } = jest.requireActual<typeof import('../../services/auth.service')>(
      '../../services/auth.service',
    );
    mockLogin.mockRejectedValueOnce(
      new AuthError(423, 'ACCOUNT_LOCKED', 'Too many failed login attempts'),
    );

    const res = await request(app)
      .post('/v1/auth/login')
      .send({ username: 'alice', password: 'any-password' });

    expect(res.status).toBe(423);
    expect(res.body).toHaveProperty('code', 'ACCOUNT_LOCKED');
  });

  it('returns 400 on missing username field', async () => {
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ password: 'pw' });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('POST /v1/auth/mfa', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 200 with access_token on valid OTP', async () => {
    mockVerifyMfa.mockResolvedValueOnce({
      access_token: 'eyJhbGciOiJSUzI1NiJ9.test.sig',
      refresh_token: 'refresh-token-raw-hex',
      expires_in: 900,
    });

    const res = await request(app)
      .post('/v1/auth/mfa')
      .send({ mfa_challenge_id: 'challenge-uuid-abc', otp: '123456' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body).toHaveProperty('expires_in', 900);
  });

  it('returns 401 when OTP is expired or invalid', async () => {
    const { AuthError } = jest.requireActual<typeof import('../../services/auth.service')>(
      '../../services/auth.service',
    );
    mockVerifyMfa.mockRejectedValueOnce(new AuthError(401, 'INVALID_OTP'));

    const res = await request(app)
      .post('/v1/auth/mfa')
      .send({ mfa_challenge_id: 'challenge-uuid-abc', otp: '000000' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 'INVALID_OTP');
  });
});

// ---------------------------------------------------------------------------

describe('POST /v1/auth/refresh', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 200 with new access_token on valid refresh_token', async () => {
    mockRefreshToken.mockResolvedValueOnce({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 900,
    });

    const res = await request(app)
      .post('/v1/auth/refresh')
      .send({ refresh_token: 'valid-refresh-token-hex' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token', 'new-access-token');
    expect(res.body).toHaveProperty('refresh_token', 'new-refresh-token');
  });

  it('returns 400 when refresh_token field is missing', async () => {
    const res = await request(app)
      .post('/v1/auth/refresh')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('POST /v1/auth/logout', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 200 on successful logout', async () => {
    mockLogout.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post('/v1/auth/logout')
      .set('Authorization', 'Bearer mock-token')
      .send({ refresh_token: 'some-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
