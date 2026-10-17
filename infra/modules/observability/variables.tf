variable "env" {
  description = "Environment name, dev or prod."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "The env value must be dev or prod."
  }
}

variable "alarm_email" {
  description = "Address that receives alarm and budget notifications. Set it as a workspace variable; it is never committed and never output."
  type        = string
  sensitive   = true

  validation {
    condition     = length(trimspace(var.alarm_email)) > 0
    error_message = "The alarm_email value must not be empty."
  }

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+[.][^@\\s]+$", var.alarm_email))
    error_message = "The alarm_email value must be an email address."
  }
}

variable "rest_api_name" {
  description = "Name of the REST API, the ApiName dimension of the API Gateway metrics (from the api module)."
  type        = string

  validation {
    condition     = length(var.rest_api_name) > 0
    error_message = "The rest_api_name value must not be empty."
  }
}

variable "api_lambda_name" {
  description = "Name of the api Lambda function (from the api module)."
  type        = string

  validation {
    condition     = length(var.api_lambda_name) > 0
    error_message = "The api_lambda_name value must not be empty."
  }
}

variable "passkit_lambda_name" {
  description = "Name of the passkit Lambda function (from the api module)."
  type        = string

  validation {
    condition     = length(var.passkit_lambda_name) > 0
    error_message = "The passkit_lambda_name value must not be empty."
  }
}
