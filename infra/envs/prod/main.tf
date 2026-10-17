# Composition of the six modules. dev and prod use the same shape (Requirement
# 10.1); only the env value differs.

module "secrets" {
  source = "../../modules/secrets"

  env = var.env
}

module "data" {
  source = "../../modules/data"

  env        = var.env
  table_name = var.table_name
}

module "api" {
  source = "../../modules/api"

  env                = var.env
  api_lambda_zip     = var.api_lambda_zip
  passkit_lambda_zip = var.passkit_lambda_zip
  table_name         = module.data.table_name
  table_arn          = module.data.table_arn

  secret_arns = {
    app    = module.secrets.app_secret_arn
    apple  = module.secrets.apple_secret_arn
    google = module.secrets.google_secret_arn
  }

  permissions_boundary_arn = local.permissions_boundary_arn
  api_key_value            = var.api_key_value
  throttle_rate            = var.throttle_rate
  throttle_burst           = var.throttle_burst
  route_throttles          = var.route_throttles

  public_base_url            = var.public_base_url
  event_timezone             = var.event_timezone
  event_window_start         = var.event_window_start
  event_window_end           = var.event_window_end
  service_version            = var.service_version
  id_token_verifier          = var.id_token_verifier
  id_token_issuer            = var.id_token_issuer
  id_token_jwks_uri          = var.id_token_jwks_uri
  apns_enabled               = var.apns_enabled
  apns_push_type             = var.apns_push_type
  google_wallet_enabled      = var.google_wallet_enabled
  google_wallet_class_suffix = local.google_wallet_class_suffix
}

module "site" {
  source = "../../modules/site"

  bucket_name_prefix = local.site_bucket_name_prefix
  distribution_arn   = module.edge.distribution_arn
}

# The origin-verify and API key values come from sensitive variables (HCP
# workspace variables) and are never root outputs.
module "edge" {
  source = "../../modules/edge"

  env                              = var.env
  site_bucket_regional_domain_name = module.site.bucket_regional_domain_name
  oac_id                           = module.site.oac_id
  api_stage_invoke_host            = module.api.stage_invoke_host
  origin_verify_secret_value       = var.origin_verify_value
  api_key_value                    = var.api_key_value
  kill_switch_enabled              = var.kill_switch_enabled
}

module "observability" {
  source = "../../modules/observability"

  env                 = var.env
  alarm_email         = var.alarm_email
  rest_api_name       = module.api.rest_api_name
  api_lambda_name     = module.api.api_lambda_name
  passkit_lambda_name = module.api.passkit_lambda_name
}
