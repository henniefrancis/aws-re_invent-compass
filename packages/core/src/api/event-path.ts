// Path builder for the Events API operations (events-client, S1).
//
// Every operation except ListEvents lives under /events/{eventId}. The path
// templates come from the official OpenAPI document
// (packages/contracts/events-api.openapi.json); the transport prefixes the base URL
// https://api.awsevents.com/v1.
//
// Every dynamic segment is checked before use and then URL-encoded. encodeURIComponent
// leaves "." and ".." untouched and URL parsing collapses them, so an id of ".." could
// walk a request out of its path; separators and control characters could change the
// path shape. The check is a deny-list of exactly those hazards (empty, ".", "..", a
// slash or backslash, a control character, more than 256 characters), not an
// allow-list, so no real id format is rejected. The error never echoes the value.

import { ValidationError } from './errors.js';
import type { ClientContext, OperationName } from './transport.js';

/** The longest identifier accepted in a path segment. */
export const MAX_SEGMENT_LENGTH = 256;

/** True when any character is an ASCII control character (including DEL). */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Throw a ValidationError unless the value is safe to use as one path segment. */
export function assertSafeId(operation: OperationName, value: string): void {
  if (
    value.length === 0 ||
    value.length > MAX_SEGMENT_LENGTH ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    hasControlCharacter(value)
  ) {
    throw new ValidationError(operation, `${operation} was given an identifier that is not valid`);
  }
}

/** Check then URL-encode one dynamic path segment. */
export function segment(operation: OperationName, value: string): string {
  assertSafeId(operation, value);
  return encodeURIComponent(value);
}

/**
 * Build `/events/{eventId}` plus the given already-encoded suffix, taking the event
 * id from the client context.
 */
export function eventPath(ctx: ClientContext, operation: OperationName, suffix = ''): string {
  return `/events/${segment(operation, ctx.eventId)}${suffix}`;
}
