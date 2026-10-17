// POST .../devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
// 201 for a new registration, 200 when it already exists (the push token is replaced), 401
// for everything invalid. At most 10 live registrations are kept per pass: past that cap a
// new device gets 200 and is not stored (review H3).
import type { PasskitDeps } from '../../app/deps.js';
import { MAX_REGISTRATIONS_PER_PASS } from '../../data/registration-repository.js';
import { ProblemError } from '../../http/problem.js';
import { empty } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { deviceHash } from '../../security/hashing.js';
import { parseRegistrationBody } from '../../validation/request-schemas.js';
import { authorizeApplePass } from './authorize-apple-pass.js';

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const registerDevice: Handler<PasskitDeps> = async (req, deps) => {
  const rec = await authorizeApplePass(req.event, deps, req.now);
  const { pushToken } = parseRegistrationBody(req.event);
  const deviceId = req.event.pathParameters?.deviceLibraryIdentifier ?? '';
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new ProblemError(401, 'unauthorized');
  }
  const [app, apple] = await Promise.all([deps.secrets.app(), deps.secrets.apple()]);
  const hash = deviceHash(app.pepper, deviceId);
  const existing = await deps.registrations.get(hash, rec.serialNumber, req.now);
  if (existing === undefined) {
    const live = await deps.registrations.listByPass(rec.serialNumber, req.now);
    if (live.length >= MAX_REGISTRATIONS_PER_PASS) {
      return empty(200);
    }
  }
  const outcome = await deps.registrations.upsert(
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
