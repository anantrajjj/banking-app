/**
 * Unit tests for api/src/db/index.ts
 *
 * Tests cover:
 *   - Successful secret retrieval from Secrets Manager → pool is initialised
 *   - Secrets Manager failure with DATABASE_URL fallback → WARNING logged
 *   - Both sources unavailable → process.exit(1) called
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-secrets-manager before importing the module under test
// ---------------------------------------------------------------------------

jest.mock('@aws-sdk/client-secrets-manager', () => {
  const mockSend = jest.fn();
  const MockClient = jest.fn().mockImplementation(() => ({ send: mockSend }));
  return {
    SecretsManagerClient: MockClient,
    GetSecretValueCommand: jest.fn().mockImplementation((input) => input),
    SecretsManagerServiceException: class SecretsManagerServiceException extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'SecretsManagerServiceException';
      }
    },
    __mockSend: mockSend,
  };
});

// Mock pg Pool to avoid real DB connections
jest.mock('pg', () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockEnd = jest.fn().mockResolvedValue(undefined);
  const mockOn = jest.fn();
  const MockPool = jest.fn().mockImplementation(() => ({
    query: mockQuery,
    end: mockEnd,
    on: mockOn,
  }));
  return { Pool: MockPool, __mockQuery: mockQuery, __mockEnd: mockEnd };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMockSend() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@aws-sdk/client-secrets-manager') as { __mockSend: jest.Mock })
    .__mockSend;
}

function getMockPool() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('pg').Pool as jest.Mock;
}

// ---------------------------------------------------------------------------
// Test helpers for fresh module state
// ---------------------------------------------------------------------------

/**
 * Re-imports the db module with a clean module registry so that module-level
 * state (_pool, _secretCache, _initPromise) is reset between tests.
 */
async function freshModule() {
  jest.resetModules();

  // Re-apply mocks after resetModules
  jest.mock('@aws-sdk/client-secrets-manager', () => {
    const mockSend = jest.fn();
    const MockClient = jest.fn().mockImplementation(() => ({ send: mockSend }));
    return {
      SecretsManagerClient: MockClient,
      GetSecretValueCommand: jest.fn().mockImplementation((input) => input),
      SecretsManagerServiceException: class SecretsManagerServiceException extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'SecretsManagerServiceException';
        }
      },
      __mockSend: mockSend,
    };
  });

  jest.mock('pg', () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const mockEnd = jest.fn().mockResolvedValue(undefined);
    const mockOn = jest.fn();
    const MockPool = jest.fn().mockImplementation(() => ({
      query: mockQuery,
      end: mockEnd,
      on: mockOn,
    }));
    return { Pool: MockPool, __mockQuery: mockQuery, __mockEnd: mockEnd };
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./index') as typeof import('./index');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('db/index — resolveConnectionString', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── 1. Secrets Manager success ────────────────────────────────────────────

  describe('when Secrets Manager returns a connection string', () => {
    it('initialises the pool with the secret value', async () => {
      process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:db-conn';
      delete process.env['DATABASE_URL'];

      const dbModule = await freshModule();

      // Configure the mock to return a plain connection string
      const mockSend = (
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@aws-sdk/client-secrets-manager') as { __mockSend: jest.Mock }
      ).__mockSend;
      mockSend.mockResolvedValueOnce({
        SecretString: 'postgresql://user:pass@localhost:5432/securebank',
      });

      const pool = await dbModule.getPool();

      expect(pool).toBeDefined();
      expect(getMockPool()).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://user:pass@localhost:5432/securebank',
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 2_000,
        }),
      );
    });

    it('parses a JSON secret and extracts the connectionString key', async () => {
      process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:db-json';
      delete process.env['DATABASE_URL'];

      const dbModule = await freshModule();

      const mockSend = (
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@aws-sdk/client-secrets-manager') as { __mockSend: jest.Mock }
      ).__mockSend;
      mockSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({
          connectionString: 'postgresql://json-user:json-pass@db:5432/mydb',
        }),
      });

      const connStr = await dbModule.resolveConnectionString();

      expect(connStr).toBe('postgresql://json-user:json-pass@db:5432/mydb');
    });
  });

  // ── 2. Secrets Manager failure → DATABASE_URL fallback ───────────────────

  describe('when Secrets Manager fails but DATABASE_URL is set', () => {
    it('logs a WARNING and uses DATABASE_URL as the connection string', async () => {
      process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:db-conn';
      process.env['DATABASE_URL'] = 'postgresql://fallback-user:pass@localhost:5432/fallback';

      const dbModule = await freshModule();

      const mockSend = (
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@aws-sdk/client-secrets-manager') as { __mockSend: jest.Mock }
      ).__mockSend;
      mockSend.mockRejectedValueOnce(new Error('Network unreachable'));

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const connStr = await dbModule.resolveConnectionString();

      expect(connStr).toBe('postgresql://fallback-user:pass@localhost:5432/fallback');

      // A WARNING must have been emitted
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARNING]'),
        expect.anything(),
      );

      warnSpy.mockRestore();
    });

    it('logs a WARNING when DB_SECRET_ARN is not set and DATABASE_URL is used', async () => {
      delete process.env['DB_SECRET_ARN'];
      delete process.env['DB_SECRET_NAME'];
      process.env['DATABASE_URL'] = 'postgresql://env-user:pass@localhost:5432/envdb';

      const dbModule = await freshModule();

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const connStr = await dbModule.resolveConnectionString();

      expect(connStr).toBe('postgresql://env-user:pass@localhost:5432/envdb');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARNING]'),
      );

      warnSpy.mockRestore();
    });
  });

  // ── 3. Both sources unavailable → process.exit(1) ────────────────────────

  describe('when both Secrets Manager and DATABASE_URL are unavailable', () => {
    it('calls process.exit(1) and logs a FATAL message', async () => {
      delete process.env['DB_SECRET_ARN'];
      delete process.env['DB_SECRET_NAME'];
      delete process.env['DATABASE_URL'];

      const dbModule = await freshModule();

      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((_code?: string | number | null | undefined) => {
          throw new Error('process.exit called');
        });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await expect(dbModule.resolveConnectionString()).rejects.toThrow(
        'process.exit called',
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FATAL]'),
      );

      exitSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// query() safety guard tests
// ---------------------------------------------------------------------------

describe('db/index — query()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/testdb';
    delete process.env['DB_SECRET_ARN'];
    delete process.env['DB_SECRET_NAME'];
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects when $N placeholders are used without a params array', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dbModule = await freshModule();
    warnSpy.mockRestore();

    await expect(
      dbModule.query('SELECT * FROM users WHERE id = $1'),
    ).rejects.toThrow(/params array/);
  });

  it('accepts a query with placeholders when params array is provided', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dbModule = await freshModule();
    warnSpy.mockRestore();

    // Should not throw — params array is provided
    await expect(
      dbModule.query('SELECT * FROM users WHERE id = $1', ['some-uuid']),
    ).resolves.toBeDefined();
  });

  it('accepts a query without placeholders and no params array', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dbModule = await freshModule();
    warnSpy.mockRestore();

    await expect(
      dbModule.query('SELECT NOW()'),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// closePool() tests
// ---------------------------------------------------------------------------

describe('db/index — closePool()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/testdb';
    delete process.env['DB_SECRET_ARN'];
    delete process.env['DB_SECRET_NAME'];
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('calls pool.end() when an active pool exists', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dbModule = await freshModule();

    await dbModule.getPool(); // initialise pool
    warnSpy.mockRestore();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg') as { Pool: jest.Mock };
    const poolInstance = Pool.mock.results[Pool.mock.results.length - 1]?.value as {
      end: jest.Mock;
    };

    await dbModule.closePool();

    expect(poolInstance.end).toHaveBeenCalledTimes(1);
  });

  it('is safe to call when no pool has been initialised', async () => {
    const dbModule = await freshModule();
    await expect(dbModule.closePool()).resolves.toBeUndefined();
  });

  it('is safe to call multiple times (idempotent)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dbModule = await freshModule();
    await dbModule.getPool();
    warnSpy.mockRestore();

    await dbModule.closePool();
    // second call should be a no-op
    await expect(dbModule.closePool()).resolves.toBeUndefined();
  });
});

// Re-export to satisfy unused import lint rules in this file
export { SecretsManagerClient, GetSecretValueCommand };
