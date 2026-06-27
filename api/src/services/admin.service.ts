/**
 * Admin Service — operations restricted to BRANCH_MANAGER and ADMIN roles.
 *
 * Exported functions:
 *   getDashboardStats       — aggregate counts across all entities
 *   listUsers               — paginated user list with optional search / role filter  (ADMIN)
 *   toggleUserLock          — lock or unlock a user account                           (ADMIN)
 *   listAllAccounts         — paginated account list with optional owner filter        (BRANCH_MANAGER+)
 *   listAllLoans            — paginated loan applications with optional decision filter(BRANCH_MANAGER+)
 *   listPendingBeneficiaries— beneficiaries awaiting branch-manager verification      (BRANCH_MANAGER+)
 */

import { query } from '../db/index';
import { ServiceError } from './account.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminStats {
  total_users: number;
  active_accounts: number;
  pending_loans: number;
  pending_beneficiaries: number;
  transactions_today: number;
  locked_users: number;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  phone: string;
  role: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';
  is_locked: boolean;
  locked_reason: string | null;
  failed_attempts: number;
  created_at: string;
}

export interface AdminAccount {
  account_id: string;
  account_number: string;
  account_type: 'SAVINGS' | 'CURRENT' | 'FD';
  available_balance: number;
  currency: string;
  is_active: boolean;
  username: string;
  email: string;
}

export interface AdminLoan {
  id: string;
  customer_id: string;
  username: string;
  loan_amount: number;
  tenure_months: number;
  annual_interest_rate: number;
  calculated_emi: number | null;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING';
  rejection_reason: string | null;
  submitted_at: string;
}

export interface AdminBeneficiary {
  id: string;
  owner_user_id: string;
  owner_username: string;
  account_number: string;
  ifsc_code: string;
  name: string;
  bank_name: string | null;
  status: 'PENDING' | 'VERIFIED' | 'DELETED';
  daily_limit: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// getDashboardStats
// ---------------------------------------------------------------------------

export async function getDashboardStats(): Promise<AdminStats> {
  const [users, accounts, loans, benes, txns, locked] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM users`, []),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM accounts WHERE is_active = TRUE`, []),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM loan_applications WHERE decision = 'PENDING'`, []),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM beneficiaries WHERE status = 'PENDING'`, []),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM transactions WHERE transaction_date >= CURRENT_DATE`, []),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM users WHERE is_locked = TRUE`, []),
  ]);

  return {
    total_users: parseInt(users.rows[0].count, 10),
    active_accounts: parseInt(accounts.rows[0].count, 10),
    pending_loans: parseInt(loans.rows[0].count, 10),
    pending_beneficiaries: parseInt(benes.rows[0].count, 10),
    transactions_today: parseInt(txns.rows[0].count, 10),
    locked_users: parseInt(locked.rows[0].count, 10),
  };
}

// ---------------------------------------------------------------------------
// listUsers
// ---------------------------------------------------------------------------

export async function listUsers(
  page: number,
  pageSize: number,
  search?: string,
  roleFilter?: string,
): Promise<{ data: AdminUser[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let pi = 1;

  if (search) {
    conditions.push(`(username ILIKE $${pi} OR email ILIKE $${pi})`);
    params.push(`%${search}%`);
    pi++;
  }
  if (roleFilter && ['CUSTOMER', 'BRANCH_MANAGER', 'ADMIN'].includes(roleFilter)) {
    conditions.push(`role = $${pi}`);
    params.push(roleFilter);
    pi++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const rawRows = await query<AdminUser>(
    `SELECT id, username, email, phone, role, is_locked, locked_reason, failed_attempts, created_at
     FROM users ${where}
     ORDER BY created_at DESC
     LIMIT $${pi} OFFSET $${pi + 1}`,
    [...params, pageSize, offset],
  );

  return { data: rawRows.rows, total };
}

// ---------------------------------------------------------------------------
// toggleUserLock
// ---------------------------------------------------------------------------

export async function toggleUserLock(
  targetUserId: string,
  lock: boolean,
  reason: string | undefined,
  adminId: string,
): Promise<void> {
  // Prevent self-lock
  if (targetUserId === adminId) {
    throw new ServiceError(400, 'SELF_LOCK_FORBIDDEN', 'Admins cannot lock their own account');
  }

  const exists = await query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1`,
    [targetUserId],
  );
  if (exists.rows.length === 0) {
    throw new ServiceError(404, 'NOT_FOUND', 'User not found');
  }

  await query(
    `UPDATE users
     SET is_locked = $1,
         locked_reason = $2,
         failed_attempts = CASE WHEN $1 = FALSE THEN 0 ELSE failed_attempts END,
         updated_at = NOW()
     WHERE id = $3`,
    [lock, lock ? (reason ?? 'Locked by admin') : null, targetUserId],
  );
}

// ---------------------------------------------------------------------------
// listAllAccounts
// ---------------------------------------------------------------------------

export async function listAllAccounts(
  page: number,
  pageSize: number,
  userId?: string,
): Promise<{ data: AdminAccount[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const where = userId ? `WHERE a.user_id = $1` : '';
  const params: unknown[] = userId ? [userId] : [];
  const pi = params.length + 1;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM accounts a ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  interface RawAccount {
    account_id: string;
    account_number: string;
    account_type: 'SAVINGS' | 'CURRENT' | 'FD';
    available_balance: string;
    currency: string;
    is_active: boolean;
    username: string;
    email: string;
  }

  const rawRows = await query<RawAccount>(
    `SELECT a.id AS account_id, a.account_number, a.account_type,
            a.available_balance, a.currency, a.is_active,
            u.username, u.email
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${pi} OFFSET $${pi + 1}`,
    [...params, pageSize, offset],
  );

  return {
    data: rawRows.rows.map((r) => ({
      ...r,
      available_balance: parseFloat(r.available_balance),
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// listAllLoans
// ---------------------------------------------------------------------------

export async function listAllLoans(
  page: number,
  pageSize: number,
  decision?: string,
): Promise<{ data: AdminLoan[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const validDecisions = ['APPROVED', 'REJECTED', 'PENDING'];
  const where =
    decision && validDecisions.includes(decision)
      ? `WHERE la.decision = $1`
      : '';
  const params: unknown[] = where ? [decision] : [];
  const pi = params.length + 1;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM loan_applications la ${where}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  interface RawLoan {
    id: string;
    customer_id: string;
    username: string;
    loan_amount: string;
    tenure_months: number;
    annual_interest_rate: string;
    calculated_emi: string | null;
    decision: 'APPROVED' | 'REJECTED' | 'PENDING';
    rejection_reason: string | null;
    submitted_at: string;
  }

  const rawRows = await query<RawLoan>(
    `SELECT la.id, la.customer_id, u.username,
            la.loan_amount, la.tenure_months, la.annual_interest_rate,
            la.calculated_emi, la.decision, la.rejection_reason, la.submitted_at
     FROM loan_applications la
     JOIN users u ON u.id = la.customer_id
     ${where}
     ORDER BY la.submitted_at DESC
     LIMIT $${pi} OFFSET $${pi + 1}`,
    [...params, pageSize, offset],
  );

  return {
    data: rawRows.rows.map((r) => ({
      ...r,
      loan_amount: parseFloat(r.loan_amount),
      annual_interest_rate: parseFloat(r.annual_interest_rate),
      calculated_emi: r.calculated_emi !== null ? parseFloat(r.calculated_emi) : null,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// listPendingBeneficiaries
// ---------------------------------------------------------------------------

export async function listPendingBeneficiaries(
  page: number,
  pageSize: number,
): Promise<{ data: AdminBeneficiary[]; total: number }> {
  const offset = (page - 1) * pageSize;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM beneficiaries WHERE status = 'PENDING'`,
    [],
  );
  const total = parseInt(countResult.rows[0].count, 10);

  interface RawBene {
    id: string;
    owner_user_id: string;
    owner_username: string;
    account_number: string;
    ifsc_code: string;
    name: string;
    bank_name: string | null;
    status: 'PENDING' | 'VERIFIED' | 'DELETED';
    daily_limit: string;
    created_at: string;
  }

  const rawRows = await query<RawBene>(
    `SELECT b.id, b.owner_user_id, u.username AS owner_username,
            b.account_number, b.ifsc_code, b.name, b.bank_name,
            b.status, b.daily_limit, b.created_at
     FROM beneficiaries b
     JOIN users u ON u.id = b.owner_user_id
     WHERE b.status = 'PENDING'
     ORDER BY b.created_at ASC
     LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );

  return {
    data: rawRows.rows.map((r) => ({
      ...r,
      daily_limit: parseFloat(r.daily_limit),
    })),
    total,
  };
}
