// POST /api/v1/passes: verify, validate, limit, issue, 201.
import type { ApiContext } from '../../app/context.js';
import { header } from '../../http/event.js';
import { json } from '../../http/responses.js';
import type { Handler } from '../../http/router.js';
import { parseIssueRequest, parseJsonBody } from '../../validation/request-schemas.js';
import { IssuePassesResponseSchema } from '../../validation/response-schemas.js';

export const issuePasses: Handler<ApiContext> = async (req, ctx) => {
  const caller = await ctx.verifier.verify(header(req.event, 'authorization'));
  const request = parseIssueRequest(parseJsonBody(req.event), ctx.config.eventWindow);
  const issued = await ctx.lifecycle.issue(caller, request, req);
  return json(201, IssuePassesResponseSchema.parse(issued));
};
