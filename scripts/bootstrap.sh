#!/usr/bin/env bash
# Apply infra/bootstrap once: the HCP Terraform OIDC provider, the plan and apply
# roles for dev and prod, the permissions boundary and the account-level API
# Gateway CloudWatch role.
#
# OWNER-RUN ONLY. Run it in CloudShell or a shell with your own AWS credentials.
# It never prints a secret or an identifier of its own; Terraform prints its own
# plan, which you read before you confirm.
#
# Needs: terraform, the HCP Terraform organisation and the bootstrap workspace
# (set to Local execution mode) in TF_CLOUD_ORGANIZATION and TF_WORKSPACE, and a
# git-ignored infra/bootstrap/terraform.tfvars copied from the .example file.
#
# Exit status: 0 only after a clean apply, non-zero on any failure.

set -euo pipefail

usage() {
  echo "usage: scripts/bootstrap.sh" >&2
  echo "  Set TF_CLOUD_ORGANIZATION and TF_WORKSPACE (the bootstrap workspace) first." >&2
}

if [ "$#" -ne 0 ]; then
  usage
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bootstrap_dir="${script_dir}/../infra/bootstrap"

for name in TF_CLOUD_ORGANIZATION TF_WORKSPACE; do
  if [ -z "${!name:-}" ]; then
    echo "error: ${name} is not set" >&2
    usage
    exit 1
  fi
done

if [ ! -f "${bootstrap_dir}/terraform.tfvars" ]; then
  echo "error: infra/bootstrap/terraform.tfvars is missing; copy terraform.tfvars.example and fill it in" >&2
  exit 1
fi

if ! command -v terraform >/dev/null 2>&1; then
  echo "error: terraform is not installed" >&2
  exit 1
fi

cd "${bootstrap_dir}"

if ! terraform init -input=false; then
  echo "bootstrap failed: terraform init did not complete" >&2
  exit 1
fi

if ! terraform apply; then
  echo "bootstrap failed: terraform apply did not complete cleanly" >&2
  exit 1
fi

echo "bootstrap complete"
exit 0
