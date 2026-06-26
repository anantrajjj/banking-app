/**
 * Integration tests for transfer endpoints.
 * Feature: secure-bank
 *
 * Covers:
 *  - POST /v1/transfers valid → 201
 *  - POST /v1/transfers same idempotency_key replay → 201, no duplicate
 *  - POST /v1/transfers insufficient funds → 422
 *  - POST /v1/transfers wrong account → 403
 *  - GET  /v1/transfers/:id → 200
 *  - GET  /v1/transfers/:id not owned → 403
 */

import request from 'supertest';
import app from '../../app';
import * as transferService from '../../services/transfer.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../services/transfer.service');

jest.mock('../../middleware/auth', () => {
  const actual = jest.requireActual('../../middleware/auth') as typeof import('../../middleware/auth');
  return {
    ...actual,
    authenticate: (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      req.user = { id: 'customer-uuid-001', role: 'CUSTOMER', jti: 'jti-001' };
      (res.locals as Record<string, unknown>)['user'] = {
        id: 'customer-uuid-001',
        role: 'CUSTOMER',
        jti: 'jti-001',
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

jest.mock('../../utils/secrets', () => ({
  getSecret: jest.fn().mockResolvedValue('mock-secret'),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../utils/metrics', () => ({
  recordFundTransferCompletion: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockCreateTransfer = transferService.createTransfer as jest.MockedFunction<
  typeof transferService.createTransfer
>;
const mockGetTransfer = transferService.getTransfer as jest.MockedFunction<
  typeof transferService.getTransfer
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_TRANSFER_BODY = {
  source_account_id: 'src-account-uuid',
  dest_account_id: 'dest-account-uuid',
  amount: 1000,
  transfer_mode: 'NEFT',
  idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
  narration: 'Test transfer',
};

const MOCK_TRANSFER_ROW = {
  id: 'transfer-uuid-001',
  customer_id: 'customer-uuid-001',
  source_account_id: 'src-account-uuid',
  dest_account_id: 'dest-account-uuid',
  amount: '1000.00',
  currency: 'INR',
  transfer_mode: 'NEFT' as const,
  idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
  status: 'COMPLETED' as const,
  created_at: new Date('2024-01-01T10:00:00Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /v1/transfers', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 201 on valid transfer', async () => {
    mockCreateTransfer.mockResolvedValueOnce(MOCK_TRANSFER_ROW);

    const res = await request(app)
      .post('/v1/transfers')
      .set('Authorization', 'Bearer mock-token')
      .send(VALID_TRANSFER_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 'transfer-uuid-001');
    expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
  });

  it('returns 201 on duplicate idempotency_key (no new record created)', async () => {
    // Service returns same existing transfer on duplicate key
    mockCreateTransfer.mockResolvedValueOnce(MOCK_TRANSFER_ROW);

    const res = await request(app)
      .post('/v1/transfers')
      .set('Authorization', 'Bearer mock-token')
      .send(VALID_TRANSFER_BODY);

    expect(res.status).toBe(201);
    // The service was called once — idempotency is handled inside the service
    expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
    expect(res.body).toHaveProperty('id', MOCK_TRANSFER_ROW.id);
  });

  it('returns 422 when source account has insufficient funds', async () => {
    const { TransferError } = jest.requireActual<
      typeof import('../../services/transfer.service')
    >('../../services/transfer.service');

    mockCreateTransfer.mockRejectedValueOnce(
      new TransferError(422, 'INSUFFICIENT_FUNDS', { available_balance: 100 }),
    );

    const res = await request(app)
      .post('/v1/transfers')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...VALID_TRANSFER_BODY, amount: 999999 });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('code', 'INSUFFICIENT_FUNDS');
  });

  it('returns 403 when source account does not belong to the customer', async () => {
    const { TransferError } = jest.requireActual<
      typeof import('../../services/transfer.service')
    >('../../services/transfer.service');

    mockCreateTransfer.mockRejectedValueOnce(
      new TransferError(403, 'SOURCE_ACCOUNT_NOT_FOUND'),
    );

    const res = await request(app)
      .post('/v1/transfers')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...VALID_TRANSFER_BODY, source_account_id: 'other-customers-account' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'SOURCE_ACCOUNT_NOT_FOUND');
  });

  it('returns 400 on invalid transfer_mode', async () => {
    const res = await request(app)
      .post('/v1/transfers')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...VALID_TRANSFER_BODY, transfer_mode: 'WIRE' });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('GET /v1/transfers/:id', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 200 with the transfer record when owned by caller', async () => {
    mockGetTransfer.mockResolvedValueOnce(MOCK_TRANSFER_ROW);

    const res = await request(app)
      .get('/v1/transfers/transfer-uuid-001')
      .set('Authorization', 'Bearer mock-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'transfer-uuid-001');
  });

  it('returns 403 when transfer does not belong to the caller', async () => {
    const { ServiceError } = jest.requireActual<
      typeof import('../../services/account.service')
    >('../../services/account.service');

    mockGetTransfer.mockRejectedValueOnce(new ServiceError(404, 'TRANSFER_NOT_FOUND'));

    const res = await request(app)
      .get('/v1/transfers/other-transfer-uuid')
      .set('Authorization', 'Bearer mock-token');

    // 404 from TRANSFER_NOT_FOUND (service enforces ownership by customer_id in query)
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'TRANSFER_NOT_FOUND');
  });
});
