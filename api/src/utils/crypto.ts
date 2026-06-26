/**
 * AES-256-GCM encryption/decryption utilities for PAN and Aadhaar PII fields.
 * Uses Node.js built-in `crypto` module exclusively — no external dependencies.
 *
 * Ciphertext wire format (Base64-encoded):
 *   [ IV (12 bytes) | AuthTag (16 bytes) | Ciphertext (variable) ]
 */

import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Custom error type
// ---------------------------------------------------------------------------

export class CryptoError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------

const KEY_HEX_LENGTH = 64; // 32 bytes × 2 hex chars = 64 chars
const HEX_REGEX = /^[0-9a-fA-F]+$/;

/**
 * Validates that keyHex is a 64-character hexadecimal string (32 bytes / 256 bits).
 * Throws CryptoError if the key is invalid.
 */
export function validateKeyHex(keyHex: string): void {
  if (typeof keyHex !== 'string' || keyHex.length !== KEY_HEX_LENGTH) {
    throw new CryptoError(
      `Invalid AES-256 key: expected a ${KEY_HEX_LENGTH}-character hex string, got length ${typeof keyHex === 'string' ? keyHex.length : typeof keyHex}.`,
    );
  }
  if (!HEX_REGEX.test(keyHex)) {
    throw new CryptoError('Invalid AES-256 key: key contains non-hexadecimal characters.');
  }
}

// ---------------------------------------------------------------------------
// Wire-format constants
// ---------------------------------------------------------------------------

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm' as const;

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypts `plaintext` using AES-256-GCM with a randomly generated 12-byte IV.
 *
 * @param plaintext  UTF-8 string to encrypt (e.g. a PAN or Aadhaar value).
 * @param keyHex     64-character hex string representing the 32-byte AES-256 key.
 * @returns          Base64 string encoding: IV (12 B) + AuthTag (16 B) + Ciphertext.
 */
export function encrypt(plaintext: string, keyHex: string): string {
  validateKeyHex(keyHex);

  const keyBuffer = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(IV_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: IV | AuthTag | Ciphertext → Base64
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypts a Base64 ciphertext produced by `encrypt()`.
 *
 * @param ciphertextB64  Base64 string: IV (12 B) + AuthTag (16 B) + Ciphertext.
 * @param keyHex         64-character hex string for the AES-256 key.
 * @returns              Original plaintext UTF-8 string.
 * @throws CryptoError   If the key is invalid, the buffer is too short, or GCM
 *                       authentication fails (tampered ciphertext / wrong key).
 */
export function decrypt(ciphertextB64: string, keyHex: string): string {
  validateKeyHex(keyHex);

  const combined = Buffer.from(ciphertextB64, 'base64');

  const minimumLength = IV_BYTES + AUTH_TAG_BYTES;
  if (combined.length < minimumLength) {
    throw new CryptoError(
      `Ciphertext is too short: expected at least ${minimumLength} bytes, got ${combined.length}.`,
    );
  }

  const iv = combined.subarray(0, IV_BYTES);
  const authTag = combined.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = combined.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const keyBuffer = Buffer.from(keyHex, 'hex');

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new CryptoError(
      'Decryption failed: invalid key or tampered ciphertext.',
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Masking helpers
// ---------------------------------------------------------------------------

/**
 * Masks a PAN, keeping only the last 4 characters visible.
 *
 * Example: "1234567890123456" → "XXXXXXXXXXXX3456" (preserves actual length)
 * Per the spec example "XXXXXXX1234", the last-4 rule is applied regardless of PAN length.
 *
 * @param pan  The plaintext PAN string.
 * @returns    Masked string with all characters except the last 4 replaced by 'X'.
 */
export function maskPan(pan: string): string {
  if (pan.length <= 4) {
    return pan;
  }
  const visibleChars = pan.slice(-4);
  const maskedPrefix = 'X'.repeat(pan.length - 4);
  return maskedPrefix + visibleChars;
}

/**
 * Masks an Aadhaar number, keeping only the last 4 digits visible.
 *
 * Example: "123456785678" → "XXXXXXXX5678" (12-digit Aadhaar → 8 X's + last 4)
 *
 * @param aadhaar  The plaintext Aadhaar string (12 digits).
 * @returns        Masked string with all characters except the last 4 replaced by 'X'.
 */
export function maskAadhaar(aadhaar: string): string {
  if (aadhaar.length <= 4) {
    return aadhaar;
  }
  const visibleDigits = aadhaar.slice(-4);
  const maskedPrefix = 'X'.repeat(aadhaar.length - 4);
  return maskedPrefix + visibleDigits;
}
