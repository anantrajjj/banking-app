/**
 * Unit tests for api/src/utils/crypto.ts
 *
 * Covers:
 *   - encrypt → decrypt round-trip returns original plaintext
 *   - each call to encrypt produces a different ciphertext (random IV)
 *   - masked PAN shows only last 4 chars with X prefix
 *   - masked Aadhaar shows only last 4 digits with X prefix
 *   - decrypting with the wrong key throws CryptoError
 *   - decrypting a tampered ciphertext throws CryptoError
 *   - validateKeyHex rejects invalid keys
 */

import { encrypt, decrypt, maskPan, maskAadhaar, validateKeyHex, CryptoError } from './crypto';

// A valid 64-character hex key (32 bytes / 256 bits)
const VALID_KEY = 'a'.repeat(64);
const DIFFERENT_KEY = 'b'.repeat(64);

describe('encrypt / decrypt', () => {
  it('round-trip: decrypt(encrypt(plaintext)) === plaintext', () => {
    const plaintext = 'ABCDE1234F'; // sample PAN-like value
    const ciphertext = encrypt(plaintext, VALID_KEY);
    const recovered = decrypt(ciphertext, VALID_KEY);
    expect(recovered).toBe(plaintext);
  });

  it('round-trip with Aadhaar value', () => {
    const aadhaar = '123456785678';
    const ciphertext = encrypt(aadhaar, VALID_KEY);
    const recovered = decrypt(ciphertext, VALID_KEY);
    expect(recovered).toBe(aadhaar);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'ABCDE1234F';
    const ct1 = encrypt(plaintext, VALID_KEY);
    const ct2 = encrypt(plaintext, VALID_KEY);
    // Same plaintext, same key → different output because IV is random
    expect(ct1).not.toBe(ct2);
  });

  it('ciphertext is not equal to plaintext', () => {
    const plaintext = 'ABCDE1234F';
    const ciphertext = encrypt(plaintext, VALID_KEY);
    expect(ciphertext).not.toBe(plaintext);
  });

  it('decrypting with wrong key throws CryptoError', () => {
    const ciphertext = encrypt('sensitive-value', VALID_KEY);
    expect(() => decrypt(ciphertext, DIFFERENT_KEY)).toThrow(CryptoError);
  });

  it('decrypting tampered ciphertext throws CryptoError', () => {
    const ciphertext = encrypt('sensitive-value', VALID_KEY);
    // Flip a byte near the end of the base64 to tamper with the ciphertext
    const buf = Buffer.from(ciphertext, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered, VALID_KEY)).toThrow(CryptoError);
  });

  it('CryptoError has the correct name', () => {
    const ciphertext = encrypt('test', VALID_KEY);
    try {
      decrypt(ciphertext, DIFFERENT_KEY);
      fail('Expected CryptoError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CryptoError);
      expect((err as CryptoError).name).toBe('CryptoError');
    }
  });
});

describe('maskPan', () => {
  it('masks a 16-character PAN showing only last 4', () => {
    const result = maskPan('1234567890123456');
    expect(result).toBe('XXXXXXXXXXXX3456');
    expect(result.length).toBe(16);
  });

  it('masks an 11-character PAN showing only last 4 (spec example: XXXXXXX1234)', () => {
    const result = maskPan('12345671234');
    expect(result).toBe('XXXXXXX1234');
    expect(result.length).toBe(11);
  });

  it('last 4 characters are always visible', () => {
    const pan = 'ABCDE1234F9876';
    const result = maskPan(pan);
    expect(result.endsWith('9876')).toBe(true);
    expect(result.startsWith('XXXXXXXXXX')).toBe(true);
  });

  it('does not mask a string of 4 or fewer chars', () => {
    expect(maskPan('1234')).toBe('1234');
    expect(maskPan('12')).toBe('12');
  });
});

describe('maskAadhaar', () => {
  it('masks a 12-digit Aadhaar showing only last 4 (spec example: XXXXXXXX5678)', () => {
    const result = maskAadhaar('123456785678');
    expect(result).toBe('XXXXXXXX5678');
    expect(result.length).toBe(12);
  });

  it('last 4 digits are always visible', () => {
    const result = maskAadhaar('999988885678');
    expect(result.endsWith('5678')).toBe(true);
    expect(result.slice(0, -4)).toBe('X'.repeat(8));
  });

  it('does not mask a string of 4 or fewer chars', () => {
    expect(maskAadhaar('5678')).toBe('5678');
    expect(maskAadhaar('56')).toBe('56');
  });
});

describe('validateKeyHex', () => {
  it('accepts a valid 64-character hex key', () => {
    expect(() => validateKeyHex(VALID_KEY)).not.toThrow();
    expect(() => validateKeyHex('0123456789abcdefABCDEF'.repeat(2) + '00000000000000000000')).not.toThrow();
  });

  it('rejects a key that is too short', () => {
    expect(() => validateKeyHex('a'.repeat(32))).toThrow(CryptoError);
  });

  it('rejects a key that is too long', () => {
    expect(() => validateKeyHex('a'.repeat(128))).toThrow(CryptoError);
  });

  it('rejects a key with non-hex characters', () => {
    expect(() => validateKeyHex('g'.repeat(64))).toThrow(CryptoError);
  });

  it('rejects an empty string', () => {
    expect(() => validateKeyHex('')).toThrow(CryptoError);
  });
});
