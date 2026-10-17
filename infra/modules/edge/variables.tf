variable "env" {
  description = "Environment name, dev or prod. Prefixes the names of account-wide resources so the two environments never collide."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "The env value must be dev or prod."
  }
}

variable "site_bucket_regional_domain_name" {
  description = "Regional domain name of the private site bucket (from the site module)."
  type        = string

  validation {
    condition     = endswith(var.site_bucket_regional_domain_name, ".amazonaws.com")
    error_message = "The site_bucket_regional_domain_name value must be an S3 regional domain name."
  }
}

variable "oac_id" {
  description = "ID of the CloudFront origin access control for the site bucket (from the site module)."
  type        = string

  validation {
    condition     = length(var.oac_id) > 0
    error_message = "The oac_id value must not be empty."
  }
}

variable "api_stage_invoke_host" {
  description = "Host name of the API Gateway stage that serves /api/*, without a scheme or path (from the api module)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+[.]execute-api[.][a-z0-9-]+[.]amazonaws[.]com$", var.api_stage_invoke_host))
    error_message = "The api_stage_invoke_host value must be an execute-api host name with no scheme or path."
  }
}

variable "origin_verify_secret_value" {
  description = "Value of the x-origin-verify header sent to the API origin. Supply it as a sensitive HCP variable; the same value is loaded into the app secret by scripts/load-secrets.sh."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.origin_verify_secret_value) >= 32
    error_message = "The origin_verify_secret_value value must be at least 32 characters."
  }
}

variable "api_key_value" {
  description = "Value of the x-api-key header sent to the API origin, so API Gateway rejects a direct call before the Lambda runs. Supply it as a sensitive HCP variable."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.api_key_value) >= 20 && length(var.api_key_value) <= 128
    error_message = "The api_key_value value must be 20 to 128 characters."
  }
}

variable "kill_switch_enabled" {
  description = "When true the WAF kill-switch rule blocks every request. When false the rule only counts."
  type        = bool
  default     = false
}
