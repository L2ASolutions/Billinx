locals {
  tags = {
    App         = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Screenshots attached to support tickets can contain sensitive tenant
# financial data (invoices, amounts, customer info) captured straight off a
# user's screen — this bucket must never be publicly readable. Access is
# signed-URL-only, generated on demand by SupportTicketService.
resource "aws_s3_bucket" "support_tickets" {
  bucket = "${var.app_name}-support-tickets-${var.environment}"
  tags   = merge(local.tags, { Name = "${var.app_name}-support-tickets-${var.environment}" })
}

resource "aws_s3_bucket_public_access_block" "support_tickets" {
  bucket = aws_s3_bucket.support_tickets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "support_tickets" {
  bucket = aws_s3_bucket.support_tickets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "support_tickets" {
  bucket = aws_s3_bucket.support_tickets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Screenshots are only useful for active-ticket triage — auto-expire them
# well past the point any ticket would realistically still be open, rather
# than retaining tenant financial screenshots indefinitely.
resource "aws_s3_bucket_lifecycle_configuration" "support_tickets" {
  bucket = aws_s3_bucket.support_tickets.id

  rule {
    id     = "expire-old-screenshots"
    status = "Enabled"
    filter {}
    expiration {
      days = var.screenshot_retention_days
    }
  }
}
