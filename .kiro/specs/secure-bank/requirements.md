# Requirements Document

## Introduction

SecureBank is a three-tier retail banking web application deployed on AWS ECS. It provides
customers with secure access to account management, fund transfers, transaction history, and
loan eligibility assessment. The system consists of a React SPA frontend (served via NGINX on
ECS), a Node.js/Express REST API backend (ECS Fargate), and a PostgreSQL database on Amazon
RDS. All tiers operate within a VPC with public and private subnets, protected by an Application
Load Balancer with WAF, SSL termination, and a comprehensive set of security controls throughout.

---

## Glossary

- **System**: The SecureBank application as a whole (all three tiers).
- **Auth_Service**: The backend component responsible for authentication, session management, and MFA.
- **Account_Service**: The backend component responsible for account balance and mini-statement retrieval.
- **Transfer_Service**: The backend component responsible for fund transfer processing and beneficiary management.
- **Transaction_Service**: The backend component responsible for transaction history, pagination, filtering, and statement export.
- **Loan_Service**: The backend component responsible for loan eligibility evaluation and application storage.
- **API_Gateway**: The Express middleware layer that validates JWT tokens, enforces rate limits, and routes requests to services.
- **DB**: The PostgreSQL database hosted on Amazon RDS in an isolated private subnet.
- **Customer**: An authenticated end user with the CUSTOMER role accessing the banking portal.
- **Branch_Manager**: An authenticated user with the BRANCH_MANAGER role with elevated read access.
- **Admin**: An authenticated user with the ADMIN role with full system access.
- **JWT**: A JSON Web Token used as a bearer credential for API authentication.
- **Refresh_Token**: A long-lived token used to obtain a new JWT without re-authentication.
- **OTP**: A one-time password delivered via email or SMS for multi-factor authentication.
- **MFA**: Multi-factor authentication requiring both password and OTP verification.
- **PAN**: Permanent Account Number — a sensitive PII field requiring AES-256 encryption at rest.
- **Aadhaar**: A 12-digit Indian national identity number — a sensitive PII field requiring AES-256 encryption at rest.
- **NEFT**: National Electronic Funds Transfer — an asynchronous inter-bank transfer mode.
- **IMPS**: Immediate Payment Service — a real-time inter-bank transfer mode.
- **Beneficiary**: A verified or unverified payee registered by a Customer for fund transfers.
- **Double-Entry_Ledger**: An accounting model in which every debit to one account has a matching credit to another.
- **Idempotency_Key**: A client-supplied UUID used to prevent duplicate processing of the same transfer request.
- **EMI**: Equated Monthly Instalment — the fixed payment amount for a loan repayment period.
- **RBAC**: Role-Based Access Control — a security model restricting system access by user role.
- **WAF**: AWS Web Application Firewall — inspects HTTP traffic for SQLi and XSS patterns.
- **ALB**: AWS Application Load Balancer — the public-facing ingress point for HTTPS traffic.
- **Secrets_Manager**: AWS Secrets Manager — the authoritative store for all application secrets and credentials.
- **CloudTrail**: AWS CloudTrail — the audit log for all AWS API calls.
- **CloudWatch**: AWS CloudWatch — the monitoring and alerting service.
- **ECR**: Amazon Elastic Container Registry — the private Docker image registry.
- **ECS**: Amazon Elastic Container Service — the container orchestration platform running Fargate tasks.
- **Terraform**: Infrastructure-as-code tool used to provision and manage all AWS resources.
- **CodePipeline**: AWS CodePipeline — the CI/CD orchestration service.
- **CodeBuild**: AWS CodeBuild — the build and test execution environment within the pipeline.

---

## Requirements

---

### Requirement 1: Customer Authentication

**User Story:** As a Customer, I want to log in with my credentials and complete MFA, so that only I can access my banking account.

#### Acceptance Criteria

1. WHEN a Customer submits a valid username and password, THE Auth_Service SHALL generate a signed JWT with a 15-minute expiry and a Refresh_Token with a 7-day expiry, and return both to the caller.
2. WHEN a Customer submits an invalid username or password, THE Auth_Service SHALL increment the failed-attempt counter for that username and return an HTTP 401 response with a generic error message that does not reveal whether the username or password was incorrect.
3. WHEN the failed-attempt counter for a username reaches 5, THE Auth_Service SHALL lock the account and return an HTTP 423 response on all subsequent login attempts until an Admin unlocks the account.
4. WHEN a locked account receives a login attempt, THE Auth_Service SHALL return an HTTP 423 response containing the account-locked reason without revealing internal state.
5. WHEN a Customer successfully submits their password, THE Auth_Service SHALL generate a 6-digit OTP, deliver it via the channel selected by the Customer (email or SMS via AWS SNS), and require OTP submission before issuing the JWT.
6. WHEN a Customer submits a correct OTP within 5 minutes of issuance, THE Auth_Service SHALL mark the MFA challenge as passed and complete the JWT issuance flow.
7. WHEN a Customer submits an incorrect or expired OTP, THE Auth_Service SHALL return an HTTP 401 response and require the Customer to restart the MFA challenge.
8. THE Auth_Service SHALL store all passwords as bcrypt hashes with a work factor of no less than 12; THE Auth_Service SHALL never store, log, or include plaintext passwords in any application log, debug output, or audit trail.
9. WHEN a Customer presents a valid Refresh_Token, THE Auth_Service SHALL issue a new JWT and a new Refresh_Token, and invalidate the previously used Refresh_Token (rotation).
10. WHEN a Customer presents an expired or revoked Refresh_Token, THE Auth_Service SHALL return an HTTP 401 response and require the Customer to re-authenticate.
11. THE Auth_Service SHALL enforce rate limiting of 100 requests per minute per source IP on all authentication endpoints; WHEN the limit is exceeded, THE Auth_Service SHALL return an HTTP 429 response.

---

### Requirement 2: Session Management

**User Story:** As a Customer, I want my session to expire after inactivity, so that my account is protected if I forget to log out.

#### Acceptance Criteria

1. WHILE a Customer session has been inactive for 15 consecutive minutes, THE API_Gateway SHALL reject all subsequent requests on that session with an HTTP 401 response and clear the session state.
2. WHEN a Customer makes any authenticated API request, THE API_Gateway SHALL reset the inactivity timer for that session to zero.
3. WHEN a Customer explicitly logs out, THE Auth_Service SHALL immediately revoke the active JWT and Refresh_Token, add both to the token revocation list, and return an HTTP 200 response.
4. WHEN the API_Gateway cannot reach the revocation list store, THE API_Gateway SHALL allow the request to proceed and SHALL log a WARNING with a correlation ID indicating the revocation check was skipped.
5. THE API_Gateway SHALL validate each JWT by verifying the cryptographic signature, checking that the token format is well-formed, and confirming the token has not expired before applying role checks; WHEN any of these checks fail, THE API_Gateway SHALL return an HTTP 401 response.

---

### Requirement 3: Role-Based Access Control

**User Story:** As a system operator, I want all API endpoints protected by role-based access controls, so that users can only perform actions permitted for their role.

#### Acceptance Criteria

1. THE API_Gateway SHALL validate the JWT on every inbound request and extract the role claim before routing the request to any service.
2. WHEN a request arrives at an endpoint requiring the CUSTOMER role and the JWT role claim is not CUSTOMER, BRANCH_MANAGER, or ADMIN, THE API_Gateway SHALL return an HTTP 403 response.
3. WHEN a request arrives at an endpoint requiring the BRANCH_MANAGER role and the JWT role claim is neither BRANCH_MANAGER nor ADMIN, THE API_Gateway SHALL return an HTTP 403 response.
4. WHEN a request arrives at an endpoint requiring the ADMIN role and the JWT role claim is not ADMIN, THE API_Gateway SHALL return an HTTP 403 response.
5. THE API_Gateway SHALL reject any request that does not carry a JWT whose signature is valid, format is well-formed, and expiry has not passed with an HTTP 401 response before applying role checks.
6. THE System SHALL support exactly three roles: CUSTOMER, BRANCH_MANAGER, and ADMIN; THE System SHALL reject any JWT containing an unrecognised role claim with an HTTP 403 response.

---

### Requirement 4: Account Dashboard

**User Story:** As a Customer, I want to view my account balances and a mini-statement, so that I have an at-a-glance view of my finances.

#### Acceptance Criteria

1. WHEN a Customer requests the account summary, THE Account_Service SHALL return all accounts belonging to that Customer, including account type (savings, current, or FD), available balance, and a masked account number showing only the last 4 digits.
2. WHEN a Customer requests a mini-statement for a specific account, THE Account_Service SHALL return the 10 most recent transactions for that account, ordered by transaction date descending.
3. WHEN a Customer requests an account summary or mini-statement for an account that does not belong to that Customer, THE Account_Service SHALL return an HTTP 403 response and SHALL not include any account or transaction data in the response body.
4. THE Account_Service SHALL retrieve balances and mini-statements exclusively from the DB using parameterised queries; THE Account_Service SHALL not construct raw SQL strings from user-supplied input.
5. WHEN the DB is unavailable or the system cannot determine DB availability status, THE Account_Service SHALL return an HTTP 503 response with a retry-after header specifying 30 seconds.

---

### Requirement 5: Fund Transfer — Own Account Transfers

**User Story:** As a Customer, I want to transfer funds between my own accounts using NEFT or IMPS, so that I can manage my money across accounts.

#### Acceptance Criteria

1. WHEN a Customer directly initiates a transfer between two accounts both belonging to that Customer, THE Transfer_Service SHALL validate that the source account has sufficient available balance before proceeding.
2. WHEN the source account has insufficient balance, THE Transfer_Service SHALL return an HTTP 422 response with an insufficient-funds error code and the current available balance.
3. WHEN a valid own-account transfer is requested, THE Transfer_Service SHALL create a debit ledger entry on the source account and a credit ledger entry on the destination account within a single DB transaction, ensuring Double-Entry_Ledger integrity.
4. WHEN a transfer DB transaction fails or is rolled back, THE Transfer_Service SHALL ensure neither the debit nor the credit entry is persisted, leaving both account balances unchanged.
5. WHEN a Customer submits a transfer request with a previously used Idempotency_Key, THE Transfer_Service SHALL return the original transfer response without creating a duplicate ledger entry.
6. THE Transfer_Service SHALL record the transfer mode (NEFT or IMPS) on each ledger entry.
7. WHEN a Customer requests a transfer using a transfer mode other than NEFT or IMPS, THE Transfer_Service SHALL return an HTTP 400 response.

---

### Requirement 6: Fund Transfer — Beneficiary Management

**User Story:** As a Customer, I want to add, verify, and delete beneficiaries, so that I can make transfers to external accounts securely.

#### Acceptance Criteria

1. WHEN a Customer adds a new Beneficiary, THE Transfer_Service SHALL store the beneficiary in a pending-verification state and impose a daily transfer limit of ₹10,000 for that Beneficiary.
2. WHEN a Beneficiary has been verified by a Branch_Manager or Admin, THE Transfer_Service SHALL update the Beneficiary status to verified and raise the daily transfer limit for that Beneficiary to ₹1,00,000.
3. WHEN a Customer initiates a transfer to a Beneficiary and the transfer amount plus the total transfers to that Beneficiary within the current calendar day exceeds the applicable daily limit, THE Transfer_Service SHALL return an HTTP 422 response with a daily-limit-exceeded error code, the current limit, and the amount already transferred today.
4. WHEN a Customer requests deletion of a Beneficiary, THE Transfer_Service SHALL immediately mark the Beneficiary as deleted, prevent any further transfers to that Beneficiary from the moment of deletion, and retain the Beneficiary record with full audit history; THE Transfer_Service SHALL not allow a grace period for transfers in flight at the time of deletion to complete.
5. THE Transfer_Service SHALL store all Beneficiary records using parameterised DB queries; THE Transfer_Service SHALL not construct raw SQL strings from user-supplied input.

---

### Requirement 7: Transaction History

**User Story:** As a Customer, I want to view, filter, and download my transaction history, so that I can track and reconcile my spending.

#### Acceptance Criteria

1. WHEN a Customer requests transaction history for an account, THE Transaction_Service SHALL return a paginated list of transactions with a configurable page size of 10, 25, or 50 records per page.
2. WHEN a Customer applies a date-range filter, THE Transaction_Service SHALL return only transactions whose transaction date falls within the specified start date and end date (inclusive).
3. WHEN a Customer applies an amount filter, THE Transaction_Service SHALL return only transactions whose absolute amount is greater than or equal to the specified minimum amount and less than or equal to the specified maximum amount.
4. WHEN a Customer applies a type filter, THE Transaction_Service SHALL return only transactions matching the specified type (DEBIT or CREDIT).
5. WHEN a Customer requests a transaction list, THE Transaction_Service SHALL include a running balance field on each transaction record, calculated as the account balance after applying that transaction in chronological order.
6. WHEN a Customer requests a CSV statement download for an account, THE Transaction_Service SHALL generate a UTF-8 encoded CSV file containing all transactions matching the current filter, and return it with the Content-Disposition header set to attachment with a filename derived from the account number and date range.
7. WHEN a Customer requests history or a statement for an account that does not belong to that Customer, or attempts any access to an unauthorised account, THE Transaction_Service SHALL return an HTTP 403 response and SHALL not include any transaction data in the response body.
8. THE Transaction_Service SHALL retrieve transaction data exclusively using parameterised DB queries.

---

### Requirement 8: Loan Eligibility Checker

**User Story:** As a Customer, I want to check my loan eligibility based on my income and existing obligations, so that I can understand what loans I qualify for before applying.

#### Acceptance Criteria

1. WHEN a Customer submits a loan eligibility request with gross monthly income, total existing monthly EMIs, requested loan amount, and tenure in months, THE Loan_Service SHALL calculate the proposed EMI using the standard reducing-balance formula.
2. WHEN the proposed EMI plus existing monthly EMIs exceeds 40% of the Customer's gross monthly income, THE Loan_Service SHALL return an eligibility decision of REJECTED with the reason EMI_EXCEEDS_INCOME_LIMIT and the calculated EMI value.
3. WHEN the proposed EMI plus existing monthly EMIs does not exceed 40% of the Customer's gross monthly income, THE Loan_Service SHALL return an eligibility decision of APPROVED with a full EMI breakdown including principal, interest, total payable, and effective annual interest rate.
4. WHEN a loan eligibility request is submitted with a loan amount less than or equal to zero, a tenure less than or equal to zero, a gross monthly income less than or equal to zero, or a negative existing EMI value, THE Loan_Service SHALL return an HTTP 400 response specifying each invalid field.
5. THE Loan_Service SHALL persist every eligibility request and its outcome to the DB with a status of APPROVED, REJECTED, or PENDING, the Customer identifier, the input parameters, and the calculated EMI.
6. WHEN the DB write for a loan application fails, THE Loan_Service SHALL set the eligibility decision to PENDING, return an HTTP 500 response, and log the failure with a correlation ID; THE Loan_Service SHALL not return an APPROVED or REJECTED result to the Customer without a confirmed DB write.
7. WHEN a Branch_Manager or Admin requests a list of loan applications, THE Loan_Service SHALL return all applications with their status, Customer identifier, and submission timestamp, paginated at 25 records per page.

---

### Requirement 9: PII Data Protection

**User Story:** As a system operator, I want PII fields encrypted at rest, so that sensitive customer data is protected in the event of a DB breach.

#### Acceptance Criteria

1. THE DB SHALL store PAN values exclusively as AES-256-GCM ciphertext; THE System SHALL never write a plaintext PAN to the DB.
2. THE DB SHALL store Aadhaar values exclusively as AES-256-GCM ciphertext; THE System SHALL never write a plaintext Aadhaar number to the DB.
3. WHEN a service needs to display a PAN to a Customer, THE System SHALL decrypt the ciphertext in application memory and return only a masked representation showing the last 4 characters (e.g., XXXXXXX1234).
4. WHEN a service needs to display an Aadhaar number to a Customer, THE System SHALL decrypt the ciphertext in application memory and return only a masked representation showing the last 4 digits (e.g., XXXXXXXX5678).
5. THE System SHALL retrieve the AES-256 encryption key exclusively from Secrets_Manager at service startup; WHEN Secrets_Manager is unavailable at startup, THE System SHALL attempt retrieval from a pre-approved secure fallback mechanism; THE System SHALL not store the key in environment variables, configuration files, or source code under normal operating conditions.
6. IF the Secrets_Manager call and all fallback mechanisms to retrieve the encryption key fail at startup, THEN THE System SHALL abort the service startup and emit a FATAL log entry with a correlation ID.

---

### Requirement 10: Secrets and Configuration Management

**User Story:** As a system operator, I want all secrets stored in AWS Secrets Manager, so that credentials are never exposed in source code or environment variables.

#### Acceptance Criteria

1. THE System SHALL retrieve the DB connection string, the JWT signing secret, the AES-256 encryption key, and all third-party API keys exclusively from Secrets_Manager.
2. THE System SHALL not include any secret value in Docker image layers, ECS task definition environment variable definitions, or application source code under normal operating conditions; WHEN Secrets_Manager is unavailable, THE System MAY use environment variables as a temporary fallback for secret retrieval, and SHALL log a WARNING for each secret sourced from environment variables.
3. WHEN Secrets_Manager returns a secret successfully, THE System SHALL cache the secret value in memory for a maximum of 1 hour before refreshing.
4. IF a Secrets_Manager call fails during secret rotation and the system holds a cached secret, THEN THE System SHALL continue operating with the cached secret and log a WARNING with a correlation ID; IF no cached secret is available, THEN THE System SHALL stop operating and emit a FATAL log entry.
5. THE System SHALL use IAM roles attached to ECS task definitions to authenticate with Secrets_Manager; THE System SHALL not use long-lived IAM access keys.

---

### Requirement 11: Network Security and Infrastructure

**User Story:** As a system operator, I want the application deployed in a secure VPC topology, so that database and application tiers are not directly reachable from the internet.

#### Acceptance Criteria

1. THE System SHALL deploy the ALB in the public subnet and all ECS Fargate tasks and the RDS instance in private subnets with no inbound rules from the public internet.
2. THE ALB SHALL terminate TLS using an ACM certificate with a minimum TLS version of 1.2; THE ALB SHALL redirect all HTTP requests to HTTPS.
3. THE WAF SHALL be attached to the ALB and SHALL include managed rule groups for SQL injection and cross-site scripting detection; WHEN a request matches a WAF rule, THE WAF SHALL block the request and return an HTTP 403 response.
4. THE System SHALL enable CloudTrail for all AWS API calls in the deployment region and SHALL store CloudTrail logs in a dedicated S3 bucket with server-side encryption enabled.
5. THE System SHALL provision all AWS infrastructure exclusively using Terraform; THE System SHALL not create or modify infrastructure resources manually through the AWS console.
6. THE RDS instance SHALL reside in an isolated DB subnet group with security group rules allowing inbound PostgreSQL traffic only from the ECS task security group.

---

### Requirement 12: API Security Headers and Input Validation

**User Story:** As a system operator, I want the API to emit security headers and validate all input, so that common web vulnerabilities are mitigated at the application layer.

#### Acceptance Criteria

1. THE API_Gateway SHALL apply Helmet.js middleware to every HTTP response, setting Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, and Referrer-Policy headers.
2. THE API_Gateway SHALL validate all request bodies against a JSON schema before routing to any service; WHEN a request body fails schema validation or when the validation system cannot determine pass/fail status, THE API_Gateway SHALL return an HTTP 400 response listing each validation error.
3. THE API_Gateway SHALL sanitise all string inputs to remove HTML tags and JavaScript event handlers before passing them to any service.
4. THE System SHALL use parameterised statements for all DB queries; WHEN the DB layer is not using parameterised statements, THE System SHALL block all requests and SHALL not concatenate user-supplied values into SQL strings.

---

### Requirement 13: Observability and Alerting

**User Story:** As a system operator, I want comprehensive logging and alerting, so that I can detect and respond to errors and security events in production.

#### Acceptance Criteria

1. THE System SHALL emit structured JSON logs for every API request, including a correlation ID, HTTP method, path, response status code, and latency in milliseconds; THE System SHALL not include PII or secret values in log entries.
2. THE System SHALL ship all ECS task logs to CloudWatch Logs using the awslogs log driver.
3. WHEN the API error rate (HTTP 5xx responses as a percentage of total requests) exceeds 5% over a 5-minute evaluation period, THE System SHALL publish an alert to an SNS topic configured with an email subscriber and SHALL continue alerting until the full 5-minute evaluation period ends, even if the rate drops below 5% within that window.
4. WHEN a CloudWatch alarm transitions to ALARM state, THE System SHALL send a notification to the configured SNS alert topic within 60 seconds of the threshold being breached.
5. THE System SHALL emit a CloudWatch metric for each of the following events: failed login attempt, account lockout, MFA failure, and fund transfer completion.

---

### Requirement 14: CI/CD Pipeline

**User Story:** As a developer, I want an automated CI/CD pipeline, so that code changes are built, tested, and deployed consistently without manual intervention.

#### Acceptance Criteria

1. THE System SHALL use CodePipeline with a CodeBuild stage to run unit tests, integration tests, and security scans on every commit to the main branch.
2. WHEN the CodeBuild stage reports a test failure or a critical security finding, THE CodePipeline SHALL halt the pipeline, prevent any Docker images from being pushed to ECR, roll back and remove any artifacts created during the failed pipeline run, and not deploy the failing artifact.
3. WHEN all CodeBuild checks pass, THE CodePipeline SHALL build Docker images, push them to ECR, and update the ECS service with a rolling deployment with a minimum healthy percent of 50%.
4. THE CodePipeline SHALL tag every Docker image pushed to ECR with the Git commit SHA and the pipeline execution ID.
5. THE System SHALL store all Terraform state in an S3 backend with DynamoDB locking to prevent concurrent state modifications.

---

### Requirement 15: Data Integrity — Double-Entry Bookkeeping

**User Story:** As a system operator, I want every fund movement to follow double-entry bookkeeping, so that the ledger remains balanced and auditable at all times.

#### Acceptance Criteria

1. THE Transfer_Service SHALL create every fund transfer as an atomic DB transaction containing exactly one debit ledger entry and one credit ledger entry with equal absolute amounts greater than zero; WHEN the transfer amount is zero or negative, THE Transfer_Service SHALL return an HTTP 400 response with an invalid-amount error code.
2. WHEN the absolute amount of the debit entry does not equal the absolute amount of the credit entry, THE Transfer_Service SHALL abort the transaction and return an HTTP 500 response with a ledger-integrity-error code.
3. THE Transfer_Service SHALL associate each ledger entry pair with the same transfer reference ID, enabling full audit traceability from a single entry back to its counterpart.
4. THE Transfer_Service SHALL record a timestamp, Customer ID, source account ID, destination account ID, amount, currency (INR), transfer mode, and Idempotency_Key on every transfer record.
5. THE System SHALL store all ledger entries with a DB-generated, monotonically increasing sequence number to support ordered audit queries.
