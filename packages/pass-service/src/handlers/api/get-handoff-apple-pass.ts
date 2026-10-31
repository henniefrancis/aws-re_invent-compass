// GET /api/v1/handoffs/{handoffId}/apple/pass/{serialNumber}: one signed .pkpass.
import type { ApiContext } from '../../app/context.js';
import { binary } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';

export const getHandoffApplePass: Handler<ApiContext> = async (req, ctx) => {
  const bytes = await ctx.handoffService.applePass(
    req.event.pathParameters?.handoffId ?? '',
    req.event.pathParameters?.serialNumber ?? '',
    req,
  );
  // A fixed, non-identifying file name (review S7).
  return binary(200, 'application/vnd.apple.pkpass', bytes, {
    'content-disposition': 'attachment; filename="reinvent-pass.pkpass"',
  });
};
