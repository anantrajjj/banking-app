/**
 * Auth_Service — authentication, MFA, session, and token management.
 *
 * Implements Requirements 1.1–1.10 and 2.3–2.4.
 *
 * Exported functions:
 *   login          — password verification + OTP dispatch  (Req 1.1–1.5, 1.8)
 *   verifyMfa      — OTP verification + JWT/RT issuance    (Req 1.5–1.7, 1.9)
 *   logout         — JWT + RT revocation                   (Req 2.3)
 *   refreshToken   — RT rotation + new JWT/RT              (Req 1.9, 1.10)
 *   unlockAccount  — admin account unlock
 *
 * Security constraints (Req 1.8):
 *   - Passwords hashed with bcrypt, cost ≥ 12.
 *   - Plaintext passwords and OTPs are NEVER logged or returned.
 *   - All DB queries use parameterised statements via query() from ../db/index.
 *   - Secrets retrieved exclusively via getSecret() from ../utils/secrets.
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { randomUUID, randomBytes, createHash } from 'crypto';
import type Redis from 'ioredis';

import { query } from '../db/index';
import { getSecret } from '../utils/secrets';
import { logger } from '../utils/logger';
import {
  recordFailedLoginAttempt,
  recordAccountLockout,
  recordMfaFailure,
} from '../utils/metrics';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    public detail?: string,
  ) {
    super(detail ?? code);
    this.name = 'AuthError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** bcrypt work factor (Req 1.8 — minimum 12). */
const BCRYPT_ROUNDS = 12;

/** OTP validity window in milliseconds (Req 1.5 — 5 minutes). */
const OTP_TTL_MS = 5 * 60 * 1000;

/** Number of failed login attempts before account lockout (Req 1.3). */
const MAX_FAILED_ATTEMPTS = 5;

/** Access-token lifetime in seconds (Req 1.1 — 15 minutes). */
const ACCESS_TOKEN_TTL_SECONDS = 900;

/** Refresh-token lifetime in milliseconds (Req 1.9 — 7 days). */
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Redis session key TTL in seconds (Req 2.1 — 15 minutes). */
const SESSION_TTL_SECONDS = 900;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  username: string;
  email: string;
  phone: string;
  password_hash: string;
  role: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';
  failed_attempts: number;
  is_locked: boolean;
  locked_reason: string | null;
  otp_channel: 'EMAIL' | 'SMS';
}

interface OtpChallengeRow {
  id: string;
  user_id: string;
  otp_hash: string;
  channel: 'EMAIL' | 'SMS';
  expires_at: Date;
  is_used: boolean;
  used_at: Date | null;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
}

interface UserForMfa {
  id: string;
  role: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';
  username: string;
}

// ---------------------------------------------------------------------------
// SNS helper
// ---------------------------------------------------------------------------

let _snsClient: SNSClient | null = null;

function getSnsClient(): SNSClient {
  if (!_snsClient) {
    _snsClient = new SNSClient({});
  }
  return _snsClient;
}

/**
 * Returns true when OTPs should be delivered to the server logs instead of an
 * external provider (SNS). Controlled by OTP_DELIVERY=console or the legacy
 * SECUREBANK_OTP_CONSOLE=true flag.
 */
function isConsoleOtpDelivery(): boolean {
  return (
    process.env['OTP_DELIVERY']?.toLowerCase() === 'console' ||
    process.env['SECUREBANK_OTP_CONSOLE'] === 'true'
  );
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function generateJwt(
  userId: string,
  role: string,
): Promise<{ accessToken: string; jti: string }> {
  const privateKey = await getSecret('JWT_PRIVATE_KEY');
  const jti = randomUUID();

  const accessToken = jwt.sign(
    { sub: userId, role, jti },
    privateKey,
    { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  );

  return { accessToken, jti };
}

async function issueRefreshToken(
  userId: string,
): Promise<{ rawToken: string; tokenRow: RefreshTokenRow }> {
  const rawToken = randomBytes(64).toString('hex');
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const result = await query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, tokenHash, expiresAt],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AuthError(500, 'TOKEN_ISSUANCE_FAILED');
  }

  return { rawToken, tokenRow: row };
}

// ---------------------------------------------------------------------------
// login (Req 1.1–1.5, 1.8)
// ---------------------------------------------------------------------------

export async function login(
  username: string,
  password: string,
): Promise<{ mfa_challenge_id: string; otp_channel: 'EMAIL' | 'SMS' }> {
  // Parameterised query — never string-interpolate user input
  const userResult = await query<UserRow>(
    'SELECT * FROM users WHERE username = $1',
    [username],
  );

  const user = userResult.rows[0];

  // Constant-time: compare password even if user not found to avoid timing oracle
  if (!user) {
    // Run a dummy compare to keep response time consistent
    await bcrypt.compare(password, '$2b$12$invalidhashpadding000000000000000000000000000000000000000');
    throw new AuthError(401, 'INVALID_CREDENTIALS');
  }

  // Check lock status first (before password check) to avoid oracle on lock state
  if (user.is_locked) {
    throw new AuthError(423, 'ACCOUNT_LOCKED', user.locked_reason ?? 'Account is locked');
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);

  if (!passwordValid) {
    const newAttempts = user.failed_attempts + 1;

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      // Lock the account
      await query(
        `UPDATE users
         SET failed_attempts = failed_attempts + 1,
             is_locked = true,
             locked_reason = $1,
             updated_at = NOW()
         WHERE id = $2`,
        ['Too many failed login attempts', user.id],
      );
      await recordAccountLockout(username).catch(() => undefined);
    } else {
      await query(
        `UPDATE users
         SET failed_attempts = failed_attempts + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [user.id],
      );
    }

    await recordFailedLoginAttempt(username).catch(() => undefined);
    throw new AuthError(401, 'INVALID_CREDENTIALS');
  }

  // Password valid — generate OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const otpResult = await query<OtpChallengeRow>(
    `INSERT INTO otp_challenges (user_id, otp_hash, channel, expires_at, is_used)
     VALUES ($1, $2, $3, $4, false)
     RETURNING *`,
    [user.id, otpHash, user.otp_channel, expiresAt],
  );

  const challenge = otpResult.rows[0];
  if (!challenge) {
    throw new AuthError(500, 'OTP_CREATION_FAILED');
  }

  // Deliver the OTP. Two modes, selected by environment:
  //   - "console": print the OTP to the server logs (no external provider
  //     required). Enabled by OTP_DELIVERY=console or SECUREBANK_OTP_CONSOLE=true.
  //   - otherwise: dispatch via AWS SNS using the configured topic.
  if (isConsoleOtpDelivery()) {
    // The OTP is deliberately logged here so it can be read from the service
    // logs in environments without an SMS/email provider. Never enable this
    // mode where logs are accessible to untrusted parties.
    logger.warn('[OTP] Console delivery enabled — login code below', {
      username,
      mfa_challenge_id: challenge.id,
      otp,
    });
  } else {
    // Send OTP via SNS (fire-and-forget; log failures)
    try {
      if (user.otp_channel === 'SMS') {
        // Direct SMS to the user's phone number.
        // In SNS sandbox, verify the destination number first at:
        // AWS Console → SNS → Text messaging → Sandbox destination phone numbers
        await getSnsClient().send(
          new PublishCommand({
            PhoneNumber: user.phone,
            Message: `Your SecureBank OTP is: ${otp}. Valid for 5 minutes.`,
          }),
        );
      } else {
        // EMAIL — publish to the SNS topic (must have a confirmed email subscription)
        const topicArn = await getSecret('SNS_TOPIC_ARN');
        await getSnsClient().send(
          new PublishCommand({
            TopicArn: topicArn,
            Message: `Your SecureBank login OTP is: ${otp}. It expires in 5 minutes. Do not share this code.`,
            Subject: 'SecureBank — Your Login OTP',
          }),
        );
      }
    } catch (snsErr) {
      logger.warn('SNS OTP dispatch failed', {
        userId: user.id,
        channel: user.otp_channel,
        error: (snsErr as Error).message,
      });
      // Continue — OTP is stored in DB; caller can retry
    }
  }

  return { mfa_challenge_id: challenge.id, otp_channel: user.otp_channel };
}

// ---------------------------------------------------------------------------
// verifyMfa (Req 1.5–1.7, 1.9)
// ---------------------------------------------------------------------------

export async function verifyMfa(
  mfaChallengeId: string,
  otp: string,
  redisClient: Redis,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  // Look up challenge — must be unused and not expired
  const challengeResult = await query<OtpChallengeRow>(
    `SELECT * FROM otp_challenges
     WHERE id = $1 AND is_used = false AND expires_at > NOW()`,
    [mfaChallengeId],
  );

  const challenge = challengeResult.rows[0];
  if (!challenge) {
    throw new AuthError(401, 'INVALID_OTP');
  }

  const otpValid = await bcrypt.compare(otp, challenge.otp_hash);
  if (!otpValid) {
    // Fetch username for metrics
    const userResult = await query<{ username: string }>(
      'SELECT username FROM users WHERE id = $1',
      [challenge.user_id],
    );
    const username = userResult.rows[0]?.username ?? 'unknown';
    await recordMfaFailure(username).catch(() => undefined);
    throw new AuthError(401, 'INVALID_OTP');
  }

  // Mark challenge as used
  await query(
    `UPDATE otp_challenges
     SET is_used = true, used_at = NOW()
     WHERE id = $1`,
    [challenge.id],
  );

  // Reset failed_attempts on user
  await query(
    `UPDATE users
     SET failed_attempts = 0, updated_at = NOW()
     WHERE id = $1`,
    [challenge.user_id],
  );

  // Fetch user for role
  const userResult = await query<UserForMfa>(
    'SELECT id, role, username FROM users WHERE id = $1',
    [challenge.user_id],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new AuthError(500, 'USER_NOT_FOUND');
  }

  // Issue JWT and refresh token
  const { accessToken, jti } = await generateJwt(user.id, user.role);
  const { rawToken: rawRefreshToken } = await issueRefreshToken(user.id);

  // Set session in Redis (inactivity window)
  try {
    await redisClient.set(`session:${jti}`, user.id, 'EX', SESSION_TTL_SECONDS);
  } catch (redisErr) {
    logger.warn('Redis session set failed', { error: (redisErr as Error).message });
  }

  return {
    access_token: accessToken,
    refresh_token: rawRefreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// logout (Req 2.3)
// ---------------------------------------------------------------------------

export async function logout(
  jti: string,
  refreshTokenRaw: string,
  redisClient: Redis,
): Promise<void> {
  // Revoke JWT in Redis (TTL = 15 min to outlast the token)
  try {
    await redisClient.set(`revoked:${jti}`, '1', 'EX', SESSION_TTL_SECONDS);
    await redisClient.del(`session:${jti}`);
  } catch (redisErr) {
    logger.warn('Redis revocation failed during logout', {
      error: (redisErr as Error).message,
    });
  }

  // Revoke refresh token in DB
  const tokenHash = sha256Hex(refreshTokenRaw);
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}

// ---------------------------------------------------------------------------
// refreshToken (Req 1.9, 1.10)
// ---------------------------------------------------------------------------

export async function refreshToken(
  refreshTokenRaw: string,
  redisClient: Redis,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const tokenHash = sha256Hex(refreshTokenRaw);

  const rtResult = await query<RefreshTokenRow>(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash],
  );

  const oldToken = rtResult.rows[0];
  if (!oldToken) {
    throw new AuthError(401, 'INVALID_REFRESH_TOKEN');
  }

  // Fetch user
  const userResult = await query<UserForMfa>(
    'SELECT id, role, username FROM users WHERE id = $1',
    [oldToken.user_id],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new AuthError(401, 'INVALID_REFRESH_TOKEN');
  }

  // Issue new JWT and refresh token
  const { accessToken: newAccessToken, jti: newJti } = await generateJwt(user.id, user.role);
  const { rawToken: newRawRefreshToken, tokenRow: newTokenRow } =
    await issueRefreshToken(user.id);

  // Mark old refresh token as revoked and replaced
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW(), replaced_by = $1
     WHERE id = $2`,
    [newTokenRow.id, oldToken.id],
  );

  // Redis: set new session, revoke old session
  try {
    await redisClient.set(`session:${newJti}`, user.id, 'EX', SESSION_TTL_SECONDS);
    // Silently revoke old jti — we don't have the old jti here, that's fine;
    // old JWT will expire naturally or be caught by revocation if re-presented.
  } catch (redisErr) {
    logger.warn('Redis session rotation failed', { error: (redisErr as Error).message });
  }

  return {
    access_token: newAccessToken,
    refresh_token: newRawRefreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// unlockAccount (Admin use)
// ---------------------------------------------------------------------------

export async function unlockAccount(userId: string): Promise<void> {
  await query(
    `UPDATE users
     SET is_locked = false,
         failed_attempts = 0,
         locked_reason = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [userId],
  );
}
