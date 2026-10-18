// Response schemas for the Compass API client (boarding-passes, S4).
//
// Each schema is declared as a z.ZodType of the matching generated CompassApi response
// type, so a schema that drifts from the contract fails to compile. The generated types
// are the single source: packages/contracts is never edited from here, and Problem and
// ProblemSchema stay in @compass/contracts. The objects are strict because the contract
// sets additionalProperties to false on every response.
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

// The schemas themselves live once in @compass/contracts (CTO M2).
export {
  CreateHandoffResponseSchema,
  ForgetMeResponseSchema,
  IssuePassesResponseSchema,
  UpdatePassResponseSchema,
  VoidPassResponseSchema,
} from '@compass/contracts';
