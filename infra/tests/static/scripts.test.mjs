// Script checks (Requirements 11.4, 12.11, 13.6, 14, 17.2; Property 8).
//
// The owner-run scripts are never executed here: the branches that matter are
// asserted against the script source. shellcheck must be clean, the argument and
// refusal guards must exist in the right order, and no output statement may
// reference a secret-bearing variable (Property 8).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { readOwned, repoRoot } from './lib.mjs';

const SHELL_SCRIPTS = [
  'scripts/bootstrap.sh',
  'scripts/release.sh',
  'scripts/load-secrets.sh',
  'scripts/set-workspace-secrets.sh',
  'scripts/check-secrets.sh',
];
const ALL_SCRIPTS = [...SHELL_SCRIPTS, 'scripts/google-wallet-class.mjs'];

// Names of variables that hold secret material or a value derived from it.
const SECRET_VARIABLES = [
  'COMPASS_P12_PASSWORD',
  'COMPASS_KEY_PASSPHRASE',
  'pepper',
  'pepper_file',
  'origin_file',
  'api_key_file',
  'pass_file',
  'cert',
  'cert_raw',
  'key',
  'wwdr_pem',
  'json_file',
  'value',
  'password',
  'private_key',
  'assertion',
  'token',
  'access_token',
  'privateKeyPem',
  'privateKey',
  'TFE_TOKEN',
  'clean',
  'clean_file',
  'body',
];

const OUTPUT_STATEMENT =
  /\b(echo|printf|console\.(log|error|warn|info)|process\.(stdout|stderr)\.write)\b/;

/**
 * Output statements that reference a secret-bearing variable.
 *
 * @param {string} source script text
 * @returns {string[]} offending lines (one number each, never the text)
 */
export function secretEchoes(source) {
  const problems = [];
  source.split('\n').forEach((line, index) => {
    if (line.trimStart().startsWith('#') || line.trimStart().startsWith('//')) return;
    if (!OUTPUT_STATEMENT.test(line)) return;
    // A printf piped into curl hands the token to curl on stdin; it prints nothing.
    if (/\|\s*curl/.test(line) || /\|\s*$/.test(line)) return;
    for (const name of SECRET_VARIABLES) {
      const shell = new RegExp(`\\$\\{?${name}\\}?(?![A-Za-z0-9_])`);
      const js = new RegExp(`\\$\\{\\s*[A-Za-z_.]*\\b${name}\\b`);
      if (shell.test(line) || js.test(line)) problems.push(`line ${index + 1} uses ${name}`);
    }
  });
  return problems;
}

test('shellcheck is clean on every shell script', () => {
  const result = spawnSync('shellcheck', SHELL_SCRIPTS, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.error, undefined, 'shellcheck must be installed');
  assert.equal(result.status, 0, result.stdout);
});

test('the secret echo check flags a secret in an output statement and accepts names', () => {
  assert.equal(secretEchoes('echo "password is ${COMPASS_P12_PASSWORD}"').length, 1);
  assert.equal(secretEchoes('printf "%s" "$pepper"').length, 1);
  assert.equal(secretEchoes('process.stdout.write(`k ${privateKey}`)').length, 1);
  assert.deepEqual(secretEchoes('echo "wrote ${secret_name}"'), []);
  assert.deepEqual(secretEchoes('echo "error: cannot read file: ${path}" >&2'), []);
  assert.deepEqual(secretEchoes('echo "$wrote the origin file ${origin_out}"'), []);
});

test('no script echoes a secret-bearing variable on any path (Property 8)', () => {
  for (const script of ALL_SCRIPTS) {
    assert.deepEqual(secretEchoes(readOwned(script)), [], script);
  }
});

test('no script enables tracing or debug output', () => {
  for (const script of SHELL_SCRIPTS) {
    const source = readOwned(script);
    assert.doesNotMatch(source, /^\s*set\s+-[a-z]*x/m, script);
    assert.doesNotMatch(source, /bash\s+-[a-z]*x/, script);
    assert.doesNotMatch(source, /--debug/, script);
  }
});

test('every shell script fails fast and is run by the owner only', () => {
  for (const script of SHELL_SCRIPTS) {
    const source = readOwned(script);
    assert.match(source, /^set -euo pipefail$/m, script);
    assert.match(source, /OWNER-RUN ONLY/, script);
  }
  assert.match(readOwned('scripts/google-wallet-class.mjs'), /OWNER-RUN ONLY/);
});

test('no script creates infrastructure outside Terraform', () => {
  for (const script of ALL_SCRIPTS) {
    const code = readOwned(script)
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#') && !l.trimStart().startsWith('//'))
      .join('\n');
    assert.doesNotMatch(
      code,
      /cloudformation|cdk deploy|sam deploy|create-bucket|create-table|create-function|create-distribution/i,
      script,
    );
  }
});

test('release.sh validates the environment argument before running any Terraform', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(source, /if \[ "\$#" -ne 1 \]; then\s+usage\s+exit 2/);
  assert.match(source, /case "\$\{env_name\}" in\s+dev \| prod\) ;;\s+\*\)\s+usage\s+exit 2/);
  const firstTerraformCall = source.search(/^\s*terraform (init|plan|apply|show|output)/m);
  const argumentCheck = source.indexOf('case "${env_name}" in');
  assert.ok(argumentCheck > 0 && firstTerraformCall > argumentCheck);
});

test('release.sh names the missing backend key and loads the backend file without sourcing it', () => {
  const source = readOwned('scripts/release.sh');
  for (const key of ['TF_CLOUD_ORGANIZATION', 'TF_CLOUD_PROJECT', 'TF_WORKSPACE']) {
    assert.match(source, new RegExp(`${key}\\) ${key}=`));
  }
  assert.match(
    source,
    /fail "\$\{name\} is missing from infra\/envs\/\$\{env_name\}\/cloud\.auto\.tfbackend"/,
  );
  assert.doesNotMatch(source, /^\s*(source|\.)\s+.*tfbackend/m);
});

test('release.sh refuses a retained resource and an unexpected type without applying', () => {
  const source = readOwned('scripts/release.sh');
  for (const type of [
    'aws_cloudfront_distribution',
    'aws_dynamodb_table',
    'aws_secretsmanager_secret',
    'aws_s3_bucket',
  ]) {
    assert.match(source, new RegExp(`^  ${type}$`, 'm'));
  }
  assert.match(source, /refused: the plan would destroy or replace a retained resource/);
  assert.match(source, /refused: the plan touches resource types outside the allow list/);
  const retainedRefusal = source.indexOf('refused: the plan would destroy');
  const typeRefusal = source.indexOf('refused: the plan touches');
  const confirm = source.indexOf("printf 'Type %s to apply");
  const apply = source.indexOf('terraform apply -input=false tfplan');
  assert.ok(retainedRefusal > 0 && typeRefusal > retainedRefusal);
  assert.ok(confirm > typeRefusal && apply > confirm);
  assert.match(source, /nothing was applied/);
});

test('release.sh aborts on anything but the typed word and treats only HTTP 200 as healthy', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(
    source,
    /if \[ "\$\{answer\}" != "\$\{expected_answer\}" \]; then\s+echo "aborted: nothing was applied" >&2\s+exit 1/,
  );
  // dev asks for yes, prod asks for the environment name.
  assert.match(
    source,
    /expected_answer="yes"\s+if \[ "\$\{env_name\}" = "prod" \]; then\s+expected_answer="prod"/,
  );
  assert.match(source, /if \[ "\$\{status\}" = "200" \]; then/);
  assert.match(source, /fail "the health check never returned HTTP 200"/);
  assert.match(source, /\/api\/v1\/health/);
});

test('release.sh allows the API key types and no longer allows secret versions or random passwords', () => {
  const source = readOwned('scripts/release.sh');
  for (const type of [
    'aws_api_gateway_api_key',
    'aws_api_gateway_usage_plan',
    'aws_api_gateway_usage_plan_key',
  ]) {
    assert.match(source, new RegExp(`^  ${type}$`, 'm'));
  }
  assert.doesNotMatch(source, /^ {2}aws_secretsmanager_secret_version$/m);
  assert.doesNotMatch(source, /^ {2}random_password$/m);
});

test('release.sh skips the apply of an empty plan but still asks, syncs and checks health', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(
    source,
    /pending_changes="\$\(plan_jq '\[\(\.resource_changes\[\]\? \| select\(\.mode == "managed"\)/,
  );
  assert.match(
    source,
    /if \[ "\$\{pending_changes\}" = "0" \]; then\s+echo "no infrastructure changes: skipping terraform apply"\s+else\s+terraform apply -input=false tfplan \|\| fail "terraform apply failed"\s+fi/,
  );
  const confirm = source.indexOf("printf 'Type %s to apply");
  const skip = source.indexOf('if [ "${pending_changes}" = "0" ]');
  const sync = source.indexOf('aws s3 sync');
  assert.ok(confirm > 0 && skip > confirm && sync > skip);
});

test('release.sh exits non-zero when the apply, the sync or the invalidation fails', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(source, /terraform apply -input=false tfplan \|\| fail/);
  assert.match(source, /aws s3 sync .* \|\| fail/);
  assert.match(source, /aws s3 cp .*--include "\*\.webp" --content-type image\/webp .*\|\| fail/);
  assert.match(source, /aws cloudfront create-invalidation .* \|\| fail/);
});

test('release.sh never writes the plan JSON to disk and pipes it to jq', () => {
  const source = readOwned('scripts/release.sh');
  assert.doesNotMatch(source, /mktemp/);
  assert.doesNotMatch(source, /show -json tfplan\s*>/);
  assert.doesNotMatch(source, /<<</);
  assert.match(source, /plan_json="\$\(terraform show -json tfplan\)"/);
  assert.match(source, /printf '%s' "\$\{plan_json\}" \| jq/);
});

test('release.sh strips carriage returns from the backend file and pins the region', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(source, /key="\$\{key%\$'\\r'\}"/);
  assert.match(source, /value="\$\{value%\$'\\r'\}"/);
  for (const command of [
    'aws sts get-caller-identity',
    'aws s3 sync',
    'aws cloudfront create-invalidation',
    'aws s3api head-bucket',
  ]) {
    assert.match(source, new RegExp(`${command} --region "\\$\\{AWS_REGION\\}"`));
  }
});

test('release.sh checks the AWS session before the build and the bucket access before the plan', () => {
  const source = readOwned('scripts/release.sh');
  const session = source.indexOf('aws sts get-caller-identity');
  const build = source.indexOf('bash -c "${lambda_build_cmd}"');
  const init = source.indexOf('terraform init -input=false');
  const bucketCheck = source.indexOf('aws s3api head-bucket');
  const plan = source.indexOf('terraform plan -input=false');
  assert.ok(session > 0 && build > session);
  assert.ok(bucketCheck > init && plan > bucketCheck);
  assert.match(
    source,
    /previous_bucket="\$\(terraform output -raw site_bucket_name 2>\/dev\/null \|\| true\)"\nif \[ -n "\$\{previous_bucket\}" \]; then/,
  );
  assert.match(
    source,
    /--bucket "\$\{previous_bucket\}" >\/dev\/null 2>&1 \\\n\s+\|\| fail "[^"]*AWS_PROFILE[^"]*nothing was applied"/,
  );
  // Checked again before the sync, because an SSO session can expire mid-run.
  assert.ok(source.indexOf('aws sts get-caller-identity', session + 1) > plan);
});

test('bootstrap.sh exits 0 only after a clean apply and non-zero otherwise', () => {
  const source = readOwned('scripts/bootstrap.sh');
  assert.match(source, /if ! terraform init -input=false; then[\s\S]*exit 1\s+fi/);
  assert.match(
    source,
    /if ! terraform apply; then\s+echo "bootstrap failed[^\n]*" >&2\s+exit 1\s+fi/,
  );
  assert.ok(source.trimEnd().endsWith('exit 0'));
});

test('load-secrets.sh names a missing or unreadable path but never its content', () => {
  const source = readOwned('scripts/load-secrets.sh');
  assert.match(source, /echo "error: cannot read file: \$\{path\}" >&2\s+exit 1/);
  assert.match(source, /require_readable_file "\$\{p12\}"/);
  assert.match(source, /require_readable_file "\$\{wwdr\}"/);
  assert.match(source, /require_readable_file "\$\{service_account\}"/);
});

test('load-secrets.sh exits non-zero when a write fails and prints only the secret name', () => {
  const source = readOwned('scripts/load-secrets.sh');
  assert.match(
    source,
    /aws secretsmanager put-secret-value[\s\S]*>\/dev\/null 2>&1; then\s+echo "error: could not write the secret \$\{secret_name\}" >&2\s+exit 1/,
  );
  assert.match(source, /echo "wrote \$\{secret_name\}"/);
});

test('load-secrets.sh keeps secrets off command lines and shreds its temporary files', () => {
  const source = readOwned('scripts/load-secrets.sh');
  assert.match(source, /umask 077/);
  assert.match(source, /chmod 700 "\$\{work_dir\}"/);
  assert.match(source, /trap 'wipe_dir "\$\{work_dir\}"' EXIT/);
  assert.match(source, /shred -u/);
  assert.match(source, /--secret-string "file:\/\//);
  assert.match(source, /-passin env:COMPASS_P12_PASSWORD/);
  assert.doesNotMatch(source, /--secret-string "\$/);
  assert.doesNotMatch(
    source,
    /--arg (signerKeyPem|signerCertPem|signerKeyPassphrase|pepper|originVerify|private_key)\b/,
  );
});

test('load-secrets.sh generates edge values locally and the pepper locally', () => {
  const source = readOwned('scripts/load-secrets.sh');
  assert.match(source, /openssl rand -hex 32 >"\$\{origin_out\}"/);
  assert.match(source, /openssl rand -hex 32 >"\$\{api_key_out\}"/);
  assert.match(source, /openssl rand -base64 32 \| tr '\+\/' '-_'/);
  assert.match(source, /an output file already exists/);
});

test('load-secrets.sh detects an existing value with list-secret-version-ids and fails closed', () => {
  const source = readOwned('scripts/load-secrets.sh');
  assert.match(source, /aws secretsmanager list-secret-version-ids/);
  assert.match(source, /Versions\[\?contains\(VersionStages, 'AWSCURRENT'\)\]/);
  assert.match(source, /could not check \$\{secret_name\}; nothing was written/);
  assert.match(source, /unexpected answer while checking/);
  assert.match(source, /already holds a value; pass --rotate to replace it/);
  assert.match(source, /if \[ "\$\{kind\}" != "edge-values" \]; then\s+required_tools\+=\(aws\)/);
});

test('the scripts run under Git Bash on Windows: carriage returns stripped, file:// path converted', () => {
  const load = readOwned('scripts/load-secrets.sh');
  assert.match(load, /count="\$\{count%\$'\\r'\}"/);
  assert.match(load, /secret_path="\$\(cygpath -m "\$\{json_file\}"\)"/);
  assert.match(load, /--secret-string "file:\/\/\$\{secret_path\}"/);

  const check = readOwned('scripts/check-secrets.sh');
  assert.match(check, /count="\$\{count%\$'\\r'\}"/);
  assert.match(check, /jq -r '\.data\.id' \| tr -d '\\r'/);
  assert.match(check, /jq -r '\.data\[\]\.attributes\.key' \| tr -d '\\r'/);

  const set = readOwned('scripts/set-workspace-secrets.sh');
  assert.match(set, /jq -r '\.data\.id' "\$\{workspace_json\}" \| tr -d '\\r'/);
  assert.match(set, /head -n 1 \| tr -d '\\r'\)"/);

  const release = readOwned('scripts/release.sh');
  assert.match(release, /jq "\$@" \| tr -d '\\r'/);
});

test('load-secrets.sh needs a separate flag, a warning and a typed name to replace the pepper', () => {
  const source = readOwned('scripts/load-secrets.sh');
  assert.match(source, /--rotate-pepper\) rotate_pepper="yes"/);
  assert.match(source, /WARNING: replacing the pepper changes EVERY subHash/);
  assert.match(source, /Type the environment name \(%s\) to replace the pepper/);
  assert.match(source, /already holds a pepper; pass --rotate-pepper --pepper-id pN to replace it/);
  // A plain origin-verify rotation writes its own secret and never touches the pepper.
  assert.match(source, /secret_name="compass\/\$\{env_name\}\/origin-verify"/);
  assert.match(source, /secret_name="compass\/\$\{env_name\}\/app"/);
});

test('load-secrets.sh pins the region on every aws call and strips carriage returns', () => {
  const source = readOwned('scripts/load-secrets.sh');
  const calls =
    source.match(/aws secretsmanager [a-z-]+ \\\n\s+--region "\$\{AWS_REGION\}"/g) ?? [];
  assert.equal(calls.length, 2);
  assert.match(source, /AWS_REGION="us-east-1"/);
  assert.match(source, /tr -d '\\r\\n' <"\$\{source_file\}"/);
});

test('load-secrets.sh refuses to write an edge value inside the repository', () => {
  const source = readOwned('scripts/load-secrets.sh');
  assert.match(source, /refuse_path_inside_repo "\$\{origin_out\}"/);
  assert.match(source, /refuse_path_inside_repo "\$\{api_key_out\}"/);
  assert.match(source, /is inside the repository; choose a path outside it/);
});

test('the HCP scripts pass the token on stdin, never on a command line, and check presence only', () => {
  for (const script of ['scripts/set-workspace-secrets.sh', 'scripts/check-secrets.sh']) {
    const source = readOwned(script);
    assert.match(
      source,
      /printf 'header = "Authorization: Bearer %s"\\n' "\$\{TFE_TOKEN\}" \|/,
      script,
    );
    assert.match(source, /-K -/, script);
    assert.doesNotMatch(source, /-H "Authorization/, script);
    assert.match(source, /\[ -n "\$\{TFE_TOKEN:-\}" \] \|\| fail "TFE_TOKEN is not set"/, script);
  }
  const setter = readOwned('scripts/set-workspace-secrets.sh');
  assert.match(setter, /sensitive: true/);
  assert.match(setter, /--rawfile value/);
  assert.doesNotMatch(setter, /--arg value/);
  const checker = readOwned('scripts/check-secrets.sh');
  assert.match(checker, /alarm_email origin_verify_value api_key_value/);
  assert.match(checker, /for name in app origin-verify apple-pass google-wallet/);
});

test('google-wallet-class.mjs exits 0 on success, 1 on an API failure and 2 on bad usage', () => {
  const source = readOwned('scripts/google-wallet-class.mjs');
  assert.match(source, /process\.exitCode = 0/);
  assert.match(source, /error instanceof UsageError[\s\S]*process\.exitCode = 2/);
  assert.match(source, /error instanceof ApiError[\s\S]*process\.exitCode = 1/);
  assert.match(source, /unexpected failure[\s\S]*process\.exitCode = 1/);
  assert.doesNotMatch(source, /Number\(/);
  assert.equal((source.match(/AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /console\./);
});

test('google-wallet-class.mjs reads before it writes so a second run changes nothing', () => {
  const source = readOwned('scripts/google-wallet-class.mjs');
  assert.match(source, /'GET', `issuer\//);
  assert.match(source, /'GET', `genericClass\//);
  assert.match(source, /found\.status === 404/);
  assert.match(source, /left unchanged/);
});

test('google-wallet-class.mjs parses its arguments strictly and signs an RS256 assertion', async () => {
  const mod = await import(pathToFileURL(`${repoRoot}/scripts/google-wallet-class.mjs`).href);
  const parsed = mod.parseArgs(
    ['--service-account', 'key.json', '--issuer-id', '3388000000012345'],
    {},
  );
  assert.equal(parsed.suffix, 'compass-dev');
  assert.equal(parsed.issuerId, '3388000000012345');
  const fromEnv = mod.parseArgs(['--service-account', 'k', '--issuer-id', '1', '--env', 'prod'], {
    GOOGLE_WALLET_CLASS_SUFFIX: 'custom',
  });
  assert.equal(fromEnv.suffix, 'custom');
  assert.throws(() => mod.parseArgs(['--issuer-id', '1'], {}));
  assert.throws(() => mod.parseArgs(['--service-account', 'k', '--issuer-id', 'abc'], {}));
  assert.throws(() =>
    mod.parseArgs(['--service-account', 'k', '--issuer-id', '1', '--suffix', 'bad suffix'], {}),
  );
  assert.throws(() =>
    mod.parseArgs(['--service-account', 'k', '--issuer-id', '1', '--env', 'qa'], {}),
  );
  assert.throws(() =>
    mod.parseArgs(['--service-account', 'k', '--issuer-id', '1', '--other', 'x'], {}),
  );

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = mod.signJwt({ iss: 'issuer' }, pem);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
    alg: 'RS256',
    typ: 'JWT',
  });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, 'base64url')), true);
});

test('google-wallet-class.mjs puts the pass layout ids in the class template (pass-service task 47)', async () => {
  const mod = await import(pathToFileURL(`${repoRoot}/scripts/google-wallet-class.mjs`).href);
  const layout = await import(
    pathToFileURL(`${repoRoot}/packages/pass-service/src/google/google-layout.ts`).href
  );
  const path = (item) => item.firstValue.fields.map((field) => field.fieldPath);
  const { classTemplateInfo, viewUnlockRequirement } = mod.DESIRED_CLASS_FIELDS;
  assert.equal(viewUnlockRequirement, 'UNLOCK_NOT_REQUIRED');
  const rows = classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos;
  assert.equal(rows.length, 2, 'Google recommends at most two front rows');
  assert.deepEqual(
    rows.map((row) => [path(row.twoItems.startItem), path(row.twoItems.endItem)]),
    layout.GOOGLE_FRONT_ROWS.map((ids) => ids.map((id) => [`object.textModulesData['${id}']`])),
  );
  assert.deepEqual(
    classTemplateInfo.detailsTemplateOverride.detailsItemInfos.map((info) => path(info.item)),
    layout.GOOGLE_DETAIL_MODULES.map((id) => [`object.textModulesData['${id}']`]),
  );
  assert.ok(!layout.GOOGLE_DETAIL_MODULES.includes('name'), 'the attendee name stays off Google');
});

test('google-wallet-class.mjs compares nested class fields, so an unchanged class is left alone', async () => {
  const { DESIRED_CLASS_FIELDS: desired, matchesDesired } = await import(
    pathToFileURL(`${repoRoot}/scripts/google-wallet-class.mjs`).href
  );
  const copy = () => JSON.parse(JSON.stringify(desired));
  // Google answers with the class id and keys of its own; the desired fields still match.
  assert.equal(
    matchesDesired(desired, { ...copy(), id: '1.compass-dev', reviewStatus: 'APPROVED' }),
    true,
  );
  const extraNested = copy();
  extraNested.classTemplateInfo.cardTemplateOverride.kind = 'walletobjects#cardTemplateOverride';
  assert.equal(matchesDesired(desired, extraNested), true);
  // The class of today has no template: the script patches it.
  assert.equal(matchesDesired(desired, { viewUnlockRequirement: 'UNLOCK_NOT_REQUIRED' }), false);
  const swapped = copy();
  swapped.classTemplateInfo.detailsTemplateOverride.detailsItemInfos.reverse();
  assert.equal(matchesDesired(desired, swapped), false, 'a new order is a change');
  const shorter = copy();
  shorter.classTemplateInfo.detailsTemplateOverride.detailsItemInfos.pop();
  assert.equal(matchesDesired(desired, shorter), false, 'a missing detail is a change');
  const changedPath = copy();
  changedPath.classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos[0].twoItems.endItem.firstValue.fields[0].fieldPath =
    "object.textModulesData['room']";
  assert.equal(matchesDesired(desired, changedPath), false);
  const notAList = copy();
  notAList.classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos = {};
  assert.equal(matchesDesired(desired, notAList), false);
  assert.equal(matchesDesired(desired, { ...copy(), classTemplateInfo: null }), false);
  assert.equal(matchesDesired(desired, { ...copy(), classTemplateInfo: [] }), false);
  assert.equal(matchesDesired({ a: 1 }, { a: '1' }), false);
});

test('google-wallet-class.mjs names where the class differs without printing the response (task 47.6)', async () => {
  const { DESIRED_CLASS_FIELDS: desired, firstDifference } = await import(
    pathToFileURL(`${repoRoot}/scripts/google-wallet-class.mjs`).href
  );
  const copy = () => JSON.parse(JSON.stringify(desired));
  assert.equal(firstDifference(desired, { ...copy(), id: '1.compass-dev' }), null);
  assert.deepEqual(firstDifference(desired, { viewUnlockRequirement: 'UNLOCK_NOT_REQUIRED' }), {
    path: 'classTemplateInfo',
    found: 'missing',
  });
  const changedPath = copy();
  changedPath.classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos[1].twoItems.endItem.firstValue.fields[0].fieldPath =
    'object.textModulesData["boardingCloses"]';
  assert.deepEqual(firstDifference(desired, changedPath), {
    path: 'classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos[1].twoItems.endItem.firstValue.fields[0].fieldPath',
    found: '"object.textModulesData[\\"boardingCloses\\"]"',
  });
  const shorter = copy();
  shorter.classTemplateInfo.detailsTemplateOverride.detailsItemInfos.splice(2);
  assert.deepEqual(firstDifference(desired, shorter), {
    path: 'classTemplateInfo.detailsTemplateOverride.detailsItemInfos',
    found: 'a list of 2',
  });
  // The unlock setting is always named, cut to 64 characters; other strings only by kind.
  assert.deepEqual(
    firstDifference(desired, { ...copy(), viewUnlockRequirement: 'unlockNotRequired' }),
    {
      path: 'viewUnlockRequirement',
      found: '"unlockNotRequired"',
    },
  );
  assert.deepEqual(firstDifference(desired, { ...copy(), viewUnlockRequirement: 'x'.repeat(80) }), {
    path: 'viewUnlockRequirement',
    found: JSON.stringify('x'.repeat(64)),
  });
  assert.deepEqual(firstDifference({ other: 'A' }, { other: 'Secret value' }), {
    path: 'other',
    found: 'a string',
  });
  assert.deepEqual(
    firstDifference(desired, { ...copy(), viewUnlockRequirement: 'UNLOCK_REQUIRED_TO_VIEW' }),
    { path: 'viewUnlockRequirement', found: '"UNLOCK_REQUIRED_TO_VIEW"' },
  );
  // Google returns its default for UNLOCK_NOT_REQUIRED; the docs say they are the same.
  assert.equal(
    firstDifference(desired, {
      ...copy(),
      viewUnlockRequirement: 'VIEW_UNLOCK_REQUIREMENT_UNSPECIFIED',
    }),
    null,
  );
  assert.deepEqual(
    firstDifference({ other: 'A' }, { other: 'VIEW_UNLOCK_REQUIREMENT_UNSPECIFIED' }),
    {
      path: 'other',
      found: '"VIEW_UNLOCK_REQUIREMENT_UNSPECIFIED"',
    },
  );
  assert.deepEqual(firstDifference(desired, null), { path: '(the class)', found: 'null' });
  assert.deepEqual(firstDifference({ a: [1] }, { a: { 0: 1 } }), { path: 'a', found: 'an object' });
  const source = readOwned('scripts/google-wallet-class.mjs');
  assert.match(
    source,
    /class: differs at \$\{difference\.path\} \(found \$\{difference\.found\}\)/,
  );
});
