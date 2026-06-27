-- =============================================================================
-- Migration 003: Debit Cards
-- =============================================================================

CREATE TABLE debit_cards (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               UUID          NOT NULL REFERENCES accounts(id) UNIQUE,
  customer_id              UUID          NOT NULL REFERENCES users(id),
  card_number_enc          TEXT          NOT NULL,   -- AES-256-GCM, base64
  last_four                VARCHAR(4)    NOT NULL,
  cvv_enc                  TEXT          NOT NULL,   -- AES-256-GCM, base64
  expiry_month             SMALLINT      NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year              SMALLINT      NOT NULL,
  cardholder_name          VARCHAR(100)  NOT NULL,
  network                  VARCHAR(10)   NOT NULL DEFAULT 'RUPAY'
                           CHECK (network IN ('VISA','MASTERCARD','RUPAY')),
  status                   VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('ACTIVE','BLOCKED','EXPIRED')),
  -- Controls
  is_domestic_enabled      BOOLEAN       NOT NULL DEFAULT TRUE,
  is_international_enabled BOOLEAN       NOT NULL DEFAULT FALSE,
  is_atm_enabled           BOOLEAN       NOT NULL DEFAULT TRUE,
  is_online_enabled        BOOLEAN       NOT NULL DEFAULT TRUE,
  -- Limits (INR)
  daily_atm_limit          NUMERIC(18,2) NOT NULL DEFAULT 25000,
  daily_pos_limit          NUMERIC(18,2) NOT NULL DEFAULT 100000,
  per_transaction_limit    NUMERIC(18,2) NOT NULL DEFAULT 50000,
  monthly_limit            NUMERIC(18,2) NOT NULL DEFAULT 300000,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cards_customer ON debit_cards(customer_id);
