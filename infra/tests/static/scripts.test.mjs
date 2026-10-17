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

const SHELL_SCRIPTS = ['scripts/bootstrap.sh', 'scripts/release.sh', 'scripts/load-secrets.sh'];
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
    for (const name of SECRET_VARIABLES) {
      const shell = new RegExp(`\\$\\{?${name}\\}?(?![A-Za-z0-9_])`);
      const js = new RegExp(`\\$\\{\\s*[A-Za-z_.]*\\b${name}\\b`);
      if (shell.test(line) || js.test(line)) problems.push(`line ${index + 1} uses ${name}`);
    }
  });
  return problems;
}

test('shellcheck is clean on the three shell scripts', () => {
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
  const confirm = source.indexOf('Type yes to apply');
  const apply = source.indexOf('terraform apply -input=false tfplan');
  assert.ok(retainedRefusal > 0 && typeRefusal > retainedRefusal);
  assert.ok(confirm > typeRefusal && apply > confirm);
  assert.match(source, /nothing was applied/);
});

test('release.sh aborts on anything but yes and treats only HTTP 200 as healthy', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(
    source,
    /if \[ "\$\{answer\}" != "yes" \]; then\s+echo "aborted: nothing was applied" >&2\s+exit 1/,
  );
  assert.match(source, /if \[ "\$\{status\}" = "200" \]; then/);
  assert.match(source, /fail "the health check never returned HTTP 200"/);
  assert.match(source, /\/api\/v1\/health/);
});

test('release.sh exits non-zero when the apply, the sync or the invalidation fails', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(source, /terraform apply -input=false tfplan \|\| fail/);
  assert.match(source, /aws s3 sync .* \|\| fail/);
  assert.match(source, /aws cloudfront create-invalidation .* \|\| fail/);
});

test('release.sh keeps the plan JSON in a private temporary directory that is removed', () => {
  const source = readOwned('scripts/release.sh');
  assert.match(source, /work_dir="\$\(mktemp -d\)"/);
  assert.match(source, /chmod 700 "\$\{work_dir\}"/);
  assert.match(source, /trap 'rm -rf "\$\{work_dir\}"' EXIT/);
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
  assert.match(source, /openssl rand -hex 32 >"\$\{pepper_file\}"/);
  assert.match(source, /an output file already exists/);
});

test('load-secrets.sh refuses to replace the app secret without --rotate and needs no AWS for edge values', () => {
  const source = readOwned('scripts/load-secrets.sh');
  assert.match(source, /already holds a value; pass --rotate to replace it/);
  assert.match(source, /if \[ "\$\{kind\}" != "edge-values" \]; then\s+required_tools\+=\(aws\)/);
});

test('google-wallet-class.mjs exits 0 on success, 1 on an API failure and 2 on bad usage', () => {
  const source = readOwned('scripts/google-wallet-class.mjs');
  assert.match(source, /process\.exitCode = 0/);
  assert.match(source, /error instanceof UsageError[\s\S]*process\.exitCode = 2/);
  assert.match(source, /error instanceof ApiError[\s\S]*process\.exitCode = 1/);
  assert.match(source, /unexpected failure[\s\S]*process\.exitCode = 1/);
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
