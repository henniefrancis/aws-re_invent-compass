// Response validation for the Events API client (events-client, S1).
//
// Component 2 (validation). For a 2xx response with a body, the client parses the
// body with the matching @compass/contracts zod schema and returns the parsed value
// (Requirements 6.3, 6.4). On a schema failure it throws a typed ValidationError and
// never returns or embeds the unvalidated body (Requirement 6.5): the error message
// is built from the operation alone, so no part of the raw body (which could hold an
// email or other sensitive value) leaks.
//
// For the five no-body operations (CancelReservation, DisassociateFavorite,
// CreatePersonalTime, UpdatePersonalTime, DeletePersonalTime), a 204 with an empty
// body is success with no validation (Requirement 6.7): assertNoBody accepts an
// absent body and rejects an unexpected one.

import type { z } from 'zod';
import { ValidationError } from './errors.js';
import type { OperationName } from './transport.js';

/**
 * Parse a 2xx response body with the given schema and return the parsed value. On a
 * schema failure, throw a ValidationError that names only the operation: neither the
 * raw body nor the zod issue values (which could echo body content) are included.
 */
export function validateBody<T>(operation: OperationName, schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) {
    return result.data;
  }
  throw new ValidationError(operation, `${operation} response failed schema validation`);
}

/**
 * Treat a no-body response as success. A 204 for the five no-body operations carries
 * no body, so an undefined body returns normally with no validation. A body present
 * where none is expected is a contract violation and is rejected as a ValidationError
 * (again naming only the operation, never echoing the unexpected body).
 */
export function assertNoBody(operation: OperationName, body: unknown): void {
  if (body === undefined) {
    return;
  }
  throw new ValidationError(
    operation,
    `${operation} returned an unexpected response body where none was expected`,
  );
}
