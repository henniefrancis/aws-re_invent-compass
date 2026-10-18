variable "hcp_organization" {
  description = "Name of the HCP Terraform organisation. Private: set it in the git-ignored terraform.tfvars, never in a committed file."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{3,40}$", var.hcp_organization))
    error_message = "The hcp_organization value must be 3 to 40 letters, digits, hyphens or underscores."
  }
}

variable "hcp_project" {
  description = "Name of the HCP Terraform project that holds the three workspaces."
  type        = string
  default     = "reinvent-compass"

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{3,40}$", var.hcp_project))
    error_message = "The hcp_project value must be 3 to 40 letters, digits, hyphens or underscores."
  }
}

variable "hcp_workspaces" {
  description = "Names of the dev and prod HCP Terraform workspaces. Private: set them in the git-ignored terraform.tfvars."
  type = object({
    dev  = string
    prod = string
  })

  validation {
    condition     = alltrue([for w in values(var.hcp_workspaces) : can(regex("^[A-Za-z0-9_-]{3,90}$", w))])
    error_message = "Each workspace name must be 3 to 90 letters, digits, hyphens or underscores."
  }

  validation {
    condition     = var.hcp_workspaces.dev != var.hcp_workspaces.prod
    error_message = "The dev and prod workspaces must have different names."
  }
}

variable "workspace_variables" {
  description = "Non-sensitive Terraform variables to set on each environment workspace, for example event_timezone, event_window_start, event_window_end and id_token_issuer. Sensitive values are never set here: scripts/set-workspace-secrets.sh sets them through the HCP API."
  type = object({
    dev  = map(string)
    prod = map(string)
  })
  default = {
    dev  = {}
    prod = {}
  }

  validation {
    condition = alltrue([
      for k in concat(keys(var.workspace_variables.dev), keys(var.workspace_variables.prod)) :
      !contains(["alarm_email", "origin_verify_value", "api_key_value"], k)
    ])
    error_message = "alarm_email, origin_verify_value and api_key_value are sensitive and must not be set through Terraform."
  }
}

variable "alarm_email" {
  description = "Address that receives the account budget alerts. Private: set it in the git-ignored terraform.tfvars."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+[.][^@\\s]+$", var.alarm_email))
    error_message = "The alarm_email value must be an email address."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly cost budget for the whole account, in USD. Dev and prod together cost about USD 33 a month, so the default leaves headroom; alerts fire at 50, 80 and 100 percent of actual spend."
  type        = number
  default     = 40

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "The monthly_budget_usd value must be above 0."
  }
}

variable "hosted_zone_name" {
  description = "Name of the existing public Route 53 hosted zone of the custom domain (ADR-031). The apply roles may change records in this zone only."
  type        = string
  default     = "reinvent-compass.vegas"

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,}$", var.hosted_zone_name))
    error_message = "The hosted_zone_name value must be a lowercase DNS name."
  }
}

variable "create_oidc_provider" {
  description = "Create the app.terraform.io OIDC provider. AWS allows one per URL in an account, so set false when another configuration already manages it: the bootstrap then reads it, and it must list the aws.workload.identity audience."
  type        = bool
  default     = true
}

variable "register_domain" {
  description = "Register hosted_zone_name with Route 53 Domains and keep it renewed (domain.tf, ADR-031). A purchase: the owner reads the plan before applying. False reads an existing hosted zone instead. If the domain is already registered in this account, import it rather than registering again (docs/runbooks/release.md)."
  type        = bool
  default     = false
}

variable "domain_contact" {
  description = "Registrant, admin and tech contact for the domain registration. Personal data: set it only in the git-ignored terraform.tfvars. Phone numbers use the +<country code>.<number> format; country_code is the two-letter ISO code. Required when register_domain is true."
  type = object({
    contact_type      = optional(string, "PERSON")
    first_name        = string
    last_name         = string
    organization_name = optional(string)
    email             = string
    phone_number      = string
    address_line_1    = string
    address_line_2    = optional(string)
    city              = string
    state             = optional(string)
    zip_code          = string
    country_code      = string
  })
  default   = null
  sensitive = true

  validation {
    condition     = !var.register_domain || var.domain_contact != null
    error_message = "domain_contact is required when register_domain is true."
  }

  validation {
    condition     = var.domain_contact == null ? true : contains(["PERSON", "COMPANY", "ASSOCIATION", "PUBLIC_BODY", "RESELLER"], var.domain_contact.contact_type)
    error_message = "contact_type must be PERSON, COMPANY, ASSOCIATION, PUBLIC_BODY or RESELLER."
  }

  validation {
    condition     = var.domain_contact == null ? true : can(regex("^[+][0-9]{1,3}[.][0-9]{4,15}$", var.domain_contact.phone_number))
    error_message = "phone_number must look like +27.821234567."
  }

  validation {
    condition     = var.domain_contact == null ? true : can(regex("^[A-Z]{2}$", var.domain_contact.country_code))
    error_message = "country_code must be a two-letter upper-case ISO code."
  }

  validation {
    condition     = var.domain_contact == null ? true : can(regex("^[^@\\s]+@[^@\\s]+[.][^@\\s]+$", var.domain_contact.email))
    error_message = "The contact email must be an email address."
  }
}
