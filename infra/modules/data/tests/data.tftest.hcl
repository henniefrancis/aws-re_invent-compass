# Plan-only assertions for the data module (Requirements 6.1 to 6.8, 9.2).
# The aws provider is mocked, so nothing here reaches AWS.

mock_provider "aws" {
  override_during = plan
}

variables {
  env = "dev"
}

run "table_settings" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.this.name == "compass-dev"
    error_message = "The table name must default to compass-<env>."
  }

  assert {
    condition     = aws_dynamodb_table.this.billing_mode == "PAY_PER_REQUEST"
    error_message = "The table must use on-demand capacity."
  }

  assert {
    condition     = !can(regex("(read|write)_capacity", file("${path.module}/main.tf")))
    error_message = "No provisioned capacity may be set."
  }

  assert {
    condition     = one(aws_dynamodb_table.this.ttl).attribute_name == "ttl" && one(aws_dynamodb_table.this.ttl).enabled
    error_message = "TTL must be enabled on the ttl attribute."
  }

  assert {
    condition     = one(aws_dynamodb_table.this.point_in_time_recovery).enabled
    error_message = "Point-in-time recovery must be enabled."
  }

  assert {
    condition     = aws_dynamodb_table.this.deletion_protection_enabled
    error_message = "Deletion protection must be enabled."
  }
}

# The global_secondary_index set holds provider-computed members, so its values
# are unknown at plan time under a mock provider. The index shape is therefore
# asserted on the source, which is where projection_type is written explicitly.
run "gsi_projections" {
  command = plan

  assert {
    condition     = length(regexall("(?m)^[[:space:]]*global_secondary_index[[:space:]]*[{]", file("${path.module}/main.tf"))) == 2
    error_message = "Exactly two global secondary indexes are required."
  }

  assert {
    condition     = length(regexall("projection_type[[:space:]]*=[[:space:]]*\"ALL\"", file("${path.module}/main.tf"))) == 2
    error_message = "Each GSI must set an explicit ALL projection."
  }

  assert {
    condition     = can(regex("name[[:space:]]*=[[:space:]]*\"GSI1\"", file("${path.module}/main.tf"))) && can(regex("name[[:space:]]*=[[:space:]]*\"GSI2\"", file("${path.module}/main.tf")))
    error_message = "The indexes must be named GSI1 and GSI2."
  }

  assert {
    condition     = can(regex("hash_key[[:space:]]*=[[:space:]]*\"gsi1pk\"", file("${path.module}/main.tf"))) && can(regex("hash_key[[:space:]]*=[[:space:]]*\"gsi2pk\"", file("${path.module}/main.tf")))
    error_message = "Each GSI must use its own partition key attribute."
  }
}

run "custom_table_name" {
  command = plan

  variables {
    table_name = "compass-restore"
  }

  assert {
    condition     = aws_dynamodb_table.this.name == "compass-restore"
    error_message = "An explicit table_name must override the default."
  }
}

run "invalid_env_is_rejected" {
  command = plan

  variables {
    env = "staging"
  }

  expect_failures = [var.env]
}

# Static HCL scan: the GSI blocks must use hash_key and range_key and never the
# key_schema block, which forces GSI replacement on the retained table
# (provider issues 46335 and 46601). The check reads the source because the
# argument form does not appear in plan output.
run "gsi_argument_form_scan" {
  command = plan

  assert {
    condition     = !can(regex("(?m)^[[:space:]]*key_schema[[:space:]]*[{]", file("${path.module}/main.tf")))
    error_message = "The global_secondary_index blocks must not use key_schema."
  }

  assert {
    condition     = length(regexall("(?m)^[[:space:]]*hash_key[[:space:]]*=", file("${path.module}/main.tf"))) == 3 && length(regexall("(?m)^[[:space:]]*range_key[[:space:]]*=", file("${path.module}/main.tf"))) == 3
    error_message = "The table and both GSIs must declare hash_key and range_key."
  }
}
