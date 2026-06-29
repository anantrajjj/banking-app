/**
 * unlock-account.ts
 *
 * Unlocks a locked user account and resets their failed-attempt counter.
 * Run via:
 *   npm run unlock-account -- <username>
 *
 * Examples:
 *   npm run unlock-account -- demo
 *   npm run unlock-account -- john.smith
 */

import 'dotenv/config';
import { getPool, closePool } from './index';

async function main(): Promise<void> {
  const username = process.argv[2]?.trim();

  if (!username) {
    console.error('Usage: npm run unlock-account -- <username>');
    process.exit(1);
  }

  const pool = await getPool();

  // Check if the user exists and get their lock status
  const findResult = await pool.query<{
    id: string;
    username: string;
    email: string;
    is_locked: boolean;
    failed_attempts: number;
    locked_reason: string | null;
  }>(
    `SELECT id, username, email, is_locked, failed_attempts, locked_reason
     FROM users
     WHERE username = $1`,
    [username],
  );

  if (findResult.rows.length === 0) {
    console.error(`❌  User "${username}" not found.`);
    await closePool();
    process.exit(1);
  }

  const user = findResult.rows[0]!;

  if (!user.is_locked && user.failed_attempts === 0) {
    console.log(`✅  User "${username}" (${user.email}) is already unlocked with 0 failed attempts. Nothing to do.`);
    await closePool();
    process.exit(0);
  }

  console.log(`\nUser found:`);
  console.log(`  Username:        ${user.username}`);
  console.log(`  Email:           ${user.email}`);
  console.log(`  Locked:          ${user.is_locked}`);
  console.log(`  Failed attempts: ${user.failed_attempts}`);
  console.log(`  Lock reason:     ${user.locked_reason ?? 'none'}`);

  // Unlock the account
  await pool.query(
    `UPDATE users
     SET is_locked       = FALSE,
         failed_attempts = 0,
         locked_reason   = NULL,
         updated_at      = NOW()
     WHERE id = $1`,
    [user.id],
  );

  console.log(`\n✅  Account "${username}" unlocked successfully.`);
  console.log(`    They can now log in at the normal login page.`);

  await closePool();
}

main().catch((err: unknown) => {
  console.error('Unlock failed:', (err as Error).message);
  process.exit(1);
});
