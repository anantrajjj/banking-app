/**
 * Database seed script — creates a single starter customer account from
 * environment variables (nothing is hardcoded), plus a couple of sample
 * accounts and ledger entries so the dashboard has data to show.
 *
 * Required env vars:
 *   SEED_USERNAME   login username for the starter account
 *   SEED_PASSWORD   login password (will be bcrypt-hashed)
 *
 * Optional env vars:
 *   SEED_EMAIL      default: <username>@securebank.local
 *   SEED_PHONE      default: +910000000000
 *   SEED_SAMPLE_DATA  "false" to skip sample accounts/transactions
 *
 * Run with:
 *   npm run seed                    (compiled — node dist/db/seed.js)
 *   npx ts-node src/db/seed.ts      (local, from source)
 *
 * Safe to re-run: uses ON CONFLICT DO NOTHING so existing rows are skipped.
 */

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { query, closePool } from './index';

const BCRYPT_ROUNDS = 12;

async function seed(): Promise<void> {
  const username = process.env['SEED_USERNAME'];
  const password = process.env['SEED_PASSWORD'];

  if (!username || !password) {
    console.error(
      '[FATAL] SEED_USERNAME and SEED_PASSWORD must be set to seed the starter account.',
    );
    process.exit(1);
  }

  const email = process.env['SEED_EMAIL'] ?? `${username}@securebank.local`;
  const phone = process.env['SEED_PHONE'] ?? '+910000000000';
  const includeSample = process.env['SEED_SAMPLE_DATA'] !== 'false';

  console.log('🌱  Seeding database...');

  // ── Starter user ───────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const userResult = await query<{ id: string }>(
    `INSERT INTO users (username, email, phone, password_hash, role, otp_channel)
     VALUES ($1, $2, $3, $4, 'CUSTOMER', 'EMAIL')
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [username, email, phone, passwordHash],
  );

  // Fetch the user id whether it was just inserted or already existed.
  let userId = userResult.rows[0]?.id;
  if (!userId) {
    const existing = await query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [username],
    );
    userId = existing.rows[0]?.id;
  }
  if (!userId) {
    throw new Error('Failed to create or locate the seeded user.');
  }
  console.log(`  ✔  User "${username}" ready`);

  if (!includeSample) {
    await closePool();
    console.log('\n✅  Seed complete (no sample data).');
    console.log(`\nLogin with username: ${username}`);
    return;
  }

  // ── Sample accounts (deterministic numbers so re-runs are idempotent) ────────
  const savingsNumber = 'SB100000001';
  const currentNumber = 'CA100000001';

  await query(
    `INSERT INTO accounts (user_id, account_number, account_type, available_balance)
     VALUES
       ($1, $2, 'SAVINGS', 250000.00),
       ($1, $3, 'CURRENT', 80000.00)
     ON CONFLICT (account_number) DO NOTHING`,
    [userId, savingsNumber, currentNumber],
  );
  console.log('  ✔  Sample accounts inserted');

  const accounts = await query<{ id: string; account_type: string }>(
    'SELECT id, account_type FROM accounts WHERE user_id = $1',
    [userId],
  );
  const savings = accounts.rows.find((a) => a.account_type === 'SAVINGS');
  const current = accounts.rows.find((a) => a.account_type === 'CURRENT');

  if (savings && current) {
    const refId = randomUUID();
    await query(
      `INSERT INTO transactions
         (transfer_ref_id, account_id, entry_type, amount,
          running_balance, transfer_mode, narration, transaction_date)
       SELECT $1, $2, 'CREDIT', 50000.00, 250000.00, 'NEFT',
              'Opening credit', NOW() - INTERVAL '10 days'
       WHERE NOT EXISTS (
         SELECT 1 FROM transactions WHERE account_id = $2 AND narration = 'Opening credit'
       )`,
      [refId, savings.id],
    );
    await query(
      `INSERT INTO transactions
         (transfer_ref_id, account_id, entry_type, amount,
          running_balance, transfer_mode, narration, transaction_date)
       SELECT $1, $2, 'DEBIT', 5000.00, 245000.00, 'IMPS',
              'Grocery payment', NOW() - INTERVAL '5 days'
       WHERE NOT EXISTS (
         SELECT 1 FROM transactions WHERE account_id = $2 AND narration = 'Grocery payment'
       )`,
      [randomUUID(), savings.id],
    );
    await query(
      `INSERT INTO transactions
         (transfer_ref_id, account_id, entry_type, amount,
          running_balance, transfer_mode, narration, transaction_date)
       SELECT $1, $2, 'CREDIT', 15000.00, 260000.00, 'NEFT',
              'Salary credit', NOW() - INTERVAL '2 days'
       WHERE NOT EXISTS (
         SELECT 1 FROM transactions WHERE account_id = $2 AND narration = 'Salary credit'
       )`,
      [randomUUID(), savings.id],
    );
    console.log('  ✔  Sample transactions inserted');
  }

  await closePool();
  console.log('\n✅  Seed complete.');
  console.log(`\nLogin with username: ${username}`);
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
