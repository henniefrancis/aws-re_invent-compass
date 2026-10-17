// Shared test harness for the twelve operation functions (events-client, S1).
//
// Builds a ClientContext around a scripted transport so the operation path (quota,
// retry, validation, error mapping) can be exercised without a live network. The
// transport returns a queue of scripted RawResponses in order, records every request
// it was sent, and counts forceRefresh and sleep calls so retry behaviour is
// observable. This file holds no tests; it is imported by the operation test files.

import { createRedactingLogger } from '../../src/api/redacting-logger.js';
import { createQuotaTracker } from '../../src/api/quota-tracker.js';
import type {
  ClientContext,
  ClientRequest,
  RawResponse,
  ResponseHeaders,
  Transport,
} from '../../src/api/transport.js';

/** A minimal ResponseHeaders over a plain record (case-insensitive get). */
export function headers(map: Record<string, string> = {}): ResponseHeaders {
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(map)) {
    lower.set(k.toLowerCase(), v);
  }
  return {
    get: (name: string) => lower.get(name.toLowerCase()) ?? null,
  };
}

/** A scripted response, with optional headers. */
export function response(
  status: number,
  body: unknown,
  hdrs: Record<string, string> = {},
): RawResponse {
  return { status, body, headers: headers(hdrs) };
}

/** The observable state a harness exposes to assertions. */
export interface Harness {
  ctx: ClientContext;
  /** Every request the transport was asked to send, in order. */
  sent: ClientRequest[];
  /** The number of forceRefresh calls the credential received. */
  refreshes: () => number;
  /** The number of sleep calls (429 waits), with their millisecond arguments. */
  sleeps: () => number[];
}

/** Options for building a harness. */
export interface HarnessOptions {
  /** The scripted responses, returned in order per send. */
  responses: RawResponse[];
  /** Make forceRefresh reject, to exercise the failed-refresh path. */
  refreshFails?: boolean;
}

/**
 * Build a ClientContext whose transport replays the scripted responses in order.
 * now() is fixed and sleep() resolves immediately while recording its argument.
 */
export function createHarness(options: HarnessOptions): Harness {
  const sent: ClientRequest[] = [];
  const queue = [...options.responses];
  let refreshCount = 0;
  const sleepArgs: number[] = [];

  const transport: Transport = {
    send: (req: ClientRequest) => {
      sent.push(req);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(`no scripted response for ${req.operation}`);
      }
      return Promise.resolve(next);
    },
  };

  const ctx: ClientContext = {
    transport,
    accessToken: {
      getAccessTokenForEventsApi: () => Promise.resolve('access-token'),
      forceRefresh: () => {
        refreshCount += 1;
        return options.refreshFails === true
          ? Promise.reject(new Error('refresh failed'))
          : Promise.resolve();
      },
    },
    quota: createQuotaTracker(),
    logger: createRedactingLogger({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
    now: () => 1_000_000,
    sleep: (ms: number) => {
      sleepArgs.push(ms);
      return Promise.resolve();
    },
  };

  return {
    ctx,
    sent,
    refreshes: () => refreshCount,
    sleeps: () => sleepArgs,
  };
}
