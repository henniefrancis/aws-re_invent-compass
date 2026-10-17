// The six metrics S6 alarms on. Counts only, no identifying dimensions.
export const METRIC_NAMES = [
  'ApnsFailure',
  'ApnsInvalidToken',
  'ApnsSkipped',
  'GoogleWalletFailure',
  'GoogleSaveJwtOversize',
  'PasskitLogMessages',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export interface Metrics {
  add(name: MetricName, count: number): void;
}

export interface MetricsCollector extends Metrics {
  /** Only the metrics that received a positive count. */
  snapshot(): Partial<Record<MetricName, number>>;
}

export function createMetrics(): MetricsCollector {
  const counts = new Map<MetricName, number>();
  return {
    add(name, count) {
      counts.set(name, (counts.get(name) ?? 0) + count);
    },
    snapshot() {
      const out: Partial<Record<MetricName, number>> = {};
      for (const name of METRIC_NAMES) {
        const count = counts.get(name);
        if (count !== undefined && count > 0) {
          out[name] = count;
        }
      }
      return out;
    },
  };
}
