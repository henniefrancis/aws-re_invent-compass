// Path builder for the Events API operations (events-client, S1).
//
// Every operation except ListEvents lives under /events/{eventId}. The path
// templates come from the official OpenAPI document
// (packages/contracts/events-api.openapi.json); the transport prefixes the base URL
// https://api.awsevents.com/v1. Each dynamic segment is URL-encoded so an id can
// never alter the path structure.

import type { ClientContext } from './transport.js';

/**
 * Build `/events/{eventId}` plus the given already-encoded suffix, taking the event
 * id from the client context.
 */
export function eventPath(ctx: ClientContext, suffix = ''): string {
  return `/events/${encodeURIComponent(ctx.eventId)}${suffix}`;
}

/** URL-encode one dynamic path segment. */
export function segment(value: string): string {
  return encodeURIComponent(value);
}
