#!/usr/bin/env node
// Create or update the Google Wallet issuer and the Generic class that Compass
// passes use. OWNER-RUN ONLY. It is not part of Terraform (the Google objects
// are not AWS infrastructure).
//
// usage:
//   node scripts/google-wallet-class.mjs --service-account FILE --issuer-id ID \
//     [--suffix SUFFIX] [--env dev|prod] [--issuer-name NAME]
//
// The class id is <issuer id>.<suffix>. The suffix must equal the
// GOOGLE_WALLET_CLASS_SUFFIX the api Lambda receives (Terraform input
// google_wallet_class_suffix, default compass-<env>). When --suffix is absent the
// script uses GOOGLE_WALLET_CLASS_SUFFIX, then compass-<env>.
//
// Idempotent: a second run leaves the same state. An existing issuer or class is
// read first and only created or patched when it is missing or differs.
//
// It never prints the service account key, a token or a response body. Errors
// name the step and the HTTP status only.
//
// Exit status: 0 on success, 1 on any Google Wallet API failure, 2 on bad usage.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const DEFAULT_ISSUER_NAME = 'Compass';
const REQUEST_TIMEOUT_MS = 30_000;

// Fields the class must carry besides its id. Kept minimal on purpose: the pass
// content lives in the objects the api Lambda creates, not in the class.
const DESIRED_CLASS_FIELDS = Object.freeze({
  viewUnlockRequirement: 'UNLOCK_NOT_REQUIRED',
});

class UsageError extends Error {}
class ApiError extends Error {}

function usage() {
  process.stderr.write(
    'usage: node scripts/google-wallet-class.mjs --service-account FILE --issuer-id ID ' +
      '[--suffix SUFFIX] [--env dev|prod] [--issuer-name NAME]\n',
  );
}

export function parseArgs(argv, env = process.env) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new UsageError('bad arguments');
    }
    values[flag.slice(2)] = value;
  }
  const allowed = new Set(['service-account', 'issuer-id', 'suffix', 'env', 'issuer-name']);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) throw new UsageError('bad arguments');
  }
  if (!values['service-account'] || !values['issuer-id']) throw new UsageError('missing arguments');
  if (!/^[0-9]{1,30}$/.test(values['issuer-id']))
    throw new UsageError('the issuer id must be numeric');
  const envName = values.env ?? 'dev';
  if (envName !== 'dev' && envName !== 'prod') throw new UsageError('env must be dev or prod');
  const suffix = values.suffix ?? env.GOOGLE_WALLET_CLASS_SUFFIX ?? `compass-${envName}`;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(suffix))
    throw new UsageError('the suffix has invalid characters');
  return {
    serviceAccountPath: values['service-account'],
    issuerId: values['issuer-id'],
    suffix,
    issuerName: values['issuer-name'] ?? DEFAULT_ISSUER_NAME,
  };
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signJwt(claims, privateKeyPem) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKeyPem).toString('base64url')}`;
}

async function getAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { iss: account.client_email, scope: WALLET_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3000 },
    account.private_key,
  );
  const response = await fetch(TOKEN_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new ApiError(`token request failed with HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body.access_token !== 'string')
    throw new ApiError('token response had no access token');
  return body.access_token;
}

async function call(token, method, path, body) {
  const response = await fetch(`${WALLET_API}/${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}

async function readJson(response, step) {
  try {
    return await response.json();
  } catch {
    throw new ApiError(`${step} returned an unreadable response`);
  }
}

async function ensureIssuer(token, issuerId, issuerName) {
  const found = await call(token, 'GET', `issuer/${issuerId}`);
  if (found.ok) {
    process.stdout.write('issuer: exists, left unchanged\n');
    return;
  }
  if (found.status !== 404)
    throw new ApiError(`reading the issuer failed with HTTP ${found.status}`);
  const created = await call(token, 'POST', 'issuer', {
    issuerId,
    name: issuerName,
  });
  if (!created.ok) throw new ApiError(`creating the issuer failed with HTTP ${created.status}`);
  process.stdout.write('issuer: created\n');
}

async function ensureClass(token, classId) {
  const desired = { id: classId, ...DESIRED_CLASS_FIELDS };
  const found = await call(token, 'GET', `genericClass/${encodeURIComponent(classId)}`);
  if (found.status === 404) {
    const created = await call(token, 'POST', 'genericClass', desired);
    if (!created.ok) throw new ApiError(`creating the class failed with HTTP ${created.status}`);
    process.stdout.write('class: created\n');
    return;
  }
  if (!found.ok) throw new ApiError(`reading the class failed with HTTP ${found.status}`);
  const current = await readJson(found, 'reading the class');
  const differs = Object.entries(DESIRED_CLASS_FIELDS).some(
    ([key, value]) => current[key] !== value,
  );
  if (!differs) {
    process.stdout.write('class: exists, left unchanged\n');
    return;
  }
  const patched = await call(
    token,
    'PATCH',
    `genericClass/${encodeURIComponent(classId)}`,
    DESIRED_CLASS_FIELDS,
  );
  if (!patched.ok) throw new ApiError(`updating the class failed with HTTP ${patched.status}`);
  process.stdout.write('class: updated\n');
}

function loadServiceAccount(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`cannot read file: ${path}`);
  }
  let account;
  try {
    account = JSON.parse(raw);
  } catch {
    throw new UsageError(`not valid JSON: ${path}`);
  }
  if (typeof account.client_email !== 'string' || typeof account.private_key !== 'string') {
    throw new UsageError(`not a service account key: ${path}`);
  }
  return account;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const account = loadServiceAccount(options.serviceAccountPath);
  const token = await getAccessToken(account);
  await ensureIssuer(token, options.issuerId, options.issuerName);
  await ensureClass(token, `${options.issuerId}.${options.suffix}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().then(
    () => {
      process.exitCode = 0;
    },
    (error) => {
      if (error instanceof UsageError) {
        process.stderr.write(`error: ${error.message}\n`);
        usage();
        process.exitCode = 2;
      } else if (error instanceof ApiError) {
        process.stderr.write(`error: ${error.message}\n`);
        process.exitCode = 1;
      } else {
        process.stderr.write('error: unexpected failure\n');
        process.exitCode = 1;
      }
    },
  );
}
