import type { Metrics } from '../observability/metrics.js';

/** What a service operation needs from the request: the instant and the metric counters. */
export interface OpContext {
  now: number;
  metrics: Metrics;
}
