// Response schemas for the Compass API client (boarding-passes, S4).
//
// Each schema is declared as a z.ZodType of the matching generated CompassApi response
// type, so a schema that drifts from the contract fails to compile. The generated types
// are the single source: packages/contracts is never edited from here, and Problem and
// ProblemSchema stay in @compass/contracts. The objects are strict because the contract
// sets additionalProperties to false on every response.
import { z } from 'zod';
import type { CompassApi } from '@compass/contracts';

type Schemas = CompassApi.components['schemas'];

/** The contract request and response shapes the client sends and receives. */
export type IssuePassesRequest = Schemas['IssuePassesRequest'];
export type IssuePassesResponse = Schemas['IssuePassesResponse'];
export type UpdatePassResponse = Schemas['UpdatePassResponse'];
export type VoidPassResponse = Schemas['VoidPassResponse'];
export type CreateHandoffRequest = Schemas['CreateHandoffRequest'];
export type CreateHandoffResponse = Schemas['CreateHandoffResponse'];
export type ForgetMeResponse = Schemas['ForgetMeResponse'];

const platformSchema = z.enum(['apple', 'google']);
const instantSchema = z.iso.datetime({ offset: true });

/** 201 from POST /api/v1/passes. */
export const IssuePassesResponseSchema: z.ZodType<IssuePassesResponse> = z.strictObject({
  passes: z.array(
    z.strictObject({
      serialNumber: z.uuid(),
      sessionCode: z.string(),
      platforms: z.array(platformSchema),
    }),
  ),
});

/** 200 from PUT /api/v1/passes/{serialNumber}. */
export const UpdatePassResponseSchema: z.ZodType<UpdatePassResponse> = z.strictObject({
  serialNumber: z.uuid(),
  version: z.number().int(),
});

/** 200 from POST /api/v1/passes/{serialNumber}/void. */
export const VoidPassResponseSchema: z.ZodType<VoidPassResponse> = z.strictObject({
  serialNumber: z.uuid(),
  status: z.literal('voided'),
});

/** 201 from POST /api/v1/handoffs. */
export const CreateHandoffResponseSchema: z.ZodType<CreateHandoffResponse> = z.strictObject({
  handoffId: z.string(),
  boardUrl: z.string(),
  expiresAt: instantSchema,
});

/** 202 from DELETE /api/v1/me. */
export const ForgetMeResponseSchema: z.ZodType<ForgetMeResponse> = z.strictObject({
  voided: z.number().int(),
  deleted: z.number().int(),
});
