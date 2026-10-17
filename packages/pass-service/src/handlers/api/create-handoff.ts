// POST /api/v1/handoffs: verify, validate, create a 15-minute hand-off.
import type { ApiContext } from '../../app/context.js';
import { header } from '../../http/event.js';
import { json } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { parseHandoffRequest, parseJsonBody } from '../../validation/request-schemas.js';
import { CreateHandoffResponseSchema } from '../../validation/response-schemas.js';

export const createHandoff: Handler<ApiContext> = async (req, ctx) => {
  const caller = await ctx.verifier.verify(header(req.event, 'authorization'));
  const request = parseHandoffRequest(parseJsonBody(req.event));
  const created = await ctx.handoffService.create(caller, request, req);
  return json(201, CreateHandoffResponseSchema.parse(created));
};
