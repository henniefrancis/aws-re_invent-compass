// GET .../devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}
// No credential: Apple sends none here, and the device library identifier acts as the
// shared secret. 200 with the passes updated at or after the tag, or 204. The tag is the
// millisecond update tag of the newest pass listed; the comparison is at or after, so a change
// made in the same millisecond as the previous list is never lost (the pass at the tag itself
// is listed again, and its fetch answers 304 through If-Modified-Since).
import type { PasskitDeps } from '../../app/deps.js';
import type { PassRecord } from '../../data/records.js';
import { empty, json } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { deviceHash } from '../../security/hashing.js';
import { SerialNumbersSchema } from '../../validation/response-schemas.js';
import { DEVICE_ID_PATTERN } from './register-device.js';

const TAG_PATTERN = /^\d{1,16}$/;

export const getSerialNumbers: Handler<PasskitDeps> = async (req, deps) => {
  const deviceId = req.event.pathParameters?.deviceLibraryIdentifier ?? '';
  const apple = await deps.secrets.apple();
  if (
    !DEVICE_ID_PATTERN.test(deviceId) ||
    req.event.pathParameters?.passTypeIdentifier !== apple.passTypeIdentifier
  ) {
    return empty(204);
  }
  const tag = req.event.queryStringParameters?.passesUpdatedSince ?? '';
  const since = TAG_PATTERN.test(tag) ? Number(tag) : 0;
  const app = await deps.secrets.app();
  const registrations = await deps.registrations.listByDevice(
    deviceHash(app.pepper, deviceId),
    apple.passTypeIdentifier,
    req.now,
  );
  const found = await Promise.all(
    registrations.map((registration) => deps.passes.get(registration.serialNumber, req.now)),
  );
  const changed = found.filter(
    (rec): rec is PassRecord => rec !== undefined && rec.updateTagMs >= since,
  );
  if (changed.length === 0) {
    return empty(204);
  }
  return json(
    200,
    SerialNumbersSchema.parse({
      serialNumbers: changed.map((rec) => rec.serialNumber),
      lastUpdated: String(Math.max(...changed.map((rec) => rec.updateTagMs))),
    }),
  );
};
