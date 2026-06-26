/**
 * Property-Based Test: Property 13 — Password Storage Never Plaintext
 *
 * **Validates: Requirements 1.8**
 *
 * Requirement 1.8: THE Auth_Service SHALL store all passwords as bcrypt hashes with a work
 * factor of no less than 12; THE Auth_Service SHALL never store, log, or include plaintext
 * passwords in any application log, debug output, or audit trail.
 *
 * Property: For any password P,
 *   1. bcrypt.hash(P, 12) produces a valid bcrypt string starting with "$2b$12$"
 *   2. The stored hash does NOT equal the plaintext password P
 *   3. bcrypt.compare(P, hash) returns true (hash is verifiable)
 *   4. The cost factor embedded in the hash is ≥ 12
 */

import * as fc from 'fast-check';
import * as bcrypt from 'bcrypt';

const BCRYPT_COST = 12;

// Regex for a valid bcrypt hash with cost ≥ 12:
//   $2b$<cost>$<22-char salt><31-char hash>
// The cost field is zero-padded to 2 digits, so 12 → "12", 13 → "13", etc.
const VALID_BCRYPT_PREFIX_REGEX = /^\$2[ab]\$(\d{2})\$.{53}$/;

/**
 * Extracts the numeric cost factor from a bcrypt hash string.
 * E.g., "$2b$12$..." → 12
 */
function extractCostFactor(hash: string): number {
  const match = hash.match(/^\$2[ab]\$(\d{2})\$/);
  if (!match) {
    throw new Error(`Cannot parse cost factor from bcrypt hash: ${hash}`);
  }
  return parseInt(match[1], 10);
}

describe('Property 13: Password Storage Never Plaintext', () => {
  // Use a longer timeout because bcrypt with cost 12 takes ~250ms per hash.
  // 100 iterations × ~250ms = ~25s, so we allow 60s.
  jest.setTimeout(60_000);

  it('for any password P, bcrypt.hash(P, 12) produces a valid bcrypt string that does not equal P', async () => {
    /**
     * **Validates: Requirements 1.8**
     *
     * This property verifies that:
     * (a) The hash starts with the bcrypt identifier prefix "$2b$12$"
     *     (valid bcrypt format with cost factor 12).
     * (b) The hash is not equal to the plaintext password.
     * (c) The cost factor embedded in the hash is ≥ 12.
     * (d) bcrypt.compare confirms the hash correctly verifies against the password.
     */
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary non-empty password strings.
        // bcrypt accepts passwords up to 72 bytes; we use printable ASCII strings
        // of 1–72 characters to cover realistic password inputs.
        fc.string({ minLength: 1, maxLength: 72 }),
        async (password) => {
          const hash = await bcrypt.hash(password, BCRYPT_COST);

          // (a) Hash must be a valid bcrypt string
          expect(hash).toMatch(VALID_BCRYPT_PREFIX_REGEX);

          // (b) Hash must not equal the plaintext password
          expect(hash).not.toBe(password);

          // (c) Cost factor embedded in the hash must be ≥ 12
          const cost = extractCostFactor(hash);
          expect(cost).toBeGreaterThanOrEqual(12);

          // (d) bcrypt.compare must verify the hash against the original password
          const isValid = await bcrypt.compare(password, hash);
          expect(isValid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('same password hashed twice produces different hashes (salt randomness)', async () => {
    /**
     * **Validates: Requirements 1.8**
     *
     * Bcrypt incorporates a random salt, so the same password produces distinct
     * hashes on repeated calls. This confirms passwords are not stored deterministically,
     * preventing hash lookup table attacks.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 72 }),
        async (password) => {
          const hash1 = await bcrypt.hash(password, BCRYPT_COST);
          const hash2 = await bcrypt.hash(password, BCRYPT_COST);
          expect(hash1).not.toBe(hash2);
        },
      ),
      { numRuns: 10 }, // fewer runs since this is a secondary property and bcrypt is slow
    );
  });

  it('a hash for password P does not verify against a different password Q', async () => {
    /**
     * **Validates: Requirements 1.8**
     *
     * Confirms that bcrypt.compare correctly rejects a hash when a different password
     * is supplied — ensuring the hash uniquely binds to its original password.
     */
    await fc.assert(
      fc.asyncProperty(
        // Generate two distinct passwords
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 72 }),
          fc.string({ minLength: 1, maxLength: 72 }),
        ).filter(([p, q]) => p !== q),
        async ([password, otherPassword]) => {
          const hash = await bcrypt.hash(password, BCRYPT_COST);
          const wrongMatch = await bcrypt.compare(otherPassword, hash);
          expect(wrongMatch).toBe(false);
        },
      ),
      { numRuns: 10 }, // fewer runs due to bcrypt cost
    );
  });
});
