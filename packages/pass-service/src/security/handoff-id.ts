// The hand-off capability and the UUID check used for serial numbers.
import type { Random } from '../seams.js';

/** 16 random bytes, base64url without padding: 22 characters. */
export const HANDOFF_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newHandoffId(random: Random): string {
  return Buffer.from(random.bytes(16)).toString('base64url');
}
