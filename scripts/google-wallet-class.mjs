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
// Node 24 loads the TypeScript layout with type stripping; it has no imports of its own.
import { STATIC_BACK } from '../packages/pass-service/src/apple/pass-texts.ts';
import {
  GOOGLE_CLASS_MODULES,
  GOOGLE_DETAIL_MODULES,
  GOOGLE_FRONT_ROWS,
} from '../packages/pass-service/src/google/google-layout.ts';

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const DEFAULT_ISSUER_NAME = 'Compass';
const REQUEST_TIMEOUT_MS = 30_000;

// One template item showing a text module, with its header as the label. The fixed texts
// are on the class, the rest on each object (task 47.7).
function textModuleItem(id) {
  const owner = GOOGLE_CLASS_MODULES.includes(id) ? 'class' : 'object';
  return { firstValue: { fields: [{ fieldPath: `${owner}.textModulesData['${id}']` }] } };
}

// Fields the class must carry besides its id. The per-pass content lives in the objects
// the api Lambda creates; the class carries the fixed texts and says where the text
// modules go (pass-service tasks 47 and 47.7): two front rows of two items, then the
// details in order.
// https://developers.google.com/wallet/generic/resources/template
export const DESIRED_CLASS_FIELDS = Object.freeze({
  viewUnlockRequirement: 'UNLOCK_NOT_REQUIRED',
  // The texts that are the same on every pass, the Apple back's words. Google takes at
  // most 10 text modules from the class and 10 from each object.
  textModulesData: GOOGLE_CLASS_MODULES.map((id) => ({
    id,
    header: STATIC_BACK[id].label,
    body: STATIC_BACK[id].value,
  })),
  classTemplateInfo: {
    cardTemplateOverride: {
      cardRowTemplateInfos: GOOGLE_FRONT_ROWS.map(([start, end]) => ({
        twoItems: { startItem: textModuleItem(start), endItem: textModuleItem(end) },
      })),
    },
    detailsTemplateOverride: {
      detailsItemInfos: GOOGLE_DETAIL_MODULES.map((id) => ({ item: textModuleItem(id) })),
    },
  },
});

// What Google returned at a differing place, without its content: only the kind of
// value, except a template field path, the unlock setting or an enum constant (such
// as UNLOCK_NOT_REQUIRED), which are layout and setting names, never a secret. A
// shown value is cut to 64 characters.
function describe(value, path) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (
    typeof value === 'string' &&
    (path.endsWith('.fieldPath') ||
      path === 'viewUnlockRequirement' ||
      /^[A-Z][A-Z_]{0,63}$/.test(value))
  )
    return JSON.stringify(value.slice(0, 64));
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

// Values Google treats as the same setting (task 47.6, owner's dev runs of 24 October).
// Google answers an enum in lowerCamelCase ("unlockNotRequired" for the
// UNLOCK_NOT_REQUIRED we send), so enum values compare without case or underscores, and
// its default VIEW_UNLOCK_REQUIREMENT_UNSPECIFIED is documented as "same as
// UNLOCK_NOT_REQUIRED".
// https://developers.google.com/wallet/reference/rest/v1/ViewUnlockRequirement
const SAME_SETTING = Object.freeze({
  viewUnlockRequirement: ['unlocknotrequired', 'viewunlockrequirementunspecified'],
});

function enumKey(value) {
  return typeof value === 'string' ? value.replaceAll('_', '').toLowerCase() : value;
}

function sameValue(desired, current, path) {
  const same = SAME_SETTING[path];
  if (desired === current) return true;
  if (same === undefined) return false;
  return same.includes(enumKey(desired)) && same.includes(enumKey(current));
}

// The first place where the class Google returns does not carry the desired value,
// as {path, found}, or null when it does. Objects match when every key the desired
// value names matches (Google may add keys of its own); lists match item by item, in
// order and with the same length (pass-service tasks 47.3 and 47.6).
export function firstDifference(desired, current, path = '') {
  const differs = { path: path === '' ? '(the class)' : path, found: describe(current, path) };
  if (Array.isArray(desired)) {
    if (!Array.isArray(current) || current.length !== desired.length) return differs;
    for (const [index, value] of desired.entries()) {
      const inner = firstDifference(value, current[index], `${path}[${index}]`);
      if (inner !== null) return inner;
    }
    return null;
  }
  if (desired !== null && typeof desired === 'object') {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return differs;
    for (const [key, value] of Object.entries(desired)) {
      const inner = firstDifference(value, current[key], path === '' ? key : `${path}.${key}`);
      if (inner !== null) return inner;
    }
    return null;
  }
  return sameValue(desired, current, path) ? null : differs;
}

// True when the class Google returns already carries the desired value.
export function matchesDesired(desired, current) {
  return firstDifference(desired, current) === null;
}

class UsageError extends Error {}
class ApiError extends Error {}

function usage(deps) {
  deps.stderr(
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

async function getAccessToken(deps, account) {
  const now = Math.floor(deps.now() / 1000);
  const assertion = signJwt(
    { iss: account.client_email, scope: WALLET_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3000 },
    account.private_key,
  );
  const response = await deps.fetch(TOKEN_URL, {
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

async function call(deps, token, method, path, body) {
  const response = await deps.fetch(`${WALLET_API}/${path}`, {
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

async function ensureIssuer(deps, token, issuerId, issuerName) {
  const found = await call(deps, token, 'GET', `issuer/${issuerId}`);
  if (found.ok) {
    deps.stdout('issuer: exists, left unchanged\n');
    return;
  }
  if (found.status !== 404)
    throw new ApiError(`reading the issuer failed with HTTP ${found.status}`);
  const created = await call(deps, token, 'POST', 'issuer', {
    issuerId,
    name: issuerName,
  });
  if (!created.ok) throw new ApiError(`creating the issuer failed with HTTP ${created.status}`);
  deps.stdout('issuer: created\n');
}

async function ensureClass(deps, token, classId) {
  const desired = { id: classId, ...DESIRED_CLASS_FIELDS };
  const found = await call(deps, token, 'GET', `genericClass/${encodeURIComponent(classId)}`);
  if (found.status === 404) {
    const created = await call(deps, token, 'POST', 'genericClass', desired);
    if (!created.ok) throw new ApiError(`creating the class failed with HTTP ${created.status}`);
    deps.stdout('class: created\n');
    return;
  }
  if (!found.ok) throw new ApiError(`reading the class failed with HTTP ${found.status}`);
  const current = await readJson(found, 'reading the class');
  const difference = firstDifference(DESIRED_CLASS_FIELDS, current);
  if (difference === null) {
    deps.stdout('class: exists, left unchanged\n');
    return;
  }
  // Names where the class differed, so a class that never settles can be diagnosed
  // without printing the response (task 47.6).
  deps.stdout(`class: differs at ${difference.path} (found ${difference.found})\n`);
  const patched = await call(
    deps,
    token,
    'PATCH',
    `genericClass/${encodeURIComponent(classId)}`,
    DESIRED_CLASS_FIELDS,
  );
  if (!patched.ok) throw new ApiError(`updating the class failed with HTTP ${patched.status}`);
  deps.stdout('class: updated\n');
}

function loadServiceAccount(deps, path) {
  let raw;
  try {
    raw = deps.readFile(path, 'utf8');
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

// The real network, file, clock and output calls, built when the script runs; the unit
// tests pass fakes in their place so no test reaches Google or reads a key file.
export function defaultDeps() {
  return {
    fetch: (url, init) => fetch(url, init),
    readFile: readFileSync,
    now: () => Date.now(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
  };
}

// Runs the script and returns its exit status: 0 on success, 1 on a Google Wallet API
// failure or an unexpected one, 2 on bad usage.
export async function runCli(argv, deps) {
  try {
    const options = parseArgs(argv, deps.env);
    const account = loadServiceAccount(deps, options.serviceAccountPath);
    const token = await getAccessToken(deps, account);
    await ensureIssuer(deps, token, options.issuerId, options.issuerName);
    await ensureClass(deps, token, `${options.issuerId}.${options.suffix}`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      deps.stderr(`error: ${error.message}\n`);
      usage(deps);
      return 2;
    }
    if (error instanceof ApiError) {
      deps.stderr(`error: ${error.message}\n`);
      return 1;
    }
    deps.stderr('error: unexpected failure\n');
    return 1;
  }
}

export async function main() {
  process.exitCode = await runCli(process.argv.slice(2), defaultDeps());
}

// Calls run only when this file is the script node was started with.
export function runIfDirect(entryPath, moduleUrl, run) {
  if (entryPath !== undefined && pathToFileURL(entryPath).href === moduleUrl) return run();
  return undefined;
}

runIfDirect(process.argv[1], import.meta.url, main);
