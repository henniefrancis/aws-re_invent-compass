// The Passkit_Lambda app: Apple PassKit web service (registerDevice, unregisterDevice,
// getSerialNumbers, getLatestPass, logMessages).
import { getLatestPass } from '../handlers/passkit/get-latest-pass.js';
import { getSerialNumbers } from '../handlers/passkit/get-serial-numbers.js';
import { logMessages } from '../handlers/passkit/log-messages.js';
import { registerDevice } from '../handlers/passkit/register-device.js';
import { unregisterDevice } from '../handlers/passkit/unregister-device.js';
import type { ProxyEvent, ProxyResult } from '../http/event.js';
import { createRouter, type Handler, type RouteKey } from '../http/router.js';
import type { PasskitDeps } from './deps.js';
import { createPipeline } from './pipeline.js';

const DEVICE =
  '/api/passkit/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}';

const routes: Partial<Record<RouteKey, Handler<PasskitDeps>>> = {
  [`POST ${DEVICE}/{serialNumber}`]: registerDevice,
  [`DELETE ${DEVICE}/{serialNumber}`]: unregisterDevice,
  [`GET ${DEVICE}`]: getSerialNumbers,
  'GET /api/passkit/v1/passes/{passTypeIdentifier}/{serialNumber}': getLatestPass,
  'POST /api/passkit/v1/log': logMessages,
};

export function createPasskitApp(deps: PasskitDeps): (event: ProxyEvent) => Promise<ProxyResult> {
  return createPipeline({ functionName: 'passkit', lookup: createRouter(routes), deps });
}
