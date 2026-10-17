# Single table (ADR-012, build plan section 4.2). Retained resource (ADR-015):
# prevent_destroy plus deletion protection and point-in-time recovery.
#
# The global secondary indexes use the stable hash_key and range_key arguments,
# not the key_schema block. In AWS provider 6.x key_schema currently forces GSI
# replacement on every plan (provider issues 46335 and 46601), which is
# unacceptable on a retained table. The deprecation warning is accepted.
resource "aws_dynamodb_table" "this" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
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

  point_in_time_recovery {
    enabled = true
  }

  # Encrypted at rest with the AWS owned key by default; the table holds no
  # secret material (hashes and opaque identifiers only).
  server_side_encryption {
    enabled = true
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
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
