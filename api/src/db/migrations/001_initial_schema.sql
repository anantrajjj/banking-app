-- =============================================================================
-- Migration 001: Initial Schema
-- SecureBank — PostgreSQL 15
--
-- This migration creates all core tables and indexes for the SecureBank
-- application. It is designed to be applied once against a fresh database.
-- =============================================================================

-- ───────────────────────────────────────────────
-- USERS (authentication + identity)
-- ───────────────────────────────────────────────
CREATE TABLE users (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username          VARCHAR(100) UNIQUE NOT NULL,
  email             VARCHAR(255) UNIQUE NOT NULL,
  phone             VARCHAR(20)  NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role              VARCHAR(20)  NOT NULL
                    CHECK (role IN ('CUSTOMER','BRANCH_MANAGER','ADMIN')),
  pan_encrypted     BYTEA,
  aadhaar_encrypted BYTEA,
  failed_attempts   SMALLINT     NOT NULL DEFAULT 0,
  is_locked         BOOLEAN      NOT NULL DEFAULT FALSE,
  locked_reason     VARCHAR(255),
  otp_channel       VARCHAR(10)  NOT NULL DEFAULT 'EMAIL'
                    CHECK (otp_channel IN ('EMAIL','SMS')),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ───────────────────────────────────────────────
-- ACCOUNTS
-- ───────────────────────────────────────────────
CREATE TABLE accounts (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NOT NULL REFERENCES users(id),
  account_number    VARCHAR(20)   UNIQUE NOT NULL,
  account_type      VARCHAR(10)   NOT NULL
                    CHECK (account_type IN ('SAVINGS','CURRENT','FD')),
  available_balance NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  currency          CHAR(3)       NOT NULL DEFAULT 'INR',
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_accounts_user_id ON accounts(user_id);

-- ───────────────────────────────────────────────
-- TRANSACTIONS / LEDGER ENTRIES
-- ───────────────────────────────────────────────
CREATE TABLE transactions (
  id               BIGSERIAL     PRIMARY KEY,
  transfer_ref_id  UUID          NOT NULL,
  account_id       UUID          NOT NULL REFERENCES accounts(id),
  entry_type       VARCHAR(6)    NOT NULL CHECK (entry_type IN ('DEBIT','CREDIT')),
  amount           NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency         CHAR(3)       NOT NULL DEFAULT 'INR',
  running_balance  NUMERIC(18,2) NOT NULL,
  transfer_mode    VARCHAR(5)    NOT NULL CHECK (transfer_mode IN ('NEFT','IMPS','INTERNAL')),
  narration        VARCHAR(500),
  transaction_date TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_txn_account_date ON transactions(account_id, transaction_date DESC);
CREATE INDEX idx_txn_transfer_ref ON transactions(transfer_ref_id);

-- ───────────────────────────────────────────────
-- TRANSFERS (double-entry header)
-- ───────────────────────────────────────────────
CREATE TABLE transfers (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID          NOT NULL REFERENCES users(id),
  source_account_id UUID          NOT NULL REFERENCES accounts(id),
  dest_account_id   UUID          NOT NULL REFERENCES accounts(id),
  amount            NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency          CHAR(3)       NOT NULL DEFAULT 'INR',
  transfer_mode     VARCHAR(5)    NOT NULL CHECK (transfer_mode IN ('NEFT','IMPS')),
  idempotency_key   UUID          UNIQUE NOT NULL,
  status            VARCHAR(15)   NOT NULL DEFAULT 'COMPLETED'
                    CHECK (status IN ('COMPLETED','FAILED','PENDING')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transfers_idempotency ON transfers(idempotency_key);
CREATE INDEX idx_transfers_customer    ON transfers(customer_id);

-- ───────────────────────────────────────────────
-- BENEFICIARIES
-- ───────────────────────────────────────────────
CREATE TABLE beneficiaries (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID          NOT NULL REFERENCES users(id),
  account_number VARCHAR(20)   NOT NULL,
  ifsc_code      VARCHAR(15)   NOT NULL,
  name           VARCHAR(255)  NOT NULL,
  bank_name      VARCHAR(255),
  status         VARCHAR(10)   NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','VERIFIED','DELETED')),
  verified_by    UUID          REFERENCES users(id),
  verified_at    TIMESTAMPTZ,
  daily_limit    NUMERIC(18,2) NOT NULL DEFAULT 10000.00,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bene_owner ON beneficiaries(owner_user_id);

-- ───────────────────────────────────────────────
-- LOAN_APPLICATIONS
-- ───────────────────────────────────────────────
CREATE TABLE loan_applications (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID          NOT NULL REFERENCES users(id),
  gross_monthly_income NUMERIC(18,2) NOT NULL CHECK (gross_monthly_income > 0),
  existing_emi         NUMERIC(18,2) NOT NULL CHECK (existing_emi >= 0),
  loan_amount          NUMERIC(18,2) NOT NULL CHECK (loan_amount > 0),
  tenure_months        SMALLINT      NOT NULL CHECK (tenure_months > 0),
  annual_interest_rate NUMERIC(6,4)  NOT NULL,
  calculated_emi       NUMERIC(18,2),
  total_payable        NUMERIC(18,2),
  effective_rate       NUMERIC(6,4),
  decision             VARCHAR(10)   NOT NULL
                       CHECK (decision IN ('APPROVED','REJECTED','PENDING')),
  rejection_reason     VARCHAR(100),
  submitted_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_loan_customer ON loan_applications(customer_id);
CREATE INDEX idx_loan_decision  ON loan_applications(decision);

-- ───────────────────────────────────────────────
-- REFRESH_TOKENS
-- ───────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id),
  token_hash  VARCHAR(255) UNIQUE NOT NULL,
  issued_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID         REFERENCES refresh_tokens(id),
  user_agent  VARCHAR(500),
  ip_address  INET
);
CREATE INDEX idx_rt_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_rt_token_hash ON refresh_tokens(token_hash);

-- ───────────────────────────────────────────────
-- OTP_CHALLENGES
-- ───────────────────────────────────────────────
CREATE TABLE otp_challenges (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id),
  otp_hash   VARCHAR(255) NOT NULL,
  channel    VARCHAR(5)   NOT NULL CHECK (channel IN ('EMAIL','SMS')),
  issued_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ  NOT NULL,
  used_at    TIMESTAMPTZ,
  is_used    BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_otp_user_id ON otp_challenges(user_id);
