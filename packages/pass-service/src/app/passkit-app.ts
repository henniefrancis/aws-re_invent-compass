// The Passkit_Lambda app: Apple PassKit web service (registerDevice, unregisterDevice,
// getSerialNumbers, getLatestPass, logMessages).
import { getLatestPass } from '../handlers/passkit/get-latest-pass.js';
import { getSerialNumbers } from '../handlers/passkit/get-serial-numbers.js';
import { logMessages } from '../handlers/passkit/log-messages.js';
import { registerDevice } from '../handlers/passkit/register-device.js';
import { unregisterDevice } from '../handlers/passkit/unregister-device.js';
import type { ProxyEvent, ProxyResult } from '../http/event.js';
import { createRouter, type Handler } from '../http/router.js';
import type { PasskitRouteKey } from './contract-routes.js';
import type { PasskitDeps } from './deps.js';
import { createPipeline } from './pipeline.js';

const routes = {
  'POST /api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}':
    registerDevice,
  'DELETE /api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}':
    unregisterDevice,
  'GET /api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}':
    getSerialNumbers,
  'GET /api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}': getLatestPass,
  'POST /api/passkit/v1/log': logMessages,
} satisfies Record<PasskitRouteKey, Handler<PasskitDeps>>;

/** The route keys this Lambda serves, for the contract tests. */
export const PASSKIT_ROUTE_KEYS: string[] = Object.keys(routes);

export function createPasskitApp(deps: PasskitDeps): (event: ProxyEvent) => Promise<ProxyResult> {
  return createPipeline({ functionName: 'passkit', lookup: createRouter(routes), deps });
}
