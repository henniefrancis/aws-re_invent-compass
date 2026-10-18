// Wire schema for the Events API Event (foundation-contracts, S0). This mirrors the
// official Events API OpenAPI document (packages/contracts/events-api.openapi.json)
// exactly. The event window and timezone the product relies on come from GetEvent,
// so they are read from here rather than hard-coded.
//
// Cross-cutting rules applied here (see design, Data Models):
//   1. Defensive parsing by stripping. Plain z.object strips unknown fields on Event
//      and on the nested address, so fields added over time are ignored rather than
//      carried into logs, and never break parsing.
//   2. No coercion. A present field with the wrong type is rejected, not coerced.
import { z } from 'zod';

// The event's physical location. The Events API EventAddress has a single optional
// city string. Unknown fields are stripped.
const EventAddressSchema = z.object({
  city: z.string().optional(),
});

/**
 * A single AWS event. eventId, name, eventType, startDate, endDate, isOnline and
 * authenticationRequired are required; timezone, timezoneAbbreviation, timeFormat,
 * address and supportedLanguageCodes are optional. Dates are ISO-8601 strings on the
 * wire. Unknown fields are stripped.
 */
export const EventSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  eventType: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isOnline: z.boolean(),
  authenticationRequired: z.boolean(),
  timezone: z.string().optional(),
  timezoneAbbreviation: z.string().optional(),
  timeFormat: z.string().optional(),
  address: EventAddressSchema.optional(),
  supportedLanguageCodes: z.array(z.string()).optional(),
});

export type Event = z.infer<typeof EventSchema>;
