// The request pipeline shared by both Lambdas (design, Request pipeline):
//   1. start the timer and install the console guard;
//   2. Origin_Guard, before anything else (403);
//   3. router lookup (404 for an unknown route);
//   4. the handler;
//   5. map every thrown value to a Problem_Response, never rethrow;
//   6. write exactly one log line.
import type { ProxyEvent, ProxyResult } from '../http/event.js';
import { DependencyError, ProblemError, problem } from '../http/problem.js';
import { withHardening } from '../http/responses.js';
import type { Handler } from '../http/router.js';
import { withConsoleGuard } from '../observability/console-guard.js';
import { createMetrics, type MetricsCollector } from '../observability/metrics.js';
import {
  writeRequestLog,
  type FunctionName,
  type Outcome,
} from '../observability/request-logger.js';
import { checkOrigin } from '../security/origin-guard.js';
import type { BaseDeps } from './deps.js';

/** getHealth is the one route that does not carry the hardening headers. */
export const HEALTH_ROUTE = 'GET /api/v1/health';

const SUCCESS_OUTCOMES: Record<number, Outcome> = {
  200: 'ok',
  201: 'created',
  202: 'accepted',
  204: 'no_content',
  304: 'not_modified',
};

export interface PipelineOptions<D extends BaseDeps> {
  functionName: FunctionName;
  lookup: (key: string) => Handler<D> | undefined;
  deps: D;
}

interface Finished {
  result: ProxyResult;
  outcome: Outcome;
}

function failure(error: unknown): Finished {
  if (error instanceof ProblemError) {
    return {
      result: problem(error.status, error.code, error.headers),
      outcome: error.code,
    };
  }
  return {
    result: problem(500, 'internal_error'),
    outcome: error instanceof DependencyError ? 'dependency_error' : 'internal_error',
  };
}

export function createPipeline<D extends BaseDeps>(
  options: PipelineOptions<D>,
): (event: ProxyEvent) => Promise<ProxyResult> {
  const { functionName, lookup, deps } = options;

  async function run(
    event: ProxyEvent,
    handler: Handler<D> | undefined,
    now: number,
    metrics: MetricsCollector,
  ): Promise<Finished> {
    try {
      const origin = await deps.secrets.origin();
      if (!checkOrigin(event, origin)) {
        throw new ProblemError(403, 'forbidden');
      }
      if (handler === undefined) {
        throw new ProblemError(404, 'not_found');
      }
      const result = await handler({ event, now, metrics }, deps);
      return { result, outcome: SUCCESS_OUTCOMES[result.statusCode] ?? 'internal_error' };
    } catch (error) {
      return failure(error);
    }
  }

  return async (event) => {
    const startedAt = deps.clock.now();
    const metrics = createMetrics();
    const key = `${event.httpMethod} ${event.resource}`;
    const handler = lookup(key);
    const { result, outcome } = await withConsoleGuard(deps.console, () =>
      run(event, handler, startedAt, metrics),
    );
    const route = handler === undefined ? 'UNMATCHED' : key;
    const finishedAt = deps.clock.now();
    writeRequestLog(deps.logSink, {
      requestId: event.requestContext?.requestId ?? '',
      route,
      status: result.statusCode,
      latencyMs: Math.max(0, finishedAt - startedAt),
      outcome,
      functionName,
      timestampMs: finishedAt,
      metrics: metrics.snapshot(),
    });
    return route === HEALTH_ROUTE ? result : withHardening(result);
  };
}
