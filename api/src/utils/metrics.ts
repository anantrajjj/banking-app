/**
 * CloudWatch custom metrics module.
 *
 * Publishes application-level metrics to AWS CloudWatch for key security and
 * business events, satisfying req 13.5:
 *
 *   - FailedLoginAttempt   (namespace: SecureBank/Auth)
 *   - AccountLockout       (namespace: SecureBank/Auth)
 *   - MfaFailure           (namespace: SecureBank/Auth)
 *   - FundTransferCompletion (namespace: SecureBank/Transfers)
 *
 * Each metric carries an `Environment` dimension sourced from the APP_ENV
 * environment variable (default: "development").
 *
 * Errors from the CloudWatch SDK are caught and logged as WARNING so that
 * metric failures never propagate to the caller or interrupt request handling.
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  StandardUnit,
  type Dimension,
  type MetricDatum,
} from '@aws-sdk/client-cloudwatch';

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

const NAMESPACE_AUTH = 'SecureBank/Auth';
const NAMESPACE_TRANSFERS = 'SecureBank/Transfers';

// ---------------------------------------------------------------------------
// Metric names
// ---------------------------------------------------------------------------

const METRIC_FAILED_LOGIN = 'FailedLoginAttempt';
const METRIC_ACCOUNT_LOCKOUT = 'AccountLockout';
const METRIC_MFA_FAILURE = 'MfaFailure';
const METRIC_FUND_TRANSFER = 'FundTransferCompletion';

// ---------------------------------------------------------------------------
// CloudWatch client (singleton, injectable for tests)
// ---------------------------------------------------------------------------

let _cwClient: CloudWatchClient | null = null;

/** Lazily creates and reuses the CloudWatch client. */
function getCwClient(): CloudWatchClient {
  if (!_cwClient) {
    // Credentials come from the ECS task IAM role via the SDK default credential
    // provider chain — no explicit keys are used.
    _cwClient = new CloudWatchClient({});
  }
  return _cwClient;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolves the current environment label from APP_ENV (default: "development"). */
function getEnvironment(): string {
  return process.env['APP_ENV'] || 'development';
}

/**
 * Builds the standard dimension array used on every metric:
 *   - Environment: <APP_ENV>
 */
function buildDimensions(extra?: Dimension[]): Dimension[] {
  const base: Dimension[] = [
    { Name: 'Environment', Value: getEnvironment() },
  ];
  return extra ? [...base, ...extra] : base;
}

/**
 * Publishes a single CloudWatch metric datum.
 * Errors are caught internally and logged as WARNING — never thrown to callers.
 *
 * @param namespace   CloudWatch namespace (e.g. "SecureBank/Auth").
 * @param metricName  Name of the metric (e.g. "FailedLoginAttempt").
 * @param value       Numeric metric value (typically 1 for a count).
 * @param dimensions  Dimension array for the metric datum.
 * @param unit        CloudWatch unit string (default: "Count").
 */
async function publishMetric(
  namespace: string,
  metricName: string,
  value: number,
  dimensions: Dimension[],
  unit: StandardUnit = StandardUnit.Count,
): Promise<void> {
  const datum: MetricDatum = {
    MetricName: metricName,
    Value: value,
    Unit: unit,
    Dimensions: dimensions,
    Timestamp: new Date(),
  };

  // CloudWatch is opt-in. When disabled (default on non-AWS hosts like Render)
  // metric publishing is a no-op so no failing SDK calls are made.
  if (process.env['CLOUDWATCH_ENABLED'] !== 'true') {
    return;
  }

  const command = new PutMetricDataCommand({
    Namespace: namespace,
    MetricData: [datum],
  });

  try {
    await getCwClient().send(command);
  } catch (err) {
    // Metric failures must never propagate to callers (req 13.5 non-disruption).
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[WARN] Failed to publish CloudWatch metric "${namespace}/${metricName}": ${message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Records a failed login attempt for the given username.
 *
 * Metric:    SecureBank/Auth / FailedLoginAttempt
 * Dimension: Environment, Username
 *
 * @param username  The username for which the login attempt failed.
 */
export async function recordFailedLoginAttempt(username: string): Promise<void> {
  const dimensions = buildDimensions([{ Name: 'Username', Value: username }]);
  await publishMetric(NAMESPACE_AUTH, METRIC_FAILED_LOGIN, 1, dimensions);
}

/**
 * Records an account lockout event for the given username.
 *
 * Metric:    SecureBank/Auth / AccountLockout
 * Dimension: Environment, Username
 *
 * @param username  The username whose account was locked.
 */
export async function recordAccountLockout(username: string): Promise<void> {
  const dimensions = buildDimensions([{ Name: 'Username', Value: username }]);
  await publishMetric(NAMESPACE_AUTH, METRIC_ACCOUNT_LOCKOUT, 1, dimensions);
}

/**
 * Records an MFA failure event for the given username.
 *
 * Metric:    SecureBank/Auth / MfaFailure
 * Dimension: Environment, Username
 *
 * @param username  The username whose MFA challenge failed.
 */
export async function recordMfaFailure(username: string): Promise<void> {
  const dimensions = buildDimensions([{ Name: 'Username', Value: username }]);
  await publishMetric(NAMESPACE_AUTH, METRIC_MFA_FAILURE, 1, dimensions);
}

/**
 * Records a completed fund transfer.
 *
 * Metric:    SecureBank/Transfers / FundTransferCompletion
 * Dimension: Environment, Currency
 * Value:     The transfer amount (not a plain count — useful for dashboards).
 *
 * @param amount    The transfer amount in the given currency.
 * @param currency  ISO 4217 currency code (e.g. "INR").
 */
export async function recordFundTransferCompletion(
  amount: number,
  currency: string,
): Promise<void> {
  const dimensions = buildDimensions([{ Name: 'Currency', Value: currency }]);
  await publishMetric(NAMESPACE_TRANSFERS, METRIC_FUND_TRANSFER, amount, dimensions);
}

// ---------------------------------------------------------------------------
// Exported for testing purposes only
// ---------------------------------------------------------------------------

/**
 * Replaces the internal CloudWatch client with a test double.
 * **For use in unit tests only** — do not call in production code.
 */
export function _setCwClientForTesting(client: CloudWatchClient): void {
  _cwClient = client;
}

/**
 * Resets the internal CloudWatch client to null so the next call to
 * getCwClient() creates a fresh real client.
 * **For use in unit tests only** — do not call in production code.
 */
export function _resetCwClientForTesting(): void {
  _cwClient = null;
}
