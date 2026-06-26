/**
 * Account Service — account summary and mini-statement.
 *
 * Implements Requirements 4.1–4.5.
 *
 * All DB queries use parameterised statements via query() from ../db/index.
 */

import { query } from '../db/index';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ServiceError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    public detail?: string,
    public retryAfter?: number,
  ) {
    super(detail ?? code);
    this.name = 'ServiceError';
  }
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  account_type: 'SAVINGS' | 'CURRENT' | 'FD';
  available_balance: string; // pg returns NUMERIC as string
  account_number: string;
  currency: string;
  user_id: string;
}

interface TransactionRow {
  id: string | number;
  entry_type: 'DEBIT' | 'CREDIT';
  amount: string;
  running_balance: string;
  transfer_mode: 'NEFT' | 'IMPS' | 'INTERNAL';
  narration: string | null;
  transaction_date: Date;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AccountSummary {
  account_id: string;
  account_type: 'SAVINGS' | 'CURRENT' | 'FD';
  masked_number: string;
  available_balance: number;
  currency: string;
}

export interface MiniStatementEntry {
  id: string | number;
  entry_type: 'DEBIT' | 'CREDIT';
  amount: number;
  running_balance: number;
  transfer_mode: 'NEFT' | 'IMPS' | 'INTERNAL';
  narration: string | null;
  transaction_date: Date;
}

// ---------------------------------------------------------------------------
// getAccountSummary (Req 4.1, 4.3–4.5)
// ---------------------------------------------------------------------------

export async function getAccountSummary(userId: string): Promise<AccountSummary[]> {
  try {
    const result = await query<AccountRow>(
      `SELECT id, account_type, available_balance, account_number, currency
       FROM accounts
       WHERE user_id = $1 AND is_active = true`,
      [userId],
    );

    return result.rows.map((row) => ({
      account_id: row.id,
      account_type: row.account_type,
      masked_number: '****' + row.account_number.slice(-4),
      available_balance: parseFloat(row.available_balance),
      currency: row.currency,
    }));
  } catch (err) {
    logger.error('getAccountSummary DB error', {
      userId,
      error: (err as Error).message,
    });
    const svcErr = new ServiceError(503, 'DB_UNAVAILABLE', 'Database temporarily unavailable', 30);
    (svcErr as ServiceError & { retry_after: number }).retry_after = 30;
    throw svcErr;
  }
}

// ---------------------------------------------------------------------------
// getMiniStatement (Req 4.2–4.5)
// ---------------------------------------------------------------------------

export async function getMiniStatement(
  accountId: string,
  userId: string,
): Promise<MiniStatementEntry[]> {
  // Verify account ownership
  let ownerRow: { user_id: string } | undefined;
  try {
    const ownerResult = await query<{ user_id: string }>(
      'SELECT user_id FROM accounts WHERE id = $1',
      [accountId],
    );
    ownerRow = ownerResult.rows[0];
  } catch (err) {
    logger.error('getMiniStatement ownership check DB error', {
      accountId,
      error: (err as Error).message,
    });
    throw new ServiceError(503, 'DB_UNAVAILABLE', 'Database temporarily unavailable', 30);
  }

  if (!ownerRow) {
    throw new ServiceError(404, 'ACCOUNT_NOT_FOUND');
  }

  if (ownerRow.user_id !== userId) {
    throw new ServiceError(403, 'FORBIDDEN');
  }

  // Fetch last 10 transactions
  try {
    const result = await query<TransactionRow>(
      `SELECT id, entry_type, amount, running_balance, transfer_mode, narration, transaction_date
       FROM transactions
       WHERE account_id = $1
       ORDER BY transaction_date DESC
       LIMIT 10`,
      [accountId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      entry_type: row.entry_type,
      amount: parseFloat(row.amount),
      running_balance: parseFloat(row.running_balance),
      transfer_mode: row.transfer_mode,
      narration: row.narration,
      transaction_date: row.transaction_date,
    }));
  } catch (err) {
    logger.error('getMiniStatement transactions DB error', {
      accountId,
      error: (err as Error).message,
    });
    throw new ServiceError(503, 'DB_UNAVAILABLE', 'Database temporarily unavailable', 30);
  }
}
