-- =============================================================================
-- Migration 002: Fixed Deposits
-- =============================================================================

CREATE TABLE fixed_deposits (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_account_id     UUID          NOT NULL REFERENCES accounts(id),
  source_account_id UUID          NOT NULL REFERENCES accounts(id),
  customer_id       UUID          NOT NULL REFERENCES users(id),
  principal         NUMERIC(18,2) NOT NULL CHECK (principal >= 1000),
  interest_rate     NUMERIC(6,4)  NOT NULL,
  tenure_months     SMALLINT      NOT NULL CHECK (tenure_months > 0),
  compounding       VARCHAR(10)   NOT NULL DEFAULT 'QUARTERLY'
                    CHECK (compounding IN ('MONTHLY','QUARTERLY','ANNUALLY')),
  status            VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','MATURED','CLOSED')),
  maturity_date     TIMESTAMPTZ   NOT NULL,
  maturity_amount   NUMERIC(18,2) NOT NULL,
  interest_earned   NUMERIC(18,2) NOT NULL,
  -- Premature closure fields
  premature_closed_at TIMESTAMPTZ,
  penalty_rate        NUMERIC(6,4),
  penalty_amount      NUMERIC(18,2),
  actual_payout       NUMERIC(18,2),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fd_customer    ON fixed_deposits(customer_id);
CREATE INDEX idx_fd_fd_account  ON fixed_deposits(fd_account_id);
CREATE INDEX idx_fd_status_mat  ON fixed_deposits(status, maturity_date);
