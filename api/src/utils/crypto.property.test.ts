/**
 * Property-based tests for api/src/utils/crypto.ts
 *
 * **Validates: Requirements 9.1, 9.2**
 *
 * Property 10: PII Encryption Round-Trip
 *   For any plaintext PAN or Aadhaar value V:
 *     1. decrypt(encrypt(V, key), key) === V  (round-trip fidelity)
 *     2. encrypt(V, key) !== V               (ciphertext ≠ plaintext)
 */

import * as fc from 'fast-check';
import { encrypt, decrypt } from './crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generates a random valid 64-char hex key (32 bytes / 256 bits). */
const hexKeyArbitrary = (): fc.Arbitrary<string> =>
  fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) =>
    Buffer.from(bytes).toString('hex'),
  );

/**
 * Generates realistic PAN-like strings:
 *   - 16 alphanumeric characters (matches common PAN/card-number patterns)
 *   - Also exercises shorter and longer strings to ensure the property
 *     holds for any non-empty UTF-8 plaintext.
 */
const panLikeArbitrary = (): fc.Arbitrary<string> =>
  fc.oneof(
    // Standard 16-char PAN / card number
    fc
      .tuple(
        fc.stringMatching(/^[A-Z]{5}[0-9]{4}[A-Z]$/), // Indian PAN format AAAAA9999A
      )
      .map(([s]) => s),
    // 16-digit numeric card PAN
    fc.stringMatching(/^[0-9]{16}$/),
    // Arbitrary non-empty UTF-8 string (tests the general case)
    fc.string({ minLength: 1, maxLength: 64 }),
  );

/**
 * Generates realistic Aadhaar-like strings:
 *   - 12-digit numeric strings (standard Aadhaar format)
 *   - Also arbitrary non-empty strings for general coverage.
 */
const aadhaarLikeArbitrary = (): fc.Arbitrary<string> =>
  fc.oneof(
    // Standard 12-digit Aadhaar
    fc.stringMatching(/^[1-9][0-9]{11}$/),
    // Arbitrary non-empty UTF-8 string (tests the general case)
    fc.string({ minLength: 1, maxLength: 64 }),
  );

// ---------------------------------------------------------------------------
// Property 10 — PAN Encryption Round-Trip
// ---------------------------------------------------------------------------

describe('Property 10: PAN Encryption Round-Trip (Requirement 9.1)', () => {
  it('decrypt(encrypt(pan, key), key) === pan for any PAN-like value and any valid key', () => {
    fc.assert(
      fc.property(panLikeArbitrary(), hexKeyArbitrary(), (pan, keyHex) => {
        const ciphertext = encrypt(pan, keyHex);
        const recovered = decrypt(ciphertext, keyHex);
        return recovered === pan;
      }),
      { numRuns: 100, verbose: false },
    );
  });

  it('encrypt(pan, key) !== pan for any PAN-like value and any valid key', () => {
    fc.assert(
      fc.property(panLikeArbitrary(), hexKeyArbitrary(), (pan, keyHex) => {
        const ciphertext = encrypt(pan, keyHex);
        return ciphertext !== pan;
      }),
      { numRuns: 100, verbose: false },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10 — Aadhaar Encryption Round-Trip
// ---------------------------------------------------------------------------

describe('Property 10: Aadhaar Encryption Round-Trip (Requirement 9.2)', () => {
  it('decrypt(encrypt(aadhaar, key), key) === aadhaar for any Aadhaar-like value and any valid key', () => {
    fc.assert(
      fc.property(aadhaarLikeArbitrary(), hexKeyArbitrary(), (aadhaar, keyHex) => {
        const ciphertext = encrypt(aadhaar, keyHex);
        const recovered = decrypt(ciphertext, keyHex);
        return recovered === aadhaar;
      }),
      { numRuns: 100, verbose: false },
    );
  });

  it('encrypt(aadhaar, key) !== aadhaar for any Aadhaar-like value and any valid key', () => {
    fc.assert(
      fc.property(aadhaarLikeArbitrary(), hexKeyArbitrary(), (aadhaar, keyHex) => {
        const ciphertext = encrypt(aadhaar, keyHex);
        return ciphertext !== aadhaar;
      }),
      { numRuns: 100, verbose: false },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10 — Key isolation: different keys cannot decrypt each other's output
// ---------------------------------------------------------------------------

describe('Property 10: Key Isolation (Requirements 9.1, 9.2)', () => {
  it('decrypting with a different key always throws for any plaintext', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }),
        hexKeyArbitrary(),
        hexKeyArbitrary(),
        (plaintext, keyA, keyB) => {
          // Only run when keys are different
          fc.pre(keyA !== keyB);
          const ciphertext = encrypt(plaintext, keyA);
          expect(() => decrypt(ciphertext, keyB)).toThrow();
        },
      ),
      { numRuns: 100, verbose: false },
    );
  });
});
