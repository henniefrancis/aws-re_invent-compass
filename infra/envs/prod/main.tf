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
  throttle_rate            = var.throttle_rate
  throttle_burst           = var.throttle_burst
  route_throttles          = var.route_throttles
}

module "site" {
  source = "../../modules/site"

  bucket_name_prefix = local.site_bucket_name_prefix
  distribution_arn   = module.edge.distribution_arn
}

# The origin-verify value flows from the secrets module straight into the edge
# origin header inside the graph. It is never a root output.
module "edge" {
  source = "../../modules/edge"

  env                              = var.env
  site_bucket_regional_domain_name = module.site.bucket_regional_domain_name
  oac_id                           = module.site.oac_id
  api_stage_invoke_host            = module.api.stage_invoke_host
  origin_verify_secret_value       = module.secrets.origin_verify_secret_value
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
