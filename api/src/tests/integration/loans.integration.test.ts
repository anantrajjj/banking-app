/**
 * Integration tests for loan endpoints.
 * Feature: secure-bank
 *
 * Covers:
 *  - POST /v1/loans/eligibility approved case → 200 APPROVED
 *  - POST /v1/loans/eligibility rejected case (EMI > 40%) → 200 REJECTED
 *  - POST /v1/loans/eligibility invalid input → 400
 *  - GET  /v1/loans as CUSTOMER → own applications only
 *  - GET  /v1/loans as ADMIN → all applications
 */

import request from 'supertest';
import app from '../../app';
import * as loanService from '../../services/loan.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../services/loan.service');

// Mutable role for the injected auth mock
let mockUserRole: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN' = 'CUSTOMER';
let mockUserId = 'customer-uuid-001';

jest.mock('../../middleware/auth', () => {
  const actual = jest.requireActual('../../middleware/auth') as typeof import('../../middleware/auth');
  return {
    ...actual,
    authenticate: (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      req.user = { id: mockUserId, role: mockUserRole, jti: 'jti-test' };
      (res.locals as Record<string, unknown>)['user'] = {
        id: mockUserId,
        role: mockUserRole,
        jti: 'jti-test',
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

const mockCheckEligibility = loanService.checkEligibility as jest.MockedFunction<
  typeof loanService.checkEligibility
>;
const mockListLoanApplications = loanService.listLoanApplications as jest.MockedFunction<
  typeof loanService.listLoanApplications
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_ELIGIBILITY_BODY = {
  gross_monthly_income: 100000,
  existing_emi: 5000,
  loan_amount: 500000,
  tenure_months: 24,
  annual_interest_rate: 10,
};

const APPROVED_RESULT: loanService.EligibilityResult = {
  application_id: 'app-uuid-001',
  decision: 'APPROVED',
  calculated_emi: 23072.46,
  total_emi_burden: 28072.46,
  gross_monthly_income: 100000,
  existing_emi: 5000,
  loan_amount: 500000,
  tenure_months: 24,
  annual_interest_rate: 10,
  total_payable: 553739.04,
  rejection_reason: null,
};

const REJECTED_RESULT: loanService.EligibilityResult = {
  application_id: 'app-uuid-002',
  decision: 'REJECTED',
  calculated_emi: 45000,
  total_emi_burden: 50000,  // 50% of 100000 — exceeds 40%
  gross_monthly_income: 100000,
  existing_emi: 5000,
  loan_amount: 1000000,
  tenure_months: 24,
  annual_interest_rate: 10,
  total_payable: 1080000,
  rejection_reason: 'Total EMI burden (50000.00) exceeds 40% of gross monthly income',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /v1/loans/eligibility', () => {
  beforeEach(() => {
    mockUserRole = 'CUSTOMER';
    mockUserId = 'customer-uuid-001';
  });
  afterEach(() => jest.clearAllMocks());

  it('returns 200 APPROVED when EMI burden ≤ 40% of income', async () => {
    mockCheckEligibility.mockResolvedValueOnce(APPROVED_RESULT);

    const res = await request(app)
      .post('/v1/loans/eligibility')
      .set('Authorization', 'Bearer mock-token')
      .send(VALID_ELIGIBILITY_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('decision', 'APPROVED');
    expect(res.body).toHaveProperty('calculated_emi');
    expect(res.body).toHaveProperty('total_payable');
  });

  it('returns 200 REJECTED when EMI burden > 40% of income', async () => {
    mockCheckEligibility.mockResolvedValueOnce(REJECTED_RESULT);

    const res = await request(app)
      .post('/v1/loans/eligibility')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...VALID_ELIGIBILITY_BODY, loan_amount: 1000000 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('decision', 'REJECTED');
    expect(res.body).toHaveProperty('rejection_reason');
  });

  it('returns 400 when loan_amount is zero or negative', async () => {
    // Schema validation (exclusiveMinimum: 0) should reject before the service
    const res = await request(app)
      .post('/v1/loans/eligibility')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...VALID_ELIGIBILITY_BODY, loan_amount: 0 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when tenure_months is zero or negative', async () => {
    const res = await request(app)
      .post('/v1/loans/eligibility')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...VALID_ELIGIBILITY_BODY, tenure_months: 0 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when gross_monthly_income is zero or negative', async () => {
    const res = await request(app)
      .post('/v1/loans/eligibility')
      .set('Authorization', 'Bearer mock-token')
      .send({ ...VALID_ELIGIBILITY_BODY, gross_monthly_income: -1000 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/v1/loans/eligibility')
      .set('Authorization', 'Bearer mock-token')
      .send({ gross_monthly_income: 100000 });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('GET /v1/loans', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns own loan applications only when role is CUSTOMER', async () => {
    mockUserRole = 'CUSTOMER';
    mockUserId = 'customer-uuid-001';

    const customerResult: loanService.LoanListResult = {
      data: [
        {
          id: 'app-uuid-001',
          customer_id: 'customer-uuid-001',
          loan_amount: 500000,
          tenure_months: 24,
          annual_interest_rate: 10,
          calculated_emi: 23072.46,
          decision: 'APPROVED',
          rejection_reason: null,
          submitted_at: new Date('2024-01-10T09:00:00Z'),
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
    };
    mockListLoanApplications.mockResolvedValueOnce(customerResult);

    const res = await request(app)
      .get('/v1/loans')
      .set('Authorization', 'Bearer mock-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    // Service was called with the customer's own ID
    expect(mockListLoanApplications).toHaveBeenCalledWith(
      'customer-uuid-001',
      'CUSTOMER',
      expect.any(Number),
      expect.anything(),
    );
  });

  it('returns all applications when role is ADMIN', async () => {
    mockUserRole = 'ADMIN';
    mockUserId = 'admin-uuid-001';

    const adminResult: loanService.LoanListResult = {
      data: [
        {
          id: 'app-uuid-001',
          customer_id: 'customer-uuid-001',
          loan_amount: 500000,
          tenure_months: 24,
          annual_interest_rate: 10,
          calculated_emi: 23072.46,
          decision: 'APPROVED',
          rejection_reason: null,
          submitted_at: new Date('2024-01-10T09:00:00Z'),
        },
        {
          id: 'app-uuid-002',
          customer_id: 'customer-uuid-002',
          loan_amount: 200000,
          tenure_months: 12,
          annual_interest_rate: 12,
          calculated_emi: 17770.34,
          decision: 'REJECTED',
          rejection_reason: 'EMI_EXCEEDS_INCOME_LIMIT',
          submitted_at: new Date('2024-01-11T10:00:00Z'),
        },
      ],
      total: 2,
      page: 1,
      page_size: 25,
    };
    mockListLoanApplications.mockResolvedValueOnce(adminResult);

    const res = await request(app)
      .get('/v1/loans')
      .set('Authorization', 'Bearer mock-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    // Admin retrieves all applications — service called with ADMIN role
    expect(mockListLoanApplications).toHaveBeenCalledWith(
      'admin-uuid-001',
      'ADMIN',
      expect.any(Number),
      expect.anything(),
    );
    expect(res.body.data).toHaveLength(2);
  });
});
