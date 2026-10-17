// POST /api/v1/passes/{serialNumber}/void: idempotent.
import type { ApiContext } from '../../app/context.js';
import { header } from '../../http/event.js';
import { json } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { VoidPassResponseSchema } from '../../validation/response-schemas.js';

export const voidPass: Handler<ApiContext> = async (req, ctx) => {
  const caller = await ctx.verifier.verify(header(req.event, 'authorization'));
  const result = await ctx.lifecycle.void(
    caller,
    req.event.pathParameters?.serialNumber ?? '',
    req,
  );
  return json(200, VoidPassResponseSchema.parse(result));
};
