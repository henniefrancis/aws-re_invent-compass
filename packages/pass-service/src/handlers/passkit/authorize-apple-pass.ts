// The ApplePass check (Requirement 17.1): the header, the pass type, the serial, a live pass
// and the SHA-256 of the token compared in constant time. Every failure is the same 401. An
// unknown serial still performs a comparison against a fixed dummy hash, so timing does not
// reveal whether a pass exists.
import type { PasskitDeps } from '../../app/deps.js';
import type { PassRecord } from '../../data/records.js';
import { header, type ProxyEvent } from '../../http/event.js';
import { ProblemError } from '../../http/problem.js';
import { UUID_V4_PATTERN } from '../../security/handoff-id.js';
import { constantTimeEqualHex, sha256Hex } from '../../security/hashing.js';

const AUTHORIZATION_PATTERN = /^ApplePass ([A-Za-z0-9_-]{16,128})$/;
const DUMMY_HASH = sha256Hex('no such pass');

export async function authorizeApplePass(
  event: ProxyEvent,
  deps: Pick<PasskitDeps, 'secrets' | 'passes'>,
  now: number,
): Promise<PassRecord> {
  const token = AUTHORIZATION_PATTERN.exec(header(event, 'authorization') ?? '')?.[1];
  const serial = event.pathParameters?.serialNumber ?? '';
  const apple = await deps.secrets.apple();
  const typeOk = event.pathParameters?.passTypeIdentifier === apple.passTypeIdentifier;
  const serialOk = UUID_V4_PATTERN.test(serial);
  const rec = serialOk ? await deps.passes.get(serial, now) : undefined;
  const tokenOk = constantTimeEqualHex(
    sha256Hex(token ?? ''),
    rec === undefined ? DUMMY_HASH : rec.authTokenHash,
  );
  if (token === undefined || !typeOk || rec === undefined || !tokenOk) {
    throw new ProblemError(401, 'unauthorized');
  }
  return rec;
}
