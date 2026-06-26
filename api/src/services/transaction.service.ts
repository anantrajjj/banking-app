/**
 * Transaction Service — transaction history and CSV export.
 *
 * Implements Requirements 7.1–7.8.
 *
 * All DB queries use parameterised statements via query() from ../db/index.
 */

import { query } from '../db/index';
import { logger } from '../utils/logger';
import { ServiceError } from './account.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionFilters {
  start_date?: string;
  end_date?: string;
  min_amount?: number;
  max_amount?: number;
  type?: 'DEBIT' | 'CREDIT';
}

export interface Transaction {
  id: string | number;
  entry_type: 'DEBIT' | 'CREDIT';
  amount: number;
  running_balance: number;
  transfer_mode: 'NEFT' | 'IMPS' | 'INTERNAL';
  narration: string | null;
  transaction_date: Date;
}

export interface TransactionHistoryResult {
  data: Transaction[];
  total: number;
  page: number;
  page_size: number;
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
// Helpers
// ---------------------------------------------------------------------------

const VALID_PAGE_SIZES = new Set([10, 25, 50]);

async function verifyAccountOwnership(accountId: string, userId: string): Promise<void> {
  let ownerRow: { user_id: string } | undefined;

  try {
    const result = await query<{ user_id: string }>(
      'SELECT user_id FROM accounts WHERE id = $1',
      [accountId],
    );
    ownerRow = result.rows[0];
  } catch (err) {
    logger.error('Transaction ownership check DB error', {
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
}

// ---------------------------------------------------------------------------
// getTransactionHistory (Req 7.1–7.5, 7.7–7.8)
// ---------------------------------------------------------------------------

export async function getTransactionHistory(
  accountId: string,
  userId: string,
  filters: TransactionFilters,
  page: number,
  pageSize: number,
): Promise<TransactionHistoryResult> {
  await verifyAccountOwnership(accountId, userId);

  // Validate / normalise page size
  const validatedPageSize = VALID_PAGE_SIZES.has(pageSize) ? pageSize : 25;
  const validatedPage = page > 0 ? page : 1;
  const offset = (validatedPage - 1) * validatedPageSize;

  // Build parameterised WHERE clauses
  const params: (string | number | Date)[] = [accountId];
  const whereClauses: string[] = ['account_id = $1'];

  let paramIdx = 2;

  if (filters.start_date) {
    whereClauses.push(`transaction_date >= $${paramIdx}`);
    params.push(filters.start_date);
    paramIdx++;
  }

  if (filters.end_date) {
    // end_date inclusive: add 1 day to cover the full end day
    whereClauses.push(`transaction_date < $${paramIdx}::date + INTERVAL '1 day'`);
    params.push(filters.end_date);
    paramIdx++;
  }

  if (filters.min_amount !== undefined) {
    whereClauses.push(`amount >= $${paramIdx}`);
    params.push(filters.min_amount);
    paramIdx++;
  }

  if (filters.max_amount !== undefined) {
    whereClauses.push(`amount <= $${paramIdx}`);
    params.push(filters.max_amount);
    paramIdx++;
  }

  if (filters.type) {
    whereClauses.push(`entry_type = $${paramIdx}`);
    params.push(filters.type);
    paramIdx++;
  }

  const whereClause = whereClauses.join(' AND ');

  // Count query
  const countParams = [...params];
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM transactions WHERE ${whereClause}`,
    countParams,
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  // Data query
  const dataParams = [...params, validatedPageSize, offset];
  const dataResult = await query<TransactionRow>(
    `SELECT id, entry_type, amount, running_balance, transfer_mode, narration, transaction_date
     FROM transactions
     WHERE ${whereClause}
     ORDER BY transaction_date DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    dataParams,
  );

  const data: Transaction[] = dataResult.rows.map((row) => ({
    id: row.id,
    entry_type: row.entry_type,
    amount: parseFloat(row.amount),
    running_balance: parseFloat(row.running_balance),
    transfer_mode: row.transfer_mode,
    narration: row.narration,
    transaction_date: row.transaction_date,
  }));

  return {
    data,
    total,
    page: validatedPage,
    page_size: validatedPageSize,
  };
}

// ---------------------------------------------------------------------------
// exportCsvStatement (Req 7.6–7.8)
// ---------------------------------------------------------------------------

export async function exportCsvStatement(
  accountId: string,
  userId: string,
  startDate?: string,
  endDate?: string,
): Promise<{ csv: string; filename: string }> {
  await verifyAccountOwnership(accountId, userId);

  // Fetch the account number for filename generation
  const accountResult = await query<{ account_number: string }>(
    'SELECT account_number FROM accounts WHERE id = $1',
    [accountId],
  );
  const accountNumber = accountResult.rows[0]?.account_number ?? accountId;
  const last4 = accountNumber.slice(-4);

  // Build parameterised query with optional date filters
  const params: (string | number)[] = [accountId];
  const whereClauses: string[] = ['account_id = $1'];
  let paramIdx = 2;

  if (startDate) {
    whereClauses.push(`transaction_date >= $${paramIdx}`);
    params.push(startDate);
    paramIdx++;
  }

  if (endDate) {
    whereClauses.push(`transaction_date < $${paramIdx}::date + INTERVAL '1 day'`);
    params.push(endDate);
    paramIdx++;
  }

  const whereClause = whereClauses.join(' AND ');

  const result = await query<TransactionRow>(
    `SELECT id, entry_type, amount, running_balance, transfer_mode, narration, transaction_date
     FROM transactions
     WHERE ${whereClause}
     ORDER BY transaction_date DESC`,
    params,
  );

  // Build CSV
  const csvHeader = 'id,entry_type,amount,running_balance,transfer_mode,narration,transaction_date';
  const csvRows = result.rows.map((row) => {
    const narration = row.narration
      ? `"${row.narration.replace(/"/g, '""')}"`
      : '';
    return [
      row.id,
      row.entry_type,
      row.amount,
      row.running_balance,
      row.transfer_mode,
      narration,
      row.transaction_date instanceof Date
        ? row.transaction_date.toISOString()
        : String(row.transaction_date),
    ].join(',');
  });

  const csv = [csvHeader, ...csvRows].join('\n');

  // Filename: ACC{last4}_{start}_{end}.csv
  const startStr = startDate ?? 'all';
  const endStr = endDate ?? 'now';
  const filename = `ACC${last4}_${startStr}_${endStr}.csv`;

  return { csv, filename };
}
