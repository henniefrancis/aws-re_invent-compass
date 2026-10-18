// Success response builders. Binary bodies are base64 with isBase64Encoded true.
import type { ProxyResult } from './event.js';

export function json(status: 200 | 201 | 202, body: unknown): ProxyResult {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

export function binary(
  status: 200,
  contentType: string,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): ProxyResult {
  return {
    statusCode: status,
    headers: { ...headers, 'content-type': contentType },
    body: Buffer.from(bytes).toString('base64'),
    isBase64Encoded: true,
  };
}

export function empty(
  status: 200 | 201 | 204 | 304,
  headers: Record<string, string> = {},
): ProxyResult {
  return { statusCode: status, headers: { ...headers }, body: '', isBase64Encoded: false };
}

/** The headers every response except getHealth carries (security review M4). No CORS header, ever. */
export const HARDENING_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function withHardening(result: ProxyResult): ProxyResult {
  return { ...result, headers: { ...result.headers, ...HARDENING_HEADERS } };
}
