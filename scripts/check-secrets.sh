#!/usr/bin/env bash
# Check that every sensitive value exists where it must, without reading any
# value.
#
# usage: scripts/check-secrets.sh <dev|prod>
#
# OWNER-RUN ONLY. It reports present or MISSING for:
#   - the sensitive HCP workspace variables alarm_email, origin_verify_value and
#     api_key_value (HCP never returns a sensitive value, so only the key is seen);
#   - the four Secrets Manager secrets (app, origin-verify, apple-pass,
#     google-wallet), by whether the AWSCURRENT stage has a version.
#
# It cannot compare the HCP origin_verify_value with the stored secret, because
# neither value may be read back. A mismatch shows as health check failures after a
# release; the fix is to run set-workspace-secrets.sh and load-secrets.sh from the
# same file again.
#
# Needs: aws (your SSO session), curl, jq, TFE_TOKEN, and
# infra/envs/<env>/cloud.auto.tfbackend. No value, token or identifier is printed,
# only the names below.
#
# Exit status: 0 when everything is present, 1 when anything is missing or a call
# fails (it fails closed).

set -euo pipefail

HCP_API="https://app.terraform.io/api/v2"
AWS_REGION="us-east-1"

usage() {
  echo "usage: scripts/check-secrets.sh <dev|prod>" >&2
}

fail() {
  echo "error: $1" >&2
  exit 1
}

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

for tool in aws curl jq; do
  command -v "${tool}" >/dev/null 2>&1 || fail "${tool} is not installed"
done
[ -n "${TFE_TOKEN:-}" ] || fail "TFE_TOKEN is not set"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_file="${script_dir}/../infra/envs/${env_name}/cloud.auto.tfbackend"
[ -f "${backend_file}" ] || fail "infra/envs/${env_name}/cloud.auto.tfbackend is missing"

organization=""
workspace=""
while IFS='=' read -r key value || [ -n "${key}" ]; do
  key="${key%$'\r'}"
  value="${value%$'\r'}"
  case "${key}" in
    TF_CLOUD_ORGANIZATION) organization="${value}" ;;
    TF_WORKSPACE) workspace="${value}" ;;
    *) ;;
  esac
done < <(grep -v '^[[:space:]]*#' "${backend_file}" || true)
[ -n "${organization}" ] || fail "TF_CLOUD_ORGANIZATION is missing from infra/envs/${env_name}/cloud.auto.tfbackend"
[ -n "${workspace}" ] || fail "TF_WORKSPACE is missing from infra/envs/${env_name}/cloud.auto.tfbackend"

# GET from HCP; the token goes to curl on stdin, the response body is returned on
# stdout and never printed by this script.
hcp_get() {
  local path="$1"
  local response
  if ! response="$(printf 'header = "Authorization: Bearer %s"\n' "${TFE_TOKEN}" |
    curl -sS --fail --max-time 30 -K - -H "Content-Type: application/vnd.api+json" "${HCP_API}${path}" 2>/dev/null)"; then
    fail "the HCP API call GET ${path} failed"
  fi
  printf '%s' "${response}"
}

missing=0

workspace_id="$(hcp_get "/organizations/${organization}/workspaces/${workspace}" | jq -r '.data.id')"
if [ -z "${workspace_id}" ] || [ "${workspace_id}" = "null" ]; then
  fail "could not find the workspace"
fi
variable_keys="$(hcp_get "/workspaces/${workspace_id}/vars" | jq -r '.data[].attributes.key')"

for var_name in alarm_email origin_verify_value api_key_value; do
  if printf '%s\n' "${variable_keys}" | grep -qx "${var_name}"; then
    echo "present: HCP variable ${var_name}"
  else
    echo "MISSING: HCP variable ${var_name}"
    missing=1
  fi
done

for name in app origin-verify apple-pass google-wallet; do
  secret_name="compass/${env_name}/${name}"
  if ! count="$(aws secretsmanager list-secret-version-ids \
    --region "${AWS_REGION}" \
    --secret-id "${secret_name}" \
    --query "length(Versions[?contains(VersionStages, 'AWSCURRENT')])" \
    --output text 2>/dev/null)"; then
    fail "could not check ${secret_name}"
  fi
  case "${count}" in
    0)
      echo "MISSING: secret ${secret_name} has no value"
      missing=1
      ;;
    [1-9] | [1-9][0-9]*) echo "present: secret ${secret_name}" ;;
    *) fail "unexpected answer while checking ${secret_name}" ;;
  esac
done

if [ "${missing}" -ne 0 ]; then
  exit 1
fi
echo "all sensitive values are present (values are never compared or shown)"
