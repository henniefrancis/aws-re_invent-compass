// A tiny router keyed by `${method} ${resource}`. A Map is used so that a hostile key such
// as "constructor" can never reach an object prototype.
import type { ProxyEvent, ProxyResult } from './event.js';
import type { Metrics } from '../observability/metrics.js';

export type RouteKey = `${'GET' | 'POST' | 'PUT' | 'DELETE'} ${string}`;

export interface RequestContext {
  event: ProxyEvent;
  /** Epoch milliseconds, read once from the injected clock at the start of the request. */
  now: number;
  metrics: Metrics;
}

export type Handler<D> = (req: RequestContext, deps: D) => Promise<ProxyResult>;

export function createRouter<D>(
  routes: Partial<Record<RouteKey, Handler<D>>>,
): (key: string) => Handler<D> | undefined {
  const table = new Map<string, Handler<D>>();
  for (const [key, handler] of Object.entries(routes)) {
    if (handler !== undefined) {
      table.set(key, handler);
    }
  }
  return (key) => table.get(key);
}
