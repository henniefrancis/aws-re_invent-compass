variable "env" {
  description = "Environment name, dev or prod."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "The env value must be dev or prod."
  }
}

variable "deletion_protection" {
  description = "DynamoDB deletion protection. Keep true; switch it off only in the teardown runbook before destroying an environment."
  type        = bool
  default     = true
}

variable "table_name" {
  description = "DynamoDB table name. Null selects the default compass-<env>."
  type        = string
  default     = null

  validation {
    condition     = var.table_name == null ? true : can(regex("^[a-zA-Z0-9_.-]{3,255}$", var.table_name))
    error_message = "The table_name value must be 3 to 255 characters of letters, digits, underscore, dot or hyphen."
  }
}
