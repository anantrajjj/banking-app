/**
 * Notification Service — derive in-app notifications from existing DB activity.
 *
 * No dedicated notifications table: notifications are computed on-demand from:
 *   • Large debits (> ₹10 000) in the past 7 days
 *   • Loan decisions (APPROVED / REJECTED) in the past 30 days
 *   • Beneficiaries moved to VERIFIED in the past 7 days
 *   • Accounts with available_balance < ₹5 000
 *
 * Results are sorted newest-first and capped at 15 items.
 */

import { query } from '../db/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'LARGE_DEBIT'
  | 'LOAN_APPROVED'
  | 'LOAN_REJECTED'
  | 'BENEFICIARY_VERIFIED'
  | 'LOW_BALANCE';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// getNotifications
// ---------------------------------------------------------------------------

export async function getNotifications(userId: string): Promise<Notification[]> {
  const notifications: Notification[] = [];

  // ── Large debits ─────────────────────────────────────────────────────────
  interface DebitRow {
    id: string | number;
    amount: string;
    narration: string | null;
    transaction_date: Date;
    account_number: string;
  }

  const debitResult = await query<DebitRow>(
    `SELECT t.id, t.amount, t.narration, t.transaction_date, a.account_number
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE a.user_id = $1
       AND t.entry_type = 'DEBIT'
       AND t.amount > 10000
       AND t.transaction_date >= NOW() - INTERVAL '7 days'
     ORDER BY t.transaction_date DESC
     LIMIT 5`,
    [userId],
  );

  for (const row of debitResult.rows) {
    const amount = parseFloat(row.amount);
    const masked = `****${row.account_number.slice(-4)}`;
    notifications.push({
      id: `debit-${row.id}`,
      type: 'LARGE_DEBIT',
      title: 'Large debit alert',
      message: `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} debited from ${masked}${row.narration ? ` — ${row.narration}` : ''}`,
      created_at: (row.transaction_date as Date).toISOString(),
    });
  }

  // ── Loan decisions ────────────────────────────────────────────────────────
  interface LoanRow {
    id: string;
    loan_amount: string;
    decision: 'APPROVED' | 'REJECTED';
    rejection_reason: string | null;
    submitted_at: Date;
  }

  const loanResult = await query<LoanRow>(
    `SELECT id, loan_amount, decision, rejection_reason, submitted_at
     FROM loan_applications
     WHERE customer_id = $1
       AND decision != 'PENDING'
       AND submitted_at >= NOW() - INTERVAL '30 days'
     ORDER BY submitted_at DESC
     LIMIT 5`,
    [userId],
  );

  for (const row of loanResult.rows) {
    const amount = parseFloat(row.loan_amount);
    const approved = row.decision === 'APPROVED';
    notifications.push({
      id: `loan-${row.id}`,
      type: approved ? 'LOAN_APPROVED' : 'LOAN_REJECTED',
      title: approved ? 'Loan application approved' : 'Loan application rejected',
      message: approved
        ? `Your loan of ₹${amount.toLocaleString('en-IN')} has been approved.`
        : `Your loan of ₹${amount.toLocaleString('en-IN')} was rejected${row.rejection_reason ? ': ' + row.rejection_reason : ''}.`,
      created_at: (row.submitted_at as Date).toISOString(),
    });
  }

  // ── Verified beneficiaries ────────────────────────────────────────────────
  interface BeneRow {
    id: string;
    name: string;
    verified_at: Date;
  }

  const beneResult = await query<BeneRow>(
    `SELECT id, name, verified_at
     FROM beneficiaries
     WHERE owner_user_id = $1
       AND status = 'VERIFIED'
       AND verified_at IS NOT NULL
       AND verified_at >= NOW() - INTERVAL '7 days'
     ORDER BY verified_at DESC
     LIMIT 3`,
    [userId],
  );

  for (const row of beneResult.rows) {
    notifications.push({
      id: `bene-${row.id}`,
      type: 'BENEFICIARY_VERIFIED',
      title: 'Beneficiary verified',
      message: `${row.name} is now verified and ready for transfers.`,
      created_at: (row.verified_at as Date).toISOString(),
    });
  }

  // ── Low balance accounts ──────────────────────────────────────────────────
  interface BalanceRow {
    id: string;
    account_number: string;
    available_balance: string;
  }

  const balanceResult = await query<BalanceRow>(
    `SELECT id, account_number, available_balance
     FROM accounts
     WHERE user_id = $1
       AND available_balance < 5000
       AND is_active = TRUE`,
    [userId],
  );

  for (const row of balanceResult.rows) {
    const balance = parseFloat(row.available_balance);
    const masked = `****${row.account_number.slice(-4)}`;
    notifications.push({
      id: `balance-${row.id}`,
      type: 'LOW_BALANCE',
      title: 'Low balance alert',
      message: `Account ${masked} balance is ₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`,
      created_at: new Date().toISOString(),
    });
  }

  // Sort newest first, cap at 15
  notifications.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return notifications.slice(0, 15);
}
