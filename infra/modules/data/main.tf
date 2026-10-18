# Single table (ADR-012, build plan section 4.2). Retained resource (ADR-015):
# prevent_destroy plus deletion protection. Point-in-time recovery is off by
# owner decision (see below).
#
# The one global secondary index (GSI2, subHash to passes) uses the stable
# hash_key and range_key arguments,
# not the key_schema block. In AWS provider 6.x key_schema currently forces GSI
# replacement on every plan (provider issues 46335 and 46601), which is
# unacceptable on a retained table. The deprecation warning is accepted.
resource "aws_dynamodb_table" "this" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  # On by default. Only the teardown runbook switches it off, in a workspace
  # variable, before a Terraform destroy of a dev environment.
  deletion_protection_enabled = var.deletion_protection


  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi2pk"
    type = "S"
  }

  attribute {
    name = "gsi2sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Point-in-time recovery is off by owner decision: forget_me must be a real
  # erasure, and the data lives only until session end plus 24 hours. Deletion
  # protection stays on, so the table itself cannot be removed by accident.
  point_in_time_recovery {
    enabled = false
  }

  # Encrypted at rest with the AWS managed key aws/dynamodb (enabled = true; an
  # absent block would use the AWS owned key instead). The table holds no secret
  # material, only hashes and opaque identifiers.
  server_side_encryption {
    enabled = true
  }

  global_secondary_index {
    name            = "GSI2"
    hash_key        = "gsi2pk"
    range_key       = "gsi2sk"
    projection_type = "ALL"
  }

  lifecycle {
    prevent_destroy = true
  }
}
