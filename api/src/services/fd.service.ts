/**
 * Fixed Deposit Service
 *
 * Interest rate slabs (quarterly compounding, similar to SBI rates):
 *   < 6 months  → 5.50 %
 *   6–11 months → 6.25 %
 *   12–23 months→ 6.80 %
 *   24–35 months→ 7.00 %
 *   36–59 months→ 7.25 %
 *   ≥ 60 months → 7.50 %
 *
 * Compound interest formula (quarterly, n=4):
 *   A = P × (1 + r/4)^(4 × t)   where t = tenure_months / 12
 *
 * Premature closure penalty: 1 % deducted from the applicable rate,
 * applied to the actual months held.
 */

import { randomUUID } from 'crypto';
import { getPool, query } from '../db/index';
import { ServiceError } from './account.service';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Interest rate slabs
// ---------------------------------------------------------------------------

const RATE_SLABS: Array<{ minMonths: number; rate: number }> = [
  { minMonths: 60, rate: 7.50 },
  { minMonths: 36, rate: 7.25 },
  { minMonths: 24, rate: 7.00 },
  { minMonths: 12, rate: 6.80 },
  { minMonths: 6,  rate: 6.25 },
  { minMonths: 1,  rate: 5.50 },
];

export const TENURE_OPTIONS = [
  { months: 3,  label: '3 months' },
  { months: 6,  label: '6 months' },
  { months: 12, label: '1 year'   },
  { months: 24, label: '2 years'  },
  { months: 36, label: '3 years'  },
  { months: 60, label: '5 years'  },
];

export function getInterestRate(tenureMonths: number): number {
  for (const slab of RATE_SLABS) {
    if (tenureMonths >= slab.minMonths) return slab.rate;
  }
  return RATE_SLABS[RATE_SLABS.length - 1].rate;
}

// ---------------------------------------------------------------------------
// Compound interest calculator
// ---------------------------------------------------------------------------

export function calculateMaturity(
  principal: number,
  annualRatePct: number,
  tenureMonths: number,
): { maturityAmount: number; interestEarned: number } {
  const r = annualRatePct / 100;
  const n = 4; // quarterly
  const t = tenureMonths / 12;
  const maturityAmount = parseFloat((principal * Math.pow(1 + r / n, n * t)).toFixed(2));
  const interestEarned = parseFloat((maturityAmount - principal).toFixed(2));
  return { maturityAmount, interestEarned };
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface FDRow {
  id: string;
  fd_account_id: string;
  source_account_id: string;
  customer_id: string;
  principal: string;
  interest_rate: string;
  tenure_months: number;
  compounding: string;
  status: 'ACTIVE' | 'MATURED' | 'CLOSED';
  maturity_date: Date;
  maturity_amount: string;
  interest_earned: string;
  premature_closed_at: Date | null;
  penalty_rate: string | null;
  penalty_amount: string | null;
  actual_payout: string | null;
  created_at: Date;
  fd_account_number: string;
}

export interface FDSummary {
  id: string;
  fd_account_id: string;
  source_account_id: string;
  principal: number;
  interest_rate: number;
  tenure_months: number;
  status: 'ACTIVE' | 'MATURED' | 'CLOSED';
  maturity_date: string;
  maturity_amount: number;
  interest_earned: number;
  days_remaining: number;
  progress_pct: number;
  premature_closed_at: string | null;
  penalty_amount: number | null;
  actual_payout: number | null;
  created_at: string;
  fd_account_number: string;
}

// ---------------------------------------------------------------------------
// Helper: compute days_remaining and progress_pct
// ---------------------------------------------------------------------------

function enrichFD(row: FDRow): FDSummary {
  const now = Date.now();
  const start = row.created_at.getTime();
  const end = row.maturity_date.getTime();
  const totalDays = Math.max(1, Math.round((end - start) / 86_400_000));
  const elapsed   = Math.round((now - start) / 86_400_000);
  const daysRemaining = Math.max(0, Math.round((end - now) / 86_400_000));
  const progress_pct   = Math.min(100, Math.round((elapsed / totalDays) * 100));

  return {
    id: row.id,
    fd_account_id: row.fd_account_id,
    source_account_id: row.source_account_id,
    principal: parseFloat(row.principal),
    interest_rate: parseFloat(row.interest_rate),
    tenure_months: row.tenure_months,
    status: row.status,
    maturity_date: row.maturity_date.toISOString(),
    maturity_amount: parseFloat(row.maturity_amount),
    interest_earned: parseFloat(row.interest_earned),
    days_remaining: daysRemaining,
    progress_pct,
    premature_closed_at: row.premature_closed_at ? row.premature_closed_at.toISOString() : null,
    penalty_amount: row.penalty_amount ? parseFloat(row.penalty_amount) : null,
    actual_payout: row.actual_payout ? parseFloat(row.actual_payout) : null,
    created_at: row.created_at.toISOString(),
    fd_account_number: row.fd_account_number,
  };
}

// ---------------------------------------------------------------------------
// openFD
// ---------------------------------------------------------------------------

export async function openFD(
  customerId: string,
  sourceAccountId: string,
  principal: number,
  tenureMonths: number,
): Promise<FDSummary> {
  if (principal < 1000) {
    throw new ServiceError(400, 'MIN_DEPOSIT', 'Minimum FD amount is ₹1,000');
  }
  if (!TENURE_OPTIONS.some((o) => o.months === tenureMonths)) {
    throw new ServiceError(400, 'INVALID_TENURE', 'Tenure must be 3, 6, 12, 24, 36, or 60 months');
  }

  const interestRate = getInterestRate(tenureMonths);
  const { maturityAmount, interestEarned } = calculateMaturity(principal, interestRate, tenureMonths);

  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify source account
    const acctRes = await client.query<{
      id: string; available_balance: string; account_type: string;
    }>(
      `SELECT id, available_balance, account_type
       FROM accounts
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE
       FOR UPDATE`,
      [sourceAccountId, customerId],
    );
    if (acctRes.rows.length === 0) {
      throw new ServiceError(404, 'ACCOUNT_NOT_FOUND', 'Source account not found');
    }
    const src = acctRes.rows[0];
    if (src.account_type === 'FD') {
      throw new ServiceError(400, 'INVALID_SOURCE', 'Cannot fund an FD from another FD account');
    }
    const balance = parseFloat(src.available_balance);
    if (balance < principal) {
      throw new ServiceError(400, 'INSUFFICIENT_FUNDS', `Insufficient balance. Available: ₹${balance.toLocaleString('en-IN')}`);
    }

    // 2. Debit source account
    await client.query(
      `UPDATE accounts
       SET available_balance = available_balance - $1, updated_at = NOW()
       WHERE id = $2`,
      [principal, sourceAccountId],
    );

    // 3. Create FD account record
    const fdAcctNum = `FD${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`;
    const maturityDate = new Date();
    maturityDate.setMonth(maturityDate.getMonth() + tenureMonths);

    const fdAcctRes = await client.query<{ id: string }>(
      `INSERT INTO accounts (user_id, account_number, account_type, available_balance, currency, is_active)
       VALUES ($1, $2, 'FD', $3, 'INR', TRUE)
       RETURNING id`,
      [customerId, fdAcctNum, principal],
    );
    const fdAccountId = fdAcctRes.rows[0].id;

    // 4. Create FD record
    const fdRes = await client.query<FDRow>(
      `INSERT INTO fixed_deposits
         (fd_account_id, source_account_id, customer_id, principal, interest_rate,
          tenure_months, maturity_date, maturity_amount, interest_earned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *, $10::text AS fd_account_number`,
      [fdAccountId, sourceAccountId, customerId, principal, interestRate,
       tenureMonths, maturityDate, maturityAmount, interestEarned, fdAcctNum],
    );

    // 5. Ledger entries
    const ref = randomUUID();
    const srcNewBal = balance - principal;

    await client.query(
      `INSERT INTO transactions
         (transfer_ref_id, account_id, entry_type, amount, running_balance, transfer_mode, narration)
       VALUES ($1, $2, 'DEBIT', $3, $4, 'INTERNAL', $5)`,
      [ref, sourceAccountId, principal, srcNewBal, `FD Opening – ${fdAcctNum}`],
    );
    await client.query(
      `INSERT INTO transactions
         (transfer_ref_id, account_id, entry_type, amount, running_balance, transfer_mode, narration)
       VALUES ($1, $2, 'CREDIT', $3, $4, 'INTERNAL', $5)`,
      [ref, fdAccountId, principal, principal, `FD Opening`],
    );

    await client.query('COMMIT');
    logger.info('FD opened', { customerId, fdAccountId, principal, tenureMonths });
    return enrichFD(fdRes.rows[0]);

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// listFDs
// ---------------------------------------------------------------------------

export async function listFDs(customerId: string): Promise<FDSummary[]> {
  const res = await query<FDRow>(
    `SELECT fd.*, a.account_number AS fd_account_number
     FROM fixed_deposits fd
     JOIN accounts a ON a.id = fd.fd_account_id
     WHERE fd.customer_id = $1
     ORDER BY fd.created_at DESC`,
    [customerId],
  );
  return res.rows.map(enrichFD);
}

// ---------------------------------------------------------------------------
// getFD
// ---------------------------------------------------------------------------

export async function getFD(fdId: string, customerId: string): Promise<FDSummary> {
  const res = await query<FDRow>(
    `SELECT fd.*, a.account_number AS fd_account_number
     FROM fixed_deposits fd
     JOIN accounts a ON a.id = fd.fd_account_id
     WHERE fd.id = $1 AND fd.customer_id = $2`,
    [fdId, customerId],
  );
  if (res.rows.length === 0) throw new ServiceError(404, 'NOT_FOUND', 'FD not found');
  return enrichFD(res.rows[0]);
}

// ---------------------------------------------------------------------------
// closeFDPrematurely
// ---------------------------------------------------------------------------

export async function closeFDPrematurely(
  fdId: string,
  customerId: string,
): Promise<{ payout: number; penalty: number; penaltyRate: number }> {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const fdRes = await client.query<FDRow>(
      `SELECT fd.*, a.account_number AS fd_account_number
       FROM fixed_deposits fd
       JOIN accounts a ON a.id = fd.fd_account_id
       WHERE fd.id = $1 AND fd.customer_id = $2 AND fd.status = 'ACTIVE'
       FOR UPDATE`,
      [fdId, customerId],
    );
    if (fdRes.rows.length === 0) {
      throw new ServiceError(404, 'NOT_FOUND', 'Active FD not found');
    }
    const fd = fdRes.rows[0];
    const principal = parseFloat(fd.principal);

    // Actual months held (floor)
    const now = new Date();
    const created = fd.created_at;
    const monthsHeld = Math.max(0,
      (now.getFullYear() - created.getFullYear()) * 12 +
      (now.getMonth() - created.getMonth()),
    );

    // Penalised rate = applicable rate for actual months held, minus 1 %
    const applicableRate = getInterestRate(Math.max(1, monthsHeld));
    const penaltyRate = 1.00;
    const penalisedRate = Math.max(0, applicableRate - penaltyRate);
    const { maturityAmount: penalisedAmount } = calculateMaturity(principal, penalisedRate, Math.max(1, monthsHeld));
    const actualPenalty = parseFloat((parseFloat(fd.interest_earned) - Math.max(0, penalisedAmount - principal)).toFixed(2));
    const payout    = parseFloat(penalisedAmount.toFixed(2));

    // Verify source account still active
    const srcRes = await client.query<{ available_balance: string }>(
      `SELECT available_balance FROM accounts WHERE id = $1 FOR UPDATE`,
      [fd.source_account_id],
    );
    if (srcRes.rows.length === 0) throw new ServiceError(404, 'SRC_NOT_FOUND', 'Source account not found');
    const srcBalance = parseFloat(srcRes.rows[0].available_balance);

    // Credit payout to source account
    await client.query(
      `UPDATE accounts SET available_balance = available_balance + $1, updated_at = NOW() WHERE id = $2`,
      [payout, fd.source_account_id],
    );

    // Deactivate FD account
    await client.query(
      `UPDATE accounts SET is_active = FALSE, available_balance = 0, updated_at = NOW() WHERE id = $1`,
      [fd.fd_account_id],
    );

    // Update FD record
    await client.query(
      `UPDATE fixed_deposits
       SET status = 'CLOSED', premature_closed_at = NOW(),
           penalty_rate = $1, penalty_amount = $2, actual_payout = $3, updated_at = NOW()
       WHERE id = $4`,
      [penaltyRate, actualPenalty < 0 ? 0 : actualPenalty, payout, fdId],
    );

    // Ledger entries
    const ref = randomUUID();
    await client.query(
      `INSERT INTO transactions (transfer_ref_id, account_id, entry_type, amount, running_balance, transfer_mode, narration)
       VALUES ($1, $2, 'DEBIT', $3, $4, 'INTERNAL', 'FD Premature Closure')`,
      [ref, fd.fd_account_id, payout, 0],
    );
    await client.query(
      `INSERT INTO transactions (transfer_ref_id, account_id, entry_type, amount, running_balance, transfer_mode, narration)
       VALUES ($1, $2, 'CREDIT', $3, $4, 'INTERNAL', 'FD Premature Closure Payout')`,
      [ref, fd.source_account_id, payout, srcBalance + payout],
    );

    await client.query('COMMIT');
    return { payout, penalty: actualPenalty < 0 ? 0 : actualPenalty, penaltyRate };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
