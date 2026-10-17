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
  hash_key     = "PK"
  range_key    = "SK"

  deletion_protection_enabled = true

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  attribute {
    name = "GSI2PK"
    type = "S"
  }

  attribute {
    name = "GSI2SK"
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
    name               = "GSI1"
    hash_key           = "GSI1PK"
    range_key          = "GSI1SK"
    projection_type    = "INCLUDE"
    non_key_attributes = local.gsi1_non_key_attributes
  }

  global_secondary_index {
    name               = "GSI2"
    hash_key           = "GSI2PK"
    range_key          = "GSI2SK"
    projection_type    = "INCLUDE"
    non_key_attributes = local.gsi2_non_key_attributes
  }

  lifecycle {
    prevent_destroy = true
  }
}
