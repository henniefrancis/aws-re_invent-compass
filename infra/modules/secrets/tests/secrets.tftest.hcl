# Plan-only assertions for the secrets module (Requirements 7.1, 7.4 to 7.6, 9.3).
# Terraform creates the containers only; it generates and writes no secret value.

mock_provider "aws" {
  override_during = plan
}

variables {
  env = "dev"
}

run "secret_containers" {
  command = plan

  assert {
    condition     = aws_secretsmanager_secret.apple_pass.name == "compass/dev/apple-pass"
    error_message = "The apple-pass secret name is wrong."
  }

  assert {
    condition     = aws_secretsmanager_secret.google_wallet.name == "compass/dev/google-wallet"
    error_message = "The google-wallet secret name is wrong."
  }

  assert {
    condition     = aws_secretsmanager_secret.app.name == "compass/dev/app"
    error_message = "The app secret name is wrong."
  }
}

run "origin_verify_has_its_own_container" {
  command = plan

  assert {
    condition     = aws_secretsmanager_secret.origin_verify.name == "compass/dev/origin-verify"
    error_message = "The origin-verify secret name is wrong."
  }
}

run "prod_names" {
  command = plan

  variables {
    env = "prod"
  }

  assert {
    condition     = aws_secretsmanager_secret.app.name == "compass/prod/app"
    error_message = "The prod app secret name is wrong."
  }
}

run "invalid_env_is_rejected" {
  command = plan

  variables {
    env = "qa"
  }

  expect_failures = [var.env]
}

# Static HCL scan: prevent_destroy is a lexical fact that plan output does not
# show, and the absence of any value-bearing resource is asserted on the source.
run "source_scan" {
  command = plan

  assert {
    condition     = length(regexall("(?m)^[[:space:]]*prevent_destroy[[:space:]]*=[[:space:]]*true", file("${path.module}/main.tf"))) == 4
    error_message = "All four secret containers must set prevent_destroy = true."
  }

  assert {
    condition     = length(regexall("(?m)^resource[[:space:]]+\"aws_secretsmanager_secret\"", file("${path.module}/main.tf"))) == 4
    error_message = "Exactly four secret containers are required."
  }

  assert {
    condition     = !can(regex("(?m)^[^#]*(aws_secretsmanager_secret_version|random_password|secret_string)", file("${path.module}/main.tf")))
    error_message = "Terraform must not generate or write any secret value."
  }

  assert {
    condition     = !can(regex("(?m)^output[[:space:]]+\"(pepper|origin_verify|origin_verify_secret_value)\"", file("${path.module}/outputs.tf")))
    error_message = "No output may expose the pepper or the origin-verify value."
  }
}
