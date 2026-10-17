// PUT /api/v1/passes/{serialNumber}: verify, validate, then replace the content.
import type { ApiContext } from '../../app/context.js';
import { header } from '../../http/event.js';
import { json } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { parseJsonBody, parsePassFields } from '../../validation/request-schemas.js';
import { UpdatePassResponseSchema } from '../../validation/response-schemas.js';

export const updatePass: Handler<ApiContext> = async (req, ctx) => {
  const caller = await ctx.verifier.verify(header(req.event, 'authorization'));
  const fields = parsePassFields(parseJsonBody(req.event), ctx.config.eventWindow);
  const result = await ctx.lifecycle.update(
    caller,
    req.event.pathParameters?.serialNumber ?? '',
    fields,
    req,
  );
  return json(200, UpdatePassResponseSchema.parse(result));
};
