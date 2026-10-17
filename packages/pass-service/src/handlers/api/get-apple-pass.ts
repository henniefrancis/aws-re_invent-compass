// GET /api/v1/passes/{serialNumber}/apple: the caller's own pass, signed on demand.
import type { ApiContext } from '../../app/context.js';
import { header } from '../../http/event.js';
import { binary } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { passTemplateInput } from '../../services/pass-template-input.js';

export const getApplePass: Handler<ApiContext> = async (req, ctx) => {
  const caller = await ctx.verifier.verify(header(req.event, 'authorization'));
  const rec = await ctx.lifecycle.find(
    caller,
    req.event.pathParameters?.serialNumber ?? '',
    req.now,
  );
  const input = await passTemplateInput(rec, {
    secrets: ctx.secrets,
    publicBaseUrl: ctx.config.publicBaseUrl,
    passkitPath: ctx.config.passkitPath,
    timezone: ctx.config.eventWindow.timezone,
  });
  return binary(200, 'application/vnd.apple.pkpass', await ctx.signer.signPass(input));
};
