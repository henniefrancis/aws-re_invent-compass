// DELETE .../devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
// 200 whether or not the registration existed, 401 for everything invalid.
import type { PasskitDeps } from '../../app/deps.js';
import { ProblemError } from '../../http/problem.js';
import { empty } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { deviceHash } from '../../security/hashing.js';
import { authorizeApplePass } from './authorize-apple-pass.js';
import { DEVICE_ID_PATTERN } from './register-device.js';

export const unregisterDevice: Handler<PasskitDeps> = async (req, deps) => {
  const rec = await authorizeApplePass(req.event, deps, req.now);
  const deviceId = req.event.pathParameters?.deviceLibraryIdentifier ?? '';
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new ProblemError(401, 'unauthorized');
  }
  const app = await deps.secrets.app();
  await deps.registrations.delete(deviceHash(app.pepper, deviceId), rec.serialNumber);
  return empty(200);
};
