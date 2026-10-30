// The Api_Lambda app: twelve operations (getHealth, issuePasses, getApplePass, updatePass,
// voidPass, createHandoff, getHandoff, getHandoffAppleBundle, getHandoffApplePass,
// getHandoffCalendar, getHandoffSessionCalendar, forgetMe).
import { createHandoff } from '../handlers/api/create-handoff.js';
import { forgetMe } from '../handlers/api/forget-me.js';
import { getApplePass } from '../handlers/api/get-apple-pass.js';
import { getHandoff } from '../handlers/api/get-handoff.js';
import { getHandoffAppleBundle } from '../handlers/api/get-handoff-apple-bundle.js';
import { getHandoffApplePass } from '../handlers/api/get-handoff-apple-pass.js';
import { getHandoffCalendar } from '../handlers/api/get-handoff-calendar.js';
import { getHandoffSessionCalendar } from '../handlers/api/get-handoff-session-calendar.js';
import { getHealth } from '../handlers/api/health.js';
import { issuePasses } from '../handlers/api/issue-passes.js';
import { updatePass } from '../handlers/api/update-pass.js';
import { voidPass } from '../handlers/api/void-pass.js';
import type { ProxyEvent, ProxyResult } from '../http/event.js';
import { createRouter, type Handler } from '../http/router.js';
import { createHandoffService } from '../services/handoff-service.js';
import { createPassLifecycle } from '../services/pass-lifecycle.js';
import type { ApiContext } from './context.js';
import type { ApiRouteKey } from './contract-routes.js';
import type { ApiDeps } from './deps.js';
import { createPipeline } from './pipeline.js';

const routes = {
  'GET /api/v1/health': getHealth,
  'POST /api/v1/passes': issuePasses,
  'GET /api/v1/passes/{serialNumber}/apple': getApplePass,
  'PUT /api/v1/passes/{serialNumber}': updatePass,
  'POST /api/v1/passes/{serialNumber}/void': voidPass,
  'POST /api/v1/handoffs': createHandoff,
  'GET /api/v1/handoffs/{handoffId}': getHandoff,
  'GET /api/v1/handoffs/{handoffId}/apple/{bundleIndex}': getHandoffAppleBundle,
  'GET /api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}': getHandoffApplePass,
  'GET /api/v1/handoffs/{handoffId}/calendar.ics': getHandoffCalendar,
  'GET /api/v1/handoffs/{handoffId}/calendar/{serialNumber}': getHandoffSessionCalendar,
  'DELETE /api/v1/me': forgetMe,
} satisfies Record<ApiRouteKey, Handler<ApiContext>>;

/** The route keys this Lambda serves, for the contract tests. */
export const API_ROUTE_KEYS: string[] = Object.keys(routes);

export function createApiApp(deps: ApiDeps): (event: ProxyEvent) => Promise<ProxyResult> {
  const context: ApiContext = {
    ...deps,
    lifecycle: createPassLifecycle(deps),
    handoffService: createHandoffService(deps),
  };
  return createPipeline({ functionName: 'api', lookup: createRouter(routes), deps: context });
}
