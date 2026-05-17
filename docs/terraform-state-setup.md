# Terraform Remote State Setup

The Terraform backend is configured to use S3 + DynamoDB for remote state and locking.
These resources must exist **before** running `terraform init` for the first time.

## Prerequisites

- AWS CLI configured with credentials for the `af-south-1` region
- Sufficient IAM permissions: S3 full access, DynamoDB full access

---

## One-time Bootstrap

Run these commands once to create the backend resources:

```bash
# Create S3 bucket for state
aws s3api create-bucket \
  --bucket billinx-terraform-state \
  --region af-south-1 \
  --create-bucket-configuration LocationConstraint=af-south-1

# Enable versioning (allows state rollback)
aws s3api put-bucket-versioning \
  --bucket billinx-terraform-state \
  --versioning-configuration Status=Enabled

# Block all public access
aws s3api put-public-access-block \
  --bucket billinx-terraform-state \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Enable server-side encryption
aws s3api put-bucket-encryption \
  --bucket billinx-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms"
      }
    }]
  }'

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name billinx-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region af-south-1
```

---

## Initialize Terraform

After the bootstrap resources exist:

```bash
cd infra/
terraform init
terraform plan
terraform apply
```

---

## IAM Policy for CI/CD

The GitHub Actions deploy workflow needs these permissions to access remote state:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::billinx-terraform-state",
        "arn:aws:s3:::billinx-terraform-state/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
      "Resource": "arn:aws:dynamodb:af-south-1:*:table/billinx-terraform-locks"
    }
  ]
}
```

---

## Recovering from a Stuck Lock

If a plan or apply is interrupted, the DynamoDB lock may remain. To force-unlock:

```bash
terraform force-unlock <LOCK_ID>
```

Get the lock ID from the error message or:

```bash
aws dynamodb scan --table-name billinx-terraform-locks --region af-south-1
```
