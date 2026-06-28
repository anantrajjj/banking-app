# SecureBank — AWS ECS Fargate Deployment Guide

Three-tier architecture: ALB (public) → ECS Fargate frontend + API (private) → RDS + ElastiCache (isolated).

---

## Prerequisites

Install these on your local machine before starting:

| Tool | Version | Install |
|------|---------|---------|
| AWS CLI | ≥ 2.x | https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html |
| Terraform | ≥ 1.5 | https://developer.hashicorp.com/terraform/install |
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |
| Node.js | ≥ 20 | https://nodejs.org |

Configure your AWS credentials:
```bash
aws configure
# AWS Access Key ID: <your key>
# AWS Secret Access Key: <your secret>
# Default region name: us-east-1
# Default output format: json
```

Get your account ID (you'll need it throughout):
```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1
echo "Account: $AWS_ACCOUNT_ID  Region: $AWS_REGION"
```

---

## Phase 1 — Bootstrap (one-time, ~10 min)

These resources must exist *before* running `terraform init`.

### 1A. Terraform state bucket + lock table

```bash
# S3 bucket for state (must be globally unique — change the suffix)
aws s3api create-bucket \
  --bucket securebank-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket securebank-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket securebank-terraform-state \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block \
  --bucket securebank-terraform-state \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# DynamoDB table for state locking
aws dynamodb create-table \
  --table-name securebank-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 1B. ACM certificate for your domain

You need a real domain (e.g. bought from Route 53 or Namecheap).

1. Go to **AWS Console → Certificate Manager → Request certificate**
2. Choose **Public certificate**
3. Enter your domain: `securebank.yourdomain.com`
4. Validation method: **DNS**
5. Click **Request**
6. Click **Create records in Route 53** (if your domain is in Route 53) — or manually add the shown CNAME record in your DNS provider
7. Wait ~5 minutes for status to become **Issued**
8. Copy the **Certificate ARN** — you'll need it in tfvars

### 1C. GitHub → AWS CodeStar connection

1. Go to **AWS Console → CodePipeline → Settings → Connections**
2. Click **Create connection → GitHub**
3. Give it a name: `securebank-github`
4. Click **Connect to GitHub** and authorise
5. Click **Connect**
6. Copy the **Connection ARN** — you'll need it in tfvars

---

## Phase 2 — Configure Terraform (~5 min)

Create `infrastructure/terraform.tfvars` (this file is gitignored — never commit it):

```hcl
# infrastructure/terraform.tfvars

aws_region = "us-east-1"
app_name   = "securebank"
env        = "prod"

# ── Database ──────────────────────────────────────────────────────────────────
db_username       = "securebank_admin"
db_password       = "ReplaceWithStrong!Password1"   # min 8 chars, no @/"
db_name           = "securebank"
db_instance_class = "db.t3.medium"                  # ~$50/month

# ── Redis ─────────────────────────────────────────────────────────────────────
redis_node_type  = "cache.t3.micro"                 # ~$15/month
redis_auth_token = "ReplaceWithStrong!RedisToken1"  # 16-128 chars

# ── Domain + certificate ──────────────────────────────────────────────────────
certificate_domain = "securebank.yourdomain.com"    # must match ACM cert

# ── Alerts ────────────────────────────────────────────────────────────────────
alert_email = "you@yourdomain.com"

# ── CI/CD ─────────────────────────────────────────────────────────────────────
codestar_connection_arn = "arn:aws:codestar-connections:us-east-1:ACCOUNT_ID:connection/UUID"
github_repo             = "anantrajjj/banking-app"
github_branch           = "main"
ecr_registry            = "ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"
```

Replace every placeholder before continuing.

---

## Phase 3 — Terraform apply (~20 min)

```bash
cd infrastructure

terraform init      # downloads providers, connects to S3 backend

terraform plan      # review everything that will be created

terraform apply     # type 'yes' when prompted
                    # RDS alone takes ~12 min to provision
```

When it finishes, save the outputs:

```bash
terraform output    # prints all resource endpoints

# Capture the key ones:
export ALB_DNS=$(terraform output -raw alb_dns_name)
export ECR_FRONTEND=$(terraform output -raw frontend_ecr_url)
export ECR_API=$(terraform output -raw api_ecr_url)
export RDS_ENDPOINT=$(terraform output -raw rds_endpoint)
export REDIS_ENDPOINT=$(terraform output -raw redis_endpoint)

echo "ALB:   $ALB_DNS"
echo "ECR F: $ECR_FRONTEND"
echo "ECR A: $ECR_API"
echo "RDS:   $RDS_ENDPOINT"
echo "Redis: $REDIS_ENDPOINT"
```

---

## Phase 4 — Populate Secrets Manager (~5 min)

Terraform creates the secret *shells* but leaves the values as placeholders.
Fill them in now:

```bash
# ── Database URL ──────────────────────────────────────────────────────────────
# Format: postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
DB_URL="postgresql://securebank_admin:ReplaceWithStrong\!Password1@${RDS_ENDPOINT}/securebank?sslmode=require"

aws secretsmanager put-secret-value \
  --secret-id "securebank/db-url" \
  --secret-string "$DB_URL"

# ── JWT RS256 private key ─────────────────────────────────────────────────────
# Generate a fresh RSA key pair if you don't already have one:
openssl genrsa -out jwt-private.key 2048
openssl rsa -in jwt-private.key -pubout -out jwt-public.key

aws secretsmanager put-secret-value \
  --secret-id "securebank/jwt-private-key" \
  --secret-string file://jwt-private.key

# ── AES-256 key (64-char hex) ─────────────────────────────────────────────────
AES_KEY=$(openssl rand -hex 32)
echo "AES key: $AES_KEY"   # save this somewhere safe

aws secretsmanager put-secret-value \
  --secret-id "securebank/aes-key" \
  --secret-string "$AES_KEY"

# ── Redis URL ─────────────────────────────────────────────────────────────────
# 'rediss://' = TLS. AUTH token must match redis_auth_token in tfvars.
REDIS_URL="rediss://:ReplaceWithStrong\!RedisToken1@${REDIS_ENDPOINT}:6379"

aws secretsmanager put-secret-value \
  --secret-id "securebank/redis-url" \
  --secret-string "$REDIS_URL"

# ── SNS topic ARN ─────────────────────────────────────────────────────────────
SNS_ARN=$(aws sns list-topics --query "Topics[?contains(TopicArn,'securebank')].TopicArn" --output text)

aws secretsmanager put-secret-value \
  --secret-id "securebank/sns-topic-arn" \
  --secret-string "$SNS_ARN"
```

---

## Phase 5 — Build and push the first Docker images (~10 min)

CodePipeline handles future builds automatically. The first deployment needs images pushed manually so ECS has something to run.

```bash
# Log in to ECR
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin \
    $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# ── Frontend ──────────────────────────────────────────────────────────────────
docker build -t securebank-frontend ./frontend

docker tag securebank-frontend:latest $ECR_FRONTEND:latest
docker push $ECR_FRONTEND:latest

# ── API ───────────────────────────────────────────────────────────────────────
docker build -t securebank-api ./api

docker tag securebank-api:latest $ECR_API:latest
docker push $ECR_API:latest
```

Then force ECS to pick up the new images:

```bash
CLUSTER=$(terraform output -raw ecs_cluster_id)

aws ecs update-service \
  --cluster $CLUSTER \
  --service securebank-prod-frontend \
  --force-new-deployment

aws ecs update-service \
  --cluster $CLUSTER \
  --service securebank-prod-api \
  --force-new-deployment
```

Watch the rollout (~3 min):

```bash
aws ecs wait services-stable \
  --cluster $CLUSTER \
  --services securebank-prod-frontend securebank-prod-api

echo "Both services are stable ✅"
```

---

## Phase 6 — Run database migrations and seed (~3 min)

Use a one-off ECS task to run migrations inside the private subnet (where the DB is reachable):

```bash
# Get the private subnet ID and API security group
SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=tag:Tier,Values=private-app" \
            "Name=tag:Project,Values=securebank" \
  --query "Subnets[0].SubnetId" --output text)

SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=tag:Name,Values=securebank-prod-api-sg" \
  --query "SecurityGroups[0].GroupId" --output text)

TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition securebank-prod-api \
  --query "taskDefinition.taskDefinitionArn" --output text)

NETWORK="awsvpcConfiguration={subnets=[$SUBNET_ID],securityGroups=[$SG_ID],assignPublicIp=DISABLED}"

# Run migrations
aws ecs run-task \
  --cluster $CLUSTER \
  --task-definition $TASK_DEF \
  --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides '{"containerOverrides":[{"name":"api","command":["npm","run","migrate"]}]}'

echo "Waiting for migration task to finish..."
sleep 30   # check the CloudWatch log /ecs/securebank-api for output

# Run seed (creates starter user + accounts + debit cards)
aws ecs run-task \
  --cluster $CLUSTER \
  --task-definition $TASK_DEF \
  --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides '{
    "containerOverrides":[{
      "name":"api",
      "command":["npm","run","seed"],
      "environment":[
        {"name":"SEED_USERNAME","value":"admin"},
        {"name":"SEED_PASSWORD","value":"SecureAdminPass1!"},
        {"name":"SEED_EMAIL","value":"admin@securebank.local"}
      ]
    }]
  }'
```

Check the output in CloudWatch:
- **AWS Console → CloudWatch → Log groups → /ecs/securebank-api**

---

## Phase 7 — Point your domain at the ALB (~5 min)

In **Route 53** (or your DNS provider):

1. Go to your hosted zone for `yourdomain.com`
2. Create a new record:
   - Name: `securebank`
   - Type: **A**
   - Alias: **Yes**
   - Route traffic to: **Alias to Application and Classic Load Balancer**
   - Region: `us-east-1`
   - Load balancer: choose `securebank-prod-alb-...`
3. Save

DNS propagates in 1–5 minutes. Test it:

```bash
curl -I https://securebank.yourdomain.com/health
# HTTP/2 200

curl -I https://securebank.yourdomain.com/v1/health
# HTTP/2 200
```

---

## Phase 8 — Verify everything is working

```bash
# ALB health
curl https://securebank.yourdomain.com/health

# API health (ALB routes /v1/* to API ECS service)
curl https://securebank.yourdomain.com/v1/health

# Check ECS service status
aws ecs describe-services \
  --cluster $CLUSTER \
  --services securebank-prod-frontend securebank-prod-api \
  --query "services[*].{Name:serviceName,Running:runningCount,Desired:desiredCount,Status:status}"

# Check RDS is reachable (from a one-off ECS task — not publicly accessible)
# View logs instead:
aws logs tail /ecs/securebank-api --follow
```

Open `https://securebank.yourdomain.com` in your browser. Log in with the credentials you seeded.

---

## Ongoing deployments (automatic)

Every `git push` to `main` now triggers CodePipeline automatically:

```
GitHub push → CodeStar webhook → CodePipeline
  └─ Stage 1: Source (GitHub checkout)
  └─ Stage 2: Build (CodeBuild)
       ├─ npm install + lint + tests
       ├─ docker build frontend + api
       ├─ Trivy vulnerability scan (blocks on CRITICAL)
       └─ docker push to ECR
  └─ Stage 3: Deploy (ECS rolling update, zero downtime)
```

Monitor pipelines:
```bash
aws codepipeline get-pipeline-state --name $(terraform output -raw pipeline_name)
```

---

## Estimated monthly cost (us-east-1, prod defaults)

| Service | Config | ~Cost/mo |
|---------|--------|---------|
| ECS Fargate | 2× frontend (0.25 vCPU / 0.5 GB) + 2× API (0.5 vCPU / 1 GB) | ~$40 |
| RDS PostgreSQL | db.t3.medium, Multi-AZ, 20 GB | ~$100 |
| ElastiCache Redis | cache.t3.micro, 1 node | ~$15 |
| ALB | ~10 GB/mo | ~$20 |
| NAT Gateway | 2× (one per AZ) | ~$65 |
| ECR | ~1 GB storage | ~$1 |
| Secrets Manager | 5 secrets | ~$3 |
| CloudWatch | logs + alarms | ~$5 |
| **Total** | | **~$250** |

To reduce costs in dev/staging: set `db_instance_class = "db.t3.micro"`, `redis_node_type = "cache.t3.micro"`, desired counts to 1, and disable Multi-AZ.

---

## Teardown (when you want to destroy everything)

```bash
cd infrastructure
terraform destroy   # type 'yes' — this deletes everything including RDS data
```

Also manually delete:
- The S3 state bucket: `aws s3 rb s3://securebank-terraform-state --force`
- The DynamoDB lock table: `aws dynamodb delete-table --table-name securebank-terraform-locks`
- The ACM certificate (from Console)
- The CodeStar connection (from Console)
