/**
 * Database migration runner.
 *
 * Applies every *.sql file in the migrations directory, in filename order,
 * exactly once. Applied migrations are tracked in the `schema_migrations`
 * table so the script is safe to run on every deploy.
 *
 * Run with:
 *   npm run migrate          (compiled — node dist/db/migrate.js)
 *   npx ts-node src/db/migrate.ts   (local, from source)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getPool, closePool } from './index';

/** Locate the migrations directory whether running from src/ or dist/. */
function resolveMigrationsDir(): string {
  const candidates = [
    process.env['MIGRATIONS_DIR'],
    path.join(__dirname, 'migrations'), // dist/db/migrations (if copied at build)
    path.join(__dirname, '..', '..', 'src', 'db', 'migrations'), // dist/db -> src/db
    path.join(process.cwd(), 'src', 'db', 'migrations'),
    path.join(process.cwd(), 'api', 'src', 'db', 'migrations'),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.sql'))) {
      return dir;
    }
  }
  throw new Error(
    `Could not locate migrations directory. Looked in:\n${candidates.join('\n')}`,
  );
}

async function migrate(): Promise<void> {
  const dir = resolveMigrationsDir();
  console.log(`📦  Running migrations from ${dir}`);

  const pool = await getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const already = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file],
    );
    if ((already.rowCount ?? 0) > 0) {
      console.log(`  ⏭   ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  ✔   ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  await closePool();
  console.log('✅  Migrations complete.');
}

migrate().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
