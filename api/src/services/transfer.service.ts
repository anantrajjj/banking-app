/**
 * Transfer Service — fund transfers, beneficiary management.
 *
 * Implements Requirements 5.1–5.7, 6.1–6.5, 15.1–15.5.
 *
 * All DB queries use parameterised statements via query() from ../db/index.
 */

import { getPool } from '../db/index';
import { query } from '../db/index';
import { logger } from '../utils/logger';
import { recordFundTransferCompletion } from '../utils/metrics';
import { ServiceError } from './account.service';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class TransferError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    public detail?: Record<string, unknown> | string,
  ) {
    super(typeof detail === 'string' ? detail : code);
    this.name = 'TransferError';
  }
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  user_id: string;
  customer_id: string;
  available_balance: string;
  account_number: string;
  currency: string;
  is_active: boolean;
}

interface TransferRow {
  id: string;
  customer_id: string;
  source_account_id: string;
  dest_account_id: string;
  amount: string;
  currency: string;
  transfer_mode: 'NEFT' | 'IMPS';
  idempotency_key: string;
  status: 'COMPLETED' | 'FAILED' | 'PENDING';
  created_at: Date;
}

interface BeneficiaryRow {
  id: string;
  owner_user_id: string;
  account_number: string;
  ifsc_code: string;
  name: string;
  bank_name: string | null;
  status: 'PENDING' | 'VERIFIED' | 'DELETED';
  verified_by: string | null;
  verified_at: Date | null;
  daily_limit: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// createTransfer (Req 5.1–5.7, 15.1–15.5)
// ---------------------------------------------------------------------------

export async function createTransfer(
  customerId: string,
  sourceAccountId: string,
  destAccountId: string,
  amount: number,
  transferMode: string,
  idempotencyKey: string,
  narration?: string,
): Promise<TransferRow> {
  // Validate amount (Req 15.1)
  if (!amount || amount <= 0) {
    throw new TransferError(400, 'INVALID_AMOUNT');
  }

  // Validate transfer mode (Req 5.7)
  if (transferMode !== 'NEFT' && transferMode !== 'IMPS') {
    throw new TransferError(400, 'INVALID_TRANSFER_MODE');
  }

  // Idempotency check — read outside transaction is safe as a pre-check (Req 5.5)
  const idempotentResult = await query<TransferRow>(
    'SELECT * FROM transfers WHERE idempotency_key = $1',
    [idempotencyKey],
  );
  const existing = idempotentResult.rows[0];
  if (existing) {
    return existing;
  }

  // Begin DB transaction — all remaining operations are atomic (Req 5.3, 5.4)
  const pool = await getPool();
  const client = await pool.connect();

  // Track whether we already explicitly rolled back to avoid double-rollback
  let rolledBack = false;

  try {
    await client.query('BEGIN');

    // ── Step 1: Lock both account rows with SELECT … FOR UPDATE ────────────
    // Ordering by id (lexicographic) prevents deadlocks when two concurrent
    // transfers involve the same pair of accounts in opposite directions.
    const [firstId, secondId] =
      sourceAccountId < destAccountId
        ? [sourceAccountId, destAccountId]
        : [destAccountId, sourceAccountId];

    const lockResult = await client.query<AccountRow>(
      `SELECT id, user_id, available_balance, account_number, currency, is_active
       FROM accounts
       WHERE id IN ($1, $2)
       ORDER BY id
       FOR UPDATE`,
      [firstId, secondId],
    );

    const lockedRows = lockResult.rows;
    const sourceAccount = lockedRows.find((r) => r.id === sourceAccountId);
    const destAccount = lockedRows.find((r) => r.id === destAccountId);

    // Verify source account belongs to customer and is active (Req 5.1)
    if (!sourceAccount || !sourceAccount.is_active || sourceAccount.user_id !== customerId) {
      await client.query('ROLLBACK');
      rolledBack = true;
      throw new TransferError(403, 'SOURCE_ACCOUNT_NOT_FOUND');
    }

    // Verify destination account exists and is active
    if (!destAccount || !destAccount.is_active) {
      await client.query('ROLLBACK');
      rolledBack = true;
      throw new TransferError(404, 'DEST_ACCOUNT_NOT_FOUND');
    }

    // Check sufficient balance on locked row (Req 5.2)
    const availableBalance = parseFloat(sourceAccount.available_balance);
    if (availableBalance < amount) {
      await client.query('ROLLBACK');
      rolledBack = true;
      throw new TransferError(422, 'INSUFFICIENT_FUNDS', {
        available_balance: availableBalance,
      });
    }

    // ── Step 2: UPDATE source balance (debit) ──────────────────────────────
    await client.query(
      `UPDATE accounts
       SET available_balance = available_balance - $1,
           updated_at = NOW()
       WHERE id = $2`,
      [amount, sourceAccountId],
    );

    // Compute source running balance after debit
    const sourceBalanceResult = await client.query<{ available_balance: string }>(
      'SELECT available_balance FROM accounts WHERE id = $1',
      [sourceAccountId],
    );
    const sourceRunningBalance = parseFloat(
      sourceBalanceResult.rows[0]?.available_balance ?? '0',
    );

    // ── Step 3: INSERT transfers record first to obtain DB-generated UUID ──
    // The transfers.id (gen_random_uuid()) becomes the shared transfer_ref_id
    // for both ledger entries, ensuring traceable pairing (Req 15.3, 15.4, 15.5).
    const transferInsertResult = await client.query<TransferRow>(
      `INSERT INTO transfers
         (customer_id, source_account_id, dest_account_id, amount, transfer_mode, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        customerId,
        sourceAccountId,
        destAccountId,
        amount,
        transferMode,
        idempotencyKey,
      ],
    );

    const transferRecord = transferInsertResult.rows[0];
    if (!transferRecord) {
      throw new TransferError(500, 'TRANSFER_CREATION_FAILED');
    }

    // DB-generated monotonic UUID used as shared transfer_ref_id (Req 15.3, 15.5)
    const transferRefId = transferRecord.id;

    // ── Step 4: INSERT DEBIT ledger entry with running balance ──────────────
    // DB-generated BIGSERIAL id provides monotonically increasing sequence (Req 15.5)
    await client.query(
      `INSERT INTO transactions
         (transfer_ref_id, account_id, entry_type, amount, running_balance, transfer_mode, narration)
       VALUES ($1, $2, 'DEBIT', $3, $4, $5, $6)`,
      [
        transferRefId,
        sourceAccountId,
        amount,
        sourceRunningBalance,
        transferMode,
        narration ?? null,
      ],
    );

    // ── Step 5: UPDATE dest balance (credit) ───────────────────────────────
    await client.query(
      `UPDATE accounts
       SET available_balance = available_balance + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [amount, destAccountId],
    );

    // Compute dest running balance after credit
    const destBalanceResult = await client.query<{ available_balance: string }>(
      'SELECT available_balance FROM accounts WHERE id = $1',
      [destAccountId],
    );
    const destRunningBalance = parseFloat(
      destBalanceResult.rows[0]?.available_balance ?? '0',
    );

    // ── Step 6: INSERT CREDIT ledger entry with running balance ─────────────
    await client.query(
      `INSERT INTO transactions
         (transfer_ref_id, account_id, entry_type, amount, running_balance, transfer_mode, narration)
       VALUES ($1, $2, 'CREDIT', $3, $4, $5, $6)`,
      [
        transferRefId,
        destAccountId,
        amount,
        destRunningBalance,
        transferMode,
        narration ?? null,
      ],
    );

    // ── Step 7: Ledger integrity check before COMMIT (Req 15.2) ────────────
    // Both entries were inserted with the same `amount` value. We verify the
    // persisted rows to guard against any unexpected mutation in the pipeline.
    const ledgerCheck = await client.query<{ entry_type: string; amount: string }>(
      `SELECT entry_type, amount
       FROM transactions
       WHERE transfer_ref_id = $1`,
      [transferRefId],
    );

    const debitEntry = ledgerCheck.rows.find((r) => r.entry_type === 'DEBIT');
    const creditEntry = ledgerCheck.rows.find((r) => r.entry_type === 'CREDIT');

    const debitAmount = debitEntry ? parseFloat(debitEntry.amount) : NaN;
    const creditAmount = creditEntry ? parseFloat(creditEntry.amount) : NaN;

    if (
      !debitEntry ||
      !creditEntry ||
      isNaN(debitAmount) ||
      isNaN(creditAmount) ||
      debitAmount !== creditAmount
    ) {
      await client.query('ROLLBACK');
      rolledBack = true;
      // HTTP 500 with LEDGER_INTEGRITY_ERROR as per Req 15.2
      throw new TransferError(500, 'LEDGER_INTEGRITY_ERROR');
    }

    // ── Step 8: COMMIT — all five writes succeed atomically ─────────────────
    await client.query('COMMIT');

    // Record CloudWatch metric (fire and forget, Req 13.5)
    recordFundTransferCompletion(amount, destAccount.currency).catch(() => undefined);

    logger.info('Transfer completed', {
      transferId: transferRecord.id,
      transferRefId,
      customerId,
      amount,
      transferMode,
    });

    return transferRecord;
  } catch (err) {
    // Rollback atomically on any error not already rolled back (Req 5.4)
    if (!rolledBack) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore secondary rollback errors
      }
    }

    if (err instanceof TransferError) {
      throw err;
    }

    logger.error('createTransfer DB error', { error: (err as Error).message });
    throw new TransferError(500, 'TRANSFER_FAILED', (err as Error).message);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// getTransfer
// ---------------------------------------------------------------------------

export async function getTransfer(
  transferId: string,
  customerId: string,
): Promise<TransferRow> {
  const result = await query<TransferRow>(
    'SELECT * FROM transfers WHERE id = $1 AND customer_id = $2',
    [transferId, customerId],
  );

  const transfer = result.rows[0];
  if (!transfer) {
    throw new ServiceError(404, 'TRANSFER_NOT_FOUND');
  }

  return transfer;
}

// ---------------------------------------------------------------------------
// addBeneficiary (Req 6.1, 6.5)
// ---------------------------------------------------------------------------

export async function addBeneficiary(
  ownerUserId: string,
  accountNumber: string,
  ifscCode: string,
  name: string,
  bankName?: string,
): Promise<BeneficiaryRow> {
  const result = await query<BeneficiaryRow>(
    `INSERT INTO beneficiaries
       (owner_user_id, account_number, ifsc_code, name, bank_name, status, daily_limit)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', 10000)
     RETURNING *`,
    [ownerUserId, accountNumber, ifscCode, name, bankName ?? null],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ServiceError(500, 'BENEFICIARY_CREATION_FAILED');
  }

  return row;
}

// ---------------------------------------------------------------------------
// verifyBeneficiary (Req 6.2)
// ---------------------------------------------------------------------------

export async function verifyBeneficiary(
  beneficiaryId: string,
  verifiedByUserId: string,
): Promise<BeneficiaryRow> {
  const result = await query<BeneficiaryRow>(
    `UPDATE beneficiaries
     SET status = 'VERIFIED',
         daily_limit = 100000,
         verified_by = $1,
         verified_at = NOW(),
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [verifiedByUserId, beneficiaryId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ServiceError(404, 'BENEFICIARY_NOT_FOUND');
  }

  return row;
}

// ---------------------------------------------------------------------------
// deleteBeneficiary (Req 6.4)
// ---------------------------------------------------------------------------

export async function deleteBeneficiary(
  beneficiaryId: string,
  ownerUserId: string,
): Promise<void> {
  const result = await query<BeneficiaryRow>(
    `UPDATE beneficiaries
     SET status = 'DELETED',
         deleted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND owner_user_id = $2
     RETURNING id`,
    [beneficiaryId, ownerUserId],
  );

  if (result.rowCount === 0) {
    throw new ServiceError(404, 'NOT_FOUND');
  }
}

// ---------------------------------------------------------------------------
// listBeneficiaries
// ---------------------------------------------------------------------------

export async function listBeneficiaries(
  ownerUserId: string,
  status?: string,
): Promise<BeneficiaryRow[]> {
  if (status) {
    const result = await query<BeneficiaryRow>(
      'SELECT * FROM beneficiaries WHERE owner_user_id = $1 AND status = $2',
      [ownerUserId, status],
    );
    return result.rows;
  }

  const result = await query<BeneficiaryRow>(
    'SELECT * FROM beneficiaries WHERE owner_user_id = $1',
    [ownerUserId],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// checkDailyLimit (Req 6.3)
// ---------------------------------------------------------------------------

export async function checkDailyLimit(
  beneficiaryId: string,
  amount: number,
): Promise<void> {
  // Get beneficiary
  const beneResult = await query<{
    daily_limit: string;
    account_number: string;
  }>(
    'SELECT daily_limit, account_number FROM beneficiaries WHERE id = $1',
    [beneficiaryId],
  );

  const beneficiary = beneResult.rows[0];
  if (!beneficiary) {
    throw new ServiceError(404, 'BENEFICIARY_NOT_FOUND');
  }

  const dailyLimit = parseFloat(beneficiary.daily_limit);

  // Sum today's transfers to that beneficiary account_number
  const sumResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(t.amount), 0) AS total
     FROM transfers t
     JOIN accounts a ON t.dest_account_id = a.id
     WHERE a.account_number = $1
       AND t.created_at >= CURRENT_DATE
       AND t.created_at < CURRENT_DATE + INTERVAL '1 day'
       AND t.status = 'COMPLETED'`,
    [beneficiary.account_number],
  );

  const transferredToday = parseFloat(sumResult.rows[0]?.total ?? '0');

  if (transferredToday + amount > dailyLimit) {
    throw new TransferError(422, 'DAILY_LIMIT_EXCEEDED', {
      limit: dailyLimit,
      transferred_today: transferredToday,
    });
  }
}
