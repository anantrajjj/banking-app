/**
 * Loan routes — eligibility check and loan application listing.
 *
 * POST /loans/eligibility — authenticate → CUSTOMER → validate → sanitise → checkEligibility
 * GET  /loans             — authenticate → CUSTOMER → listLoanApplications
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { sanitise } from '../middleware/sanitise';
import * as loanService from '../services/loan.service';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const eligibilitySchema = {
  type: 'object',
  required: [
    'gross_monthly_income',
    'existing_emi',
    'loan_amount',
    'tenure_months',
    'annual_interest_rate',
  ],
  properties: {
    gross_monthly_income: { type: 'number', exclusiveMinimum: 0 },
    existing_emi: { type: 'number', minimum: 0 },
    loan_amount: { type: 'number', exclusiveMinimum: 0 },
    tenure_months: { type: 'integer', exclusiveMinimum: 0 },
    annual_interest_rate: { type: 'number', minimum: 0 },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// POST /loans/eligibility
// ---------------------------------------------------------------------------

router.post(
  '/loans/eligibility',
  authenticate,
  requireRole('CUSTOMER'),
  validate(eligibilitySchema),
  sanitise,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = req.user!.id;
      const correlationId = res.locals['correlation_id'] as string | undefined;

      const {
        gross_monthly_income,
        existing_emi,
        loan_amount,
        tenure_months,
        annual_interest_rate,
      } = req.body as {
        gross_monthly_income: number;
        existing_emi: number;
        loan_amount: number;
        tenure_months: number;
        annual_interest_rate: number;
      };

      const result = await loanService.checkEligibility(
        customerId,
        gross_monthly_income,
        existing_emi,
        loan_amount,
        tenure_months,
        annual_interest_rate,
        correlationId,
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /loans
// ---------------------------------------------------------------------------

router.get(
  '/loans',
  authenticate,
  requireRole('CUSTOMER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const { page: pageStr, decision } = req.query as {
        page?: string;
        decision?: string;
      };

      const page = pageStr ? parseInt(pageStr, 10) : 1;

      const result = await loanService.listLoanApplications(
        user.id,
        user.role,
        page,
        decision,
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
