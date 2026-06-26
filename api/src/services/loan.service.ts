/**
 * Loan Service — EMI calculation, eligibility check, and loan application listing.
 *
 * Implements Requirements 8.1–8.7.
 *
 * All DB queries use parameterised statements via query() from ../db/index.
 */

import { query } from '../db/index';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class LoanError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    public detail?: string | Record<string, unknown>,
  ) {
    super(typeof detail === 'string' ? detail : code);
    this.name = 'LoanError';
  }
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface LoanApplicationRow {
  id: string;
  customer_id: string;
  gross_monthly_income: string;
  existing_emi: string;
  loan_amount: string;
  tenure_months: number;
  annual_interest_rate: string;
  calculated_emi: string | null;
  total_payable: string | null;
  effective_rate: string | null;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING';
  rejection_reason: string | null;
  submitted_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// calculateEmi (Req 8.1)
// ---------------------------------------------------------------------------

export function calculateEmi(
  principal: number,
  annualRate: number,
  tenureMonths: number,
): number {
  const r = annualRate / 12 / 100;

  if (r === 0) {
    // Zero interest — simple division
    return parseFloat((principal / tenureMonths).toFixed(2));
  }

  const onePlusRN = Math.pow(1 + r, tenureMonths);
  const emi = (principal * r * onePlusRN) / (onePlusRN - 1);
  return parseFloat(emi.toFixed(2));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateEligibilityInputs(
  grossMonthlyIncome: number,
  existingEmi: number,
  loanAmount: number,
  tenureMonths: number,
): string[] {
  const invalidFields: string[] = [];

  if (!loanAmount || loanAmount <= 0) invalidFields.push('loanAmount');
  if (!tenureMonths || tenureMonths <= 0) invalidFields.push('tenureMonths');
  if (!grossMonthlyIncome || grossMonthlyIncome <= 0) invalidFields.push('grossMonthlyIncome');
  if (existingEmi === undefined || existingEmi === null || existingEmi < 0)
    invalidFields.push('existingEmi');

  return invalidFields;
}

// ---------------------------------------------------------------------------
// checkEligibility (Req 8.1–8.6)
// ---------------------------------------------------------------------------

export interface EligibilityResult {
  application_id: string;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING';
  calculated_emi: number;
  total_emi_burden: number;
  gross_monthly_income: number;
  existing_emi: number;
  loan_amount: number;
  tenure_months: number;
  annual_interest_rate: number;
  total_payable: number;
  rejection_reason: string | null;
}

export async function checkEligibility(
  customerId: string,
  grossMonthlyIncome: number,
  existingEmi: number,
  loanAmount: number,
  tenureMonths: number,
  annualInterestRate: number,
  correlationId?: string,
): Promise<EligibilityResult> {
  // Validate inputs
  const invalidFields = validateEligibilityInputs(
    grossMonthlyIncome,
    existingEmi,
    loanAmount,
    tenureMonths,
  );

  if (invalidFields.length > 0) {
    throw new LoanError(400, 'VALIDATION_ERROR', {
      invalid_fields: invalidFields,
    } as unknown as string);
  }

  // Calculate EMI
  const calculatedEmi = calculateEmi(loanAmount, annualInterestRate, tenureMonths);
  const totalEmiBurden = calculatedEmi + existingEmi;
  const totalPayable = parseFloat((calculatedEmi * tenureMonths).toFixed(2));

  // Decision: total EMI must not exceed 40% of gross monthly income (Req 8.4)
  const decision: 'APPROVED' | 'REJECTED' =
    totalEmiBurden > 0.4 * grossMonthlyIncome ? 'REJECTED' : 'APPROVED';

  const rejectionReason =
    decision === 'REJECTED'
      ? `Total EMI burden (${totalEmiBurden.toFixed(2)}) exceeds 40% of gross monthly income`
      : null;

  // Persist to DB
  try {
    const result = await query<LoanApplicationRow>(
      `INSERT INTO loan_applications
         (customer_id, gross_monthly_income, existing_emi, loan_amount, tenure_months,
          annual_interest_rate, calculated_emi, total_payable, decision, rejection_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        customerId,
        grossMonthlyIncome,
        existingEmi,
        loanAmount,
        tenureMonths,
        annualInterestRate,
        calculatedEmi,
        totalPayable,
        decision,
        rejectionReason,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new LoanError(500, 'DB_WRITE_FAILED', 'Failed to persist loan application');
    }

    return {
      application_id: row.id,
      decision: row.decision,
      calculated_emi: calculatedEmi,
      total_emi_burden: totalEmiBurden,
      gross_monthly_income: grossMonthlyIncome,
      existing_emi: existingEmi,
      loan_amount: loanAmount,
      tenure_months: tenureMonths,
      annual_interest_rate: annualInterestRate,
      total_payable: totalPayable,
      rejection_reason: rejectionReason,
    };
  } catch (err) {
    if (err instanceof LoanError) throw err;

    logger.error('checkEligibility DB write failed', {
      customerId,
      error: (err as Error).message,
      correlationId,
    });

    // DB write failed — throw error; decision is PENDING per spec
    throw new LoanError(500, 'DB_WRITE_FAILED');
  }
}

// ---------------------------------------------------------------------------
// listLoanApplications (Req 8.7)
// ---------------------------------------------------------------------------

const LOANS_PAGE_SIZE = 25;

export interface LoanApplicationSummary {
  id: string;
  customer_id: string;
  loan_amount: number;
  tenure_months: number;
  annual_interest_rate: number;
  calculated_emi: number | null;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING';
  rejection_reason: string | null;
  submitted_at: Date;
}

export interface LoanListResult {
  data: LoanApplicationSummary[];
  total: number;
  page: number;
  page_size: number;
}

export async function listLoanApplications(
  requestingUserId: string,
  role: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN',
  page: number,
  decisionFilter?: string,
): Promise<LoanListResult> {
  const validatedPage = page > 0 ? page : 1;
  const offset = (validatedPage - 1) * LOANS_PAGE_SIZE;

  const params: (string | number)[] = [];
  const whereClauses: string[] = [];
  let paramIdx = 1;

  // Customers only see their own applications (Req 8.7)
  if (role === 'CUSTOMER') {
    whereClauses.push(`customer_id = $${paramIdx}`);
    params.push(requestingUserId);
    paramIdx++;
  }
  // BRANCH_MANAGER and ADMIN see all records

  if (decisionFilter) {
    whereClauses.push(`decision = $${paramIdx}`);
    params.push(decisionFilter);
    paramIdx++;
  }

  const whereClause =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM loan_applications ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  // Data
  const dataParams = [...params, LOANS_PAGE_SIZE, offset];
  const dataResult = await query<LoanApplicationRow>(
    `SELECT * FROM loan_applications ${whereClause}
     ORDER BY submitted_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    dataParams,
  );

  const data: LoanApplicationSummary[] = dataResult.rows.map((row) => ({
    id: row.id,
    customer_id: row.customer_id,
    loan_amount: parseFloat(row.loan_amount),
    tenure_months: row.tenure_months,
    annual_interest_rate: parseFloat(row.annual_interest_rate),
    calculated_emi: row.calculated_emi ? parseFloat(row.calculated_emi) : null,
    decision: row.decision,
    rejection_reason: row.rejection_reason,
    submitted_at: row.submitted_at,
  }));

  return {
    data,
    total,
    page: validatedPage,
    page_size: LOANS_PAGE_SIZE,
  };
}
