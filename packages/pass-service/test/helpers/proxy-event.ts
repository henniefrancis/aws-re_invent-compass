import type { ProxyEvent } from '../../src/http/event.js';

export interface EventOptions {
  method: string;
  resource: string;
  /** The x-origin-verify value to send. Omit to send none. */
  origin?: string;
  headers?: Record<string, string>;
  pathParameters?: Record<string, string>;
  query?: Record<string, string>;
  /** A string is sent as is; anything else is sent as JSON. */
  body?: unknown;
  isBase64Encoded?: boolean;
  requestId?: string;
}

export function buildEvent(options: EventOptions): ProxyEvent {
  const headers: Record<string, string> = { ...options.headers };
  if (options.origin !== undefined) {
    headers['x-origin-verify'] = options.origin;
  }
  let body: string | null = null;
  if (options.body !== undefined) {
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  return {
    resource: options.resource,
    httpMethod: options.method,
    headers,
    pathParameters: options.pathParameters ?? null,
    queryStringParameters: options.query ?? null,
    body,
    isBase64Encoded: options.isBase64Encoded ?? false,
    requestContext: { requestId: options.requestId ?? 'req-test-0001' },
  };
}
