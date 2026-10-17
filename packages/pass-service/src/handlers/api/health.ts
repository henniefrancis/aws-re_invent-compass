// GET /api/v1/health: the origin check (in the pipeline) is the only guard. No table access
// and no secret other than the origin-verify value.
import type { ApiContext } from '../../app/context.js';
import { json } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { HealthSchema } from '../../validation/response-schemas.js';

export const getHealth: Handler<ApiContext> = (_req, ctx) =>
  Promise.resolve(
    json(200, HealthSchema.parse({ status: 'ok', version: ctx.config.serviceVersion })),
  );
