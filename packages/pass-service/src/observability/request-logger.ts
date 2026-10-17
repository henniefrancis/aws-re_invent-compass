// One JSON line per request, built from an allowlist. It carries the request id, the
// route template, the status, the latency, the outcome and CloudWatch embedded metric
// format values, and nothing else (ADR-012).
// Spec: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
import type { MetricName } from './metrics.js';

export type Outcome =
  | 'ok'
  | 'created'
  | 'accepted'
  | 'not_modified'
  | 'no_content'
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'not_enabled'
  | 'rate_limited'
  | 'active_pass_limit'
  | 'internal_error'
  | 'dependency_error';

export type FunctionName = 'api' | 'passkit';

/** Receives one finished JSON line (without a newline). */
export type LogSink = (line: string) => void;

export interface RequestLogInput {
  requestId: string;
  route: string;
  status: number;
  latencyMs: number;
  outcome: Outcome;
  functionName: FunctionName;
  timestampMs: number;
  metrics: Partial<Record<MetricName, number>>;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** A request id is API Gateway's own; anything that does not look like one is dropped. */
export function safeRequestId(value: string): string {
  return REQUEST_ID_PATTERN.test(value) ? value : 'unknown';
}

export function writeRequestLog(sink: LogSink, input: RequestLogInput): void {
  const metricNames = Object.keys(input.metrics) as MetricName[];
  const line = {
    requestId: safeRequestId(input.requestId),
    route: input.route,
    status: input.status,
    latencyMs: input.latencyMs,
    outcome: input.outcome,
    Function: input.functionName,
    Latency: input.latencyMs,
    ...input.metrics,
    _aws: {
      Timestamp: input.timestampMs,
      CloudWatchMetrics: [
        {
          Namespace: 'Compass',
          Dimensions: [['Function']],
          Metrics: [
            { Name: 'Latency', Unit: 'Milliseconds' },
            ...metricNames.map((name) => ({ Name: name, Unit: 'Count' })),
          ],
        },
      ],
    },
  };
  sink(JSON.stringify(line));
}
