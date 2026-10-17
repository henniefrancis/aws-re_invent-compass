// The Passkit_Lambda app: Apple's PassKit web service (registerDevice, unregisterDevice,
// getSerialNumbers, getLatestPass, logMessages). Handlers are registered here as their
// tasks land.
import type { ProxyEvent, ProxyResult } from '../http/event.js';
import { createRouter, type Handler, type RouteKey } from '../http/router.js';
import type { PasskitDeps } from './deps.js';
import { createPipeline } from './pipeline.js';

const routes: Partial<Record<RouteKey, Handler<PasskitDeps>>> = {};

export function createPasskitApp(deps: PasskitDeps): (event: ProxyEvent) => Promise<ProxyResult> {
  return createPipeline({ functionName: 'passkit', lookup: createRouter(routes), deps });
}
