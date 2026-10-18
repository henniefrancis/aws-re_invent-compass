// The output schema handed to the MCP SDK for registration.
//
// Some contract output schemas contain a transform (the forward-compatible seatAvailability
// in NormalisedSession). The SDK builds the tool's published JSON Schema from the output
// schema in "output" mode, where a transform cannot be represented, and listing tools then
// fails. This wrapper keeps the contract schema as the one source of truth: validation
// is done by the server with the contract schema itself (results.ts), and the published JSON
// Schema is derived from the same contract schema in "input" mode (the wire shape). Nothing is
// redeclared.

import { z } from 'zod';

/**
 * Wraps a contract output schema for registration. The SDK only accepts an object schema
 * here, so the wrapper is a loose object that accepts any object (the handler result is
 * already parsed with the contract schema by `toCallToolResult` before it is returned), and
 * its published JSON Schema is derived from the contract schema in "input" mode.
 */
export function registrationSchema(schema: z.ZodType) {
  const wrapper = z.looseObject({});
  wrapper._zod.toJSONSchema = () => z.toJSONSchema(schema, { io: 'input', target: 'draft-7' });
  return wrapper;
}
