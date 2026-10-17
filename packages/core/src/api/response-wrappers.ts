// Response wrappers for the Events API client (events-client, S1).
//
// Component 2 (response wrappers). A few operations return a bare value on the wire
// that the client presents under a named field. Those wrappers are built HERE in
// core/src/api with z.object composed from the exported @compass/contracts schemas
// (EventSchema, BulkResultSchema); packages/contracts is never edited (Requirements
// 6.6, 6.8).
//
//   - ListEvents returns { items: Event[] } (wrapping an array of EventSchema).
//   - GetEvent returns { event: Event }.
//   - ReserveSessions and AssociateFavorites each return { result: BulkResult }.
//
// ListSessions, GetSession and GetSchedule already have full envelope schemas in
// contracts (ListSessionsSchema, GetSessionSchema, GetScheduleSchema) and are
// validated directly, so no wrapper is built for them here.

import { z } from 'zod';
import { EventSchema, BulkResultSchema } from '@compass/contracts';

/**
 * The ListEvents result: this page of events under items. Built from the contract
 * EventSchema; unknown top-level fields are stripped by the plain z.object.
 */
export const ListEventsResultSchema = z.object({
  items: z.array(EventSchema),
});
export type ListEventsResult = z.infer<typeof ListEventsResultSchema>;

/**
 * The GetEvent result: a single event under event.
 */
export const GetEventResultSchema = z.object({
  event: EventSchema,
});
export type GetEventResult = z.infer<typeof GetEventResultSchema>;

/**
 * The bulk write result (ReserveSessions and AssociateFavorites): the per-session
 * BulkResult under result. A 200 can still hold failures, so the caller reads both
 * result.successful and result.failed.
 */
export const BulkWriteResultSchema = z.object({
  result: BulkResultSchema,
});
export type BulkWriteResult = z.infer<typeof BulkWriteResultSchema>;
