#!/usr/bin/env bash
# Deploy one environment: build, saved plan, refusal checks, typed confirmation,
# apply, site sync, cache invalidation and health check.
#
# usage: scripts/release.sh <dev|prod>
#
# OWNER-RUN ONLY. Deploy dev first and prod second (ADR-020).
#
# Credentials: terraform plan and apply run in HCP Terraform with its dynamic
# provider credentials, so this script holds no AWS keys for them. The site sync
# and the cache invalidation run on your machine under your own AWS SSO session
# (run aws sso login first).
#
# The plan JSON is held in memory and piped through jq. It is never written to
# disk, because it can contain values that are sensitive in the plan.
#
# Confirmation: dev asks for the word yes; prod asks you to type prod, so a typed
# yes that was meant for dev cannot apply production.
#
# This script never prints a secret, a token, an email address, an account id or
# a resource identifier. It prints resource addresses and types from the plan
# (names such as module.data.aws_dynamodb_table.this), never values.
#
# Optional overrides (environment variables):
#   COMPASS_LAMBDA_BUILD_CMD  command that builds the two Lambda zips
#   COMPASS_SITE_BUILD_CMD    command that builds the site
#   COMPASS_SITE_DIR          directory the site build writes, relative to the repo root
#
# Exit status: 0 only after apply, sync, invalidation and a healthy health check.

set -euo pipefail

# Resource types the plan may touch. Anything else is refused.
ALLOWED_TYPES=(
  aws_api_gateway_api_key
  aws_api_gateway_deployment
  aws_api_gateway_method_settings
  aws_api_gateway_rest_api
  aws_api_gateway_stage
  aws_api_gateway_usage_plan
  aws_api_gateway_usage_plan_key
  aws_budgets_budget
  aws_cloudfront_distribution
  aws_cloudfront_function
  aws_cloudfront_origin_access_control
  aws_cloudfront_response_headers_policy
  aws_cloudwatch_log_group
  aws_cloudwatch_metric_alarm
  aws_dynamodb_table
  aws_iam_role
  aws_iam_role_policy
  aws_kms_alias
  aws_kms_key
  aws_lambda_function
  aws_lambda_permission
  aws_s3_bucket
  aws_s3_bucket_policy
  aws_s3_bucket_public_access_block
  aws_s3_bucket_server_side_encryption_configuration
  aws_s3_bucket_versioning
  aws_secretsmanager_secret
  aws_sns_topic
  aws_sns_topic_subscription
  aws_wafv2_web_acl
)

# Retained resources (ADR-015): a plan may never destroy or replace these types.
RETAINED_TYPES=(
  aws_cloudfront_distribution
  aws_dynamodb_table
  aws_secretsmanager_secret
  aws_s3_bucket
)

AWS_REGION="us-east-1"
HEALTH_ATTEMPTS=6
HEALTH_WAIT_SECONDS=10

usage() {
  echo "usage: scripts/release.sh <dev|prod>" >&2
}

fail() {
  echo "error: $1" >&2
  exit 1
}

# ---- argument validation: before any Terraform runs ----------------------

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

env_name="$1"
case "${env_name}" in
  dev | prod) ;;
  *)
    usage
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
env_dir="${repo_root}/infra/envs/${env_name}"
build_dir="${repo_root}/infra/build"

# ---- backend settings: KEY=VALUE lines, never sourced --------------------

backend_file="${env_dir}/cloud.auto.tfbackend"
[ -f "${backend_file}" ] || fail "infra/envs/${env_name}/cloud.auto.tfbackend is missing; copy the .example file and fill it in"

TF_CLOUD_ORGANIZATION=""
TF_CLOUD_PROJECT=""
TF_WORKSPACE=""
while IFS='=' read -r key value || [ -n "${key}" ]; do
  # A file edited on Windows carries carriage returns; drop them.
  key="${key%$'\r'}"
  value="${value%$'\r'}"
  case "${key}" in
    TF_CLOUD_ORGANIZATION) TF_CLOUD_ORGANIZATION="${value}" ;;
    TF_CLOUD_PROJECT) TF_CLOUD_PROJECT="${value}" ;;
    TF_WORKSPACE) TF_WORKSPACE="${value}" ;;
    *) ;;
  esac
done < <(grep -v '^[[:space:]]*#' "${backend_file}" || true)

for name in TF_CLOUD_ORGANIZATION TF_CLOUD_PROJECT TF_WORKSPACE; do
  if [ -z "${!name}" ]; then
    fail "${name} is missing from infra/envs/${env_name}/cloud.auto.tfbackend"
  fi
done
export TF_CLOUD_ORGANIZATION TF_CLOUD_PROJECT TF_WORKSPACE

for tool in terraform jq npm aws curl; do
  command -v "${tool}" >/dev/null 2>&1 || fail "${tool} is not installed"
done

# ---- build: Lambda zips and the site -------------------------------------

lambda_build_cmd="${COMPASS_LAMBDA_BUILD_CMD:-npm run build:lambda --workspace @compass/pass-service}"
site_build_cmd="${COMPASS_SITE_BUILD_CMD:-npm run build --workspace site}"
site_dir="${repo_root}/${COMPASS_SITE_DIR:-site/dist/site/browser}"

cd "${repo_root}"
echo "building the Lambda bundles"
bash -c "${lambda_build_cmd}" || fail "the Lambda build failed"

mkdir -p "${build_dir}"
for name in api passkit; do
  source_zip="${repo_root}/packages/pass-service/dist/lambda/${name}.zip"
  [ -f "${source_zip}" ] || fail "the Lambda build did not produce ${name}.zip"
  cp "${source_zip}" "${build_dir}/${name}-lambda.zip"
done

echo "building the site"
bash -c "${site_build_cmd}" || fail "the site build failed"
[ -d "${site_dir}" ] || fail "the site build did not produce its output directory"

# ---- plan -----------------------------------------------------------------

service_version="$(git -C "${repo_root}" describe --tags --always --dirty 2>/dev/null || echo "0.0.0")"

cd "${env_dir}"
terraform init -input=false || fail "terraform init failed"

echo "planning ${env_name}"
terraform plan -input=false -out=tfplan -var "service_version=${service_version}" || fail "terraform plan failed"

plan_json="$(terraform show -json tfplan)" || fail "could not read the saved plan"

# jq reads the plan through a pipe from the shell, never from a file on disk.
plan_jq() {
  printf '%s' "${plan_json}" | jq "$@"
}

# ---- refusal checks (print addresses and types only) -----------------------

retained_json="$(jq -n '$ARGS.positional' --args "${RETAINED_TYPES[@]}")"
allowed_json="$(jq -n '$ARGS.positional' --args "${ALLOWED_TYPES[@]}")"

# shellcheck disable=SC2016 # the single quotes hold a jq program, not shell
retained_hits="$(plan_jq -r --argjson retained "${retained_json}" '
  .resource_changes[]?
  | select(.mode == "managed")
  | select(.change.actions | index("delete") != null)
  | select(.type as $t | ($retained | index($t)) != null)
  | .address')"

if [ -n "${retained_hits}" ]; then
  echo "refused: the plan would destroy or replace a retained resource:" >&2
  echo "${retained_hits}" >&2
  echo "nothing was applied" >&2
  exit 1
fi

# shellcheck disable=SC2016 # the single quotes hold a jq program, not shell
unexpected_types="$(plan_jq -r --argjson allowed "${allowed_json}" '
  .resource_changes[]?
  | select(.mode == "managed")
  | select((.change.actions == ["no-op"]) | not)
  | select(.type as $t | ($allowed | index($t)) == null)
  | .type' | sort -u)"

if [ -n "${unexpected_types}" ]; then
  echo "refused: the plan touches resource types outside the allow list:" >&2
  echo "${unexpected_types}" >&2
  echo "nothing was applied" >&2
  exit 1
fi

to_add="$(plan_jq '[.resource_changes[]? | select(.change.actions | index("create"))] | length')"
to_change="$(plan_jq '[.resource_changes[]? | select(.change.actions == ["update"])] | length')"
to_destroy="$(plan_jq '[.resource_changes[]? | select(.change.actions | index("delete"))] | length')"
echo "plan for ${env_name}: ${to_add} to add or replace, ${to_change} to change, ${to_destroy} to destroy"

# ---- typed confirmation -----------------------------------------------------

expected_answer="yes"
if [ "${env_name}" = "prod" ]; then
  expected_answer="prod"
fi
printf 'Type %s to apply this plan to %s: ' "${expected_answer}" "${env_name}"
answer=""
read -r answer || true
if [ "${answer}" != "${expected_answer}" ]; then
  echo "aborted: nothing was applied" >&2
  exit 1
fi

# ---- apply, sync, invalidate ------------------------------------------------

terraform apply -input=false tfplan || fail "terraform apply failed"

cloudfront_domain="$(terraform output -raw cloudfront_domain_name)" || fail "could not read the CloudFront domain output"
distribution_id="$(terraform output -raw distribution_id)" || fail "could not read the distribution output"
site_bucket="$(terraform output -raw site_bucket_name)" || fail "could not read the site bucket output"

echo "syncing the site (uses your own AWS SSO session)"
aws sts get-caller-identity --region "${AWS_REGION}" >/dev/null 2>&1 || fail "no AWS session; run aws sso login first"
aws s3 sync --region "${AWS_REGION}" "${site_dir}" "s3://${site_bucket}" --delete --only-show-errors || fail "the site sync failed"

echo "invalidating the CloudFront cache"
aws cloudfront create-invalidation --region "${AWS_REGION}" --distribution-id "${distribution_id}" --paths "/*" >/dev/null || fail "the cache invalidation failed"

# ---- health check: only HTTP 200 is success --------------------------------

attempt=1
while [ "${attempt}" -le "${HEALTH_ATTEMPTS}" ]; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://${cloudfront_domain}/api/v1/health" || true)"
  if [ "${status}" = "200" ]; then
    echo "health check passed (HTTP 200)"
    exit 0
  fi
  echo "health check attempt ${attempt} of ${HEALTH_ATTEMPTS} returned HTTP ${status:-none}" >&2
  attempt=$((attempt + 1))
  sleep "${HEALTH_WAIT_SECONDS}"
done

fail "the health check never returned HTTP 200"
