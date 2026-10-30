// Compass API response schemas (single source for pass-service and core, CTO M2).
//
// Each schema is typed against the generated Compass API types so that a schema which drifts
// from the contract fails to compile. Strict objects mirror `additionalProperties: false`.
import { z } from 'zod';
import type * as CompassApi from './generated/compass-api.js';

type Schemas = CompassApi.components['schemas'];

const platform = z.enum(['apple', 'google']);
const dateTime = z.iso.datetime({ offset: true });

export const HealthSchema: z.ZodType<Schemas['Health']> = z.strictObject({
  status: z.string(),
  version: z.string(),
});

export const IssuePassesResponseSchema: z.ZodType<Schemas['IssuePassesResponse']> = z.strictObject({
  passes: z.array(
    z.strictObject({
      serialNumber: z.uuid(),
      sessionCode: z.string(),
      platforms: z.array(platform),
    }),
  ),
});

export const UpdatePassResponseSchema: z.ZodType<Schemas['UpdatePassResponse']> = z.strictObject({
  serialNumber: z.uuid(),
  version: z.number().int(),
});

export const VoidPassResponseSchema: z.ZodType<Schemas['VoidPassResponse']> = z.strictObject({
  serialNumber: z.uuid(),
  status: z.literal('voided'),
});

export const CreateHandoffResponseSchema: z.ZodType<Schemas['CreateHandoffResponse']> =
  z.strictObject({
    handoffId: z.string(),
    boardUrl: z.string(),
    expiresAt: dateTime,
  });

export const HandoffViewSchema: z.ZodType<Schemas['HandoffView']> = z.strictObject({
  expiresAt: dateTime,
  sessions: z.array(
    z.strictObject({
      serialNumber: z.uuid(),
      sessionCode: z.string(),
      title: z.string(),
      startsAt: dateTime,
      applePath: z.string().nullable(),
      googleSaveUrl: z.string().nullable(),
      calendarPath: z.string().nullable(),
    }),
  ),
  apple: z.strictObject({ bundlePaths: z.array(z.string()) }),
  google: z.strictObject({ saveUrl: z.string() }).nullable(),
  calendarPath: z.string().nullable(),
});

export const ForgetMeResponseSchema: z.ZodType<Schemas['ForgetMeResponse']> = z.strictObject({
  voided: z.number().int(),
  deleted: z.number().int(),
});

export const SerialNumbersSchema: z.ZodType<Schemas['SerialNumbers']> = z.strictObject({
  serialNumbers: z.array(z.string()),
  lastUpdated: z.string(),
});

/** Every response schema by name, for tests that walk them. */
export const CompassApiResponseSchemas = {
  HealthSchema,
  IssuePassesResponseSchema,
  UpdatePassResponseSchema,
  VoidPassResponseSchema,
  CreateHandoffResponseSchema,
  HandoffViewSchema,
  ForgetMeResponseSchema,
  SerialNumbersSchema,
};
