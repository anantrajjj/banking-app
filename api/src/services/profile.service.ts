/**
 * Profile Service — read and update the authenticated user's own profile.
 *
 * Exported functions:
 *   getProfile       — return non-sensitive user fields
 *   changePassword   — verify current password then re-hash the new one
 *   updateOtpChannel — switch preferred MFA delivery channel
 */

import bcrypt from 'bcrypt';
import { query } from '../db/index';
import { ServiceError } from './account.service';

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  phone: string;
  role: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';
  otp_channel: 'EMAIL' | 'SMS';
  created_at: string;
}

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

export async function getProfile(userId: string): Promise<UserProfile> {
  const result = await query<UserProfile>(
    `SELECT id, username, email, phone, role, otp_channel, created_at
     FROM users
     WHERE id = $1`,
    [userId],
  );
  if (result.rows.length === 0) {
    throw new ServiceError(404, 'NOT_FOUND', 'User not found');
  }
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const result = await query<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId],
  );
  if (result.rows.length === 0) {
    throw new ServiceError(404, 'NOT_FOUND', 'User not found');
  }

  const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!valid) {
    throw new ServiceError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  if (newPassword.length < 8) {
    throw new ServiceError(400, 'WEAK_PASSWORD', 'New password must be at least 8 characters');
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [hash, userId],
  );
}

// ---------------------------------------------------------------------------
// updateOtpChannel
// ---------------------------------------------------------------------------

export async function updateOtpChannel(
  userId: string,
  channel: 'EMAIL' | 'SMS',
): Promise<void> {
  await query(
    `UPDATE users SET otp_channel = $1, updated_at = NOW() WHERE id = $2`,
    [channel, userId],
  );
}
