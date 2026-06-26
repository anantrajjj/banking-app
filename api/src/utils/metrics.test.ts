/**
 * Unit tests for api/src/utils/metrics.ts
 *
 * Verifies that each exported function:
 *   - Invokes PutMetricDataCommand with the correct namespace, metric name,
 *     value, unit, and dimensions.
 *   - Never throws when the CloudWatch client call fails (error must be
 *     swallowed and logged as a WARNING).
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  type PutMetricDataCommandInput,
} from '@aws-sdk/client-cloudwatch';

import {
  recordFailedLoginAttempt,
  recordAccountLockout,
  recordMfaFailure,
  recordFundTransferCompletion,
  _setCwClientForTesting,
  _resetCwClientForTesting,
} from './metrics';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Captured inputs from every CloudWatch.send() call made during a test. */
let capturedInputs: PutMetricDataCommandInput[] = [];
/** Controls whether the mock send() should reject. */
let shouldSendFail = false;

/** Minimal CloudWatchClient mock that records what it receives. */
const mockClient = {
  send: jest.fn(async (command: PutMetricDataCommand) => {
    if (shouldSendFail) {
      throw new Error('Simulated CloudWatch SDK error');
    }
    // command.input is the PutMetricDataCommandInput
    capturedInputs.push((command as unknown as { input: PutMetricDataCommandInput }).input);
  }),
} as unknown as CloudWatchClient;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the single captured input, asserting exactly one call was made. */
function getSingleInput(): PutMetricDataCommandInput {
  expect(capturedInputs).toHaveLength(1);
  return capturedInputs[0] as PutMetricDataCommandInput;
}

/** Returns the first MetricDatum from the single captured call. */
function getSingleDatum() {
  const input = getSingleInput();
  expect(input.MetricData).toHaveLength(1);
  return input.MetricData![0];
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedInputs = [];
  shouldSendFail = false;
  _setCwClientForTesting(mockClient);
  (mockClient.send as jest.Mock).mockClear();
});

afterEach(() => {
  _resetCwClientForTesting();
});

// ---------------------------------------------------------------------------
// Shared dimension assertion helper
// ---------------------------------------------------------------------------

/**
 * Asserts the standard Environment dimension is present with the expected value.
 * Extra dimensions (e.g. Username, Currency) are checked by the caller.
 */
function expectEnvironmentDimension(
  datum: { Dimensions?: Array<{ Name?: string; Value?: string }> },
  expectedEnv: string,
) {
  const envDim = datum.Dimensions?.find((d) => d.Name === 'Environment');
  expect(envDim).toBeDefined();
  expect(envDim?.Value).toBe(expectedEnv);
}

// ---------------------------------------------------------------------------
// recordFailedLoginAttempt
// ---------------------------------------------------------------------------

describe('recordFailedLoginAttempt', () => {
  it('publishes to namespace SecureBank/Auth', async () => {
    await recordFailedLoginAttempt('alice');

    const input = getSingleInput();
    expect(input.Namespace).toBe('SecureBank/Auth');
  });

  it('uses metric name FailedLoginAttempt', async () => {
    await recordFailedLoginAttempt('alice');

    const datum = getSingleDatum();
    expect(datum.MetricName).toBe('FailedLoginAttempt');
  });

  it('sends value 1 with unit Count', async () => {
    await recordFailedLoginAttempt('alice');

    const datum = getSingleDatum();
    expect(datum.Value).toBe(1);
    expect(datum.Unit).toBe('Count');
  });

  it('includes Environment dimension from APP_ENV', async () => {
    process.env['APP_ENV'] = 'production';
    try {
      await recordFailedLoginAttempt('alice');
      const datum = getSingleDatum();
      expectEnvironmentDimension(datum, 'production');
    } finally {
      delete process.env['APP_ENV'];
    }
  });

  it('defaults Environment dimension to "development" when APP_ENV is unset', async () => {
    delete process.env['APP_ENV'];
    await recordFailedLoginAttempt('alice');

    const datum = getSingleDatum();
    expectEnvironmentDimension(datum, 'development');
  });

  it('includes Username dimension', async () => {
    await recordFailedLoginAttempt('bob');

    const datum = getSingleDatum();
    const usernameDim = datum.Dimensions?.find((d) => d.Name === 'Username');
    expect(usernameDim).toBeDefined();
    expect(usernameDim?.Value).toBe('bob');
  });

  it('does not throw when CloudWatch send fails', async () => {
    shouldSendFail = true;
    await expect(recordFailedLoginAttempt('alice')).resolves.toBeUndefined();
  });

  it('logs a warning (not an error) when CloudWatch send fails', async () => {
    shouldSendFail = true;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await recordFailedLoginAttempt('alice');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('[WARN]');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// recordAccountLockout
// ---------------------------------------------------------------------------

describe('recordAccountLockout', () => {
  it('publishes to namespace SecureBank/Auth', async () => {
    await recordAccountLockout('carol');

    const input = getSingleInput();
    expect(input.Namespace).toBe('SecureBank/Auth');
  });

  it('uses metric name AccountLockout', async () => {
    await recordAccountLockout('carol');

    const datum = getSingleDatum();
    expect(datum.MetricName).toBe('AccountLockout');
  });

  it('sends value 1 with unit Count', async () => {
    await recordAccountLockout('carol');

    const datum = getSingleDatum();
    expect(datum.Value).toBe(1);
    expect(datum.Unit).toBe('Count');
  });

  it('includes Environment dimension defaulting to "development"', async () => {
    delete process.env['APP_ENV'];
    await recordAccountLockout('carol');

    const datum = getSingleDatum();
    expectEnvironmentDimension(datum, 'development');
  });

  it('includes Username dimension', async () => {
    await recordAccountLockout('dave');

    const datum = getSingleDatum();
    const usernameDim = datum.Dimensions?.find((d) => d.Name === 'Username');
    expect(usernameDim?.Value).toBe('dave');
  });

  it('does not throw when CloudWatch send fails', async () => {
    shouldSendFail = true;
    await expect(recordAccountLockout('carol')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// recordMfaFailure
// ---------------------------------------------------------------------------

describe('recordMfaFailure', () => {
  it('publishes to namespace SecureBank/Auth', async () => {
    await recordMfaFailure('eve');

    const input = getSingleInput();
    expect(input.Namespace).toBe('SecureBank/Auth');
  });

  it('uses metric name MfaFailure', async () => {
    await recordMfaFailure('eve');

    const datum = getSingleDatum();
    expect(datum.MetricName).toBe('MfaFailure');
  });

  it('sends value 1 with unit Count', async () => {
    await recordMfaFailure('eve');

    const datum = getSingleDatum();
    expect(datum.Value).toBe(1);
    expect(datum.Unit).toBe('Count');
  });

  it('includes Environment dimension defaulting to "development"', async () => {
    delete process.env['APP_ENV'];
    await recordMfaFailure('eve');

    const datum = getSingleDatum();
    expectEnvironmentDimension(datum, 'development');
  });

  it('includes Username dimension', async () => {
    await recordMfaFailure('frank');

    const datum = getSingleDatum();
    const usernameDim = datum.Dimensions?.find((d) => d.Name === 'Username');
    expect(usernameDim?.Value).toBe('frank');
  });

  it('does not throw when CloudWatch send fails', async () => {
    shouldSendFail = true;
    await expect(recordMfaFailure('eve')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// recordFundTransferCompletion
// ---------------------------------------------------------------------------

describe('recordFundTransferCompletion', () => {
  it('publishes to namespace SecureBank/Transfers', async () => {
    await recordFundTransferCompletion(5000, 'INR');

    const input = getSingleInput();
    expect(input.Namespace).toBe('SecureBank/Transfers');
  });

  it('uses metric name FundTransferCompletion', async () => {
    await recordFundTransferCompletion(5000, 'INR');

    const datum = getSingleDatum();
    expect(datum.MetricName).toBe('FundTransferCompletion');
  });

  it('uses the transfer amount as the metric value', async () => {
    await recordFundTransferCompletion(12345.67, 'INR');

    const datum = getSingleDatum();
    expect(datum.Value).toBe(12345.67);
  });

  it('uses unit Count', async () => {
    await recordFundTransferCompletion(100, 'INR');

    const datum = getSingleDatum();
    expect(datum.Unit).toBe('Count');
  });

  it('includes Environment dimension defaulting to "development"', async () => {
    delete process.env['APP_ENV'];
    await recordFundTransferCompletion(1, 'INR');

    const datum = getSingleDatum();
    expectEnvironmentDimension(datum, 'development');
  });

  it('includes Currency dimension', async () => {
    await recordFundTransferCompletion(250, 'USD');

    const datum = getSingleDatum();
    const currencyDim = datum.Dimensions?.find((d) => d.Name === 'Currency');
    expect(currencyDim?.Value).toBe('USD');
  });

  it('does not throw when CloudWatch send fails', async () => {
    shouldSendFail = true;
    await expect(recordFundTransferCompletion(100, 'INR')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Environment dimension — APP_ENV integration
// ---------------------------------------------------------------------------

describe('APP_ENV environment variable', () => {
  afterEach(() => {
    delete process.env['APP_ENV'];
  });

  it('uses "staging" when APP_ENV=staging', async () => {
    process.env['APP_ENV'] = 'staging';
    await recordFailedLoginAttempt('grace');

    const datum = getSingleDatum();
    expectEnvironmentDimension(datum, 'staging');
  });

  it('falls back to "development" when APP_ENV is an empty string', async () => {
    process.env['APP_ENV'] = '';
    // Empty string is falsy — ?? returns "development"
    await recordFailedLoginAttempt('henry');

    const datum = getSingleDatum();
    expectEnvironmentDimension(datum, 'development');
  });
});
