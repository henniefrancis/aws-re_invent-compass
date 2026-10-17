// The Api_Lambda app: ten operations (getHealth, issuePasses, getApplePass, updatePass,
// voidPass, createHandoff, getHandoff, getHandoffAppleBundle, getHandoffCalendar,
// forgetMe). Handlers are registered here as their tasks land.
import type { ProxyEvent, ProxyResult } from '../http/event.js';
import { createRouter, type Handler, type RouteKey } from '../http/router.js';
import type { ApiDeps } from './deps.js';
import { createPipeline } from './pipeline.js';

const routes: Partial<Record<RouteKey, Handler<ApiDeps>>> = {};

export function createApiApp(deps: ApiDeps): (event: ProxyEvent) => Promise<ProxyResult> {
  return createPipeline({ functionName: 'api', lookup: createRouter(routes), deps });
}
