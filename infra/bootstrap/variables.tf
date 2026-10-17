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
