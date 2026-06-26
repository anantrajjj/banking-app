# Implementation Plan: SecureBank

## Overview

Incremental implementation of the SecureBank three-tier banking application using Node.js/Express (TypeScript) for the API, React 18 + TypeScript for the frontend, PostgreSQL on RDS for persistence, Redis for session/token management, and Terraform for infrastructure. Tasks are ordered to build and integrate each layer progressively, from database schema through services, middleware, frontend, infrastructure, and CI/CD.

---

## Tasks

- [x] 1. Project scaffold and database schema
  - [x] 1.1 Initialise monorepo structure with `api/`, `frontend/`, `infrastructure/` directories; configure TypeScript, ESLint, Prettier, and Jest for the API package
    - Create `api/tsconfig.json`, `api/package.json` with `express`, `pg`, `ioredis`, `jsonwebtoken`, `bcrypt`, `ajv`, `helmet`, `express-rate-limit`, `aws-sdk` (v3), `fast-check` (dev) dependencies pinned to exact versions
    - _Requirements: 14.1_
  - [x] 1.2 Write and apply the full PostgreSQL schema migration
    - Create `api/src/db/migrations/001_initial_schema.sql` with all `CREATE TABLE` and `CREATE INDEX` statements from the design (`users`, `accounts`, `transactions`, `transfers`, `beneficiaries`, `loan_applications`, `refresh_tokens`, `otp_challenges`)
    - _Requirements: 9.1, 9.2, 15.4, 15.5_
  - [x] 1.3 Implement the `db` module (`api/src/db/index.ts`) with a pg connection pool that reads credentials exclusively from AWS Secrets Manager (or env-var fallback with WARNING log); implement graceful shutdown
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 2. Secrets and PII encryption utilities
  - [x] 2.1 Implement `api/src/utils/secrets.ts` — fetch DB URL, JWT signing key, AES-256 key, and third-party API keys from Secrets Manager; cache in memory for up to 1 hour; fall back to env vars with WARNING; abort with FATAL log if all sources fail
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 9.5, 9.6_
  - [x] 2.2 Implement `api/src/utils/crypto.ts` — AES-256-GCM encrypt/decrypt functions for PAN and Aadhaar; masked display helpers (`XXXXXXX1234`, `XXXXXXXX5678`)
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x]* 2.3 Write property test for PII encryption round-trip (Property 10)
    - **Property 10: PII Encryption Round-Trip**
    - For any plaintext PAN or Aadhaar V, encrypt(V) then decrypt produces V; ciphertext ≠ plaintext
    - **Validates: Requirements 9.1, 9.2**
  - [x]* 2.4 Write property test for password storage (Property 13)
    - **Property 13: Password Storage Never Plaintext**
    - For any password P, stored hash is a valid bcrypt string with cost ≥ 12 and does not equal P
    - **Validates: Requirements 1.8**

- [x] 3. Checkpoint — schema and utilities
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. API Gateway middleware chain
  - [x] 4.1 Implement Helmet.js middleware configuration in `api/src/middleware/security.ts` setting CSP, X-Content-Type-Options, X-Frame-Options, HSTS, and Referrer-Policy
    - _Requirements: 12.1_
  - [x] 4.2 Implement JSON schema validation middleware using AJV in `api/src/middleware/validate.ts`; return HTTP 400 with per-field errors on failure or when pass/fail cannot be determined
    - _Requirements: 12.2_
  - [x] 4.3 Implement input sanitisation middleware in `api/src/middleware/sanitise.ts` stripping HTML tags and JS event handlers from all string fields
    - _Requirements: 12.3_
  - [x] 4.4 Implement JWT verification middleware in `api/src/middleware/auth.ts` — verify RS256 signature, check well-formed format, check expiry; return HTTP 401 on any failure; check token revocation list in Redis
    - _Requirements: 2.1, 2.5, 3.1, 3.5_
  - [x]* 4.5 Write property test for JWT expiry enforcement (Property 7)
    - **Property 7: JWT Expiry Enforcement**
    - For any JWT with exp < now, every protected endpoint returns HTTP 401
    - **Validates: Requirements 1.1, 2.1, 2.5, 3.5**
  - [x] 4.6 Implement RBAC middleware in `api/src/middleware/rbac.ts`; enforce role hierarchy (CUSTOMER ⊂ BRANCH_MANAGER ⊂ ADMIN); reject unknown roles with HTTP 403
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 4.7 Implement express-rate-limit middleware on `/auth/*` routes at 100 req/min per IP; return HTTP 429 on breach; apply structured JSON error response format throughout all middleware
    - _Requirements: 1.11, 12.1_

- [x] 5. Observability — structured logging and CloudWatch metrics
  - [x] 5.1 Implement `api/src/utils/logger.ts` — structured JSON logger emitting `correlation_id`, method, path, status, latency; never log PII or secrets; integrate as Express middleware
    - _Requirements: 13.1_
  - [x] 5.2 Implement `api/src/utils/metrics.ts` — publish custom CloudWatch metrics for `FailedLoginAttempt`, `AccountLockout`, `MfaFailure`, `FundTransferCompletion` via AWS SDK v3 CloudWatch client
    - _Requirements: 13.5_

- [x] 6. Auth_Service implementation
  - [x] 6.1 Implement `api/src/services/auth.service.ts` — `login()`: look up user, bcrypt.compare with cost ≥ 12, increment/reset `failed_attempts`, lock account at 5 failures (HTTP 423), generate 6-digit OTP, store bcrypt OTP hash in `otp_challenges`, deliver via AWS SNS
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8_
  - [x] 6.2 Implement `verifyMfa()` in auth.service — look up challenge, bcrypt.compare OTP, check 5-min expiry, mark `is_used`, sign RS256 JWT (15-min expiry), create and store Refresh_Token (7-day), cache JTI in Redis revocation list
    - _Requirements: 1.5, 1.6, 1.7, 1.9_
  - [x] 6.3 Implement `logout()` — revoke JWT and Refresh_Token, add both to Redis revocation list, return HTTP 200; implement `refreshToken()` — validate Refresh_Token, issue new JWT + Refresh_Token, invalidate old token
    - _Requirements: 2.3, 2.4, 1.9, 1.10_
  - [x]* 6.4 Write property test for account lockout after 5 failures (Property 8)
    - **Property 8: Account Lockout After Five Failures**
    - After exactly 5 consecutive wrong-password attempts, `is_locked = TRUE`; all subsequent attempts return HTTP 423
    - **Validates: Requirements 1.2, 1.3, 1.4**
  - [x] 6.5 Implement session inactivity logic — API Gateway resets inactivity timer on every authenticated request; after 15 consecutive inactive minutes reject with HTTP 401 and clear session state
    - _Requirements: 2.1, 2.2_

- [x] 7. Checkpoint — authentication and middleware
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Account_Service implementation
  - [x] 8.1 Implement `api/src/services/account.service.ts` — `getAccountSummary()`: parameterised query for all accounts owned by the JWT subject; return account type, available balance, masked last-4 account number; return HTTP 403 for cross-customer access; return HTTP 503 with `Retry-After: 30` on DB unavailability
    - _Requirements: 4.1, 4.3, 4.4, 4.5_
  - [x] 8.2 Implement `getMiniStatement()` — parameterised query for 10 most-recent transactions for a given account, ordered by `transaction_date DESC`; enforce account ownership; return HTTP 403 or HTTP 503 as appropriate
    - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - [x]* 8.3 Write property test for account ownership isolation (Property 9)
    - **Property 9: Account Ownership Isolation**
    - For any two distinct customers A and B, A's requests for B's account/transaction data always return HTTP 403 with no resource data
    - **Validates: Requirements 4.3, 7.7**

- [ ] 9. Transfer_Service — own-account transfers
  - [x] 9.1 Implement `api/src/services/transfer.service.ts` — `createTransfer()`: validate source and destination accounts belong to the customer; check available balance (HTTP 422 + current balance on insufficient funds); validate transfer mode is NEFT or IMPS (HTTP 400 otherwise); validate amount > 0 (HTTP 400 with `INVALID_AMOUNT`)
    - _Requirements: 5.1, 5.2, 5.6, 5.7, 15.1_
  - [x] 9.2 Implement double-entry ledger write within a single DB transaction — UPDATE source balance (debit), INSERT DEBIT ledger entry with running balance, UPDATE dest balance (credit), INSERT CREDIT ledger entry with running balance, INSERT transfer record; ROLLBACK atomically on any failure leaving both balances unchanged; verify debit amount equals credit amount (HTTP 500 with `LEDGER_INTEGRITY_ERROR` if not); associate both entries with same `transfer_ref_id` and DB-generated monotonic sequence
    - _Requirements: 5.3, 5.4, 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x]* 9.3 Write property test for double-entry bookkeeping invariant (Property 1)
    - **Property 1: Double-Entry Bookkeeping Invariant**
    - For any valid transfer, exactly one DEBIT and one CREDIT entry exist with equal amounts linked by the same `transfer_ref_id`
    - **Validates: Requirements 5.3, 15.1, 15.2, 15.3**
  - [x]* 9.4 Write property test for balance consistency after transfer (Property 6)
    - **Property 6: Balance Consistency After Transfer**
    - For any transfer of amount A from S to D: S_balance decreases by A, D_balance increases by A, and their sum is unchanged
    - **Validates: Requirements 5.3, 5.4, 15.1**
  - [x] 9.5 Implement idempotency check — before processing, look up `transfers` by `idempotency_key`; if found return original response without creating new entries
    - _Requirements: 5.5_
  - [x]* 9.6 Write property test for idempotency of fund transfers (Property 2)
    - **Property 2: Idempotency of Fund Transfers**
    - Re-submitting a request with the same idempotency key K returns the original response without creating additional ledger entries or changing balances
    - **Validates: Requirements 5.5**

- [x] 10. Transfer_Service — beneficiary management
  - [x] 10.1 Implement beneficiary CRUD in `transfer.service.ts` — `addBeneficiary()`: insert with `status = PENDING`, `daily_limit = 10000`; `verifyBeneficiary()` (BRANCH_MANAGER/ADMIN only): set `status = VERIFIED`, `daily_limit = 100000`; `deleteBeneficiary()`: set `status = DELETED`, `deleted_at = NOW()`, immediately block further transfers; retain full audit history; all queries parameterised
    - _Requirements: 6.1, 6.2, 6.4, 6.5_
  - [x] 10.2 Implement daily transfer limit enforcement — for each transfer to a beneficiary, sum transfers to that beneficiary within the current calendar day; if sum + amount > applicable limit, return HTTP 422 with `DAILY_LIMIT_EXCEEDED`, current limit, and amount already transferred today
    - _Requirements: 6.3_
  - [x]* 10.3 Write property test for transfer limit enforcement (Property 3)
    - **Property 3: Transfer Limit Enforcement**
    - For any beneficiary B with daily limit L, any sequence of transfers whose cumulative total ≥ L causes the next attempt to be rejected with HTTP 422
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 11. Checkpoint — transfer services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Transaction_Service implementation
  - [x] 12.1 Implement `api/src/services/transaction.service.ts` — `getTransactionHistory()`: enforce account ownership (HTTP 403); build parameterised query with optional filters for date range (inclusive), amount range, entry type; support page sizes of 10, 25, 50; return `PaginatedTransactions` with running balance on each record
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8_
  - [x]* 12.2 Write property test for transaction filter completeness (Property 11)
    - **Property 11: Transaction Filter Completeness**
    - For any combination of filters, every returned transaction satisfies all filters and no qualifying transaction is absent from the full result set
    - **Validates: Requirements 7.2, 7.3, 7.4**
  - [x]* 12.3 Write property test for running balance consistency (Property 12)
    - **Property 12: Running Balance Monotonic Consistency**
    - For any ordered transaction sequence, each record's `running_balance` = previous `running_balance` ± current amount (CREDIT +, DEBIT −)
    - **Validates: Requirements 7.5**
  - [x] 12.4 Implement `exportCsvStatement()` — parameterised query applying current filters, generate UTF-8 CSV, set `Content-Disposition: attachment; filename="ACC{last4}_{start}_{end}.csv"`; enforce account ownership
    - _Requirements: 7.6, 7.7, 7.8_

- [x] 13. Loan_Service implementation
  - [x] 13.1 Implement `api/src/services/loan.service.ts` — `calculateEmi()`: reducing-balance formula `EMI = P × r × (1+r)^n / ((1+r)^n − 1)`; validate all inputs > 0 (existing EMI ≥ 0), return HTTP 400 listing each invalid field on failure
    - _Requirements: 8.1, 8.4_
  - [x]* 13.2 Write property test for EMI calculation correctness (Property 5)
    - **Property 5: EMI Calculation Correctness**
    - For any valid (P, r, n) triple, calculated EMI matches the reducing-balance formula within ±0.01 INR
    - **Validates: Requirements 8.1**
  - [x] 13.3 Implement eligibility decision — if (calculated_EMI + existing_EMI) > 0.40 × gross_monthly_income return REJECTED with `EMI_EXCEEDS_INCOME_LIMIT`; otherwise return APPROVED with full breakdown; persist every request to `loan_applications`; if DB write fails set decision to PENDING, return HTTP 500, log with correlation ID
    - _Requirements: 8.2, 8.3, 8.5, 8.6_
  - [x]* 13.4 Write property test for loan EMI eligibility rule (Property 4)
    - **Property 4: Loan EMI Eligibility Rule**
    - (calculated_EMI + existing_EMI) > 0.40 × income → REJECTED; ≤ 0.40 × income → APPROVED; no input satisfies both
    - **Validates: Requirements 8.2, 8.3**
  - [x] 13.5 Implement paginated loan application listing — CUSTOMER sees own applications; BRANCH_MANAGER/ADMIN see all at 25 records/page with status, customer ID, and submission timestamp
    - _Requirements: 8.7_

- [x] 14. Checkpoint — business services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Express router and endpoint wiring
  - [x] 15.1 Create `api/src/routes/auth.routes.ts` — wire `POST /auth/login`, `POST /auth/mfa`, `POST /auth/logout`, `POST /auth/refresh` with appropriate middleware chain (rate-limit → schema-validate → sanitise → handler); add `/health` endpoint
    - _Requirements: 1.11, 2.3, 2.5, 12.2, 12.3_
  - [x] 15.2 Create `api/src/routes/account.routes.ts` — wire `GET /accounts` and `GET /accounts/:accountId/mini-statement` behind JWT + CUSTOMER RBAC middleware
    - _Requirements: 3.2, 4.1, 4.2_
  - [x] 15.3 Create `api/src/routes/transaction.routes.ts` — wire `GET /accounts/:accountId/transactions` and `GET /accounts/:accountId/transactions/export` with JWT + CUSTOMER RBAC
    - _Requirements: 3.2, 7.1, 7.6_
  - [x] 15.4 Create `api/src/routes/transfer.routes.ts` — wire `POST /transfers`, `GET /transfers/:transferId`, `POST /beneficiaries`, `GET /beneficiaries`, `DELETE /beneficiaries/:id`, `PATCH /beneficiaries/:id/verify` (BRANCH_MANAGER/ADMIN only) with appropriate RBAC
    - _Requirements: 3.2, 3.3, 5.1, 6.1, 6.2_
  - [x] 15.5 Create `api/src/routes/loan.routes.ts` — wire `POST /loans/eligibility` (CUSTOMER) and `GET /loans` (CUSTOMER + BRANCH_MANAGER + ADMIN) with RBAC
    - _Requirements: 3.2, 3.3, 8.7_
  - [x] 15.6 Assemble `api/src/app.ts` — mount Helmet, rate-limiter, body parser (100 kb limit), validate, sanitise, JWT, RBAC middleware in correct order; mount all routers under `/v1`; add centralised error handler returning standard JSON error format with correlation ID
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.1_

- [ ] 16. React SPA frontend
  - [x] 16.1 Scaffold React 18 + TypeScript frontend with NGINX in `frontend/`; configure Axios instance with base URL, `Authorization` header injection from in-memory JWT, and retry logic (3 retries, exponential backoff 200ms→400ms→800ms ±50ms jitter for HTTP 503/429)
    - _Requirements: 14.1_
  - [x] 16.2 Implement Login page with two-step flow: password form → OTP form; display generic error messages without revealing username/password distinction; handle HTTP 423 (account locked) and HTTP 429 (rate limited)
    - _Requirements: 1.2, 1.4, 1.7, 1.11_
  - [x] 16.3 Implement Account Dashboard component — display masked account number (last 4 digits), account type, available balance; display mini-statement (10 transactions); handle HTTP 503 with retry guidance
    - _Requirements: 4.1, 4.2, 4.5_
  - [x] 16.4 Implement Transaction History page — paginated table with page-size selector (10/25/50), date-range filter, amount-range filter, type filter (DEBIT/CREDIT), running balance column; CSV export button triggering file download
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x] 16.5 Implement Fund Transfer form — own-account transfer with NEFT/IMPS selector, idempotency key generated client-side (UUID v4); beneficiary list and add/delete beneficiary forms
    - _Requirements: 5.1, 5.7, 6.1, 6.4_
  - [x] 16.6 Implement Loan Eligibility form — input fields for income, existing EMI, loan amount, tenure, interest rate; display APPROVED/REJECTED decision with full EMI breakdown or rejection reason
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 17. Checkpoint — frontend and full API integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Integration and security test suites
  - [x] 18.1 Write Jest/Supertest integration tests in `api/tests/integration/` covering the happy-path and error-path flows for Auth, Account, Transfer, Transaction, and Loan endpoints against a test PostgreSQL instance with parameterised queries verified
    - _Requirements: 12.4, 14.1_
  - [x]* 18.2 Write security test suite in `api/tests/security/authz.security.test.ts` — no token → 401 on all protected routes; expired token → 401; tampered token → 401; CUSTOMER accessing ADMIN endpoint → 403; cross-customer account UUID → 403; unknown role claim → 403
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x]* 18.3 Write XSS/SQLi input sanitisation tests — submit payloads with `<script>`, `onerror=`, SQL fragments in all string fields; verify stored values are sanitised and CSP header is present
    - _Requirements: 12.3, 12.4_

- [x] 19. Terraform infrastructure — networking and compute
  - [x] 19.1 Implement `infrastructure/modules/networking/` — VPC, public subnets (ALB), private app subnets (ECS), isolated DB subnets (RDS); IGW, NAT Gateways, route tables; security groups `sg-frontend`, `sg-api`, `sg-rds` (inbound 5432 from `sg-api` only)
    - _Requirements: 11.1, 11.6_
  - [x] 19.2 Implement `infrastructure/modules/alb/` — ALB in public subnet, HTTPS listener on port 443 with ACM cert (TLS 1.2+), HTTP-to-HTTPS redirect; target groups for `/static` (frontend) and `/api` (Node.js API); attach WAF with managed SQLi and XSS rule groups
    - _Requirements: 11.2, 11.3_
  - [x] 19.3 Implement `infrastructure/modules/ecs/` — ECS cluster; Fargate task definitions for frontend (NGINX+React, 256 CPU/512 MB) and API (Node.js, 512 CPU/1024 MB) with `awslogs` log driver; task IAM role with least-privilege Secrets Manager and ECR permissions; ECS services with minimum healthy percent 50%
    - _Requirements: 11.1, 10.5, 13.2, 14.3_
  - [x] 19.4 Implement `infrastructure/modules/rds/` — Multi-AZ PostgreSQL 15 in isolated DB subnet group; parameter group; security group allowing only `sg-api` inbound on 5432
    - _Requirements: 11.1, 11.6_
  - [x] 19.5 Implement `infrastructure/modules/elasticache/` — Redis 7 cluster in private subnet for token revocation list, OTP store, rate-limit counters, and session store
    - _Requirements: 2.1, 2.3_
  - [x] 19.6 Implement `infrastructure/modules/secrets/` — Secrets Manager secrets for DB URL, JWT private key, AES-256 key, and third-party API keys; IAM policies granting read access to the ECS task role only
    - _Requirements: 10.1, 10.5_

- [x] 20. Terraform infrastructure — observability and CI/CD
  - [x] 20.1 Implement `infrastructure/modules/monitoring/` — CloudWatch log groups `/ecs/securebank-frontend` and `/ecs/securebank-api`; CloudWatch alarms for API 5xx error rate > 5% over 5 min, 4xx spike, RDS CPU > 80%, ECS memory > 90%; SNS topic `securebank-alerts` with email subscriber; alarm → SNS within 60 seconds
    - _Requirements: 13.2, 13.3, 13.4, 13.5_
  - [x] 20.2 Implement `infrastructure/modules/cicd/` — CodePipeline with Source (GitHub via CodeStar), Build (CodeBuild: lint → unit tests → integration tests → security scans → Trivy scan), Docker Build & Push, and ECS rolling deploy stages; halt on test failure; tag images with Git SHA + pipeline execution ID
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [x] 20.3 Implement `infrastructure/backend.tf` and `infrastructure/modules/ecr/` — S3 backend with DynamoDB locking for Terraform state; ECR repositories for frontend and API with image scanning enabled
    - _Requirements: 14.5_
  - [x] 20.4 Implement CloudTrail in `infrastructure/modules/monitoring/` — enable CloudTrail for all AWS API calls in deployment region; S3 bucket with SSE for log storage
    - _Requirements: 11.4_
  - [x] 20.5 Wire root `infrastructure/main.tf`, `variables.tf`, `outputs.tf`, and environment tfvars (`environments/dev/`, `environments/prod/`) calling all modules; ensure no manual console changes required
    - _Requirements: 11.5, 14.5_

- [ ] 21. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each functional tier
- Property tests use [fast-check](https://github.com/dubzzz/fast-check) with a minimum of 100 iterations per property
- Unit tests complement property tests by covering specific examples and edge cases
- All DB queries must use parameterised statements — never string-concatenated SQL
- Secrets must never appear in Docker image layers, ECS task env vars, or source code under normal conditions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "5.1", "5.2"] },
    { "id": 4, "tasks": ["4.4", "4.6", "4.7"] },
    { "id": 5, "tasks": ["4.5", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3"] },
    { "id": 7, "tasks": ["6.4", "6.5", "8.1"] },
    { "id": 8, "tasks": ["8.2", "13.1"] },
    { "id": 9, "tasks": ["8.3", "13.2", "9.1"] },
    { "id": 10, "tasks": ["9.2", "13.3"] },
    { "id": 11, "tasks": ["9.3", "9.4", "9.5", "13.4", "13.5", "10.1"] },
    { "id": 12, "tasks": ["9.6", "10.2", "12.1"] },
    { "id": 13, "tasks": ["10.3", "12.2", "12.4"] },
    { "id": 14, "tasks": ["12.3", "15.1", "15.2", "15.3", "15.4", "15.5"] },
    { "id": 15, "tasks": ["15.6"] },
    { "id": 16, "tasks": ["16.1"] },
    { "id": 17, "tasks": ["16.2", "16.3"] },
    { "id": 18, "tasks": ["16.4", "16.5", "16.6"] },
    { "id": 19, "tasks": ["18.1"] },
    { "id": 20, "tasks": ["18.2", "18.3"] },
    { "id": 21, "tasks": ["19.1"] },
    { "id": 22, "tasks": ["19.2", "19.4", "19.5", "19.6"] },
    { "id": 23, "tasks": ["19.3"] },
    { "id": 24, "tasks": ["20.1", "20.3"] },
    { "id": 25, "tasks": ["20.2", "20.4"] },
    { "id": 26, "tasks": ["20.5"] }
  ]
}
```
