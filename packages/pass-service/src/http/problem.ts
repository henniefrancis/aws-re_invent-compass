// Problem responses (RFC 9457 about:blank form). `problem()` has no parameter that can
// carry request input: the title comes from a fixed table and the code from a fixed set.
import type { ProxyResult } from './event.js';

export type ProblemCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'not_enabled'
  | 'rate_limited'
  | 'active_pass_limit'
  | 'internal_error';

export type ProblemStatus = 400 | 401 | 403 | 404 | 429 | 500;

const REASON_PHRASES: Record<ProblemStatus, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/** Thrown by handlers; the pipeline turns it into a Problem_Response. */
export class ProblemError extends Error {
  readonly status: ProblemStatus;
  readonly code: ProblemCode;
  readonly headers: Record<string, string>;

  constructor(status: ProblemStatus, code: ProblemCode, headers: Record<string, string> = {}) {
    super(code);
    this.name = 'ProblemError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export type DependencyKind = 'secret' | 'dynamodb' | 'signing';

/** A failed dependency (secret, table, signer). Carries a kind and never a value. */
export class DependencyError extends Error {
  readonly kind: DependencyKind;

  constructor(kind: DependencyKind) {
    super(`dependency failure: ${kind}`);
    this.name = 'DependencyError';
    this.kind = kind;
  }
}

export function problem(
  status: ProblemStatus,
  code: ProblemCode,
  extraHeaders: Record<string, string> = {},
): ProxyResult {
  return {
    statusCode: status,
    headers: { ...extraHeaders, 'content-type': 'application/problem+json' },
    body: JSON.stringify({ type: 'about:blank', title: REASON_PHRASES[status], status, code }),
    isBase64Encoded: false,
  };
}
