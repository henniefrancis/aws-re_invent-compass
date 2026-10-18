// POST .../devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
// 201 for a new registration, 200 when it already exists (the push token is replaced), 401
// for everything invalid. At most 10 live registrations are kept per pass: past that cap a
// new device gets 200 and is not stored, also when requests race (review H3 and N7).
import type { PasskitDeps } from '../../app/deps.js';
import { ProblemError } from '../../http/problem.js';
import { empty } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { deviceHash } from '../../security/hashing.js';
import { parseRegistrationBody } from '../../validation/request-schemas.js';
import { authorizeApplePass } from './authorize-apple-pass.js';

/** Apple's identifiers are long random strings; a short one is refused (review N7). */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{16,128}$/;

export const registerDevice: Handler<PasskitDeps> = async (req, deps) => {
  const rec = await authorizeApplePass(req.event, deps, req.now);
  const { pushToken } = parseRegistrationBody(req.event);
  const deviceId = req.event.pathParameters?.deviceLibraryIdentifier ?? '';
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new ProblemError(401, 'unauthorized');
  }
  const [app, apple] = await Promise.all([deps.secrets.app(), deps.secrets.apple()]);
  const hash = deviceHash(app.pepper, deviceId);
  const outcome = await deps.registrations.register(
    {
      deviceHash: hash,
      serialNumber: rec.serialNumber,
      passTypeIdentifier: apple.passTypeIdentifier,
      pushToken,
      subHash: rec.subHash,
      pepperId: app.pepperId,
      expiresAtMs: rec.expiresAtMs,
      ttl: 0,
    },
    req.now,
  );
  return empty(outcome === 'created' ? 201 : 200);
};
