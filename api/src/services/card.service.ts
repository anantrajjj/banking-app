/**
 * Debit Card Service
 *
 * Card numbers and CVVs are stored AES-256-GCM encrypted (same key as PAN/Aadhaar).
 * The reveal endpoint decrypts and returns details; the frontend auto-hides after 30 s.
 *
 * seedDemoCards() — ADMIN-only helper that generates realistic RuPay card data
 * for every account that does not yet have a linked card.
 */

import { randomBytes } from 'crypto';
import { query } from '../db/index';
import { encrypt, decrypt } from '../utils/crypto';
import { getSecret } from '../utils/secrets';
import { ServiceError } from './account.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CardSummary {
  id: string;
  account_id: string;
  last_four: string;
  expiry: string;         // "MM/YY"
  cardholder_name: string;
  network: 'VISA' | 'MASTERCARD' | 'RUPAY';
  status: 'ACTIVE' | 'BLOCKED' | 'EXPIRED';
  is_domestic_enabled: boolean;
  is_international_enabled: boolean;
  is_atm_enabled: boolean;
  is_online_enabled: boolean;
  daily_atm_limit: number;
  daily_pos_limit: number;
  per_transaction_limit: number;
  monthly_limit: number;
}

export interface CardReveal {
  number: string;   // formatted "XXXX XXXX XXXX XXXX"
  cvv: string;
  expiry: string;   // "MM/YY"
}

export interface CardSettings {
  is_domestic_enabled?: boolean;
  is_international_enabled?: boolean;
  is_atm_enabled?: boolean;
  is_online_enabled?: boolean;
  daily_atm_limit?: number;
  daily_pos_limit?: number;
  per_transaction_limit?: number;
  monthly_limit?: number;
}

interface RawCard {
  id: string;
  account_id: string;
  card_number_enc: string;
  last_four: string;
  cvv_enc: string;
  expiry_month: number;
  expiry_year: number;
  cardholder_name: string;
  network: 'VISA' | 'MASTERCARD' | 'RUPAY';
  status: 'ACTIVE' | 'BLOCKED' | 'EXPIRED';
  is_domestic_enabled: boolean;
  is_international_enabled: boolean;
  is_atm_enabled: boolean;
  is_online_enabled: boolean;
  daily_atm_limit: string;
  daily_pos_limit: string;
  per_transaction_limit: string;
  monthly_limit: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSummary(r: RawCard): CardSummary {
  const mm = String(r.expiry_month).padStart(2, '0');
  const yy = String(r.expiry_year).slice(-2);
  return {
    id: r.id,
    account_id: r.account_id,
    last_four: r.last_four,
    expiry: `${mm}/${yy}`,
    cardholder_name: r.cardholder_name,
    network: r.network,
    status: r.status,
    is_domestic_enabled: r.is_domestic_enabled,
    is_international_enabled: r.is_international_enabled,
    is_atm_enabled: r.is_atm_enabled,
    is_online_enabled: r.is_online_enabled,
    daily_atm_limit: parseFloat(r.daily_atm_limit),
    daily_pos_limit: parseFloat(r.daily_pos_limit),
    per_transaction_limit: parseFloat(r.per_transaction_limit),
    monthly_limit: parseFloat(r.monthly_limit),
  };
}

/** Generate a random 16-digit RuPay number (60-prefix, Luhn-unchecked for demo). */
function generateCardNumber(): string {
  const prefix = '6071'; // RuPay BIN
  const middle = randomBytes(5).toString('hex').slice(0, 8);
  const last4  = randomBytes(2).toString('hex').slice(0, 4);
  return prefix + middle + last4;
}

/** Generate a 3-digit CVV. */
function generateCvv(): string {
  return String(Math.floor(100 + Math.random() * 900));
}

// ---------------------------------------------------------------------------
// listCardsForCustomer — returns all cards (masked), keyed by account_id
// ---------------------------------------------------------------------------

export async function listCardsForCustomer(customerId: string): Promise<CardSummary[]> {
  const res = await query<RawCard>(
    `SELECT * FROM debit_cards WHERE customer_id = $1 ORDER BY created_at ASC`,
    [customerId],
  );
  return res.rows.map(toSummary);
}

// ---------------------------------------------------------------------------
// revealCard — decrypts and returns full card details
// ---------------------------------------------------------------------------

export async function revealCard(cardId: string, customerId: string): Promise<CardReveal> {
  const res = await query<RawCard>(
    `SELECT * FROM debit_cards WHERE id = $1 AND customer_id = $2`,
    [cardId, customerId],
  );
  if (res.rows.length === 0) throw new ServiceError(404, 'NOT_FOUND', 'Card not found');

  const row = res.rows[0];
  const aesKey = await getSecret('AES_256_KEY');
  const fullNumber = decrypt(row.card_number_enc, aesKey);
  const cvv = decrypt(row.cvv_enc, aesKey);

  // Format as groups of 4
  const formatted = (fullNumber.match(/.{1,4}/g) ?? [fullNumber]).join(' ');
  const mm = String(row.expiry_month).padStart(2, '0');
  const yy = String(row.expiry_year).slice(-2);

  return { number: formatted, cvv, expiry: `${mm}/${yy}` };
}

// ---------------------------------------------------------------------------
// updateCardSettings
// ---------------------------------------------------------------------------

export async function updateCardSettings(
  cardId: string,
  customerId: string,
  settings: CardSettings,
): Promise<CardSummary> {
  const existing = await query<RawCard>(
    `SELECT * FROM debit_cards WHERE id = $1 AND customer_id = $2`,
    [cardId, customerId],
  );
  if (existing.rows.length === 0) throw new ServiceError(404, 'NOT_FOUND', 'Card not found');
  if (existing.rows[0].status === 'BLOCKED') {
    throw new ServiceError(400, 'CARD_BLOCKED', 'Cannot update settings on a blocked card');
  }

  // Build dynamic SET clause
  const updates: string[] = [];
  const params: unknown[] = [];
  let pi = 1;

  const BOOL_FIELDS = [
    'is_domestic_enabled', 'is_international_enabled',
    'is_atm_enabled', 'is_online_enabled',
  ] as const;
  const NUM_FIELDS = [
    'daily_atm_limit', 'daily_pos_limit',
    'per_transaction_limit', 'monthly_limit',
  ] as const;

  for (const f of BOOL_FIELDS) {
    if (settings[f] !== undefined) {
      updates.push(`${f} = $${pi++}`);
      params.push(settings[f]);
    }
  }
  for (const f of NUM_FIELDS) {
    if (settings[f] !== undefined) {
      if ((settings[f] as number) < 0) {
        throw new ServiceError(400, 'INVALID_LIMIT', `${f} cannot be negative`);
      }
      updates.push(`${f} = $${pi++}`);
      params.push(settings[f]);
    }
  }

  if (updates.length === 0) throw new ServiceError(400, 'NO_CHANGES', 'No settings provided');

  updates.push(`updated_at = NOW()`);
  params.push(cardId);

  const res = await query<RawCard>(
    `UPDATE debit_cards SET ${updates.join(', ')} WHERE id = $${pi} RETURNING *`,
    params,
  );
  return toSummary(res.rows[0]);
}

// ---------------------------------------------------------------------------
// seedDemoCards — ADMIN helper: creates cards for all card-less accounts
// ---------------------------------------------------------------------------

export async function seedDemoCards(): Promise<{ created: number }> {
  const aesKey = await getSecret('AES_256_KEY');

  // Find accounts with no card
  const accounts = await query<{
    id: string; user_id: string; account_number: string;
  }>(
    `SELECT a.id, a.user_id, a.account_number
     FROM accounts a
     LEFT JOIN debit_cards dc ON dc.account_id = a.id
     WHERE dc.id IS NULL AND a.is_active = TRUE AND a.account_type != 'FD'`,
    [],
  );

  if (accounts.rows.length === 0) return { created: 0 };

  // Get cardholder names from users table
  const userIds = [...new Set(accounts.rows.map((r) => r.user_id))];
  const usersRes = await query<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE id = ANY($1)`,
    [userIds],
  );
  const nameMap = new Map(usersRes.rows.map((u) => [u.id, u.username.toUpperCase()]));

  let created = 0;
  for (const acc of accounts.rows) {
    const cardNumber = generateCardNumber();
    const cvv = generateCvv();
    const cardNumberEnc = encrypt(cardNumber, aesKey);
    const cvvEnc = encrypt(cvv, aesKey);
    const lastFour = cardNumber.slice(-4);
    const expiryMonth = Math.ceil(Math.random() * 12) || 1;
    const expiryYear = new Date().getFullYear() + 3 + Math.floor(Math.random() * 3);
    const cardholderName = nameMap.get(acc.user_id) ?? 'ACCOUNT HOLDER';

    await query(
      `INSERT INTO debit_cards
         (account_id, customer_id, card_number_enc, last_four, cvv_enc,
          expiry_month, expiry_year, cardholder_name, network)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RUPAY')
       ON CONFLICT (account_id) DO NOTHING`,
      [acc.id, acc.user_id, cardNumberEnc, lastFour, cvvEnc,
       expiryMonth, expiryYear, cardholderName],
    );
    created++;
  }

  return { created };
}
