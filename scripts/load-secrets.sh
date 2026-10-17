#!/usr/bin/env bash
# Load the Apple and Google Wallet secret material into Secrets Manager.
#
# usage:
#   scripts/load-secrets.sh <dev|prod> apple --p12 FILE --wwdr FILE --pass-type-id ID --team-id ID
#   scripts/load-secrets.sh <dev|prod> google --service-account FILE --issuer-id ID
#   scripts/load-secrets.sh <dev|prod> edge-values --origin-verify-out FILE --api-key-out FILE
#   scripts/load-secrets.sh <dev|prod> app --origin-verify-file FILE [--rotate]
#
# OWNER-RUN ONLY, on your own machine, under your own AWS SSO session.
#
# apple   converts the Pass Type ID .p12 to the PEM values the pass-service reads
#         and writes compass/<env>/apple-pass with the keys passTypeIdentifier,
#         teamIdentifier, signerCertPem, signerKeyPem, signerKeyPassphrase and
#         wwdrPem. The .p12 password is read from the COMPASS_P12_PASSWORD
#         environment variable or, when that is unset, from a silent prompt.
# google  writes compass/<env>/google-wallet with the keys issuerId and
#         serviceAccount (the downloaded service account key).
# edge-values  (no AWS call, run it BEFORE the first apply) generates the origin-verify
#         value and the API key locally with openssl rand and writes each to a new
#         file you name (mode 600). Set the sensitive HCP variables
#         origin_verify_value and api_key_value from those files. Terraform
#         generates neither value.
# app     (run it AFTER the first apply has created the empty secret containers)
#         generates the pepper locally and writes pepper and originVerify into
#         compass/<env>/app, taking originVerify from the file edge-values wrote.
#         It refuses to replace a secret that already holds a value unless you
#         pass --rotate, because rotating the origin-verify value breaks the edge
#         until the HCP variable and the secret agree again. Shred the files when
#         the HCP variables are set and the app secret is written.
#
# Secret handling: no secret value is ever printed or passed on a command line.
# Values travel only through files in a private temporary directory (mode 700)
# that is shredded and removed on every exit path, success or failure. Errors name
# a path or a secret name, never content.
#
# Exit status: 0 only after the write succeeds, non-zero otherwise.

set -euo pipefail
umask 077

usage() {
  echo "usage: scripts/load-secrets.sh <dev|prod> apple --p12 FILE --wwdr FILE --pass-type-id ID --team-id ID" >&2
  echo "       scripts/load-secrets.sh <dev|prod> google --service-account FILE --issuer-id ID" >&2
  echo "       scripts/load-secrets.sh <dev|prod> edge-values --origin-verify-out FILE --api-key-out FILE" >&2
  echo "       scripts/load-secrets.sh <dev|prod> app --origin-verify-file FILE [--rotate]" >&2
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

require_readable_file() {
  local path="$1"
  if [ ! -f "${path}" ] || [ ! -r "${path}" ]; then
    echo "error: cannot read file: ${path}" >&2
    exit 1
  fi
}

if [ "$#" -lt 2 ]; then
  usage
  exit 2
fi

env_name="$1"
kind="$2"
shift 2

case "${env_name}" in
  dev | prod) ;;
  *)
    usage
    exit 2
    ;;
esac

required_tools=(jq openssl)
if [ "${kind}" != "edge-values" ]; then
  required_tools+=(aws)
fi
for tool in "${required_tools[@]}"; do
  command -v "${tool}" >/dev/null 2>&1 || fail "${tool} is not installed"
done

work_dir="$(mktemp -d)"
chmod 700 "${work_dir}"
trap 'wipe_dir "${work_dir}"' EXIT

write_secret() {
  local secret_name="$1"
  local json_file="$2"
  if ! aws secretsmanager put-secret-value \
    --secret-id "${secret_name}" \
    --secret-string "file://${json_file}" >/dev/null 2>&1; then
    echo "error: could not write the secret ${secret_name}" >&2
    exit 1
  fi
  echo "wrote ${secret_name}"
}

load_apple() {
  local p12="" wwdr="" pass_type_id="" team_id=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --p12) p12="${2:-}"; shift 2 ;;
      --wwdr) wwdr="${2:-}"; shift 2 ;;
      --pass-type-id) pass_type_id="${2:-}"; shift 2 ;;
      --team-id) team_id="${2:-}"; shift 2 ;;
      *) usage; exit 2 ;;
    esac
  done
  if [ -z "${p12}" ] || [ -z "${wwdr}" ] || [ -z "${pass_type_id}" ] || [ -z "${team_id}" ]; then
    usage
    exit 2
  fi
  require_readable_file "${p12}"
  require_readable_file "${wwdr}"

  if [ -z "${COMPASS_P12_PASSWORD:-}" ]; then
    if [ -t 0 ]; then
      read -r -s -p "p12 password (not shown): " COMPASS_P12_PASSWORD
      echo >&2
    else
      fail "set COMPASS_P12_PASSWORD or run from a terminal to be prompted"
    fi
  fi
  export COMPASS_P12_PASSWORD

  # The signing key is stored encrypted with a random passphrase that travels
  # in the secret itself (the pass-service reads signerKeyPassphrase).
  local pass_file="${work_dir}/key.pass"
  openssl rand -hex 24 >"${pass_file}"
  COMPASS_KEY_PASSPHRASE="$(cat "${pass_file}")"
  export COMPASS_KEY_PASSPHRASE

  local cert_raw="${work_dir}/cert.raw.pem"
  local cert="${work_dir}/cert.pem"
  local key="${work_dir}/key.pem"
  local wwdr_pem="${work_dir}/wwdr.pem"

  # OpenSSL 3 needs -legacy for older .p12 encryption; try it second.
  if ! openssl pkcs12 -in "${p12}" -clcerts -nokeys -passin env:COMPASS_P12_PASSWORD -out "${cert_raw}" 2>/dev/null; then
    openssl pkcs12 -legacy -in "${p12}" -clcerts -nokeys -passin env:COMPASS_P12_PASSWORD -out "${cert_raw}" 2>/dev/null ||
      fail "could not read the certificate from ${p12} (wrong password or not a .p12)"
  fi
  if ! openssl pkcs12 -in "${p12}" -nocerts -passin env:COMPASS_P12_PASSWORD -passout env:COMPASS_KEY_PASSPHRASE -out "${key}" 2>/dev/null; then
    openssl pkcs12 -legacy -in "${p12}" -nocerts -passin env:COMPASS_P12_PASSWORD -passout env:COMPASS_KEY_PASSPHRASE -out "${key}" 2>/dev/null ||
      fail "could not read the private key from ${p12}"
  fi
  openssl x509 -in "${cert_raw}" -out "${cert}" 2>/dev/null || fail "the certificate in ${p12} is not valid"

  # The WWDR certificate arrives as DER (.cer) or PEM.
  if ! openssl x509 -inform der -in "${wwdr}" -out "${wwdr_pem}" 2>/dev/null; then
    openssl x509 -in "${wwdr}" -out "${wwdr_pem}" 2>/dev/null || fail "the WWDR certificate ${wwdr} is not valid DER or PEM"
  fi

  local json_file="${work_dir}/apple-pass.json"
  jq -n \
    --arg passTypeIdentifier "${pass_type_id}" \
    --arg teamIdentifier "${team_id}" \
    --rawfile signerCertPem "${cert}" \
    --rawfile signerKeyPem "${key}" \
    --rawfile signerKeyPassphrase "${pass_file}" \
    --rawfile wwdrPem "${wwdr_pem}" \
    '{passTypeIdentifier: $passTypeIdentifier, teamIdentifier: $teamIdentifier,
      signerCertPem: $signerCertPem, signerKeyPem: $signerKeyPem,
      signerKeyPassphrase: ($signerKeyPassphrase | rtrimstr("\n")), wwdrPem: $wwdrPem}' >"${json_file}" ||
    fail "could not assemble the apple-pass secret"

  unset COMPASS_P12_PASSWORD COMPASS_KEY_PASSPHRASE
  write_secret "compass/${env_name}/apple-pass" "${json_file}"
}

load_google() {
  local service_account="" issuer_id=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --service-account) service_account="${2:-}"; shift 2 ;;
      --issuer-id) issuer_id="${2:-}"; shift 2 ;;
      *) usage; exit 2 ;;
    esac
  done
  if [ -z "${service_account}" ] || [ -z "${issuer_id}" ]; then
    usage
    exit 2
  fi
  require_readable_file "${service_account}"

  if ! jq -e '(.client_email | type == "string") and (.private_key | type == "string")' "${service_account}" >/dev/null 2>&1; then
    fail "${service_account} is not a service account key (it needs client_email and private_key)"
  fi

  local json_file="${work_dir}/google-wallet.json"
  jq -n \
    --arg issuerId "${issuer_id}" \
    --slurpfile serviceAccount "${service_account}" \
    '{issuerId: $issuerId, serviceAccount: $serviceAccount[0]}' >"${json_file}" ||
    fail "could not assemble the google-wallet secret"

  write_secret "compass/${env_name}/google-wallet" "${json_file}"
}

load_edge_values() {
  local origin_out="" api_key_out=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --origin-verify-out) origin_out="${2:-}"; shift 2 ;;
      --api-key-out) api_key_out="${2:-}"; shift 2 ;;
      *) usage; exit 2 ;;
    esac
  done
  if [ -z "${origin_out}" ] || [ -z "${api_key_out}" ]; then
    usage
    exit 2
  fi
  if [ -e "${origin_out}" ] || [ -e "${api_key_out}" ]; then
    echo "error: an output file already exists; name new files: ${origin_out} ${api_key_out}" >&2
    exit 1
  fi
  openssl rand -hex 32 >"${origin_out}" || fail "could not write ${origin_out}"
  openssl rand -hex 32 >"${api_key_out}" || fail "could not write ${api_key_out}"
  chmod 600 "${origin_out}" "${api_key_out}"
  echo "wrote ${origin_out} and ${api_key_out}: set the HCP variables origin_verify_value and api_key_value from them"
}

load_app() {
  local origin_file="" rotate="no"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --origin-verify-file) origin_file="${2:-}"; shift 2 ;;
      --rotate) rotate="yes"; shift ;;
      *) usage; exit 2 ;;
    esac
  done
  if [ -z "${origin_file}" ]; then
    usage
    exit 2
  fi
  require_readable_file "${origin_file}"

  local length
  length="$(tr -d '\r\n' <"${origin_file}" | wc -c)"
  if [ "${length}" -lt 32 ]; then
    fail "the origin-verify value in ${origin_file} is shorter than 32 characters"
  fi

  if [ "${rotate}" != "yes" ]; then
    # A secret that already has a value has a last-changed date.
    if aws secretsmanager describe-secret --secret-id "compass/${env_name}/app" \
      --query 'LastChangedDate' --output text 2>/dev/null | grep -qv '^None$'; then
      fail "compass/${env_name}/app already holds a value; pass --rotate to replace it"
    fi
  fi

  local pepper_file="${work_dir}/pepper"
  openssl rand -hex 32 >"${pepper_file}" || fail "could not generate the pepper"

  local json_file="${work_dir}/app.json"
  jq -n \
    --rawfile pepper "${pepper_file}" \
    --rawfile originVerify "${origin_file}" \
    '{pepper: ($pepper | rtrimstr("\n")), originVerify: ($originVerify | rtrimstr("\n"))}' >"${json_file}" ||
    fail "could not assemble the app secret"

  write_secret "compass/${env_name}/app" "${json_file}"
}

case "${kind}" in
  apple) load_apple "$@" ;;
  app) load_app "$@" ;;
  edge-values) load_edge_values "$@" ;;
  google) load_google "$@" ;;
  *)
    usage
    exit 2
    ;;
esac
