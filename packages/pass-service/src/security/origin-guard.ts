// Origin verification (Requirement 3, review M2). A request that bypassed CloudFront has
// no valid x-origin-verify header. Both sides are hashed with SHA-256 so the compared
// buffers always have equal length, then compared in constant time. While the value is
// being rotated, the previous value is accepted as well. Both comparisons always run.
import { createHash, timingSafeEqual } from 'node:crypto';
import { header, type ProxyEvent } from '../http/event.js';
import type { OriginSecret } from '../secrets/secret-shapes.js';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function matches(presented: Buffer, expected: string | undefined): boolean {
  // An absent expected value compares the presented digest with itself and is then
  // discarded, so the work done is the same whether or not a previous value is set.
  const target = expected === undefined ? presented : digest(expected);
  const equal = timingSafeEqual(presented, target);
  return expected !== undefined && equal;
}

export function checkOrigin(
  event: ProxyEvent,
  secret: Pick<OriginSecret, 'originVerify' | 'originVerifyPrevious'>,
): boolean {
  const value = header(event, 'x-origin-verify');
  if (value === undefined) {
    return false;
  }
  const presented = digest(value);
  const current = matches(presented, secret.originVerify);
  const previous = matches(presented, secret.originVerifyPrevious);
  return current || previous;
}
