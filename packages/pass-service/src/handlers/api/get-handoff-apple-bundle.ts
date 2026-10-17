// GET /api/v1/handoffs/{handoffId}/apple/{bundleIndex}: a .pkpasses bundle of up to 10 passes.
import type { ApiContext } from '../../app/context.js';
import { ProblemError } from '../../http/problem.js';
import { binary } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';

const INDEX_PATTERN = /^\d{1,6}$/;

export const getHandoffAppleBundle: Handler<ApiContext> = async (req, ctx) => {
  const index = req.event.pathParameters?.bundleIndex ?? '';
  if (!INDEX_PATTERN.test(index)) {
    throw new ProblemError(404, 'not_found');
  }
  const bytes = await ctx.handoffService.appleBundle(
    req.event.pathParameters?.handoffId ?? '',
    Number(index),
    req,
  );
  return binary(200, 'application/vnd.apple.pkpasses', bytes);
};
