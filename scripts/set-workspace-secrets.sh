#!/usr/bin/env bash
# Set the sensitive HCP Terraform workspace variables from local files, through
# the HCP API.
#
# usage:
#   scripts/set-workspace-secrets.sh <dev|prod> [--origin-verify-file FILE] [--api-key-file FILE] [--alarm-email-file FILE]
#
# OWNER-RUN ONLY. The sensitive variables alarm_email, origin_verify_value and
# api_key_value are never set through Terraform, because Terraform would keep them
# in state; this script sets them directly in the workspace as sensitive variables
# (HCP never shows a sensitive value again).
#
# Needs: curl, jq, the TFE_TOKEN environment variable (an HCP user or team token
# that can write variables on the workspace), and infra/envs/<env>/cloud.auto.tfbackend.
# The token is passed to curl on stdin, never on a command line. No value and no
# token is printed; the script names only the variable keys it set. Values pass
# through files in a private temporary directory that is shredded on exit, with
# carriage returns and newlines stripped so the stored value matches the file on
# any platform.
#
# Exit status: 0 only after every requested variable was written.

set -euo pipefail
umask 077

HCP_API="https://app.terraform.io/api/v2"

usage() {
  echo "usage: scripts/set-workspace-secrets.sh <dev|prod> [--origin-verify-file FILE] [--api-key-file FILE] [--alarm-email-file FILE]" >&2
}

fail() {
  echo "error: $1" >&2
  exit 1
}

wipe_dir() {
  local dir="$1"
  if [ -d "${dir}" ]; then
    if command -v shred >/dev/null 2>&1; then
      find "${dir}" -type f -exec shred -u {} + 2>/dev/null || true
    fi
    rm -rf "${dir}"
  fi
}

if [ "$#" -lt 3 ]; then
  usage
  exit 2
fi

env_name="$1"
shift
case "${env_name}" in
  dev | prod) ;;
  *)
    usage
    exit 2
    ;;
esac

origin_file=""
api_key_file=""
alarm_email_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --origin-verify-file) origin_file="${2:-}"; shift 2 ;;
    --api-key-file) api_key_file="${2:-}"; shift 2 ;;
    --alarm-email-file) alarm_email_file="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

for tool in curl jq; do
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

work_dir="$(mktemp -d)"
chmod 700 "${work_dir}"
trap 'wipe_dir "${work_dir}"' EXIT

# One HCP API call. The token goes to curl on stdin as a config line, the body
# (if any) comes from a file, and the response is written to the named file.
# A failure prints no response body.
hcp_call() {
  local method="$1" path="$2" out="$3" body="${4:-}"
  local args=(-sS --fail --max-time 30 -X "${method}" -K - -H "Content-Type: application/vnd.api+json" -o "${out}")
  if [ -n "${body}" ]; then
    args+=(--data-binary "@${body}")
  fi
  if ! printf 'header = "Authorization: Bearer %s"\n' "${TFE_TOKEN}" | curl "${args[@]}" "${HCP_API}${path}" 2>/dev/null; then
    fail "the HCP API call ${method} ${path} failed"
  fi
}

workspace_json="${work_dir}/workspace.json"
hcp_call GET "/organizations/${organization}/workspaces/${workspace}" "${workspace_json}"
workspace_id="$(jq -r '.data.id' "${workspace_json}")"
[ -n "${workspace_id}" ] && [ "${workspace_id}" != "null" ] || fail "could not find the workspace"

vars_json="${work_dir}/vars.json"
hcp_call GET "/workspaces/${workspace_id}/vars" "${vars_json}"

set_variable() {
  local var_key="$1" file="$2"
  [ -f "${file}" ] && [ -r "${file}" ] || fail "cannot read file: ${file}"
  local clean="${work_dir}/${var_key}.value"
  tr -d '\r\n' <"${file}" >"${clean}"
  [ -s "${clean}" ] || fail "the file for ${var_key} is empty: ${file}"

  local body="${work_dir}/${var_key}.body"
  jq -n --rawfile value "${clean}" --arg key "${var_key}" \
    '{data: {type: "vars", attributes: {key: $key, value: $value, category: "terraform", hcl: false, sensitive: true}}}' >"${body}" ||
    fail "could not build the request for ${var_key}"

  local existing_id
  existing_id="$(jq -r --arg key "${var_key}" '.data[] | select(.attributes.key == $key and .attributes.category == "terraform") | .id' "${vars_json}" | head -n 1)"
  local response="${work_dir}/${var_key}.response"
  if [ -n "${existing_id}" ]; then
    jq --arg id "${existing_id}" '.data.id = $id' "${body}" >"${body}.patch" && mv "${body}.patch" "${body}"
    hcp_call PATCH "/workspaces/${workspace_id}/vars/${existing_id}" "${response}" "${body}"
  else
    hcp_call POST "/workspaces/${workspace_id}/vars" "${response}" "${body}"
  fi
  echo "set the sensitive variable ${var_key}"
}

if [ -n "${origin_file}" ]; then
  set_variable origin_verify_value "${origin_file}"
fi
if [ -n "${api_key_file}" ]; then
  set_variable api_key_value "${api_key_file}"
fi
if [ -n "${alarm_email_file}" ]; then
  set_variable alarm_email "${alarm_email_file}"
fi

echo "done: shred the files you passed in"
