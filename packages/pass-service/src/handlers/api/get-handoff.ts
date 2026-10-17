// GET /api/v1/handoffs/{handoffId}: authorised by the capability, not by a token.
import type { ApiContext } from '../../app/context.js';
import { json } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { HandoffViewSchema } from '../../validation/response-schemas.js';

export const getHandoff: Handler<ApiContext> = async (req, ctx) => {
  const view = await ctx.handoffService.view(req.event.pathParameters?.handoffId ?? '', req);
  return json(200, HandoffViewSchema.parse(view));
};
