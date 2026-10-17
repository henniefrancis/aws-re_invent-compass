import { describe, expect, test } from 'vitest';
import { withConsoleGuard, type ConsoleLike } from '../../src/observability/console-guard.js';
import { METRIC_NAMES, createMetrics } from '../../src/observability/metrics.js';
import {
  safeRequestId,
  writeRequestLog,
  type RequestLogInput,
} from '../../src/observability/request-logger.js';

const ALLOWED = new Set([
  'requestId',
  'route',
  'status',
  'latencyMs',
  'outcome',
  'Function',
  'Latency',
  '_aws',
  ...METRIC_NAMES,
]);

function input(overrides: Partial<RequestLogInput> = {}): RequestLogInput {
  return {
    requestId: 'c6af9ac6-7b61-11e6-9a41-93e8deadbeef',
    route: 'GET /api/v1/health',
    status: 200,
    latencyMs: 12,
    outcome: 'ok',
    functionName: 'api',
    timestampMs: 1_700_000_000_000,
    metrics: {},
    ...overrides,
  };
}

function makeConsole(): { target: ConsoleLike; calls: string[] } {
  const calls: string[] = [];
  const target: ConsoleLike = {
    log: () => calls.push('log'),
    info: () => calls.push('info'),
    warn: () => calls.push('warn'),
    error: () => calls.push('error'),
    debug: () => calls.push('debug'),
  };
  return { target, calls };
}

describe('Feature: pass-service, request logger and metrics', () => {
  test('a log line has exactly the allowlisted keys and the EMF block', () => {
    const lines: string[] = [];
    writeRequestLog((l) => lines.push(l), input({ metrics: { ApnsFailure: 2 } }));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(String(lines[0])) as Record<string, unknown>;
    expect(Object.keys(parsed).every((k) => ALLOWED.has(k))).toBe(true);
    expect(parsed.ApnsFailure).toBe(2);
    expect(parsed.Function).toBe('api');
    expect(parsed.Latency).toBe(12);
    expect(parsed._aws).toEqual({
      Timestamp: 1_700_000_000_000,
      CloudWatchMetrics: [
        {
          Namespace: 'Compass',
          Dimensions: [['Function']],
          Metrics: [
            { Name: 'Latency', Unit: 'Milliseconds' },
            { Name: 'ApnsFailure', Unit: 'Count' },
          ],
        },
      ],
    });
  });

  test('a request id that does not look like one is replaced', () => {
    expect(safeRequestId('abc-123')).toBe('abc-123');
    expect(safeRequestId('has space')).toBe('unknown');
    expect(safeRequestId('')).toBe('unknown');
    expect(safeRequestId('x'.repeat(65))).toBe('unknown');
  });

  test('metrics add up and the snapshot holds only positive counts', () => {
    const metrics = createMetrics();
    expect(metrics.snapshot()).toEqual({});
    metrics.add('ApnsFailure', 1);
    metrics.add('ApnsFailure', 2);
    metrics.add('ApnsSkipped', 0);
    metrics.add('PasskitLogMessages', 5);
    expect(metrics.snapshot()).toEqual({ ApnsFailure: 3, PasskitLogMessages: 5 });
    expect(METRIC_NAMES).toHaveLength(6);
  });

  test('the console guard silences console and restores it after success', async () => {
    const { target, calls } = makeConsole();
    const original = { ...target };
    const result = await withConsoleGuard(target, () => {
      target.log('x');
      target.error('y');
      target.warn('z');
      target.info('i');
      target.debug('d');
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(calls).toEqual([]);
    expect(target.log).toBe(original.log);
    target.log('after');
    expect(calls).toEqual(['log']);
  });

  test('the console guard restores console after a throw', async () => {
    const { target } = makeConsole();
    const original = { ...target };
    await expect(withConsoleGuard(target, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(target.error).toBe(original.error);
  });

  test('overlapping guards restore console only when the last one finishes', async () => {
    const { target } = makeConsole();
    const original = { ...target };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withConsoleGuard(target, () => gate);
    await withConsoleGuard(target, () => Promise.resolve());
    expect(target.log).not.toBe(original.log);
    release();
    await first;
    expect(target.log).toBe(original.log);
  });
});
